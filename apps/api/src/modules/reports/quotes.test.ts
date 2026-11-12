import { describe, expect, it } from 'vitest';
import { checkQuotes } from './quotes';
import type { TurnMessage } from './writer';

const msgs: TurnMessage[] = [
  { turnId: 1, sender: 'COMPANION', text: 'You said "I can’t sleep" earlier.' },
  { turnId: 2, sender: 'PATIENT', text: "I can't sleep at night.  It's   hard." },
  { turnId: 4, sender: 'PATIENT', text: 'Work is overwhelming me.' },
];

describe('checkQuotes', () => {
  it('should keep an exact quote and assign ids', () => {
    const r = checkQuotes([{ text: 'Work is overwhelming me.', turnId: 4 }], msgs);
    expect(r.quotes).toEqual([{ id: 'quote-1', text: 'Work is overwhelming me.', turnId: 4 }]);
    expect(r.quotesRemoved).toBe(0);
  });

  it('should tolerate whitespace and curly quote differences', () => {
    const r = checkQuotes([{ text: 'I can’t sleep at night. It’s hard.', turnId: 2 }], msgs);
    expect(r.quotes).toHaveLength(1);
  });

  it('should drop a quote with a case change', () => {
    const r = checkQuotes([{ text: 'work is overwhelming me.', turnId: 4 }], msgs);
    expect(r.quotes).toHaveLength(0);
    expect(r.quotesRemoved).toBe(1);
  });

  it('should correct the turnId when found in exactly one other patient turn', () => {
    const r = checkQuotes([{ text: 'Work is overwhelming me.', turnId: 2 }], msgs);
    expect(r.quotes[0]!.turnId).toBe(4);
  });

  it('should drop quotes from companion turns', () => {
    const r = checkQuotes(
      [
        { text: 'Hi', turnId: 1 },
        { text: 'You said', turnId: 1 },
      ],
      msgs,
    );
    expect(r.quotes).toHaveLength(0);
    expect(r.quotesRemoved).toBe(2);
  });

  it('should drop duplicates', () => {
    const q = { text: 'Work is overwhelming me.', turnId: 4 };
    const r = checkQuotes([q, q], msgs);
    expect(r.quotes).toHaveLength(1);
    expect(r.quotesRemoved).toBe(1);
  });
});
