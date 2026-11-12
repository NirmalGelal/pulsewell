import type { Session } from '@prisma/client';
import {
  RISK_CATEGORIES,
  canTransition,
  maxRisk,
  riskRank,
  type RiskCategory,
  type RiskLevel,
  type SafetyClassifierOutput,
  type SafetySource,
  type SessionState,
  type Sender,
} from '@pvc/shared';
import type { AppDeps } from '../../deps';
import { toJson } from '../../lib/json';
import { audit } from '../audit/audit.service';
import { classifyRisk } from './classifier';
import { scanKeywords, type KeywordResult } from './keywords';

export interface SafetyAssessment {
  level: RiskLevel;
  categories: RiskCategory[];
  evidence: string;
  keyword: KeywordResult;
  model: SafetyClassifierOutput | null;
  modelError: boolean;
  crisis: boolean;
  showResources: boolean;
  needsSafetyFollowUp: boolean;
  session: Session;
}

export async function assessMessage(
  deps: AppDeps,
  args: {
    session: Session;
    turnId: number;
    text: string;
    recent: { turnId: number; sender: Sender; text: string }[];
    actorId: string;
  },
): Promise<SafetyAssessment> {
  const { session, turnId, text } = args;
  const kw = scanKeywords(text);

  // Rule 2: imminent keyword hits act immediately, without waiting for (or needing) a model.
  let model: SafetyClassifierOutput | null = null;
  let modelError = false;
  if (kw.level !== 'imminent') {
    try {
      model = await classifyRisk(deps, {
        text,
        recent: args.recent,
        cacheSalt: session.cacheSalt,
      });
    } catch {
      // Rule 3: a model failure never lowers risk or crashes the turn.
      modelError = true;
      deps.logger.warn('safety_model_failed', { sessionId: session.id });
    }
  }

  const modelLevel: RiskLevel = model?.level ?? 'none';
  const level = maxRisk(kw.level, modelLevel);
  const catSet = new Set<RiskCategory>([...kw.categories, ...(model?.categories ?? [])]);
  const categories = RISK_CATEGORIES.filter((c) => catSet.has(c));

  let evidence = '';
  if (kw.evidence && riskRank(kw.level) >= riskRank(modelLevel)) evidence = kw.evidence;
  else if (model?.evidence && text.toLowerCase().includes(model.evidence.toLowerCase()))
    evidence = model.evidence;
  else if (kw.evidence) evidence = kw.evidence;

  const crisis = level === 'imminent';
  const newLevel = maxRisk(session.riskLevel as RiskLevel, level); // Rule 4: never decreases

  const created: { id: string; source: SafetySource; level: RiskLevel }[] = [];
  let alertId: string | null = null;

  const updated = await deps.prisma.$transaction(async (tx) => {
    const now = deps.clock.now();
    const mk = async (source: SafetySource, lvl: RiskLevel, cats: RiskCategory[], ev: string) => {
      const row = await tx.safetyEvent.create({
        data: {
          sessionId: session.id,
          turnId,
          level: lvl,
          categories: toJson(cats),
          evidence: ev,
          source,
          createdAt: now,
        },
      });
      created.push({ id: row.id, source, level: lvl });
      return row;
    };
    let kwEvent: { id: string } | null = null;
    let modelEvent: { id: string } | null = null;
    if (kw.level !== 'none') kwEvent = await mk('keyword', kw.level, kw.categories, kw.evidence);
    if (model && model.level !== 'none') {
      const ev =
        model.evidence && text.toLowerCase().includes(model.evidence.toLowerCase())
          ? model.evidence
          : '';
      modelEvent = await mk('model', model.level, model.categories, ev);
    }

    let state = session.state as SessionState;
    if (crisis) {
      if (canTransition(state, 'CRISIS_PAUSED')) state = 'CRISIS_PAUSED';
      else if (state !== 'CRISIS_PAUSED')
        deps.logger.warn('safety_crisis_state_not_pausable', { sessionId: session.id, state });
      const eventId = (kwEvent ?? modelEvent)!.id;
      const alert = await tx.alert.create({
        data: {
          sessionId: session.id,
          patientId: session.patientId,
          safetyEventId: eventId,
          level: 'imminent',
          evidence,
          createdAt: now,
        },
      });
      alertId = alert.id;
    }
    return tx.session.update({
      where: { id: session.id },
      data: { riskLevel: newLevel, state },
    });
  });

  for (const ev of created) {
    await audit(deps, {
      actorId: args.actorId,
      action: 'safety.event',
      resourceType: 'safety_event',
      resourceId: ev.id,
      meta: { level: ev.level, sources: ev.source },
    });
  }
  if (alertId) {
    await audit(deps, {
      actorId: args.actorId,
      action: 'alert.create',
      resourceType: 'alert',
      resourceId: alertId,
      meta: { level: 'imminent' },
    });
  }

  return {
    level,
    categories,
    evidence,
    keyword: kw,
    model,
    modelError,
    crisis,
    showResources: level === 'elevated' || level === 'imminent',
    needsSafetyFollowUp: level === 'elevated',
    session: updated,
  };
}

export async function recordInstrumentRisk(
  deps: AppDeps,
  args: { sessionId: string; turnId: number; actorId: string },
): Promise<void> {
  const eventId = await deps.prisma.$transaction(async (tx) => {
    const existing = await tx.safetyEvent.findFirst({
      where: { sessionId: args.sessionId, source: 'instrument' },
    });
    if (existing) return null;
    const session = await tx.session.findUnique({ where: { id: args.sessionId } });
    if (!session) return null;
    const ev = await tx.safetyEvent.create({
      data: {
        sessionId: args.sessionId,
        turnId: args.turnId,
        level: 'elevated',
        categories: toJson(['suicidal_ideation']),
        evidence: '',
        source: 'instrument',
        createdAt: deps.clock.now(),
      },
    });
    await tx.session.update({
      where: { id: args.sessionId },
      data: { riskLevel: maxRisk(session.riskLevel as RiskLevel, 'elevated') },
    });
    return ev.id;
  });
  if (!eventId) return;
  await audit(deps, {
    actorId: args.actorId,
    action: 'safety.event',
    resourceType: 'safety_event',
    resourceId: eventId,
    meta: { level: 'elevated', sources: 'instrument' },
  });
}
