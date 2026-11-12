import { riskRank, type QueueItemDto, type ReportContent, type RiskLevel } from '@pvc/shared';
import type { AppDeps } from '../../deps';
import { linkedPatientIds } from '../auth/access';
import { clinicianContentOf } from './dto';

const delta = (cur: number | null, prev: number | null) =>
  cur === null || prev === null ? null : cur - prev;

export async function buildQueue(deps: AppDeps, clinicianId: string): Promise<QueueItemDto[]> {
  const patientIds = await linkedPatientIds(deps.prisma, clinicianId);
  if (patientIds.length === 0) return [];
  const reports = await deps.prisma.report.findMany({
    where: {
      status: 'APPROVED',
      approvedAt: { not: null },
      session: { patientId: { in: patientIds } },
    },
    include: { session: { include: { patient: { select: { id: true, displayName: true } } } } },
    orderBy: { approvedAt: 'desc' },
  });
  const openAlerts = await deps.prisma.alert.findMany({
    where: { patientId: { in: patientIds }, acknowledgedAt: null },
    select: { sessionId: true },
  });
  const alertSessions = new Set(openAlerts.map((a) => a.sessionId));
  const contents = new Map<string, ReportContent>(
    reports.map((r) => [r.id, clinicianContentOf(r)]),
  );

  const items = reports.map((r): QueueItemDto => {
    const c = contents.get(r.id)!;
    // reports are newest-first, so the previous report is the next one for that patient
    const prev = reports.find(
      (o) => o.session.patientId === r.session.patientId && o.approvedAt! < r.approvedAt!,
    );
    const pc = prev ? contents.get(prev.id)! : null;
    return {
      reportId: r.id,
      sessionId: r.sessionId,
      patient: r.session.patient,
      approvedAt: r.approvedAt!.toISOString(),
      riskLevel: c.risk.level,
      reviewed: r.reviewedAt !== null,
      phq9: { total: c.screening.phq9.total, band: c.screening.phq9.band },
      gad7: { total: c.screening.gad7.total, band: c.screening.gad7.band },
      topPriority: c.priorities.find((p) => !p.removedByPatient)?.text ?? null,
      trend: pc
        ? {
            phq9Delta: delta(c.screening.phq9.total, pc.screening.phq9.total),
            gad7Delta: delta(c.screening.gad7.total, pc.screening.gad7.total),
          }
        : null,
      hasUnacknowledgedAlert: alertSessions.has(r.sessionId),
    };
  });

  return items.sort(
    (a, b) =>
      Number(b.hasUnacknowledgedAlert) - Number(a.hasUnacknowledgedAlert) ||
      riskRank(b.riskLevel as RiskLevel) - riskRank(a.riskLevel as RiskLevel) ||
      Number(a.reviewed) - Number(b.reviewed) ||
      b.approvedAt.localeCompare(a.approvedAt),
  );
}
