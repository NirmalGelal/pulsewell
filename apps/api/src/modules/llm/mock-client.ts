import type { ZodType, ZodTypeDef } from 'zod';
import type { LlmRole } from '@pvc/shared';
import {
  LlmUnavailableError,
  type LlmCallOptions,
  type LlmClient,
  type LlmJsonResult,
  type LlmTextResult,
} from './types';

export type MockMethod = 'complete' | 'completeJson' | 'stream' | 'transcribe';
export type Handler = (
  opts: LlmCallOptions,
  call: { method: MockMethod },
) => unknown | Promise<unknown>;

function toHandler(h: Handler | unknown): Handler {
  return typeof h === 'function' ? (h as Handler) : () => h;
}

/** Scripted LLM for tests. */
export class MockLlmClient implements LlmClient {
  readonly mode = 'mock' as const;
  calls: { role: LlmRole; method: string; opts: LlmCallOptions }[] = [];
  private persistent = new Map<LlmRole, Handler>();
  private queued = new Map<LlmRole, Handler[]>();
  private failures = new Map<LlmRole, number>();

  on(role: LlmRole, handlerOrValue: Handler | unknown): this {
    this.persistent.set(role, toHandler(handlerOrValue));
    return this;
  }

  once(role: LlmRole, handlerOrValue: Handler | unknown): this {
    const q = this.queued.get(role) ?? [];
    q.push(toHandler(handlerOrValue));
    this.queued.set(role, q);
    return this;
  }

  fail(role: LlmRole, times = 1): this {
    this.failures.set(role, (this.failures.get(role) ?? 0) + times);
    return this;
  }

  reset(): void {
    this.calls = [];
    this.persistent.clear();
    this.queued.clear();
    this.failures.clear();
  }

  private async invoke(role: LlmRole, method: MockMethod, opts: LlmCallOptions): Promise<unknown> {
    this.calls.push({ role, method, opts });
    const f = this.failures.get(role) ?? 0;
    if (f > 0) {
      this.failures.set(role, f - 1);
      throw new LlmUnavailableError(`The language model is unavailable (role ${role})`);
    }
    const handler = this.queued.get(role)?.shift() ?? this.persistent.get(role);
    if (!handler) throw new Error(`MockLlmClient: no handler for role "${role}"`);
    return handler(opts, { method });
  }

  private model(role: LlmRole) {
    return `mock-${role}`;
  }

  async complete(role: LlmRole, opts: LlmCallOptions): Promise<LlmTextResult> {
    const v = await this.invoke(role, 'complete', opts);
    const text = Array.isArray(v) ? v.join('') : typeof v === 'string' ? v : JSON.stringify(v);
    return { text, model: this.model(role) };
  }

  async completeJson<T>(
    role: LlmRole,
    opts: LlmCallOptions & { schema: ZodType<T, ZodTypeDef, unknown> },
  ): Promise<LlmJsonResult<T>> {
    const v = await this.invoke(role, 'completeJson', opts);
    const data = opts.schema.parse(typeof v === 'string' ? JSON.parse(v) : v);
    return { data, model: this.model(role) };
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
    result.catch(() => undefined);
    const model = this.model(role);
    const invoke = () => this.invoke(role, 'stream', opts);
    const gen = (async function* () {
      try {
        const v = await invoke();
        const chunks = Array.isArray(v)
          ? (v as string[])
          : ((typeof v === 'string' ? v : JSON.stringify(v)).match(/\S+\s*|\s+/g) ?? []);
        // split on spaces preserving them: each chunk is a word plus its trailing whitespace
        for (const c of chunks) yield c;
        resolve({ text: chunks.join(''), model });
      } catch (err) {
        reject(err);
        throw err;
      }
    })();
    return Object.assign(gen as AsyncIterable<string>, { result });
  }

  async transcribe(
    _audio: Buffer,
    mimeType: string,
    opts: { cacheSalt?: string } = {},
  ): Promise<LlmTextResult> {
    const v = await this.invoke('stt', 'transcribe', {
      messages: [{ role: 'user', content: mimeType }],
      ...opts,
    });
    return { text: String(v), model: this.model('stt') };
  }
}
