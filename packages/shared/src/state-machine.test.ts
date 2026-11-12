import { describe, expect, it } from 'vitest';
import { SESSION_STATES } from './enums';
import { SESSION_TRANSITIONS, assertTransition, canTransition } from './state-machine';

describe('state machine', () => {
  const pairs = SESSION_STATES.flatMap((a) => SESSION_STATES.map((b) => [a, b] as const));
  it('should allow every transition listed in SESSION_TRANSITIONS', () => {
    for (const [from, tos] of Object.entries(SESSION_TRANSITIONS)) {
      for (const to of tos) {
        expect(canTransition(from as never, to)).toBe(true);
        expect(() => assertTransition(from as never, to)).not.toThrow();
      }
    }
  });
  it('should reject every pair not listed', () => {
    expect(pairs).toHaveLength(36);
    for (const [from, to] of pairs) {
      if (SESSION_TRANSITIONS[from].includes(to)) continue;
      expect(canTransition(from, to)).toBe(false);
    }
  });
  it('assertTransition should throw with INVALID_TRANSITION', () => {
    expect(() => assertTransition('SUBMITTED', 'INTERVIEWING')).toThrow(/INVALID_TRANSITION/);
  });
});
