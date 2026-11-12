# Patient Voice Companion — Implementation Specs

These files are written **for an LLM coding agent** (Claude Code, Cursor, Copilot, etc.).
Each module spec is self-contained: an agent that opens one module file plus the three shared
files below has everything it needs to implement that module, write its tests, and verify it.

The human-readable design is in `../architecture/architecture.pdf`.

## Files

| File | Purpose |
|---|---|
| `README.md` | This index + the agent protocol (read first) |
| `CONVENTIONS.md` | Repo layout, coding patterns, testing rules, commands |
| `CONTRACTS.md` | **Single source of truth**: enums, DB schema, API endpoints, DTOs, SSE events, report JSON |
| `PROGRESS.md` | Status of each module + handoff notes from the agent that built it |
| `modules/M01-…md` … `modules/M10-…md` | One spec per module |

## Modules (build strictly in this order)

| # | Module | Depends on | Layer |
|---|---|---|---|
| M01 | [Foundation & Shared Contracts](modules/M01-foundation.md) | — | all |
| M02 | [Auth, Access Control & Audit](modules/M02-auth-audit.md) | M01 | api |
| M03 | [LLM Gateway (NRP client, mocks, demo mode)](modules/M03-llm-gateway.md) | M01 | api |
| M04 | [Clinical Instruments, Scoring & Coverage](modules/M04-instruments-scoring.md) | M01 | shared |
| M05 | [Safety Service & Crisis Protocol](modules/M05-safety.md) | M02, M03, M04 | api |
| M06 | [Sessions & Interview Engine](modules/M06-interview-engine.md) | M02–M05 | api |
| M07 | [Report Pipeline (write, score, verify, review, approve)](modules/M07-report-pipeline.md) | M02–M06 | api |
| M08 | [Clinician API & Assistant](modules/M08-clinician-api.md) | M02–M07 | api |
| M09 | [Web Foundation, Patient App & Voice](modules/M09-patient-web.md) | M01–M08 | web (+1 api endpoint) |
| M10 | [Clinician App, Demo Seed & System Verification](modules/M10-clinician-web.md) | M01–M09 | web |

```
M01 ─┬─ M02 ─┐
     ├─ M03 ─┼─ M05 ── M06 ── M07 ── M08 ── M09 ── M10
     └─ M04 ─┘
```

## Agent protocol (every module)

Give the agent this prompt (replace `MXX`):

> You are implementing module **MXX** of the Patient Voice Companion.
> Read, in order: `specs/README.md`, `specs/CONVENTIONS.md`, `specs/CONTRACTS.md`,
> `specs/PROGRESS.md`, then `specs/modules/MXX-*.md`.
> Inspect the existing code before writing anything. Implement everything in the module's
> **Scope**, write every test in its **Tests** section (more is fine), then run its
> **Verification** commands and fix until they all pass. Finish by completing the
> **Definition of Done** checklist and updating `specs/PROGRESS.md`.

Rules the agent must follow:

1. **Contracts are law.** Names, shapes, routes, status codes and enum values come from
   `CONTRACTS.md`. Do not invent alternatives. If a contract is genuinely wrong or missing,
   make the smallest change, and record it in the *Changelog* at the bottom of `CONTRACTS.md`
   and in your `PROGRESS.md` handoff note.
2. **Stay in scope.** Only touch files listed in your module, plus the explicit
   "integration points" it names. You may fix a real bug in an earlier module; note it in `PROGRESS.md`.
3. **No real network in tests.** All LLM calls in tests use `MockLlmClient` (M03). Live NRP
   tests exist only behind `LIVE_LLM=1`.
4. **Verify, don't assume.** Run the commands. Paste the final pass/fail summary into `PROGRESS.md`.
5. **Never weaken safety behavior** (M05) to make a test pass.
6. If something is ambiguous and not covered here, choose the simplest option consistent with
   the design principles below and write the decision in your handoff note.

## Design principles (apply to every decision)

1. **Interpreter, not lawyer** — faithfully represent what the patient said; never embellish.
2. **Nothing about me without me** — clinicians see a report only after patient approval
   (sole exception: imminent-risk alerts, agreed at consent).
3. **Screen and summarize, never diagnose** — no diagnoses, no treatment advice.
4. **Safety is a separate system** — runs on every patient message, independent of the interviewer.
5. **Numbers from code, words from models** — scores are computed deterministically; quotes are
   verified verbatim against the transcript.
6. **Privacy by default** — no message text in logs, audio never stored, per-session `cache_salt`.

## Running the system (after all modules)

```bash
npm install
cp .env.example .env          # set NRP_API_KEY, or keep LLM_MODE=demo to run without models
npm run db:push && npm run seed && npm run seed:demo
npm run dev                   # api on :4000, web on :5173
npm test && npm run typecheck && npm run lint
```

Demo accounts (created by `npm run seed`): `patient@demo.test`, `patient2@demo.test`,
`clinician@demo.test` — password `demo1234`.
