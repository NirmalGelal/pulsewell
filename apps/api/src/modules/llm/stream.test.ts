import { describe, expect, it } from 'vitest';
import { LlmUnavailableError } from './types';
import { ThinkStripper } from './think';
import { makeLive, sseChunk, chatBody } from './test-utils';

const msgs = [{ role: 'user' as const, content: 'hi' }];

async function collect(it: AsyncIterable<string>) {
  const out: string[] = [];
  for await (const c of it) out.push(c);
  return out;
}

describe('stream', () => {
  it('should yield chunks and resolve result with full text', async () => {
    const { client, requests } = makeLive([
      { sse: [sseChunk(''), sseChunk('Hello'), sseChunk(' wor'), sseChunk('ld.')] },
    ]);
    const s = client.stream('interviewer', { messages: msgs });
    expect(await collect(s)).toEqual(['Hello', ' wor', 'ld.']);
    expect(await s.result).toEqual({ text: 'Hello world.', model: 'qwen3-small' });
    expect(requests[0].stream).toBe(true);
  });

  it('should strip think blocks split across chunks', async () => {
    const { client } = makeLive([
      {
        sse: [
          '<th',
          'ink>plan',
          ' it</thi',
          'nk>\n\nHi ',
          'there',
          ' <think>x</think>friend\n',
        ].map(sseChunk),
      },
    ]);
    const s = client.stream('interviewer', { messages: msgs });
    const chunks = await collect(s);
    expect(chunks.join('')).toBe('Hi there friend');
    expect(chunks.join('')).not.toContain('think');
    expect((await s.result).text).toBe('Hi there friend');
  });

  it('should fall back when failure happens before first chunk', async () => {
    const { client, requests } = makeLive([{ status: 401 }, { sse: [sseChunk('fallback reply')] }]);
    const s = client.stream('interviewer', { messages: msgs });
    expect((await collect(s)).join('')).toBe('fallback reply');
    expect(requests.map((r) => r.model)).toEqual(['qwen3-small', 'service']);
    expect((await s.result).model).toBe('service');
  });

  it('should throw from iterator when failure happens mid-stream, and result rejects', async () => {
    const { client } = makeLive([
      { sse: [sseChunk('partial '), sseChunk('text')], errorAfter: true },
    ]);
    const s = client.stream('interviewer', { messages: msgs });
    const got: string[] = [];
    const err = await (async () => {
      try {
        for await (const c of s) got.push(c);
      } catch (e) {
        return e;
      }
    })();
    expect(got.length).toBeGreaterThan(0);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    await expect(s.result).rejects.toBeInstanceOf(LlmUnavailableError);
  });

  it('should throw LlmUnavailableError when all attempts fail before first chunk', async () => {
    const { client } = makeLive([
      { status: 500 },
      { status: 500 },
      { status: 500 },
      { status: 500 },
    ]);
    const s = client.stream('interviewer', { messages: msgs });
    await expect(collect(s)).rejects.toBeInstanceOf(LlmUnavailableError);
    await expect(s.result).rejects.toBeInstanceOf(LlmUnavailableError);
  });
});

describe('ThinkStripper', () => {
  it('should handle a close tag with no opening tag and keep clean text intact', () => {
    const t = new ThinkStripper();
    expect(t.push('reasoning here</think>Answer') + t.flush()).toBe('Answer');
    void chatBody;
  });
});
