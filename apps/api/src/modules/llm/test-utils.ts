import { loadConfig, type AppConfig } from '../../config/env';
import type { Logger } from '../../lib/logger';
import { LiveLlmClient } from './live-client';

export type Step =
  | { status: number; body?: unknown }
  | { sse: string[]; errorAfter?: boolean }
  | { hang: true }
  | ((body: Record<string, unknown>) => Response | Promise<Response>);

export function chatBody(content: string, usage = { prompt_tokens: 5, completion_tokens: 7 }) {
  return {
    id: 'x',
    object: 'chat.completion',
    created: 0,
    model: 'm',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function sseChunk(content: string) {
  return `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 0, model: 'm', choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`;
}

/** Scripted fetch: consumes one step per request; records parsed request bodies. */
export function fakeFetch(steps: Step[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requests: any[] = [];
  const fn = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    requests.push(body);
    const step = steps.shift();
    if (!step) throw new Error('fakeFetch: no more steps');
    if (typeof step === 'function') return step(body);
    if ('hang' in step) {
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () =>
          rej(new DOMException('aborted', 'AbortError')),
        );
      });
    }
    if ('sse' in step) {
      const enc = new TextEncoder();
      let pulled = 0;
      const stream = new ReadableStream({
        pull(c) {
          if (pulled === 0) {
            for (const x of step.sse) c.enqueue(enc.encode(x));
            pulled++;
          } else if (step.errorAfter) c.error(new Error('socket hang up'));
          else {
            c.enqueue(enc.encode('data: [DONE]\n\n'));
            c.close();
          }
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      });
    }
    return json(step.status, step.body ?? {});
  }) as unknown as typeof fetch;
  return { fetch: fn, requests };
}

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
    LLM_MODE: 'live',
    NRP_API_KEY: 'test-key',
    ...overrides,
  });
}

export function spyLogger() {
  const logs: { level: string; msg: string; meta?: Record<string, unknown> }[] = [];
  const logger: Logger = {
    debug: (msg, meta) => logs.push({ level: 'debug', msg, meta }),
    info: (msg, meta) => logs.push({ level: 'info', msg, meta }),
    warn: (msg, meta) => logs.push({ level: 'warn', msg, meta }),
    error: (msg, meta) => logs.push({ level: 'error', msg, meta }),
  };
  return { logger, logs };
}

export function makeLive(steps: Step[], config = testConfig()) {
  const f = fakeFetch(steps);
  const sleeps: number[] = [];
  const { logger, logs } = spyLogger();
  const client = new LiveLlmClient(config, logger, {
    fetch: f.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, requests: f.requests, sleeps, logs, config };
}
