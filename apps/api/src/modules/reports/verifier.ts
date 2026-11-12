import { VerifierOutputSchema, renderTranscript, type EvidenceItem } from '@pvc/shared';
import type { AppDeps } from '../../deps';
import type { ChatMessage } from '../llm/types';
import type { TurnMessage } from './writer';

export const VERIFIER_SYSTEM_PROMPT = `You check a clinical summary against the transcript it came from. For each STATEMENT, decide whether the cited PATIENT turns
support it. A statement is unsupported if it adds facts, interpretations, diagnoses, severity, or certainty that the patient did
not express, or if the cited turns are about something else. Return ONLY JSON: {"unsupported":[{"itemId":"…","reason":"…"}]}
(an empty list if all are supported).`;

export function buildVerifierMessages(
  messages: TurnMessage[],
  items: EvidenceItem[],
): ChatMessage[] {
  const lines = items.map((i) => `${i.id} [T${i.turnIds.join(',T')}]: ${i.text}`);
  return [
    { role: 'system', content: VERIFIER_SYSTEM_PROMPT },
    { role: 'user', content: `${renderTranscript(messages)}\n\nSTATEMENTS:\n${lines.join('\n')}` },
  ];
}

export interface VerifierResult {
  unsupported: { itemId: string; reason: string }[];
  model: string | null;
}

/** Never throws: a verifier failure skips verification (model null, items kept). */
export async function runVerifier(
  deps: AppDeps,
  args: { messages: TurnMessage[]; items: EvidenceItem[]; cacheSalt: string },
): Promise<VerifierResult> {
  if (args.items.length === 0) return { unsupported: [], model: null };
  try {
    const { data, model } = await deps.llm.completeJson('verifier', {
      schema: VerifierOutputSchema,
      messages: buildVerifierMessages(args.messages, args.items),
      cacheSalt: args.cacheSalt,
    });
    const known = new Set(args.items.map((i) => i.id));
    const seen = new Set<string>();
    const unsupported = data.unsupported.filter((u) => {
      if (!known.has(u.itemId) || seen.has(u.itemId)) return false;
      seen.add(u.itemId);
      return true;
    });
    return { unsupported, model };
  } catch (e) {
    deps.logger.warn('verifier_failed', { name: e instanceof Error ? e.name : typeof e });
    return { unsupported: [], model: null };
  }
}
