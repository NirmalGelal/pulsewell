import { z } from 'zod';
import {
  ITEM_STATUSES,
  RISK_CATEGORIES,
  RISK_LEVELS,
  SAFETY_SOURCES,
  SEVERITY_BANDS,
  REPORT_STATUSES,
} from '../enums';
import {
  ANNOTATABLE_SECTIONS,
  DOMAIN_KEYS,
  INSTRUMENT_ITEM_KEYS,
  SUMMARY_SECTIONS,
  type SummarySection,
} from '../keys';

export const EvidenceItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  patientText: z.string(),
  turnIds: z.array(z.number().int().positive()),
  patientCorrection: z.string().optional(),
  removedByPatient: z.boolean().optional(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const QuoteSchema = z.object({
  id: z.string(),
  text: z.string(),
  turnId: z.number().int().positive(),
  removedByPatient: z.boolean().optional(),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const ItemValueSchema = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);

export const InstrumentItemResultSchema = z.object({
  key: z.enum(INSTRUMENT_ITEM_KEYS),
  value: ItemValueSchema.nullable(),
  status: z.enum([...ITEM_STATUSES, 'missing']),
});
export type InstrumentItemResult = z.infer<typeof InstrumentItemResultSchema>;

export const InstrumentResultSchema = z.object({
  items: z.array(InstrumentItemResultSchema),
  answeredCount: z.number().int().nonnegative(),
  total: z.number().int().nullable(),
  partialSum: z.number().int().nonnegative(),
  complete: z.boolean(),
  band: z.enum(SEVERITY_BANDS).nullable(),
});
export type InstrumentResult = z.infer<typeof InstrumentResultSchema>;

export const RiskFlagSchema = z.object({
  category: z.enum(RISK_CATEGORIES),
  level: z.enum(RISK_LEVELS),
  evidence: z.string(),
  turnId: z.number().int().positive(),
  source: z.enum(SAFETY_SOURCES),
});
export type RiskFlag = z.infer<typeof RiskFlagSchema>;

export const PatientAnnotationSchema = z.object({
  id: z.string(),
  section: z.enum(ANNOTATABLE_SECTIONS),
  text: z.string(),
  createdAt: z.string(),
});
export type PatientAnnotation = z.infer<typeof PatientAnnotationSchema>;

const summaryShape = Object.fromEntries(
  SUMMARY_SECTIONS.map((k) => [k, z.array(EvidenceItemSchema)]),
) as Record<SummarySection, z.ZodArray<typeof EvidenceItemSchema>>;

export const ReportContentSchema = z.object({
  schemaVersion: z.literal(1),
  patient: z.object({ displayName: z.string() }),
  session: z.object({
    id: z.string(),
    startedAt: z.string(),
    endedAt: z.string(),
    durationMinutes: z.number(),
  }),
  risk: z.object({ level: z.enum(RISK_LEVELS), flags: z.array(RiskFlagSchema) }),
  priorities: z.array(EvidenceItemSchema),
  screening: z.object({ phq9: InstrumentResultSchema, gad7: InstrumentResultSchema }),
  summary: z.object(summaryShape),
  quotes: z.array(QuoteSchema),
  notDiscussed: z.array(z.enum(DOMAIN_KEYS)),
  declinedTopics: z.array(z.enum(DOMAIN_KEYS)),
  patientAnnotations: z.array(PatientAnnotationSchema),
  provenance: z.object({
    aiGenerated: z.literal(true),
    writerModel: z.string(),
    verifierModel: z.string().nullable(),
    generatedAt: z.string(),
    verification: z.object({
      claimsChecked: z.number().int(),
      claimsRemoved: z.number().int(),
      quotesRemoved: z.number().int(),
      regenerated: z.boolean(),
    }),
  }),
});
export type ReportContent = z.infer<typeof ReportContentSchema>;
export type ClinicianReportContent = ReportContent;
export const ClinicianReportContentSchema = ReportContentSchema;

export const PatientReportDtoSchema = z.object({
  reportId: z.string(),
  status: z.enum(REPORT_STATUSES),
  content: ReportContentSchema,
  approvedAt: z.string().nullable().optional(),
});
export type PatientReportDto = z.infer<typeof PatientReportDtoSchema>;
