import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from './validate';
import { AppError } from './errors';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.post(
    '/x/:id',
    validate({
      body: z.object({ name: z.string().trim().min(1) }),
      params: z.object({ id: z.string().min(2) }),
      query: z.object({ n: z.coerce.number().default(5) }),
    }),
    (req, res) => {
      res.json({ body: req.body, id: req.params.id, query: res.locals.query });
    },
  );
  app.use(((err, _req, res, _next) => {
    if (err instanceof AppError)
      res.status(err.status).json({ error: { code: err.code, details: err.details } });
    else res.status(500).end();
  }) as express.ErrorRequestHandler);
  return app;
}

describe('validate', () => {
  it('should 400 with details[].path for bad body', async () => {
    const res = await request(makeApp()).post('/x/abc').send({ name: 3 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('name');
  });
  it('should replace body with parsed (trimmed) data and store parsed query', async () => {
    const res = await request(makeApp()).post('/x/abc?n=7').send({ name: '  Ann  ' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ body: { name: 'Ann' }, id: 'abc', query: { n: 7 } });
  });
  it('should validate params', async () => {
    const res = await request(makeApp()).post('/x/a').send({ name: 'z' });
    expect(res.status).toBe(400);
  });
});
