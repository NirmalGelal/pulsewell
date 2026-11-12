import { describe, expect, it } from 'vitest';
import { createTestContext } from './context';
import { resetDb } from './db';

describe('test db', () => {
  it('should create and read a User', async () => {
    const { prisma } = await createTestContext();
    const u = await prisma.user.create({
      data: { email: 'a@b.test', passwordHash: 'x', role: 'PATIENT', displayName: 'A' },
    });
    const found = await prisma.user.findUnique({ where: { id: u.id } });
    expect(found?.email).toBe('a@b.test');
  });
  it('resetDb should empty all tables', async () => {
    const { prisma, clock } = await createTestContext();
    const u = await prisma.user.create({
      data: { email: 'a@b.test', passwordHash: 'x', role: 'PATIENT', displayName: 'A' },
    });
    const s = await prisma.session.create({
      data: {
        patientId: u.id,
        state: 'INTERVIEWING',
        consentVersion: 'v1',
        consentedAt: clock.now(),
        cacheSalt: 's',
      },
    });
    await prisma.message.create({
      data: { sessionId: s.id, turnId: 1, sender: 'PATIENT', text: 'hi', inputMode: 'TEXT' },
    });
    await prisma.auditLog.create({ data: { action: 'x', resourceType: 'y' } });
    await resetDb(prisma);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.message.count()).toBe(0);
    expect(await prisma.auditLog.count()).toBe(0);
  });
  it('createTestContext should use a FixedClock at 2026-11-11T18:00:00Z', async () => {
    const ctx = await createTestContext();
    expect(ctx.clock.now().toISOString()).toBe('2026-11-11T18:00:00.000Z');
  });
});
