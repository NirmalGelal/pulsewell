import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MockLlmClient } from './mock-client';
import { LlmUnavailableError, type LlmCallOptions } from './types';

const msgs = [{ role: 'user' as const, content: 'hi' }];

describe('MockLlmClient', () => {
  it('should apply once before on, with handler functions and values', async () => {
    const m = new MockLlmClient().on('assistant', 'persistent').once('assistant', 'first');
    m.once('assistant', (o: LlmCallOptions) => `echo:${o.messages[0]!.content}`);
    expect((await m.complete('assistant', { messages: msgs })).text).toBe('first');
    expect((await m.complete('assistant', { messages: msgs })).text).toBe('echo:hi');
    const r = await m.complete('assistant', { messages: msgs });
    expect(r).toEqual({ text: 'persistent', model: 'mock-assistant' });
  });

  it('should fail(n) the next n calls with LlmUnavailableError', async () => {
    const m = new MockLlmClient().on('safety', 'ok').fail('safety', 2);
    await expect(m.complete('safety', { messages: msgs })).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
    await expect(m.complete('safety', { messages: msgs })).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
    expect((await m.complete('safety', { messages: msgs })).text).toBe('ok');
  });

  it('should throw for an unmocked role', async () => {
    const m = new MockLlmClient();
    await expect(m.complete('tracker', { messages: msgs })).rejects.toThrow(
      'MockLlmClient: no handler for role "tracker"',
    );
  });

  it('should validate completeJson fixtures with the schema and record calls', async () => {
    const m = new MockLlmClient().on('tracker', { x: 1 });
    const schema = z.object({ x: z.number() });
    expect((await m.completeJson('tracker', { messages: msgs, schema })).data).toEqual({ x: 1 });
    m.on('tracker', { x: 'bad' });
    await expect(m.completeJson('tracker', { messages: msgs, schema })).rejects.toThrow();
    expect(m.calls.map((c) => [c.role, c.method])).toEqual([
      ['tracker', 'completeJson'],
      ['tracker', 'completeJson'],
    ]);
    m.reset();
    expect(m.calls).toEqual([]);
  });

  it('should stream strings split on spaces, string[] as chunks, and transcribe via stt', async () => {
    const m = new MockLlmClient()
      .on('interviewer', 'Hello big world')
      .once('interviewer', ['a', 'b']);
    const collect = async (s: AsyncIterable<string>) => {
      const o: string[] = [];
      for await (const c of s) o.push(c);
      return o;
    };
    const s1 = m.stream('interviewer', { messages: msgs });
    expect(await collect(s1)).toEqual(['a', 'b']);
    expect((await s1.result).text).toBe('ab');
    const s2 = m.stream('interviewer', { messages: msgs });
    expect(await collect(s2)).toEqual(['Hello ', 'big ', 'world']);
    expect((await s2.result).text).toBe('Hello big world');
    m.on('stt', 'transcribed');
    expect(await m.transcribe(Buffer.from('x'), 'audio/wav')).toEqual({
      text: 'transcribed',
      model: 'mock-stt',
    });
  });
});
