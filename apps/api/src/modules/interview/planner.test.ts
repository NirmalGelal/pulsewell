import { describe, expect, it } from 'vitest';
import type { ChecklistItemLike, ChecklistKey, InterviewState } from '@pvc/shared';
import { INTERVIEW_ORDER, planNextFocus } from './planner';

const state = (o: Partial<InterviewState> = {}): InterviewState => ({
  lastFocus: null,
  attempts: {},
  askedFollowUps: 0,
  followUpQuestions: [],
  safetyFollowUpDone: false,
  ...o,
});
const item = (key: ChecklistKey, o: Partial<ChecklistItemLike> = {}): ChecklistItemLike => ({
  key,
  status: 'answered',
  value: key.startsWith('phq9') || key.startsWith('gad7') ? 1 : null,
  confidence: 0.9,
  source: 'tracker',
  turnIds: [2],
  note: null,
  ...o,
});
const plan = (o: {
  checklist?: ChecklistItemLike[];
  state?: InterviewState;
  patientTurnCount?: number;
  nextTurnId?: number;
  needsSafetyFollowUp?: boolean;
}) =>
  planNextFocus({
    checklist: [],
    state: state(),
    patientTurnCount: 3,
    nextTurnId: 10,
    needsSafetyFollowUp: false,
    ...o,
  });

describe('planNextFocus', () => {
  it('should wrap up when the turn cap is exceeded, even with safety pending', () => {
    expect(plan({ nextTurnId: 121, needsSafetyFollowUp: true }).focus).toBe('wrap_up');
    expect(plan({ nextTurnId: 120 }).focus).not.toBe('wrap_up');
  });
  it('should ask a safety follow-up when elevated and not done', () => {
    expect(plan({ needsSafetyFollowUp: true }).focus).toBe('safety_followup');
  });
  it('should not ask a safety follow-up when already done', () => {
    const p = plan({ needsSafetyFollowUp: true, state: state({ safetyFollowUpDone: true }) });
    expect(p.focus).not.toBe('safety_followup');
  });
  it('should re-ask a partial instrument item with its confirm prompt, then move on after 2 attempts', () => {
    const partial = item('phq9_3', { status: 'partial', value: null, confidence: 0.4 });
    const again = plan({
      checklist: [partial],
      state: state({ lastFocus: 'phq9_3', attempts: { phq9_3: 1 } }),
    });
    expect(again.focus).toBe('phq9_3');
    expect(again.hint).toMatch(/over the last 2 weeks/);
    const moved = plan({
      checklist: [partial],
      state: state({ lastFocus: 'phq9_3', attempts: { phq9_3: 2 } }),
    });
    expect(moved.focus).not.toBe('phq9_3');
  });
  it('should open the story on the first patient turn', () => {
    expect(plan({ patientTurnCount: 1 }).focus).toBe('open_story');
  });
  it('should ask pending clinician follow-ups from the second patient turn', () => {
    const s = state({
      followUpQuestions: ['How is sleep?', 'Any side effects?'],
      askedFollowUps: 1,
    });
    const p = plan({ state: s, patientTurnCount: 2 });
    expect(p.focus).toBe('follow_up_question');
    expect(p.hint).toBe('Your clinician asked: "Any side effects?"');
    expect(p.followUpIndex).toBe(1);
    expect(plan({ state: s, patientTurnCount: 1 }).focus).toBe('open_story');
  });
  it('should skip follow-ups once all were asked', () => {
    const s = state({ followUpQuestions: ['Q'], askedFollowUps: 1 });
    expect(plan({ state: s }).focus).not.toBe('follow_up_question');
  });
  it('should pick the first uncovered key in INTERVIEW_ORDER', () => {
    const p = plan({ checklist: [item('chief_concern'), item('mood_anxiety')] });
    expect(p.focus).toBe('phq9_1');
    expect(p.hint).toMatch(/enjoyment|interest/i);
  });
  it('should skip keys with 2 or more attempts', () => {
    const p = plan({ state: state({ attempts: { chief_concern: 2 } }) });
    expect(p.focus).toBe('mood_anxiety');
  });
  it('should never return safety', () => {
    const all = INTERVIEW_ORDER.filter((k) => k !== 'priorities').map((k) => item(k));
    expect(INTERVIEW_ORDER).not.toContain('safety');
    expect(plan({ checklist: all }).focus).toBe('priorities');
  });
  it('should wrap up when everything is covered', () => {
    expect(plan({ checklist: INTERVIEW_ORDER.map((k) => item(k)) }).focus).toBe('wrap_up');
  });
  it('should wrap up when every uncovered key has been attempted twice', () => {
    const attempts = Object.fromEntries(INTERVIEW_ORDER.map((k) => [k, 2]));
    expect(plan({ state: state({ attempts }) }).focus).toBe('wrap_up');
  });
});
