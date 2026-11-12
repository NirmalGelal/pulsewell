import type { Alert, ClinicianNote, Report, Session, User } from '@prisma/client';
import {
  ReportContentSchema,
  type AlertDto,
  type ClinicianNoteDto,
  type ReportContent,
  type RiskLevel,
} from '@pvc/shared';
import { fromJson } from '../../lib/json';
import { toClinicianContent } from '../reports/redaction';

/** Parses a stored report and applies the clinician view (removed items blanked). */
export function clinicianContentOf(report: Pick<Report, 'currentJson'>): ReportContent {
  return toClinicianContent(fromJson(ReportContentSchema, report.currentJson));
}

export type ApprovedReport = Report & { session: Session };

export function toAlertDto(a: Alert, patient: Pick<User, 'id' | 'displayName'>): AlertDto {
  return {
    id: a.id,
    sessionId: a.sessionId,
    patient: { id: patient.id, displayName: patient.displayName },
    level: a.level as RiskLevel,
    evidence: a.evidence,
    createdAt: a.createdAt.toISOString(),
    acknowledgedAt: a.acknowledgedAt ? a.acknowledgedAt.toISOString() : null,
  };
}

export function toNoteDto(n: ClinicianNote, clinicianName: string): ClinicianNoteDto {
  return {
    id: n.id,
    text: n.text,
    createdAt: n.createdAt.toISOString(),
    clinicianName,
  };
}
