import type { AlertDto } from '@pvc/shared';
import type { AppDeps } from '../../deps';
import { notFound } from '../../lib/errors';
import { audit } from '../audit/audit.service';
import { isLinked, linkedPatientIds } from '../auth/access';
import { toAlertDto } from './dto';

export async function listAlerts(
  deps: AppDeps,
  clinicianId: string,
  status: 'open' | 'all',
): Promise<AlertDto[]> {
  const patientIds = await linkedPatientIds(deps.prisma, clinicianId);
  const rows = await deps.prisma.alert.findMany({
    where: {
      patientId: { in: patientIds },
      ...(status === 'open' ? { acknowledgedAt: null } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
  const users = await deps.prisma.user.findMany({
    where: { id: { in: patientIds } },
    select: { id: true, displayName: true },
  });
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((a) =>
    toAlertDto(a, byId.get(a.patientId) ?? { id: a.patientId, displayName: 'Patient' }),
  );
}

export async function acknowledgeAlert(
  deps: AppDeps,
  clinicianId: string,
  alertId: string,
): Promise<AlertDto> {
  let alert = await deps.prisma.alert.findUnique({ where: { id: alertId } });
  if (!alert || !(await isLinked(deps.prisma, clinicianId, alert.patientId)))
    throw notFound('Alert not found');
  if (!alert.acknowledgedAt) {
    alert = await deps.prisma.alert.update({
      where: { id: alert.id },
      data: { acknowledgedAt: deps.clock.now(), acknowledgedById: clinicianId },
    });
    await audit(deps, {
      actorId: clinicianId,
      action: 'alert.ack',
      resourceType: 'alert',
      resourceId: alert.id,
    });
  }
  const patient = await deps.prisma.user.findUniqueOrThrow({
    where: { id: alert.patientId },
    select: { id: true, displayName: true },
  });
  return toAlertDto(alert, patient);
}
