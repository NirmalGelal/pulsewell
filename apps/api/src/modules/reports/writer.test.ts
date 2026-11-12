import { describe, expect, it } from 'vitest';
import { WriterOutputSchema } from '@pvc/shared';
import { createTestContext } from '../../test/context';
import { MockLlmClient } from '../llm/mock-client';
import { normalizeWriterOutput, runWriter, type TurnMessage } from './writer';

const msgs: TurnMessage[] = [
  { turnId: 1, sender: 'COMPANION', text: 'Hi, what brings you in?' },
  { turnId: 2, sender: 'PATIENT', text: 'I feel low and tired.' },
  { turnId: 3, sender: 'COMPANION', text: 'Tell me more.' },
  { turnId: 4, sender: 'PATIENT', text: 'My old doctor gave a diagnosis of depression.' },
];
const item = (text: string, turnIds: number[], patientText = 'You said so.') => ({
  text,
  patientText,
  turnIds,
});
const parse = (o: unknown) => WriterOutputSchema.parse(o);
const empty = { priorities: [], summary: {}, quotes: [], notDiscussed: [] };

describe('normalizeWriterOutput', () => {
  it('should assign ids and filter non-patient or unknown turn ids', () => {
    const n = normalizeWriterOutput(
      parse({
        ...empty,
        priorities: [item('Wants sleep help.', [4, 2, 2])],
        summary: {
          moodAnxiety: [item('Reports low mood.', [1, 2, 99]), item('Reports tiredness.', [2])],
        },
      }),
      msgs,
    );
    expect(n.priorities[0]).toMatchObject({ id: 'priorities-1', turnIds: [2, 4] });
    expect(n.summary.moodAnxiety.map((i) => i.id)).toEqual(['moodAnxiety-1', 'moodAnxiety-2']);
    expect(n.summary.moodAnxiety[0]!.turnIds).toEqual([2]);
    expect(n.summary.history).toEqual([]);
  });

  it('should drop and count items without valid patient turns or text', () => {
    const n = normalizeWriterOutput(
      parse({
        ...empty,
        summary: {
          moodAnxiety: [
            item('Reports X.', [1]),
            item('Reports Y.', [99]),
            item('  ', [2]),
            item('Ok.', [2], ' '),
          ],
        },
      }),
      msgs,
    );
    expect(n.summary.moodAnxiety).toEqual([]);
    expect(n.claimsRemoved).toBe(4);
  });

  it('should enforce caps', () => {
    const many = Array.from({ length: 9 }, (_, i) => item(`Reports ${i}.`, [2]));
    const n = normalizeWriterOutput(
      parse({
        ...empty,
        priorities: many,
        summary: { history: many },
        quotes: Array.from({ length: 9 }, () => ({ text: 'I feel low', turnId: 2 })),
      }),
      msgs,
    );
    expect(n.priorities).toHaveLength(3);
    expect(n.summary.history).toHaveLength(6);
    expect(n.quotes).toHaveLength(6);
  });

  it('should drop banned phrases unless the patient said "diagnos"', () => {
    const n = normalizeWriterOutput(
      parse({
        ...empty,
        summary: {
          moodAnxiety: [item('Presentation is suggestive of depression.', [2])],
          history: [item('Reports a diagnosis of depression.', [4])],
        },
      }),
      msgs,
    );
    expect(n.summary.moodAnxiety).toEqual([]);
    expect(n.summary.history).toHaveLength(1);
    expect(n.claimsRemoved).toBe(1);
  });
});

describe('runWriter', () => {
  it('should send a TRANSCRIPT block, tracker notes, thinking medium and the cache salt', async () => {
    const llm = new MockLlmClient().on('reportWriter', empty);
    const ctx = await createTestContext({ llm });
    const { model } = await runWriter(ctx.deps, {
      messages: msgs,
      cacheSalt: 'salt-1',
      checklist: [
        {
          key: 'mood_anxiety',
          status: 'answered',
          value: null,
          confidence: 0.9,
          note: 'Low mood.',
          turnIds: [2],
          source: 'tracker',
        },
      ],
    });
    expect(model).toBe('mock-reportWriter');
    const call = llm.calls[0]!;
    expect(call.opts.cacheSalt).toBe('salt-1');
    expect(call.opts.thinking).toBe('medium');
    const user = call.opts.messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('TRANSCRIPT:');
    expect(user).toContain('TRACKER NOTES:\nmood_anxiety: Low mood.');
  });

  it('should append regeneration feedback', async () => {
    const llm = new MockLlmClient().on('reportWriter', empty);
    const ctx = await createTestContext({ llm });
    await runWriter(ctx.deps, {
      messages: msgs,
      checklist: [],
      cacheSalt: 's',
      feedback: [{ itemId: 'history-1', text: 'Reports X.', reason: 'not said' }],
    });
    expect(llm.calls[0]!.opts.messages[1]!.content).toContain('history-1: Reports X. — not said');
  });
});
