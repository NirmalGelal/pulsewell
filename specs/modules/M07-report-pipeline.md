# M07 — Report Pipeline (write → score → verify → patient review → approve)

| | |
|---|---|
| **Depends on** | M02–M06 |
| **Workspaces** | `apps/api` |
| **Size** | Large |

## Goal
Turn a finished conversation into a structured, evidence-linked report the patient reviews, edits and approves.
Models write the words (`reportWriter` = `qwen3`), a **different** model checks them (`verifier` = `gpt-oss`), and code
computes scores, risk, quote validity and redactions.

## Read first
`CONTRACTS.md` §4 (`Report`, `ReportEdit`, `Message.redacted`), §7 (report content — implement exactly), §8 (patient report routes),
§12 (`WriterOutput`, `VerifierOutput`, transcript format). M04 `scoreInstrument`, `isCovered`, `DOMAINS`. M05 SafetyEvent semantics.

## Files
```
apps/api/src/modules/reports/
  reports.routes.ts        finish, get, patch, approve
  pipeline.service.ts      generateReport (orchestrates the steps)
  writer.ts                prompt + call + normalize
  verifier.ts              prompt + call
  quotes.ts                verbatim quote check
  assemble.ts              risk flags, screening, notDiscussed, final ReportContent
  edits.ts                 applyEdits (pure)
  redaction.ts             computeRedactedTurns (pure) + toClinicianContent (pure; used by M08)
  *.test.ts
apps/api/src/app.ts        (mount reportsRouter)
```

## `POST /api/sessions/:id/finish`
1. Owner (404); state ∈ {INTERVIEWING, CRISIS_PAUSED, GENERATING_REPORT} else 409; the session must contain at least one PATIENT message, else 409 "There's nothing to summarize yet".
2. Transition → `GENERATING_REPORT`, set `endedAt = now` (if null).
3. `generateReport(deps, sessionId)` (below). On `LlmUnavailableError` from the **writer**: leave state `GENERATING_REPORT`, respond 503
   `LLM_UNAVAILABLE` ("We couldn't prepare your summary just now. Please try again.") — calling finish again retries.
4. Store/replace `Report { status: 'DRAFT', draftJson, currentJson }` (upsert by sessionId), transition → `PATIENT_REVIEW`,
   audit `report.generate` (meta: claimsRemoved, quotesRemoved, regenerated). Respond 200 `PatientReportDto`.

## `generateReport` steps
```
1 load: messages (by turnId), checklist, safety events, patient displayName, session
2 writer      → WriterOutput                     (writer.ts)
3 normalize   → assign ids, filter turnIds, caps (writer.ts)
4 quotes      → keep verbatim only               (quotes.ts)
5 verify      → unsupported item ids             (verifier.ts)
     if any unsupported and not yet regenerated: call writer again with feedback, redo 3–5 once
     remaining unsupported items are removed
6 assemble    → risk, screening, notDiscussed, declinedTopics, provenance (assemble.ts)
7 validate    → ReportContentSchema.parse
```

### writer.ts
- `completeJson('reportWriter', { schema: WriterOutputSchema, cacheSalt })`, thinking `medium`.
- System prompt (keep wording):
```
You write a clinician-facing intake summary from a conversation between a PATIENT and an AI COMPANION.
Rules:
- Use ONLY what the PATIENT said. Never infer, diagnose, interpret, or add clinical labels. Never exaggerate or soften.
- Every item cites "turnIds": the PATIENT turn numbers that directly support it.
- "text": concise clinical third person ("Reports…", "Describes…", "Denies…").
- "patientText": the same fact in plain, kind second person ("You said…").
- summary sections: chiefConcern, presentConcern (onset, course, triggers), moodAnxiety, sleepAppetiteEnergy, functioning,
  substanceUse, history (past diagnoses, treatment, medications), supports, carePreferences. Use [] when nothing was said.
- priorities: up to 3 things the patient most wants help with, most important first.
- quotes: up to 6 short sentences copied EXACTLY, character for character, from PATIENT turns, with their turnId.
  Prefer sentences that convey the patient's experience in their own words.
- notDiscussed: domain keys never discussed: chief_concern, mood_anxiety, sleep_appetite_energy, functioning, substance_use,
  safety, history, supports, goals, priorities.
- Do NOT include scores, risk levels, or diagnoses; they are added separately by other systems.
Return ONLY JSON: {"priorities":[{"text","patientText","turnIds"}],"summary":{"<section>":[{"text","patientText","turnIds"}]},
"quotes":[{"text","turnId"}],"notDiscussed":[...]}
```
- User message: `renderTranscript(all messages)` + blank line + `TRACKER NOTES:` lines `<domainKey>: <note>` for domain items with notes.
- Regeneration call appends: `These statements were judged unsupported by the transcript; remove or rewrite them faithfully: <itemId: text — reason>`.

Normalize (`normalizeWriterOutput(output, patientTurnIds)` — pure):
- `turnIds` filtered to PATIENT turns, deduped, sorted; items left with none are **dropped** (count in `claimsRemoved`).
- Ids: `priorities-1..`, `<section>-1..` (1-based, after filtering).
- Caps: priorities 3, items per section 6, quotes 6. Trim strings; drop items with empty `text` or `patientText`.
- Banned-phrase guard (case-insensitive): drop items whose `text` contains `meets criteria`, `consistent with a diagnosis`,
  `suggestive of`, `likely has`, `diagnosis of` — unless a cited PATIENT turn itself contains `diagnos`. Count as removed.

### quotes.ts — `checkQuotes(quotes, messages)` (pure)
- Comparison normalizes only whitespace runs and curly→straight quotes/apostrophes; otherwise **exact, case-sensitive**.
- If the quote is in its cited PATIENT turn → keep. Else if found in exactly one other PATIENT turn → keep with corrected `turnId`.
  Else drop (`quotesRemoved++`). Quotes from COMPANION turns are always dropped. Duplicate quotes dropped. Ids `quote-1..`.

### verifier.ts
- `completeJson('verifier', { schema: VerifierOutputSchema, cacheSalt })`.
- System prompt:
```
You check a clinical summary against the transcript it came from. For each STATEMENT, decide whether the cited PATIENT turns
support it. A statement is unsupported if it adds facts, interpretations, diagnoses, severity, or certainty that the patient did
not express, or if the cited turns are about something else. Return ONLY JSON: {"unsupported":[{"itemId":"…","reason":"…"}]}
(an empty list if all are supported).
```
- User message: transcript + `STATEMENTS:` lines `<itemId> [T<ids>]: <text>` for priorities and summary items (not quotes).
- Unknown `itemId`s in the output are ignored. Verifier failure → skip verification: `verifierModel: null`, warn log, keep items.

### assemble.ts (pure)
- `risk.level` = `session.riskLevel`; `risk.flags` = one flag per (event, category) — `{ category, level: event.level, evidence, turnId, source }`,
  deduped by `category+turnId` keeping the highest level, sorted by level desc then turnId.
- `screening` = `scoreInstrument('phq9'|'gad7', checklist)`.
- `declinedTopics` = domains with checklist status `declined`.
- `notDiscussed` = (domains not covered per checklist ∪ writer's `notDiscussed`) − covered domains − declined, in `DOMAIN_KEYS` order.
- `session.durationMinutes` = max(1, round((endedAt − startedAt)/60000)).
- `provenance` = `{ aiGenerated: true, writerModel, verifierModel, generatedAt: now, verification: { claimsChecked, claimsRemoved, quotesRemoved, regenerated } }`.

## Patient review

### `GET /api/sessions/:id/report` — owner; 404 if no report. Returns `PatientReportDto` from `currentJson`.

### `PATCH /api/sessions/:id/report` — `applyEdits(content, edits, now)` (pure)
Only in `PATIENT_REVIEW` (409). Edits apply in order; any invalid edit → 400 and **nothing** is saved.
| kind | Allowed sections | Effect |
|---|---|---|
| `correct` | summary sections, `priorities` (not `quotes` — quotes are verbatim) | `item.patientCorrection = text` (AI text kept) |
| `remove` | summary sections, `priorities`, `quotes` | `item.removedByPatient = true` |
| `annotate` | any `AnnotatableSection` incl. `risk`, `screening` | push `{ id: 'ann-<n>', section, text, createdAt }` |
Unknown `itemId` → 400. Risk flags and scores can never be changed or removed (annotate only).
Insert one `ReportEdit` row per edit (`originalText` = item's `patientText` for correct/remove). Audit `report.edit` (meta: count).

### `POST /api/sessions/:id/report/approve`
Only in `PATIENT_REVIEW` (409). In one transaction:
- Report `status APPROVED`, `approvedAt = now`.
- `computeRedactedTurns(content, messages, safetyEventTurnIds)` (pure): PATIENT turns cited by any **removed** item/quote that are **not**
  cited by any kept item and have **no** SafetyEvent → set `Message.redacted = true`.
- Session → `SUBMITTED`.
Audit `report.approve`. Respond `{ report, session }`.

### `toClinicianContent(content)` (pure, exported for M08)
Removed items/quotes: `text`, `patientText`, `patientCorrection` → `''`, `turnIds` → `[]`. Everything else unchanged.

## Tests
`writer.test.ts` — normalize: ids assigned; non-patient/unknown turnIds filtered; item without valid turns dropped & counted;
caps enforced; banned phrase dropped unless patient said "diagnos"; prompt contains `TRANSCRIPT:` and cacheSalt passed.
`quotes.test.ts` — exact keep; whitespace/curly normalization keep; case change → drop; found in another turn → turnId corrected;
companion quote dropped; duplicate dropped.
`verifier.test.ts` — unsupported ids returned; unknown ids ignored; failure → null verifier, items kept.
`assemble.test.ts` — risk flags from keyword+model+instrument events deduped/sorted; screening via scoreInstrument; notDiscussed/declined math;
duration ≥ 1; output passes `ReportContentSchema`.
`edits.test.ts` — each kind on allowed sections; `correct` on quotes → error; remove on `risk` → schema error; unknown id → error;
annotations numbered; original AI text preserved.
`redaction.test.ts` — removed-only turns redacted; turn also cited by kept item not redacted; turn with SafetyEvent never redacted;
`toClinicianContent` strips removed text only.
`reports.routes.test.ts` (Supertest, MockLlmClient)
- finish happy path → 200 DRAFT report, session PATIENT_REVIEW, `draftJson == currentJson`, audit row
- finish with unsupported item → writer called twice (`regenerated: true`), still-unsupported item removed
- writer fails → 503, state GENERATING_REPORT; second finish succeeds
- finish with no patient messages → 409; finish from PATIENT_REVIEW → 409; other patient → 404
- finish from CRISIS_PAUSED works and report risk level is imminent with flag evidence
- PATCH applies edits; invalid batch saves nothing; PATCH after approve → 409
- approve → APPROVED, SUBMITTED, redaction applied; approve twice → 409
- `draftJson` never changes after edits

## Verification
```bash
npm test -w @pvc/api -- reports writer quotes verifier assemble edits redaction
npm run typecheck && npm run lint && npm test
LLM_MODE=demo npm run dev -w @pvc/api
# after a few messages (M06 curl steps):
curl -s -X POST localhost:4000/api/sessions/$SID/finish -H "authorization: Bearer $T" | jq '.content.screening, .content.quotes'
curl -s -X POST localhost:4000/api/sessions/$SID/report/approve -H "authorization: Bearer $T" | jq '.session.state'  # "SUBMITTED"
```

## Definition of Done
- [ ] Finish/get/patch/approve routes implemented with exact state rules
- [ ] Scores, risk, quotes, redactions are computed by code (no model numbers ever reach the report)
- [ ] Writer and verifier use different roles; regeneration happens at most once
- [ ] `toClinicianContent` exported for M08
- [ ] All tests above pass; CONVENTIONS §7 checklist complete; PROGRESS.md updated
