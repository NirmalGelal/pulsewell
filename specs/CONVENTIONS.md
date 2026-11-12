# Conventions

Every module follows these rules. If a module spec conflicts with this file, the module spec wins
for that module only.

## 1. Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js 22 LTS, ESM (`"type": "module"`) everywhere |
| Language | TypeScript, `strict: true`, no `any` except at narrow, commented boundaries |
| Monorepo | npm workspaces |
| Backend | Express 5 (async handlers' rejections reach the error middleware natively) |
| Validation | zod (v3 API) — shared between api and web |
| DB | SQLite via Prisma ORM (`prisma db push`, no migration files) |
| Auth | bcryptjs + jsonwebtoken (HS256) |
| LLM | `openai` npm SDK pointed at the NRP OpenAI-compatible endpoint |
| Frontend | Vite + React + TypeScript, React Router, TanStack Query, Tailwind CSS, shadcn/ui |
| Tests | Vitest everywhere; Supertest (api); React Testing Library + jsdom + MSW (web) |
| Lint/format | ESLint (flat config, typescript-eslint) + Prettier |
| Dev runner | `tsx watch` for api, `vite` for web, `concurrently` at root |

Use current stable versions at install time and pin them (no `^` ranges needed, but allowed).
If a major version changes an API shown in these specs, adapt to the installed version and note it.

## 2. Repository layout

```
/ (repo root)
├─ package.json              # workspaces + root scripts
├─ tsconfig.base.json
├─ eslint.config.js  .prettierrc  .gitignore  .env.example
├─ packages/
│  └─ shared/                # @pvc/shared — no build step; consumed as TS source
│     ├─ package.json        # "exports": { ".": "./src/index.ts" }
│     └─ src/
│        ├─ index.ts         # re-exports everything
│        ├─ enums.ts         # Role, SessionState, RiskLevel, …
│        ├─ keys.ts          # checklist / instrument / section keys
│        ├─ state-machine.ts # session transitions
│        ├─ crisis.ts        # crisis resources constants
│        ├─ schemas/         # zod schemas: report.ts, dto.ts, requests.ts, sse.ts, llm.ts
│        ├─ instruments/     # (M04) PHQ-9, GAD-7 definitions, scoring, coverage
│        └─ *.test.ts
├─ apps/
│  ├─ api/                   # @pvc/api
│  │  ├─ prisma/schema.prisma  prisma/seed.ts  prisma/seed-demo.ts
│  │  └─ src/
│  │     ├─ server.ts        # reads env, builds deps, listens
│  │     ├─ app.ts           # createApp(deps): Express app (no listen)
│  │     ├─ deps.ts          # AppDeps type + buildDeps(config)
│  │     ├─ config/env.ts    # zod-validated env
│  │     ├─ lib/             # errors.ts, validate.ts, sse.ts, json.ts, logger.ts, clock.ts
│  │     ├─ modules/
│  │     │  ├─ auth/  audit/  llm/  safety/  sessions/  interview/  reports/  clinician/  speech/
│  │     │  │   each: <name>.routes.ts  <name>.service.ts  <name>.test.ts (+ helpers)
│  │     └─ test/            # setup.ts, context.ts (createTestContext), factories.ts
│  └─ web/                   # @pvc/web
│     └─ src/
│        ├─ main.tsx  App.tsx  routes.tsx
│        ├─ lib/             # api.ts, sse.ts, auth.tsx, query.ts, utils.ts
│        ├─ components/ui/   # shadcn components
│        ├─ components/      # shared app components
│        ├─ features/patient/   features/clinician/
│        └─ test/            # setup.ts, msw handlers, render helpers
└─ specs/                    # these documents
```

## 3. Backend patterns

### Dependency injection
`createApp(deps: AppDeps)` builds the app. Every router is a factory: `sessionsRouter(deps)`.
Services receive what they need explicitly. **Never import a global LLM client** — tests must be able to inject `MockLlmClient`.

```ts
export interface AppDeps {
  config: AppConfig;          // parsed env
  prisma: PrismaClient;
  llm: LlmClient;             // M03; M01 ships a placeholder interface
  clock: Clock;               // { now(): Date } — use instead of new Date() in services
  logger: Logger;
}
```

### Routes, validation, errors
- Mount all routes under `/api`. Route files only parse/validate input, call a service, and shape output.
- Validate with `validate({ body?, params?, query? })` middleware using zod schemas from `@pvc/shared`.
- Throw `AppError` (from `lib/errors.ts`) for expected failures. The error middleware returns
  `{ "error": { "code", "message", "details"? } }` (see CONTRACTS §5). Unknown errors → 500 `INTERNAL`
  with a generic message; the real error goes to the logger only.
- Ownership failures return **404 NOT_FOUND**, not 403 (don't reveal that a resource exists).
  Wrong role returns **403 FORBIDDEN**.

### Database
- SQLite has no enums/arrays/JSON columns in this setup: enum-like fields are `String`,
  JSON-like fields are `String` holding JSON. Always read them through `fromJson(schema, str)` and
  write through `toJson(value)` (`lib/json.ts`) so data is validated on the way out.
- Multi-row writes that must be consistent use `prisma.$transaction`.
- Use `deps.clock.now()` for timestamps you set explicitly.

### Privacy & logging
- Never log message text, report content, transcripts, audio, or tokens. Log ids, codes, durations.
- `logger` has `debug/info/warn/error(msg, meta?)`. Silent in tests unless `LOG_LEVEL` is set.

### SSE
Streaming endpoints use `lib/sse.ts`: `openSse(res)` returns `{ send(event, data), close() }`.
Wire format: `event: <name>\ndata: <json>\n\n`. Headers: `Content-Type: text/event-stream`,
`Cache-Control: no-cache`, `Connection: keep-alive`, `X-Accel-Buffering: no`.

## 4. Frontend patterns
- Server state with TanStack Query; no Redux. Local UI state with React state.
- All HTTP through `lib/api.ts` (adds `Authorization: Bearer`, parses error envelope into `ApiError`).
- POST-streaming through `lib/sse.ts` (fetch + ReadableStream parser; `EventSource` can't POST or send headers).
- Validate responses with the shared zod schemas in development (`import.meta.env.DEV`).
- Accessibility: every interactive element is keyboard reachable, has a label; new chat messages
  are announced via `aria-live="polite"`; crisis overlay uses `role="alertdialog"` and focus trap.
- Patient UI: calm, large type (base 18px), one primary action per screen, mobile-first.
  Clinician UI: dense, scannable, desktop-first.
- Copy must never diagnose or promise outcomes.

## 5. Testing rules
- Every module ships the tests listed in its spec. Test names start with `should`.
- **API tests** use `createTestContext()` from `apps/api/src/test/context.ts` (M01, extended by M02/M03):
  ```ts
  const ctx = await createTestContext();   // fresh DB rows, MockLlmClient, fixed clock
  const res = await request(ctx.app).post('/api/…').set(ctx.auth.patient).send({...});
  ```
  The DB is a SQLite file (`apps/api/prisma/test.db`) reset between tests. Vitest runs API test files
  sequentially (`fileParallelism: false`).
- **No network**: tests never call NRP. The `LlmClient` in tests is `MockLlmClient`; unmocked calls throw.
- **Live smoke tests** (optional) are named `*.live.test.ts`, skipped unless `LIVE_LLM=1`.
- **Web tests** use MSW to mock the API and RTL queries by role/label (not test ids unless necessary).
- Deterministic: no `setTimeout` sleeps; use fake timers or awaited promises.
- Coverage is not enforced, but every branch listed in a spec's behavior table must have a test.

## 6. Commands (root `package.json`)

| Command | Does |
|---|---|
| `npm run dev` | api (`:4000`) + web (`:5173`) concurrently |
| `npm test` | all workspaces' tests |
| `npm test -w @pvc/api -- <filter>` | api tests matching filter |
| `npm test -w @pvc/web` / `-w @pvc/shared` | web / shared tests |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run lint` | ESLint whole repo |
| `npm run db:push` | `prisma db push` for dev DB |
| `npm run seed` | demo users + care links (M02) |
| `npm run seed:demo` | demo sessions/reports for the clinician dashboard (M10) |

## 7. Definition of Done (applies to every module, in addition to its own checklist)
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm test` passes (whole repo, not only your module)
- [ ] All tests listed in the module spec exist and pass
- [ ] No `TODO`/`FIXME` left inside the module's scope
- [ ] `specs/PROGRESS.md` updated: status ✅, files added, public exports, decisions, test summary
