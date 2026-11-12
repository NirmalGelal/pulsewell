import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../test/context';
import { resetDb } from '../../test/db';
import { runSeed } from '../../../prisma/seed';
import { verifyPassword } from './auth.service';

describe('seed', () => {
  it('running the seed function twice should yield exactly 3 users and 2 links', async () => {
    const { prisma } = await createTestContext();
    await resetDb(prisma);
    await runSeed(prisma);
    await runSeed(prisma);
    expect(await prisma.user.count()).toBe(3);
    expect(await prisma.careLink.count()).toBe(2);
    const u = await prisma.user.findUniqueOrThrow({ where: { email: 'patient@demo.test' } });
    expect(await verifyPassword('demo1234', u.passwordHash)).toBe(true);
  });
});
