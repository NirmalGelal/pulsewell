import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../test/context';
import { seedReport } from './test-utils';

describe('GET /clinician/patients', () => {
  it('should ignore unapproved sessions for riskLevel and sort by risk then name', async () => {
    const ctx = await createTestContext();
    await seedReport(ctx, { status: 'DRAFT', riskLevel: 'imminent' });
    await seedReport(ctx, { patientKey: 'patient2', riskLevel: 'elevated' });
    const res = await request(ctx.app).get('/api/clinician/patients').set(ctx.auth.clinician);
    expect(res.status).toBe(200);
    const p = res.body.patients as {
      displayName: string;
      riskLevel: string;
      lastApprovedAt: string | null;
    }[];
    expect(p.map((x) => [x.displayName, x.riskLevel])).toEqual([
      ['Alex M.', 'elevated'],
      ['Sam R.', 'none'],
    ]);
    expect(p[0]!.lastApprovedAt).not.toBeNull();
    expect(p[1]!.lastApprovedAt).toBeNull();
  });

  it('should raise to imminent when the patient has an open alert, and not for other clinicians', async () => {
    const ctx = await createTestContext();
    const { session } = await seedReport(ctx, { status: 'DRAFT' });
    const ev = await ctx.prisma.safetyEvent.create({
      data: {
        sessionId: session.id,
        turnId: 2,
        level: 'imminent',
        categories: '[]',
        evidence: 'x',
        source: 'keyword',
      },
    });
    await ctx.prisma.alert.create({
      data: {
        sessionId: session.id,
        patientId: ctx.users.patient.id,
        safetyEventId: ev.id,
        level: 'imminent',
        evidence: 'x',
      },
    });
    const res = await request(ctx.app).get('/api/clinician/patients').set(ctx.auth.clinician);
    expect(res.body.patients[0]).toMatchObject({ displayName: 'Sam R.', riskLevel: 'imminent' });
    const other = await request(ctx.app)
      .get('/api/clinician/patients')
      .set(ctx.auth.otherClinician);
    expect(other.body.patients).toEqual([]);
  });
});
