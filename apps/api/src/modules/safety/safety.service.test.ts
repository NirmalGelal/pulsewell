import { describe, expect, it, vi } from 'vitest';
import { createTestContext } from '../../test/context';
import { MockLlmClient } from '../llm/mock-client';
import { assessMessage, recordInstrumentRisk } from './safety.service';

async function setup(llm = new MockLlmClient(), level = 'none') {
  const warn = vi.fn();
  const ctx = await createTestContext({ llm });
  ctx.deps.logger = { ...ctx.deps.logger, warn };
  const session = await ctx.prisma.session.create({
    data: {
      patientId: ctx.users.patient.id,
      state: 'INTERVIEWING',
      consentVersion: 'v1',
      consentedAt: ctx.clock.now(),
      cacheSalt: 'salt',
      riskLevel: level,
    },
  });
  const run = (text: string, session0 = session) =>
    assessMessage(ctx.deps, {
      session: session0,
      turnId: 1,
      text,
      recent: [],
      actorId: ctx.users.patient.id,
    });
  return { ...ctx, llm, warn, session, run };
}
const none = { level: 'none', categories: [], evidence: '' };

describe('assessMessage', () => {
  it('should do nothing for none/none', async () => {
    const { run, prisma, llm } = await setup(new MockLlmClient().on('safety', none));
    const a = await run('I slept badly');
    expect(a.level).toBe('none');
    expect(a.showResources).toBe(false);
    expect(a.crisis).toBe(false);
    expect(await prisma.safetyEvent.count()).toBe(0);
    expect(a.session.riskLevel).toBe('none');
    expect(llm.calls).toHaveLength(1);
  });

  it('should record a model event and raise risk when only the model fires (elevated)', async () => {
    const { run, prisma } = await setup(
      new MockLlmClient().on('safety', {
        level: 'elevated',
        categories: ['suicidal_ideation'],
        evidence: 'not around',
      }),
    );
    const a = await run('Sometimes I think everyone would be fine without me, not around');
    expect(a.level).toBe('elevated');
    expect(a.needsSafetyFollowUp).toBe(true);
    expect(a.showResources).toBe(true);
    expect(a.session.riskLevel).toBe('elevated');
    expect(a.session.state).toBe('INTERVIEWING');
    const events = await prisma.safetyEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]!.source).toBe('model');
    expect(await prisma.alert.count()).toBe(0);
  });

  it('should not call the model and should pause + alert on imminent keywords', async () => {
    const { run, prisma, llm } = await setup();
    const a = await run("I'm going to kill myself tonight");
    expect(llm.calls.filter((c) => c.role === 'safety')).toHaveLength(0);
    expect(a.model).toBeNull();
    expect(a.modelError).toBe(false);
    expect(a.crisis).toBe(true);
    expect(a.session.state).toBe('CRISIS_PAUSED');
    expect(a.session.riskLevel).toBe('imminent');
    const alert = await prisma.alert.findFirstOrThrow({ include: { safetyEvent: true } });
    expect(alert.safetyEvent.source).toBe('keyword');
    expect(alert.level).toBe('imminent');
    expect(alert.evidence).toBe("I'm going to kill myself");
    expect(alert.patientId).toBe(a.session.patientId);
  });

  it('should pause + alert linked to the model event when the model says imminent', async () => {
    const { run, prisma } = await setup(
      new MockLlmClient().on('safety', {
        level: 'imminent',
        categories: ['substance_emergency'],
        evidence: 'swallowed the whole bottle',
      }),
    );
    const a = await run('I just swallowed the whole bottle');
    expect(a.session.state).toBe('CRISIS_PAUSED');
    expect(a.evidence).toBe('swallowed the whole bottle');
    const alert = await prisma.alert.findFirstOrThrow({ include: { safetyEvent: true } });
    expect(alert.safetyEvent.source).toBe('model');
  });

  it('should fall back to the keyword result when the model throws', async () => {
    const { run, warn, session } = await setup(new MockLlmClient().fail('safety'));
    const a = await run('I want to die');
    expect(a.modelError).toBe(true);
    expect(a.model).toBeNull();
    expect(a.level).toBe('elevated');
    expect(a.session.riskLevel).toBe('elevated');
    expect(warn).toHaveBeenCalledWith('safety_model_failed', { sessionId: session.id });
  });

  it('should fail open (level none, no exception) when the model throws and keywords are none', async () => {
    const { run, prisma } = await setup(new MockLlmClient().fail('safety'));
    const a = await run('I am tired today');
    expect(a.modelError).toBe(true);
    expect(a.level).toBe('none');
    expect(a.session.state).toBe('INTERVIEWING');
    expect(await prisma.safetyEvent.count()).toBe(0);
  });

  it('should blank model evidence that is not a substring of the message', async () => {
    const { run, prisma } = await setup(
      new MockLlmClient().on('safety', {
        level: 'concern',
        categories: ['suicidal_ideation'],
        evidence: 'invented quote',
      }),
    );
    const a = await run('Things feel heavy');
    expect(a.evidence).toBe('');
    expect((await prisma.safetyEvent.findFirstOrThrow()).evidence).toBe('');
  });

  it('should never decrease session risk', async () => {
    const { run, session } = await setup(new MockLlmClient().on('safety', none), 'elevated');
    const a = await run('I feel okay now', { ...session, riskLevel: 'elevated' });
    expect(a.level).toBe('none');
    expect(a.session.riskLevel).toBe('elevated');
  });

  it('should create two events and link the alert to the keyword event when both layers fire', async () => {
    const { run, prisma } = await setup(
      new MockLlmClient().on('safety', {
        level: 'imminent',
        categories: ['suicidal_ideation'],
        evidence: 'end it',
      }),
    );
    // keyword elevated ("want to die"), model imminent -> both fire, alert on keyword event
    const a = await run('I want to die and I will end it');
    expect(a.level).toBe('imminent');
    const events = await prisma.safetyEvent.findMany({ orderBy: { createdAt: 'asc' } });
    expect(events.map((e) => e.source).sort()).toEqual(['keyword', 'model']);
    const alert = await prisma.alert.findFirstOrThrow({ include: { safetyEvent: true } });
    expect(alert.safetyEvent.source).toBe('keyword');
    expect(await prisma.alert.count()).toBe(1);
  });

  it('should write audit rows without message text', async () => {
    const { run, prisma } = await setup(
      new MockLlmClient().on('safety', {
        level: 'imminent',
        categories: ['suicidal_ideation'],
        evidence: 'end it',
      }),
    );
    await run('I want to die and I will end it');
    const rows = await prisma.auditLog.findMany();
    expect(rows.map((r) => r.action).sort()).toEqual([
      'alert.create',
      'safety.event',
      'safety.event',
    ]);
    for (const r of rows) {
      expect(r.meta ?? '').not.toMatch(/want to die|end it/i);
    }
  });
});

describe('recordInstrumentRisk', () => {
  it('should insert exactly one instrument event and raise risk to at least elevated', async () => {
    const { deps, prisma, session, users } = await setup();
    const args = { sessionId: session.id, turnId: 3, actorId: users.patient.id };
    await recordInstrumentRisk(deps, args);
    await recordInstrumentRisk(deps, args);
    const events = await prisma.safetyEvent.findMany();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ source: 'instrument', level: 'elevated', evidence: '' });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).riskLevel).toBe(
      'elevated',
    );
    expect(await prisma.alert.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'safety.event' } })).toBe(1);
  });

  it('should not lower an imminent session', async () => {
    const { deps, prisma, session, users } = await setup(new MockLlmClient(), 'imminent');
    await recordInstrumentRisk(deps, {
      sessionId: session.id,
      turnId: 1,
      actorId: users.patient.id,
    });
    expect((await prisma.session.findUniqueOrThrow({ where: { id: session.id } })).riskLevel).toBe(
      'imminent',
    );
  });
});
