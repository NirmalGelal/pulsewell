import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ReportContentSchema, SUMMARY_SECTIONS } from '@pvc/shared';
import { runSeedDemo } from '../../prisma/seed-demo';
import { createTestContext } from './context';

async function counts(ctx: Awaited<ReturnType<typeof createTestContext>>) {
  const p = ctx.prisma;
  return {
    users: await p.user.count(),
    sessions: await p.session.count(),
    messages: await p.message.count(),
    reports: await p.report.count(),
    alerts: await p.alert.count(),
    events: await p.safetyEvent.count(),
    checklist: await p.checklistItem.count(),
  };
}

describe('seed:demo', () => {
  it('should be idempotent: running twice leaves stable counts', async () => {
    const ctx = await createTestContext();
    await runSeedDemo(ctx.prisma);
    const first = await counts(ctx);
    await runSeedDemo(ctx.prisma);
    expect(await counts(ctx)).toEqual(first);
    expect(first).toMatchObject({ sessions: 4, reports: 3, alerts: 1 });
  });

  it('should write valid reports whose quotes are verbatim and turns are patient turns', async () => {
    const ctx = await createTestContext();
    await runSeedDemo(ctx.prisma);
    const reports = await ctx.prisma.report.findMany();
    expect(reports).toHaveLength(3);
    for (const r of reports) {
      for (const json of [r.draftJson, r.currentJson]) {
        const c = ReportContentSchema.parse(JSON.parse(json));
        const msgs = await ctx.prisma.message.findMany({ where: { sessionId: r.sessionId } });
        const patientTurn = (t: number) =>
          msgs.find((m) => m.turnId === t && m.sender === 'PATIENT');
        for (const q of c.quotes) expect(patientTurn(q.turnId)?.text).toContain(q.text);
        const items = [...c.priorities, ...SUMMARY_SECTIONS.flatMap((s) => c.summary[s])];
        for (const it of items)
          for (const t of it.turnIds) expect(patientTurn(t), `turn ${t}`).toBeDefined();
        for (const f of c.risk.flags) expect(patientTurn(f.turnId)).toBeDefined();
      }
    }
  });

  it('should give Riley exactly one open imminent alert and no report', async () => {
    const ctx = await createTestContext();
    await runSeedDemo(ctx.prisma);
    const riley = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'patient3@demo.test' },
    });
    const alerts = await ctx.prisma.alert.findMany({ where: { patientId: riley.id } });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ level: 'imminent', acknowledgedAt: null });
    const s = await ctx.prisma.session.findFirstOrThrow({
      where: { patientId: riley.id },
      include: { report: true },
    });
    expect(s.state).toBe('CRISIS_PAUSED');
    expect(s.report).toBeNull();
  });

  it('should show the three scenarios on the clinician dashboard', async () => {
    const ctx = await createTestContext();
    await runSeedDemo(ctx.prisma);
    const login = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'clinician@demo.test', password: 'demo1234' });
    const auth = { Authorization: `Bearer ${login.body.token}` };
    const queue = await request(ctx.app).get('/api/clinician/queue').set(auth);
    expect(queue.status).toBe(200);
    const items = queue.body.items as {
      patient: { displayName: string };
      reviewed: boolean;
      riskLevel: string;
      trend: { phq9Delta: number; gad7Delta: number } | null;
    }[];
    const sam = items.find((i) => i.patient.displayName === 'Sam R.' && !i.reviewed)!;
    expect(sam.trend).toEqual({ phq9Delta: -4, gad7Delta: -3 });
    expect(items.find((i) => i.patient.displayName === 'Alex M.')!.riskLevel).toBe('elevated');
    const alerts = await request(ctx.app).get('/api/clinician/alerts').set(auth);
    expect(alerts.body.alerts).toHaveLength(1);
    expect(alerts.body.alerts[0].patient.displayName).toBe('Riley K.');
  });
});
