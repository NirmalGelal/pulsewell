import { describe, expect, it } from 'vitest';
import { SEVERITY_BANDS } from '../enums';
import { describeBand } from './scoring';

describe('describeBand', () => {
  it('returns safe strings for every band and kind', () => {
    for (const kind of ['phq9', 'gad7'] as const) {
      for (const band of SEVERITY_BANDS) {
        const d = describeBand(kind, band);
        expect(d.clinical.length).toBeGreaterThan(0);
        expect(d.plain.length).toBeGreaterThan(0);
        for (const w of ['you have', 'diagnos', 'disorder']) {
          expect(d.plain.toLowerCase()).not.toContain(w);
        }
      }
    }
  });
  it('matches spec examples', () => {
    expect(describeBand('phq9', 'moderate').clinical).toBe(
      'Moderate depressive symptom severity (PHQ-9 10–14)',
    );
    expect(describeBand('gad7', 'mild').clinical).toBe('Mild anxiety symptom severity (GAD-7 5–9)');
    expect(describeBand('phq9', 'minimal').plain).toBe('Your answers fall in the minimal range.');
    expect(describeBand('gad7', 'moderate').plain).toBe(
      "Your answers fall in the moderate range. That's worth talking through with your clinician.",
    );
  });
});
