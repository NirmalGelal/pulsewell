import { randomBytes } from 'node:crypto';
import {
  AssistantOutputSchema,
  SUMMARY_SECTIONS,
  type AskResponse,
  type EvidenceItem,
  type ReportContent,
} from '@pvc/shared';
import type { AppDeps } from '../../deps';
import { llmUnavailable } from '../../lib/errors';
import { audit } from '../audit/audit.service';
import { assertLinked } from '../auth/access';
import { LlmUnavailableError } from '../llm/types';
import { clinicianContentOf } from './dto';

export const NO_RECORDS_ANSWER = 'There are no approved records for this patient yet.';

export const ASSISTANT_SYSTEM_PROMPT = `You answer a clinician's question about one patient using ONLY the records provided (approved summaries and transcripts).
Cite every factual statement with references like [S1:T4]. If the records don't contain the answer, say:
"This was not discussed in the patient's approved records."
Never diagnose, never recommend treatment or medication, never speculate beyond the records. Be concise (≤ 150 words).
Return ONLY JSON: {"answer":"…","citations":[{"ref":"S1:T4"}]}`;

const oneLine = (s: string) => s.replace(/\s*[\r\n]+\s*/g, ' ');
const scoreText = (r: ReportContent['screening']['phq9'], label: string) =>
  r.total !== null
    ? `${label} ${r.total} (${r.band})`
    : `${label} incomplete (partial ${r.partialSum})`;

interface Turn {
  sessionId: string;
  text: string;
}

export async function askRecord(
  deps: AppDeps,
  clinicianId: string,
  patientId: string,
  question: string,
): Promise<AskResponse> {
  await assertLinked(deps.prisma, clinicianId, patientId);
  const newest = await deps.prisma.report.findMany({
    where: { status: 'APPROVED', approvedAt: { not: null }, session: { patientId } },
    orderBy: { approvedAt: 'desc' },
    take: 10,
  });
  const reports = newest.reverse(); // oldest -> newest = S1..Sn
  await audit(deps, {
    actorId: clinicianId,
    action: 'assistant.ask',
    resourceType: 'patient',
    resourceId: patientId,
    meta: { chars: question.length },
  });
  if (reports.length === 0) return { answer: NO_RECORDS_ANSWER, citations: [], model: 'none' };

  const header: string[] = [];
  const blocks: string[] = [];
  const turns = new Map<string, Turn>(); // "S1:T4" -> turn
  for (const [i, r] of reports.entries()) {
    const n = i + 1;
    const c = clinicianContentOf(r);
    header.push(
      `S${n} = approved ${r.approvedAt!.toISOString().slice(0, 10)}, ${scoreText(c.screening.phq9, 'PHQ-9')}, ${scoreText(c.screening.gad7, 'GAD-7')}`,
    );
    const lines: string[] = [];
    const add = (section: string, items: EvidenceItem[]) => {
      for (const it of items) {
        if (it.removedByPatient) continue;
        const text = (it.patientCorrection || it.text).trim();
        if (!text) continue;
        lines.push(
          `- [${section}] ${oneLine(text)} (${it.turnIds.map((t) => `T${t}`).join(', ')})`,
        );
      }
    };
    add('priorities', c.priorities);
    for (const s of SUMMARY_SECTIONS) add(s, c.summary[s]);
    const messages = await deps.prisma.message.findMany({
      where: { sessionId: r.sessionId, redacted: false },
      orderBy: { turnId: 'asc' },
    });
    const tr = messages.map((m) => {
      turns.set(`S${n}:T${m.turnId}`, { sessionId: r.sessionId, text: m.text });
      return `[S${n}:T${m.turnId}] ${m.sender}: ${oneLine(m.text)}`;
    });
    blocks.push(`S${n} REPORT:\n${lines.join('\n')}\n\nS${n} TRANSCRIPT:\n${tr.join('\n')}`);
  }
  const context = `SESSIONS:\n${header.join('\n')}\n\n${blocks.join('\n\n')}`;

  let result;
  try {
    result = await deps.llm.completeJson('assistant', {
      messages: [
        { role: 'system', content: ASSISTANT_SYSTEM_PROMPT },
        { role: 'user', content: `${context}\n\nQUESTION: ${question}` },
      ],
      schema: AssistantOutputSchema,
      temperature: 0.1,
      cacheSalt: randomBytes(16).toString('base64'),
    });
  } catch (e) {
    if (e instanceof LlmUnavailableError) throw llmUnavailable('The assistant is unavailable');
    throw e;
  }

  const found = new Set<string>();
  const normalize = (ref: string) => {
    const m = /^\s*\[?S(\d+):T(\d+)\]?\s*$/.exec(ref);
    return m ? `S${m[1]}:T${m[2]}` : null;
  };
  for (const c of result.data.citations) {
    const k = normalize(c.ref);
    if (k && turns.has(k)) found.add(k);
  }
  const answer = result.data.answer
    .replace(/\s*\[S(\d+):T(\d+)\]/g, (whole, s: string, t: string) => {
      const k = `S${s}:T${t}`;
      if (turns.has(k)) {
        found.add(k);
        return whole;
      }
      return '';
    })
    .trim();
  const citations = [...found].map((k) => {
    const t = turns.get(k)!;
    return {
      sessionId: t.sessionId,
      turnId: Number(k.split(':T')[1]),
      excerpt: t.text.slice(0, 160),
    };
  });
  return { answer, citations, model: result.model };
}
