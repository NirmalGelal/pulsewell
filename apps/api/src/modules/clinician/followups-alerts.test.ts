import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestContext, type TestContext } from '../../test/context';
import { MockLlmClient } from '../llm/mock-client';
import { seedReport } from './test-utils';

async function makeAlert(ctx: TestContext, patientId: string, evidence = 'x') {
  const session = (
    await seedReport(ctx, {
      status: 'DRAFT',
      patientKey: patientId === ctx.users.patient.id ? 'patient' : 'patient2',
    })
  ).session;
  const ev = await ctx.prisma.safetyEvent.create({
    data: {
      sessionId: session.id,
      turnId: 2,
      level: 'imminent',
      categories: '[]',
      evidence,
      source: 'keyword',
    },
  });
  return ctx.prisma.alert.create({
    data: { sessionId: session.id, patientId, safetyEventId: ev.id, level: 'imminent', evidence },
  });
}

describe('follow-ups', () => {
  it('should create a follow-up (1-3 questions), show it to the patient, and mark it ASKED on a new session', async () => {
    const llm = new MockLlmClient()
      .on('safety', { level: 'none', categories: [], evidence: '' })
      .on('tracker', { updates: [] })
      .on('interviewer', 'ok');
    const ctx = await createTestContext({ llm });
    const url = `/api/clinician/patients/${ctx.users.patient.id}/follow-ups`;
    const res = await request(ctx.app)
      .post(url)
      .set(ctx.auth.clinician)
      .send({ questions: ['How is sleep?', 'Any new stressors?'] });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'PENDING',
      questions: ['How is sleep?', 'Any new stressors?'],
      clinician: { displayName: 'Dr. Jordan Lee' },
    });
    expect(await ctx.prisma.auditLog.count({ where: { action: 'followup.create' } })).toBe(1);
    for (const questions of [[], ['a', 'b', 'c', 'd'].map((x) => x.repeat(5)), ['ab']])
      expect(
        (await request(ctx.app).post(url).set(ctx.auth.clinician).send({ questions })).status,
      ).toBe(400);
    expect(
      (
        await request(ctx.app)
          .post(url)
          .set(ctx.auth.otherClinician)
          .send({ questions: ['Valid q?'] })
      ).status,
    ).toBe(404);

    const list = await request(ctx.app).get('/api/patient/follow-ups').set(ctx.auth.patient);
    expect(list.body.followUps).toHaveLength(1);
    await request(ctx.app)
      .post('/api/sessions')
      .set(ctx.auth.patient)
      .send({ consent: { accepted: true, version: 'v1' } })
      .expect(201);
    const row = await ctx.prisma.followUp.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(row.status).toBe('ASKED');
  });
});

describe('alerts', () => {
  it('should list alerts of linked patients only, status=all includes acknowledged', async () => {
    const ctx = await createTestContext();
    const a1 = await makeAlert(ctx, ctx.users.patient.id, 'phrase one');
    await ctx.prisma.careLink.updateMany({
      where: { patientId: ctx.users.patient2.id },
      data: { active: false },
    });
    await makeAlert(ctx, ctx.users.patient2.id);
    const open = await request(ctx.app).get('/api/clinician/alerts').set(ctx.auth.clinician);
    expect(open.status).toBe(200);
    expect(open.body.alerts).toHaveLength(1);
    expect(open.body.alerts[0]).toMatchObject({
      id: a1.id,
      evidence: 'phrase one',
      level: 'imminent',
      patient: { displayName: 'Sam R.' },
      acknowledgedAt: null,
    });
    await request(ctx.app)
      .post(`/api/clinician/alerts/${a1.id}/ack`)
      .set(ctx.auth.clinician)
      .expect(200);
    const openAfter = await request(ctx.app)
      .get('/api/clinician/alerts?status=open')
      .set(ctx.auth.clinician);
    expect(openAfter.body.alerts).toHaveLength(0);
    const all = await request(ctx.app)
      .get('/api/clinician/alerts?status=all')
      .set(ctx.auth.clinician);
    expect(all.body.alerts).toHaveLength(1);
    expect(all.body.alerts[0].acknowledgedAt).not.toBeNull();
    expect(
      (await request(ctx.app).get('/api/clinician/alerts?status=zzz').set(ctx.auth.clinician))
        .status,
    ).toBe(400);
  });

  it('should make ack idempotent and 404 for unlinked clinicians', async () => {
    const ctx = await createTestContext();
    const a = await makeAlert(ctx, ctx.users.patient.id);
    const url = `/api/clinician/alerts/${a.id}/ack`;
    expect((await request(ctx.app).post(url).set(ctx.auth.otherClinician)).status).toBe(404);
    const r1 = await request(ctx.app).post(url).set(ctx.auth.clinician);
    const r2 = await request(ctx.app).post(url).set(ctx.auth.clinician);
    expect(r2.body.acknowledgedAt).toBe(r1.body.acknowledgedAt);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'alert.ack' } })).toBe(1);
    const row = await ctx.prisma.alert.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.acknowledgedById).toBe(ctx.users.clinician.id);
  });

  it('should surface an imminent keyword message as an alert before any report exists', async () => {
    const llm = new MockLlmClient()
      .on('safety', { level: 'none', categories: [], evidence: '' })
      .on('tracker', { updates: [] })
      .on('interviewer', 'ok');
    const ctx = await createTestContext({ llm });
    const created = await request(ctx.app)
      .post('/api/sessions')
      .set(ctx.auth.patient)
      .send({ consent: { accepted: true, version: 'v1' } });
    await request(ctx.app)
      .post(`/api/sessions/${created.body.session.id}/messages`)
      .set(ctx.auth.patient)
      .send({ text: 'I am going to kill myself tonight', inputMode: 'TEXT' })
      .expect(200);
    const res = await request(ctx.app).get('/api/clinician/alerts').set(ctx.auth.clinician);
    expect(res.body.alerts).toHaveLength(1);
    expect(res.body.alerts[0].evidence.length).toBeGreaterThan(0);
    const queue = await request(ctx.app).get('/api/clinician/queue').set(ctx.auth.clinician);
    expect(queue.body.items).toEqual([]);
    const other = await request(ctx.app).get('/api/clinician/alerts').set(ctx.auth.otherClinician);
    expect(other.body.alerts).toEqual([]);
  });
});
