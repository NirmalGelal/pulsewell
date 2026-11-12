import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { QueueItemDtoSchema, buildEvidenceItem, buildInstrumentResult } from '@pvc/shared';
import { createTestContext } from '../../test/context';
import { seedReport } from './test-utils';

const get = (
  ctx: Awaited<ReturnType<typeof createTestContext>>,
  who: 'clinician' | 'otherClinician' = 'clinician',
) => request(ctx.app).get('/api/clinician/queue').set(ctx.auth[who]);

describe('GET /clinician/queue', () => {
  it('should show only APPROVED reports of linked patients', async () => {
    const ctx = await createTestContext();
    const ok = await seedReport(ctx);
    await seedReport(ctx, { status: 'DRAFT' });
    await ctx.prisma.careLink.updateMany({
      where: { patientId: ctx.users.patient2.id },
      data: { active: false },
    });
    await seedReport(ctx, { patientKey: 'patient2' });
    const res = await get(ctx);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].reportId).toBe(ok.report.id);
    QueueItemDtoSchema.parse(res.body.items[0]);
  });

  it('should give otherClinician an empty queue and reject patient tokens with 403', async () => {
    const ctx = await createTestContext();
    await seedReport(ctx);
    expect((await get(ctx, 'otherClinician')).body.items).toEqual([]);
    const res = await request(ctx.app).get('/api/clinician/queue').set(ctx.auth.patient);
    expect(res.status).toBe(403);
  });

  it('should sort alert first, then risk, then unreviewed, then newest', async () => {
    const ctx = await createTestContext();
    const risk = (level: string) => ({ risk: { level } }) as never;
    const none1 = await seedReport(ctx, { approvedAt: '2026-11-01T00:00:00Z' });
    const none2 = await seedReport(ctx, { approvedAt: '2026-11-05T00:00:00Z' });
    const reviewedNone = await seedReport(ctx, {
      approvedAt: '2026-11-09T00:00:00Z',
      reviewedAt: '2026-11-09T01:00:00Z',
    });
    const elevated = await seedReport(ctx, {
      approvedAt: '2026-11-02T00:00:00Z',
      content: risk('elevated'),
    });
    const imminent = await seedReport(ctx, {
      approvedAt: '2026-11-03T00:00:00Z',
      content: risk('imminent'),
    });
    const alerted = await seedReport(ctx, { approvedAt: '2026-10-01T00:00:00Z' });
    const ev = await ctx.prisma.safetyEvent.create({
      data: {
        sessionId: alerted.session.id,
        turnId: 2,
        level: 'imminent',
        categories: '[]',
        evidence: 'x',
        source: 'keyword',
      },
    });
    await ctx.prisma.alert.create({
      data: {
        sessionId: alerted.session.id,
        patientId: ctx.users.patient.id,
        safetyEventId: ev.id,
        level: 'imminent',
        evidence: 'x',
      },
    });
    const res = await get(ctx);
    expect(res.body.items.map((i: { reportId: string }) => i.reportId)).toEqual([
      alerted.report.id,
      imminent.report.id,
      elevated.report.id,
      none2.report.id,
      none1.report.id,
      reviewedNone.report.id,
    ]);
    expect(res.body.items[0].hasUnacknowledgedAlert).toBe(true);
    expect(res.body.items[1].hasUnacknowledgedAlert).toBe(false);
  });

  it('should compute trend deltas vs the previous approved report, null when incomplete or first', async () => {
    const ctx = await createTestContext();
    const full = (v: 0 | 1 | 2 | 3, n: number) => Array(n).fill(v) as (0 | 1 | 2 | 3)[];
    const scr = (p: (0 | 1 | 2 | 3 | null)[], g: (0 | 1 | 2 | 3 | null)[]) => ({
      screening: { phq9: buildInstrumentResult('phq9', p), gad7: buildInstrumentResult('gad7', g) },
    });
    const first = await seedReport(ctx, {
      approvedAt: '2026-10-01T00:00:00Z',
      content: scr(full(1, 9), full(1, 7)),
    });
    const second = await seedReport(ctx, {
      approvedAt: '2026-10-15T00:00:00Z',
      content: scr(full(2, 9), full(0, 7)),
    });
    const third = await seedReport(ctx, {
      approvedAt: '2026-11-01T00:00:00Z',
      content: scr([1, 1], full(1, 7)),
    });
    const items = (await get(ctx)).body.items as {
      reportId: string;
      trend: unknown;
      phq9: { total: number | null };
    }[];
    const by = (id: string) => items.find((i) => i.reportId === id)!;
    expect(by(first.report.id).trend).toBeNull();
    expect(by(second.report.id).trend).toEqual({ phq9Delta: 9, gad7Delta: -7 });
    expect(by(third.report.id).trend).toEqual({ phq9Delta: null, gad7Delta: 7 });
    expect(by(third.report.id).phq9.total).toBeNull();
  });

  it('should skip removed priorities for topPriority', async () => {
    const ctx = await createTestContext();
    await seedReport(ctx, {
      content: {
        priorities: [
          buildEvidenceItem({ id: 'priorities-1', text: 'Hidden one.', removedByPatient: true }),
          buildEvidenceItem({ id: 'priorities-2', text: 'Better sleep.' }),
        ],
      },
    });
    expect((await get(ctx)).body.items[0].topPriority).toBe('Better sleep.');
    const ctx2 = await createTestContext();
    await seedReport(ctx2, {
      content: {
        priorities: [buildEvidenceItem({ id: 'priorities-1', removedByPatient: true })],
      },
    });
    expect((await get(ctx2)).body.items[0].topPriority).toBeNull();
  });
});
