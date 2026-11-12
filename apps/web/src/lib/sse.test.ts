import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import type { MessageStreamEvent } from '@pvc/shared';
import { API } from '@/test/handlers';
import { server } from '@/test/server';
import { ApiError } from './api';
import { postSse } from './sse';

const enc = new TextEncoder();
function streamOf(chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(enc.encode(ch));
      c.close();
    },
  });
}
const tok = (d: string) => `event: token\ndata: ${JSON.stringify({ delta: d })}\n\n`;

async function run(chunks: string[]) {
  server.use(
    http.post(
      `${API}/api/x`,
      () =>
        new HttpResponse(streamOf(chunks), { headers: { 'Content-Type': 'text/event-stream' } }),
    ),
  );
  const events: MessageStreamEvent[] = [];
  await postSse('/api/x', {}, { onEvent: (e) => events.push(e) });
  return events;
}

describe('postSse', () => {
  it('should parse events split across chunk boundaries', async () => {
    const whole = tok('Hel') + tok('lo');
    const events = await run([whole.slice(0, 10), whole.slice(10, 40), whole.slice(40)]);
    expect(events.map((e) => e.event === 'token' && e.data.delta)).toEqual(['Hel', 'lo']);
  });

  it('should parse multiple events in one chunk', async () => {
    const events = await run([tok('a') + tok('b') + tok('c')]);
    expect(events).toHaveLength(3);
  });

  it('should handle CRLF line endings, even split between chunks', async () => {
    const crlf = tok('x').replace(/\n/g, '\r\n');
    const events = await run([crlf.slice(0, crlf.length - 2), crlf.slice(-2), crlf]);
    expect(events).toHaveLength(2);
  });

  it('should skip invalid events with a console error', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const events = await run([
      'event: token\ndata: {"nope":1}\n\n',
      tok('ok'),
      'event: bogus\ndata: {}\n\n',
    ]);
    expect(events).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });

  it('should throw ApiError from the JSON envelope on non-2xx', async () => {
    server.use(
      http.post(`${API}/api/x`, () =>
        HttpResponse.json({ error: { code: 'INVALID_STATE', message: 'busy' } }, { status: 409 }),
      ),
    );
    await expect(postSse('/api/x', {}, { onEvent: () => undefined })).rejects.toMatchObject({
      status: 409,
      code: 'INVALID_STATE',
      message: 'busy',
    });
    await expect(postSse('/api/x', {}, { onEvent: () => undefined })).rejects.toBeInstanceOf(
      ApiError,
    );
  });
});
