import { describe, expect, it } from 'vitest';
import { ROLE_SETTINGS, thinkingParams } from './config';
import { LlmUnavailableError } from './types';
import { chatBody, makeLive, testConfig } from './test-utils';

const msgs = [{ role: 'user' as const, content: 'SECRET-PROMPT-TEXT hello' }];

describe('live client', () => {
  it('should send model, temperature, max_tokens from role defaults and allow per-call overrides', async () => {
    const { client, requests, config } = makeLive([
      { status: 200, body: chatBody('hi') },
      { status: 200, body: chatBody('hi') },
    ]);
    const r = await client.complete('tracker', { messages: msgs });
    expect(r).toEqual({ text: 'hi', model: config.models.tracker });
    expect(requests[0]).toMatchObject({
      model: 'gpt-oss',
      temperature: ROLE_SETTINGS.tracker.temperature,
      max_tokens: ROLE_SETTINGS.tracker.maxTokens,
    });
    await client.complete('tracker', { messages: msgs, temperature: 0.9, maxTokens: 50 });
    expect(requests[1]).toMatchObject({ temperature: 0.9, max_tokens: 50 });
  });

  it('should send chat_template_kwargs.enable_thinking=false for qwen3-small with thinking off; reasoning_effort for gpt-oss', async () => {
    const { client, requests } = makeLive([
      { status: 200, body: chatBody('a') },
      { status: 200, body: chatBody('b') },
    ]);
    await client.complete('interviewer', { messages: msgs });
    expect(requests[0].model).toBe('qwen3-small');
    expect(requests[0].chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(requests[0].reasoning_effort).toBeUndefined();
    await client.complete('tracker', { messages: msgs });
    expect(requests[1].reasoning_effort).toBe('low');
    expect(requests[1].chat_template_kwargs).toBeUndefined();
    expect(thinkingParams('gpt-oss', 'off')).toEqual({ reasoning_effort: 'low' });
    expect(thinkingParams('qwen3', 'medium')).toEqual({
      chat_template_kwargs: { enable_thinking: true },
      reasoning_effort: 'medium',
    });
  });

  it('should include cache_salt when provided and omit it otherwise', async () => {
    const { client, requests } = makeLive([
      { status: 200, body: chatBody('a') },
      { status: 200, body: chatBody('b') },
    ]);
    await client.complete('safety', { messages: msgs, cacheSalt: 'c2FsdA==' });
    await client.complete('safety', { messages: msgs });
    expect(requests[0].cache_salt).toBe('c2FsdA==');
    expect('cache_salt' in requests[1]).toBe(false);
  });

  it('should strip <think>…</think> from text', async () => {
    const { client } = makeLive([
      { status: 200, body: chatBody('<think>secret\nreasoning</think>\n\n  Hello there. ') },
    ]);
    expect((await client.complete('assistant', { messages: msgs })).text).toBe('Hello there.');
  });

  it('should retry on 429 then succeed (2 calls), using injected sleep (no real waiting)', async () => {
    const { client, requests, sleeps } = makeLive([
      { status: 429, body: { error: { message: 'slow down' } } },
      { status: 200, body: chatBody('ok') },
    ]);
    const r = await client.complete('assistant', { messages: msgs });
    expect(r.text).toBe('ok');
    expect(requests).toHaveLength(2);
    expect(sleeps).toEqual([300]);
  });

  it('should not retry on 401 and go straight to fallback model', async () => {
    const { client, requests, sleeps } = makeLive([
      { status: 401, body: { error: { message: 'bad key' } } },
      { status: 200, body: chatBody('fb') },
    ]);
    const r = await client.complete('assistant', { messages: msgs });
    expect(requests.map((q) => q.model)).toEqual(['qwen3', 'service']);
    expect(sleeps).toEqual([]);
    expect(r).toEqual({ text: 'fb', model: 'service' });
  });

  it('should use fallback model after 3 failures and report fallback model name in result', async () => {
    const { client, requests, sleeps } = makeLive([
      { status: 503 },
      { status: 500 },
      { status: 502 },
      { status: 200, body: chatBody('from fallback') },
    ]);
    const r = await client.complete('verifier', { messages: msgs });
    expect(requests.map((q) => q.model)).toEqual(['gpt-oss', 'gpt-oss', 'gpt-oss', 'service']);
    expect(sleeps).toEqual([300, 900]);
    expect(r.model).toBe('service');
  });

  it('should throw LlmUnavailableError when primary and fallback fail; message must not contain prompt text', async () => {
    const { client } = makeLive([
      { status: 500 },
      { status: 500 },
      { status: 500 },
      { status: 500 },
    ]);
    const err = await client.complete('verifier', { messages: msgs }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmUnavailableError);
    expect(err.code).toBe('LLM_UNAVAILABLE');
    expect(err.status).toBe(503);
    expect(err.message).toContain('verifier');
    expect(err.message).not.toContain('SECRET-PROMPT-TEXT');
  });

  it('should skip fallback when it equals the primary model', async () => {
    const { client, requests } = makeLive(
      [{ status: 400 }],
      testConfig({ MODEL_FALLBACK: 'qwen3' }),
    );
    await expect(client.complete('assistant', { messages: msgs })).rejects.toBeInstanceOf(
      LlmUnavailableError,
    );
    expect(requests).toHaveLength(1);
  });

  it('should time out using timeoutMs (aborting a never-resolving transport)', async () => {
    const { client, requests, sleeps } = makeLive([
      { hang: true },
      { hang: true },
      { hang: true },
      { hang: true },
    ]);
    await expect(
      client.complete('safety', { messages: msgs, timeoutMs: 15 }),
    ).rejects.toBeInstanceOf(LlmUnavailableError);
    expect(requests).toHaveLength(4); // 3 primary + 1 fallback, each timed out
    expect(sleeps).toEqual([300, 900]);
  });

  it('should never log message content (spy on logger; assert no prompt substring in any log meta)', async () => {
    const { client, logs } = makeLive([
      { status: 500, body: { error: { message: 'echo SECRET-PROMPT-TEXT' } } },
      { status: 200, body: chatBody('RESPONSE-BODY-TEXT') },
    ]);
    await client.complete('assistant', { messages: msgs });
    expect(logs.length).toBe(2);
    const dump = JSON.stringify(logs);
    expect(dump).not.toContain('SECRET-PROMPT-TEXT');
    expect(dump).not.toContain('RESPONSE-BODY-TEXT');
    expect(logs[1]!.meta).toMatchObject({
      role: 'assistant',
      model: 'qwen3',
      ok: true,
      attempt: 2,
      promptTokens: 5,
      completionTokens: 7,
    });
    expect(logs[0]!.meta).toMatchObject({ ok: false, attempt: 1 });
  });
});
