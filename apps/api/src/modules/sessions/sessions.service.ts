import { randomBytes } from 'node:crypto';
import type { Message, Prisma, Session } from '@prisma/client';
import {
  CONSENT_VERSION,
  FollowUpDtoSchema,
  InterviewStateSchema,
  type CreateSessionRequest,
  type FollowUpDto,
  type FollowUpStatus,
  type InputMode,
  type InterviewState,
  type Sender,
  type SessionDetailDto,
  type SessionSummaryDto,
  type ReportStatus,
  type UserDto,
} from '@pvc/shared';
import { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError, badRequest, invalidState } from '../../lib/errors';
import { fromJson, toJson } from '../../lib/json';
import { audit } from '../audit/audit.service';
import { linkedClinicians } from '../auth/access';
import { buildSessionDetail, toSessionDto } from './dto';

type Db = Prisma.TransactionClient | AppDeps['prisma'];

/** Stores a message with the next turnId of the session (atomic). */
export async function storeMessage(
  deps: Pick<AppDeps, 'prisma' | 'clock'>,
  sessionId: string,
  sender: Sender,
  text: string,
  inputMode: InputMode = 'TEXT',
  db?: Db,
): Promise<Message> {
  const run = async (tx: Db): Promise<Message> => {
    const s = await tx.session.update({
      where: { id: sessionId },
      data: { nextTurnId: { increment: 1 } },
    });
    return tx.message.create({
      data: {
        sessionId,
        turnId: s.nextTurnId - 1,
        sender,
        text,
        inputMode,
        createdAt: deps.clock.now(),
      },
    });
  };
  if (db) return run(db);
  return deps.prisma.$transaction((tx) => run(tx));
}

export async function createSession(
  deps: AppDeps,
  user: UserDto,
  body: CreateSessionRequest,
): Promise<SessionDetailDto> {
  if (body.consent.version !== CONSENT_VERSION)
    throw badRequest('Consent version is not current', [
      { path: 'consent.version', message: 'Unsupported consent version' },
    ]);
  const clinicians = await linkedClinicians(deps.prisma, user.id);
  if (clinicians.length === 0) throw invalidState('No clinician is linked to your account yet');
  const active = await deps.prisma.session.findFirst({
    where: { patientId: user.id, state: { in: ['INTERVIEWING', 'CRISIS_PAUSED'] } },
    select: { id: true },
  });
  if (active)
    throw new AppError('INVALID_STATE', 'You already have a session in progress', {
      sessionId: active.id,
    });

  const now = deps.clock.now();
  const session = await deps.prisma.$transaction(async (tx) => {
    const created = await tx.session.create({
      data: {
        patientId: user.id,
        state: 'INTERVIEWING',
        consentVersion: body.consent.version,
        consentedAt: now,
        cacheSalt: randomBytes(32).toString('base64'),
        startedAt: now,
      },
    });
    const pending = await tx.followUp.findMany({
      where: { patientId: user.id, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
    });
    const questions: string[] = [];
    let clinicianId: string | null = null;
    for (const f of pending) {
      clinicianId ??= f.clinicianId;
      questions.push(...fromJson(z.array(z.string()), f.questions));
    }
    if (pending.length > 0)
      await tx.followUp.updateMany({
        where: { id: { in: pending.map((f) => f.id) } },
        data: { status: 'ASKED' satisfies FollowUpStatus, askedInSessionId: created.id },
      });
    let clinicianName = '';
    if (clinicianId) {
      const c = await tx.user.findUnique({ where: { id: clinicianId } });
      clinicianName = c?.displayName ?? '';
    }
    const firstName = user.displayName.trim().split(/\s+/)[0] || 'there';
    const followUpLine =
      pending.length > 0 && clinicianName
        ? `${clinicianName} also asked me to check in about a couple of things — we'll get to those. `
        : '';
    const text =
      `Hi ${firstName}. I'm here to help you get ready for your visit. I'll ask some questions so your clinician can understand ` +
      `what you're going through. There are no right or wrong answers, you can skip anything, and you'll see everything before ` +
      `it's shared. ${followUpLine}To start, what's been going on that made you want to talk to someone?`;
    const state: InterviewState = {
      lastFocus: 'chief_concern',
      attempts: { chief_concern: 1 },
      askedFollowUps: 0,
      followUpQuestions: questions.slice(0, 5),
      safetyFollowUpDone: false,
    };
    await tx.session.update({ where: { id: created.id }, data: { interviewState: toJson(state) } });
    await storeMessage(deps, created.id, 'COMPANION', text, 'TEXT', tx);
    return tx.session.findUniqueOrThrow({ where: { id: created.id } });
  });
  await audit(deps, {
    actorId: user.id,
    action: 'session.create',
    resourceType: 'session',
    resourceId: session.id,
  });
  return buildSessionDetail(deps, session);
}

export async function listSessions(deps: AppDeps, patientId: string): Promise<SessionSummaryDto[]> {
  const rows = await deps.prisma.session.findMany({
    where: { patientId },
    orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
    include: { report: { select: { status: true } } },
  });
  return rows.map((r) => ({
    ...toSessionDto(r),
    reportStatus: (r.report?.status as ReportStatus | undefined) ?? null,
  }));
}

export async function resumeSession(
  deps: AppDeps,
  user: UserDto,
  session: Session,
): Promise<SessionDetailDto> {
  if (session.state !== 'CRISIS_PAUSED') throw invalidState('Only a paused session can be resumed');
  const state = fromJson(InterviewStateSchema, session.interviewState);
  state.safetyFollowUpDone = true;
  const updated = await deps.prisma.$transaction(async (tx) => {
    await storeMessage(
      deps,
      session.id,
      'COMPANION',
      "Thank you for letting me know you're safe right now. We can keep going whenever you're ready, and you can stop at any time. If things feel unsafe again, please call or text 988.",
      'TEXT',
      tx,
    );
    return tx.session.update({
      where: { id: session.id },
      data: { state: 'INTERVIEWING', interviewState: toJson(state) },
    });
  });
  await audit(deps, {
    actorId: user.id,
    action: 'session.resume',
    resourceType: 'session',
    resourceId: session.id,
  });
  return buildSessionDetail(deps, updated);
}

export async function listPendingFollowUps(
  deps: AppDeps,
  patientId: string,
): Promise<FollowUpDto[]> {
  const rows = await deps.prisma.followUp.findMany({
    where: { patientId, status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });
  if (rows.length === 0) return [];
  const clinicians = await deps.prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.clinicianId))] } },
    select: { id: true, displayName: true },
  });
  const byId = new Map(clinicians.map((c) => [c.id, c]));
  return rows.map((r) =>
    FollowUpDtoSchema.parse({
      id: r.id,
      clinician: byId.get(r.clinicianId) ?? { id: r.clinicianId, displayName: 'Your clinician' },
      questions: fromJson(z.array(z.string()), r.questions),
      status: r.status,
      createdAt: r.createdAt.toISOString(),
    }),
  );
}
