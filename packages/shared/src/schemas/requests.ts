import { z } from 'zod';
import { INPUT_MODES } from '../enums';
import { ANNOTATABLE_SECTIONS, EDITABLE_SECTIONS, INSTRUMENT_ITEM_KEYS } from '../keys';

export const LoginRequestSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const MIN_PASSWORD_LENGTH = 10;

export const ChangePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z
      .string()
      .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
      .max(200),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'Choose a password you have not used just now',
    path: ['newPassword'],
  });
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const CreatePatientRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  displayName: z.string().trim().min(1).max(80),
});
export type CreatePatientRequest = z.infer<typeof CreatePatientRequestSchema>;

export const CreatePatientResponseSchema = z.object({
  patient: z.object({ id: z.string(), email: z.string(), displayName: z.string() }),
  temporaryPassword: z.string(),
});
export type CreatePatientResponse = z.infer<typeof CreatePatientResponseSchema>;

export const ResetPasswordResponseSchema = z.object({ temporaryPassword: z.string() });
export type ResetPasswordResponse = z.infer<typeof ResetPasswordResponseSchema>;

export const CreateSessionRequestSchema = z.object({
  consent: z.object({ accepted: z.literal(true), version: z.string().min(1) }),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const SendMessageRequestSchema = z.object({
  text: z.string().trim().min(1).max(4000),
  inputMode: z.enum(INPUT_MODES),
  answerFor: z
    .object({
      key: z.enum(INSTRUMENT_ITEM_KEYS),
      value: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    })
    .optional(),
});
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>;

export const ResumeRequestSchema = z.object({ confirmSafe: z.literal(true) });
export type ResumeRequest = z.infer<typeof ResumeRequestSchema>;

const editText = z.string().trim().min(1).max(1000);

export const ReportEditInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('correct'),
    section: z.enum(EDITABLE_SECTIONS),
    itemId: z.string().min(1),
    text: editText,
  }),
  z.object({
    kind: z.literal('remove'),
    section: z.enum(EDITABLE_SECTIONS),
    itemId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('annotate'),
    section: z.enum(ANNOTATABLE_SECTIONS),
    text: editText,
  }),
]);
export type ReportEditInput = z.infer<typeof ReportEditInputSchema>;

export const EditReportRequestSchema = z.object({
  edits: z.array(ReportEditInputSchema).min(1).max(20),
});
export type EditReportRequest = z.infer<typeof EditReportRequestSchema>;

export const CreateNoteRequestSchema = z.object({ text: z.string().trim().min(1).max(4000) });
export type CreateNoteRequest = z.infer<typeof CreateNoteRequestSchema>;

export const AskRequestSchema = z.object({ question: z.string().trim().min(3).max(1000) });
export type AskRequest = z.infer<typeof AskRequestSchema>;

export const CreateFollowUpRequestSchema = z.object({
  questions: z.array(z.string().trim().min(3).max(300)).min(1).max(3),
});
export type CreateFollowUpRequest = z.infer<typeof CreateFollowUpRequestSchema>;

export const AlertsQuerySchema = z.object({
  status: z.enum(['open', 'all']).default('open'),
});
export type AlertsQuery = z.infer<typeof AlertsQuerySchema>;

// Route params
export const IdParamSchema = z.object({ id: z.string().min(1) });
export const ReportIdParamSchema = z.object({ reportId: z.string().min(1) });
export const PatientIdParamSchema = z.object({ patientId: z.string().min(1) });
