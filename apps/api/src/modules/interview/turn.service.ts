import type { Session } from '@prisma/client';
import {
  CRISIS_MESSAGE,
  CRISIS_RESOURCES,
  InterviewStateSchema,
  computeProgress,
  isCounted,
  isPhq9Item9Positive,
  pendingItemFor,
  riskRank,
  type ChecklistItemLike,
  type FocusKey,
  type InterviewState,
  type RiskLevel,
  type SendMessageRequest,
  type UserDto,
} from '@pvc/shared';
import type { AppDeps } from '../../deps';
import type { SseChannel } from '../../lib/sse';
import { fromJson, toJson } from '../../lib/json';
import { audit } from '../audit/audit.service';
import { assessMessage, recordInstrumentRisk } from '../safety/safety.service';
import { toMessageDto, toSessionDto } from '../sessions/dto';
import { storeMessage } from '../sessions/sessions.service';
import { isInstrumentKey, planNextFocus } from './planner';
import { buildInterviewerMessages } from './prompts';
import { loadChecklist, runTracker, upsertChecklistItem } from './tracker.service';

const LOST_CONNECTION = 'The companion lost its connection. Please send your message again.';

const FALLBACK_BY_FOCUS: Partial<Record<FocusKey, string>> = {
  open_story: 'Would you like to say a little more about that?',
  safety_followup:
    'Are you safe right now? Have you had thoughts of acting on these feelings, or a plan?',
  wrap_up:
    "I think I have a good picture now. Is there anything important we haven't covered? When you're ready, you can press Finish.",
};

function fallbackReply(focus: FocusKey, hint: string): string {
  const tail = FALLBACK_BY_FOCUS[focus] ?? hint.replace(/^Your clinician asked: "(.*)"$/, '$1');
  return `Thank you for telling me. ${tail}`;
}

function cleanReply(raw: string): string {
  return raw
    .trim()
    .replace(/^(companion|assistant):\s*/i, '')
    .trim();
}

/** Runs the per-turn pipeline. Caller has validated ownership/state and holds the session lock. */
export async function handleMessage(
  deps: AppDeps,
  args: { session: Session; user: UserDto; body: SendMessageRequest; channel: SseChannel },
): Promise<void> {
  const { user, body, channel } = args;
  let session = args.session;
  const state0 = fromJson(InterviewStateSchema, session.interviewState);
  const prior = await deps.prisma.message.findMany({
    where: { sessionId: session.id },
    orderBy: { turnId: 'asc' },
  });

  // 1. store patient message
  const patientMsg = await storeMessage(deps, session.id, 'PATIENT', body.text, body.inputMode);
  channel.send('patient_message', { message: toMessageDto(patientMsg) });
  await audit(deps, {
    actorId: user.id,
    action: 'message.create',
    resourceType: 'message',
    resourceId: patientMsg.id,
    meta: { inputMode: body.inputMode, chars: body.text.length },
  });

  // 2. tapped answer
  if (body.answerFor) {
    await upsertChecklistItem(deps, session.id, {
      key: body.answerFor.key,
      status: 'answered',
      value: body.answerFor.value,
      confidence: 1,
      note: null,
      turnIds: [patientMsg.turnId],
      source: 'patient_tap',
    });
  }
  const checklist0 = await loadChecklist(deps, session.id);

  // 3. safety + tracker in parallel
  const recentBefore = prior.slice(-6).map((m) => ({
    turnId: m.turnId,
    sender: m.sender as 'PATIENT' | 'COMPANION',
    text: m.text,
  }));
  const recentForTracker = [...prior, patientMsg].slice(-8).map((m) => ({
    turnId: m.turnId,
    sender: m.sender as 'PATIENT' | 'COMPANION',
    text: m.text,
  }));
  const [assessment, checklist1] = await Promise.all([
    assessMessage(deps, {
      session,
      turnId: patientMsg.turnId,
      text: body.text,
      recent: recentBefore,
      actorId: user.id,
    }),
    body.inputMode === 'TAP'
      ? Promise.resolve(checklist0)
      : runTracker(deps, {
          session,
          state: state0,
          recent: recentForTracker,
          checklist: checklist0,
        }),
  ]);
  session = assessment.session;
  channel.send('safety', {
    level: assessment.level,
    categories: assessment.categories,
    showResources: assessment.showResources,
  });

  // 4. crisis
  if (assessment.crisis) {
    await storeMessage(deps, session.id, 'COMPANION', CRISIS_MESSAGE);
    const fresh = await deps.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    channel.send('crisis', {
      level: 'imminent',
      message: CRISIS_MESSAGE,
      resources: CRISIS_RESOURCES,
      session: toSessionDto(fresh),
    });
    return;
  }

  // 5. PHQ-9 item 9 -> instrument risk + safety domain
  let checklist: ChecklistItemLike[] = checklist1;
  const item9 = checklist.find((i) => i.key === 'phq9_9');
  const item9Positive = isPhq9Item9Positive(checklist);
  const item9Zero = isCounted(item9) && item9.value === 0;
  if (item9Positive || item9Zero || item9?.status === 'declined') {
    if (item9Positive) {
      await recordInstrumentRisk(deps, {
        sessionId: session.id,
        turnId: patientMsg.turnId,
        actorId: user.id,
      });
      session = await deps.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    }
    const existing = checklist.find((i) => i.key === 'safety');
    if (existing?.status !== 'answered') {
      const safety: ChecklistItemLike = {
        key: 'safety',
        status: 'answered',
        value: null,
        confidence: 1,
        note: 'Asked about thoughts of death/self-harm; see PHQ-9 item 9',
        turnIds: item9?.turnIds ?? [patientMsg.turnId],
        source: 'tracker',
      };
      await upsertChecklistItem(deps, session.id, safety);
      checklist = [...checklist.filter((i) => i.key !== 'safety'), safety];
    }
  }

  // 6. plan
  const patientTurnCount = prior.filter((m) => m.sender === 'PATIENT').length + 1;
  const needsSafetyFollowUp =
    assessment.needsSafetyFollowUp ||
    item9Positive ||
    riskRank(session.riskLevel as RiskLevel) >= riskRank('elevated');
  const nextTurnId = (
    await deps.prisma.session.findUniqueOrThrow({
      where: { id: session.id },
      select: { nextTurnId: true },
    })
  ).nextTurnId;
  const plan = planNextFocus({
    checklist,
    state: state0,
    patientTurnCount,
    nextTurnId,
    needsSafetyFollowUp,
  });

  // 7. stream reply
  const history = await deps.prisma.message.findMany({
    where: { sessionId: session.id },
    orderBy: { turnId: 'asc' },
  });
  const messages = buildInterviewerMessages({
    displayName: user.displayName,
    focus: plan.focus,
    hint: plan.hint,
    history: history.map((m) => ({
      turnId: m.turnId,
      sender: m.sender as 'PATIENT' | 'COMPANION',
      text: m.text,
    })),
    riskLevel: session.riskLevel as RiskLevel,
  });
  let streamed = '';
  let tokens = 0;
  let reply: string;
  try {
    const stream = deps.llm.stream('interviewer', { messages, cacheSalt: session.cacheSalt });
    stream.result.catch(() => undefined);
    for await (const delta of stream) {
      if (delta === '') continue;
      streamed += delta;
      tokens += 1;
      channel.send('token', { delta });
    }
    reply = cleanReply(streamed);
  } catch (e) {
    deps.logger.warn('interviewer_failed', {
      sessionId: session.id,
      name: e instanceof Error ? e.name : typeof e,
      tokens,
    });
    if (tokens > 0) {
      channel.send('error', { code: 'LLM_UNAVAILABLE', message: LOST_CONNECTION });
      return;
    }
    reply = '';
  }
  if (reply === '') {
    reply = fallbackReply(plan.focus, plan.hint);
    channel.send('token', { delta: reply });
  }

  // 8. store companion message
  const companion = await storeMessage(deps, session.id, 'COMPANION', reply);
  channel.send('companion_message', { message: toMessageDto(companion) });

  // 9. update interview state
  const state: InterviewState = {
    ...state0,
    lastFocus: plan.focus,
    attempts: { ...state0.attempts, [plan.focus]: (state0.attempts[plan.focus] ?? 0) + 1 },
    askedFollowUps: state0.askedFollowUps + (plan.focus === 'follow_up_question' ? 1 : 0),
    safetyFollowUpDone: state0.safetyFollowUpDone || plan.focus === 'safety_followup',
  };
  await deps.prisma.session.update({
    where: { id: session.id },
    data: { interviewState: toJson(state) },
  });

  // 10. done
  channel.send('done', {
    progress: computeProgress(checklist),
    pendingItem: isInstrumentKey(plan.focus) ? pendingItemFor(plan.focus) : null,
  });
}
