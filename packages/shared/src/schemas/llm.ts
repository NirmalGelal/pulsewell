import { z } from 'zod';
import { ITEM_STATUSES, RISK_CATEGORIES, RISK_LEVELS, type Sender } from '../enums';
import { CHECKLIST_KEYS, DOMAIN_KEYS, SUMMARY_SECTIONS, type SummarySection } from '../keys';

export const FOCUS_KEYS = [
  ...CHECKLIST_KEYS,
  'open_story',
  'safety_followup',
  'follow_up_question',
  'wrap_up',
] as const;
export type FocusKey = (typeof FOCUS_KEYS)[number];
export const FocusKeySchema = z.enum(FOCUS_KEYS);

export const SafetyClassifierOutputSchema = z.object({
  level: z.enum(RISK_LEVELS),
  categories: z.array(z.enum(RISK_CATEGORIES)),
  evidence: z.string(), // exact phrase or ''
});
export type SafetyClassifierOutput = z.infer<typeof SafetyClassifierOutputSchema>;

export const TrackerOutputSchema = z.object({
  updates: z.array(
    z.object({
      key: z.enum(CHECKLIST_KEYS),
      status: z.enum(ITEM_STATUSES),
      value: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).nullable(),
      confidence: z.number().min(0).max(1),
      note: z.string().nullable(),
      turnIds: z.array(z.number().int().positive()).min(1),
    }),
  ),
});
export type TrackerOutput = z.infer<typeof TrackerOutputSchema>;

export const GeneratedItemSchema = z.object({
  text: z.string(),
  patientText: z.string(),
  turnIds: z.array(z.number().int().positive()),
});
export type GeneratedItem = z.infer<typeof GeneratedItemSchema>;

const writerSummaryShape = Object.fromEntries(
  SUMMARY_SECTIONS.map((k) => [k, z.array(GeneratedItemSchema).default([])]),
) as Record<SummarySection, z.ZodDefault<z.ZodArray<typeof GeneratedItemSchema>>>;

export const WriterOutputSchema = z.object({
  priorities: z.array(GeneratedItemSchema),
  summary: z.object(writerSummaryShape).default({}),
  quotes: z.array(z.object({ text: z.string(), turnId: z.number().int().positive() })),
  notDiscussed: z.array(z.enum(DOMAIN_KEYS)),
});
export type WriterOutput = z.infer<typeof WriterOutputSchema>;

export const VerifierOutputSchema = z.object({
  unsupported: z.array(z.object({ itemId: z.string(), reason: z.string() })),
});
export type VerifierOutput = z.infer<typeof VerifierOutputSchema>;

export const AssistantOutputSchema = z.object({
  answer: z.string(),
  citations: z.array(z.object({ ref: z.string() })), // ref "S<n>:T<turnId>"
});
export type AssistantOutput = z.infer<typeof AssistantOutputSchema>;

// Planner memory stored in Session.interviewState. parse({}) yields all defaults.
export const InterviewStateSchema = z.object({
  lastFocus: FocusKeySchema.nullable().default(null),
  attempts: z.record(FocusKeySchema, z.number().int()).default({}),
  askedFollowUps: z.number().int().default(0),
  followUpQuestions: z.array(z.string()).default([]),
  safetyFollowUpDone: z.boolean().default(false),
});
export type InterviewState = z.infer<typeof InterviewStateSchema>;

/** Renders the normative `TRANSCRIPT:` block: one `[T<turnId>] <SENDER>: <text>` line per turn. */
export function renderTranscript(
  messages: { turnId: number; sender: Sender; text: string }[],
): string {
  const lines = messages.map(
    (m) => `[T${m.turnId}] ${m.sender}: ${m.text.replace(/\s*[\r\n]+\s*/g, ' ')}`,
  );
  return ['TRANSCRIPT:', ...lines].join('\n');
}
