# M09 — Web Foundation, Patient App & Voice

| | |
|---|---|
| **Depends on** | M01–M08 (all API routes exist) |
| **Workspaces** | `apps/web` (main), `apps/api` (one route: speech) |
| **Size** | Large |

## Goal
Build the shared web foundation (API client, SSE client, auth, routing, layouts) and the complete **patient side**:
login → home → consent → companion chat (text, voice, answer chips, read-aloud, crisis handling) → review/edit/approve report.
Also add the backend speech-to-text route.

## Read first
`CONVENTIONS.md` §4 (frontend patterns, accessibility). `CONTRACTS.md` §6–§9 (all patient DTOs/routes, SSE events),
§8 Speech. M04 exports used in the UI: `describeBand`, `DOMAINS` (`plainLabel`), `ANSWER_OPTIONS`. `CRISIS_RESOURCES`, `CRISIS_MESSAGE`,
`ELEVATED_RESOURCES_TEXT`.

## Part A — API: `POST /api/speech/transcribe`

Files: `apps/api/src/modules/speech/speech.routes.ts`, `convert.ts`, `speech.test.ts`. Deps: `multer`, `ffmpeg-static`.
- PATIENT only. `multer.memoryStorage()`, single field `audio`, limit 10 MB (→ 413 `PAYLOAD_TOO_LARGE`).
- Allowed mimetypes: `audio/webm`, `audio/ogg`, `audio/wav`, `audio/x-wav`, `audio/mp4`, `audio/mpeg` (others → 400).
- `wav`/`mpeg` pass through; others converted to 16 kHz mono WAV by `convertToWav(buffer)` (spawn ffmpeg-static, stdin→stdout, no temp files,
  30 s timeout). Router factory takes `{ convert }` so tests inject a fake.
- `deps.llm.transcribe(buffer, mime)`; respond `{ text }` (trimmed). Empty transcript → `{ text: '' }`.
- Audio is never written to disk or logged. Audit `speech.transcribe` (meta: `{ bytes, ms }`). LLM failure → 503.
- Tests: success with Mock `stt`; webm goes through `convert`; wav skips it; 413 on 11 MB; 400 on `image/png`; clinician → 403;
  503 on LLM failure; no audio bytes in logs.

## Part B — Web foundation (`apps/web/src/lib`, used by M10 too)

| File | Responsibility |
|---|---|
| `lib/api.ts` | `api.get/post/patch<T>(path, body?, schema?)`. Adds `Authorization`. Parses error envelope → `class ApiError { status; code; message; details }`. On 401 → clear auth + redirect `/login`. In DEV, validates responses with the passed zod schema (console.error on mismatch). `api.upload(path, formData)`. |
| `lib/sse.ts` | `postSse(path, body, { onEvent, signal }): Promise<void>` — fetch POST, non-2xx → throw `ApiError` (from JSON envelope); otherwise read `ReadableStream`, parse `event:`/`data:` blocks (handle chunk boundaries, multiple events per chunk, `\r\n`), validate with `MessageStreamEventSchema`, call `onEvent`. Resolves when the stream ends. |
| `lib/auth.tsx` | `AuthProvider` (token in `localStorage['pvc.token']`, all access in try/catch; loads `/api/auth/me`), `useAuth() → { user, login, logout, status }`, `<RequireRole role>` (redirects to `/login`, or to the user's home for the wrong role). |
| `lib/query.ts` | `QueryClient` (retry 1, no refetch on focus for chat) + query keys: `['session', id]`, `['sessions']`, `['report', sessionId]`, `['followUps']`, `['clinicians']`. |
| `routes.tsx` | `/login`, `/` → redirect by role, `/patient/*` (RequireRole PATIENT), `/clinician/*` (RequireRole CLINICIAN, placeholder until M10), 404 page. |
| `components/AppShell.tsx` | Header with app name, user name, logout; `variant: 'patient' | 'clinician'` sets palette & density. |

**Login page** `/login`: email + password, error message from `ApiError`, demo hint text "Demo: patient@demo.test / demo1234" shown only when `import.meta.env.DEV`.

## Part C — Patient screens (`apps/web/src/features/patient`)

### Home `/patient`
- Greeting with first name.
- Follow-up card if `GET /api/patient/follow-ups` non-empty: "Dr. Lee asked a few questions for your next check-in."
- Primary action: active session (state INTERVIEWING/CRISIS_PAUSED) → "Continue your conversation"; else "Start a conversation" → `/patient/consent`.
- History list from `GET /api/sessions`: date + friendly status: INTERVIEWING "In progress" · CRISIS_PAUSED "Paused" ·
  GENERATING_REPORT "Preparing summary" · PATIENT_REVIEW "Ready for your review" · SUBMITTED "Sent to your clinician" ·
  CLINICIAN_REVIEWED "Reviewed by your clinician". Click → chat or review as appropriate.

### Consent `/patient/consent`
Plain-language bullets (keep meaning; wording may be polished):
1. "This is an AI companion, not a therapist or doctor. It won't diagnose you or give medical advice."
2. "It will ask about how you've been feeling so your clinician can understand you better."
3. "You can skip any question and stop at any time."
4. "Before anything is shared, you'll see a summary and can correct it, add notes, or remove parts."
5. "Who will see it: {linked clinician names}."
6. "If you tell us you're in immediate danger, we'll pause, show you how to get help right away, and alert your care team — even before you approve the summary."
7. "Your voice recordings are turned into text and never stored."
Checkbox "I understand and agree" + "Start" (disabled until checked). On 409 with `details.sessionId` → navigate to that session.

### Chat `/patient/session/:id`
Layout (mobile-first, max-width ~720px): progress bar at top · message list · answer chips · composer.
- **Messages**: companion left (soft card), patient right. List container `aria-live="polite"`. Auto-scroll to newest unless the user scrolled up.
- **Sending** (`postSse`): disable composer; on `patient_message` append; show typing indicator until first `token`; append `token` deltas to a
  streaming bubble; on `companion_message` replace bubble with stored message; on `done` update progress + `pendingItem`; invalidate `['session', id]`.
- **Answer chips**: when `pendingItem` is set, show its `prompt` and 4 chips (`ANSWER_OPTIONS`). Tap → send `{ text: option.label, inputMode: 'TAP', answerFor: { key, value } }`.
  Patient can always type instead.
- **Safety**: on `safety` with `showResources` → persistent banner at top: `ELEVATED_RESOURCES_TEXT` + "988" call/text buttons (`href` from `CRISIS_RESOURCES`).
- **Crisis**: on `crisis` (or when loaded session state is CRISIS_PAUSED) → full-screen overlay (`role="alertdialog"`, focus trapped, initial focus on first resource):
  `CRISIS_MESSAGE`, big buttons for each `CRISIS_RESOURCES` entry (`tel:`/`sms:` links), then two secondary actions:
  "I'm safe right now — continue" (confirm dialog → `POST /resume`) and "Finish and send what I've shared" (→ finish flow). No close (X) button.
- **Errors**: `error` event or network failure → toast "The companion lost its connection." and restore the unsent text into the composer.
  409 "reply in progress" → ignore (button already disabled).
- **Finish**: button in header, enabled after ≥1 patient message. If `!progress.canFinish` → confirm dialog "Some questions aren't answered yet.
  Your clinician will see which ones are missing. Finish now?" → `POST /finish` → full-screen "Preparing your summary… this can take up to a minute"
  → navigate to review. 503 → error card with "Try again" (calls finish again).
- **Progress**: bar = `progress.percent`; caption "Getting to know you" (<30%), "Halfway there" (30–70%), "Almost done" (>70%), "Ready when you are" (canFinish).

### Voice
- `useRecorder()` — `MediaRecorder` with `audio/webm;codecs=opus` (fallback to browser default), max 120 s, returns `{ start, stop, state, level }`.
  Mic button toggles recording (shows elapsed time + pulsing indicator; `aria-pressed`).
- On stop → `api.upload('/api/speech/transcribe')` → put text **into the composer** (not auto-sent) and mark input mode `VOICE` for that send.
  Patient reviews/edits, then sends. Empty transcript → toast "I couldn't hear that — try again or type instead."
- Fallback: if MediaRecorder is unavailable or transcribe fails (503), and `window.SpeechRecognition || webkitSpeechRecognition` exists, use it
  for live dictation into the composer (still `VOICE`). If neither exists, hide the mic and show nothing broken.
- Permission denied → inline message "Microphone access is blocked. You can type instead."
- **Read aloud**: toggle in header (default off, remembered in `localStorage` try/catch). When on, each completed `companion_message` is spoken via
  `speechSynthesis` (cancel previous utterance first). Hide the toggle if `speechSynthesis` is unavailable.

### Review `/patient/session/:id/review`
Data: `GET /api/sessions/:id/report`. Title: "Here's what we'll share with {clinician name}".
Sections in this order (patient wording, `patientText`, second person):
1. **Safety** (only if `risk.level` ≥ elevated): gentle text "You shared something about your safety. We've marked it so your clinician sees it first."
   + 988 resources. Annotate only ("Add a note").
2. **What matters most to you** — priorities.
3. **Your check-in answers** — for PHQ-9 and GAD-7: `describeBand(kind, band).plain` when complete, else "You answered X of 9 questions";
   annotate only. Never show the instrument names to patients ("mood check-in", "worry check-in").
4. **Summary** — each `SUMMARY_SECTIONS` heading uses `SUMMARY_SECTION_LABELS[section].plainLabel` (M04); hide empty sections.
5. **In your words** — quotes.
6. **Not discussed** — list of `plainLabel`s.
Per item actions: "Fix this" (inline textarea → PATCH `correct`), "Don't share this" (confirm → PATCH `remove`); per section "Add a note"
(PATCH `annotate`). Show `patientCorrection` when present with "(you corrected this)"; removed items greyed with "Not shared".
Each action PATCHes one edit and updates the cache from the response.
Notice: "Your clinician will also be able to read your conversation, except the parts you choose not to share."
Primary button "Send to my clinician" → confirm dialog → `POST /report/approve` → success screen "Sent. Your clinician will see this before your visit."
APPROVED reports render read-only with "Sent on {date}". Footer on every review screen: "AI-prepared summary. Not a diagnosis."

## Tests (Vitest + RTL + MSW; `src/test/handlers.ts` with fixtures from `@pvc/shared` `buildReportContent`)
`lib/sse.test.ts` — parses events split across chunks, multiple events per chunk, CRLF; rejects invalid event with a console error; non-2xx → `ApiError`.
`lib/api.test.ts` — attaches token; error envelope → `ApiError` fields; 401 clears token.
`auth.test.tsx` — login success redirects patient → `/patient`, clinician → `/clinician`; wrong role on route redirects; bad credentials message shown.
`Home.test.tsx` — start vs continue button by session state; follow-up card shown; status labels.
`Consent.test.tsx` — Start disabled until checkbox; lists clinician names; 409 → navigates to existing session.
`Chat.test.tsx` (mock `postSse` stream via MSW returning SSE text)
- renders streamed tokens then final message; progress updates on `done`
- chips appear for `pendingItem`; tapping sends `TAP` with `answerFor`
- `safety.showResources` shows 988 banner
- `crisis` shows alertdialog with resource links and no close button; "I'm safe" calls resume after confirm
- `error` event restores composer text and shows toast
- Finish with `canFinish=false` shows confirm; 503 shows retry
`Voice.test.tsx` — mock MediaRecorder + upload: transcript lands in composer, not auto-sent, send uses `VOICE`; no MediaRecorder & no SpeechRecognition → mic hidden;
read-aloud calls `speechSynthesis.speak` once per companion message when toggled on.
`Review.test.tsx` — section order; scores shown in plain words, no "PHQ"/"GAD" text visible; Fix/Don't share/Add note send correct PATCH bodies; approve flow;
approved report read-only; safety section only when elevated.
`a11y.test.tsx` — chat and review have no buttons without accessible names (query all `button`s and assert names).

## Verification
```bash
npm test -w @pvc/web
npm test -w @pvc/api -- speech
npm run typecheck && npm run lint && npm test
LLM_MODE=demo npm run dev
# Manual (Chrome): login patient@demo.test → consent → chat 5+ turns (type, chip, mic) → type "I'm going to kill myself"
# in a SECOND session to see the crisis overlay → in a normal session press Finish → edit one item, remove one, add a note → Send.
```

## Definition of Done
- [ ] Speech route + web foundation + all patient screens implemented
- [ ] Crisis overlay cannot be dismissed without choosing an action; resources are real links
- [ ] Voice works with MediaRecorder; falls back to browser speech recognition; degrades gracefully
- [ ] Patient UI never shows instrument names, raw scores language like "PHQ", or diagnostic wording
- [ ] All tests above pass; CONVENTIONS §7 checklist complete; PROGRESS.md updated
