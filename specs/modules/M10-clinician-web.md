# M10 — Clinician App, Demo Seed & System Verification

| | |
|---|---|
| **Depends on** | M01–M09 (uses the web foundation from M09) |
| **Workspaces** | `apps/web`, `apps/api` (demo seed + end-to-end test), root (verify script) |
| **Size** | Large — final module |

## Goal
1. Build the **clinician side**: urgent-alert banner, triage queue, report view with evidence-linked transcript, "ask the record",
   private notes, follow-up questions, mark reviewed, patient list.
2. Create **demo data** so the dashboard looks real in a 3-minute demo.
3. **Verify the whole system** end to end (automated API flow test + manual demo checklist) and leave it demo-ready.

## Read first
`CONTRACTS.md` §6 (clinician DTOs), §7 (report content; `ClinicianReportContent` semantics), §8 (clinician routes).
M04 `describeBand`, `PHQ9_ITEMS`/`GAD7_ITEMS` (`shortLabel`, `officialText`), `DOMAINS` (`label`), `INSTRUMENT_ATTRIBUTION`.
M09 web foundation (`lib/api.ts`, `lib/auth.tsx`, `AppShell`, `routes.tsx`).

## Part A — Clinician screens (`apps/web/src/features/clinician`)

Desktop-first, dense, keyboard-friendly. Clinician palette (blue). Every report screen shows the banner:
**"AI-generated summary of a patient-approved conversation. Not a diagnosis. Verify against the transcript."**

### Alert banner (in clinician `AppShell`, every clinician page)
- `GET /api/clinician/alerts?status=open` with `refetchInterval: 15000`.
- Each open alert: red bar, `role="alert"`: "Urgent safety alert — {patient} — "{evidence}" — {relative time}" + buttons
  "Acknowledge" (`POST /ack`, then refetch) and "View patient" (→ `/clinician/patients/:id`).

### Queue `/clinician` (default route)
- `GET /api/clinician/queue`. Tabs: "Needs review" (default, `reviewed=false`) / "All".
- Table columns: risk badge (imminent/elevated red, concern amber, none grey; plus 🔔 if `hasUnacknowledgedAlert`), patient, approved
  (relative date), PHQ-9 (total + band + trend arrow ▲/▼ with delta; "—" if incomplete), GAD-7 (same), top priority (truncate 80), status.
- Row click / Enter → `/clinician/reports/:reportId`. Empty state: "No reports waiting."

### Report `/clinician/reports/:reportId`
Two-column layout ≥1024px (left: report, right: tabs **Transcript | Ask | Notes**); single column with tabs below on smaller screens.
Left column, in this order:
1. **Header**: patient name, session date & duration, risk badge, buttons "Mark reviewed" (disabled + "Reviewed {date}" after) and "Send follow-up questions".
2. **Risk flags** (if any): category label, level, evidence in quotes, source (keyword/model/instrument), evidence chip `T{turnId}`.
3. **Patient priorities**.
4. **Screening**: for PHQ-9 and GAD-7 — total/max, band (`describeBand().clinical`), "incomplete (partial sum X; N missing)" when incomplete;
   expandable item table: `shortLabel`, value (0–3 label) or status (declined/partial/missing); phq9_9 row highlighted when ≥1.
   History: mini list/sparkline of totals from `history`.
5. **Clinical summary**: sections with `SUMMARY_SECTION_LABELS[section].label` (M04); each item `text` + evidence chips `T3 T4`. If `patientCorrection`:
   show AI text struck-through-light plus "Patient correction: …". Removed items: grey "Patient chose not to share this item."
6. **In the patient's words**: quotes with chips; removed quotes → "Patient chose not to share this quote."
7. **Patient notes** (annotations) grouped by section; **Not discussed** and **Declined** lists.
8. **Provenance footer**: writer/verifier models, verification counts, generated time, `INSTRUMENT_ATTRIBUTION`.

Right column:
- **Transcript**: all turns; COMPANION/PATIENT styling; `hasSafetyEvent` turns marked with a red edge; redacted turns show
  "[Patient chose not to share this part]". Clicking any evidence chip switches to this tab, scrolls to the turn and highlights it for 2 s
  (`id="turn-{n}"`, focusable).
- **Ask**: textarea + "Ask" → `POST /ask`; answer rendered with `[S1:T4]` refs turned into chips (same-session refs jump in transcript;
  other-session refs link to that report). Show "Answers come only from approved records." Keep a session-local Q&A list (state only).
- **Notes**: list (`clinicianName`, time) + add form (`POST /notes`). Label "Private — not visible to the patient."
- **Follow-up dialog**: 1–3 inputs (3..300 chars), submit → `POST /follow-ups` → toast "Sent. The companion will ask these at the patient's next check-in."
- **Mark reviewed** → `POST /review` → update header; invalidate queue.

### Patients `/clinician/patients` and `/clinician/patients/:id`
- List from `GET /api/clinician/patients` (risk badge, last approved). Detail = that patient's queue items (filter queue client-side)
  + "Ask" panel + follow-up button. (No new API needed.)

### Web tests (RTL + MSW)
- `AlertBanner.test.tsx`: shows open alerts with evidence; acknowledge calls API and removes it; polling configured (fake timers).
- `Queue.test.tsx`: sorted as received; tabs filter reviewed; trend arrows/deltas; "—" for incomplete; Enter on row navigates.
- `Report.test.tsx`: section order; banner present; removed items show placeholder (no original text in DOM); patient correction shown with AI text;
  phq9_9 ≥1 highlighted; chip click switches to transcript and focuses `#turn-N`; redacted turn placeholder; mark reviewed updates header.
- `Ask.test.tsx`: renders answer with ref chips; error 503 shows retry message.
- `Notes.test.tsx` / `FollowUp.test.tsx`: create flows; follow-up validation (empty / >3 questions blocked).
- `RoleGuard.test.tsx`: patient visiting `/clinician` is redirected to `/patient`.

## Part B — Demo seed (`apps/api/prisma/seed-demo.ts`, `npm run seed:demo`)
- Requires `npm run seed` users; adds a third patient `patient3@demo.test` ("Riley K.", linked to the clinician).
- **Idempotent**: deletes existing sessions (cascade) for the three demo patients, then recreates.
- Writes rows directly with Prisma (no LLM): messages, checklist items, safety events, reports (`currentJson` validated with `ReportContentSchema`;
  every quote a verbatim substring of its turn; every turnId exists and is a PATIENT turn; scores computed with `scoreInstrument`).
- All content fictional and respectful. Scenarios:

| Patient | Scenario | Expected dashboard |
|---|---|---|
| Sam R. | Two sessions: 3 weeks ago (PHQ-9 16, GAD-7 12, reviewed) and today (PHQ-9 12, GAD-7 9, unreviewed). Job change, poor sleep, wants help sleeping. One item corrected by patient, one removed. | Trend ▼4 / ▼3; correction and "not shared" placeholders visible |
| Alex M. | Today: passive thoughts of death (PHQ-9 item 9 = 1, model event elevated), PHQ-9 18, GAD-7 15, lives alone, wants someone to talk to weekly. | Top of queue (elevated), red flag with evidence |
| Riley K. | Session in CRISIS_PAUSED with an **open imminent alert** (evidence e.g. "I'm going to end it tonight"); no report. | Red alert banner on every clinician page |

- Prints a summary of what was created.
- Test `seed-demo.test.ts`: runs seed twice → stable counts; every report parses; every quote verbatim; Riley has one open alert.

## Part C — System verification

### Automated end-to-end API test — `apps/api/src/test/e2e.test.ts` (MockLlmClient with realistic handlers)
One test file, sequential steps sharing state:
1. Patient logs in → creates session (consent) → opening message turn 1.
2. Sends 3 messages (one TAP answer) → SSE order correct each time; checklist grows.
3. Finishes → DRAFT report with computed screening; corrects one item, removes one, annotates `screening`; approves → SUBMITTED.
4. Clinician logs in → queue contains the report → report view: removed item stripped, redacted turn `text: null`, correction visible.
5. Clinician asks a question → citations valid; adds a note; sends follow-up; marks reviewed → session CLINICIAN_REVIEWED.
6. Patient sees follow-up → new session opening mentions the clinician → follow-up status ASKED.
7. Patient sends an imminent message in that session → `crisis` event → clinician `GET /alerts` shows it → ack works.
8. `otherClinician` cannot see any of it (queue empty; report 404; alerts empty).
9. Audit log contains the expected actions and **no** message text anywhere in `meta`.

### Root `verify` script
Add to root `package.json`: `"verify": "npm run typecheck && npm run lint && npm test"`.

### Demo checklist — create `docs/DEMO.md`
- Setup commands (`npm install`, `.env`, `db:push`, `seed`, `seed:demo`, `dev`), and how to switch `LLM_MODE=live` with `NRP_API_KEY`
  (+ `curl $NRP_BASE_URL/models -H "Authorization: Bearer $NRP_API_KEY"` to confirm model names).
- 3-minute script: (1) patient chat with chips + voice, (2) finish → fix one line, remove one, send, (3) clinician queue → Alex's flag →
  evidence chip → transcript, (4) ask "How has sleep changed?" on Sam, (5) show Riley's alert banner, (6) "What we deliberately don't do".
- Fallbacks: if NRP is slow/down, switch to `LLM_MODE=demo` and restart.

## Verification
```bash
npm run seed && npm run seed:demo
npm run verify                         # typecheck + lint + all tests (shared, api incl. e2e, web)
LLM_MODE=demo npm run dev
# Manual: follow docs/DEMO.md end to end in Chrome, both roles, desktop + phone width (375px) for patient screens.
# Optional live run: LLM_MODE=live NRP_API_KEY=… npm run dev, repeat the patient flow once, confirm report quality.
```

## Definition of Done
- [ ] All clinician screens implemented with the visibility semantics (removed/redacted content never rendered)
- [ ] Demo seed idempotent and schema-valid; dashboard shows the three scenarios
- [ ] `e2e.test.ts` passes; `npm run verify` passes from a clean clone (`rm -rf node_modules && npm install`)
- [ ] `docs/DEMO.md` written and followed once manually
- [ ] PROGRESS.md: M10 ✅ plus a final "System status" note (what works in demo vs live mode, known limitations)
