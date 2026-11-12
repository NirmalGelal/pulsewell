# M03 — LLM Gateway (NRP client, mocks, demo mode)

| | |
|---|---|
| **Depends on** | M01 |
| **Workspaces** | `apps/api` |
| **Size** | Medium |

## Goal
One place that talks to models. Every other module calls `deps.llm` with a **role** (`interviewer`, `safety`, …),
never a model name. This module implements three clients behind the same interface:

| Client | `mode` | Used when | Network |
|---|---|---|---|
| `LiveLlmClient` | `live` | `LLM_MODE=live` — real NRP models | yes |
| `DemoLlmClient` | `demo` | `LLM_MODE=demo` — build/demo the app with no endpoint | no |
| `MockLlmClient` | `mock` | tests — scripted per test | no |

## Read first
`CONTRACTS.md` §1 (`LlmRole`), §10, §11, §12. `CONVENTIONS.md` §3 (privacy/logging).

## Background: NRP managed LLM service
- Base URL `https://ellm.nrp-nautilus.io/v1`, OpenAI-compatible (`/chat/completions`, `/models`). Bearer token from `nrp.ai/llmtoken`.
- Model API names used here: `qwen3-small`, `gemma`, `gpt-oss`, `qwen3`, `gemma-small` (only audio-input model; status *evaluating*),
  virtual `service` (auto-fallback). Confirm with `GET /v1/models`; names come from env, never hard-coded outside config.
- Thinking toggles are passed in the request body: `chat_template_kwargs: { enable_thinking: boolean }` (qwen/gemma families),
  `reasoning_effort: 'low'|'medium'|'high'` (gpt-oss and qwen3 when thinking on).
- `cache_salt` (base64 ≥ 256 bits) in the body prevents prefix-cache sharing across users → we send each session's salt.
- With the `openai` Node SDK, extra body fields are passed by adding them to the request object (cast the params type).

## Files
```
apps/api/src/modules/llm/
  types.ts            (exists from M01 — keep; add exports if needed)
  config.ts           role settings + thinking adapter
  live-client.ts      LiveLlmClient
  json.ts             extractJson + parse/repair helpers
  retry.ts            retry/fallback policy
  mock-client.ts      MockLlmClient (also exported for tests)
  demo-client.ts      DemoLlmClient
  index.ts            createLlmClient(config, logger)
  *.test.ts           + live.live.test.ts
apps/api/src/deps.ts           (use createLlmClient)
apps/api/src/test/context.ts   (default llm = new MockLlmClient())
```
Dependency: `openai`.

## Behavior

### config.ts — role defaults
| Role | temperature | thinking | maxTokens | timeoutMs | stream? |
|---|---|---|---|---|---|
| interviewer | 0.6 | off | 400 | 30 000 | yes |
| safety | 0.0 | off | 200 | 4 000 | no |
| tracker | 0.1 | low | 1 200 | 20 000 | no |
| reportWriter | 0.2 | medium | 6 000 | 120 000 | no |
| verifier | 0.0 | low | 2 000 | 60 000 | no |
| assistant | 0.3 | low | 1 500 | 60 000 | no |
| stt | 0.0 | off | 1 500 | 60 000 | no |

Per-call `opts` override defaults. `modelFor(role)` reads `config.models[role]`.

`thinkingParams(model: string, mode: ThinkingMode): Record<string, unknown>`:
- model starts with `gpt-oss` → `{ reasoning_effort: mode === 'off' ? 'low' : mode }`
- otherwise → `{ chat_template_kwargs: { enable_thinking: mode !== 'off' } }` plus `reasoning_effort: mode` when `mode !== 'off'`

### live-client.ts
- Uses `new OpenAI({ baseURL: config.NRP_BASE_URL, apiKey: config.NRP_API_KEY })`.
- Request body: `model, messages, temperature, max_tokens, ...thinkingParams, cache_salt?`; per-call timeout via `AbortController`.
- **Output cleaning:** strip any `<think>…</think>` blocks and leading/trailing whitespace from text. Ignore `reasoning_content`.
- **Logging:** `info('llm_call', { role, model, ms, promptTokens, completionTokens, ok, attempt })`. Never log prompts or outputs.

### retry.ts — policy (applies to every method)
1. Try the role's model. Retryable errors: HTTP 408/409/429/5xx, timeouts/aborts from our timeout, network errors.
   Retry up to **2** more times with backoff 300 ms, 900 ms (injectable `sleep` for tests).
2. Non-retryable errors (400/401/403/404/422) skip remaining retries.
3. Then try `config.fallbackModel` **once** (skip if it equals the primary).
4. Then throw `LlmUnavailableError` (`code 'LLM_UNAVAILABLE'`, status 503, message names the role, not the prompt).
Result objects report the model that actually answered.

### json.ts — `completeJson`
- Sends `response_format: { type: 'json_object' }`. (If the server rejects that param with 400, retry the same call once without it.)
- `extractJson(text)`: strip ``` fences; if text isn't valid JSON, take the substring from the first `{` to the matching last `}`.
- Validate with the caller's zod schema. On failure, **one repair attempt**: append the bad output as an assistant message and a
  user message `Your previous reply was not valid. Errors: <zod issues, max 10>. Reply with corrected JSON only.`
- Still invalid → `LlmUnavailableError` (message `invalid structured output for role <role>`).

### stream()
- Calls with `stream: true`; yields `delta.content` chunks (skip empty / reasoning chunks), with `<think>` stripping applied
  incrementally (buffer while inside a think block).
- If the request fails **before the first chunk**, apply the retry/fallback policy transparently.
- If it fails **after** chunks were yielded, throw `LlmUnavailableError` from the iterator (caller sends an SSE `error`).
- `result` resolves to the full cleaned text + model when iteration completes (rejects if it failed).

### transcribe()
- Role `stt`. Accepts `audio/wav` and `audio/mpeg` only (M09 converts other formats); else throw `AppError VALIDATION_ERROR`.
- Message content: `[{ type: 'text', text: 'Transcribe the speech in this audio verbatim in English. Output only the transcript text, no commentary.' },
  { type: 'input_audio', input_audio: { data: <base64>, format: 'wav' | 'mp3' } }]`.
- No fallback model (only `gemma-small` accepts audio) — after retries throw `LlmUnavailableError`; the web app falls back to browser speech recognition.

### mock-client.ts — `MockLlmClient` (mode `mock`)
```ts
type Handler = (opts: LlmCallOptions, call: { method: 'complete'|'completeJson'|'stream'|'transcribe' }) => unknown | Promise<unknown>;
class MockLlmClient implements LlmClient {
  readonly mode = 'mock';
  calls: { role: LlmRole; method: string; opts: LlmCallOptions }[];
  on(role: LlmRole, handlerOrValue: Handler | unknown): this;      // persistent
  once(role: LlmRole, handlerOrValue: Handler | unknown): this;    // queued, consumed first
  fail(role: LlmRole, times = 1): this;                            // next N calls throw LlmUnavailableError
  reset(): void;
}
```
- `complete`/`stream`: handler returns a string (stream yields it split on spaces, preserving spaces) or `string[]` (chunks for stream).
- `completeJson`: handler returns an object; it is **validated with the caller's schema** (bad fixtures fail loudly).
- `transcribe`: handler for role `stt` returns a string.
- No handler for a role → throw `Error('MockLlmClient: no handler for role "<role>"')`.
- `model` in results = `mock-<role>`.

### demo-client.ts — `DemoLlmClient` (mode `demo`, deterministic, no network)
Lets the team run the full UI before endpoints exist. It reads the prompt markers from CONTRACTS §12.
| Role | Behavior |
|---|---|
| interviewer | Parse `CURRENT_FOCUS` and `FOCUS_HINT` from the system message. Reply `"<ack> <FOCUS_HINT>"` where `<ack>` rotates through 4 warm acknowledgements ("Thank you for sharing that.", "That sounds really hard.", "I appreciate you telling me.", "Okay, I hear you.") by turn count. For `wrap_up`: "Thank you. I have what I need to prepare your summary. When you're ready, press Finish." Stream word by word. |
| safety | `{ level: 'none', categories: [], evidence: '' }` (the M05 keyword layer still protects demo mode). |
| tracker | Parse `CURRENT_FOCUS` and the **last PATIENT line** of the transcript. Instrument focus: map phrases → value (`not at all`, `never`, `no` → 0; `several days`, `sometimes`, `a few`, `a little` → 1; `more than half`, `often`, `most days`, `a lot` → 2; `nearly every day`, `every day`, `all the time`, `always` → 3); matched → `answered` conf 0.9; unmatched → `partial` conf 0.4. Domain focus → `answered`, note = first 120 chars of patient text, conf 0.8. `open_story` → update `chief_concern`. Others → `{ updates: [] }`. |
| reportWriter | From the `TRANSCRIPT:` block: chiefConcern = first PATIENT turn after T1; presentConcern = second PATIENT turn; priorities = PATIENT turn that follows a COMPANION turn mentioning "most" or "priority", else []; quotes = first sentence (verbatim substring) of up to 3 longest PATIENT turns; `patientText = "You said: " + text`; other sections []. |
| verifier | `{ unsupported: [] }` |
| assistant | `{ answer: 'Demo mode: no model connected. The most relevant passage is cited.', citations: [{ ref: <first S…:T… ref of a PATIENT line> }] }` |
| stt | `{ text: 'I have been feeling really tired and down lately.' }` |
`completeJson` still validates with the caller's schema.

### index.ts
`createLlmClient(config, logger): LlmClient` → by `config.LLM_MODE`. `deps.ts` uses it. Test context defaults to `new MockLlmClient()`
(tests may pass their own via `createTestContext({ llm })`).

## Tests (all with a fake OpenAI transport — inject a `fetch` into the SDK or wrap the SDK call behind an injectable function)
`live-client.test.ts`
- should send model, temperature, max_tokens from role defaults and allow per-call overrides
- should send `chat_template_kwargs.enable_thinking=false` for `qwen3-small` with thinking off; `reasoning_effort` for `gpt-oss`
- should include `cache_salt` when provided and omit it otherwise
- should strip `<think>…</think>` from text
- should retry on 429 then succeed (2 calls), using injected sleep (no real waiting)
- should not retry on 401 and go straight to fallback model
- should use fallback model after 3 failures and report fallback model name in result
- should throw `LlmUnavailableError` when primary and fallback fail; message must not contain prompt text
- should time out using `timeoutMs` (fake timers or a never-resolving transport + abort)
- should never log message content (spy on logger; assert no prompt substring in any log meta)

`json.test.ts`
- `extractJson` handles fenced JSON, leading prose, trailing prose
- should validate and return typed data
- should perform one repair round-trip on invalid output and succeed
- should throw after failed repair
- should retry without `response_format` when the server rejects it with 400

`stream.test.ts`
- should yield chunks and resolve `result` with full text
- should strip think blocks split across chunks
- should fall back when failure happens before first chunk
- should throw from iterator when failure happens mid-stream, and `result` rejects

`transcribe.test.ts`
- should send `input_audio` base64 with format `wav`; should reject `audio/webm` with VALIDATION_ERROR

`mock-client.test.ts`
- `on`/`once` precedence; `fail(n)`; unmocked role throws; `completeJson` validates fixtures; `calls` recorded

`demo-client.test.ts`
- interviewer reply includes the `FOCUS_HINT`
- tracker maps "more than half the days" → value 2 answered for focus `phq9_3`; unknown phrase → partial
- reportWriter output passes `WriterOutputSchema` and every quote is a verbatim substring of its turn
- every role returns schema-valid output for its consumer schema

`live.live.test.ts` (skipped unless `LIVE_LLM=1`)
- `GET /models` lists every configured model (warn, don't fail, for `gemma-small`)
- each role returns a non-empty reply to a trivial prompt; `completeJson` returns valid `SafetyClassifierOutput`

## Verification
```bash
npm test -w @pvc/api -- llm
npm run typecheck && npm run lint && npm test
# Optional, once the team has an NRP token:
LIVE_LLM=1 LLM_MODE=live NRP_API_KEY=... npm test -w @pvc/api -- live
LLM_MODE=demo npm run dev -w @pvc/api ; curl -s localhost:4000/api/health   # llmMode: demo
```

## Definition of Done
- [ ] Three clients implement `LlmClient`; `createLlmClient` selects by `LLM_MODE`
- [ ] Retry/fallback/JSON-repair/streaming/think-stripping behave as specified
- [ ] Test context uses `MockLlmClient` by default
- [ ] No prompt/response content in logs
- [ ] All tests above pass; CONVENTIONS §7 checklist complete; PROGRESS.md updated (include the live-test result if run)
