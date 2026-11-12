import OpenAI from 'openai';
import type { ZodType, ZodTypeDef } from 'zod';
import type { LlmRole } from '@pvc/shared';
import { badRequest } from '../../lib/errors';
import type { Logger } from '../../lib/logger';
import { modelFor, ROLE_SETTINGS, thinkingParams, type LlmConfig } from './config';
import { structuredWithRepair } from './json';
import { realSleep, unavailable, withRetryAndFallback, type Sleep } from './retry';
import { stripThink, ThinkStripper } from './think';
import {
  LlmUnavailableError,
  type ChatMessage,
  type LlmCallOptions,
  type LlmClient,
  type LlmJsonResult,
  type LlmTextResult,
} from './types';

export interface LiveClientOptions {
  /** Injected fetch (tests). */
  fetch?: typeof fetch;
  /** Injected sleep (tests). */
  sleep?: Sleep;
}

/** Normalised failure of one attempt (never carries prompt/response content). */
class AttemptFailure extends Error {
  constructor(
    readonly status: number | undefined,
    readonly transient: boolean,
  ) {
    super(`llm attempt failed${status ? ` (HTTP ${status})` : ''}`);
  }
}

interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

// The OpenAI SDK types do not know NRP's extra body fields; we cast at this one boundary.
type LooseParams = Record<string, unknown>;

export class LiveLlmClient implements LlmClient {
  readonly mode = 'live' as const;
  private readonly client: OpenAI;
  private readonly sleep: Sleep;

  constructor(
    private readonly config: LlmConfig,
    private readonly logger: Logger,
    options: LiveClientOptions = {},
  ) {
    this.sleep = options.sleep ?? realSleep;
    this.client = new OpenAI({
      baseURL: config.NRP_BASE_URL,
      apiKey: config.NRP_API_KEY || 'unset',
      maxRetries: 0,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
  }

  // ---- request plumbing -------------------------------------------------

  private buildBody(
    role: LlmRole,
    model: string,
    opts: LlmCallOptions,
    messages: unknown[],
  ): LooseParams {
    const d = ROLE_SETTINGS[role];
    return {
      model,
      messages,
      temperature: opts.temperature ?? d.temperature,
      max_tokens: opts.maxTokens ?? d.maxTokens,
      ...thinkingParams(model, opts.thinking ?? d.thinking),
      ...(opts.cacheSalt ? { cache_salt: opts.cacheSalt } : {}),
    };
  }

  /** Runs `fn` with an abort signal that fires on our timeout or the caller's signal. */
  private async guarded<T>(
    timeoutMs: number,
    callerSignal: AbortSignal | undefined,
    fn: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const ac = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ac.abort();
    }, timeoutMs);
    const onAbort = () => ac.abort();
    callerSignal?.addEventListener('abort', onAbort, { once: true });
    if (callerSignal?.aborted) ac.abort();
    try {
      return await fn(ac.signal);
    } catch (err) {
      if (err instanceof AttemptFailure) throw err;
      const status = (err as { status?: number }).status;
      throw new AttemptFailure(status, timedOut);
    } finally {
      clearTimeout(timer);
      callerSignal?.removeEventListener('abort', onAbort);
    }
  }

  private log(
    role: LlmRole,
    model: string,
    started: number,
    attempt: number,
    ok: boolean,
    usage?: Usage,
    status?: number,
  ) {
    this.logger.info('llm_call', {
      role,
      model,
      ms: Date.now() - started,
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      ok,
      attempt,
      ...(status ? { status } : {}),
    });
  }

  /** One non-streaming attempt. `json.on` toggles response_format (dropped once if rejected with 400). */
  private async chatAttempt(
    role: LlmRole,
    model: string,
    attempt: number,
    opts: LlmCallOptions,
    messages: unknown[],
    json?: { on: boolean },
  ): Promise<LlmTextResult> {
    const started = Date.now();
    const timeoutMs = opts.timeoutMs ?? ROLE_SETTINGS[role].timeoutMs;
    const send = (signal: AbortSignal) => {
      const body = this.buildBody(role, model, opts, messages);
      if (json?.on) body.response_format = { type: 'json_object' };
      return this.client.chat.completions.create(body as never, { signal }) as Promise<{
        choices: { message?: { content?: string | null } }[];
        usage?: Usage;
      }>;
    };
    try {
      let res;
      try {
        res = await this.guarded(timeoutMs, opts.signal, send);
      } catch (err) {
        if (json?.on && err instanceof AttemptFailure && err.status === 400) {
          json.on = false;
          res = await this.guarded(timeoutMs, opts.signal, send);
        } else throw err;
      }
      this.log(role, model, started, attempt, true, res.usage);
      return { text: stripThink(res.choices[0]?.message?.content ?? ''), model };
    } catch (err) {
      this.log(role, model, started, attempt, false, undefined, (err as AttemptFailure).status);
      throw err;
    }
  }

  private run<T>(
    role: LlmRole,
    opts: LlmCallOptions,
    fallback: boolean,
    attempt: (model: string, n: number) => Promise<T>,
  ): Promise<T> {
    return withRetryAndFallback(
      {
        role,
        primary: modelFor(this.config, role),
        fallback: fallback ? this.config.fallbackModel : null,
        sleep: this.sleep,
        ...(opts.signal ? { signal: opts.signal } : {}),
      },
      attempt,
    );
  }

  // ---- LlmClient --------------------------------------------------------

  complete(role: LlmRole, opts: LlmCallOptions): Promise<LlmTextResult> {
    return this.run(role, opts, true, (model, n) =>
      this.chatAttempt(role, model, n, opts, opts.messages),
    );
  }

  async completeJson<T>(
    role: LlmRole,
    opts: LlmCallOptions & { schema: ZodType<T, ZodTypeDef, unknown> },
  ): Promise<LlmJsonResult<T>> {
    const json = { on: true };
    return structuredWithRepair(role, opts, (messages: ChatMessage[]) =>
      this.run(role, opts, true, (model, n) =>
        this.chatAttempt(role, model, n, opts, messages, json),
      ),
    );
  }

  stream(
    role: LlmRole,
    opts: LlmCallOptions,
  ): AsyncIterable<string> & { result: Promise<LlmTextResult> } {
    let resolve!: (r: LlmTextResult) => void;
    let reject!: (e: unknown) => void;
    const result = new Promise<LlmTextResult>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    result.catch(() => undefined); // avoid unhandled rejection if nobody awaits `result`

    interface Opened {
      model: string;
      it: AsyncIterator<unknown>;
      stripper: ThinkStripper;
      first: string;
      done: boolean;
      finish: () => void;
      ac: AbortController;
    }

    const open = (model: string, attempt: number): Promise<Opened> => {
      const started = Date.now();
      const timeoutMs = opts.timeoutMs ?? ROLE_SETTINGS[role].timeoutMs;
      const ac = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, timeoutMs);
      const onAbort = () => ac.abort();
      opts.signal?.addEventListener('abort', onAbort, { once: true });
      const finish = () => {
        clearTimeout(timer);
        opts.signal?.removeEventListener('abort', onAbort);
      };
      return (async () => {
        try {
          const body = { ...this.buildBody(role, model, opts, opts.messages), stream: true };
          const s = (await this.client.chat.completions.create(body as never, {
            signal: ac.signal,
          })) as unknown as AsyncIterable<unknown>;
          const it = s[Symbol.asyncIterator]();
          const stripper = new ThinkStripper();
          let first = '';
          let done = false;
          while (first === '' && !done) {
            const r = await it.next();
            if (r.done) {
              done = true;
              first = stripper.flush();
            } else first = stripper.push(deltaOf(r.value));
          }
          this.log(role, model, started, attempt, true);
          return { model, it, stripper, first, done, finish, ac };
        } catch (err) {
          finish();
          ac.abort();
          this.log(
            role,
            model,
            started,
            attempt,
            false,
            undefined,
            (err as { status?: number }).status,
          );
          throw new AttemptFailure((err as { status?: number }).status, timedOut);
        }
      })();
    };

    const openRun = () => this.run(role, opts, true, open);
    const gen = (async function* () {
      let opened: Opened;
      try {
        opened = await openRun();
      } catch (err) {
        reject(err);
        throw err;
      }
      let full = '';
      try {
        if (opened.first) {
          full += opened.first;
          yield opened.first;
        }
        while (!opened.done) {
          const r = await opened.it.next();
          if (r.done) {
            opened.done = true;
            const tail = opened.stripper.flush();
            if (tail) {
              full += tail;
              yield tail;
            }
            break;
          }
          const piece = opened.stripper.push(deltaOf(r.value));
          if (piece) {
            full += piece;
            yield piece;
          }
        }
        resolve({ text: full, model: opened.model });
      } catch (err) {
        const e = err instanceof LlmUnavailableError ? err : unavailable(role);
        reject(e);
        throw e;
      } finally {
        opened.finish();
      }
    })();

    return Object.assign(gen as AsyncIterable<string>, { result });
  }

  async transcribe(
    audio: Buffer,
    mimeType: string,
    opts: { cacheSalt?: string } = {},
  ): Promise<LlmTextResult> {
    const mime = mimeType.split(';')[0]!.trim().toLowerCase();
    const format = mime === 'audio/wav' ? 'wav' : mime === 'audio/mpeg' ? 'mp3' : null;
    if (!format) throw badRequest('Unsupported audio type; use audio/wav or audio/mpeg');
    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Transcribe the speech in this audio verbatim in English. Output only the transcript text, no commentary.',
          },
          { type: 'input_audio', input_audio: { data: audio.toString('base64'), format } },
        ],
      },
    ];
    const callOpts: LlmCallOptions = { messages: [], ...opts };
    return this.run('stt', callOpts, false, (model, n) =>
      this.chatAttempt('stt', model, n, callOpts, messages),
    );
  }
}

function deltaOf(chunk: unknown): string {
  const c = chunk as { choices?: { delta?: { content?: string | null } }[] };
  return c.choices?.[0]?.delta?.content ?? '';
}
