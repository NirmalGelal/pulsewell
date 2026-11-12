# M01 — Foundation & Shared Contracts

| | |
|---|---|
| **Depends on** | nothing (first module) |
| **Workspaces** | root, `packages/shared`, `apps/api`, `apps/web` |
| **Size** | Large — everything else builds on this; take care |

## Goal
Create the monorepo, turn `CONTRACTS.md` into working code (enums, keys, state machine, zod schemas,
Prisma schema), build the API skeleton (config, errors, validation, SSE, JSON helpers, test harness),
and scaffold the web app. After M01, any later module can be implemented without touching setup.

## Read first
`CONVENTIONS.md` (all), `CONTRACTS.md` (all — you implement it).

## Scope

### In
1. Root workspace, TypeScript base config, ESLint + Prettier, scripts, `.env.example`, `.gitignore`.
2. `@pvc/shared`: everything in CONTRACTS §1, §2, §3, §5, §6, §7, §8 (request schemas), §9 as zod schemas + types,
   plus crisis resources and a test-fixture builder.
3. `@pvc/api`: Prisma schema (CONTRACTS §4), env config, `lib/*`, `createApp`, `/api/health`, 404 + error
   middleware, `AppDeps`, LLM interface placeholder, test harness.
4. `@pvc/web`: Vite + React + TS + Tailwind + shadcn/ui initialized; placeholder home page; test setup.

### Out
Auth (M02), real LLM client (M03), instrument item texts/scoring (M04), any feature routes.

## Steps

### 1. Root
`package.json`:
```json
{
  "name": "patient-voice-companion",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "dev": "concurrently -n api,web -c blue,green \"npm run dev -w @pvc/api\" \"npm run dev -w @pvc/web\"",
    "test": "npm test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "lint": "eslint .",
    "format": "prettier --write .",
    "db:push": "npm run db:push -w @pvc/api",
    "seed": "npm run seed -w @pvc/api",
    "seed:demo": "npm run seed:demo -w @pvc/api"
  }
}
```
- `tsconfig.base.json`: `strict`, `target ES2022`, `module ESNext`, `moduleResolution Bundler`,
  `noUncheckedIndexedAccess`, `esModuleInterop`, `skipLibCheck`, `resolveJsonModule`, `isolatedModules`.
- `eslint.config.js`: typescript-eslint recommended, ignore `dist`, `node_modules`, `*.db`, `apps/web/src/components/ui/**`.
- `.gitignore`: `node_modules`, `.env`, `*.db`, `*.db-journal`, `dist`, `coverage`.
- `.env.example`: exactly CONTRACTS §11.

### 2. `packages/shared`
- `package.json`: name `@pvc/shared`, `"exports": { ".": "./src/index.ts" }`, deps `zod`, scripts `test: vitest run`, `typecheck: tsc --noEmit`.
- `src/enums.ts`, `src/keys.ts`, `src/state-machine.ts` — exactly CONTRACTS §1–3 (implement `maxRisk`, `canTransition`, `assertTransition`).
- `src/crisis.ts`:
  ```ts
  export const CRISIS_RESOURCES: CrisisResource[] = [
    { id: '988', name: '988 Suicide & Crisis Lifeline', action: 'Call or text 988 (24/7, free, confidential)', href: 'tel:988' },
    { id: 'crisis-text-line', name: 'Crisis Text Line', action: 'Text HOME to 741741', href: 'sms:741741?&body=HOME' },
    { id: '911', name: 'Emergency services', action: 'Call 911 if you are in immediate danger', href: 'tel:911' },
  ];
  export const CONSENT_VERSION = 'v1';
  ```
- `src/schemas/`:
  - `errors.ts` — `ErrorCodeSchema`, `ErrorBodySchema`.
  - `dto.ts` — every interface in CONTRACTS §6 as `XxxSchema` + `type Xxx = z.infer<…>`.
  - `report.ts` — CONTRACTS §7 (`EvidenceItemSchema`, `QuoteSchema`, `InstrumentResultSchema`, `RiskFlagSchema`,
    `PatientAnnotationSchema`, `ReportContentSchema`, `PatientReportDtoSchema`). `summary` must be a `z.object` with
    **all nine** `SUMMARY_SECTIONS` keys required. `turnIds` on `EvidenceItem` is `z.array(z.number().int().positive())`
    (min 1 is enforced by M07 for generated items, not by the schema — removed items have `[]` in clinician view).
  - `requests.ts` — `LoginRequestSchema`, `CreateSessionRequestSchema` (`accepted: z.literal(true)`),
    `SendMessageRequestSchema` (text trimmed, 1..4000; `answerFor` optional), `ResumeRequestSchema`,
    `ReportEditInputSchema` (discriminated union on `kind`; `annotate` accepts `AnnotatableSection`,
    others accept `EditableSection`), `EditReportRequestSchema` (1..20), `CreateNoteRequestSchema`, `AskRequestSchema`,
    `CreateFollowUpRequestSchema`, `IdParamSchema` (`{ id: z.string().min(1) }`) and similar param schemas.
  - `llm.ts` — every type in CONTRACTS §12 (`FocusKey` + `FOCUS_KEYS`, `SafetyClassifierOutputSchema`, `TrackerOutputSchema`,
    `GeneratedItemSchema`, `WriterOutputSchema` (summary sections default to `[]`), `VerifierOutputSchema`, `AssistantOutputSchema`, `InterviewStateSchema` with all defaults so `parse({})` works),
    plus `renderTranscript(messages: { turnId, sender, text }[]): string` producing the exact `TRANSCRIPT:` block format.
  - `sse.ts` — `MessageStreamEventSchema`: discriminated union `{ event: 'patient_message', data: … } | …` for all
    events in CONTRACTS §9, plus `SSE_EVENT_NAMES`.
- `src/fixtures.ts` — test helpers exported for all workspaces:
  ```ts
  export function buildEvidenceItem(o?: Partial<EvidenceItem>): EvidenceItem;
  export function buildInstrumentResult(kind: 'phq9' | 'gad7', values?: (0|1|2|3|null)[]): InstrumentResult;
    // computes answeredCount/partialSum/total/complete; band left null (M04 fills bands — keep simple)
  export function buildReportContent(o?: DeepPartial<ReportContent>): ReportContent; // valid per schema
  ```
- `src/index.ts` re-exports all of the above.

### 3. `apps/api`
- deps: `express@5`, `cors`, `helmet`, `@prisma/client`, `zod`, `@pvc/shared`; dev: `prisma`, `tsx`, `vitest`,
  `supertest`, `@types/*`.
- scripts: `dev: tsx watch src/server.ts`, `test: vitest run`, `typecheck: tsc --noEmit`,
  `db:push: prisma db push`, `seed: tsx prisma/seed.ts` (M02 creates the file; create an empty stub now),
  `seed:demo: tsx prisma/seed-demo.ts` (stub now; M10 fills).
- `prisma/schema.prisma` — exactly CONTRACTS §4. Run `npx prisma generate`.
- `src/config/env.ts` — `loadConfig(env = process.env): AppConfig` with a zod schema for every var in CONTRACTS §11
  (defaults as shown; `JWT_SECRET` min 32 chars; `LLM_MODE` enum; `NRP_API_KEY` required only when `LLM_MODE=live`).
  Throws a readable error listing invalid vars. `AppConfig.models: Record<LlmRole, string>` + `fallbackModel`.
- `src/lib/errors.ts` — `class AppError extends Error { code; status; details? }` and helpers
  `badRequest`, `unauthenticated`, `forbidden`, `notFound`, `invalidState`, `llmUnavailable`, `payloadTooLarge`.
  Status map from CONTRACTS §5.
- `src/lib/validate.ts` — `validate({ body, params, query })` middleware; on failure throws `AppError('VALIDATION_ERROR', 400)`
  with `details = issues.map(i => ({ path: i.path.join('.'), message: i.message }))`. Replaces `req.body` etc. with parsed values.
  (Express 5: `req.query` is a getter — store parsed query on `res.locals.query`.)
- `src/lib/json.ts` — `toJson(v)`, `fromJson<T>(schema, s)` (throws `AppError INTERNAL` with message `Corrupt stored JSON` on failure).
- `src/lib/sse.ts` — `openSse(res)` per CONVENTIONS §3; `send(event, data)` writes once and flushes; `close()` ends;
  ignores writes after close or after client disconnect (`res.on('close')`).
- `src/lib/logger.ts` — minimal leveled logger to stdout as JSON lines; `createLogger(level)`; level `silent` supported.
- `src/lib/clock.ts` — `interface Clock { now(): Date }`, `systemClock`, `class FixedClock { constructor(d); now(); advance(ms) }`.
- `src/modules/llm/types.ts` — CONTRACTS §10 verbatim, plus `class LlmUnavailableError extends AppError`.
  `src/modules/llm/placeholder.ts` — `NotImplementedLlmClient` (mode `'mock'`, every method throws). M03 replaces usage.
- `src/deps.ts` — `AppDeps` (CONVENTIONS §3) and `buildDeps(config)`: PrismaClient, `NotImplementedLlmClient` (M03 will swap
  in `createLlmClient(config)`), `systemClock`, logger.
- `src/app.ts` — `createApp(deps)`: `helmet()`, `cors({ origin: config.WEB_ORIGIN })`, `express.json({ limit: '1mb' })`,
  `GET /api/health → { ok: true, llmMode: deps.llm.mode }`, a clearly marked block where later modules mount routers,
  404 handler (`NOT_FOUND`, message `Route not found`), error middleware (AppError → envelope; `SyntaxError` from body
  parser → `VALIDATION_ERROR`; others → 500 `INTERNAL` "Something went wrong", logged).
- `src/server.ts` — `loadConfig` → `buildDeps` → `createApp` → `listen(PORT)`; graceful shutdown disconnects Prisma.

### 4. Test harness (`apps/api`)
- `vitest.config.ts`: `environment: 'node'`, `fileParallelism: false`, `setupFiles: ['src/test/setup.ts']`,
  `globalSetup: 'src/test/global-setup.ts'`, env `DATABASE_URL=file:./test.db`, `LOG_LEVEL=silent`, `LLM_MODE=mock`,
  `JWT_SECRET` = a 40-char test string.
- `global-setup.ts`: runs `prisma db push --force-reset --skip-generate` against the test DB once.
- `src/test/db.ts`: `resetDb(prisma)` deletes all rows from every table in FK-safe order.
- `src/test/context.ts`:
  ```ts
  export interface TestContext {
    app: Express; deps: AppDeps; prisma: PrismaClient; clock: FixedClock; llm: LlmClient;
    // M02 adds: users: { patient; patient2; clinician; otherClinician }; auth: { patient; patient2; clinician; otherClinician } (header objects)
  }
  export async function createTestContext(overrides?: Partial<AppDeps>): Promise<TestContext>;
  // resets DB, FixedClock at 2026-11-11T18:00:00Z, shared PrismaClient singleton, placeholder llm unless overridden
  ```

### 5. `apps/web`
- `npm create vite@latest` (react-ts) into `apps/web`, package name `@pvc/web`; add Tailwind (current version's Vite plugin)
  and initialize shadcn/ui (`components.json`, `@/` alias → `src/`). Add components: `button`, `card`, `input`, `textarea`,
  `badge`, `dialog`, `alert`, `progress`, `separator`, `skeleton`, `tabs`, `tooltip`, `sonner` (toasts).
- Dependencies for later modules (install now): `react-router-dom`, `@tanstack/react-query`, `@pvc/shared`, `lucide-react`.
  Dev: `vitest`, `jsdom`, `@testing-library/react`, `@testing-library/user-event`, `@testing-library/jest-dom`, `msw`.
- Theme tokens in CSS: calm patient palette (teal primary `#2E7D6B`), clinician blue `#2F4F8F`, danger `#B3261E`;
  light + dark via `prefers-color-scheme`.
- `src/App.tsx`: placeholder page "Patient Voice Companion" that calls `GET /api/health` via `fetch(VITE_API_URL)` and shows
  `API: ok` or `API: offline`.
- `vitest.config.ts` (or in `vite.config.ts`): `environment: 'jsdom'`, setup file with jest-dom + MSW server (`src/test/server.ts`,
  `onUnhandledRequest: 'error'`).
- scripts: `dev`, `build`, `test: vitest run`, `typecheck: tsc --noEmit -p tsconfig.app.json`.

## Tests

**packages/shared**
- `enums.test.ts`: should order risk levels; should return highest level from `maxRisk`; should return `none` for empty input.
- `state-machine.test.ts`: should allow every transition listed in `SESSION_TRANSITIONS`; should reject every pair not listed
  (generate all 36 pairs); `assertTransition` should throw with `INVALID_TRANSITION`.
- `schemas.test.ts`:
  - should accept `buildReportContent()`; should reject report missing a summary section; should reject `schemaVersion: 2`.
  - should parse each `ReportEditInput` kind; should reject `correct` on section `risk`; should accept `annotate` on `risk`.
  - should trim and reject whitespace-only `SendMessageRequest.text`; should reject text > 4000 chars; should reject `answerFor.value = 4`.
  - should reject `CreateSessionRequest` with `accepted: false`.
  - should parse a sample of each SSE event; should reject unknown event name.
  - should reject `CreateFollowUpRequest` with 0 or 4 questions.
  - should default missing `WriterOutput.summary` sections to `[]`; should reject `TrackerOutput` confidence 1.5.
  - `renderTranscript` should output `TRANSCRIPT:` then `[T1] COMPANION: …` lines and replace newlines in text with spaces.
- `fixtures.test.ts`: `buildInstrumentResult('phq9', all 1s)` should be complete with total 9; with one null should have
  `total: null`, `complete: false`, `partialSum` correct.

**apps/api**
- `app.test.ts`: GET `/api/health` → 200 `{ ok: true, llmMode: 'mock' }`; unknown route → 404 envelope `NOT_FOUND`;
  malformed JSON body → 400 `VALIDATION_ERROR`; route throwing `AppError('INVALID_STATE')` → 409 envelope;
  route throwing plain `Error('secret')` → 500 with message not containing `secret`. (Mount throwaway test routes on an app
  built via `createApp` + a small test-only hook, or test the error middleware directly.)
- `validate.test.ts`: should 400 with `details[].path` for bad body; should replace body with parsed (trimmed) data.
- `json.test.ts`: roundtrip; corrupt JSON throws `INTERNAL`; schema-mismatch throws.
- `sse.test.ts`: should set SSE headers; should write `event: x\ndata: {...}\n\n`; should ignore writes after close.
- `env.test.ts`: defaults applied; short `JWT_SECRET` rejected; `LLM_MODE=live` without `NRP_API_KEY` rejected; models map
  overridable via `MODEL_SAFETY`.
- `db.test.ts`: should create and read a `User`; `resetDb` should empty all tables.

**apps/web**
- `App.test.tsx`: should show `API: ok` when MSW returns health ok; `API: offline` on network error.

## Verification
```bash
npm install
npx prisma generate --schema apps/api/prisma/schema.prisma
npm run typecheck
npm run lint
npm test
cp .env.example .env && npm run db:push && npm run dev
curl -s localhost:4000/api/health          # → {"ok":true,"llmMode":"mock"} (placeholder client)
# open http://localhost:5173 → "API: ok"
```

## Definition of Done
- [ ] Every name in CONTRACTS §1–3, §5–9, §12 exists in `@pvc/shared` and is exported from `index.ts`
- [ ] Prisma schema matches CONTRACTS §4 exactly; `db push` works on a fresh DB
- [ ] `createTestContext()` works and resets data between tests
- [ ] Web app runs, Tailwind + shadcn render, test setup with MSW works
- [ ] All tests above pass; CONVENTIONS §7 checklist complete
- [ ] PROGRESS.md handoff lists: exported schema names, test helpers, any contract changes
