import { describe, expect, it } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createTestContext } from './test/context';
import { AppError } from './lib/errors';
import { createApp } from './app';

describe('app', () => {
  it('should return health with llmMode', async () => {
    const ctx = await createTestContext();
    const res = await request(ctx.app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, llmMode: 'mock' });
  });

  it('should return NOT_FOUND envelope for unknown route', async () => {
    const ctx = await createTestContext();
    const res = await request(ctx.app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });

  it('should return VALIDATION_ERROR for malformed JSON body', async () => {
    const ctx = await createTestContext();
    const res = await request(ctx.app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"bad":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should map AppError INVALID_STATE to 409 and hide unknown error messages', async () => {
    const ctx = await createTestContext();
    const app = createApp(ctx.deps);
    const router = app.router as unknown as { stack: unknown[] };
    // Splice throwaway test routes in before the 404 handler (stack: ...health, 404, error).
    const layers = router.stack;
    const tmp = express();
    tmp.get('/api/_t/state', () => {
      throw new AppError('INVALID_STATE', 'nope');
    });
    tmp.get('/api/_t/boom', () => {
      throw new Error('secret');
    });
    const tmpStack = (tmp.router as unknown as { stack: unknown[] }).stack;
    layers.splice(layers.length - 2, 0, ...tmpStack);

    const r1 = await request(app).get('/api/_t/state');
    expect(r1.status).toBe(409);
    expect(r1.body).toEqual({ error: { code: 'INVALID_STATE', message: 'nope' } });

    const r2 = await request(app).get('/api/_t/boom');
    expect(r2.status).toBe(500);
    expect(r2.body.error.code).toBe('INTERNAL');
    expect(JSON.stringify(r2.body)).not.toContain('secret');
  });
});
