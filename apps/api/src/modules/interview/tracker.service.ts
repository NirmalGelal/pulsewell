import type { ChecklistItem, Session } from '@prisma/client';
import {
  TrackerOutputSchema,
  mergeChecklistUpdate,
  type ChecklistItemLike,
  type ChecklistKey,
  type ChecklistSource,
  type InterviewState,
  type ItemStatus,
} from '@pvc/shared';
import { z } from 'zod';
import type { AppDeps } from '../../deps';
import { fromJson, toJson } from '../../lib/json';
import { buildTrackerMessages, type TurnLike } from './prompts';

const TurnIdsSchema = z.array(z.number().int());

export function rowToLike(row: ChecklistItem): ChecklistItemLike {
  return {
    key: row.key as ChecklistKey,
    status: row.status as ItemStatus,
    value: row.value,
    confidence: row.confidence,
    note: row.note,
    turnIds: fromJson(TurnIdsSchema, row.turnIds),
    source: row.source as ChecklistSource,
  };
}

export async function loadChecklist(
  deps: Pick<AppDeps, 'prisma'>,
  sessionId: string,
): Promise<ChecklistItemLike[]> {
  const rows = await deps.prisma.checklistItem.findMany({ where: { sessionId } });
  return rows.map(rowToLike);
}

export async function upsertChecklistItem(
  deps: Pick<AppDeps, 'prisma'>,
  sessionId: string,
  item: ChecklistItemLike,
): Promise<void> {
  const data = {
    status: item.status,
    value: item.value,
    confidence: item.confidence,
    note: item.note ?? null,
    turnIds: toJson(item.turnIds),
    source: item.source,
  };
  await deps.prisma.checklistItem.upsert({
    where: { sessionId_key: { sessionId, key: item.key } },
    create: { sessionId, key: item.key, ...data },
    update: data,
  });
}

/** Runs the tracker model and applies its updates. Never throws; failures leave the checklist unchanged. */
export async function runTracker(
  deps: AppDeps,
  args: {
    session: Session;
    state: InterviewState;
    recent: TurnLike[];
    checklist: ChecklistItemLike[];
  },
): Promise<ChecklistItemLike[]> {
  const { session, state } = args;
  try {
    const { data } = await deps.llm.completeJson('tracker', {
      schema: TrackerOutputSchema,
      messages: buildTrackerMessages({
        focus: state.lastFocus ?? 'open_story',
        recent: args.recent,
        checklist: args.checklist,
      }),
      cacheSalt: session.cacheSalt,
    });
    const patientTurns = await deps.prisma.message.findMany({
      where: { sessionId: session.id, sender: 'PATIENT' },
      select: { turnId: true },
    });
    const valid = new Set(patientTurns.map((m) => m.turnId));
    const current = new Map(args.checklist.map((i) => [i.key, i]));
    for (const update of data.updates) {
      const turnIds = update.turnIds.filter((t) => valid.has(t));
      if (turnIds.length === 0) continue;
      const merged = mergeChecklistUpdate(current.get(update.key), { ...update, turnIds });
      if (!merged) continue;
      await upsertChecklistItem(deps, session.id, merged);
      current.set(merged.key, merged);
    }
    return [...current.values()];
  } catch (e) {
    deps.logger.warn('tracker_failed', {
      sessionId: session.id,
      name: e instanceof Error ? e.name : typeof e,
    });
    return args.checklist;
  }
}
