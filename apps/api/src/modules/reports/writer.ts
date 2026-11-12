import {
  SUMMARY_SECTIONS,
  WriterOutputSchema,
  renderTranscript,
  type ChecklistItemLike,
  type DomainKey,
  type EvidenceItem,
  type GeneratedItem,
  type Sender,
  type SummarySection,
  DOMAIN_KEYS,
} from '@pvc/shared';
import type { AppDeps } from '../../deps';
import type { ChatMessage } from '../llm/types';

export interface TurnMessage {
  turnId: number;
  sender: Sender;
  text: string;
}

export const WRITER_SYSTEM_PROMPT = `You write a clinician-facing intake summary from a conversation between a PATIENT and an AI COMPANION.
Rules:
- Use ONLY what the PATIENT said. Never infer, diagnose, interpret, or add clinical labels. Never exaggerate or soften.
- Every item cites "turnIds": the PATIENT turn numbers that directly support it.
- "text": concise clinical third person ("Reports…", "Describes…", "Denies…").
- "patientText": the same fact in plain, kind second person ("You said…").
- summary sections: chiefConcern, presentConcern (onset, course, triggers), moodAnxiety, sleepAppetiteEnergy, functioning,
  substanceUse, history (past diagnoses, treatment, medications), supports, carePreferences. Use [] when nothing was said.
- priorities: up to 3 things the patient most wants help with, most important first.
- quotes: up to 6 short sentences copied EXACTLY, character for character, from PATIENT turns, with their turnId.
  Prefer sentences that convey the patient's experience in their own words.
- notDiscussed: domain keys never discussed: chief_concern, mood_anxiety, sleep_appetite_energy, functioning, substance_use,
  safety, history, supports, goals, priorities.
- Do NOT include scores, risk levels, or diagnoses; they are added separately by other systems.
Return ONLY JSON: {"priorities":[{"text","patientText","turnIds"}],"summary":{"<section>":[{"text","patientText","turnIds"}]},
"quotes":[{"text","turnId"}],"notDiscussed":[...]}`;

export const MAX_PRIORITIES = 3;
export const MAX_ITEMS_PER_SECTION = 6;
export const MAX_QUOTES = 6;
const BANNED_PHRASES = [
  'meets criteria',
  'consistent with a diagnosis',
  'suggestive of',
  'likely has',
  'diagnosis of',
];

export interface UnsupportedFeedback {
  itemId: string;
  text: string;
  reason: string;
}

export function buildWriterMessages(
  messages: TurnMessage[],
  checklist: ChecklistItemLike[],
  feedback: UnsupportedFeedback[] = [],
): ChatMessage[] {
  const notes = checklist
    .filter((i) => (DOMAIN_KEYS as readonly string[]).includes(i.key) && i.note)
    .map((i) => `${i.key}: ${i.note}`);
  let user = renderTranscript(messages);
  if (notes.length > 0) user += `\n\nTRACKER NOTES:\n${notes.join('\n')}`;
  if (feedback.length > 0) {
    user += `\n\nThese statements were judged unsupported by the transcript; remove or rewrite them faithfully: ${feedback
      .map((f) => `${f.itemId}: ${f.text} — ${f.reason}`)
      .join('; ')}`;
  }
  return [
    { role: 'system', content: WRITER_SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

export interface NormalizedWriter {
  priorities: EvidenceItem[];
  summary: Record<SummarySection, EvidenceItem[]>;
  quotes: { text: string; turnId: number }[];
  notDiscussed: DomainKey[];
  claimsRemoved: number;
}

/** Pure: assigns ids, filters turn ids, applies caps and the banned-phrase guard. */
export function normalizeWriterOutput(
  output: ReturnType<typeof WriterOutputSchema.parse>,
  messages: TurnMessage[],
): NormalizedWriter {
  const patientText = new Map(
    messages.filter((m) => m.sender === 'PATIENT').map((m) => [m.turnId, m.text]),
  );
  let removed = 0;

  const clean = (items: GeneratedItem[], prefix: string, cap: number): EvidenceItem[] => {
    const kept: Omit<EvidenceItem, 'id'>[] = [];
    for (const it of items) {
      const turnIds = [...new Set(it.turnIds.filter((t) => patientText.has(t)))].sort(
        (a, b) => a - b,
      );
      const text = it.text.trim();
      const pText = it.patientText.trim();
      if (turnIds.length === 0 || !text || !pText) {
        removed++;
        continue;
      }
      const lower = text.toLowerCase();
      const banned = BANNED_PHRASES.some((p) => lower.includes(p));
      if (banned && !turnIds.some((t) => patientText.get(t)!.toLowerCase().includes('diagnos'))) {
        removed++;
        continue;
      }
      kept.push({ text, patientText: pText, turnIds });
    }
    return kept.slice(0, cap).map((it, i) => ({ id: `${prefix}-${i + 1}`, ...it }));
  };

  const summary = {} as Record<SummarySection, EvidenceItem[]>;
  for (const s of SUMMARY_SECTIONS)
    summary[s] = clean(output.summary[s] ?? [], s, MAX_ITEMS_PER_SECTION);
  return {
    priorities: clean(output.priorities, 'priorities', MAX_PRIORITIES),
    summary,
    quotes: output.quotes
      .map((q) => ({ text: q.text.trim(), turnId: q.turnId }))
      .filter((q) => q.text)
      .slice(0, MAX_QUOTES),
    notDiscussed: output.notDiscussed,
    claimsRemoved: removed,
  };
}

export async function runWriter(
  deps: AppDeps,
  args: {
    messages: TurnMessage[];
    checklist: ChecklistItemLike[];
    cacheSalt: string;
    feedback?: UnsupportedFeedback[];
  },
): Promise<{ normalized: NormalizedWriter; model: string }> {
  const { data, model } = await deps.llm.completeJson('reportWriter', {
    schema: WriterOutputSchema,
    messages: buildWriterMessages(args.messages, args.checklist, args.feedback),
    thinking: 'medium',
    cacheSalt: args.cacheSalt,
  });
  return { normalized: normalizeWriterOutput(data, args.messages), model };
}
