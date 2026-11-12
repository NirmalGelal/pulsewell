import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../test/context';
import { MockLlmClient } from '../llm/mock-client';
import { classifyRisk } from './classifier';

describe('classifyRisk', () => {
  it('should call completeJson with role safety, cacheSalt, <=6 recent turns and a PATIENT MESSAGE line', async () => {
    const llm = new MockLlmClient().on('safety', { level: 'none', categories: [], evidence: '' });
    const { deps } = await createTestContext({ llm });
    const recent = Array.from({ length: 8 }, (_, i) => ({
      turnId: i + 1,
      sender: i % 2 ? ('COMPANION' as const) : ('PATIENT' as const),
      text: `line ${i + 1}`,
    }));
    await classifyRisk(deps, { text: 'I feel fine', recent, cacheSalt: 'salt-1' });
    expect(llm.calls).toHaveLength(1);
    const call = llm.calls[0]!;
    expect(call.role).toBe('safety');
    expect(call.method).toBe('completeJson');
    expect(call.opts.cacheSalt).toBe('salt-1');
    const user = call.opts.messages.find((m) => m.role === 'user')!.content;
    expect(user.startsWith('TRANSCRIPT:')).toBe(true);
    expect(user).not.toContain('[T2]');
    expect(user).toContain('[T3] PATIENT: line 3');
    expect(user).toContain('[T8] COMPANION: line 8');
    expect(user.match(/^\[T\d+\]/gm)).toHaveLength(6);
    expect(user).toContain('PATIENT MESSAGE: I feel fine');
    expect(call.opts.messages[0]!.role).toBe('system');
  });

  it('should return parsed output', async () => {
    const llm = new MockLlmClient().on('safety', {
      level: 'elevated',
      categories: ['self_harm'],
      evidence: 'x',
    });
    const { deps } = await createTestContext({ llm });
    await expect(classifyRisk(deps, { text: 'x', recent: [], cacheSalt: 's' })).resolves.toEqual({
      level: 'elevated',
      categories: ['self_harm'],
      evidence: 'x',
    });
  });

  it('should propagate LLM errors', async () => {
    const llm = new MockLlmClient().fail('safety');
    const { deps } = await createTestContext({ llm });
    await expect(classifyRisk(deps, { text: 'x', recent: [], cacheSalt: 's' })).rejects.toThrow();
  });
});
