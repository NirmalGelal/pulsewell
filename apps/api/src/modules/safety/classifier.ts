import {
  SafetyClassifierOutputSchema,
  renderTranscript,
  type Sender,
  type SafetyClassifierOutput,
} from '@pvc/shared';
import type { AppDeps } from '../../deps';

export const SAFETY_SYSTEM_PROMPT = `You are a clinical safety classifier for a mental-health intake companion. You do not chat.
Classify the risk in the PATIENT MESSAGE, using the recent conversation only as context.
Return ONLY JSON: {"level":"none|concern|elevated|imminent","categories":[...],"evidence":"<exact phrase from the PATIENT MESSAGE or empty>"}
categories ⊆ ["suicidal_ideation","self_harm","harm_to_others","abuse","psychosis","substance_emergency"]
Levels:
- imminent: current intent, plan, available means, or timeline to harm self or others; or an ongoing emergency (e.g., has just overdosed).
- elevated: thoughts of death, suicide or self-harm without a plan; recent self-harm; ongoing abuse; hearing voices telling them to do harm; harm-to-others thoughts without intent.
- concern: hopelessness, feeling trapped or a burden, without thoughts of death.
- none: none of the above. Ordinary sadness, stress or anxiety is "none".
Denials ("I would never hurt myself") are "none" unless other risk is present.
When uncertain between two levels, choose the higher one.`;

/** Throws on LLM failure; the caller (assessMessage) handles it. */
export async function classifyRisk(
  deps: Pick<AppDeps, 'llm'>,
  args: {
    text: string;
    recent: { turnId: number; sender: Sender; text: string }[];
    cacheSalt: string;
  },
): Promise<SafetyClassifierOutput> {
  const transcript = renderTranscript(args.recent.slice(-6));
  const { data } = await deps.llm.completeJson('safety', {
    schema: SafetyClassifierOutputSchema,
    cacheSalt: args.cacheSalt,
    messages: [
      { role: 'system', content: SAFETY_SYSTEM_PROMPT },
      { role: 'user', content: `${transcript}\n\nPATIENT MESSAGE: ${args.text}` },
    ],
  });
  return data;
}
