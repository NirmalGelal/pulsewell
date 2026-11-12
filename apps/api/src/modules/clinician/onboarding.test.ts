import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../test/context';
import { generateTemporaryPassword } from './onboarding.service';

const NEW = { email: '  New.Patient@Demo.Test ', displayName: 'Pat Newman' };

async function create(ctx: Awaited<ReturnType<typeof createTestContext>>) {
  return request(ctx.app).post('/api/clinician/patients').set(ctx.auth.clinician).send(NEW);
}

describe('temporary password generator', () => {
  it('should produce 12 unambiguous characters and differ between calls', () => {
    const a = generateTemporaryPassword();
    expect(a).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{12}$/);
    expect(generateTemporaryPassword()).not.toBe(a);
  });
});

describe('POST /clinician/patients', () => {
  it('should create a patient, an active care link, and return the temporary password once', async () => {
    const ctx = await createTestContext();
    const res = await create(ctx);
    expect(res.status).toBe(201);
    expect(res.body.patient.email).toBe('new.patient@demo.test');
    expect(res.body.patient.displayName).toBe('Pat Newman');
    const pw = res.body.temporaryPassword as string;
    expect(pw).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{12}$/);

    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: res.body.patient.id } });
    expect(user.role).toBe('PATIENT');
    expect(user.mustChangePassword).toBe(true);
    expect(user.passwordHash).not.toContain(pw);
    expect(await bcrypt.compare(pw, user.passwordHash)).toBe(true);
    const link = await ctx.prisma.careLink.findFirst({
      where: { patientId: user.id, clinicianId: ctx.users.clinician.id },
    });
    expect(link?.active).toBe(true);

    const list = await request(ctx.app).get('/api/clinician/patients').set(ctx.auth.clinician);
    expect(list.body.patients.map((p: { id: string }) => p.id)).toContain(user.id);
    expect(JSON.stringify(list.body)).not.toContain(pw);
  });

  it('should audit with ids only and never store the password or email text', async () => {
    const ctx = await createTestContext();
    const res = await create(ctx);
    const rows = await ctx.prisma.auditLog.findMany({ where: { action: 'patient.create' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.actorId).toBe(ctx.users.clinician.id);
    expect(rows[0]!.resourceId).toBe(res.body.patient.id);
    const dump = JSON.stringify(await ctx.prisma.auditLog.findMany());
    expect(dump).not.toContain(res.body.temporaryPassword);
    expect(dump).not.toContain('new.patient@demo.test');
    expect(dump).not.toContain('Pat Newman');
  });

  it('should return 409 CONFLICT for a duplicate email (case-insensitive) and create nothing', async () => {
    const ctx = await createTestContext();
    const res = await request(ctx.app)
      .post('/api/clinician/patients')
      .set(ctx.auth.clinician)
      .send({ email: 'PATIENT@demo.test', displayName: 'Dup' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(await ctx.prisma.user.count({ where: { displayName: 'Dup' } })).toBe(0);
  });

  it('should reject invalid input with 400', async () => {
    const ctx = await createTestContext();
    for (const body of [
      { email: 'nope', displayName: 'A' },
      { email: 'a@b.test', displayName: '   ' },
      { email: 'a@b.test', displayName: 'x'.repeat(81) },
      { email: 'a@b.test' },
    ]) {
      const res = await request(ctx.app)
        .post('/api/clinician/patients')
        .set(ctx.auth.clinician)
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  it('should return 403 for a patient and 401 without a token', async () => {
    const ctx = await createTestContext();
    const p = await request(ctx.app)
      .post('/api/clinician/patients')
      .set(ctx.auth.patient)
      .send(NEW);
    expect(p.status).toBe(403);
    const n = await request(ctx.app).post('/api/clinician/patients').send(NEW);
    expect(n.status).toBe(401);
  });
});

describe('forced password change', () => {
  async function newPatient() {
    const ctx = await createTestContext();
    const created = await create(ctx);
    const login = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'new.patient@demo.test', password: created.body.temporaryPassword });
    return {
      ctx,
      temp: created.body.temporaryPassword as string,
      login,
      h: { Authorization: `Bearer ${login.body.token}` },
    };
  }

  it('should log in with the temporary password and report mustChangePassword', async () => {
    const { login } = await newPatient();
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);
  });

  it('should block other authed routes with 403 until the password is changed, but allow /me', async () => {
    const { ctx, h } = await newPatient();
    const me = await request(ctx.app).get('/api/auth/me').set(h);
    expect(me.status).toBe(200);
    expect(me.body.user.mustChangePassword).toBe(true);
    for (const path of ['/api/sessions', '/api/patient/clinicians', '/api/patient/follow-ups']) {
      const res = await request(ctx.app).get(path).set(h);
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toBe('Password change required');
    }
    const speech = await request(ctx.app).post('/api/speech/transcribe').set(h);
    expect(speech.status).toBe(403);
  });

  it('should change the password, clear the flag, audit it, and unblock routes', async () => {
    const { ctx, h, temp } = await newPatient();
    const res = await request(ctx.app)
      .post('/api/auth/change-password')
      .set(h)
      .send({ currentPassword: temp, newPassword: 'a-much-better-pass' });
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(false);
    const ok = await request(ctx.app).get('/api/sessions').set(h);
    expect(ok.status).toBe(200);
    const relog = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'new.patient@demo.test', password: 'a-much-better-pass' });
    expect(relog.status).toBe(200);
    const old = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'new.patient@demo.test', password: temp });
    expect(old.status).toBe(401);
    const rows = await ctx.prisma.auditLog.findMany({ where: { action: 'auth.change_password' } });
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain('a-much-better-pass');
  });

  it('should reject a wrong current password, a weak new password, and an unchanged password', async () => {
    const { ctx, h, temp } = await newPatient();
    const post = (body: object) =>
      request(ctx.app).post('/api/auth/change-password').set(h).send(body);
    const wrong = await post({ currentPassword: 'wrong-wrong', newPassword: 'a-much-better-pass' });
    expect(wrong.status).toBe(400);
    const weak = await post({ currentPassword: temp, newPassword: 'short' });
    expect(weak.status).toBe(400);
    const same = await post({ currentPassword: temp, newPassword: temp + 'x'.repeat(0) });
    expect(same.status).toBe(400);
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: 'new.patient@demo.test' },
    });
    expect(user.mustChangePassword).toBe(true);
  });

  it('should let any authed user (no flag) change their password', async () => {
    const ctx = await createTestContext();
    const res = await request(ctx.app)
      .post('/api/auth/change-password')
      .set(ctx.auth.clinician)
      .send({ currentPassword: 'demo1234', newPassword: 'another-long-pass' });
    expect(res.status).toBe(200);
    expect(res.body.user.mustChangePassword).toBe(false);
  });

  it('should require authentication to change password', async () => {
    const ctx = await createTestContext();
    const res = await request(ctx.app)
      .post('/api/auth/change-password')
      .send({ currentPassword: 'demo1234', newPassword: 'another-long-pass' });
    expect(res.status).toBe(401);
  });
});

describe('POST /clinician/patients/:patientId/reset-password', () => {
  it('should issue a new temporary password once, set the flag, and invalidate the old password', async () => {
    const ctx = await createTestContext();
    const res = await request(ctx.app)
      .post(`/api/clinician/patients/${ctx.users.patient.id}/reset-password`)
      .set(ctx.auth.clinician);
    expect(res.status).toBe(200);
    const pw = res.body.temporaryPassword as string;
    expect(pw).toMatch(/^[A-HJ-NP-Za-km-np-z2-9]{12}$/);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.users.patient.id } });
    expect(user.mustChangePassword).toBe(true);
    expect(await bcrypt.compare(pw, user.passwordHash)).toBe(true);
    const old = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'patient@demo.test', password: 'demo1234' });
    expect(old.status).toBe(401);
    const login = await request(ctx.app)
      .post('/api/auth/login')
      .send({ email: 'patient@demo.test', password: pw });
    expect(login.body.user.mustChangePassword).toBe(true);
    const dump = JSON.stringify(await ctx.prisma.auditLog.findMany());
    expect(dump).toContain('patient.reset_password');
    expect(dump).not.toContain(pw);
  });

  it('should return 404 for an unlinked clinician and for unknown or non-patient ids', async () => {
    const ctx = await createTestContext();
    const base = '/api/clinician/patients';
    const other = await request(ctx.app)
      .post(`${base}/${ctx.users.patient.id}/reset-password`)
      .set(ctx.auth.otherClinician);
    expect(other.status).toBe(404);
    const unknown = await request(ctx.app)
      .post(`${base}/nope/reset-password`)
      .set(ctx.auth.clinician);
    expect(unknown.status).toBe(404);
    const clin = await request(ctx.app)
      .post(`${base}/${ctx.users.otherClinician.id}/reset-password`)
      .set(ctx.auth.clinician);
    expect(clin.status).toBe(404);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: ctx.users.patient.id } });
    expect(user.mustChangePassword).toBe(false);
  });

  it('should return 403 for a patient caller', async () => {
    const ctx = await createTestContext();
    const res = await request(ctx.app)
      .post(`/api/clinician/patients/${ctx.users.patient.id}/reset-password`)
      .set(ctx.auth.patient);
    expect(res.status).toBe(403);
  });
});
