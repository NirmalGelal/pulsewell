import { randomInt } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { CreatePatientRequest, CreatePatientResponse } from '@pvc/shared';
import type { AppDeps } from '../../deps';
import { conflict, notFound } from '../../lib/errors';
import { audit } from '../audit/audit.service';
import { hashPassword } from '../auth/auth.service';

// No 0/O, 1/l/I, or other look-alikes, so the password can be read aloud or typed from paper.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const LENGTH = 12;

export function generateTemporaryPassword(): string {
  let out = '';
  for (let i = 0; i < LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export async function createPatient(
  deps: AppDeps,
  clinicianId: string,
  input: CreatePatientRequest,
): Promise<CreatePatientResponse> {
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  let patient;
  try {
    patient = await deps.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: input.email,
          displayName: input.displayName,
          role: 'PATIENT',
          passwordHash,
          mustChangePassword: true,
        },
      });
      await tx.careLink.create({ data: { patientId: user.id, clinicianId, active: true } });
      return user;
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
      throw conflict('An account with that email already exists', [
        { path: 'email', message: 'An account with that email already exists' },
      ]);
    throw e;
  }
  await audit(deps, {
    actorId: clinicianId,
    action: 'patient.create',
    resourceType: 'user',
    resourceId: patient.id,
  });
  return {
    patient: { id: patient.id, email: patient.email, displayName: patient.displayName },
    temporaryPassword,
  };
}

export async function resetPatientPassword(
  deps: AppDeps,
  clinicianId: string,
  patientId: string,
): Promise<{ temporaryPassword: string }> {
  const link = await deps.prisma.careLink.findFirst({
    where: { clinicianId, patientId, active: true, patient: { role: 'PATIENT' } },
    select: { id: true },
  });
  if (!link) throw notFound('Patient not found');
  const temporaryPassword = generateTemporaryPassword();
  await deps.prisma.user.update({
    where: { id: patientId },
    data: { passwordHash: await hashPassword(temporaryPassword), mustChangePassword: true },
  });
  await audit(deps, {
    actorId: clinicianId,
    action: 'patient.reset_password',
    resourceType: 'user',
    resourceId: patientId,
  });
  return { temporaryPassword };
}
