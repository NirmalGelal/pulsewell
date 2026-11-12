import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/modules/auth/auth.service';

const PASSWORD = 'demo1234';
const USERS = [
  { email: 'patient@demo.test', role: 'PATIENT', displayName: 'Sam R.' },
  { email: 'patient2@demo.test', role: 'PATIENT', displayName: 'Alex M.' },
  { email: 'clinician@demo.test', role: 'CLINICIAN', displayName: 'Dr. Jordan Lee' },
] as const;

/** Idempotent: upserts demo users by email and ensures both patients link to the clinician. */
export async function runSeed(prisma: PrismaClient): Promise<void> {
  const ids: Record<string, string> = {};
  for (const u of USERS) {
    const passwordHash = await hashPassword(PASSWORD);
    const row = await prisma.user.upsert({
      where: { email: u.email },
      update: { role: u.role, displayName: u.displayName, passwordHash },
      create: { ...u, passwordHash },
    });
    ids[u.email] = row.id;
  }
  const clinicianId = ids['clinician@demo.test']!;
  for (const email of ['patient@demo.test', 'patient2@demo.test']) {
    const patientId = ids[email]!;
    await prisma.careLink.upsert({
      where: { patientId_clinicianId: { patientId, clinicianId } },
      update: { active: true },
      create: { patientId, clinicianId },
    });
  }
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    await runSeed(prisma);
    console.table(
      USERS.map((u) => ({ email: u.email, role: u.role, name: u.displayName, password: PASSWORD })),
    );
    console.log('Care links: patient@demo.test, patient2@demo.test -> clinician@demo.test');
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
