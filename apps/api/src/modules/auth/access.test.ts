import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../test/context';
import {
  assertLinked,
  getOwnedSession,
  isLinked,
  linkedClinicians,
  linkedPatientIds,
} from './access';

async function setup() {
  const ctx = await createTestContext();
  const session = await ctx.prisma.session.create({
    data: {
      patientId: ctx.users.patient.id,
      state: 'IN_PROGRESS',
      consentVersion: 'v1',
      consentedAt: ctx.clock.now(),
      cacheSalt: 'c2FsdA==',
    },
  });
  return { ...ctx, session };
}

describe('getOwnedSession', () => {
  it('should return own session', async () => {
    const { prisma, users, session } = await setup();
    expect((await getOwnedSession(prisma, users.patient.id, session.id)).id).toBe(session.id);
  });
  it("should 404 for another patient's session", async () => {
    const { prisma, users, session } = await setup();
    await expect(getOwnedSession(prisma, users.patient2.id, session.id)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
    });
  });
  it('should 404 for unknown id', async () => {
    const { prisma, users } = await setup();
    await expect(getOwnedSession(prisma, users.patient.id, 'nope')).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('isLinked / assertLinked', () => {
  it('true for linked pair, false for otherClinician', async () => {
    const { prisma, users } = await setup();
    expect(await isLinked(prisma, users.clinician.id, users.patient.id)).toBe(true);
    expect(await isLinked(prisma, users.otherClinician.id, users.patient.id)).toBe(false);
    await expect(
      assertLinked(prisma, users.otherClinician.id, users.patient.id),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      assertLinked(prisma, users.clinician.id, users.patient.id),
    ).resolves.toBeUndefined();
  });
  it('false when link active=false', async () => {
    const { prisma, users } = await setup();
    await prisma.careLink.updateMany({ data: { active: false } });
    expect(await isLinked(prisma, users.clinician.id, users.patient.id)).toBe(false);
    expect(await linkedPatientIds(prisma, users.clinician.id)).toEqual([]);
    expect(await linkedClinicians(prisma, users.patient.id)).toEqual([]);
  });
});

describe('linkedPatientIds / linkedClinicians', () => {
  it('returns both demo patients for clinician, [] for otherClinician', async () => {
    const { prisma, users } = await setup();
    const ids = await linkedPatientIds(prisma, users.clinician.id);
    expect(ids.sort()).toEqual([users.patient.id, users.patient2.id].sort());
    expect(await linkedPatientIds(prisma, users.otherClinician.id)).toEqual([]);
    expect(await linkedClinicians(prisma, users.patient.id)).toEqual([
      { id: users.clinician.id, displayName: 'Dr. Jordan Lee' },
    ]);
  });
});
