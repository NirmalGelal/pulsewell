# Contracts — single source of truth

All modules implement **exactly** these names and shapes. TypeScript below is normative; M01 turns it
into zod schemas in `packages/shared` (type = `z.infer<typeof Schema>`; schema name = type name + `Schema`,
e.g. `MessageDtoSchema`). JSON is camelCase. Timestamps are ISO-8601 strings in DTOs.

---

## 1. Enums (`packages/shared/src/enums.ts`)

```ts
export const ROLES = ['PATIENT', 'CLINICIAN', 'ADMIN'] as const;
export type Role = (typeof ROLES)[number];

export const SESSION_STATES = [
  'INTERVIEWING',       // conversation in progress
  'CRISIS_PAUSED',      // imminent risk detected; interview stopped
  'GENERATING_REPORT',  // report pipeline running (or failed and retryable)
  'PATIENT_REVIEW',     // draft report ready; patient reviewing/editing
  'SUBMITTED',          // patient approved; visible to clinician
  'CLINICIAN_REVIEWED', // clinician marked reviewed
] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const RISK_LEVELS = ['none', 'concern', 'elevated', 'imminent'] as const; // ordered low→high
export type RiskLevel = (typeof RISK_LEVELS)[number];
export const riskRank = (l: RiskLevel) => RISK_LEVELS.indexOf(l);
export const maxRisk = (...ls: RiskLevel[]): RiskLevel => /* highest by riskRank; 'none' if empty */;

export const RISK_CATEGORIES = [
  'suicidal_ideation', 'self_harm', 'harm_to_others', 'abuse', 'psychosis', 'substance_emergency',
] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const SAFETY_SOURCES = ['keyword', 'model', 'instrument'] as const;
export type SafetySource = (typeof SAFETY_SOURCES)[number];

export const SENDERS = ['PATIENT', 'COMPANION'] as const;
export type Sender = (typeof SENDERS)[number];

export const INPUT_MODES = ['TEXT', 'VOICE', 'TAP'] as const;  // TAP = answer chip
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

export const LLM_ROLES = ['interviewer', 'safety', 'tracker', 'reportWriter', 'verifier', 'assistant', 'stt'] as const;
export type LlmRole = (typeof LLM_ROLES)[number];

export const SEVERITY_BANDS = ['minimal', 'mild', 'moderate', 'moderately_severe', 'severe'] as const;
export type SeverityBand = (typeof SEVERITY_BANDS)[number];
```

## 2. Keys (`packages/shared/src/keys.ts`)

```ts
export const PHQ9_KEYS = ['phq9_1','phq9_2','phq9_3','phq9_4','phq9_5','phq9_6','phq9_7','phq9_8','phq9_9'] as const;
export const GAD7_KEYS = ['gad7_1','gad7_2','gad7_3','gad7_4','gad7_5','gad7_6','gad7_7'] as const;
export type Phq9Key = (typeof PHQ9_KEYS)[number];
export type Gad7Key = (typeof GAD7_KEYS)[number];
export type InstrumentItemKey = Phq9Key | Gad7Key;
export const INSTRUMENT_ITEM_KEYS = [...PHQ9_KEYS, ...GAD7_KEYS] as const;

// Interview domains (coverage checklist). Order = default interview order.
export const DOMAIN_KEYS = [
  'chief_concern', 'mood_anxiety', 'sleep_appetite_energy', 'functioning', 'substance_use',
  'safety', 'history', 'supports', 'goals', 'priorities',
] as const;
export type DomainKey = (typeof DOMAIN_KEYS)[number];

export type ChecklistKey = InstrumentItemKey | DomainKey;
export const CHECKLIST_KEYS = [...INSTRUMENT_ITEM_KEYS, ...DOMAIN_KEYS] as const;

// Report summary sections (clinician headings in parentheses)
export const SUMMARY_SECTIONS = [
  'chiefConcern',        // Chief concern
  'presentConcern',      // History of present concern (onset, course, triggers)
  'moodAnxiety',         // Mood & anxiety
  'sleepAppetiteEnergy', // Sleep, appetite, energy
  'functioning',         // Functioning (work/school, home, relationships)
  'substanceUse',        // Substance use
  'history',             // Past psychiatric history, treatment, medications
  'supports',            // Supports & strengths
  'carePreferences',     // Goals & care preferences
] as const;
export type SummarySection = (typeof SUMMARY_SECTIONS)[number];

// Sections a patient edit may target
export const EDITABLE_SECTIONS = [...SUMMARY_SECTIONS, 'priorities', 'quotes'] as const;
export type EditableSection = (typeof EDITABLE_SECTIONS)[number];
// Sections a patient may only annotate (never correct/remove)
export const ANNOTATE_ONLY_SECTIONS = ['risk', 'screening'] as const;
export type AnnotatableSection = EditableSection | (typeof ANNOTATE_ONLY_SECTIONS)[number];
```

## 3. Session state machine (`packages/shared/src/state-machine.ts`)

```ts
export const SESSION_TRANSITIONS: Record<SessionState, SessionState[]> = {
  INTERVIEWING:       ['CRISIS_PAUSED', 'GENERATING_REPORT'],
  CRISIS_PAUSED:      ['INTERVIEWING', 'GENERATING_REPORT'],
  GENERATING_REPORT:  ['PATIENT_REVIEW', 'GENERATING_REPORT'], // self = retry after failure
  PATIENT_REVIEW:     ['SUBMITTED'],
  SUBMITTED:          ['CLINICIAN_REVIEWED'],
  CLINICIAN_REVIEWED: [],
};
export function canTransition(from: SessionState, to: SessionState): boolean;
export function assertTransition(from: SessionState, to: SessionState): void; // throws Error('INVALID_TRANSITION from→to')
```

## 4. Database (Prisma, SQLite) — `apps/api/prisma/schema.prisma`

Comments name the TS type stored in each string column. `Json<T>` = JSON string validated with `T`'s schema.

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "sqlite"  url = env("DATABASE_URL") }

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  role         String   // Role
  displayName  String
  mustChangePassword Boolean @default(false) // true while a clinician-issued temporary password is in use
  createdAt    DateTime @default(now())
  patientLinks   CareLink[] @relation("PatientLinks")
  clinicianLinks CareLink[] @relation("ClinicianLinks")
  sessions       Session[]
}

model CareLink {
  id          String   @id @default(cuid())
  patientId   String
  clinicianId String
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  patient     User @relation("PatientLinks",   fields: [patientId],   references: [id], onDelete: Cascade)
  clinician   User @relation("ClinicianLinks", fields: [clinicianId], references: [id], onDelete: Cascade)
  @@unique([patientId, clinicianId])
}

model Session {
  id             String    @id @default(cuid())
  patientId      String
  state          String    // SessionState
  consentVersion String
  consentedAt    DateTime
  cacheSalt      String    // base64, 32 random bytes; never sent to clients
  nextTurnId     Int       @default(1)
  riskLevel      String    @default("none") // RiskLevel = max over SafetyEvents
  interviewState String    @default("{}")   // Json<InterviewState> (§12) — planner memory, server-only
  startedAt      DateTime  @default(now())
  endedAt        DateTime?
  patient        User      @relation(fields: [patientId], references: [id], onDelete: Cascade)
  messages       Message[]
  checklist      ChecklistItem[]
  safetyEvents   SafetyEvent[]
  alerts         Alert[]
  report         Report?
  @@index([patientId])
}

model Message {
  id        String   @id @default(cuid())
  sessionId String
  turnId    Int      // 1,2,3… per session, shared by both senders
  sender    String   // Sender
  text      String
  inputMode String   // InputMode (COMPANION messages use 'TEXT')
  redacted  Boolean  @default(false) // true = hidden from clinician (patient removed it); never true for turns with SafetyEvents
  createdAt DateTime @default(now())
  session   Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  @@unique([sessionId, turnId])
}

model SafetyEvent {
  id         String   @id @default(cuid())
  sessionId  String
  turnId     Int
  level      String   // RiskLevel (never 'none' — 'none' results are not stored)
  categories String   // Json<RiskCategory[]>
  evidence   String   // exact phrase from the patient message ('' if none)
  source     String   // SafetySource
  createdAt  DateTime @default(now())
  session    Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  alert      Alert?
}

model ChecklistItem {
  id         String   @id @default(cuid())
  sessionId  String
  key        String   // ChecklistKey
  status     String   // ItemStatus
  value      Int?     // 0..3 for instrument items; null for domains
  confidence Float    // 0..1
  note       String?  // short tracker note for domains (clinical, third person)
  turnIds    String   // Json<number[]>
  source     String   // ChecklistSource
  updatedAt  DateTime @updatedAt
  session    Session  @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  @@unique([sessionId, key])
}

model Report {
  id           String    @id @default(cuid())
  sessionId    String    @unique
  status       String    // ReportStatus
  draftJson    String    // Json<ReportContent> exactly as generated (never modified)
  currentJson  String    // Json<ReportContent> with patient edits applied
  approvedAt   DateTime?
  reviewedAt   DateTime?
  reviewedById String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt
  session      Session   @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  edits        ReportEdit[]
  notes        ClinicianNote[]
}

model ReportEdit {
  id           String   @id @default(cuid())
  reportId     String
  kind         String   // EditKind
  section      String   // AnnotatableSection
  itemId       String?
  originalText String?
  newText      String?
  createdAt    DateTime @default(now())
  report       Report   @relation(fields: [reportId], references: [id], onDelete: Cascade)
}

model ClinicianNote {
  id          String   @id @default(cuid())
  reportId    String
  clinicianId String
  text        String
  createdAt   DateTime @default(now())
  report      Report   @relation(fields: [reportId], references: [id], onDelete: Cascade)
}

model FollowUp {
  id               String   @id @default(cuid())
  patientId        String
  clinicianId      String
  questions        String   // Json<string[]> (1..3)
  status           String   // FollowUpStatus
  askedInSessionId String?
  createdAt        DateTime @default(now())
}

model Alert {
  id               String    @id @default(cuid())
  sessionId        String
  patientId        String
  safetyEventId    String    @unique
  level            String    // RiskLevel (always 'imminent' in v1)
  evidence         String
  createdAt        DateTime  @default(now())
  acknowledgedAt   DateTime?
  acknowledgedById String?
  session          Session     @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  safetyEvent      SafetyEvent @relation(fields: [safetyEventId], references: [id], onDelete: Cascade)
}

model AuditLog {
  id           String   @id @default(cuid())
  actorId      String?
  action       String   // AuditAction (M02)
  resourceType String
  resourceId   String?
  meta         String?  // Json<Record<string, string|number|boolean>> — never PHI
  createdAt    DateTime @default(now())
}
```

## 5. Errors

Envelope for every non-2xx JSON response:
```ts
export type ErrorCode =
  | 'VALIDATION_ERROR'   // 400 — zod failure; details = zod issues (path + message only)
  | 'UNAUTHENTICATED'    // 401 — missing/invalid/expired token, bad credentials
  | 'FORBIDDEN'          // 403 — wrong role
  | 'NOT_FOUND'          // 404 — missing OR not owned
  | 'CONFLICT'           // 409 — resource already exists (duplicate email)
  | 'INVALID_STATE'      // 409 — action not allowed in current session/report state
  | 'PAYLOAD_TOO_LARGE'  // 413 — audio upload > limit
  | 'LLM_UNAVAILABLE'    // 503 — all models for a role failed
  | 'INTERNAL';          // 500
export interface ErrorBody { error: { code: ErrorCode; message: string; details?: unknown } }
```

## 6. Shared value types (DTOs)

```ts
export interface UserDto { id: string; email: string; role: Role; displayName: string; mustChangePassword: boolean }

export interface MessageDto {
  id: string; turnId: number; sender: Sender; text: string; inputMode: InputMode; createdAt: string;
}

export interface SessionDto {
  id: string; state: SessionState; riskLevel: RiskLevel; startedAt: string; endedAt: string | null;
}

export interface ProgressDto {
  covered: number;          // checklist keys with status answered|declined
  total: number;            // CHECKLIST_KEYS.length (26)
  percent: number;          // round(covered/total*100)
  missingRequired: ChecklistKey[]; // see M04 coverage rules
  canFinish: boolean;       // true when missingRequired is empty (patient may still finish early)
}

export interface AnswerOption { value: 0 | 1 | 2 | 3; label: string }
export interface PendingItemDto { key: InstrumentItemKey; prompt: string; options: AnswerOption[] }

export interface CrisisResource { id: string; name: string; action: string; href: string }

export interface SessionDetailDto {
  session: SessionDto;
  messages: MessageDto[];
  progress: ProgressDto;
  pendingItem: PendingItemDto | null;
  hasReport: boolean;
}

export interface SessionSummaryDto extends SessionDto { reportStatus: ReportStatus | null }

export interface FollowUpDto {
  id: string; clinician: { id: string; displayName: string }; questions: string[];
  status: FollowUpStatus; createdAt: string;
}

export interface QueueItemDto {
  reportId: string; sessionId: string;
  patient: { id: string; displayName: string };
  approvedAt: string; riskLevel: RiskLevel; reviewed: boolean;
  phq9: { total: number | null; band: SeverityBand | null };
  gad7: { total: number | null; band: SeverityBand | null };
  topPriority: string | null;   // first non-removed priority (clinical text)
  trend: { phq9Delta: number | null; gad7Delta: number | null } | null; // vs previous approved report of same patient
  hasUnacknowledgedAlert: boolean;
}

export interface AlertDto {
  id: string; sessionId: string; patient: { id: string; displayName: string };
  level: RiskLevel; evidence: string; createdAt: string; acknowledgedAt: string | null;
}

export interface ClinicianNoteDto { id: string; text: string; createdAt: string; clinicianName: string }

export interface TranscriptTurnDto {     // clinician view of a message
  turnId: number; sender: Sender; text: string | null; // null when redacted
  redacted: boolean; inputMode: InputMode; createdAt: string; hasSafetyEvent: boolean;
}

export interface ClinicianReportDto {
  reportId: string; status: ReportStatus; approvedAt: string; reviewedAt: string | null;
  patient: { id: string; displayName: string };
  session: SessionDto;
  content: ClinicianReportContent;  // ReportContent with removed items' text stripped (see §7)
  transcript: TranscriptTurnDto[];
  notes: ClinicianNoteDto[];
  history: { reportId: string; approvedAt: string; phq9Total: number | null; gad7Total: number | null }[]; // older approved reports, newest first
}

export interface AskResponse {
  answer: string;
  citations: { sessionId: string; turnId: number; excerpt: string }[];
  model: string;
}
```

## 7. Report content (`packages/shared/src/schemas/report.ts`)

```ts
export interface EvidenceItem {
  id: string;                 // stable within report, e.g. "presentConcern-2", "priorities-1"
  text: string;               // clinical, third person ("Reports low mood since August.")
  patientText: string;        // plain, second person ("You said your mood has been low since August.")
  turnIds: number[];          // ≥1 patient turnIds supporting the item
  patientCorrection?: string; // set by a 'correct' edit
  removedByPatient?: boolean; // set by a 'remove' edit
}

export interface Quote { id: string; text: string; turnId: number; removedByPatient?: boolean }

export interface InstrumentItemResult {
  key: InstrumentItemKey; value: 0 | 1 | 2 | 3 | null; status: ItemStatus | 'missing';
}
export interface InstrumentResult {
  items: InstrumentItemResult[];  // always all 9 (PHQ-9) or 7 (GAD-7), in order
  answeredCount: number;
  total: number | null;           // sum of values; null unless complete
  partialSum: number;             // sum of answered values (always present)
  complete: boolean;              // every item has a value
  band: SeverityBand | null;      // null unless complete
}

export interface RiskFlag {
  category: RiskCategory; level: RiskLevel; evidence: string; turnId: number; source: SafetySource;
}

export interface PatientAnnotation { id: string; section: AnnotatableSection; text: string; createdAt: string }

export interface ReportContent {
  schemaVersion: 1;
  patient: { displayName: string };
  session: { id: string; startedAt: string; endedAt: string; durationMinutes: number };
  risk: { level: RiskLevel; flags: RiskFlag[] };                 // deterministic, from SafetyEvents
  priorities: EvidenceItem[];                                    // what the patient most wants help with
  screening: { phq9: InstrumentResult; gad7: InstrumentResult }; // deterministic, from ChecklistItems
  summary: Record<SummarySection, EvidenceItem[]>;               // every section present; [] if nothing
  quotes: Quote[];                                               // 0..6, verified verbatim
  notDiscussed: DomainKey[];
  declinedTopics: DomainKey[];
  patientAnnotations: PatientAnnotation[];
  provenance: {
    aiGenerated: true;
    writerModel: string; verifierModel: string | null; generatedAt: string;
    verification: { claimsChecked: number; claimsRemoved: number; quotesRemoved: number; regenerated: boolean };
  };
}

// Clinician view: items with removedByPatient=true have text, patientText, patientCorrection
// replaced by '' and turnIds by [] (the item still appears so the UI can show
// "Patient chose not to share this item"). Same for removed quotes (text '').
export type ClinicianReportContent = ReportContent;
```

Patient-facing report DTO:
```ts
export interface PatientReportDto { reportId: string; status: ReportStatus; content: ReportContent }
```

## 8. HTTP API

All routes prefixed `/api`. Auth = `Authorization: Bearer <jwt>`. "P" = PATIENT, "C" = CLINICIAN.
Request bodies are validated with the named schema (`…Request` → `…RequestSchema`).

### Health & auth (M01, M02)
| Method | Path | Role | Request | 2xx Response |
|---|---|---|---|---|
| GET | `/api/health` | — | — | 200 `{ ok: true, llmMode: 'live'\|'demo'\|'mock' }` |
| POST | `/api/auth/login` | — | `LoginRequest { email, password }` | 200 `{ token: string, user: UserDto }` |
| GET | `/api/auth/me` | any | — | 200 `{ user: UserDto }` (allowed while `mustChangePassword`) |
| POST | `/api/auth/change-password` | any | `ChangePasswordRequest { currentPassword, newPassword (min 10, must differ) }` | 200 `{ user: UserDto }`; clears `mustChangePassword`. Wrong current password or weak/unchanged new password -> 400 |

While `User.mustChangePassword` is true, every authed route except `/api/auth/me` and `/api/auth/change-password` returns 403 `FORBIDDEN` with message `Password change required` (details `{ reason: 'PASSWORD_CHANGE_REQUIRED' }`).

### Patient — sessions & interview (M06)
| Method | Path | Role | Request | 2xx Response |
|---|---|---|---|---|
| GET | `/api/patient/clinicians` | P | — | 200 `{ clinicians: { id, displayName }[] }` (active links) |
| GET | `/api/patient/follow-ups` | P | — | 200 `{ followUps: FollowUpDto[] }` (status PENDING) |
| POST | `/api/sessions` | P | `CreateSessionRequest { consent: { accepted: true, version: string } }` | 201 `SessionDetailDto` (contains the opening COMPANION message, turnId 1) |
| GET | `/api/sessions` | P | — | 200 `{ sessions: SessionSummaryDto[] }` newest first |
| GET | `/api/sessions/:id` | P(owner) | — | 200 `SessionDetailDto` |
| POST | `/api/sessions/:id/messages` | P(owner) | `SendMessageRequest { text: string (1..4000, trimmed), inputMode: 'TEXT'\|'VOICE'\|'TAP', answerFor?: { key: InstrumentItemKey, value: 0..3 } }` | 200 **SSE stream** (§9). State must be INTERVIEWING else 409 before streaming |
| POST | `/api/sessions/:id/resume` | P(owner) | `ResumeRequest { confirmSafe: true }` | 200 `SessionDetailDto`; only from CRISIS_PAUSED |

### Patient — report (M07)
| Method | Path | Role | Request | 2xx Response |
|---|---|---|---|---|
| POST | `/api/sessions/:id/finish` | P(owner) | — | 200 `PatientReportDto`; allowed from INTERVIEWING, CRISIS_PAUSED, GENERATING_REPORT (retry) |
| GET | `/api/sessions/:id/report` | P(owner) | — | 200 `PatientReportDto` |
| PATCH | `/api/sessions/:id/report` | P(owner) | `EditReportRequest { edits: ReportEditInput[] (1..20) }` | 200 `PatientReportDto`; only in PATIENT_REVIEW |
| POST | `/api/sessions/:id/report/approve` | P(owner) | — | 200 `{ report: PatientReportDto, session: SessionDto }` |

```ts
export type ReportEditInput =
  | { kind: 'correct';  section: EditableSection; itemId: string; text: string /*1..1000*/ }
  | { kind: 'remove';   section: EditableSection; itemId: string }
  | { kind: 'annotate'; section: AnnotatableSection; text: string /*1..1000*/ };
```

### Speech (M09)
| Method | Path | Role | Request | 2xx Response |
|---|---|---|---|---|
| POST | `/api/speech/transcribe` | P | `multipart/form-data` field `audio` (≤ 10 MB; webm/ogg/wav/mp4/mpeg) | 200 `{ text: string }` |

### Clinician (M08)
| Method | Path | Role | Request | 2xx Response |
|---|---|---|---|---|
| GET | `/api/clinician/queue` | C | — | 200 `{ items: QueueItemDto[] }` (approved reports of linked patients; sort §M08) |
| GET | `/api/clinician/reports/:reportId` | C(linked) | — | 200 `ClinicianReportDto` (APPROVED only, else 404) |
| POST | `/api/clinician/reports/:reportId/review` | C(linked) | — | 200 `{ reviewedAt: string }`; session → CLINICIAN_REVIEWED (idempotent) |
| POST | `/api/clinician/reports/:reportId/notes` | C(linked) | `CreateNoteRequest { text (1..4000) }` | 201 `ClinicianNoteDto` |
| GET | `/api/clinician/patients` | C | — | 200 `{ patients: { id, displayName, lastApprovedAt: string\|null, riskLevel: RiskLevel }[] }` |
| POST | `/api/clinician/patients` | C | `CreatePatientRequest { email (valid, lowercased), displayName (1..80) }` | 201 `{ patient: { id, email, displayName }, temporaryPassword }` (password shown once, 12 chars, no look-alike characters; user created with `mustChangePassword=true` and an active CareLink). Duplicate email -> 409 `CONFLICT` |
| POST | `/api/clinician/patients/:patientId/reset-password` | C(linked) | — | 200 `{ temporaryPassword }`; sets `mustChangePassword=true`. Not linked / not a patient -> 404 |
| POST | `/api/clinician/patients/:patientId/ask` | C(linked) | `AskRequest { question (3..1000) }` | 200 `AskResponse` |
| POST | `/api/clinician/patients/:patientId/follow-ups` | C(linked) | `CreateFollowUpRequest { questions: string[] (1..3, each 3..300) }` | 201 `FollowUpDto` |
| GET | `/api/clinician/alerts` | C | query `?status=open\|all` (default open) | 200 `{ alerts: AlertDto[] }` newest first |
| POST | `/api/clinician/alerts/:id/ack` | C(linked) | — | 200 `AlertDto` (idempotent) |

## 9. SSE events — `POST /api/sessions/:id/messages`

Events in order. Every `data` is JSON. Discriminated union `MessageStreamEvent` in `schemas/sse.ts`.

| # | event | data | When |
|---|---|---|---|
| 1 | `patient_message` | `{ message: MessageDto }` | always, after the patient message is stored |
| 2 | `safety` | `{ level: RiskLevel, categories: RiskCategory[], showResources: boolean }` | always (level may be `none`); `showResources = level ≥ elevated` |
| 3a | `crisis` | `{ level: 'imminent', message: string, resources: CrisisResource[], session: SessionDto }` | if level = imminent; **stream then ends** (no tokens) |
| 3b | `token` | `{ delta: string }` | 0..n, interviewer streaming |
| 4 | `companion_message` | `{ message: MessageDto }` | after full reply stored |
| 5 | `done` | `{ progress: ProgressDto, pendingItem: PendingItemDto \| null }` | last event of a normal turn |
| — | `error` | `{ code: ErrorCode, message: string }` | on failure after streaming started; stream then ends |

## 10. LLM gateway interface (`apps/api/src/modules/llm/types.ts`, M03)

```ts
export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ThinkingMode = 'off' | 'low' | 'medium' | 'high';
export interface LlmCallOptions {
  messages: ChatMessage[];
  temperature?: number; maxTokens?: number; thinking?: ThinkingMode;
  cacheSalt?: string; timeoutMs?: number; signal?: AbortSignal;
}
export interface LlmTextResult { text: string; model: string }
export interface LlmJsonResult<T> { data: T; model: string }

export interface LlmClient {
  readonly mode: 'live' | 'demo' | 'mock';
  complete(role: LlmRole, opts: LlmCallOptions): Promise<LlmTextResult>;
  completeJson<T>(role: LlmRole, opts: LlmCallOptions & { schema: ZodType<T> }): Promise<LlmJsonResult<T>>;
  stream(role: LlmRole, opts: LlmCallOptions): AsyncIterable<string> & { result: Promise<LlmTextResult> };
  transcribe(audio: Buffer, mimeType: string, opts?: { cacheSalt?: string }): Promise<LlmTextResult>;
}
// All methods throw LlmUnavailableError (code 'LLM_UNAVAILABLE') after retries + fallback fail.
```

Default role → model map (env-overridable, see M03): interviewer `qwen3-small`, safety `gemma`,
tracker `gpt-oss`, reportWriter `qwen3`, verifier `gpt-oss`, assistant `qwen3`, stt `gemma-small`.

## 11. Environment variables (`.env.example`)

```
NODE_ENV=development
PORT=4000
WEB_ORIGIN=http://localhost:5173
DATABASE_URL=file:./dev.db
JWT_SECRET=change-me-to-32+-random-chars-please-xxxx
JWT_EXPIRES_IN=12h
LLM_MODE=demo                # live | demo | mock   (demo = no network, canned behavior)
NRP_BASE_URL=https://ellm.nrp-nautilus.io/v1
NRP_API_KEY=
MODEL_INTERVIEWER=qwen3-small
MODEL_SAFETY=gemma
MODEL_TRACKER=gpt-oss
MODEL_REPORT_WRITER=qwen3
MODEL_VERIFIER=gpt-oss
MODEL_ASSISTANT=qwen3
MODEL_STT=gemma-small
MODEL_FALLBACK=service       # NRP virtual model used when a role's model fails
LOG_LEVEL=info
VITE_API_URL=http://localhost:4000
```

## 12. LLM structured outputs & prompt markers (`packages/shared/src/schemas/llm.ts`)

Models return JSON validated by these schemas (M03 `completeJson`). Producers/consumers: M05 safety,
M06 tracker, M07 writer/verifier, M08 assistant. The `DemoLlmClient` (M03) depends on the markers below,
so prompt builders **must** emit them exactly.

```ts
export type FocusKey = ChecklistKey | 'open_story' | 'safety_followup' | 'follow_up_question' | 'wrap_up';

export interface SafetyClassifierOutput {
  level: RiskLevel; categories: RiskCategory[]; evidence: string; // evidence = exact phrase or ''
}

export interface TrackerOutput {
  updates: {
    key: ChecklistKey; status: ItemStatus;
    value: 0 | 1 | 2 | 3 | null;   // required (non-null) for instrument items with status 'answered'
    confidence: number;            // 0..1
    note: string | null;           // domains: ≤ 200 chars, clinical third person
    turnIds: number[];             // PATIENT turnIds that support this update (≥1)
  }[];
}

export interface GeneratedItem { text: string; patientText: string; turnIds: number[] }
export interface WriterOutput {
  priorities: GeneratedItem[];                          // 0..3
  summary: Partial<Record<SummarySection, GeneratedItem[]>>; // missing sections → []
  quotes: { text: string; turnId: number }[];           // 0..6
  notDiscussed: DomainKey[];
}

export interface VerifierOutput { unsupported: { itemId: string; reason: string }[] }

export interface AssistantOutput { answer: string; citations: { ref: string }[] } // ref "S<n>:T<turnId>"

// Planner memory stored in Session.interviewState (M06). Parse with defaults: "{}" → all defaults.
export interface InterviewState {
  lastFocus: FocusKey | null;               // focus of the most recent COMPANION question (default null)
  attempts: Partial<Record<FocusKey, number>>; // times each focus was asked (default {})
  askedFollowUps: number;                   // follow-up questions already asked this session (default 0)
  followUpQuestions: string[];              // clinician questions attached at session start (default [])
  safetyFollowUpDone: boolean;              // default false
}
```

**Prompt markers (normative):**
- Interviewer and tracker **system** prompts contain one line `CURRENT_FOCUS: <FocusKey>` and one line
  `FOCUS_HINT: <single line of text>` (the question/topic the companion should move toward).
- Transcripts given to any model are rendered one turn per line: `[T<turnId>] <PATIENT|COMPANION>: <text>`
  (newlines inside text replaced by a space), inside a block that starts with the line `TRANSCRIPT:`.
- The assistant context starts with `SESSIONS:` and labels turns `[S<n>:T<turnId>]`, `n` = 1-based session index.

---

## Changelog
Agents: append `- [MXX] <what changed> — <why>` when you change anything above.

- [M01] No contract changes. Notes: `ANNOTATABLE_SECTIONS` runtime const added to keys.ts (array form of `AnnotatableSection`); `ERROR_CODES` const added to schemas/errors.ts.
- [M09] `PatientReportDto` gains optional `approvedAt: string | null` (set by `toPatientReportDto`) — review screen shows "Sent on {date}" for approved reports.
- [Patient onboarding] `User.mustChangePassword Boolean @default(false)` (§4); `UserDto.mustChangePassword` (§8); new `ErrorCode` `CONFLICT` (409, duplicate email); new endpoints `POST /api/clinician/patients`, `POST /api/clinician/patients/:patientId/reset-password`, `POST /api/auth/change-password`; forced-change 403 rule on all other authed routes; audit actions `patient.create`, `patient.reset_password`, `auth.change_password` (ids only). Shared: `CreatePatientRequestSchema`, `ChangePasswordRequestSchema`, `MIN_PASSWORD_LENGTH`, `CreatePatientResponseSchema`, `ResetPasswordResponseSchema`.
