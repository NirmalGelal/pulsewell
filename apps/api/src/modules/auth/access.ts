import type { PrismaClient, Session } from '@prisma/client';
import { notFound } from '../../lib/errors';

export async function getOwnedSession(
  prisma: PrismaClient,
  patientId: string,
  sessionId: string,
): Promise<Session> {
  const s = await prisma.session.findUnique({ where: { id: sessionId } });
  if (!s || s.patientId !== patientId) throw notFound('Session not found');
  return s;
}

export async function isLinked(
  prisma: PrismaClient,
  clinicianId: string,
  patientId: string,
): Promise<boolean> {
  const l = await prisma.careLink.findFirst({
    where: { clinicianId, patientId, active: true },
    select: { id: true },
  });
  return l !== null;
}

export async function assertLinked(
  prisma: PrismaClient,
  clinicianId: string,
  patientId: string,
): Promise<void> {
  if (!(await isLinked(prisma, clinicianId, patientId))) throw notFound();
}

export async function linkedPatientIds(
  prisma: PrismaClient,
  clinicianId: string,
): Promise<string[]> {
  const rows = await prisma.careLink.findMany({
    where: { clinicianId, active: true },
    select: { patientId: true },
  });
  return rows.map((r) => r.patientId);
}

export async function linkedClinicians(
  prisma: PrismaClient,
  patientId: string,
): Promise<{ id: string; displayName: string }[]> {
  const rows = await prisma.careLink.findMany({
    where: { patientId, active: true },
    select: { clinician: { select: { id: true, displayName: true } } },
  });
  return rows.map((r) => r.clinician);
}
