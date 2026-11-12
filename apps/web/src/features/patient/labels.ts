import type { SessionState } from '@pvc/shared';

export const STATE_LABELS: Record<SessionState, string> = {
  INTERVIEWING: 'In progress',
  CRISIS_PAUSED: 'Paused',
  GENERATING_REPORT: 'Preparing summary',
  PATIENT_REVIEW: 'Ready for your review',
  SUBMITTED: 'Sent to your clinician',
  CLINICIAN_REVIEWED: 'Reviewed by your clinician',
};

/** Where a session lives in the patient app. */
export function sessionPath(id: string, state: SessionState): string {
  return state === 'PATIENT_REVIEW' || state === 'SUBMITTED' || state === 'CLINICIAN_REVIEWED'
    ? `/patient/session/${id}/review`
    : `/patient/session/${id}`;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
