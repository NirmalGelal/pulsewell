export const ROLES = ['PATIENT', 'CLINICIAN', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const SESSION_STATES = [
  'INTERVIEWING', // conversation in progress
  'CRISIS_PAUSED', // imminent risk detected; interview stopped
  'GENERATING_REPORT', // report pipeline running (or failed and retryable)
  'PATIENT_REVIEW', // draft report ready; patient reviewing/editing
  'SUBMITTED', // patient approved; visible to clinician
  'CLINICIAN_REVIEWED', // clinician marked reviewed
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const RISK_LEVELS = ['none', 'concern', 'elevated', 'imminent'] as const; // ordered low→high
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const riskRank = (l: RiskLevel): number => RISK_LEVELS.indexOf(l);
export const maxRisk = (...ls: RiskLevel[]): RiskLevel =>
  ls.reduce<RiskLevel>((acc, l) => (riskRank(l) > riskRank(acc) ? l : acc), 'none');

export const RISK_CATEGORIES = [
  'suicidal_ideation',
  'self_harm',
  'harm_to_others',
  'abuse',
  'psychosis',
  'substance_emergency',
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const SAFETY_SOURCES = ['keyword', 'model', 'instrument'] as const;
export type SafetySource = (typeof SAFETY_SOURCES)[number];

export const SENDERS = ['PATIENT', 'COMPANION'] as const;
export type Sender = (typeof SENDERS)[number];

export const INPUT_MODES = ['TEXT', 'VOICE', 'TAP'] as const; // TAP = answer chip
export type InputMode = (typeof INPUT_MODES)[number];

export const ITEM_STATUSES = ['answered', 'partial', 'declined'] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const CHECKLIST_SOURCES = ['tracker', 'patient_tap'] as const;
export type ChecklistSource = (typeof CHECKLIST_SOURCES)[number];

export const REPORT_STATUSES = ['DRAFT', 'APPROVED'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const EDIT_KINDS = ['correct', 'annotate', 'remove'] as const;
export type EditKind = (typeof EDIT_KINDS)[number];

export const FOLLOW_UP_STATUSES = ['PENDING', 'ASKED'] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export const LLM_ROLES = [
  'interviewer',
  'safety',
  'tracker',
  'reportWriter',
  'verifier',
  'assistant',
  'stt',
] as const;
export type LlmRole = (typeof LLM_ROLES)[number];

export const SEVERITY_BANDS = [
  'minimal',
  'mild',
  'moderate',
  'moderately_severe',
  'severe',
] as const;
export type SeverityBand = (typeof SEVERITY_BANDS)[number];
