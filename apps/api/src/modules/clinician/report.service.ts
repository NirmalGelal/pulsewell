import {
  assertTransition,
  type ClinicianReportDto,
  type InputMode,
  type ReportStatus,
  type Sender,
  type SessionState,
} from '@pvc/shared';
import type { AppDeps } from '../../deps';
import { notFound } from '../../lib/errors';
import { audit } from '../audit/audit.service';
import { isLinked } from '../auth/access';
import { toSessionDto } from '../sessions/dto';
import { clinicianContentOf, toNoteDto } from './dto';

/** Loads an APPROVED report of a patient linked to the clinician, else 404. */
export async function getVisibleReport(deps: AppDeps, clinicianId: string, reportId: string) {
  const report = await deps.prisma.report.findUnique({
    where: { id: reportId },
    include: { session: { include: { patient: { select: { id: true, displayName: true } } } } },
  });
  if (
    !report ||
    report.status !== 'APPROVED' ||
    !report.approvedAt ||
    !(await isLinked(deps.prisma, clinicianId, report.session.patientId))
  )
    throw notFound('Report not found');
  return report as typeof report & { approvedAt: Date };
}

export async function viewReport(
  deps: AppDeps,
  clinicianId: string,
  reportId: string,
): Promise<ClinicianReportDto> {
  const report = await getVisibleReport(deps, clinicianId, reportId);
  const [messages, events, notes, older] = await Promise.all([
    deps.prisma.message.findMany({
      where: { sessionId: report.sessionId },
      orderBy: { turnId: 'asc' },
    }),
    deps.prisma.safetyEvent.findMany({
      where: { sessionId: report.sessionId },
      select: { turnId: true },
    }),
    deps.prisma.clinicianNote.findMany({
      where: { reportId },
      orderBy: { createdAt: 'asc' },
    }),
    deps.prisma.report.findMany({
      where: {
        status: 'APPROVED',
        id: { not: report.id },
        approvedAt: { lt: report.approvedAt },
        session: { patientId: report.session.patientId },
      },
      orderBy: { approvedAt: 'desc' },
    }),
  ]);
  const flagged = new Set(events.map((e) => e.turnId));
  const authors = await deps.prisma.user.findMany({
    where: { id: { in: [...new Set(notes.map((n) => n.clinicianId))] } },
    select: { id: true, displayName: true },
  });
  const names = new Map(authors.map((a) => [a.id, a.displayName]));
  const content = clinicianContentOf(report);
  await audit(deps, {
    actorId: clinicianId,
    action: 'report.view',
    resourceType: 'report',
    resourceId: report.id,
  });
  return {
    reportId: report.id,
    status: report.status as ReportStatus,
    approvedAt: report.approvedAt.toISOString(),
    reviewedAt: report.reviewedAt ? report.reviewedAt.toISOString() : null,
    patient: report.session.patient,
    session: toSessionDto(report.session),
    content,
    transcript: messages.map((m) => ({
      turnId: m.turnId,
      sender: m.sender as Sender,
      text: m.redacted ? null : m.text,
      redacted: m.redacted,
      inputMode: m.inputMode as InputMode,
      createdAt: m.createdAt.toISOString(),
      hasSafetyEvent: flagged.has(m.turnId),
    })),
    notes: notes.map((n) => toNoteDto(n, names.get(n.clinicianId) ?? 'Clinician')),
    history: older.map((o) => {
      const c = clinicianContentOf(o);
      return {
        reportId: o.id,
        approvedAt: o.approvedAt!.toISOString(),
        phq9Total: c.screening.phq9.total,
        gad7Total: c.screening.gad7.total,
      };
    }),
  };
}

export async function markReviewed(
  deps: AppDeps,
  clinicianId: string,
  reportId: string,
): Promise<{ reviewedAt: string }> {
  const report = await getVisibleReport(deps, clinicianId, reportId);
  if (report.reviewedAt) return { reviewedAt: report.reviewedAt.toISOString() };
  const now = deps.clock.now();
  await deps.prisma.$transaction(async (tx) => {
    await tx.report.update({
      where: { id: report.id },
      data: { reviewedAt: now, reviewedById: clinicianId },
    });
    const from = report.session.state as SessionState;
    if (from !== 'CLINICIAN_REVIEWED') {
      assertTransition(from, 'CLINICIAN_REVIEWED');
      await tx.session.update({
        where: { id: report.sessionId },
        data: { state: 'CLINICIAN_REVIEWED' },
      });
    }
  });
  await audit(deps, {
    actorId: clinicianId,
    action: 'report.review',
    resourceType: 'report',
    resourceId: report.id,
  });
  return { reviewedAt: now.toISOString() };
}
