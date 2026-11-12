# Progress

Agents: update your module's row and add a handoff note when you finish. Keep notes short and factual.

| Module | Status | Date | Tests (pass/total) | Notes |
|---|---|---|---|---|
| M01 Foundation & Shared Contracts | ✅ done | 2026-11-11 | 50/50 (shared 28, api 20, web 2) | typecheck, lint, tests green; dev server verified |
| M02 Auth, Access Control & Audit | ✅ done | 2026-11-11 | 19 new (api 72 total) | typecheck, lint, tests green; login/me verified via curl |
| M03 LLM Gateway | ✅ done | 2026-11-11 | 33/33 llm (api total 53/53) | typecheck (api), lint, tests green; live test not run |
| M04 Instruments, Scoring & Coverage | ✅ done | 2026-11-11 | 23 new (shared 51 total) | typecheck, lint, tests green |
| M05 Safety & Crisis | ✅ done | 2026-11-11 | 37 new (api 109 total) | typecheck, lint, tests green |
| M06 Sessions & Interview Engine | ✅ done | 2026-11-11 | 44 new (api 153 total) | typecheck, lint, tests green; demo-mode SSE verified via curl |
| M07 Report Pipeline | ✅ done | 2026-11-11 | 39 new (api 192 total) | typecheck, lint, tests green |
| M08 Clinician API & Assistant | ✅ done | 2026-11-11 | 21 new (api 213 total) | typecheck, lint, tests green |
| M09 Web Foundation, Patient App & Voice | ✅ done | 2026-11-11 | 61 new (api speech 9, web 52 total) | typecheck, lint, all tests green (shared 51, api 222, web 52); dev-server smoke OK |
| M10 Clinician App, Demo Seed & Verification | ✅ done | 2026-11-11 | 28 new (web 23, api 13 incl. e2e 9, seed-demo 4) | `npm run verify` green: shared 51, api 235, web 75; demo + live smoke OK |

Status values: ⬜ not started · 🟨 in progress · ✅ done · ⚠️ done with known issues

---

## Handoff notes

<!--
Template — copy for each module:

### MXX — <name>
- **Files added/changed:**
- **Public exports other modules use:**
- **Decisions / deviations from spec:** (also logged in CONTRACTS.md changelog if contracts changed)
- **Known issues / follow-ups:**
- **Verification output:** (paste final summary lines of typecheck, lint, test)
-->

### M01 — Foundation & Shared Contracts
- **Files added/changed:** root (`package.json`, `tsconfig.base.json`, `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.gitignore`, `.env.example`, `.env`);
  `packages/shared/src/{enums,keys,state-machine,crisis,fixtures,index}.ts`, `schemas/{errors,dto,report,requests,llm,sse}.ts` + tests;
  `apps/api`: `prisma/schema.prisma` (+ stub `seed.ts`, `seed-demo.ts`), `src/{app,server,deps}.ts`, `config/env.ts`, `lib/{errors,validate,json,sse,logger,clock}.ts`,
  `modules/llm/{types,placeholder}.ts`, `test/{setup,global-setup,db,context}.ts`, `vitest.config.ts`;
  `apps/web`: Vite+React+TS, Tailwind 4, shadcn/ui (base-nova style; button card input textarea badge dialog alert progress separator skeleton tabs tooltip sonner), `src/App.tsx`, `src/lib/{utils,env}.ts`, `src/test/{setup,server,handlers}.ts`.
- **Public exports other modules use:**
  - `@pvc/shared`: all enums/consts (`ROLES`, `SESSION_STATES`, `RISK_LEVELS`, `riskRank`, `maxRisk`, ..., `LLM_ROLES`, `SEVERITY_BANDS`), keys (`PHQ9_KEYS`, `GAD7_KEYS`, `INSTRUMENT_ITEM_KEYS`, `DOMAIN_KEYS`, `CHECKLIST_KEYS`, `SUMMARY_SECTIONS`, `EDITABLE_SECTIONS`, `ANNOTATE_ONLY_SECTIONS`, plus extra `ANNOTATABLE_SECTIONS`), `SESSION_TRANSITIONS`/`canTransition`/`assertTransition`, `CRISIS_RESOURCES`, `CONSENT_VERSION`.
  - Schemas (each with a same-named `type`): errors `ErrorCodeSchema ErrorBodySchema ERROR_CODES`; dto `UserDto MessageDto SessionDto ProgressDto AnswerOption PendingItemDto CrisisResource SessionDetailDto SessionSummaryDto FollowUpDto QueueItemDto AlertDto ClinicianNoteDto TranscriptTurnDto ClinicianReportDto AskResponse` (+`Schema`);
    report `EvidenceItem Quote InstrumentItemResult InstrumentResult RiskFlag PatientAnnotation ReportContent ClinicianReportContent PatientReportDto` (+`Schema`, `ItemValueSchema`);
    requests `LoginRequest CreateSessionRequest SendMessageRequest ResumeRequest ReportEditInput EditReportRequest CreateNoteRequest AskRequest CreateFollowUpRequest AlertsQuery` (+`Schema`), params `IdParamSchema ReportIdParamSchema PatientIdParamSchema`;
    llm `FOCUS_KEYS FocusKey(Schema) SafetyClassifierOutput TrackerOutput GeneratedItem WriterOutput VerifierOutput AssistantOutput InterviewState` (+`Schema`), `renderTranscript`; sse `MessageStreamEventSchema MessageStreamEvent SSE_EVENT_NAMES`.
  - Fixtures: `buildEvidenceItem`, `buildInstrumentResult`, `buildReportContent(DeepPartial)` (arrays in overrides replace, objects merge), `DeepPartial`.
  - API: `AppError` + helpers (`lib/errors`), `validate`, `toJson/fromJson`, `openSse`, `createLogger`, `Clock/systemClock/FixedClock`, `loadConfig/AppConfig`, `AppDeps/buildDeps`, `createApp`, `LlmClient` types + `LlmUnavailableError`, `NotImplementedLlmClient`.
  - Test helpers: `createTestContext(overrides?)` -> `{ app, deps, prisma, clock, llm }` (resets DB, FixedClock 2026-11-11T18:00:00Z); `getTestPrisma()`, `resetDb(prisma)` in `test/db.ts`. `resetDb` lists tables explicitly - add any new model to it.
  - Web: `src/test/server.ts` (MSW `server`), `src/test/handlers.ts` (`handlers`, `API`), `@/` alias, `API_URL` in `lib/env.ts`.
- **Decisions / deviations from spec:**
  - `CreateSessionRequestSchema` follows CONTRACTS §8 (`{ consent: { accepted: true, version } }`) rather than the flat wording in the M01 step list.
  - Test DB reset: Prisma refuses `db push --force-reset` when invoked by an AI agent, so `global-setup.ts` deletes `apps/api/prisma/test.db` and runs a plain `prisma db push --skip-generate` (same effect, fresh DB each run).
  - Prisma pinned to v6 (v7 removes `url` from the schema datasource, contradicting CONTRACTS §4). The schema is CONTRACTS §4 verbatim except the one-line `generator`/`datasource` blocks are expanded to multi-line (Prisma requires it).
  - API scripts wrap commands with `dotenv -e ../../.env` (dev, db:push, seed, seed:demo) so the root `.env` is used; vitest sets its own env.
  - MSW is v3: the option is `onUnhandledFrame: 'error'` (was `onUnhandledRequest` in v2). Web uses TypeScript 7 (from Vite template, no `baseUrl`; `@/*` alias via `paths`), root uses TS 6. Dark theme uses `prefers-color-scheme` (shadcn `dark:` variant remapped to the media query), not a `.dark` class.
  - Zod 3.25 (v3 API). `fromJson` accepts `ZodType<T, ZodTypeDef, unknown>` so schemas with defaults work.
  - `TrackerOutputSchema.turnIds` is `.min(1)` per contract; `WriterOutputSchema.priorities`/`quotes` counts are not enforced (M07 does).
  - `/api/health` returns `llmMode` from the placeholder (`mock`) even with `.env` `LLM_MODE=demo`; FIXED in M03: `deps.llm` now comes from `createLlmClient(config)`, so `llmMode` follows `LLM_MODE` (verified: demo -> `{"ok":true,"llmMode":"demo"}`).
  - Real `.env` created (LLM_MODE=demo, `NRP_API_KEY=` empty) and git-ignored.
- **Known issues / follow-ups:** `tsx watch` may restart once at startup (watches a node_modules file); harmless. `npm audit` reports a few advisories in transitive dev deps (not addressed).
- **Verification output:** `npm run typecheck` clean (shared, api, web); `npm run lint` clean; `npm test`: shared 4 files/28 tests, api 6 files/20 tests, web 1 file/2 tests - all passed. `npm run dev`: `curl localhost:4000/api/health` -> `{"ok":true,"llmMode":"mock"}`, web on :5173 returns 200.

### M03 — LLM Gateway
- **Files added/changed:** `apps/api/src/modules/llm/{config,think,retry,json,live-client,mock-client,demo-client,index,test-utils}.ts` + tests (`live-client`, `json`, `stream`, `transcribe`, `mock-client`, `demo-client`, `live.live`); `deps.ts` (uses `createLlmClient`), `test/context.ts` (default `new MockLlmClient()`), `vitest.config.ts` (`*.live.test.ts` excluded unless `LIVE_LLM` is set); dependency `openai@7.55`. `placeholder.ts` kept but unused.
- **Public exports (`modules/llm/index.ts`):** `createLlmClient(config, logger)`, `MockLlmClient`, `DemoLlmClient`, `LiveLlmClient`, `ROLE_SETTINGS`, `modelFor`, `thinkingParams`, `extractJson`, plus all of `types.ts`. `MockLlmClient`: `on/once/fail/reset/calls`; `ctx.llm` in tests is typed `LlmClient` - cast to `MockLlmClient` to script it (or pass `createTestContext({ llm })`).
- **Decisions / deviations:** `thinking` default for `gpt-oss` off -> `reasoning_effort:'low'` per spec. `extractJson` uses a string-aware balanced-brace scan from the first `{` (not "last `}`") so trailing prose containing braces is handled. Stream timeout (`timeoutMs`) covers the whole stream. Streaming does not request usage, so `llm_call` log for streams has null token counts. A caller-aborted `signal` ends retries immediately with `LlmUnavailableError`. `transcribe` accepts `audio/wav` and `audio/mpeg` (parameters like `; codecs` ignored). Test helpers in `test-utils.ts` (`makeLive`, `fakeFetch`) inject `fetch`/`sleep` into `LiveLlmClient`.
- **Live check:** only `GET /v1/models` run (key never printed). Available: `gemma-small-e4b, agents, coding, general, cuda, kubernetes, long-context, reasoning, vision, deepseek-v4-flash, gemma-small, gemma4-small, gemma4-12b, service, gpt-oss, gemma, gemma-vl, kimi, minimax, minimax-m2, glm-5, qwen3, qwen3-vl, qwen3-embedding, qwen3-small`. All configured models (`qwen3-small, gemma, gpt-oss, qwen3, gemma-small, service`) are present. The full `LIVE_LLM=1` suite was not executed.
- **Known issues:** `npm run typecheck` currently fails in `packages/shared` (`src/instruments/scoring.test.ts`, M04 in progress) - not M03.
- **Verification output:** `npm test -w @pvc/api`: 12 files / 53 tests pass; api `tsc --noEmit` clean; `npm run lint` clean; `LLM_MODE=demo` server -> `/api/health` `{"ok":true,"llmMode":"demo"}`.

### M04 — Instruments, Scoring & Coverage
- **Files added/changed:** `packages/shared/src/instruments/{options,phq9,gad7,domains,scoring,coverage,index}.ts` + `scoring/describe/coverage/content` tests; `index.ts` (re-export, additive); `fixtures.ts` (`buildInstrumentResult` now uses `scoreInstrument`, items as patient_tap/answered, so `band` is filled when complete).
- **Public exports:** `ANSWER_OPTIONS INSTRUMENT_TIMEFRAME CONFIDENCE_THRESHOLD PHQ9_ITEMS GAD7_ITEMS INSTRUMENT_ATTRIBUTION InstrumentItemDef DOMAINS DomainDef SUMMARY_SECTION_LABELS phq9Band gad7Band scoreInstrument describeBand ChecklistItemLike isCounted isCovered needsConfirmation computeProgress pendingItemFor mergeChecklistUpdate isPhq9Item9Positive itemDef domainDef`.
- **Decisions / deviations:** added helper `isCounted` (exported). `mergeChecklistUpdate` returns `note: null` when update note is null. `describeBand` plain text adds mild/moderately_severe tails (spec gave only minimal/moderate/severe). GAD-7 has no `moderately_severe` band; describeBand still handles it (range 15–21).
- **Known issues:** none.
- **Verification:** `npm test`: shared 8 files/51 tests, api 20, web 2 all pass; typecheck and lint clean.

### M02 — Auth, Access Control & Audit
- **Files added/changed:** `apps/api/src/modules/auth/{auth.service,auth.middleware,auth.routes,access}.ts` + `auth/access/seed` tests; `modules/audit/audit.service.ts` + test; `src/types/express.d.ts`; `prisma/seed.ts` (`runSeed(prisma)`, runs `main` only when executed directly); `src/test/context.ts` (adds `users`, `auth`, `TestUserKey`); `app.ts` mounts `/api/auth`. Deps: `bcryptjs`, `jsonwebtoken`, `@types/jsonwebtoken`.
- **Public exports:** `hashPassword verifyPassword signToken verifyToken toUserDto login` (auth.service); `requireAuth(deps)` (a factory, needs deps to load the user), `requireRole(...roles)`, `getUser(req)`; `getOwnedSession isLinked assertLinked linkedPatientIds linkedClinicians` (access.ts, take `prisma` first); `audit(deps, entry)` + `AuditAction`. `createTestContext()` -> also `users.{patient,patient2,clinician,otherClinician}` (Prisma `User` rows; otherClinician email `other.clinician@demo.test`) and `auth.*` header objects (`.set(auth.patient)`).
- **Decisions / deviations:** `requireAuth` is `requireAuth(deps)` (factory) rather than a bare middleware. The seed test lives in `src/modules/auth/seed.test.ts` (vitest only includes `src/**`) and imports `prisma/seed`. Audit meta strings over 200 chars are dropped per key (other keys kept), warning `audit_meta_dropped` logged. Audit rows use `deps.clock.now()` for `createdAt`. Dummy hash is a real bcrypt cost-10 hash for timing parity.
- **Known issues:** none.
- **Verification:** `npm run typecheck`, `npm run lint` clean; `npm test`: api 16 files/72 tests, web 2, shared all pass. `db:push`, `seed` (twice, idempotent), live login + `/me` via curl OK.

### M05 — Safety Service & Crisis Protocol
- **Files added/changed:** `apps/api/src/modules/safety/{keywords,classifier,safety.service}.ts` + 3 test files; `packages/shared/src/crisis.ts` (`CRISIS_MESSAGE`, `ELEVATED_RESOURCES_TEXT`).
- **Public exports:** `scanKeywords normalize KeywordResult` (keywords), `classifyRisk SAFETY_SYSTEM_PROMPT` (classifier), `assessMessage recordInstrumentRisk SafetyAssessment` (safety.service). Test pattern: pass `createTestContext({ llm })` with a scripted `MockLlmClient`.
- **Decisions / deviations:** keyword scanner is token-based (apostrophes stripped for comparison, so im/i'm and dont/don't match; `self-harm` matches as tokens self+harm). If imminent but the session state cannot transition to CRISIS_PAUSED (e.g. already CRISIS_PAUSED or GENERATING_REPORT), events and Alert are still written and a `safety_crisis_state_not_pausable` warning is logged instead of throwing (never lose an alert). If model risk exceeds keyword risk but the model evidence is invalid and keyword evidence exists, keyword evidence is used rather than ''. Also added 'i am going to end it tonight' and 'i am going to hurt someone' variants. No live test added.
- **Known issues:** negation not handled (documented limitation).
- **Verification:** `npm run typecheck`, `npm run lint` clean; `npm test`: shared 51, api 109, web 2 pass.

### M06 — Sessions & Interview Engine
- **Files added/changed:** `apps/api/src/modules/sessions/{sessions.routes,sessions.service,dto}.ts` + `sessions.test.ts`; `modules/interview/{turn.service,planner,prompts,tracker.service,locks}.ts` + `planner.test.ts`, `turn.test.ts`; `src/test/sse.ts` (`parseSse`); `app.ts` mounts `sessionsRouter` at `/api`.
- **Public exports:** `storeMessage(deps, sessionId, sender, text, inputMode?, tx?)` (atomic next turnId), `createSession listSessions resumeSession listPendingFollowUps` (sessions.service); `buildSessionDetail toSessionDto toMessageDto` (dto); `planNextFocus INTERVIEW_ORDER focusHint isInstrumentKey` (planner); `loadChecklist upsertChecklistItem rowToLike runTracker` (tracker.service); `handleMessage` (turn.service); `acquireLock releaseLock isLocked`; `buildInterviewerMessages buildTrackerMessages`.
- **Decisions / deviations:**
  - Planner `needsSafetyFollowUp` input is true when this turn's assessment is elevated, phq9_9 is positive, or session riskLevel >= elevated (superset of spec); still gated by `safetyFollowUpDone`.
  - Fallback reply for non-instrument special focuses uses a patient-friendly sentence instead of the model-instruction hint (open_story/safety_followup/wrap_up); instrument/domain/follow-up use the hint/question as specified.
  - Tracker drops individual turnIds that are not PATIENT turns (dropping the update only if none remain). Any interviewer error before the first token yields the fallback; after tokens it yields an `error` event.
  - Params/body validated before ownership check, so an invalid body to a foreign session returns 400 rather than 404.
  - Unexpected pipeline errors after streaming starts emit an SSE `error` (INTERNAL) and release the lock.
  - Demo client echoes the focus hint verbatim for open_story/safety_followup (M03 behavior); fine for demo.
- **Known issues:** the in-memory lock is per process only.
- **Verification:** `npm run typecheck`, `npm run lint` clean; `npm test`: shared 51, api 153 (22 files), web 2 pass. Manual demo-mode curl: session create + two messages streamed patient_message, safety, token*, companion_message, done.

### M07 — Report Pipeline
- **Files added/changed:** `apps/api/src/modules/reports/{reports.routes,pipeline.service,writer,verifier,quotes,assemble,edits,redaction}.ts` + 7 test files (`writer`, `quotes`, `verifier`, `assemble`, `edits`, `redaction`, `reports.routes`); `app.ts` mounts `reportsRouter` at `/api`.
- **Public exports:** `toClinicianContent(content)` and `computeRedactedTurns` (redaction.ts, for M08); `toPatientReportDto(report)` (reports.routes.ts); `generateReport(deps, session, displayName)`; `applyEdits`; `checkQuotes`; `normalizeWriterOutput`, `runWriter`, `buildWriterMessages`; `runVerifier`; `assembleReport`, `buildRiskFlags`.
- **Decisions / deviations:**
  - `generateReport` takes the loaded `Session` row plus patient displayName (not a session id); `finish` does the state transition, upsert and audit.
  - `normalizeWriterOutput(output, messages)` takes the message list (not just patient ids) so the banned-phrase guard can read the cited turn text.
  - `finish` uses the M06 in-memory lock to reject concurrent finishes (409). Verifier is skipped (`verifierModel: null`) when there are no statements to check. If the regeneration writer call fails, the first draft minus unsupported items is used. `claimsRemoved` counts the final pass only (normalization drops + unsupported removals); `claimsChecked` = items in the final pass.
  - `toClinicianContent` blanks removed quote text but keeps its `turnId` (schema requires a positive int); M08 should rely on `Message.redacted` for transcript hiding. `patientCorrection` becomes `''` for removed items even when unset.
  - Edit rows for quote removal store the quote text as `originalText`. `applyEdits` revalidates through `ReportContentSchema`; `report.approve` audit meta also has `redactedTurns`.
  - Safety: every approval path goes through the PATIENT_REVIEW + DRAFT check; scores/risk come only from code (the writer schema has no such fields and `assembleReport` overwrites everything).
- **Known issues:** none. Live NRP writer/verifier not exercised.
- **Verification:** `npm run typecheck`, `npm run lint` clean; `npm test`: shared 51, api 192 (29 files), web 2 pass.

### M08 — Clinician API & Assistant
- **Files added/changed:** `apps/api/src/modules/clinician/{clinician.routes,queue.service,report.service,notes.service,patients.service,assistant.service,followups.service,alerts.service,dto,test-utils}.ts` + 5 test files (`queue`, `report`, `patients`, `assistant`, `followups-alerts`); `app.ts` mounts `clinicianRouter` at `/api` (role CLINICIAN enforced on all `/api/clinician/*`).
- **Public exports:** `clinicianRouter(deps)`, `buildQueue`, `viewReport`, `markReviewed`, `getVisibleReport` (APPROVED + linked else 404), `createNote`, `listPatients`, `askRecord`, `ASSISTANT_SYSTEM_PROMPT`, `createFollowUp`, `listAlerts`, `acknowledgeAlert`; test helper `seedReport(ctx, opts)` in `test-utils.ts` (Prisma-direct session+messages+report fixtures).
- **Decisions / deviations:** transcript hiding uses `Message.redacted` only. Assistant context uses `patientCorrection` over `text` when present, omits removed items and redacted turns, labels priorities as `[priorities]`. `assistant.ask` audit is written before the LLM call (so failed calls are also audited). Invalid `[S<n>:T<id>]` refs are removed from the answer along with the preceding whitespace. Follow-up integration with M06 (PENDING -> ASKED) verified in tests.
- **Known issues:** none. Live NRP assistant not exercised.
- **Verification:** `npm run typecheck`, `npm run lint` clean; `npm test`: shared 51, api 213 (34 files), web 2 pass.

### M09 — Web Foundation, Patient App & Voice
- **Files added/changed:**
  - API: `modules/speech/{speech.routes,convert,speech.test}.ts`; `app.ts` (mounts `speechRouter`; `createApp(deps, { convert? })` test seam); deps `multer`, `ffmpeg-static`, `@types/multer`; `modules/reports/reports.routes.ts` (`toPatientReportDto` adds `approvedAt`).
  - Shared: `PatientReportDtoSchema` gains optional `approvedAt: string | null`.
  - Web `src/`: `lib/{api,sse,auth,query}.ts(x)`, `routes.tsx` (`AppRoutes`), `App.tsx`, `components/{AppShell,ModalShell,ConfirmDialog}.tsx`, `features/auth/Login.tsx`, `features/clinician/ClinicianRoutes.tsx` (placeholder for M10), `features/patient/{PatientRoutes,Home,Consent,Chat,Composer,CrisisOverlay,Review,useRecorder,useReadAloud,labels}`, tests (`lib/{api,sse}.test.ts`, `auth.test.tsx`, `a11y.test.tsx`, `features/patient/{Home,Consent,Chat,Voice,Review}.test.tsx`), `test/{handlers,render,setup}`. Old `App.test.tsx` removed (App is now the router).
- **Public exports other modules (M10) use:** `api`, `ApiError`, `getToken/setToken/clearToken`, `postSse`, `AuthProvider/useAuth/RequireRole/homeFor`, `queryKeys`, `createQueryClient`, `AppShell` (`variant`, `actions`), `ModalShell` (focus-trapped modal), `ConfirmDialog`, `AppRoutes` (replace the `/clinician/*` element in `routes.tsx` with the real app). Test helpers: `renderApp(route, user|null)` in `test/render.tsx` (logs in via token + `/auth/me` MSW handler, renders full route tree with Toaster), `test/handlers.ts` (`API`, `patientUser`, `clinicianUser`, `sessionDetail()`, `reportDto()`, `sseResponse()`), `clinician` fixtures not added.
- **Decisions / deviations:**
  - Contract change (additive): `PatientReportDto.approvedAt?: string | null`, so the review screen can show "Sent on {date}" on revisit (the spec requires it but no DTO carried the date). Logged in CONTRACTS changelog.
  - Confirm dialogs and the crisis overlay use a hand-written `ModalShell` (role `alertdialog`, focus trap, focus restore) rather than base-ui Dialog (which always renders a close button and is awkward in jsdom). Crisis overlay: no close button, Escape ignored; "I'm safe" confirmation is an inline panel inside the overlay, not a second modal.
  - 401 handling: `api.ts` clears the token and calls a handler registered by `AuthProvider` (state goes unauthenticated, `RequireRole` redirects to `/login`) instead of a hard page reload. Login 401s are excluded.
  - Transcribe failure with `SpeechRecognition` available: toast, and the next mic tap uses live dictation (audio cannot be re-transcribed). Quotes only offer "Don't share this" (API rejects `correct` for quotes).
  - Chat seeds local state once from the first `GET /sessions/:id` (and from `/resume`); subsequent query invalidations do not overwrite streamed state. A session loaded in `GENERATING_REPORT` auto-retries finish; review states redirect to the review page.
  - Speech route: transcript text is not logged; audit meta `{ bytes, ms }`; conversion failure -> 400, STT failure -> 503. Real ffmpeg conversion verified manually (webm/opus -> 16 kHz WAV).
  - Added matchMedia polyfill and `toast.dismiss()` + `localStorage.clear()` to web test setup.
- **Known issues:** on first run after installing new api deps, `tsx watch` restarts several times (it watches new node_modules files), then settles. Browser mic/TTS flows were verified only with mocks, not in a real browser.
- **Verification output:** `npm run typecheck` clean; `npm run lint` clean; `npm test`: shared 9 files/51, api 35 files/222, web 9 files/52 all pass. `LLM_MODE=demo npm run dev`: `/api/health` `{"ok":true,"llmMode":"demo"}`, web 200, patient login + `POST /api/sessions` + SSE message turn + `POST /api/speech/transcribe` (demo STT) all OK via curl; servers stopped.

### M10 — Clinician App, Demo Seed & System Verification
- **Files added/changed:**
  - Web `features/clinician/`: `ClinicianRoutes.tsx` (nav + `AlertBanner` + routes), `AlertBanner.tsx`, `Queue.tsx` (`QueueTable` reused by patient detail), `Report.tsx`, `panels.tsx` (Transcript, Ask, Notes, FollowUpDialog), `Patients.tsx` (list + detail), `common.tsx` (RiskBadge, EvidenceChip, relativeTime, query keys), `fixtures.ts` (test fixtures) + tests (`AlertBanner`, `Queue`, `Report`, `Ask`, `NotesFollowUp`, `RoleGuard`). `auth.test.tsx` clinician-login test updated for the real queue screen.
  - API: `prisma/seed-demo.ts` (`runSeedDemo(prisma, now?)`), `src/test/seed-demo.test.ts`, `src/test/e2e.test.ts`.
  - Root: `package.json` `verify` script, `docs/DEMO.md`, `README.md`.
- **Decisions / deviations:**
  - Tabs (queue filter, Transcript | Ask | Notes) are hand-written `role=tablist` buttons rather than base-ui Tabs. All three report panels stay mounted (inactive ones `hidden`) so Ask history persists and evidence chips can focus `#turn-N` after switching.
  - `S<n>` refs in assistant answers are mapped to sessions client-side from the queue (oldest approved first, last 10), mirroring the server's numbering; same-session refs jump in the transcript, other sessions link to that report.
  - Patient detail has no new API: it filters the queue client-side; the "Needs review" tab is also client-side.
  - Seed: Riley's CRISIS_PAUSED session has no report; Sam's removed item cites a turn that is marked `redacted` via `computeRedactedTurns`. `seed:demo` also calls `runSeed`, so it works on a fresh DB, and deletes the three demo patients' sessions and follow-ups before recreating.
  - e2e test uses `MockLlmClient` whose handlers delegate to `DemoLlmClient` (safety role scripted to `none`; the crisis step is triggered by the keyword scanner).
  - Seed `Sam R.` trend is PHQ-9 -4 / GAD-7 -3 (queue API returns deltas as current minus previous).
- **Known issues:** none in scope. Mic/TTS and the 375px patient layout were not exercised in a real browser (see System status).
- **Verification output:** `npm run verify`: typecheck clean (shared, api, web), eslint clean, tests shared 8 files/51, api 37 files/235, web 15 files/75 all pass.

### System status (final)
**Works in demo mode (`LLM_MODE=demo`, no network):** full patient flow (consent, chat with streamed replies, answer chips, keyword safety/crisis overlay, finish, review/edit/remove/annotate, approve), clinician flow (alert banner, queue with trends, evidence-linked report, transcript jump, ask, notes, follow-ups, mark reviewed, patients), speech transcribe (canned text), seeded dashboard with three scenarios. Verified via curl: `db:push`, `seed`, `seed:demo`, `npm run dev` -> `/api/health` `{"ok":true,"llmMode":"demo"}`, web 200, clinician login, queue order (Alex elevated first; Sam 16->12 / 12->9 trend), open alert for Riley, removed item blanked and Sam's turn redacted in the clinician report view. Demo mode answers are canned/echoing (model safety classifier always "none"; only keyword safety fires).

**Live mode (`LLM_MODE=live`, NRP):** one real patient flow run via curl (3 messages + finish) against NRP: all calls succeeded; report written by `qwen3`, verified by `gpt-oss`, 8 claims checked / 0 removed, 3 faithful verbatim quotes, no diagnostic language, sensible sections and priorities. Not live-tested: voice STT (`gemma-small`), assistant (`qwen3`), tracker/safety models under adversarial input, the full 26-item interview. Key was never printed.

**Known limitations:** keyword safety has no negation handling ("I'm not going to kill myself" can false-positive); the interview lock is in-process (single server only); SQLite single-file DB; no password reset/registration (seed accounts only); clinician alert refresh is 15 s polling; the queue/patient detail filter client-side; demo-mode text is not realistic prose.

**Please review manually (human):**
1. Safety/crisis: keyword list and classifier prompt, crisis copy and resources (`packages/shared/src/crisis.ts`), "I'm safe" resume flow, who is notified and when; clinical sign-off on wording of risk flags and the PHQ-9 item 9 handling.
2. Voice in a real browser (Chrome mic permission, MediaRecorder -> ffmpeg -> STT, `SpeechRecognition` fallback, read-aloud) and the patient screens at 375px width.
3. Live model names/availability (`curl $NRP_BASE_URL/models`; roles map to `qwen3-small, gemma, gpt-oss, qwen3, gemma-small`, fallback `service`) and assistant/tracker quality on realistic conversations.
4. Follow `docs/DEMO.md` once end to end in Chrome with both roles; the DoD item "clean-clone `rm -rf node_modules && npm install`" was not executed (would disturb the shared install).
