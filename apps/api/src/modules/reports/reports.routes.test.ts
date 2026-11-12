import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { PatientReportDtoSchema } from '@pvc/shared';
import { createTestContext, type TestContext } from '../../test/context';
import { DemoLlmClient } from '../llm/demo-client';
import { MockLlmClient } from '../llm/mock-client';

const writerOut = (extra: Record<string, unknown> = {}) => ({
  priorities: [
    { text: 'Wants help with sleep.', patientText: 'You want help with sleep.', turnIds: [4] },
  ],
  summary: {
    moodAnxiety: [
      { text: 'Reports low mood.', patientText: 'You said you feel low.', turnIds: [2] },
    ],
    history: [
      { text: 'Reports prior therapy.', patientText: 'You had therapy before.', turnIds: [6] },
    ],
  },
  quotes: [
    { text: 'I feel low and tired.', turnId: 2 },
    { text: 'invented sentence', turnId: 2 },
  ],
  notDiscussed: ['supports'],
  ...extra,
});

async function setup(
  llm = new MockLlmClient().on('reportWriter', writerOut()).on('verifier', { unsupported: [] }),
  state = 'INTERVIEWING',
) {
  const ctx = await createTestContext({ llm });
  const session = await ctx.prisma.session.create({
    data: {
      patientId: ctx.users.patient.id,
      state,
      consentVersion: 'v1',
      consentedAt: ctx.clock.now(),
      cacheSalt: 'salt',
      nextTurnId: 7,
    },
  });
  const texts: [string, string][] = [
    ['COMPANION', 'Hi, what brings you in?'],
    ['PATIENT', 'I feel low and tired.'],
    ['COMPANION', 'How is sleep?'],
    ['PATIENT', 'I barely sleep, I want help with that.'],
    ['COMPANION', 'Any past treatment?'],
    ['PATIENT', 'I did therapy two years ago.'],
  ];
  for (const [i, [sender, text]] of texts.entries())
    await ctx.prisma.message.create({
      data: { sessionId: session.id, turnId: i + 1, sender, text, inputMode: 'TEXT' },
    });
  return { ctx, llm, session };
}
const finish = (ctx: TestContext, id: string, who: 'patient' | 'patient2' = 'patient') =>
  request(ctx.app).post(`/api/sessions/${id}/finish`).set(ctx.auth[who]);

describe('POST /sessions/:id/finish', () => {
  it('should create a DRAFT report, move to PATIENT_REVIEW and audit', async () => {
    const { ctx, session } = await setup();
    const res = await finish(ctx, session.id);
    expect(res.status).toBe(200);
    expect(PatientReportDtoSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.status).toBe('DRAFT');
    expect(res.body.content.quotes.map((q: { text: string }) => q.text)).toEqual([
      'I feel low and tired.',
    ]);
    const s = await ctx.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(s.state).toBe('PATIENT_REVIEW');
    expect(s.endedAt).not.toBeNull();
    const r = await ctx.prisma.report.findUniqueOrThrow({ where: { sessionId: session.id } });
    expect(r.draftJson).toBe(r.currentJson);
    const log = await ctx.prisma.auditLog.findFirst({ where: { action: 'report.generate' } });
    expect(JSON.parse(log!.meta!)).toMatchObject({ quotesRemoved: 1, regenerated: false });
  });

  it('should regenerate once on unsupported items and remove those still unsupported', async () => {
    const llm = new MockLlmClient()
      .on('reportWriter', writerOut())
      .once('verifier', { unsupported: [{ itemId: 'history-1', reason: 'not said' }] })
      .once('verifier', { unsupported: [{ itemId: 'moodAnxiety-1', reason: 'still bad' }] });
    const { ctx, session } = await setup(llm);
    const res = await finish(ctx, session.id);
    expect(res.status).toBe(200);
    expect(llm.calls.filter((c) => c.role === 'reportWriter')).toHaveLength(2);
    expect(llm.calls.filter((c) => c.role === 'verifier')).toHaveLength(2);
    expect(llm.calls[2]!.opts.messages[1]!.content).toContain('history-1:');
    expect(res.body.content.provenance.verification.regenerated).toBe(true);
    expect(res.body.content.summary.moodAnxiety).toEqual([]);
    expect(res.body.content.summary.history).toHaveLength(1);
    expect(res.body.content.provenance.verification.claimsRemoved).toBe(1);
  });

  it('should return 503 and stay GENERATING_REPORT when the writer fails, then succeed on retry', async () => {
    const llm = new MockLlmClient()
      .on('reportWriter', writerOut())
      .on('verifier', { unsupported: [] })
      .fail('reportWriter', 1);
    const { ctx, session } = await setup(llm);
    const bad = await finish(ctx, session.id);
    expect(bad.status).toBe(503);
    expect(bad.body.error.code).toBe('LLM_UNAVAILABLE');
    const s = await ctx.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(s.state).toBe('GENERATING_REPORT');
    expect((await finish(ctx, session.id)).status).toBe(200);
  });

  it('should reject sessions without patient messages with 409', async () => {
    const ctx = await createTestContext();
    const s = await ctx.prisma.session.create({
      data: {
        patientId: ctx.users.patient.id,
        state: 'INTERVIEWING',
        consentVersion: 'v1',
        consentedAt: ctx.clock.now(),
        cacheSalt: 'x',
      },
    });
    await ctx.prisma.message.create({
      data: { sessionId: s.id, turnId: 1, sender: 'COMPANION', text: 'Hi', inputMode: 'TEXT' },
    });
    const res = await finish(ctx, s.id);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe("There's nothing to summarize yet");
  });

  it('should return 409 from PATIENT_REVIEW and 404 for another patient', async () => {
    const { ctx, session } = await setup();
    expect((await finish(ctx, session.id)).status).toBe(200);
    expect((await finish(ctx, session.id)).status).toBe(409);
    expect((await finish(ctx, session.id, 'patient2')).status).toBe(404);
  });

  it('should work from CRISIS_PAUSED with imminent risk flags from safety events', async () => {
    const { ctx, session } = await setup(undefined, 'CRISIS_PAUSED');
    await ctx.prisma.session.update({ where: { id: session.id }, data: { riskLevel: 'imminent' } });
    await ctx.prisma.safetyEvent.create({
      data: {
        sessionId: session.id,
        turnId: 4,
        level: 'imminent',
        categories: '["suicidal_ideation"]',
        evidence: 'want help',
        source: 'keyword',
      },
    });
    const res = await finish(ctx, session.id);
    expect(res.status).toBe(200);
    expect(res.body.content.risk.level).toBe('imminent');
    expect(res.body.content.risk.flags[0]).toMatchObject({
      category: 'suicidal_ideation',
      evidence: 'want help',
      turnId: 4,
    });
  });
});

describe('demo mode', () => {
  it('should produce a schema-valid report with the DemoLlmClient', async () => {
    const { ctx, session } = await setup(new DemoLlmClient() as unknown as MockLlmClient);
    const res = await finish(ctx, session.id);
    expect(res.status).toBe(200);
    expect(res.body.content.provenance.writerModel).toBe('demo-reportWriter');
    expect(res.body.content.summary.chiefConcern.length).toBeGreaterThan(0);
  });
});

describe('report review', () => {
  it('should apply edits, keep draftJson unchanged and reject invalid batches atomically', async () => {
    const { ctx, session } = await setup();
    const draft = (await finish(ctx, session.id)).body;
    const patch = (edits: unknown) =>
      request(ctx.app)
        .patch(`/api/sessions/${session.id}/report`)
        .set(ctx.auth.patient)
        .send({ edits });
    const ok = await patch([
      {
        kind: 'correct',
        section: 'moodAnxiety',
        itemId: 'moodAnxiety-1',
        text: 'Low for a month.',
      },
      { kind: 'annotate', section: 'risk', text: 'Note.' },
    ]);
    expect(ok.status).toBe(200);
    expect(ok.body.content.summary.moodAnxiety[0].patientCorrection).toBe('Low for a month.');
    expect(await ctx.prisma.reportEdit.count()).toBe(2);
    const bad = await patch([
      { kind: 'remove', section: 'history', itemId: 'history-1' },
      { kind: 'remove', section: 'history', itemId: 'history-99' },
    ]);
    expect(bad.status).toBe(400);
    const got = await request(ctx.app)
      .get(`/api/sessions/${session.id}/report`)
      .set(ctx.auth.patient);
    expect(got.body.content.summary.history[0].removedByPatient).toBeUndefined();
    expect(await ctx.prisma.reportEdit.count()).toBe(2);
    const r = await ctx.prisma.report.findUniqueOrThrow({ where: { sessionId: session.id } });
    expect(JSON.parse(r.draftJson)).toEqual(draft.content);
    expect((await patch([{ kind: 'remove', section: 'risk', itemId: 'x' }])).status).toBe(400);
  });

  it('should 404 GET without a report', async () => {
    const { ctx, session } = await setup();
    const res = await request(ctx.app)
      .get(`/api/sessions/${session.id}/report`)
      .set(ctx.auth.patient);
    expect(res.status).toBe(404);
  });

  it('should approve, redact removed-only turns, and then refuse edits and a second approval', async () => {
    const { ctx, session } = await setup();
    await finish(ctx, session.id);
    await request(ctx.app)
      .patch(`/api/sessions/${session.id}/report`)
      .set(ctx.auth.patient)
      .send({ edits: [{ kind: 'remove', section: 'history', itemId: 'history-1' }] });
    const res = await request(ctx.app)
      .post(`/api/sessions/${session.id}/report/approve`)
      .set(ctx.auth.patient);
    expect(res.status).toBe(200);
    expect(res.body.report.status).toBe('APPROVED');
    expect(res.body.session.state).toBe('SUBMITTED');
    const msgs = await ctx.prisma.message.findMany({
      where: { sessionId: session.id },
      orderBy: { turnId: 'asc' },
    });
    expect(msgs.filter((m) => m.redacted).map((m) => m.turnId)).toEqual([6]);
    const rep = await ctx.prisma.report.findUniqueOrThrow({ where: { sessionId: session.id } });
    expect(rep.approvedAt).not.toBeNull();
    expect(await ctx.prisma.auditLog.count({ where: { action: 'report.approve' } })).toBe(1);
    expect(
      (
        await request(ctx.app)
          .post(`/api/sessions/${session.id}/report/approve`)
          .set(ctx.auth.patient)
      ).status,
    ).toBe(409);
    const edit = await request(ctx.app)
      .patch(`/api/sessions/${session.id}/report`)
      .set(ctx.auth.patient)
      .send({ edits: [{ kind: 'annotate', section: 'history', text: 'late' }] });
    expect(edit.status).toBe(409);
  });

  it('should not redact a turn that has a safety event', async () => {
    const { ctx, session } = await setup();
    await ctx.prisma.safetyEvent.create({
      data: {
        sessionId: session.id,
        turnId: 6,
        level: 'concern',
        categories: '["self_harm"]',
        evidence: '',
        source: 'model',
      },
    });
    await finish(ctx, session.id);
    await request(ctx.app)
      .patch(`/api/sessions/${session.id}/report`)
      .set(ctx.auth.patient)
      .send({ edits: [{ kind: 'remove', section: 'history', itemId: 'history-1' }] });
    await request(ctx.app).post(`/api/sessions/${session.id}/report/approve`).set(ctx.auth.patient);
    expect(
      await ctx.prisma.message.count({ where: { sessionId: session.id, redacted: true } }),
    ).toBe(0);
  });
});
