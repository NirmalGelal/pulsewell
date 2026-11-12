import type { ChecklistSource, ItemStatus, SeverityBand } from '../enums';
import { GAD7_KEYS, PHQ9_KEYS, type ChecklistKey, type InstrumentItemKey } from '../keys';
import type { InstrumentItemResult, InstrumentResult } from '../schemas/report';
import { CONFIDENCE_THRESHOLD } from './options';

function checkTotal(total: number, max: number): void {
  if (!Number.isInteger(total) || total < 0 || total > max) {
    throw new RangeError(`Score ${total} out of range 0..${max}`);
  }
}

export function phq9Band(total: number): SeverityBand {
  checkTotal(total, 27);
  if (total <= 4) return 'minimal';
  if (total <= 9) return 'mild';
  if (total <= 14) return 'moderate';
  if (total <= 19) return 'moderately_severe';
  return 'severe';
}

export function gad7Band(total: number): SeverityBand {
  checkTotal(total, 21);
  if (total <= 4) return 'minimal';
  if (total <= 9) return 'mild';
  if (total <= 14) return 'moderate';
  return 'severe';
}

export interface ChecklistItemLike {
  key: ChecklistKey;
  status: ItemStatus;
  value: number | null;
  confidence: number;
  source: ChecklistSource;
  turnIds: number[];
  note?: string | null;
}

/** True when an instrument item has a countable value. */
export function isCounted(item: ChecklistItemLike | undefined): item is ChecklistItemLike & {
  value: 0 | 1 | 2 | 3;
} {
  return (
    !!item &&
    item.status === 'answered' &&
    item.value !== null &&
    Number.isInteger(item.value) &&
    item.value >= 0 &&
    item.value <= 3 &&
    (item.source === 'patient_tap' || item.confidence >= CONFIDENCE_THRESHOLD)
  );
}

export function scoreInstrument(
  kind: 'phq9' | 'gad7',
  items: ChecklistItemLike[],
): InstrumentResult {
  const keys: readonly InstrumentItemKey[] = kind === 'phq9' ? PHQ9_KEYS : GAD7_KEYS;
  let partialSum = 0;
  let answeredCount = 0;
  const results: InstrumentItemResult[] = keys.map((key) => {
    const item = items.find((i) => i.key === key);
    if (!item) return { key, value: null, status: 'missing' };
    if (isCounted(item)) {
      partialSum += item.value;
      answeredCount += 1;
      return { key, value: item.value, status: 'answered' };
    }
    if (item.status === 'declined') return { key, value: null, status: 'declined' };
    return { key, value: null, status: 'partial' };
  });
  const complete = answeredCount === keys.length;
  const total = complete ? partialSum : null;
  const band = total === null ? null : kind === 'phq9' ? phq9Band(total) : gad7Band(total);
  return { items: results, answeredCount, total, partialSum, complete, band };
}

const RANGES: Record<'phq9' | 'gad7', Record<SeverityBand, string>> = {
  phq9: {
    minimal: '0–4',
    mild: '5–9',
    moderate: '10–14',
    moderately_severe: '15–19',
    severe: '20–27',
  },
  gad7: {
    minimal: '0–4',
    mild: '5–9',
    moderate: '10–14',
    moderately_severe: '15–21',
    severe: '15–21',
  },
};

const BAND_WORD: Record<SeverityBand, string> = {
  minimal: 'Minimal',
  mild: 'Mild',
  moderate: 'Moderate',
  moderately_severe: 'Moderately severe',
  severe: 'Severe',
};

export function describeBand(
  kind: 'phq9' | 'gad7',
  band: SeverityBand,
): { clinical: string; plain: string } {
  const what = kind === 'phq9' ? 'depressive' : 'anxiety';
  const name = kind === 'phq9' ? 'PHQ-9' : 'GAD-7';
  const clinical = `${BAND_WORD[band]} ${what} symptom severity (${name} ${RANGES[kind][band]})`;
  const label = band.replace('_', ' ');
  let tail = '';
  if (band === 'mild') tail = ' You may want to mention this to your clinician.';
  else if (band === 'moderate') tail = " That's worth talking through with your clinician.";
  else if (band === 'moderately_severe')
    tail = ' Your clinician will want to talk about this with you.';
  else if (band === 'severe') tail = ' Your clinician will want to talk about this with you soon.';
  return { clinical, plain: `Your answers fall in the ${label} range.${tail}` };
}
