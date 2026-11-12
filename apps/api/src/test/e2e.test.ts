import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ClinicianReportDtoSchema,
  type ClinicianReportDto,
  type LlmRole,
  type MessageStreamEvent,
  type PatientReportDto,
} from '@pvc/shared';
import { DemoLlmClient } from '../modules/llm/demo-client';
import { MockLlmClient } from '../modules/llm/mock-client';
import type { LlmCallOptions } from '../modules/llm/types';
import { createTestContext, type TestContext } from './context';
import { parseSse } from './sse';

/** Realistic handlers: the demo client's deterministic behavior, with the safety role keyed to the message. */
function realisticLlm(): MockLlmClient {
  const demo = new DemoLlmClient();
  const llm = new MockLlmClient();
  for (const role of [
    'interviewer',
    'tracker',
    'reportWriter',
    'verifier',
    'assistant',
  ] as LlmRole[])
    llm.on(role, async (opts: LlmCallOptions) => (await demo.complete(role, opts)).text);
  llm.on('safety', () => ({ level: 'none', categories: [], evidence: '' }));
  return llm;
}

const state: {
  ctx: TestContext;
  sessionId: string;
  report: PatientReportDto;
  reportId: string;
  removedText: string;
  correctedId: string;
  followUpId: string;
  secondSession: string;
} = {} as never;

async function send(
  sessionId: string,
  body: Record<string, unknown>,
  who: 'patient' | 'patient2' = 'patient',
): Promise<MessageStreamEvent[]> {
  const res = await request(state.ctx.app)
    .post(`/api/sessions/${sessionId}/messages`)
    .set(state.ctx.auth[who])
    .send(body)
    .buffer(true)
    .parse((r, cb) => {
      let data = '';
      r.setEncoding('utf8');
      r.on('data', (c: string) => (data += c));
      r.on('end', () => cb(null, data));
    });
  expect(res.status).toBe(200);
  return parseSse(res.body as string);
}

const names = (events: MessageStreamEvent[]) => events.map((e) => e.event);

describe('end-to-end system flow', () => {
  beforeAll(async () => {
    state.ctx = await createTestContext({ llm: realisticLlm() });
  });

  it('step 1: patient logs in and creates a session with an opening message', async () => {
    const { ctx } = state;
    const login = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'patient@demo.test', password: 'demo1234' });
    expect(login.status).toBe(200);
    const res = await request(ctx.app)
      .post('/api/sessions')
      .set(ctx.auth.patient)
      .send({ consent: { accepted: true, version: 'v1' } });
    expect(res.status).toBe(201);
    expect(res.body.messages).toHaveLength(1);
    expect(res.body.messages[0]).toMatchObject({ turnId: 1, sender: 'COMPANION' });
    state.sessionId = res.body.session.id;
  });

  it('step 2: three messages stream in the right order and the checklist grows', async () => {
    const texts = [
      { text: 'I have been feeling really low and tired since the summer.', inputMode: 'TEXT' },
      { text: 'Nearly every day', inputMode: 'TAP', answerFor: { key: 'phq9_1', value: 3 } },
      { text: 'I sleep about four hours and I worry about work all the time.', inputMode: 'TEXT' },
    ];
    let lastCovered = -1;
    for (const body of texts) {
      const events = await send(state.sessionId, body);
      const order = names(events);
      expect(order[0]).toBe('patient_message');
      expect(order[1]).toBe('safety');
      expect(order.slice(-2)).toEqual(['companion_message', 'done']);
      expect(order.slice(2, -2).every((n) => n === 'token')).toBe(true);
      const done = events.at(-1)!;
      expect(done.event).toBe('done');
      if (done.event === 'done') {
        expect(done.data.progress.covered).toBeGreaterThanOrEqual(lastCovered);
        lastCovered = done.data.progress.covered;
      }
    }
    expect(lastCovered).toBeGreaterThan(0);
    const tapped = await state.ctx.prisma.checklistItem.findFirstOrThrow({
      where: { sessionId: state.sessionId, key: 'phq9_1' },
    });
    expect(tapped).toMatchObject({ value: 3, source: 'patient_tap' });
  });

  it('step 3: finish, edit (correct, remove, annotate) and approve', async () => {
    const { ctx } = state;
    const fin = await request(ctx.app)
      .post(`/api/sessions/${state.sessionId}/finish`)
      .set(ctx.auth.patient);
    expect(fin.status).toBe(200);
    const report = fin.body as PatientReportDto;
    expect(report.status).toBe('DRAFT');
    expect(report.content.screening.phq9.items[0]).toMatchObject({ key: 'phq9_1', value: 3 });
    expect(report.content.screening.phq9.complete).toBe(false);

    const chief = report.content.summary.chiefConcern[0]!;
    const present = report.content.summary.presentConcern[0]!;
    const quoteOfRemoved = report.content.quotes.find((q) => present.turnIds.includes(q.turnId));
    state.removedText = present.text;
    state.correctedId = chief.id;
    const edits = [
      {
        kind: 'correct',
        section: 'chiefConcern',
        itemId: chief.id,
        text: 'I feel low and very tired.',
      },
      { kind: 'remove', section: 'presentConcern', itemId: present.id },
      ...(quoteOfRemoved ? [{ kind: 'remove', section: 'quotes', itemId: quoteOfRemoved.id }] : []),
      { kind: 'annotate', section: 'screening', text: 'The sleep answer varies week to week.' },
    ];
    const edited = await request(ctx.app)
      .patch(`/api/sessions/${state.sessionId}/report`)
      .set(ctx.auth.patient)
      .send({ edits });
    expect(edited.status).toBe(200);

    const approved = await request(ctx.app)
      .post(`/api/sessions/${state.sessionId}/report/approve`)
      .set(ctx.auth.patient);
    expect(approved.status).toBe(200);
    expect(approved.body.session.state).toBe('SUBMITTED');
    state.report = approved.body.report;
    state.reportId = approved.body.report.reportId;
  });

  it('step 4: clinician sees the report with removed content stripped and redacted turns hidden', async () => {
    const { ctx } = state;
    const login = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'clinician@demo.test', password: 'demo1234' });
    expect(login.status).toBe(200);
    const queue = await request(ctx.app).get('/api/clinician/queue').set(ctx.auth.clinician);
    expect(queue.body.items.map((i: { reportId: string }) => i.reportId)).toContain(state.reportId);

    const res = await request(ctx.app)
      .get(`/api/clinician/reports/${state.reportId}`)
      .set(ctx.auth.clinician);
    expect(res.status).toBe(200);
    const dto = ClinicianReportDtoSchema.parse(res.body) as ClinicianReportDto;
    const removed = dto.content.summary.presentConcern.find((i) => i.removedByPatient);
    expect(removed).toMatchObject({ text: '', patientText: '', turnIds: [] });
    const chief = dto.content.summary.chiefConcern.find((i) => i.id === state.correctedId)!;
    expect(chief.patientCorrection).toBe('I feel low and very tired.');
    expect(dto.content.patientAnnotations.map((a) => a.section)).toContain('screening');
    const redacted = dto.transcript.filter((t) => t.redacted);
    expect(redacted.length).toBeGreaterThan(0);
    for (const t of redacted) expect(t.text).toBeNull();
    expect(JSON.stringify(dto)).not.toContain(state.removedText);
  });

  it('step 5: ask with valid citations, note, follow-up, mark reviewed', async () => {
    const { ctx } = state;
    const patientId = ctx.users.patient.id;
    const ask = await request(ctx.app)
      .post(`/api/clinician/patients/${patientId}/ask`)
      .set(ctx.auth.clinician)
      .send({ question: 'How has sleep changed?' });
    expect(ask.status).toBe(200);
    expect(ask.body.answer.length).toBeGreaterThan(0);
    const turnIds = (
      await ctx.prisma.message.findMany({ where: { sessionId: state.sessionId } })
    ).map((m) => m.turnId);
    for (const c of ask.body.citations) {
      expect(c.sessionId).toBe(state.sessionId);
      expect(turnIds).toContain(c.turnId);
    }

    const note = await request(ctx.app)
      .post(`/api/clinician/reports/${state.reportId}/notes`)
      .set(ctx.auth.clinician)
      .send({ text: 'Private clinical note about sleep.' });
    expect(note.status).toBe(201);

    const fu = await request(ctx.app)
      .post(`/api/clinician/patients/${patientId}/follow-ups`)
      .set(ctx.auth.clinician)
      .send({ questions: ['How is your appetite?'] });
    expect(fu.status).toBe(201);
    state.followUpId = fu.body.id;

    const rev = await request(ctx.app)
      .post(`/api/clinician/reports/${state.reportId}/review`)
      .set(ctx.auth.clinician);
    expect(rev.status).toBe(200);
    const s = await ctx.prisma.session.findUniqueOrThrow({ where: { id: state.sessionId } });
    expect(s.state).toBe('CLINICIAN_REVIEWED');
  });

  it('step 6: patient sees the follow-up; the next session mentions the clinician and marks it ASKED', async () => {
    const { ctx } = state;
    const list = await request(ctx.app).get('/api/patient/follow-ups').set(ctx.auth.patient);
    expect(list.body.followUps.map((f: { id: string }) => f.id)).toContain(state.followUpId);
    const res = await request(ctx.app)
      .post('/api/sessions')
      .set(ctx.auth.patient)
      .send({ consent: { accepted: true, version: 'v1' } });
    expect(res.status).toBe(201);
    expect(res.body.messages[0].text).toContain('Dr. Jordan Lee');
    state.secondSession = res.body.session.id;
    const fu = await ctx.prisma.followUp.findUniqueOrThrow({ where: { id: state.followUpId } });
    expect(fu.status).toBe('ASKED');
  });

  it('step 7: an imminent message triggers crisis, a clinician alert, and acknowledgement works', async () => {
    const { ctx } = state;
    const events = await send(state.secondSession, {
      text: "I'm going to end it tonight.",
      inputMode: 'TEXT',
    });
    const names2 = names(events);
    expect(names2).toContain('crisis');
    expect(names2).not.toContain('token');
    const alerts = await request(ctx.app).get('/api/clinician/alerts').set(ctx.auth.clinician);
    expect(alerts.body.alerts).toHaveLength(1);
    expect(alerts.body.alerts[0]).toMatchObject({ level: 'imminent', acknowledgedAt: null });
    const id = alerts.body.alerts[0].id as string;
    const ack = await request(ctx.app)
      .post(`/api/clinician/alerts/${id}/ack`)
      .set(ctx.auth.clinician);
    expect(ack.status).toBe(200);
    expect(ack.body.acknowledgedAt).not.toBeNull();
    const open = await request(ctx.app).get('/api/clinician/alerts').set(ctx.auth.clinician);
    expect(open.body.alerts).toHaveLength(0);
  });

  it('step 8: another clinician sees nothing', async () => {
    const { ctx } = state;
    const queue = await request(ctx.app).get('/api/clinician/queue').set(ctx.auth.otherClinician);
    expect(queue.body.items).toEqual([]);
    const rep = await request(ctx.app)
      .get(`/api/clinician/reports/${state.reportId}`)
      .set(ctx.auth.otherClinician);
    expect(rep.status).toBe(404);
    const alerts = await request(ctx.app)
      .get('/api/clinician/alerts?status=all')
      .set(ctx.auth.otherClinician);
    expect(alerts.body.alerts).toEqual([]);
  });

  it('step 9: the audit log has the expected actions and never contains message text', async () => {
    const { ctx } = state;
    const rows = await ctx.prisma.auditLog.findMany();
    const actions = new Set(rows.map((r) => r.action));
    for (const a of [
      'auth.login',
      'session.create',
      'message.create',
      'safety.event',
      'alert.create',
      'alert.ack',
      'report.generate',
      'report.edit',
      'report.approve',
      'report.view',
      'report.review',
      'note.create',
      'assistant.ask',
      'followup.create',
    ])
      expect(actions, a).toContain(a);
    const blob = rows.map((r) => r.meta ?? '').join('\n');
    const messages = await ctx.prisma.message.findMany();
    for (const m of messages) if (m.text.length > 8) expect(blob).not.toContain(m.text);
    expect(blob).not.toContain('Private clinical note');
    expect(blob).not.toContain('How has sleep changed');
    expect(blob).not.toContain('end it tonight');
  });
});
