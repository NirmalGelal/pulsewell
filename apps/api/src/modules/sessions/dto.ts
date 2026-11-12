import type { Message, PrismaClient, Session } from '@prisma/client';
import {
  InterviewStateSchema,
  computeProgress,
  isCovered,
  pendingItemFor,
  type InputMode,
  type MessageDto,
  type RiskLevel,
  type Sender,
  type SessionDetailDto,
  type SessionDto,
  type SessionState,
} from '@pvc/shared';
import { fromJson } from '../../lib/json';
import { isInstrumentKey } from '../interview/planner';
import { loadChecklist } from '../interview/tracker.service';

export function toMessageDto(m: Message): MessageDto {
  return {
    id: m.id,
    turnId: m.turnId,
    sender: m.sender as Sender,
    text: m.text,
    inputMode: m.inputMode as InputMode,
    createdAt: m.createdAt.toISOString(),
  };
}

export function toSessionDto(s: Session): SessionDto {
  return {
    id: s.id,
    state: s.state as SessionState,
    riskLevel: s.riskLevel as RiskLevel,
    startedAt: s.startedAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
  };
}

export async function buildSessionDetail(
  deps: { prisma: PrismaClient },
  session: Session,
): Promise<SessionDetailDto> {
  const [messages, checklist, report] = await Promise.all([
    deps.prisma.message.findMany({ where: { sessionId: session.id }, orderBy: { turnId: 'asc' } }),
    loadChecklist(deps, session.id),
    deps.prisma.report.findUnique({ where: { sessionId: session.id }, select: { id: true } }),
  ]);
  const state = fromJson(InterviewStateSchema, session.interviewState);
  const last = state.lastFocus;
  let pendingItem = null;
  if (session.state === 'INTERVIEWING' && isInstrumentKey(last)) {
    const item = checklist.find((i) => i.key === last);
    if (!item || !isCovered(item)) pendingItem = pendingItemFor(last);
  }
  return {
    session: toSessionDto(session),
    messages: messages.map(toMessageDto),
    progress: computeProgress(checklist),
    pendingItem,
    hasReport: report !== null,
  };
}
