import { describe, expect, it } from 'vitest';
import { buildInstrumentResult } from './fixtures';

describe('fixtures', () => {
  it('should build a complete PHQ-9 with total 9 for all 1s', () => {
    const r = buildInstrumentResult('phq9', Array(9).fill(1));
    expect(r.complete).toBe(true);
    expect(r.total).toBe(9);
    expect(r.answeredCount).toBe(9);
  });
  it('should give null total and correct partialSum with one null', () => {
    const r = buildInstrumentResult('phq9', [1, 1, 1, 1, 1, 1, 1, 1, null]);
    expect(r.total).toBeNull();
    expect(r.complete).toBe(false);
    expect(r.partialSum).toBe(8);
    expect(r.items[8]?.status).toBe('missing');
  });
  it('should build GAD-7 with 7 items', () => {
    expect(buildInstrumentResult('gad7').items).toHaveLength(7);
  });
});
