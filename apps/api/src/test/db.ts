import { PrismaClient } from '@prisma/client';

let prisma: PrismaClient | undefined;

/** Shared PrismaClient singleton for tests (per test file / module instance). */
export function getTestPrisma(): PrismaClient {
  prisma ??= new PrismaClient({ datasources: { db: { url: 'file:./test.db' } } });
  return prisma;
}

/** Deletes all rows from every table in FK-safe order (children first). */
export async function resetDb(p: PrismaClient): Promise<void> {
  await p.$transaction([
    p.auditLog.deleteMany(),
    p.alert.deleteMany(),
    p.safetyEvent.deleteMany(),
    p.clinicianNote.deleteMany(),
    p.reportEdit.deleteMany(),
    p.report.deleteMany(),
    p.checklistItem.deleteMany(),
    p.message.deleteMany(),
    p.followUp.deleteMany(),
    p.session.deleteMany(),
    p.careLink.deleteMany(),
    p.user.deleteMany(),
  ]);
}
