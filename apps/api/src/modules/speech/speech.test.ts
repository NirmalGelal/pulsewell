import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../app';
import type { Logger } from '../../lib/logger';
import { createTestContext } from '../../test/context';
import { MockLlmClient } from '../llm/mock-client';

const WAV = Buffer.from('RIFFxxxxWAVEfake-audio');

async function setup(text: string | (() => string) = ' hello there ') {
  const llm = new MockLlmClient().on('stt', typeof text === 'function' ? text : () => text);
  const logs: unknown[] = [];
  const logger: Logger = {
    debug: (m, meta) => logs.push([m, meta]),
    info: (m, meta) => logs.push([m, meta]),
    warn: (m, meta) => logs.push([m, meta]),
    error: (m, meta) => logs.push([m, meta]),
  };
  const ctx = await createTestContext({ llm, logger });
  const convert = vi.fn(async (b: Buffer) => Buffer.concat([Buffer.from('CONVERTED'), b]));
  const app = createApp(ctx.deps, { convert });
  return { ctx, app, convert, llm, logs };
}

describe('POST /api/speech/transcribe', () => {
  it('should return the trimmed transcript and audit the call', async () => {
    const { ctx, app } = await setup();
    const res = await request(app)
      .post('/api/speech/transcribe')
      .set(ctx.auth.patient)
      .attach('audio', WAV, { filename: 'a.wav', contentType: 'audio/wav' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ text: 'hello there' });
    const row = await ctx.prisma.auditLog.findFirst({ where: { action: 'speech.transcribe' } });
    expect(row?.actorId).toBe(ctx.users.patient.id);
    expect(JSON.parse(row!.meta!)).toMatchObject({ bytes: WAV.length });
  });

  it('should return an empty text for an empty transcript', async () => {
    const { ctx, app } = await setup('   ');
    const res = await request(app)
      .post('/api/speech/transcribe')
      .set(ctx.auth.patient)
      .attach('audio', WAV, { filename: 'a.wav', contentType: 'audio/wav' });
    expect(res.body).toEqual({ text: '' });
  });

  it('should convert webm audio before transcribing', async () => {
    const { ctx, app, convert, llm } = await setup();
    const res = await request(app)
      .post('/api/speech/transcribe')
      .set(ctx.auth.patient)
      .attach('audio', Buffer.from('webm-bytes'), {
        filename: 'a.webm',
        contentType: 'audio/webm;codecs=opus',
      });
    expect(res.status).toBe(200);
    expect(convert).toHaveBeenCalledTimes(1);
    expect((llm as MockLlmClient).calls[0]!.opts.messages[0]!.content).toBe('audio/wav');
  });

  it('should skip conversion for wav', async () => {
    const { ctx, app, convert } = await setup();
    await request(app)
      .post('/api/speech/transcribe')
      .set(ctx.auth.patient)
      .attach('audio', WAV, { filename: 'a.wav', contentType: 'audio/x-wav' });
    expect(convert).not.toHaveBeenCalled();
  });

  it('should reject uploads over 10 MB with 413', async () => {
    const { ctx, app } = await setup();
    const res = await request(app)
      .post('/api/speech/transcribe')
      .set(ctx.auth.patient)
      .attach('audio', Buffer.alloc(11 * 1024 * 1024), {
        filename: 'a.wav',
        contentType: 'audio/wav',
      });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('should reject unsupported mimetypes and a missing file with 400', async () => {
    const { ctx, app } = await setup();
    const png = await request(app)
      .post('/api/speech/transcribe')
      .set(ctx.auth.patient)
      .attach('audio', Buffer.from('x'), { filename: 'a.png', contentType: 'image/png' });
    expect(png.status).toBe(400);
    const none = await request(app).post('/api/speech/transcribe').set(ctx.auth.patient);
    expect(none.status).toBe(400);
  });

  it('should forbid clinicians and unauthenticated callers', async () => {
    const { ctx, app } = await setup();
    const c = await request(app)
      .post('/api/speech/transcribe')
      .set(ctx.auth.clinician)
      .attach('audio', WAV, { filename: 'a.wav', contentType: 'audio/wav' });
    expect(c.status).toBe(403);
    const u = await request(app).post('/api/speech/transcribe');
    expect(u.status).toBe(401);
  });

  it('should return 503 when the transcription model fails', async () => {
    const { ctx, app, llm } = await setup();
    (llm as MockLlmClient).fail('stt');
    const res = await request(app)
      .post('/api/speech/transcribe')
      .set(ctx.auth.patient)
      .attach('audio', WAV, { filename: 'a.wav', contentType: 'audio/wav' });
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('LLM_UNAVAILABLE');
  });

  it('should not write audio bytes or transcript text to logs', async () => {
    const { ctx, app, logs } = await setup('secret words');
    await request(app)
      .post('/api/speech/transcribe')
      .set(ctx.auth.patient)
      .attach('audio', Buffer.from('UNIQUE-AUDIO-MARKER'), {
        filename: 'a.wav',
        contentType: 'audio/wav',
      });
    const dump = JSON.stringify(logs);
    expect(dump).not.toContain('UNIQUE-AUDIO-MARKER');
    expect(dump).not.toContain('secret words');
  });
});
