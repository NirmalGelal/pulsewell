# Demo guide

## Setup

```bash
npm install
cp .env.example .env            # keep LLM_MODE=demo to run with no models
npm run db:push && npm run seed && npm run seed:demo
npm run dev                     # api :4000, web :5173
```

Open http://localhost:5173. Accounts (password `demo1234`): `patient@demo.test` (Sam R.),
`patient2@demo.test` (Alex M.), `patient3@demo.test` (Riley K.), `clinician@demo.test` (Dr. Jordan Lee).
`npm run seed:demo` is idempotent: re-run it any time to reset the demo data.

### Live models

Set in `.env`: `LLM_MODE=live` and `NRP_API_KEY=<key>`, then restart `npm run dev`.
Confirm the model names exist:

```bash
curl "$NRP_BASE_URL/models" -H "Authorization: Bearer $NRP_API_KEY"
```

Override any role with `MODEL_INTERVIEWER`, `MODEL_SAFETY`, `MODEL_TRACKER`, `MODEL_REPORT_WRITER`,
`MODEL_VERIFIER`, `MODEL_ASSISTANT`, `MODEL_STT`.

### Onboarding a new patient

1. Log in as `clinician@demo.test`, open Patients, press Add patient, enter a name and email, press Create account.
2. Copy the one-time temporary password (it is not shown again; use Reset password on the patient page to get a new one).
3. Log in as the new patient with that password. The app asks for a new password (10+ characters) before anything else, then opens the patient home.

Seeded accounts are unaffected and never prompt for a password change.

## What the seed creates

| Patient  | Scenario                                                                              | You will see                                                                                          |
| -------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Sam R.   | two reports (3 weeks ago, reviewed; today, unreviewed): PHQ-9 16 to 12, GAD-7 12 to 9 | trend arrows down 4 / down 3, one patient correction, one item "Patient chose not to share this item" |
| Alex M.  | today, passive thoughts of death, PHQ-9 18, GAD-7 15                                  | top of the queue, elevated risk, red flag with evidence                                               |
| Riley K. | session paused in crisis, no report                                                   | open imminent alert banner on every clinician page                                                    |

## 3-minute script

1. **Patient chat (60 s).** Log in as `patient@demo.test` and start a new check-in. Answer by text, tap an answer chip for a questionnaire item, and try the microphone (Chrome, mic permission; in demo mode the transcript is canned).
2. **Finish and review (45 s).** Press Finish. In the summary, correct one line, remove one line, then Send to clinician. Point out that nothing reaches the clinician until the patient sends it.
3. **Clinician queue (45 s).** Log in as `clinician@demo.test`. The queue shows Alex first. Open the report, point at the red flag and its evidence chip `T8`; clicking it jumps to that turn in the transcript.
4. **Ask the record (20 s).** Open Sam's unreviewed report, Ask tab: "How has sleep changed?". Show the cited turns. Answers only use approved records.
5. **Safety alert (10 s).** Riley's red banner is visible on every clinician page; press Acknowledge.
6. **What we deliberately don't do (never skip).** No diagnoses or treatment advice; scores computed by code, not by the model; quotes verified word for word; the patient controls what is shared (the only exception is an imminent-risk alert, agreed at consent); audio is never stored; message text is never logged.

## Fallbacks

- If NRP is slow or down: set `LLM_MODE=demo` in `.env` and restart `npm run dev`. The seeded clinician dashboard needs no model at all.
- If data looks wrong: `npm run seed:demo` resets it.
- If the mic is unavailable: type instead; voice is optional.

## Verification

`npm run verify` runs typecheck, lint and every test (shared, api including the end-to-end flow, web).
