import { describe, expect, it } from 'vitest';
import { GAD7_KEYS, PHQ9_KEYS } from '../keys';
import { gad7Band, phq9Band, scoreInstrument, type ChecklistItemLike } from './scoring';

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

describe('bands', () => {
  it('phq9 boundaries', () => {
    const exp: [number, string][] = [
      [0, 'minimal'],
      [4, 'minimal'],
      [5, 'mild'],
      [9, 'mild'],
      [10, 'moderate'],
      [14, 'moderate'],
      [15, 'moderately_severe'],
      [19, 'moderately_severe'],
      [20, 'severe'],
      [27, 'severe'],
    ];
    for (const [t, b] of exp) expect(phq9Band(t)).toBe(b);
    for (const bad of [28, -1, 2.5]) expect(() => phq9Band(bad)).toThrow(RangeError);
  });
  it('gad7 boundaries', () => {
    const exp: [number, string][] = [
      [0, 'minimal'],
      [4, 'minimal'],
      [5, 'mild'],
      [9, 'mild'],
      [10, 'moderate'],
      [14, 'moderate'],
      [15, 'severe'],
      [21, 'severe'],
    ];
    for (const [t, b] of exp) expect(gad7Band(t)).toBe(b);
    expect(() => gad7Band(22)).toThrow(RangeError);
  });
});

describe('scoreInstrument', () => {
  it('complete', () => {
    const r = scoreInstrument(
      'phq9',
      PHQ9_KEYS.map((k) => mk(k, { value: 2 })),
    );
    expect(r).toMatchObject({
      complete: true,
      total: 18,
      band: 'moderately_severe',
      answeredCount: 9,
    });
  });
  it('low confidence is partial', () => {
    const items = GAD7_KEYS.map((k, i) => mk(k, i === 0 ? { confidence: 0.5 } : {}));
    const r = scoreInstrument('gad7', items);
    expect(r).toMatchObject({
      complete: false,
      total: null,
      band: null,
      partialSum: 6,
      answeredCount: 6,
    });
    expect(r.items[0]).toEqual({ key: 'gad7_1', value: null, status: 'partial' });
  });
  it('patient_tap counts at low confidence', () => {
    const r = scoreInstrument('gad7', [
      mk('gad7_1', { source: 'patient_tap', confidence: 0.1, value: 3 }),
    ]);
    expect(r.items[0]).toEqual({ key: 'gad7_1', value: 3, status: 'answered' });
  });
  it('declined and missing', () => {
    const r = scoreInstrument('phq9', [mk('phq9_1', { status: 'declined', value: null })]);
    expect(r.items[0]?.status).toBe('declined');
    expect(r.items[1]?.status).toBe('missing');
    expect(r.complete).toBe(false);
    expect(r.items.map((i) => i.key)).toEqual([...PHQ9_KEYS]);
    expect(scoreInstrument('gad7', []).items).toHaveLength(7);
  });
  it('out-of-range values are not counted', () => {
    const r = scoreInstrument('gad7', [mk('gad7_1', { value: 4 }), mk('gad7_2', { value: -1 })]);
    expect(r.items[0]?.status).toBe('partial');
    expect(r.items[1]?.status).toBe('partial');
    expect(r.partialSum).toBe(0);
  });
});
