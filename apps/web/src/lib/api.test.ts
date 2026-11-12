import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { API } from '@/test/handlers';
import { server } from '@/test/server';
import { ApiError, api, setUnauthorizedHandler } from './api';

describe('api', () => {
  it('should attach the bearer token', async () => {
    localStorage.setItem('pvc.token', 'abc');
    let header: string | null = null;
    server.use(
      http.get(`${API}/api/thing`, ({ request }) => {
        header = request.headers.get('Authorization');
        return HttpResponse.json({ ok: true });
      }),
    );
    await api.get('/api/thing');
    expect(header).toBe('Bearer abc');
  });

  it('should turn the error envelope into an ApiError', async () => {
    server.use(
      http.post(`${API}/api/thing`, () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'bad', details: [{ path: 'a' }] } },
          { status: 400 },
        ),
      ),
    );
    const err = await api.post('/api/thing', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'bad',
      details: [{ path: 'a' }],
    });
  });

  it('should clear the token and notify on 401', async () => {
    localStorage.setItem('pvc.token', 'abc');
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    server.use(
      http.get(`${API}/api/thing`, () =>
        HttpResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'no' } }, { status: 401 }),
      ),
    );
    await expect(api.get('/api/thing')).rejects.toMatchObject({ status: 401 });
    expect(localStorage.getItem('pvc.token')).toBeNull();
    expect(handler).toHaveBeenCalledTimes(1);
    setUnauthorizedHandler(null);
  });

  it('should send FormData uploads without a JSON content type', async () => {
    let ct: string | null = null;
    server.use(
      http.post(`${API}/api/up`, ({ request }) => {
        ct = request.headers.get('Content-Type');
        return HttpResponse.json({ text: 'hi' });
      }),
    );
    const fd = new FormData();
    fd.append('audio', new Blob(['x'], { type: 'audio/webm' }), 'a.webm');
    await expect(api.upload('/api/up', fd)).resolves.toEqual({ text: 'hi' });
    expect(ct).toMatch(/multipart\/form-data/);
  });
});
