import type { ZodType, ZodTypeDef } from 'zod';
import type { LlmRole } from '@pvc/shared';
import type { ChatMessage, LlmCallOptions, LlmJsonResult, LlmTextResult } from './types';
import { LlmUnavailableError } from './types';

function stripFences(text: string): string {
  const m = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (m ? m[1]! : text).trim();
}

/** Index of the `}` matching the `{` at `start` (string-aware), or -1. */
function matchingBrace(t: string, start: number): number {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (c === '\\') i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Extracts a JSON value from model text: strips code fences, else takes first `{` .. last `}`. */
export function extractJson(text: string): unknown {
  const t = stripFences(text);
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    if (a === -1) throw new SyntaxError('no JSON object found');
    const end = matchingBrace(t, a);
    if (end === -1) throw new SyntaxError('unbalanced JSON object');
    return JSON.parse(t.slice(a, end + 1));
  }
}

type Parsed<T> = { ok: true; data: T } | { ok: false; errors: string };

export function parseWith<T>(schema: ZodType<T, ZodTypeDef, unknown>, text: string): Parsed<T> {
  let raw: unknown;
  try {
    raw = extractJson(text);
  } catch {
    return { ok: false, errors: 'output was not parseable JSON' };
  }
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const errors = r.error.issues
    .slice(0, 10)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
  return { ok: false, errors };
}

/** Calls `call`, validates against schema, and does at most one repair round-trip. */
export async function structuredWithRepair<T>(
  role: LlmRole,
  opts: LlmCallOptions & { schema: ZodType<T, ZodTypeDef, unknown> },
  call: (messages: ChatMessage[]) => Promise<LlmTextResult>,
): Promise<LlmJsonResult<T>> {
  const first = await call(opts.messages);
  const p1 = parseWith(opts.schema, first.text);
  if (p1.ok) return { data: p1.data, model: first.model };
  const repairMessages: ChatMessage[] = [
    ...opts.messages,
    { role: 'assistant', content: first.text },
    {
      role: 'user',
      content: `Your previous reply was not valid. Errors: ${p1.errors}. Reply with corrected JSON only.`,
    },
  ];
  const second = await call(repairMessages);
  const p2 = parseWith(opts.schema, second.text);
  if (p2.ok) return { data: p2.data, model: second.model };
  throw new LlmUnavailableError(`invalid structured output for role ${role}`);
}
