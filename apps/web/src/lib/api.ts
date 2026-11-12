import type { ZodType, ZodTypeDef } from 'zod';
import type { ErrorCode } from '@pvc/shared';
import { API_URL } from './env';

const TOKEN_KEY = 'pvc.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* storage unavailable: session lasts until reload */
  }
}
export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | 'NETWORK';
  readonly details?: unknown;
  constructor(status: number, code: ErrorCode | 'NETWORK', message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

let unauthorizedHandler: (() => void) | null = null;
/** AuthProvider registers this so a 401 anywhere logs the user out and routes to /login. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Turns a non-2xx Response into an ApiError, handling the 401 side effect. */
export async function toApiError(res: Response, path: string): Promise<ApiError> {
  let code: ErrorCode | 'NETWORK' = 'INTERNAL';
  let message = 'Something went wrong';
  let details: unknown;
  try {
    const body = (await res.json()) as {
      error?: { code?: ErrorCode; message?: string; details?: unknown };
    };
    if (body.error) {
      code = body.error.code ?? code;
      message = body.error.message ?? message;
      details = body.error.details;
    }
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    clearToken();
    unauthorizedHandler?.();
  }
  return new ApiError(res.status, code, message, details);
}

async function doFetch(path: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(`${API_URL}${path}`, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK', 'Could not reach the server');
  }
}

async function parse<T>(
  res: Response,
  path: string,
  schema?: ZodType<T, ZodTypeDef, unknown>,
): Promise<T> {
  if (!res.ok) throw await toApiError(res, path);
  const body: unknown = res.status === 204 ? undefined : await res.json();
  if (schema && import.meta.env.DEV) {
    const r = schema.safeParse(body);
    if (!r.success) console.error(`Response from ${path} did not match its schema`, r.error.issues);
  }
  return body as T;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  schema?: ZodType<T, ZodTypeDef, unknown>,
): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await doFetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return parse(res, path, schema);
}

export const api = {
  get: <T>(path: string, schema?: ZodType<T, ZodTypeDef, unknown>) =>
    request<T>('GET', path, undefined, schema),
  post: <T>(path: string, body?: unknown, schema?: ZodType<T, ZodTypeDef, unknown>) =>
    request<T>('POST', path, body, schema),
  patch: <T>(path: string, body?: unknown, schema?: ZodType<T, ZodTypeDef, unknown>) =>
    request<T>('PATCH', path, body, schema),
  upload: async <T>(path: string, formData: FormData, schema?: ZodType<T, ZodTypeDef, unknown>) => {
    const res = await doFetch(path, { method: 'POST', headers: authHeaders(), body: formData });
    return parse<T>(res, path, schema);
  },
};
