import { describe, expect, it } from 'vitest';
import { INSTRUMENT_ITEM_KEYS } from '../keys';
import {
  computeProgress,
  isCovered,
  isPhq9Item9Positive,
  mergeChecklistUpdate,
  needsConfirmation,
  pendingItemFor,
} from './coverage';
import type { ChecklistItemLike } from './scoring';

const mk = (
  key: ChecklistItemLike['key'],
  o: Partial<ChecklistItemLike> = {},
): ChecklistItemLike => ({
  key,
  status: 'answered',
  value: 1,
  confidence: 0.9,
  source: 'tracker',
  turnIds: [1],
  ...o,
});
const upd = (o: Record<string, unknown> = {}) =>
  ({
    key: 'phq9_1',
    status: 'answered',
    value: 1,
    confidence: 0.9,
    note: null,
    turnIds: [3],
    ...o,
  }) as Parameters<typeof mergeChecklistUpdate>[1];

describe('computeProgress', () => {
  it('empty', () => {
    const p = computeProgress([]);
    expect(p).toMatchObject({ covered: 0, total: 26, percent: 0, canFinish: false });
    expect(p.missingRequired).toEqual([...INSTRUMENT_ITEM_KEYS, 'chief_concern', 'priorities']);
  });
  it('canFinish with required only', () => {
    const items = [
      ...INSTRUMENT_ITEM_KEYS.map((k) => mk(k)),
      mk('chief_concern', { value: null }),
      mk('priorities', { value: null }),
    ];
    const p = computeProgress(items);
    expect(p.canFinish).toBe(true);
    expect(p.covered).toBe(18);
    expect(p.percent).toBe(69);
  });
  it('declined counts as covered', () => {
    expect(computeProgress([mk('phq9_9', { status: 'declined', value: null })]).covered).toBe(1);
    expect(isCovered(mk('history', { status: 'partial', value: null }))).toBe(false);
  });
});

describe('needsConfirmation', () => {
  it('works', () => {
    expect(needsConfirmation(mk('phq9_1', { status: 'partial', value: null }), 'phq9_1')).toBe(
      true,
    );
    expect(needsConfirmation(mk('phq9_1', { confidence: 0.3 }), 'phq9_1')).toBe(true);
    expect(needsConfirmation(mk('phq9_1', { status: 'declined', value: null }), 'phq9_1')).toBe(
      false,
    );
    expect(
      needsConfirmation(mk('phq9_1', { source: 'patient_tap', confidence: 0.1 }), 'phq9_1'),
    ).toBe(false);
    expect(needsConfirmation(undefined, 'phq9_1')).toBe(false);
  });
});

describe('pendingItemFor', () => {
  it('has prompt and options', () => {
    const p = pendingItemFor('gad7_2');
    expect(p.prompt).toContain('control worrying');
    expect(p.options.map((o) => o.value)).toEqual([0, 1, 2, 3]);
  });
});

describe('mergeChecklistUpdate', () => {
  it('never overwrites patient_tap', () => {
    expect(mergeChecklistUpdate(mk('phq9_1', { source: 'patient_tap' }), upd())).toBeNull();
  });
  it('answered+null -> partial', () => {
    expect(mergeChecklistUpdate(undefined, upd({ value: null }))?.status).toBe('partial');
  });
  it('domain value forced null, note truncated', () => {
    const r = mergeChecklistUpdate(
      undefined,
      upd({ key: 'history', value: 2, note: 'x'.repeat(300) }),
    );
    expect(r?.value).toBeNull();
    expect(r?.note).toHaveLength(200);
  });
  it('unions turnIds sorted unique and sets source', () => {
    const r = mergeChecklistUpdate(mk('phq9_1', { turnIds: [5, 1] }), upd({ turnIds: [3, 1] }));
    expect(r?.turnIds).toEqual([1, 3, 5]);
    expect(r?.source).toBe('tracker');
  });
  it('ignores invalid confidence and empty turnIds', () => {
    expect(mergeChecklistUpdate(undefined, upd({ confidence: 1.5 }))).toBeNull();
    expect(mergeChecklistUpdate(undefined, upd({ confidence: -0.1 }))).toBeNull();
    expect(mergeChecklistUpdate(undefined, upd({ turnIds: [] }))).toBeNull();
  });
});

describe('isPhq9Item9Positive', () => {
  it('works', () => {
    for (const v of [1, 2, 3]) expect(isPhq9Item9Positive([mk('phq9_9', { value: v })])).toBe(true);
    expect(isPhq9Item9Positive([mk('phq9_9', { value: 0 })])).toBe(false);
    expect(isPhq9Item9Positive([mk('phq9_9', { status: 'partial', value: null })])).toBe(false);
    expect(isPhq9Item9Positive([mk('phq9_9', { value: 2, confidence: 0.2 })])).toBe(false);
    expect(isPhq9Item9Positive([])).toBe(false);
  });
});
