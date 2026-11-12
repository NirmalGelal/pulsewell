import { maxRisk, riskRank, type RiskLevel } from '@pvc/shared';
import type { AppDeps } from '../../deps';

export interface PatientRow {
  id: string;
  displayName: string;
  lastApprovedAt: string | null;
  riskLevel: RiskLevel;
}

export async function listPatients(deps: AppDeps, clinicianId: string): Promise<PatientRow[]> {
  const links = await deps.prisma.careLink.findMany({
    where: { clinicianId, active: true },
    select: { patient: { select: { id: true, displayName: true } } },
  });
  const rows: PatientRow[] = [];
  for (const { patient } of links) {
    const [sessions, reports, openAlert] = await Promise.all([
      deps.prisma.session.findMany({
        where: { patientId: patient.id, state: { in: ['SUBMITTED', 'CLINICIAN_REVIEWED'] } },
        select: { riskLevel: true },
      }),
      deps.prisma.report.findMany({
        where: { status: 'APPROVED', session: { patientId: patient.id } },
        select: { approvedAt: true },
        orderBy: { approvedAt: 'desc' },
        take: 1,
      }),
      deps.prisma.alert.findFirst({
        where: { patientId: patient.id, acknowledgedAt: null },
        select: { id: true },
      }),
    ]);
    const risk = maxRisk(
      ...sessions.map((s) => s.riskLevel as RiskLevel),
      ...(openAlert ? (['imminent'] as RiskLevel[]) : []),
    );
    rows.push({
      id: patient.id,
      displayName: patient.displayName,
      lastApprovedAt: reports[0]?.approvedAt ? reports[0].approvedAt.toISOString() : null,
      riskLevel: risk,
    });
  }
  return rows.sort(
    (a, b) =>
      riskRank(b.riskLevel) - riskRank(a.riskLevel) || a.displayName.localeCompare(b.displayName),
  );
}
