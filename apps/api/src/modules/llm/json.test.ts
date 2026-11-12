import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SafetyClassifierOutputSchema } from '@pvc/shared';
import { extractJson } from './json';
import { LlmUnavailableError } from './types';
import { chatBody, makeLive } from './test-utils';

const msgs = [{ role: 'user' as const, content: 'classify' }];
const good = { level: 'none', categories: [], evidence: '' };

describe('extractJson', () => {
  it('should handle fenced JSON, leading prose, trailing prose', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Sure! Here you go: {"a":{"b":2}}')).toEqual({ a: { b: 2 } });
    expect(extractJson('{"a":1}\nHope that helps {really}')).toEqual({ a: 1 });
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
    expect(() => extractJson('nothing here')).toThrow();
  });
});

describe('completeJson', () => {
  it('should validate and return typed data', async () => {
    const { client, requests } = makeLive([
      { status: 200, body: chatBody('```json\n' + JSON.stringify(good) + '\n```') },
    ]);
    const r = await client.completeJson('safety', {
      messages: msgs,
      schema: SafetyClassifierOutputSchema,
    });
    expect(r.data).toEqual(good);
    expect(r.model).toBe('gemma');
    expect(requests[0].response_format).toEqual({ type: 'json_object' });
  });

  it('should perform one repair round-trip on invalid output and succeed', async () => {
    const { client, requests } = makeLive([
      { status: 200, body: chatBody('{"level":"banana"}') },
      { status: 200, body: chatBody(JSON.stringify(good)) },
    ]);
    const r = await client.completeJson('safety', {
      messages: msgs,
      schema: SafetyClassifierOutputSchema,
    });
    expect(r.data).toEqual(good);
    expect(requests).toHaveLength(2);
    const m = requests[1].messages;
    expect(m.at(-2)).toEqual({ role: 'assistant', content: '{"level":"banana"}' });
    expect(m.at(-1).role).toBe('user');
    expect(m.at(-1).content).toMatch(/^Your previous reply was not valid\. Errors: .*level/);
    expect(m.at(-1).content).toMatch(/Reply with corrected JSON only\.$/);
  });

  it('should throw after failed repair', async () => {
    const { client } = makeLive([
      { status: 200, body: chatBody('nope') },
      { status: 200, body: chatBody('{"still":"bad"}') },
    ]);
    const err = await client
      .completeJson('safety', { messages: msgs, schema: SafetyClassifierOutputSchema })
      .catch((e) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect(err.message).toBe('invalid structured output for role safety');
  });

  it('should retry without response_format when the server rejects it with 400', async () => {
    const { client, requests } = makeLive([
      { status: 400, body: { error: { message: 'response_format unsupported' } } },
      { status: 200, body: chatBody('{"x":1}') },
    ]);
    const r = await client.completeJson('tracker', {
      messages: msgs,
      schema: z.object({ x: z.number() }),
    });
    expect(r.data).toEqual({ x: 1 });
    expect(r.model).toBe('gpt-oss');
    expect(requests).toHaveLength(2);
    expect(requests[0].response_format).toBeDefined();
    expect('response_format' in requests[1]).toBe(false);
  });
});
