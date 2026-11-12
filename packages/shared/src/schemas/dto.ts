import { z } from 'zod';
import {
  FOLLOW_UP_STATUSES,
  INPUT_MODES,
  REPORT_STATUSES,
  RISK_LEVELS,
  ROLES,
  SENDERS,
  SESSION_STATES,
  SEVERITY_BANDS,
} from '../enums';
import { CHECKLIST_KEYS, INSTRUMENT_ITEM_KEYS } from '../keys';
import { ClinicianReportContentSchema } from './report';

export const UserDtoSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.enum(ROLES),
  displayName: z.string(),
  mustChangePassword: z.boolean().default(false),
});
export type UserDto = z.infer<typeof UserDtoSchema>;

export const MessageDtoSchema = z.object({
  id: z.string(),
  turnId: z.number().int().positive(),
  sender: z.enum(SENDERS),
  text: z.string(),
  inputMode: z.enum(INPUT_MODES),
  createdAt: z.string(),
});
export type MessageDto = z.infer<typeof MessageDtoSchema>;

export const SessionDtoSchema = z.object({
  id: z.string(),
  state: z.enum(SESSION_STATES),
  riskLevel: z.enum(RISK_LEVELS),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
});
export type SessionDto = z.infer<typeof SessionDtoSchema>;

export const ProgressDtoSchema = z.object({
  covered: z.number().int(),
  total: z.number().int(),
  percent: z.number(),
  missingRequired: z.array(z.enum(CHECKLIST_KEYS)),
  canFinish: z.boolean(),
});
export type ProgressDto = z.infer<typeof ProgressDtoSchema>;

export const AnswerOptionSchema = z.object({
  value: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  label: z.string(),
});
export type AnswerOption = z.infer<typeof AnswerOptionSchema>;

export const PendingItemDtoSchema = z.object({
  key: z.enum(INSTRUMENT_ITEM_KEYS),
  prompt: z.string(),
  options: z.array(AnswerOptionSchema),
});
export type PendingItemDto = z.infer<typeof PendingItemDtoSchema>;

export const CrisisResourceSchema = z.object({
  id: z.string(),
  name: z.string(),
  action: z.string(),
  href: z.string(),
});
export type CrisisResource = z.infer<typeof CrisisResourceSchema>;

export const SessionDetailDtoSchema = z.object({
  session: SessionDtoSchema,
  messages: z.array(MessageDtoSchema),
  progress: ProgressDtoSchema,
  pendingItem: PendingItemDtoSchema.nullable(),
  hasReport: z.boolean(),
});
export type SessionDetailDto = z.infer<typeof SessionDetailDtoSchema>;

export const SessionSummaryDtoSchema = SessionDtoSchema.extend({
  reportStatus: z.enum(REPORT_STATUSES).nullable(),
});
export type SessionSummaryDto = z.infer<typeof SessionSummaryDtoSchema>;

export const FollowUpDtoSchema = z.object({
  id: z.string(),
  clinician: z.object({ id: z.string(), displayName: z.string() }),
  questions: z.array(z.string()),
  status: z.enum(FOLLOW_UP_STATUSES),
  createdAt: z.string(),
});
export type FollowUpDto = z.infer<typeof FollowUpDtoSchema>;

const PersonRefSchema = z.object({ id: z.string(), displayName: z.string() });
const ScoreBandSchema = z.object({
  total: z.number().nullable(),
  band: z.enum(SEVERITY_BANDS).nullable(),
});

export const QueueItemDtoSchema = z.object({
  reportId: z.string(),
  sessionId: z.string(),
  patient: PersonRefSchema,
  approvedAt: z.string(),
  riskLevel: z.enum(RISK_LEVELS),
  reviewed: z.boolean(),
  phq9: ScoreBandSchema,
  gad7: ScoreBandSchema,
  topPriority: z.string().nullable(),
  trend: z
    .object({ phq9Delta: z.number().nullable(), gad7Delta: z.number().nullable() })
    .nullable(),
  hasUnacknowledgedAlert: z.boolean(),
});
export type QueueItemDto = z.infer<typeof QueueItemDtoSchema>;

export const AlertDtoSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  patient: PersonRefSchema,
  level: z.enum(RISK_LEVELS),
  evidence: z.string(),
  createdAt: z.string(),
  acknowledgedAt: z.string().nullable(),
});
export type AlertDto = z.infer<typeof AlertDtoSchema>;

export const ClinicianNoteDtoSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
  clinicianName: z.string(),
});
export type ClinicianNoteDto = z.infer<typeof ClinicianNoteDtoSchema>;

export const TranscriptTurnDtoSchema = z.object({
  turnId: z.number().int().positive(),
  sender: z.enum(SENDERS),
  text: z.string().nullable(),
  redacted: z.boolean(),
  inputMode: z.enum(INPUT_MODES),
  createdAt: z.string(),
  hasSafetyEvent: z.boolean(),
});
export type TranscriptTurnDto = z.infer<typeof TranscriptTurnDtoSchema>;

export const ClinicianReportDtoSchema = z.object({
  reportId: z.string(),
  status: z.enum(REPORT_STATUSES),
  approvedAt: z.string(),
  reviewedAt: z.string().nullable(),
  patient: PersonRefSchema,
  session: SessionDtoSchema,
  content: ClinicianReportContentSchema,
  transcript: z.array(TranscriptTurnDtoSchema),
  notes: z.array(ClinicianNoteDtoSchema),
  history: z.array(
    z.object({
      reportId: z.string(),
      approvedAt: z.string(),
      phq9Total: z.number().nullable(),
      gad7Total: z.number().nullable(),
    }),
  ),
});
export type ClinicianReportDto = z.infer<typeof ClinicianReportDtoSchema>;

export const AskResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(
    z.object({ sessionId: z.string(), turnId: z.number().int(), excerpt: z.string() }),
  ),
  model: z.string(),
});
export type AskResponse = z.infer<typeof AskResponseSchema>;
