import { buildReportContent, type DeepPartial, type ReportContent } from '@pvc/shared';
import { toJson } from '../../lib/json';
import type { TestContext } from '../../test/context';

export interface SeedOpts {
  patientKey?: 'patient' | 'patient2';
  status?: 'APPROVED' | 'DRAFT';
  approvedAt?: string;
  reviewedAt?: string | null;
  riskLevel?: string;
  content?: DeepPartial<ReportContent>;
  /** [sender, text, redacted?] — turnIds are 1-based in order */
  turns?: [string, string, boolean?][];
}

const DEFAULT_TURNS: [string, string, boolean?][] = [
  ['COMPANION', 'Hi, what brings you in?'],
  ['PATIENT', 'I just feel tired all the time'],
  ['COMPANION', 'How is sleep?'],
  ['PATIENT', 'I sleep about four hours a night.'],
];

/** Creates a session + report (+ messages) directly with Prisma. */
export async function seedReport(ctx: TestContext, o: SeedOpts = {}) {
  const patient = ctx.users[o.patientKey ?? 'patient'];
  const status = o.status ?? 'APPROVED';
  const turns = o.turns ?? DEFAULT_TURNS;
  const state =
    status === 'DRAFT' ? 'PATIENT_REVIEW' : o.reviewedAt ? 'CLINICIAN_REVIEWED' : 'SUBMITTED';
  const session = await ctx.prisma.session.create({
    data: {
      patientId: patient.id,
      state,
      consentVersion: 'v1',
      consentedAt: ctx.clock.now(),
      cacheSalt: 'salt',
      nextTurnId: turns.length + 1,
      riskLevel: o.riskLevel ?? 'none',
    },
  });
  for (const [i, [sender, text, redacted]] of turns.entries())
    await ctx.prisma.message.create({
      data: {
        sessionId: session.id,
        turnId: i + 1,
        sender,
        text,
        inputMode: 'TEXT',
        redacted: redacted ?? false,
      },
    });
  const content = buildReportContent({
    patient: { displayName: patient.displayName },
    session: { id: session.id },
    ...o.content,
  });
  const json = toJson(content);
  const report = await ctx.prisma.report.create({
    data: {
      sessionId: session.id,
      status,
      draftJson: json,
      currentJson: json,
      approvedAt: status === 'APPROVED' ? new Date(o.approvedAt ?? '2026-11-10T12:00:00Z') : null,
      reviewedAt: o.reviewedAt ? new Date(o.reviewedAt) : null,
    },
  });
  return { session, report, patient };
}
