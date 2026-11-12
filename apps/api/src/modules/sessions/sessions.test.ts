import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { SessionDetailDtoSchema } from '@pvc/shared';
import { createTestContext } from '../../test/context';

const CONSENT = { consent: { accepted: true, version: 'v1' } };

describe('sessions', () => {
  it('should create a session with opening message turn 1, state INTERVIEWING, and no cacheSalt', async () => {
    const { app, auth, prisma } = await createTestContext();
    const res = await request(app).post('/api/sessions').set(auth.patient).send(CONSENT);
    expect(res.status).toBe(201);
    const dto = SessionDetailDtoSchema.parse(res.body);
    expect(dto.session.state).toBe('INTERVIEWING');
    expect(dto.messages).toHaveLength(1);
    expect(dto.messages[0]).toMatchObject({ turnId: 1, sender: 'COMPANION' });
    expect(dto.messages[0]!.text).toMatch(/^Hi Sam\./);
    expect(JSON.stringify(res.body)).not.toMatch(/cacheSalt/);
    const row = await prisma.session.findFirstOrThrow();
    expect(row.cacheSalt.length).toBeGreaterThan(20);
    expect(JSON.parse(row.interviewState)).toMatchObject({
      lastFocus: 'chief_concern',
      attempts: { chief_concern: 1 },
    });
    expect(row.nextTurnId).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'session.create' } })).toBe(1);
  });

  it('should 400 on wrong consent version', async () => {
    const { app, auth } = await createTestContext();
    const res = await request(app)
      .post('/api/sessions')
      .set(auth.patient)
      .send({ consent: { accepted: true, version: 'v0' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should 409 when no care link exists', async () => {
    const { app, auth, prisma, users } = await createTestContext();
    await prisma.careLink.deleteMany({ where: { patientId: users.patient.id } });
    const res = await request(app).post('/api/sessions').set(auth.patient).send(CONSENT);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('should 409 with details.sessionId when an active session exists', async () => {
    const { app, auth } = await createTestContext();
    const first = await request(app).post('/api/sessions').set(auth.patient).send(CONSENT);
    const res = await request(app).post('/api/sessions').set(auth.patient).send(CONSENT);
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ sessionId: first.body.session.id });
  });

  it('should attach pending follow-ups and mention the clinician in the opening message', async () => {
    const { app, auth, prisma, users } = await createTestContext();
    const fu = await prisma.followUp.create({
      data: {
        patientId: users.patient.id,
        clinicianId: users.clinician.id,
        questions: JSON.stringify(['How is sleep?']),
        status: 'PENDING',
      },
    });
    const res = await request(app).get('/api/patient/follow-ups').set(auth.patient);
    expect(res.body.followUps).toHaveLength(1);
    expect(res.body.followUps[0]).toMatchObject({ id: fu.id, questions: ['How is sleep?'] });
    const created = await request(app).post('/api/sessions').set(auth.patient).send(CONSENT);
    expect(created.body.messages[0].text).toContain('Dr. Jordan Lee also asked me to check in');
    const row = await prisma.followUp.findUniqueOrThrow({ where: { id: fu.id } });
    expect(row.status).toBe('ASKED');
    expect(row.askedInSessionId).toBe(created.body.session.id);
    const s = await prisma.session.findFirstOrThrow();
    expect(JSON.parse(s.interviewState).followUpQuestions).toEqual(['How is sleep?']);
    const after = await request(app).get('/api/patient/follow-ups').set(auth.patient);
    expect(after.body.followUps).toHaveLength(0);
  });

  it('should return 403 for a clinician creating a session', async () => {
    const { app, auth } = await createTestContext();
    const res = await request(app).post('/api/sessions').set(auth.clinician).send(CONSENT);
    expect(res.status).toBe(403);
  });

  it('should 404 when another patient reads a session', async () => {
    const { app, auth } = await createTestContext();
    const c = await request(app).post('/api/sessions').set(auth.patient).send(CONSENT);
    const res = await request(app).get(`/api/sessions/${c.body.session.id}`).set(auth.patient2);
    expect(res.status).toBe(404);
    const own = await request(app).get(`/api/sessions/${c.body.session.id}`).set(auth.patient);
    expect(own.status).toBe(200);
    expect(own.body.hasReport).toBe(false);
    expect(own.body.pendingItem).toBeNull();
  });

  it('should list sessions newest first with reportStatus', async () => {
    const { app, auth, prisma, users, clock } = await createTestContext();
    const mk = (startedAt: Date, state: string) =>
      prisma.session.create({
        data: {
          patientId: users.patient.id,
          state,
          consentVersion: 'v1',
          consentedAt: startedAt,
          cacheSalt: 's',
          startedAt,
        },
      });
    const old = await mk(new Date(clock.now().getTime() - 86_400_000), 'SUBMITTED');
    await prisma.report.create({
      data: { sessionId: old.id, status: 'APPROVED', draftJson: '{}', currentJson: '{}' },
    });
    const recent = await mk(clock.now(), 'INTERVIEWING');
    const res = await request(app).get('/api/sessions').set(auth.patient);
    expect(res.body.sessions.map((s: { id: string }) => s.id)).toEqual([recent.id, old.id]);
    expect(res.body.sessions[0].reportStatus).toBeNull();
    expect(res.body.sessions[1].reportStatus).toBe('APPROVED');
  });

  it('should list linked clinicians', async () => {
    const { app, auth, users } = await createTestContext();
    const res = await request(app).get('/api/patient/clinicians').set(auth.patient);
    expect(res.body.clinicians).toEqual([
      { id: users.clinician.id, displayName: 'Dr. Jordan Lee' },
    ]);
  });

  it('should resume only from CRISIS_PAUSED, adding a companion message', async () => {
    const { app, auth, prisma } = await createTestContext();
    const c = await request(app).post('/api/sessions').set(auth.patient).send(CONSENT);
    const id = c.body.session.id;
    const bad = await request(app)
      .post(`/api/sessions/${id}/resume`)
      .set(auth.patient)
      .send({ confirmSafe: true });
    expect(bad.status).toBe(409);
    await prisma.session.update({ where: { id }, data: { state: 'CRISIS_PAUSED' } });
    const res = await request(app)
      .post(`/api/sessions/${id}/resume`)
      .set(auth.patient)
      .send({ confirmSafe: true });
    expect(res.status).toBe(200);
    expect(res.body.session.state).toBe('INTERVIEWING');
    const last = res.body.messages.at(-1);
    expect(last).toMatchObject({ sender: 'COMPANION', turnId: 2 });
    expect(last.text).toContain('988');
    const row = await prisma.session.findUniqueOrThrow({ where: { id } });
    expect(JSON.parse(row.interviewState).safetyFollowUpDone).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: 'session.resume' } })).toBe(1);
  });

  it('should require confirmSafe true to resume', async () => {
    const { app, auth } = await createTestContext();
    const c = await request(app).post('/api/sessions').set(auth.patient).send(CONSENT);
    const res = await request(app)
      .post(`/api/sessions/${c.body.session.id}/resume`)
      .set(auth.patient)
      .send({});
    expect(res.status).toBe(400);
  });
});
