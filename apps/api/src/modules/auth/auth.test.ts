import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import express from 'express';
import request from 'supertest';
import { createTestContext } from '../../test/context';
import { requireAuth, requireRole } from './auth.middleware';

const BODY = { email: 'patient@demo.test', password: 'demo1234' };

describe('auth', () => {
  it('should log in with correct credentials and return token + UserDto (no passwordHash in response)', async () => {
    const { app, users } = await createTestContext();
    const res = await request(app).post('/api/auth/login').send(BODY);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toEqual({
      id: users.patient.id,
      email: 'patient@demo.test',
      role: 'PATIENT',
      displayName: 'Sam R.',
    });
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('should treat email case-insensitively and trim spaces', async () => {
    const { app } = await createTestContext();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: '  Patient@Demo.TEST ', password: 'demo1234' });
    expect(res.status).toBe(200);
  });

  it('should return 401 with identical message for unknown email and wrong password', async () => {
    const { app } = await createTestContext();
    const a = await request(app)
      .post('/api/auth/login')
      .send({ ...BODY, password: 'nope' });
    const b = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@demo.test', password: 'demo1234' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body).toEqual(b.body);
    expect(a.body.error.code).toBe('UNAUTHENTICATED');
    expect(a.body.error.message).toBe('Invalid email or password');
  });

  it('should 400 on missing password (VALIDATION_ERROR)', async () => {
    const { app } = await createTestContext();
    const res = await request(app).post('/api/auth/login').send({ email: 'patient@demo.test' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return current user from /api/auth/me', async () => {
    const { app, auth, users } = await createTestContext();
    const res = await request(app).get('/api/auth/me').set(auth.clinician);
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(users.clinician.id);
    expect(res.body.user.role).toBe('CLINICIAN');
    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
  });

  it('should 401 /api/auth/me with no header / malformed header / bad signature / expired token', async () => {
    const { app, users, deps } = await createTestContext();
    const get = (h?: string) => {
      const r = request(app).get('/api/auth/me');
      return h ? r.set('Authorization', h) : r;
    };
    const claims = { role: 'PATIENT' };
    const good = jwt.sign(claims, deps.config.JWT_SECRET, { subject: users.patient.id });
    const forged = jwt.sign(claims, 'x'.repeat(40), { subject: users.patient.id });
    const expired = jwt.sign(claims, deps.config.JWT_SECRET, {
      subject: users.patient.id,
      expiresIn: -1,
    });
    expect((await get()).status).toBe(401);
    expect((await get(`Token ${good}`)).status).toBe(401);
    expect((await get('Bearer')).status).toBe(401);
    expect((await get(`Bearer ${forged}`)).status).toBe(401);
    const e = await get(`Bearer ${expired}`);
    expect(e.status).toBe(401);
    expect(e.body.error.code).toBe('UNAUTHENTICATED');
    expect((await get(`Bearer ${good}`)).status).toBe(200);
  });

  it("should 401 when the token's user was deleted", async () => {
    const { app, auth, prisma, users } = await createTestContext();
    await prisma.user.delete({ where: { id: users.patient2.id } });
    const res = await request(app).get('/api/auth/me').set(auth.patient2);
    expect(res.status).toBe(401);
  });

  it("should 403 when requireRole('CLINICIAN') route is called by a patient", async () => {
    const { deps, auth } = await createTestContext();
    const app = express();
    app.get('/only-clinician', requireAuth(deps), requireRole('CLINICIAN'), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(((err: { status?: number; code?: string }, _req, res, _next) => {
      res.status(err.status ?? 500).json({ code: err.code });
    }) as express.ErrorRequestHandler);
    const denied = await request(app).get('/only-clinician').set(auth.patient);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FORBIDDEN');
    expect((await request(app).get('/only-clinician').set(auth.clinician)).status).toBe(200);
  });

  it('should write auth.login and auth.login_failed audit rows; failed row meta must not contain the email', async () => {
    const { app, prisma, users } = await createTestContext();
    await request(app).post('/api/auth/login').send(BODY);
    await request(app)
      .post('/api/auth/login')
      .send({ ...BODY, password: 'wrong-pw' });
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@demo.test', password: 'wrong-pw' });
    const rows = await prisma.auditLog.findMany({ orderBy: { createdAt: 'asc' } });
    const ok = rows.filter((r) => r.action === 'auth.login');
    const failed = rows.filter((r) => r.action === 'auth.login_failed');
    expect(ok).toHaveLength(1);
    expect(ok[0]!.actorId).toBe(users.patient.id);
    expect(failed).toHaveLength(2);
    const reasons = failed.map((r) => JSON.parse(r.meta!).reason).sort();
    expect(reasons).toEqual(['bad_password', 'unknown_email']);
    expect(failed.find((r) => r.actorId === null)).toBeDefined();
    for (const r of rows) {
      expect(r.meta ?? '').not.toContain('@');
      expect(r.meta ?? '').not.toContain('wrong-pw');
    }
  });
});
