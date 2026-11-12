import { Router } from 'express';
import {
  AlertsQuerySchema,
  AskRequestSchema,
  CreateFollowUpRequestSchema,
  CreatePatientRequestSchema,
  CreateNoteRequestSchema,
  IdParamSchema,
  PatientIdParamSchema,
  ReportIdParamSchema,
  type AlertsQuery,
  type AskRequest,
  type CreateFollowUpRequest,
  type CreateNoteRequest,
  type CreatePatientRequest,
} from '@pvc/shared';
import type { AppDeps } from '../../deps';
import { validate } from '../../lib/validate';
import { getUser, requireAuth, requireRole } from '../auth/auth.middleware';
import { acknowledgeAlert, listAlerts } from './alerts.service';
import { askRecord } from './assistant.service';
import { createFollowUp } from './followups.service';
import { createNote } from './notes.service';
import { createPatient, resetPatientPassword } from './onboarding.service';
import { listPatients } from './patients.service';
import { buildQueue } from './queue.service';
import { markReviewed, viewReport } from './report.service';

export function clinicianRouter(deps: AppDeps): Router {
  const r = Router();
  r.use('/clinician', requireAuth(deps), requireRole('CLINICIAN'));

  r.get('/clinician/queue', async (req, res) => {
    res.json({ items: await buildQueue(deps, getUser(req).id) });
  });

  r.get(
    '/clinician/reports/:reportId',
    validate({ params: ReportIdParamSchema }),
    async (req, res) => {
      res.json(await viewReport(deps, getUser(req).id, String(req.params.reportId)));
    },
  );

  r.post(
    '/clinician/reports/:reportId/review',
    validate({ params: ReportIdParamSchema }),
    async (req, res) => {
      res.json(await markReviewed(deps, getUser(req).id, String(req.params.reportId)));
    },
  );

  r.post(
    '/clinician/reports/:reportId/notes',
    validate({ params: ReportIdParamSchema, body: CreateNoteRequestSchema }),
    async (req, res) => {
      const note = await createNote(
        deps,
        getUser(req),
        String(req.params.reportId),
        (req.body as CreateNoteRequest).text,
      );
      res.status(201).json(note);
    },
  );

  r.get('/clinician/patients', async (req, res) => {
    res.json({ patients: await listPatients(deps, getUser(req).id) });
  });

  r.post(
    '/clinician/patients',
    validate({ body: CreatePatientRequestSchema }),
    async (req, res) => {
      res
        .status(201)
        .json(await createPatient(deps, getUser(req).id, req.body as CreatePatientRequest));
    },
  );

  r.post(
    '/clinician/patients/:patientId/reset-password',
    validate({ params: PatientIdParamSchema }),
    async (req, res) => {
      res.json(await resetPatientPassword(deps, getUser(req).id, String(req.params.patientId)));
    },
  );

  r.post(
    '/clinician/patients/:patientId/ask',
    validate({ params: PatientIdParamSchema, body: AskRequestSchema }),
    async (req, res) => {
      res.json(
        await askRecord(
          deps,
          getUser(req).id,
          String(req.params.patientId),
          (req.body as AskRequest).question,
        ),
      );
    },
  );

  r.post(
    '/clinician/patients/:patientId/follow-ups',
    validate({ params: PatientIdParamSchema, body: CreateFollowUpRequestSchema }),
    async (req, res) => {
      const dto = await createFollowUp(
        deps,
        getUser(req),
        String(req.params.patientId),
        (req.body as CreateFollowUpRequest).questions,
      );
      res.status(201).json(dto);
    },
  );

  r.get('/clinician/alerts', validate({ query: AlertsQuerySchema }), async (req, res) => {
    const { status } = res.locals.query as AlertsQuery;
    res.json({ alerts: await listAlerts(deps, getUser(req).id, status) });
  });

  r.post('/clinician/alerts/:id/ack', validate({ params: IdParamSchema }), async (req, res) => {
    res.json(await acknowledgeAlert(deps, getUser(req).id, String(req.params.id)));
  });

  return r;
}
