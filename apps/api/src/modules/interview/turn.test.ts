import { describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { CRISIS_MESSAGE, type SendMessageRequest } from '@pvc/shared';
import { createTestContext, type TestContext } from '../../test/context';
import { parseSse } from '../../test/sse';
import { MockLlmClient } from '../llm/mock-client';
import type { LlmCallOptions } from '../llm/types';
import { isLocked } from './locks';

const none = { level: 'none', categories: [], evidence: '' };
const REPLY = 'That sounds hard. How has your mood been?';

function scripted(): MockLlmClient {
  return new MockLlmClient()
    .on('safety', none)
    .on('tracker', { updates: [] })
    .on('interviewer', REPLY);
}

async function start(llm: MockLlmClient = scripted()) {
  const ctx = await createTestContext({ llm });
  const created = await request(ctx.app)
    .post('/api/sessions')
    .set(ctx.auth.patient)
    .send({ consent: { accepted: true, version: 'v1' } });
  const id = created.body.session.id as string;
  return { ...ctx, llm, id };
}

async function send(
  ctx: Pick<TestContext, 'app' | 'auth'> & { id: string },
  body: Partial<SendMessageRequest> & { text?: string } = {},
) {
  const res = await request(ctx.app)
    .post(`/api/sessions/${ctx.id}/messages`)
    .set(ctx.auth.patient)
    .send({ text: 'I have been feeling down since I changed jobs', inputMode: 'TEXT', ...body });
  const events = res.status === 200 ? parseSse(res.text) : [];
  return { res, events, names: events.map((e) => e.event) };
}

const sysPrompt = (o: LlmCallOptions) => o.messages[0]!.content;

describe('POST /sessions/:id/messages', () => {
  it('should run the happy path in exact event order and store turns 2 and 3', async () => {
    const ctx = await start();
    const { res, events, names } = await send(ctx);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(names[0]).toBe('patient_message');
    expect(names[1]).toBe('safety');
    expect(names.at(-1)).toBe('done');
    expect(names.at(-2)).toBe('companion_message');
    expect(names.slice(2, -2).every((n) => n === 'token')).toBe(true);
    expect(names.filter((n) => n === 'token').length).toBeGreaterThan(0);
    expect(events[1]).toMatchObject({ data: { level: 'none', showResources: false } });
    const msgs = await ctx.prisma.message.findMany({ orderBy: { turnId: 'asc' } });
    expect(msgs.map((m) => [m.turnId, m.sender])).toEqual([
      [1, 'COMPANION'],
      [2, 'PATIENT'],
      [3, 'COMPANION'],
    ]);
    expect(msgs[2]!.text).toBe(REPLY);
    const tokens = events.flatMap((e) => (e.event === 'token' ? [e.data.delta] : []));
    expect(tokens.join('').trim()).toBe(REPLY);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'message.create' } })).toBe(1);
    const row = await ctx.prisma.session.findFirstOrThrow();
    expect(JSON.parse(row.interviewState)).toMatchObject({ lastFocus: 'open_story' });
  });

  it('should apply tracker updates and raise progress.covered', async () => {
    const llm = scripted().on('tracker', {
      updates: [
        { key: 'phq9_1', status: 'answered', value: 2, confidence: 0.9, note: null, turnIds: [2] },
      ],
    });
    const ctx = await start(llm);
    const { events } = await send(ctx);
    const done = events.at(-1)!;
    expect(done.event === 'done' && done.data.progress.covered).toBe(1);
    const item = await ctx.prisma.checklistItem.findFirstOrThrow({ where: { key: 'phq9_1' } });
    expect(item).toMatchObject({ value: 2, source: 'tracker', status: 'answered' });
  });

  it('should drop tracker updates citing non-patient turns', async () => {
    const llm = scripted().on('tracker', {
      updates: [
        { key: 'phq9_1', status: 'answered', value: 2, confidence: 0.9, note: null, turnIds: [1] },
      ],
    });
    const ctx = await start(llm);
    await send(ctx);
    expect(await ctx.prisma.checklistItem.count()).toBe(0);
  });

  it('should store a tapped answer, skip the tracker for TAP, and not let the tracker overwrite it', async () => {
    const llm = scripted();
    const ctx = await start(llm);
    const { events } = await send(ctx, {
      text: 'Nearly every day',
      inputMode: 'TAP',
      answerFor: { key: 'phq9_1', value: 3 },
    });
    expect(llm.calls.filter((c) => c.role === 'tracker')).toHaveLength(0);
    const item = await ctx.prisma.checklistItem.findFirstOrThrow({ where: { key: 'phq9_1' } });
    expect(item).toMatchObject({
      source: 'patient_tap',
      value: 3,
      confidence: 1,
      status: 'answered',
    });
    expect(JSON.parse(item.turnIds)).toEqual([2]);
    const done = events.at(-1)!;
    expect(done.event === 'done' && done.data.progress.covered).toBe(1);

    llm.on('tracker', {
      updates: [
        { key: 'phq9_1', status: 'answered', value: 0, confidence: 1, note: null, turnIds: [4] },
      ],
    });
    await send(ctx, { text: 'Actually it was fine' });
    const after = await ctx.prisma.checklistItem.findFirstOrThrow({ where: { key: 'phq9_1' } });
    expect(after).toMatchObject({ value: 3, source: 'patient_tap' });
  });

  it('should pass focus markers and cacheSalt to the interviewer, and the previous focus to the tracker', async () => {
    const llm = scripted();
    const ctx = await start(llm);
    await send(ctx);
    const salt = (await ctx.prisma.session.findFirstOrThrow()).cacheSalt;
    const interviewer = llm.calls.find((c) => c.role === 'interviewer')!;
    expect(sysPrompt(interviewer.opts)).toMatch(/^CURRENT_FOCUS: open_story$/m);
    expect(sysPrompt(interviewer.opts)).toMatch(/^FOCUS_HINT: .+$/m);
    expect(interviewer.opts.cacheSalt).toBe(salt);
    const tracker = llm.calls.find((c) => c.role === 'tracker')!;
    expect(sysPrompt(tracker.opts)).toMatch(/^CURRENT_FOCUS: chief_concern$/m);
    expect(tracker.opts.messages[1]!.content).toMatch(/^TRANSCRIPT:\n\[T1\] COMPANION:/);
    expect(tracker.opts.cacheSalt).toBe(salt);
  });

  it('should include pendingItem when the focus is an instrument key and null otherwise', async () => {
    const ctx = await start();
    const first = await send(ctx);
    const d1 = first.events.at(-1)!;
    expect(d1.event === 'done' && d1.data.pendingItem).toBeNull();
    for (const key of ['chief_concern', 'mood_anxiety']) {
      await ctx.prisma.checklistItem.create({
        data: {
          sessionId: ctx.id,
          key,
          status: 'answered',
          confidence: 1,
          turnIds: '[2]',
          source: 'tracker',
        },
      });
    }
    const second = await send(ctx, { text: 'Mostly the mornings' });
    const d2 = second.events.at(-1)!;
    expect(d2.event === 'done' && d2.data.pendingItem?.key).toBe('phq9_1');
    expect(d2.event === 'done' && d2.data.pendingItem?.options).toHaveLength(4);
    const detail = await request(ctx.app).get(`/api/sessions/${ctx.id}`).set(ctx.auth.patient);
    expect(detail.body.pendingItem.key).toBe('phq9_1');
  });

  it('should stop at crisis without tokens, pause the session, store the crisis message, and 409 afterwards', async () => {
    const ctx = await start();
    const { events, names } = await send(ctx, { text: 'I am going to kill myself tonight' });
    expect(names).toEqual(['patient_message', 'safety', 'crisis']);
    expect(events[1]).toMatchObject({ data: { level: 'imminent', showResources: true } });
    const crisis = events[2]!;
    expect(crisis.event === 'crisis' && crisis.data.session.state).toBe('CRISIS_PAUSED');
    expect(crisis.event === 'crisis' && crisis.data.resources.length).toBeGreaterThan(0);
    expect(ctx.llm.calls.filter((c) => c.role === 'interviewer')).toHaveLength(0);
    const msgs = await ctx.prisma.message.findMany({ orderBy: { turnId: 'asc' } });
    expect(msgs.at(-1)).toMatchObject({ sender: 'COMPANION', text: CRISIS_MESSAGE, turnId: 3 });
    expect((await ctx.prisma.session.findFirstOrThrow()).state).toBe('CRISIS_PAUSED');
    expect(await ctx.prisma.alert.count()).toBe(1);
    const again = await send(ctx);
    expect(again.res.status).toBe(409);
  });

  it('should plan a safety follow-up when the safety model reports elevated risk', async () => {
    const llm = scripted().on('safety', {
      level: 'elevated',
      categories: ['suicidal_ideation'],
      evidence: 'hopeless',
    });
    const ctx = await start(llm);
    const { events } = await send(ctx, { text: 'I feel hopeless about everything' });
    expect(events[1]).toMatchObject({ data: { level: 'elevated', showResources: true } });
    const interviewer = llm.calls.find((c) => c.role === 'interviewer')!;
    expect(sysPrompt(interviewer.opts)).toMatch(/^CURRENT_FOCUS: safety_followup$/m);
    expect(sysPrompt(interviewer.opts)).toContain('Be especially gentle.');
    const state = JSON.parse((await ctx.prisma.session.findFirstOrThrow()).interviewState);
    expect(state.safetyFollowUpDone).toBe(true);
    // next turn does not ask again
    llm.on('safety', none);
    await send(ctx, { text: 'I am ok right now' });
    const last = llm.calls.filter((c) => c.role === 'interviewer').at(-1)!;
    expect(sysPrompt(last.opts)).not.toMatch(/CURRENT_FOCUS: safety_followup/);
  });

  it('should record instrument risk and fill the safety domain when phq9_9 is positive', async () => {
    const llm = scripted().on('tracker', {
      updates: [
        { key: 'phq9_9', status: 'answered', value: 1, confidence: 0.9, note: null, turnIds: [2] },
      ],
    });
    const ctx = await start(llm);
    await send(ctx, { text: 'Sometimes I think I would be better off not here' });
    const ev = await ctx.prisma.safetyEvent.findMany({ where: { source: 'instrument' } });
    expect(ev).toHaveLength(1);
    const session = await ctx.prisma.session.findFirstOrThrow();
    expect(['elevated', 'imminent']).toContain(session.riskLevel);
    const safety = await ctx.prisma.checklistItem.findFirstOrThrow({ where: { key: 'safety' } });
    expect(safety.status).toBe('answered');
    expect(safety.note).toContain('PHQ-9 item 9');
    const interviewer = llm.calls.find((c) => c.role === 'interviewer')!;
    expect(sysPrompt(interviewer.opts)).toMatch(/^CURRENT_FOCUS: safety_followup$/m);
  });

  it('should fill the safety domain when phq9_9 is zero without raising risk', async () => {
    const llm = scripted().on('tracker', {
      updates: [
        { key: 'phq9_9', status: 'answered', value: 0, confidence: 0.9, note: null, turnIds: [2] },
      ],
    });
    const ctx = await start(llm);
    await send(ctx, { text: 'No, never' });
    expect(await ctx.prisma.safetyEvent.count()).toBe(0);
    const safety = await ctx.prisma.checklistItem.findFirstOrThrow({ where: { key: 'safety' } });
    expect(safety.status).toBe('answered');
  });

  it('should stream a deterministic fallback when the interviewer fails before the first token', async () => {
    const llm = scripted().fail('interviewer');
    const ctx = await start(llm);
    const { events, names } = await send(ctx);
    expect(names).toEqual(['patient_message', 'safety', 'token', 'companion_message', 'done']);
    const token = events[2]!;
    expect(token.event === 'token' && token.data.delta).toMatch(/^Thank you for telling me\. /);
    const last = await ctx.prisma.message.findFirstOrThrow({ where: { turnId: 3 } });
    expect(last.sender).toBe('COMPANION');
    expect(last.text).toMatch(/^Thank you for telling me\./);
  });

  it('should send an error event and store no reply when the interviewer fails mid-stream', async () => {
    class MidStreamFail extends MockLlmClient {
      override stream(): ReturnType<MockLlmClient['stream']> {
        const gen = (async function* () {
          yield 'Hello ';
          throw new Error('boom');
        })();
        return Object.assign(gen, { result: Promise.resolve({ text: '', model: 'x' }) });
      }
    }
    const llm = new MidStreamFail().on('safety', none).on('tracker', { updates: [] });
    const ctx = await start(llm);
    const { names, events } = await send(ctx);
    expect(names).toEqual(['patient_message', 'safety', 'token', 'error']);
    const err = events.at(-1)!;
    expect(err.event === 'error' && err.data.code).toBe('LLM_UNAVAILABLE');
    expect(await ctx.prisma.message.count({ where: { sender: 'COMPANION' } })).toBe(1);
    expect(isLocked(ctx.id)).toBe(false);
  });

  it('should still complete the turn when the tracker throws', async () => {
    const llm = scripted().fail('tracker');
    const ctx = await start(llm);
    const { names } = await send(ctx);
    expect(names.at(-1)).toBe('done');
    expect(await ctx.prisma.checklistItem.count()).toBe(0);
  });

  it('should 409 a concurrent request while locked and release the lock afterwards', async () => {
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const hasStarted = new Promise<void>((r) => (started = r));
    const llm = scripted().on('interviewer', async () => {
      started();
      await gate;
      return REPLY;
    });
    const ctx = await start(llm);
    const first = send(ctx);
    await hasStarted;
    expect(isLocked(ctx.id)).toBe(true);
    const second = await send(ctx, { text: 'second' });
    expect(second.res.status).toBe(409);
    expect(second.res.body.error.message).toBe('A reply is still in progress');
    release();
    const done = await first;
    expect(done.names.at(-1)).toBe('done');
    expect(isLocked(ctx.id)).toBe(false);
    llm.on('interviewer', REPLY);
    expect((await send(ctx, { text: 'third' })).res.status).toBe(200);
  });

  it('should 400 on empty or whitespace text before streaming', async () => {
    const ctx = await start();
    const r1 = await send(ctx, { text: '   ' });
    expect(r1.res.status).toBe(400);
    expect(r1.res.headers['content-type']).toMatch(/json/);
    expect((await send(ctx, { text: '' })).res.status).toBe(400);
    expect(await ctx.prisma.message.count()).toBe(1);
  });

  it('should 409 when the session is not INTERVIEWING', async () => {
    const ctx = await start();
    await ctx.prisma.session.update({
      where: { id: ctx.id },
      data: { state: 'GENERATING_REPORT' },
    });
    const { res } = await send(ctx);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVALID_STATE');
  });

  it('should 404 for another patient and 403 for a clinician', async () => {
    const ctx = await start();
    const other = await request(ctx.app)
      .post(`/api/sessions/${ctx.id}/messages`)
      .set(ctx.auth.patient2)
      .send({ text: 'hi', inputMode: 'TEXT' });
    expect(other.status).toBe(404);
    const clin = await request(ctx.app)
      .post(`/api/sessions/${ctx.id}/messages`)
      .set(ctx.auth.clinician)
      .send({ text: 'hi', inputMode: 'TEXT' });
    expect(clin.status).toBe(403);
  });

  it('should wrap up once the turn cap is exceeded', async () => {
    const llm = scripted();
    const ctx = await start(llm);
    await ctx.prisma.session.update({ where: { id: ctx.id }, data: { nextTurnId: 121 } });
    await send(ctx);
    const interviewer = llm.calls.find((c) => c.role === 'interviewer')!;
    expect(sysPrompt(interviewer.opts)).toMatch(/^CURRENT_FOCUS: wrap_up$/m);
  });

  it('should strip a leading Companion label and fall back on an empty reply', async () => {
    const llm = scripted().once('interviewer', '  Companion: Tell me more.  ');
    const ctx = await start(llm);
    await send(ctx);
    expect((await ctx.prisma.message.findFirstOrThrow({ where: { turnId: 3 } })).text).toBe(
      'Tell me more.',
    );
    llm.once('interviewer', '   ');
    await send(ctx, { text: 'next' });
    const m = await ctx.prisma.message.findFirstOrThrow({ where: { turnId: 5 } });
    expect(m.text).toMatch(/^Thank you for telling me\./);
  });

  it('should ask clinician follow-up questions from the second patient turn', async () => {
    const llm = scripted();
    const ctx = await start(llm);
    await ctx.prisma.session.update({
      where: { id: ctx.id },
      data: {
        interviewState: JSON.stringify({
          lastFocus: 'chief_concern',
          attempts: { chief_concern: 1 },
          followUpQuestions: ['How is your sleep?'],
        }),
      },
    });
    await send(ctx);
    await send(ctx, { text: 'More text' });
    const last = llm.calls.filter((c) => c.role === 'interviewer').at(-1)!;
    expect(sysPrompt(last.opts)).toContain('CURRENT_FOCUS: follow_up_question');
    expect(sysPrompt(last.opts)).toContain('Your clinician asked: "How is your sleep?"');
    const state = JSON.parse((await ctx.prisma.session.findFirstOrThrow()).interviewState);
    expect(state.askedFollowUps).toBe(1);
  });

  it('should never log message text', async () => {
    const llm = scripted().fail('tracker');
    const ctx = await start(llm);
    const calls: unknown[] = [];
    const spy = vi.fn((...a: unknown[]) => void calls.push(a));
    ctx.deps.logger = { debug: spy, info: spy, warn: spy, error: spy };
    await send(ctx, { text: 'my very private sentence zebra' });
    await send(ctx, { text: 'I want to kill myself tonight zebra' });
    expect(spy).toHaveBeenCalled();
    expect(JSON.stringify(calls)).not.toMatch(/zebra|private sentence/);
  });
});
