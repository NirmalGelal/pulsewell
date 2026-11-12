import type { SessionState } from './enums';

export const SESSION_TRANSITIONS: Record<SessionState, SessionState[]> = {
  INTERVIEWING: ['CRISIS_PAUSED', 'GENERATING_REPORT'],
  CRISIS_PAUSED: ['INTERVIEWING', 'GENERATING_REPORT'],
  GENERATING_REPORT: ['PATIENT_REVIEW', 'GENERATING_REPORT'], // self = retry after failure
  PATIENT_REVIEW: ['SUBMITTED'],
  SUBMITTED: ['CLINICIAN_REVIEWED'],
  CLINICIAN_REVIEWED: [],
};

export function canTransition(from: SessionState, to: SessionState): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: SessionState, to: SessionState): void {
  if (!canTransition(from, to)) throw new Error(`INVALID_TRANSITION ${from}→${to}`);
}
