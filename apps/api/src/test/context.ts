import type { Express } from 'express';
import type { PrismaClient, User } from '@prisma/client';
import type { Role } from '@pvc/shared';
import { hashPassword, signToken } from '../modules/auth/auth.service';
import { createApp } from '../app';
import { loadConfig } from '../config/env';
import type { AppDeps } from '../deps';
import { FixedClock } from '../lib/clock';
import { createLogger } from '../lib/logger';
import { MockLlmClient } from '../modules/llm/mock-client';
import type { LlmClient } from '../modules/llm/types';
import { getTestPrisma, resetDb } from './db';

export interface TestContext {
  app: Express;
  deps: AppDeps;
  prisma: PrismaClient;
  clock: FixedClock;
  llm: LlmClient;
  users: Record<TestUserKey, User>;
  auth: Record<TestUserKey, { Authorization: string }>;
}

export type TestUserKey = 'patient' | 'patient2' | 'clinician' | 'otherClinician';

export const TEST_START = '2026-11-11T18:00:00Z';

/** Resets the DB, then builds an app with a FixedClock and a MockLlmClient unless overridden. */
export async function createTestContext(overrides: Partial<AppDeps> = {}): Promise<TestContext> {
  const prisma = overrides.prisma ?? getTestPrisma();
  await resetDb(prisma);
  const clock = new FixedClock(TEST_START);
  const config = overrides.config ?? loadConfig();
  const deps: AppDeps = {
    config,
    prisma,
    llm: new MockLlmClient(),
    clock,
    logger: createLogger('silent'),
    ...overrides,
  };
  const app = createApp(deps);

  const passwordHash = await hashPassword('demo1234');
  const mk = (email: string, role: Role, displayName: string) =>
    prisma.user.create({ data: { email, role, displayName, passwordHash } });
  const patient = await mk('patient@demo.test', 'PATIENT', 'Sam R.');
  const patient2 = await mk('patient2@demo.test', 'PATIENT', 'Alex M.');
  const clinician = await mk('clinician@demo.test', 'CLINICIAN', 'Dr. Jordan Lee');
  const otherClinician = await mk('other.clinician@demo.test', 'CLINICIAN', 'Dr. Other');
  for (const p of [patient, patient2])
    await prisma.careLink.create({ data: { patientId: p.id, clinicianId: clinician.id } });
  const users = { patient, patient2, clinician, otherClinician };
  const bearer = (u: User) => ({
    Authorization: `Bearer ${signToken(config, { id: u.id, role: u.role as Role })}`,
  });
  const auth = {
    patient: bearer(patient),
    patient2: bearer(patient2),
    clinician: bearer(clinician),
    otherClinician: bearer(otherClinician),
  };
  return { app, deps, prisma, clock: deps.clock as FixedClock, llm: deps.llm, users, auth };
}
