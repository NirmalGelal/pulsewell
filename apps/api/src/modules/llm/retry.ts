import type { LlmRole } from '@pvc/shared';
import { LlmUnavailableError } from './types';

export const BACKOFF_MS = [300, 900] as const;
export type Sleep = (ms: number) => Promise<void>;
export const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Error raised by an attempt; `status` is the HTTP status when there was one. */
export interface AttemptError {
  status?: number;
  /** True when our own timeout (or a network failure) caused it. */
  transient?: boolean;
}

export function isRetryable(err: unknown): boolean {
  const e = err as AttemptError;
  if (e?.transient) return true;
  const s = e?.status;
  if (s === undefined) return true; // network error with no response
  return s === 408 || s === 409 || s === 429 || s >= 500;
}

export interface PolicyOptions {
  role: LlmRole;
  primary: string;
  fallback?: string | null;
  sleep: Sleep;
  signal?: AbortSignal;
}

/**
 * Runs `attempt` against the primary model (up to 3 tries on retryable errors), then once on the
 * fallback model, then throws LlmUnavailableError. `attempt` receives the model and 1-based attempt no.
 */
export async function withRetryAndFallback<T>(
  opts: PolicyOptions,
  attempt: (model: string, attemptNo: number) => Promise<T>,
): Promise<T> {
  let n = 0;
  for (let i = 0; i <= BACKOFF_MS.length; i++) {
    n++;
    try {
      return await attempt(opts.primary, n);
    } catch (err) {
      if (opts.signal?.aborted) throw unavailable(opts.role);
      if (!isRetryable(err)) break;
      const wait = BACKOFF_MS[i];
      if (wait !== undefined) await opts.sleep(wait);
    }
  }
  if (opts.fallback && opts.fallback !== opts.primary) {
    n++;
    try {
      return await attempt(opts.fallback, n);
    } catch {
      /* fall through */
    }
  }
  throw unavailable(opts.role);
}

export const unavailable = (role: LlmRole) =>
  new LlmUnavailableError(`The language model is unavailable (role ${role})`);
