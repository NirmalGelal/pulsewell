import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildEvidenceItem } from '@pvc/shared';
import { createTestContext } from '../../test/context';
import { MockLlmClient } from '../llm/mock-client';
import { seedReport } from './test-utils';

const ask = (
  ctx: Awaited<ReturnType<typeof createTestContext>>,
  patientId: string,
  who: 'clinician' | 'otherClinician' = 'clinician',
) =>
  request(ctx.app)
    .post(`/api/clinician/patients/${patientId}/ask`)
    .set(ctx.auth[who])
    .send({ question: 'How has the patient been sleeping?' });

describe('POST /clinician/patients/:id/ask', () => {
  it('should return a canned answer without calling the LLM when there are no approved reports', async () => {
    const llm = new MockLlmClient();
    const ctx = await createTestContext({ llm });
    await seedReport(ctx, { status: 'DRAFT' });
    const res = await ask(ctx, ctx.users.patient.id);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      answer: 'There are no approved records for this patient yet.',
      citations: [],
      model: 'none',
    });
    expect(llm.calls).toHaveLength(0);
  });

  it('should build the context with SESSIONS, labeled turns, and QUESTION, excluding redacted turns and drafts', async () => {
    const llm = new MockLlmClient().on('assistant', {
      answer: 'Slept little [S1:T4].',
      citations: [],
    });
    const ctx = await createTestContext({ llm });
    await seedReport(ctx, {
      approvedAt: '2026-11-02T00:00:00Z',
      turns: [
        ['COMPANION', 'Hi'],
        ['PATIENT', 'I feel tired'],
        ['PATIENT', 'REDACTED-TEXT', true],
        ['PATIENT', 'I sleep four hours'],
      ],
      content: {
        priorities: [
          buildEvidenceItem({
            id: 'priorities-1',
            text: 'Removed priority.',
            removedByPatient: true,
          }),
        ],
      },
    });
    await seedReport(ctx, {
      approvedAt: '2026-11-11T00:00:00Z',
      turns: [
        ['COMPANION', 'Hi again'],
        ['PATIENT', 'Second session words'],
      ],
    });
    await seedReport(ctx, { status: 'DRAFT', turns: [['PATIENT', 'DRAFT-TEXT']] });
    await ask(ctx, ctx.users.patient.id).expect(200);
    expect(llm.calls).toHaveLength(1);
    const call = llm.calls[0]!;
    expect(call.role).toBe('assistant');
    const user = call.opts.messages.find((m) => m.role === 'user')!.content;
    expect(user.startsWith('SESSIONS:\nS1 = approved 2026-11-02')).toBe(true);
    expect(user).toContain('S2 = approved 2026-11-11');
    expect(user).toContain('[S1:T4] PATIENT: I sleep four hours');
    expect(user).toContain('[S2:T2] PATIENT: Second session words');
    expect(user).toContain('S1 REPORT:');
    expect(user).toContain('(T2)');
    expect(user).not.toContain('REDACTED-TEXT');
    expect(user).not.toContain('[S1:T3]');
    expect(user).not.toContain('DRAFT-TEXT');
    expect(user).not.toContain('Removed priority');
    expect(user).toMatch(/\n\nQUESTION: How has the patient been sleeping\?$/);
    expect(call.opts.cacheSalt).toBeTruthy();
  });

  it('should map valid refs and strip invalid or redacted refs from the answer', async () => {
    const llm = new MockLlmClient().on('assistant', {
      answer: 'Sleeps four hours [S1:T4]. Also something [S1:T3] and another [S9:T1].',
      citations: [{ ref: 'S1:T4' }, { ref: 'S1:T3' }, { ref: 'S1:T2' }, { ref: 'bogus' }],
    });
    const ctx = await createTestContext({ llm });
    const { session } = await seedReport(ctx, {
      turns: [
        ['COMPANION', 'Hi'],
        ['PATIENT', 'I feel tired'],
        ['PATIENT', 'REDACTED-TEXT', true],
        ['PATIENT', 'x'.repeat(300)],
      ],
    });
    const res = await ask(ctx, ctx.users.patient.id);
    expect(res.status).toBe(200);
    expect(res.body.answer).toBe('Sleeps four hours [S1:T4]. Also something and another.');
    expect(res.body.model).toBe('mock-assistant');
    const byTurn = Object.fromEntries(
      res.body.citations.map((c: { turnId: number }) => [c.turnId, c]),
    );
    expect(Object.keys(byTurn).sort()).toEqual(['2', '4']);
    expect(byTurn[4]).toMatchObject({ sessionId: session.id });
    expect(byTurn[4].excerpt).toHaveLength(160);
    expect(byTurn[2].excerpt).toBe('I feel tired');
  });

  it('should add refs found only in the answer text to citations', async () => {
    const llm = new MockLlmClient().on('assistant', { answer: 'Tired [S1:T2].', citations: [] });
    const ctx = await createTestContext({ llm });
    await seedReport(ctx);
    const res = await ask(ctx, ctx.users.patient.id);
    expect(res.body.citations).toHaveLength(1);
  });

  it('should return 503 on LLM failure, 404 when unlinked, and audit without the question text', async () => {
    const llm = new MockLlmClient().fail('assistant', 5);
    const ctx = await createTestContext({ llm });
    await seedReport(ctx);
    const bad = await ask(ctx, ctx.users.patient.id);
    expect(bad.status).toBe(503);
    expect(bad.body.error.code).toBe('LLM_UNAVAILABLE');
    expect((await ask(ctx, ctx.users.patient.id, 'otherClinician')).status).toBe(404);
    const rows = await ctx.prisma.auditLog.findMany({ where: { action: 'assistant.ask' } });
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.meta).not.toContain('sleeping');
      expect(JSON.parse(r.meta!)).toEqual({ chars: 'How has the patient been sleeping?'.length });
    }
    const short = await request(ctx.app)
      .post(`/api/clinician/patients/${ctx.users.patient.id}/ask`)
      .set(ctx.auth.clinician)
      .send({ question: 'a' });
    expect(short.status).toBe(400);
  });
});
