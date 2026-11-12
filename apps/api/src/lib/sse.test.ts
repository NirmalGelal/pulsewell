import { describe, expect, it } from 'vitest';
import express from 'express';
import request from 'supertest';
import { openSse } from './sse';

describe('sse', () => {
  const app = express();
  app.get('/s', (_req, res) => {
    const ch = openSse(res);
    ch.send('x', { a: 1 });
    ch.send('y', 'two');
    ch.close();
    ch.send('z', { late: true });
  });

  it('should set SSE headers', async () => {
    const res = await request(app).get('/s').buffer(true);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.headers['connection']).toBe('keep-alive');
    expect(res.headers['x-accel-buffering']).toBe('no');
  });
  it('should write event/data frames and ignore writes after close', async () => {
    const res = await request(app)
      .get('/s')
      .buffer(true)
      .parse((r, cb) => {
        let d = '';
        r.on('data', (c) => (d += c));
        r.on('end', () => cb(null, d));
      });
    expect(res.body).toBe('event: x\ndata: {"a":1}\n\nevent: y\ndata: "two"\n\n');
  });
});
