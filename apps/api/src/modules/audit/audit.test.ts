import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createTestContext } from '../../test/context';
import { audit } from './audit.service';

describe('audit', () => {
  it('should insert an audit row with JSON meta', async () => {
    const { deps, prisma, users } = await createTestContext();
    await audit(deps, {
      actorId: users.patient.id,
      action: 'session.create',
      resourceType: 'session',
      resourceId: 's1',
      meta: { n: 1, ok: true, k: 'v' },
    });
    const row = await prisma.auditLog.findFirstOrThrow();
    expect(row.action).toBe('session.create');
    expect(row.resourceId).toBe('s1');
    expect(JSON.parse(row.meta!)).toEqual({ n: 1, ok: true, k: 'v' });
    expect(row.createdAt.toISOString()).toBe(deps.clock.now().toISOString());
  });

  it('should not throw when prisma fails, and should log a warning', async () => {
    const { deps } = await createTestContext();
    const warn = vi.fn();
    const stub = { auditLog: { create: () => Promise.reject(new Error('db down')) } };
    await expect(
      audit(
        {
          prisma: stub as unknown as PrismaClient,
          clock: deps.clock,
          logger: { ...deps.logger, warn },
        },
        { actorId: null, action: 'auth.login', resourceType: 'auth' },
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('audit_failed', { action: 'auth.login' });
  });

  it('should drop meta values over 200 chars', async () => {
    const { deps, prisma } = await createTestContext();
    await audit(deps, {
      actorId: null,
      action: 'note.create',
      resourceType: 'note',
      meta: { long: 'x'.repeat(201), keep: 'y'.repeat(200) },
    });
    const row = await prisma.auditLog.findFirstOrThrow();
    expect(JSON.parse(row.meta!)).toEqual({ keep: 'y'.repeat(200) });
  });
});
