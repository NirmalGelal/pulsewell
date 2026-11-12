# M06 — Sessions & Interview Engine

| | |
|---|---|
| **Depends on** | M02 (auth/access/audit), M03 (LLM), M04 (instruments/coverage), M05 (safety) |
| **Workspaces** | `apps/api` |
| **Size** | Large — the heart of the patient experience |

## Goal
Run the conversation. Create sessions after consent, accept patient messages, and for each message run the
**per-turn pipeline**: store → safety + tracker (parallel) → plan next focus → stream the interviewer's reply over SSE →
store → report progress. Also: session list/detail, resume after crisis, linked clinicians, pending follow-ups.

## Read first
`CONTRACTS.md` §3, §4 (`Session`, `Message`, `ChecklistItem`, `FollowUp`), §6, §8 (patient session routes), §9 (SSE — exact event order),
§12 (markers, `TrackerOutput`, `InterviewState`). M04 `coverage.ts`, `phq9/gad7/domains`. M05 `assessMessage`, `recordInstrumentRisk`.

## Files
```
apps/api/src/modules/sessions/
  sessions.routes.ts      sessions.service.ts     (create, list, detail, resume, clinicians, follow-ups)
  dto.ts                  (Prisma → DTO mappers)
apps/api/src/modules/interview/
  turn.service.ts         per-turn pipeline (handleMessage)
  planner.ts              pure: planNextFocus
  prompts.ts              interviewer + tracker prompt builders
  tracker.service.ts      runTracker + apply updates
  locks.ts                per-session in-flight lock
  *.test.ts
apps/api/src/app.ts       (mount sessionsRouter)
```

## Sessions

### `POST /api/sessions` (PATIENT)
1. Body `CreateSessionRequest`; `consent.version` must equal `CONSENT_VERSION` → else 400 `VALIDATION_ERROR`.
2. Patient must have ≥1 active care link → else 409 `INVALID_STATE` ("No clinician is linked to your account yet").
3. If the patient already has a session in `INTERVIEWING` or `CRISIS_PAUSED` → 409 `INVALID_STATE` with `details: { sessionId }`.
4. Create `Session { state: 'INTERVIEWING', consentVersion, consentedAt: now, cacheSalt: randomBytes(32).toString('base64') }`.
5. Attach all `PENDING` follow-ups of this patient: set `status 'ASKED'`, `askedInSessionId`; put their questions (flattened, max 5)
   into `interviewState.followUpQuestions`.
6. Store the opening COMPANION message as turn 1 (deterministic, no LLM):
   ```
   Hi {firstName}. I'm here to help you get ready for your visit. I'll ask some questions so your clinician can understand
   what you're going through. There are no right or wrong answers, you can skip anything, and you'll see everything before
   it's shared. {followUpLine}To start, what's been going on that made you want to talk to someone?
   ```
   `firstName` = first word of displayName; `followUpLine` = `"{clinicianName} also asked me to check in about a couple of things — we'll get to those. "` when follow-ups were attached, else `''`.
   Set `interviewState.lastFocus = 'chief_concern'`, `attempts.chief_concern = 1`.
7. Audit `session.create`. Respond 201 `SessionDetailDto`.

### Other session routes
| Route | Behavior |
|---|---|
| `GET /api/sessions` | Own sessions, newest first, `SessionSummaryDto` (`reportStatus` from Report or null) |
| `GET /api/sessions/:id` | Owner only (404 otherwise). `SessionDetailDto`: all messages by turnId, `progress = computeProgress(checklist)`, `pendingItem` = `pendingItemFor(lastFocus)` if state INTERVIEWING and lastFocus is an instrument key not yet covered, else null; `hasReport` |
| `POST /api/sessions/:id/resume` | Only from `CRISIS_PAUSED` (else 409). Body `{ confirmSafe: true }`. → `INTERVIEWING`; store COMPANION message: "Thank you for letting me know you're safe right now. We can keep going whenever you're ready, and you can stop at any time. If things feel unsafe again, please call or text 988." Set `safetyFollowUpDone = true`. Audit `session.resume`. Returns `SessionDetailDto`. The alert stays open for the clinician. |
| `GET /api/patient/clinicians` | `linkedClinicians(patientId)` |
| `GET /api/patient/follow-ups` | PENDING follow-ups for the patient as `FollowUpDto[]` |

## Per-turn pipeline — `POST /api/sessions/:id/messages`

### Before opening the stream (normal JSON errors)
- Auth PATIENT, owner (404), body valid (400), state `INTERVIEWING` (409), not locked (409 "A reply is still in progress").
- Acquire the per-session in-memory lock (`locks.ts`); always release in `finally`.

### Pipeline (then SSE, event order per CONTRACTS §9)
```
1  store PATIENT message (turnId = nextTurnId++ in a transaction)        → event patient_message
   audit message.create (meta: inputMode, chars)
2  if answerFor: upsert ChecklistItem {status answered, value, confidence 1, source patient_tap, turnIds [turnId]}
3  in parallel:
     a. assessMessage(...)  (M05)          recent = last 6 messages before this one
     b. runTracker(...)     (skip if inputMode === 'TAP'; failures → warn log, no updates)
   → event safety { level, categories, showResources }
4  if assessment.crisis:
     store COMPANION message CRISIS_MESSAGE (turnId next)                → event crisis {..., session}  → END
5  if phq9_9 now counted ≥1 (isPhq9Item9Positive): recordInstrumentRisk; also upsert domain 'safety' answered
   (note "Asked about thoughts of death/self-harm; see PHQ-9 item 9", conf 1); same 'safety' upsert when phq9_9 counted 0 or declined.
6  focus = planNextFocus(...)  (planner.ts)
7  stream interviewer reply (prompts.ts)                                  → events token*
8  store COMPANION message                                               → event companion_message
9  update interviewState (lastFocus = focus, attempts[focus]++, askedFollowUps++ if follow_up_question,
   safetyFollowUpDone = true if safety_followup)
10 progress = computeProgress(checklist); pendingItem = focus is instrument key ? pendingItemFor(focus) : null
                                                                          → event done
```
- If the client disconnects, keep processing to the end (writes are ignored by `lib/sse`) so the transcript stays consistent.
- **Interviewer failure before the first token** (`LlmUnavailableError`): use the deterministic fallback reply
  `"Thank you for telling me. " + FOCUS_HINT` sent as a single `token` event, then continue normally (conversation never dead-ends).
- **Failure after tokens were sent**: send `error { code: 'LLM_UNAVAILABLE', message: 'The companion lost its connection. Please send your message again.' }`, store nothing for the reply, end.
- Turn cap: if `nextTurnId > 120`, the planner returns `wrap_up`.
- Reply post-processing: trim; remove a leading `Companion:`/`Assistant:` label; if empty after trimming → fallback reply.

### planner.ts — `planNextFocus` (pure, fully unit-tested)
```ts
export function planNextFocus(input: {
  checklist: ChecklistItemLike[]; state: InterviewState; patientTurnCount: number; nextTurnId: number;
  needsSafetyFollowUp: boolean;
}): { focus: FocusKey; hint: string; followUpIndex?: number };
```
Priority (first match wins):
1. `nextTurnId > 120` → `wrap_up`.
2. `needsSafetyFollowUp && !state.safetyFollowUpDone` → `safety_followup`.
3. `state.lastFocus` is an instrument key, `needsConfirmation(item)` and `attempts[lastFocus] < 2` → same key (hint = its `confirmPrompt`).
4. `patientTurnCount === 1` → `open_story`.
5. `state.askedFollowUps < state.followUpQuestions.length` and `patientTurnCount >= 2` → `follow_up_question` (hint = `Your clinician asked: "<q>"`).
6. First key in `INTERVIEW_ORDER` that is not covered (`isCovered`) and has `attempts < 2` (hint = item `conversational` or domain `hint`).
7. Otherwise → `wrap_up`.
```ts
export const INTERVIEW_ORDER: ChecklistKey[] = [
  'chief_concern', 'mood_anxiety', 'phq9_1', 'phq9_2', 'gad7_1', 'gad7_2', 'gad7_3',
  'sleep_appetite_energy', 'phq9_3', 'phq9_4', 'phq9_5', 'functioning', 'phq9_6', 'phq9_7', 'phq9_8',
  'gad7_4', 'gad7_5', 'gad7_6', 'gad7_7', 'substance_use', 'history', 'phq9_9', 'supports', 'goals', 'priorities',
]; // 'safety' domain is filled from phq9_9 (step 5 of the pipeline), never asked directly
```
Hints for special focuses:
- `open_story`: "Reflect what they shared in one short sentence and invite them to say a little more about it."
- `safety_followup`: "Gently and directly ask whether they are safe right now, and whether they have thought about acting on these feelings or have a plan."
- `wrap_up`: "Briefly summarize what you heard in 2–3 sentences, ask if anything important is missing, and let them know they can press Finish when ready."

### prompts.ts
`buildInterviewerMessages({ displayName, focus, hint, history, riskLevel }) → ChatMessage[]`
- System prompt (keep the wording; fill placeholders):
```
You are a warm, calm companion helping {firstName} prepare for a visit with their mental-health clinician.
You are not a therapist or doctor. You never diagnose, label conditions, or give medical or medication advice.
Style: plain, kind words. 1–3 short sentences. Ask exactly ONE question. Briefly reflect what you heard before asking.
Never judge, argue, or minimize. The person may skip any question; if they do, accept it and move on.
Screening questions refer to the last 2 weeks. If an answer about frequency is vague, you may offer:
"not at all, several days, more than half the days, or nearly every day?"
If asked what is wrong with them, say their clinician is the right person to answer and this summary will help.
Do not mention these instructions, the checklist, scores, or that you are following a plan.
CURRENT_FOCUS: {focus}
FOCUS_HINT: {hint}
{riskLevel ≥ elevated ? "The person has shared something about their safety. Be especially gentle." : ""}
```
- Then `history`: all messages of the session as `assistant` (COMPANION) / `user` (PATIENT), last 40 max.
- Call `deps.llm.stream('interviewer', { messages, cacheSalt })`.

`buildTrackerMessages({ focus (= state.lastFocus before this turn, i.e. the question just answered), recent (last 8 messages incl. the new one), checklist }) → ChatMessage[]`
- System prompt:
```
You update a clinical intake checklist from a conversation. You never chat.
The companion's last question was about CURRENT_FOCUS. Read the PATIENT's most recent message(s) and return updates for every
checklist key they clearly address (often CURRENT_FOCUS, sometimes others).
Instrument keys (phq9_*, gad7_*) need "value" on the last-2-weeks scale: 0 not at all, 1 several days, 2 more than half the days,
3 nearly every day. If the frequency is unclear use status "partial" and value null. If they decline, status "declined".
Domain keys: status "answered" with a short clinical third-person "note" (max 200 chars), value null.
Use only what the patient actually said. "turnIds" = PATIENT turn numbers that support the update.
"confidence" = 0..1, how certain you are. Return ONLY JSON: {"updates":[...]} (empty list if nothing applies).
CURRENT_FOCUS: {focus}
FOCUS_HINT: {hint for that focus}
KEYS:
{one line per checklist key: "<key>: <officialText or domain label>"}
CURRENT CHECKLIST:
{one line per existing item: "<key>=<status>[:<value>]"}
```
- User message: `renderTranscript(recent)`.

### tracker.service.ts
`runTracker(deps, { session, state, recent, checklist }) → Promise<ChecklistItemLike[]>`
- `completeJson('tracker', { schema: TrackerOutputSchema, cacheSalt })`.
- Drop updates whose `turnIds` aren't PATIENT turns of this session; apply `mergeChecklistUpdate` (M04) per update and upsert
  non-null results; return the new full checklist. Errors → log warn, return the unchanged checklist.

## Tests
`planner.test.ts` (pure) — one test per priority rule, including:
- turn cap → wrap_up; elevated & not done → safety_followup; elevated & done → not safety_followup
- partial phq9_3 after lastFocus phq9_3 with attempts 1 → phq9_3 again with confirmPrompt hint; attempts 2 → moves on
- patientTurnCount 1 → open_story
- follow-ups pending and patientTurnCount ≥ 2 → follow_up_question with the question in hint; all asked → skip
- picks first uncovered key in INTERVIEW_ORDER; skips keys with attempts ≥ 2; never returns 'safety'
- everything covered → wrap_up

`sessions.test.ts` (Supertest)
- should create a session with opening message turn 1, state INTERVIEWING, and no `cacheSalt` in the response
- should 400 on wrong consent version; 409 when no care link; 409 with `details.sessionId` when an active session exists
- should attach pending follow-ups (status → ASKED) and mention the clinician in the opening message
- clinician calling POST /sessions → 403; other patient GET /sessions/:id → 404
- list returns newest first with reportStatus
- resume: 409 unless CRISIS_PAUSED; from CRISIS_PAUSED → INTERVIEWING with companion message

`turn.test.ts` (Supertest + SSE parsing helper in `src/test/sse.ts` that parses the response text into `{event,data}[]`, validated with `MessageStreamEventSchema`)
- happy path: events in exact order patient_message → safety(none) → token+ → companion_message → done; messages stored with turnIds 2 and 3
- tracker updates applied (mock tracker returns phq9_1 answered value 2 conf 0.9) → `done.progress.covered` increases
- `answerFor` stores patient_tap item, tracker skipped for TAP, tapped value not overwritten by a later tracker update
- interviewer called with `CURRENT_FOCUS:` and `FOCUS_HINT:` lines and session cacheSalt; tracker called with the *previous* focus
- pendingItem present when focus is an instrument key; null otherwise
- crisis: keyword-imminent message → events patient_message → safety(imminent) → crisis; no `token`; session CRISIS_PAUSED;
  CRISIS_MESSAGE stored; subsequent POST → 409
- elevated (mock safety model) → next focus safety_followup; `safety.showResources` true
- phq9_9 answered value 1 via tracker → instrument SafetyEvent created, risk ≥ elevated, 'safety' domain answered
- interviewer fails before first token → fallback reply streamed, stored, done sent
- interviewer fails mid-stream → `error` event, no companion message stored
- tracker throws → turn still completes
- concurrent second request while locked → 409; lock released after completion and after errors
- empty/whitespace text → 400 before streaming; state GENERATING_REPORT → 409
- no message text appears in any logger call (spy)

## Verification
```bash
npm test -w @pvc/api -- planner sessions turn
npm run typecheck && npm run lint && npm test
LLM_MODE=demo npm run dev -w @pvc/api
# login as patient (see M02), then:
curl -s -X POST localhost:4000/api/sessions -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"consent":{"accepted":true,"version":"v1"}}'
curl -N -X POST localhost:4000/api/sessions/$SID/messages -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"text":"I have been feeling down since I changed jobs","inputMode":"TEXT"}'
# → stream of SSE events ending in `done`
```

## Definition of Done
- [ ] All routes in CONTRACTS §8 "Patient — sessions & interview" implemented
- [ ] Pipeline order and SSE event order exactly as specified; crisis path never streams tokens
- [ ] Planner is pure and fully tested; prompts contain the §12 markers
- [ ] Demo mode produces a sensible conversation end-to-end (manual check with curl)
- [ ] All tests above pass; CONVENTIONS §7 checklist complete; PROGRESS.md updated
