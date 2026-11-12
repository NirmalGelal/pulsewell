import { describe, expect, it } from 'vitest';
import { RISK_LEVELS, maxRisk, riskRank } from './enums';

describe('enums', () => {
  it('should order risk levels', () => {
    expect(RISK_LEVELS.map(riskRank)).toEqual([0, 1, 2, 3]);
    expect(riskRank('imminent')).toBeGreaterThan(riskRank('elevated'));
  });
  it('should return highest level from maxRisk', () => {
    expect(maxRisk('none', 'elevated', 'concern')).toBe('elevated');
    expect(maxRisk('imminent', 'none')).toBe('imminent');
  });
  it('should return none for empty input', () => {
    expect(maxRisk()).toBe('none');
  });
});
