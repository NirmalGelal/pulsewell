import { describe, expect, it } from 'vitest';
import { buildEvidenceItem } from '@pvc/shared';
import { createTestContext } from '../../test/context';
import { MockLlmClient } from '../llm/mock-client';
import { runVerifier } from './verifier';
import type { TurnMessage } from './writer';

const messages: TurnMessage[] = [{ turnId: 2, sender: 'PATIENT', text: 'I feel low.' }];
const items = [
  buildEvidenceItem({ id: 'moodAnxiety-1', turnIds: [2] }),
  buildEvidenceItem({ id: 'history-1', turnIds: [2] }),
];

describe('runVerifier', () => {
  it('should return unsupported ids and ignore unknown ones', async () => {
    const llm = new MockLlmClient().on('verifier', {
      unsupported: [
        { itemId: 'history-1', reason: 'adds a fact' },
        { itemId: 'nope-9', reason: 'unknown' },
      ],
    });
    const ctx = await createTestContext({ llm });
    const r = await runVerifier(ctx.deps, { messages, items, cacheSalt: 's' });
    expect(r.unsupported).toEqual([{ itemId: 'history-1', reason: 'adds a fact' }]);
    expect(r.model).toBe('mock-verifier');
    const user = llm.calls[0]!.opts.messages[1]!.content;
    expect(user).toContain('TRANSCRIPT:');
    expect(user).toContain('STATEMENTS:\nmoodAnxiety-1 [T2]:');
    expect(llm.calls[0]!.opts.cacheSalt).toBe('s');
  });

  it('should skip verification with a null model when the verifier fails', async () => {
    const llm = new MockLlmClient().fail('verifier', 1);
    const ctx = await createTestContext({ llm });
    const r = await runVerifier(ctx.deps, { messages, items, cacheSalt: 's' });
    expect(r).toEqual({ unsupported: [], model: null });
  });
});
