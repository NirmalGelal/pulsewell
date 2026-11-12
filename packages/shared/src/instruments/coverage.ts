import type { TrackerOutput } from '../schemas/llm';
import type { PendingItemDto, ProgressDto } from '../schemas/dto';
import {
  CHECKLIST_KEYS,
  DOMAIN_KEYS,
  INSTRUMENT_ITEM_KEYS,
  type DomainKey,
  type InstrumentItemKey,
} from '../keys';
import { DOMAINS, type DomainDef } from './domains';
import { GAD7_ITEMS } from './gad7';
import { ANSWER_OPTIONS } from './options';
import { PHQ9_ITEMS, type InstrumentItemDef } from './phq9';
import { isCounted, type ChecklistItemLike } from './scoring';

const INSTRUMENT_SET: ReadonlySet<string> = new Set(INSTRUMENT_ITEM_KEYS);
const DOMAIN_SET: ReadonlySet<string> = new Set(DOMAIN_KEYS);

export function itemDef(key: InstrumentItemKey): InstrumentItemDef {
  const def = [...PHQ9_ITEMS, ...GAD7_ITEMS].find((d) => d.key === key);
  if (!def) throw new RangeError(`Unknown instrument item ${key}`);
  return def;
}

export function domainDef(key: DomainKey): DomainDef {
  const def = DOMAINS.find((d) => d.key === key);
  if (!def) throw new RangeError(`Unknown domain ${key}`);
  return def;
}

export function isCovered(item: ChecklistItemLike): boolean {
  if (item.status === 'declined') return true;
  if (INSTRUMENT_SET.has(item.key)) return isCounted(item);
  return item.status === 'answered';
}

export function needsConfirmation(
  item: ChecklistItemLike | undefined,
  key: InstrumentItemKey,
): boolean {
  if (!item || item.key !== key) return false;
  return !isCovered(item) && item.status !== 'declined';
}

export function computeProgress(items: ChecklistItemLike[]): ProgressDto {
  const byKey = new Map(items.map((i) => [i.key, i]));
  const isKeyCovered = (k: string): boolean => {
    const it = byKey.get(k as ChecklistItemLike['key']);
    return !!it && isCovered(it);
  };
  const total = CHECKLIST_KEYS.length;
  const covered = CHECKLIST_KEYS.filter(isKeyCovered).length;
  const requiredDomains = new Set(DOMAINS.filter((d) => d.required).map((d) => d.key as string));
  const missingRequired = CHECKLIST_KEYS.filter(
    (k) => (INSTRUMENT_SET.has(k) || requiredDomains.has(k)) && !isKeyCovered(k),
  );
  return {
    covered,
    total,
    percent: Math.round((covered / total) * 100),
    missingRequired,
    canFinish: missingRequired.length === 0,
  };
}

export function pendingItemFor(key: InstrumentItemKey): PendingItemDto {
  return {
    key,
    prompt: itemDef(key).confirmPrompt,
    options: ANSWER_OPTIONS.map((o) => ({ ...o })),
  };
}

export function mergeChecklistUpdate(
  existing: ChecklistItemLike | undefined,
  update: TrackerOutput['updates'][number],
): ChecklistItemLike | null {
  if (existing?.source === 'patient_tap') return null;
  if (
    !(update.confidence >= 0 && update.confidence <= 1) ||
    !update.turnIds ||
    update.turnIds.length === 0
  ) {
    return null;
  }
  let status = update.status;
  let value: number | null = update.value;
  let note = update.note ?? null;
  if (INSTRUMENT_SET.has(update.key)) {
    if (status === 'answered' && value === null) status = 'partial';
  } else if (DOMAIN_SET.has(update.key)) {
    value = null;
  }
  if (note !== null && note.length > 200) note = note.slice(0, 200);
  const turnIds = [...new Set([...(existing?.turnIds ?? []), ...update.turnIds])].sort(
    (a, b) => a - b,
  );
  return {
    key: update.key,
    status,
    value,
    confidence: update.confidence,
    note,
    turnIds,
    source: 'tracker',
  };
}

export function isPhq9Item9Positive(items: ChecklistItemLike[]): boolean {
  const it = items.find((i) => i.key === 'phq9_9');
  return isCounted(it) && it.value >= 1;
}
