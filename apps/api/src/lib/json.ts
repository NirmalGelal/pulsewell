import type { ZodType, ZodTypeDef } from 'zod';
import { AppError } from './errors';

export const toJson = (v: unknown): string => JSON.stringify(v);

export function fromJson<T>(schema: ZodType<T, ZodTypeDef, unknown>, s: string): T {
  let raw: unknown;
  try {
    raw = JSON.parse(s);
  } catch {
    throw new AppError('INTERNAL', 'Corrupt stored JSON');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new AppError('INTERNAL', 'Corrupt stored JSON');
  return r.data;
}
