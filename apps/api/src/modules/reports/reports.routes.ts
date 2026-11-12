import { Router } from 'express';
import type { Report, Session } from '@prisma/client';
import {
  EditReportRequestSchema,
  IdParamSchema,
  ReportContentSchema,
  assertTransition,
  type EditReportRequest,
  type PatientReportDto,
  type ReportStatus,
  type SessionState,
  type Sender,
} from '@pvc/shared';
import type { AppDeps } from '../../deps';
import { invalidState, notFound } from '../../lib/errors';
import { fromJson, toJson } from '../../lib/json';
import { validate } from '../../lib/validate';
import { audit } from '../audit/audit.service';
import { getOwnedSession } from '../auth/access';
import { getUser, requireAuth, requireRole } from '../auth/auth.middleware';
import { acquireLock, releaseLock } from '../interview/locks';
import { LlmUnavailableError } from '../llm/types';
import { toSessionDto } from '../sessions/dto';
import { applyEdits } from './edits';
import { generateReport } from './pipeline.service';
import { computeRedactedTurns } from './redaction';

export function toPatientReportDto(report: Report): PatientReportDto {
  return {
    reportId: report.id,
    status: report.status as ReportStatus,
    content: fromJson(ReportContentSchema, report.currentJson),
    approvedAt: report.approvedAt ? report.approvedAt.toISOString() : null,
  };
}

async function getReportFor(deps: AppDeps, session: Session): Promise<Report> {
  const report = await deps.prisma.report.findUnique({ where: { sessionId: session.id } });
  if (!report) throw notFound('Report not found');
  return report;
}

export function reportsRouter(deps: AppDeps): Router {
  const r = Router();
  const patient = [requireAuth(deps), requireRole('PATIENT')];

  r.post(
    '/sessions/:id/finish',
    ...patient,
    validate({ params: IdParamSchema }),
    async (req, res) => {
      const user = getUser(req);
      let session = await getOwnedSession(deps.prisma, user.id, String(req.params.id));
      if (!['INTERVIEWING', 'CRISIS_PAUSED', 'GENERATING_REPORT'].includes(session.state))
        throw invalidState('This session can no longer be finished');
      const patientMsgs = await deps.prisma.message.count({
        where: { sessionId: session.id, sender: 'PATIENT' },
      });
      if (patientMsgs === 0) throw invalidState("There's nothing to summarize yet");
      if (!acquireLock(session.id)) throw invalidState('A reply is still in progress');
      try {
        assertTransition(session.state as SessionState, 'GENERATING_REPORT');
        session = await deps.prisma.session.update({
          where: { id: session.id },
          data: { state: 'GENERATING_REPORT', endedAt: session.endedAt ?? deps.clock.now() },
        });
        let result;
        try {
          result = await generateReport(deps, session, user.displayName);
        } catch (e) {
          if (e instanceof LlmUnavailableError) {
            throw new LlmUnavailableError(
              "We couldn't prepare your summary just now. Please try again.",
            );
          }
          throw e;
        }
        const json = toJson(result.content);
        const report = await deps.prisma.$transaction(async (tx) => {
          const saved = await tx.report.upsert({
            where: { sessionId: session.id },
            create: { sessionId: session.id, status: 'DRAFT', draftJson: json, currentJson: json },
            update: { status: 'DRAFT', draftJson: json, currentJson: json, approvedAt: null },
          });
          await tx.session.update({ where: { id: session.id }, data: { state: 'PATIENT_REVIEW' } });
          return saved;
        });
        await audit(deps, {
          actorId: user.id,
          action: 'report.generate',
          resourceType: 'report',
          resourceId: report.id,
          meta: {
            claimsRemoved: result.claimsRemoved,
            quotesRemoved: result.quotesRemoved,
            regenerated: result.regenerated,
          },
        });
        res.json(toPatientReportDto(report));
      } finally {
        releaseLock(session.id);
      }
    },
  );

  r.get(
    '/sessions/:id/report',
    ...patient,
    validate({ params: IdParamSchema }),
    async (req, res) => {
      const session = await getOwnedSession(deps.prisma, getUser(req).id, String(req.params.id));
      res.json(toPatientReportDto(await getReportFor(deps, session)));
    },
  );

  r.patch(
    '/sessions/:id/report',
    ...patient,
    validate({ params: IdParamSchema, body: EditReportRequestSchema }),
    async (req, res) => {
      const user = getUser(req);
      const session = await getOwnedSession(deps.prisma, user.id, String(req.params.id));
      const report = await getReportFor(deps, session);
      if (session.state !== 'PATIENT_REVIEW' || report.status !== 'DRAFT')
        throw invalidState('This report can no longer be edited');
      const { edits } = req.body as EditReportRequest;
      const current = fromJson(ReportContentSchema, report.currentJson);
      const { content, applied } = applyEdits(current, edits, deps.clock.now());
      const saved = await deps.prisma.$transaction(async (tx) => {
        for (const a of applied)
          await tx.reportEdit.create({
            data: {
              reportId: report.id,
              kind: a.kind,
              section: a.section,
              itemId: a.itemId,
              originalText: a.originalText,
              newText: a.newText,
              createdAt: deps.clock.now(),
            },
          });
        return tx.report.update({
          where: { id: report.id },
          data: { currentJson: toJson(content) },
        });
      });
      await audit(deps, {
        actorId: user.id,
        action: 'report.edit',
        resourceType: 'report',
        resourceId: report.id,
        meta: { count: applied.length },
      });
      res.json(toPatientReportDto(saved));
    },
  );

  r.post(
    '/sessions/:id/report/approve',
    ...patient,
    validate({ params: IdParamSchema }),
    async (req, res) => {
      const user = getUser(req);
      const session = await getOwnedSession(deps.prisma, user.id, String(req.params.id));
      const report = await getReportFor(deps, session);
      if (session.state !== 'PATIENT_REVIEW' || report.status !== 'DRAFT')
        throw invalidState('This report has already been approved');
      assertTransition('PATIENT_REVIEW', 'SUBMITTED');
      const content = fromJson(ReportContentSchema, report.currentJson);
      const [messages, events] = await Promise.all([
        deps.prisma.message.findMany({ where: { sessionId: session.id } }),
        deps.prisma.safetyEvent.findMany({
          where: { sessionId: session.id },
          select: { turnId: true },
        }),
      ]);
      const redacted = computeRedactedTurns(
        content,
        messages.map((m) => ({ turnId: m.turnId, sender: m.sender as Sender })),
        events.map((e) => e.turnId),
      );
      const [savedReport, savedSession] = await deps.prisma.$transaction(async (tx) => {
        const rep = await tx.report.update({
          where: { id: report.id },
          data: { status: 'APPROVED', approvedAt: deps.clock.now() },
        });
        if (redacted.length > 0)
          await tx.message.updateMany({
            where: { sessionId: session.id, turnId: { in: redacted }, sender: 'PATIENT' },
            data: { redacted: true },
          });
        const sess = await tx.session.update({
          where: { id: session.id },
          data: { state: 'SUBMITTED' },
        });
        return [rep, sess] as const;
      });
      await audit(deps, {
        actorId: user.id,
        action: 'report.approve',
        resourceType: 'report',
        resourceId: report.id,
        meta: { redactedTurns: redacted.length },
      });
      res.json({ report: toPatientReportDto(savedReport), session: toSessionDto(savedSession) });
    },
  );

  return r;
}
