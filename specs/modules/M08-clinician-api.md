# M08 — Clinician API & Assistant

| | |
|---|---|
| **Depends on** | M02–M07 |
| **Workspaces** | `apps/api` |
| **Size** | Medium |

## Goal
Everything the clinician side needs: a risk-sorted queue, the full report view with transcript and evidence, review and
private notes, an "ask the record" assistant grounded only in approved data (`assistant` = `qwen3`), follow-up questions
that the companion asks next session, and urgent safety alerts.

**Visibility rules enforced here** (see architecture PDF §2):
- A clinician sees only patients with an **active care link** (else 404).
- Only **APPROVED** reports and their (redacted) transcripts are visible. Drafts never.
- The only pre-approval information is an **imminent-risk Alert** (evidence phrase + time).
- Clinician notes are private to clinicians (never in patient routes).

## Read first
`CONTRACTS.md` §4, §6 (`QueueItemDto`, `ClinicianReportDto`, `TranscriptTurnDto`, `AlertDto`, `AskResponse`, `FollowUpDto`), §8 (clinician routes),
§12 (`AssistantOutput`, `SESSIONS:` marker). M02 `access.ts`. M07 `toClinicianContent`.

## Files
```
apps/api/src/modules/clinician/
  clinician.routes.ts    (all routes require CLINICIAN)
  queue.service.ts       report.service.ts      notes.service.ts
  assistant.service.ts   followups.service.ts   alerts.service.ts
  dto.ts
  *.test.ts
apps/api/src/app.ts      (mount clinicianRouter)
```

## Behavior

### `GET /api/clinician/queue`
- All APPROVED reports whose patient is linked to the caller.
- `QueueItemDto` fields from `currentJson` (through `toClinicianContent`): `riskLevel = content.risk.level`, `phq9/gad7 total+band`,
  `topPriority` = first non-removed priority's `text` (or null), `reviewed = reviewedAt != null`.
- `trend`: compare with the same patient's previous APPROVED report (by `approvedAt`): `delta = current.total − previous.total`
  (null if either total is null); `trend = null` if no previous report.
- `hasUnacknowledgedAlert`: any open Alert for that **session**.
- Sort: `hasUnacknowledgedAlert` desc → `riskRank(riskLevel)` desc → `reviewed` (false first) → `approvedAt` desc.

### `GET /api/clinician/reports/:reportId`
- 404 unless report exists, is APPROVED, and its patient is linked.
- `content = toClinicianContent(currentJson)`; `transcript`: every message by turnId → `TranscriptTurnDto` (`text: null` when `redacted`;
  `hasSafetyEvent` true if any SafetyEvent on that turn).
- `notes`: all ClinicianNotes on the report (any clinician), oldest first, with `clinicianName`.
- `history`: the patient's other APPROVED reports with `approvedAt` earlier than this one, newest first, with totals.
- Audit `report.view`.

### `POST /api/clinician/reports/:reportId/review`
- Same visibility check. If `reviewedAt` is null: set `reviewedAt = now`, `reviewedById`, session `SUBMITTED → CLINICIAN_REVIEWED`
  (`assertTransition`). Idempotent: second call returns the existing `reviewedAt`. Audit `report.review` (first time only).

### `POST /api/clinician/reports/:reportId/notes`
- Visibility check; create note; 201 `ClinicianNoteDto`; audit `note.create` (no text in meta).

### `GET /api/clinician/patients`
- Linked patients: `{ id, displayName, lastApprovedAt, riskLevel }`.
- `riskLevel` = max of `Session.riskLevel` over the patient's SUBMITTED/CLINICIAN_REVIEWED sessions, raised to `imminent` if the
  patient has any open Alert. (Never reveals risk from unapproved sessions except via alerts.) Sort by riskLevel desc, then name.

### `POST /api/clinician/patients/:patientId/ask` — assistant.service.ts
1. `assertLinked`. Load the patient's APPROVED reports (max 10 newest), oldest → newest = S1…Sn, with their sessions' messages.
2. No approved reports → 200 `{ answer: "There are no approved records for this patient yet.", citations: [], model: 'none' }` (no LLM call).
3. Build context (normative format):
```
SESSIONS:
S1 = approved 2026-11-02, PHQ-9 14 (moderate), GAD-7 10 (moderate)
S2 = approved 2026-11-11, PHQ-9 incomplete (partial 9), GAD-7 6 (mild)

S1 REPORT:
- [chiefConcern] Reports low mood since August. (T3)
...
S1 TRANSCRIPT:
[S1:T1] COMPANION: …
[S1:T2] PATIENT: …
```
   Redacted turns are omitted entirely; removed report items are omitted.
4. System prompt:
```
You answer a clinician's question about one patient using ONLY the records provided (approved summaries and transcripts).
Cite every factual statement with references like [S1:T4]. If the records don't contain the answer, say:
"This was not discussed in the patient's approved records."
Never diagnose, never recommend treatment or medication, never speculate beyond the records. Be concise (≤ 150 words).
Return ONLY JSON: {"answer":"…","citations":[{"ref":"S1:T4"}]}
```
   User message: context + blank line + `QUESTION: <question>`.
5. `completeJson('assistant', { schema: AssistantOutputSchema })` (no cacheSalt sharing across patients — use a fresh random salt per call).
6. Citations = union of `citations[].ref` and `[S<n>:T<id>]` refs found in `answer`; keep only refs pointing to existing, non-redacted
   turns; map to `{ sessionId, turnId, excerpt }` (excerpt = first 160 chars of that turn). Invalid refs are stripped from the answer text.
7. LLM failure → 503 `LLM_UNAVAILABLE`. Audit `assistant.ask` (meta: `{ chars: question.length }`).

### `POST /api/clinician/patients/:patientId/follow-ups`
- `assertLinked`; create `FollowUp { status: 'PENDING', questions }`; 201 `FollowUpDto`; audit `followup.create`.
  (M06 attaches PENDING follow-ups when the patient starts the next session.)

### Alerts
- `GET /api/clinician/alerts?status=open|all` — alerts of linked patients; `open` = `acknowledgedAt == null`; newest first.
- `POST /api/clinician/alerts/:id/ack` — linked check (404); set `acknowledgedAt/ById` if null; idempotent; audit `alert.ack`.

## Tests (Supertest + MockLlmClient; build fixtures directly with Prisma + `buildReportContent`)
`queue.test.ts`
- shows only APPROVED reports of linked patients (DRAFT excluded; unlinked patient's report excluded)
- `otherClinician` gets empty queue; patient token → 403
- sort order: alert first, then imminent > elevated > none, then unreviewed, then newest
- trend deltas computed vs previous approved report; null when totals incomplete; null trend for first report
- topPriority skips removed priorities

`report.test.ts`
- returns ClinicianReportDto; removed items have empty text and `[]` turnIds; redacted turns have `text: null`
- DRAFT report → 404; unlinked clinician → 404; audit `report.view` written
- history lists older approved reports only
- review: sets reviewedAt, session CLINICIAN_REVIEWED; second call idempotent (same timestamp, one audit row)
- notes: create + appear in report with clinicianName; never appear in patient `GET /api/sessions/:id/report` response

`patients.test.ts`
- riskLevel ignores unapproved sessions; open alert raises to imminent

`assistant.test.ts`
- no approved reports → canned answer, no LLM call
- context contains `SESSIONS:` header, `[S1:T…]` labels, excludes redacted turns and DRAFT reports, includes `QUESTION:`
- valid refs mapped to sessionId/turnId/excerpt; invalid and redacted refs dropped and stripped from answer text
- LLM failure → 503; unlinked → 404; audit meta has no question text

`followups-alerts.test.ts`
- create follow-up (1–3 questions; 4 → 400); then patient `GET /api/patient/follow-ups` shows it; new session marks it ASKED (integration with M06)
- alerts list for linked patients only; `status=all` includes acknowledged; ack idempotent; unlinked ack → 404
- end-to-end: imminent keyword message (M06) → alert visible in `GET /api/clinician/alerts` before any report exists

## Verification
```bash
npm test -w @pvc/api -- clinician queue report patients assistant followups alerts
npm run typecheck && npm run lint && npm test
LLM_MODE=demo npm run dev -w @pvc/api
# after a patient approves a report (M07 steps), as clinician:
curl -s localhost:4000/api/clinician/queue -H "authorization: Bearer $CT" | jq
curl -s -X POST localhost:4000/api/clinician/patients/$PID/ask -H "authorization: Bearer $CT" \
  -H 'content-type: application/json' -d '{"question":"How has the patient been sleeping?"}' | jq
```

## Definition of Done
- [ ] All clinician routes in CONTRACTS §8 implemented with the visibility rules above
- [ ] Assistant answers only from approved, non-redacted data with validated citations
- [ ] All tests above pass; CONVENTIONS §7 checklist complete; PROGRESS.md updated
