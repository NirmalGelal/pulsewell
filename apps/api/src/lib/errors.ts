import type { ErrorCode } from '@pvc/shared';

export const ERROR_STATUS: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  PAYLOAD_TOO_LARGE: 413,
  LLM_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError('VALIDATION_ERROR', message, details);
export const unauthenticated = (message = 'Authentication required') =>
  new AppError('UNAUTHENTICATED', message);
export const forbidden = (message = 'Forbidden') => new AppError('FORBIDDEN', message);
export const notFound = (message = 'Not found') => new AppError('NOT_FOUND', message);
export const invalidState = (message: string) => new AppError('INVALID_STATE', message);
export const llmUnavailable = (message = 'The language model is unavailable') =>
  new AppError('LLM_UNAVAILABLE', message);
export const payloadTooLarge = (message = 'Payload too large') =>
  new AppError('PAYLOAD_TOO_LARGE', message);
