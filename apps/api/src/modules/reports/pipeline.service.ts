import type { Session } from '@prisma/client';
import {
  RISK_CATEGORIES,
  SUMMARY_SECTIONS,
  type EvidenceItem,
  type ReportContent,
  type RiskLevel,
  type Sender,
  type SafetySource,
} from '@pvc/shared';
import { z } from 'zod';
import type { AppDeps } from '../../deps';
import { fromJson } from '../../lib/json';
import { loadChecklist } from '../interview/tracker.service';
import { assembleReport, type SafetyEventLike } from './assemble';
import { checkQuotes } from './quotes';
import { runVerifier } from './verifier';
import {
  runWriter,
  type NormalizedWriter,
  type TurnMessage,
  type UnsupportedFeedback,
} from './writer';

const CategoriesSchema = z.array(z.enum(RISK_CATEGORIES));

export interface GenerateResult {
  content: ReportContent;
  claimsRemoved: number;
  quotesRemoved: number;
  regenerated: boolean;
}

const allItems = (n: Pick<NormalizedWriter, 'priorities' | 'summary'>): EvidenceItem[] => [
  ...n.priorities,
  ...SUMMARY_SECTIONS.flatMap((s) => n.summary[s]),
];

function dropItems(n: NormalizedWriter, ids: Set<string>): number {
  let removed = 0;
  const keep = (list: EvidenceItem[]) =>
    list.filter((i) => {
      if (ids.has(i.id)) {
        removed++;
        return false;
      }
      return true;
    });
  n.priorities = keep(n.priorities);
  for (const s of SUMMARY_SECTIONS) n.summary[s] = keep(n.summary[s]);
  return removed;
}

/** Runs write -> verify (one regeneration at most) -> assemble. Throws LlmUnavailableError if the writer fails. */
export async function generateReport(
  deps: AppDeps,
  session: Session,
  displayName: string,
): Promise<GenerateResult> {
  const rows = await deps.prisma.message.findMany({
    where: { sessionId: session.id },
    orderBy: { turnId: 'asc' },
  });
  const messages: TurnMessage[] = rows.map((m) => ({
    turnId: m.turnId,
    sender: m.sender as Sender,
    text: m.text,
  }));
  const checklist = await loadChecklist(deps, session.id);
  const events = await deps.prisma.safetyEvent.findMany({ where: { sessionId: session.id } });
  const safetyEvents: SafetyEventLike[] = events.map((e) => ({
    turnId: e.turnId,
    level: e.level as RiskLevel,
    categories: fromJson(CategoriesSchema, e.categories),
    evidence: e.evidence,
    source: e.source as SafetySource,
  }));

  const base = { messages, checklist, cacheSalt: session.cacheSalt };
  let { normalized, model: writerModel } = await runWriter(deps, base);
  let verification = await runVerifier(deps, {
    messages,
    cacheSalt: session.cacheSalt,
    items: allItems(normalized),
  });
  let regenerated = false;

  if (verification.unsupported.length > 0) {
    regenerated = true;
    const byId = new Map(allItems(normalized).map((i) => [i.id, i]));
    const feedback: UnsupportedFeedback[] = verification.unsupported.map((u) => ({
      itemId: u.itemId,
      text: byId.get(u.itemId)?.text ?? '',
      reason: u.reason,
    }));
    try {
      const second = await runWriter(deps, { ...base, feedback });
      normalized = second.normalized;
      writerModel = second.model;
      verification = await runVerifier(deps, {
        messages,
        cacheSalt: session.cacheSalt,
        items: allItems(normalized),
      });
    } catch (e) {
      // Regeneration failed: fall back to the first draft minus the unsupported items.
      deps.logger.warn('writer_regenerate_failed', {
        name: e instanceof Error ? e.name : typeof e,
      });
    }
  }

  const checked = allItems(normalized).length;
  const unsupportedIds = new Set(verification.unsupported.map((u) => u.itemId));
  const claimsRemoved = normalized.claimsRemoved + dropItems(normalized, unsupportedIds);
  const q = checkQuotes(normalized.quotes, messages);

  const now = deps.clock.now();
  const content = assembleReport({
    sessionId: session.id,
    displayName,
    startedAt: session.startedAt,
    endedAt: session.endedAt ?? now,
    riskLevel: session.riskLevel as RiskLevel,
    checklist,
    safetyEvents,
    priorities: normalized.priorities,
    summary: normalized.summary,
    quotes: q.quotes,
    writerNotDiscussed: normalized.notDiscussed,
    writerModel,
    verifierModel: verification.model,
    now,
    verification: {
      claimsChecked: checked,
      claimsRemoved,
      quotesRemoved: q.quotesRemoved,
      regenerated,
    },
  });
  return { content, claimsRemoved, quotesRemoved: q.quotesRemoved, regenerated };
}
