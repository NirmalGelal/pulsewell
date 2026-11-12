import type { ZodType } from 'zod';
import type { LlmRole } from '@pvc/shared';
import { AppError } from '../../lib/errors';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ThinkingMode = 'off' | 'low' | 'medium' | 'high';
export interface LlmCallOptions {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  thinking?: ThinkingMode;
  cacheSalt?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}
export interface LlmTextResult {
  text: string;
  model: string;
}
export interface LlmJsonResult<T> {
  data: T;
  model: string;
}

export interface LlmClient {
  readonly mode: 'live' | 'demo' | 'mock';
  complete(role: LlmRole, opts: LlmCallOptions): Promise<LlmTextResult>;
  completeJson<T>(
    role: LlmRole,
    opts: LlmCallOptions & { schema: ZodType<T, import('zod').ZodTypeDef, unknown> },
  ): Promise<LlmJsonResult<T>>;
  stream(
    role: LlmRole,
    opts: LlmCallOptions,
  ): AsyncIterable<string> & { result: Promise<LlmTextResult> };
  transcribe(
    audio: Buffer,
    mimeType: string,
    opts?: { cacheSalt?: string },
  ): Promise<LlmTextResult>;
}
// All methods throw LlmUnavailableError (code 'LLM_UNAVAILABLE') after retries + fallback fail.

export class LlmUnavailableError extends AppError {
  constructor(message = 'The language model is unavailable') {
    super('LLM_UNAVAILABLE', message);
    this.name = 'LlmUnavailableError';
  }
}
