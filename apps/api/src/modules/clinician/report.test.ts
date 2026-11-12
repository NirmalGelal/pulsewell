import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ClinicianReportDtoSchema, buildEvidenceItem } from '@pvc/shared';
import { createTestContext } from '../../test/context';
import { seedReport } from './test-utils';

describe('clinician report routes', () => {
  it('should return a ClinicianReportDto with removed items blanked and redacted turns null', async () => {
    const ctx = await createTestContext();
    const { report, session } = await seedReport(ctx, {
      turns: [
        ['COMPANION', 'Hi'],
        ['PATIENT', 'visible words'],
        ['PATIENT', 'secret words', true],
        ['PATIENT', 'I want to die'],
      ],
      content: {
        summary: {
          presentConcern: [
            buildEvidenceItem({
              id: 'presentConcern-1',
              text: 'Secret clinical text.',
              patientText: 'Secret patient text.',
              turnIds: [3],
              removedByPatient: true,
            }),
          ],
        },
      },
    });
    await ctx.prisma.safetyEvent.create({
      data: {
        sessionId: session.id,
        turnId: 4,
        level: 'imminent',
        categories: '[]',
        evidence: 'I want to die',
        source: 'keyword',
      },
    });
    const res = await request(ctx.app)
      .get(`/api/clinician/reports/${report.id}`)
      .set(ctx.auth.clinician);
    expect(res.status).toBe(200);
    const dto = ClinicianReportDtoSchema.parse(res.body);
    const item = dto.content.summary.presentConcern[0]!;
    expect(item).toMatchObject({ text: '', patientText: '', turnIds: [] });
    expect(dto.transcript.map((t) => t.text)).toEqual([
      'Hi',
      'visible words',
      null,
      'I want to die',
    ]);
    expect(dto.transcript[2]).toMatchObject({ redacted: true });
    expect(dto.transcript[3]!.hasSafetyEvent).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('secret');
    expect(JSON.stringify(res.body)).not.toContain('Secret');
  });

  it('should 404 for a DRAFT report and for an unlinked clinician, and audit report.view', async () => {
    const ctx = await createTestContext();
    const draft = await seedReport(ctx, { status: 'DRAFT' });
    const ok = await seedReport(ctx);
    const url = (id: string) => `/api/clinician/reports/${id}`;
    expect((await request(ctx.app).get(url(draft.report.id)).set(ctx.auth.clinician)).status).toBe(
      404,
    );
    expect(
      (await request(ctx.app).get(url(ok.report.id)).set(ctx.auth.otherClinician)).status,
    ).toBe(404);
    expect((await request(ctx.app).get(url('nope')).set(ctx.auth.clinician)).status).toBe(404);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'report.view' } })).toBe(0);
    await request(ctx.app).get(url(ok.report.id)).set(ctx.auth.clinician).expect(200);
    const rows = await ctx.prisma.auditLog.findMany({ where: { action: 'report.view' } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorId: ctx.users.clinician.id, resourceId: ok.report.id });
  });

  it('should list only older approved reports in history, newest first', async () => {
    const ctx = await createTestContext();
    const a = await seedReport(ctx, { approvedAt: '2026-09-01T00:00:00Z' });
    const b = await seedReport(ctx, { approvedAt: '2026-10-01T00:00:00Z' });
    const c = await seedReport(ctx, { approvedAt: '2026-11-01T00:00:00Z' });
    await seedReport(ctx, { status: 'DRAFT' });
    await seedReport(ctx, { patientKey: 'patient2', approvedAt: '2026-08-01T00:00:00Z' });
    const res = await request(ctx.app)
      .get(`/api/clinician/reports/${b.report.id}`)
      .set(ctx.auth.clinician);
    expect(res.body.history.map((h: { reportId: string }) => h.reportId)).toEqual([a.report.id]);
    const res2 = await request(ctx.app)
      .get(`/api/clinician/reports/${c.report.id}`)
      .set(ctx.auth.clinician);
    expect(res2.body.history.map((h: { reportId: string }) => h.reportId)).toEqual([
      b.report.id,
      a.report.id,
    ]);
  });

  it('should set reviewedAt and CLINICIAN_REVIEWED, and be idempotent with one audit row', async () => {
    const ctx = await createTestContext();
    const { report, session } = await seedReport(ctx);
    const url = `/api/clinician/reports/${report.id}/review`;
    const r1 = await request(ctx.app).post(url).set(ctx.auth.clinician);
    expect(r1.status).toBe(200);
    ctx.clock.advance(60_000);
    const r2 = await request(ctx.app).post(url).set(ctx.auth.clinician);
    expect(r2.body.reviewedAt).toBe(r1.body.reviewedAt);
    expect((await ctx.prisma.session.findUniqueOrThrow({ where: { id: session.id } })).state).toBe(
      'CLINICIAN_REVIEWED',
    );
    const row = await ctx.prisma.report.findUniqueOrThrow({ where: { id: report.id } });
    expect(row.reviewedById).toBe(ctx.users.clinician.id);
    expect(await ctx.prisma.auditLog.count({ where: { action: 'report.review' } })).toBe(1);
    expect((await request(ctx.app).post(url).set(ctx.auth.otherClinician)).status).toBe(404);
  });

  it('should create notes that appear with clinicianName and never reach the patient report', async () => {
    const ctx = await createTestContext();
    const { report, session } = await seedReport(ctx);
    const post = await request(ctx.app)
      .post(`/api/clinician/reports/${report.id}/notes`)
      .set(ctx.auth.clinician)
      .send({ text: 'Private clinician thought' });
    expect(post.status).toBe(201);
    expect(post.body).toMatchObject({
      text: 'Private clinician thought',
      clinicianName: 'Dr. Jordan Lee',
    });
    const bad = await request(ctx.app)
      .post(`/api/clinician/reports/${report.id}/notes`)
      .set(ctx.auth.clinician)
      .send({ text: '' });
    expect(bad.status).toBe(400);
    const view = await request(ctx.app)
      .get(`/api/clinician/reports/${report.id}`)
      .set(ctx.auth.clinician);
    expect(view.body.notes).toHaveLength(1);
    const patientView = await request(ctx.app)
      .get(`/api/sessions/${session.id}/report`)
      .set(ctx.auth.patient);
    expect(patientView.status).toBe(200);
    expect(JSON.stringify(patientView.body)).not.toContain('Private clinician thought');
    const audit = await ctx.prisma.auditLog.findFirstOrThrow({ where: { action: 'note.create' } });
    expect(audit.meta ?? '').not.toContain('Private');
  });
});
