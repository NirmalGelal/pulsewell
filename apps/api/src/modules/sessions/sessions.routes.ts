import { Router } from 'express';
import {
  CreateSessionRequestSchema,
  IdParamSchema,
  ResumeRequestSchema,
  SendMessageRequestSchema,
  type CreateSessionRequest,
  type SendMessageRequest,
} from '@pvc/shared';
import type { AppDeps } from '../../deps';
import { AppError, invalidState } from '../../lib/errors';
import { openSse } from '../../lib/sse';
import { validate } from '../../lib/validate';
import { getOwnedSession, linkedClinicians } from '../auth/access';
import { getUser, requireAuth, requireRole } from '../auth/auth.middleware';
import { acquireLock, releaseLock } from '../interview/locks';
import { handleMessage } from '../interview/turn.service';
import { buildSessionDetail } from './dto';
import {
  createSession,
  listPendingFollowUps,
  listSessions,
  resumeSession,
} from './sessions.service';

export function sessionsRouter(deps: AppDeps): Router {
  const r = Router();
  const patient = [requireAuth(deps), requireRole('PATIENT')];

  r.get('/patient/clinicians', ...patient, async (req, res) => {
    res.json({ clinicians: await linkedClinicians(deps.prisma, getUser(req).id) });
  });

  r.get('/patient/follow-ups', ...patient, async (req, res) => {
    res.json({ followUps: await listPendingFollowUps(deps, getUser(req).id) });
  });

  r.post(
    '/sessions',
    ...patient,
    validate({ body: CreateSessionRequestSchema }),
    async (req, res) => {
      res
        .status(201)
        .json(await createSession(deps, getUser(req), req.body as CreateSessionRequest));
    },
  );

  r.get('/sessions', ...patient, async (req, res) => {
    res.json({ sessions: await listSessions(deps, getUser(req).id) });
  });

  r.get('/sessions/:id', ...patient, validate({ params: IdParamSchema }), async (req, res) => {
    const session = await getOwnedSession(deps.prisma, getUser(req).id, String(req.params.id));
    res.json(await buildSessionDetail(deps, session));
  });

  r.post(
    '/sessions/:id/resume',
    ...patient,
    validate({ params: IdParamSchema, body: ResumeRequestSchema }),
    async (req, res) => {
      const user = getUser(req);
      const session = await getOwnedSession(deps.prisma, user.id, String(req.params.id));
      res.json(await resumeSession(deps, user, session));
    },
  );

  r.post(
    '/sessions/:id/messages',
    ...patient,
    validate({ params: IdParamSchema, body: SendMessageRequestSchema }),
    async (req, res) => {
      const user = getUser(req);
      const session = await getOwnedSession(deps.prisma, user.id, String(req.params.id));
      if (session.state !== 'INTERVIEWING')
        throw invalidState('This session is not accepting messages');
      if (!acquireLock(session.id)) throw invalidState('A reply is still in progress');
      const channel = openSse(res);
      try {
        await handleMessage(deps, { session, user, body: req.body as SendMessageRequest, channel });
      } catch (e) {
        deps.logger.error('turn_failed', {
          sessionId: session.id,
          name: e instanceof Error ? e.name : typeof e,
        });
        const code = e instanceof AppError ? e.code : 'INTERNAL';
        channel.send('error', {
          code,
          message: code === 'INTERNAL' ? 'Something went wrong' : 'The companion is unavailable',
        });
      } finally {
        releaseLock(session.id);
        channel.close();
      }
    },
  );

  return r;
}
