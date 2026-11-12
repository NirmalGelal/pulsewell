# M05 — Safety Service & Crisis Protocol

| | |
|---|---|
| **Depends on** | M02 (audit), M03 (LLM), M04 (instrument helpers) |
| **Workspaces** | `apps/api`, `packages/shared` (crisis copy) |
| **Size** | Medium — **highest-stakes module** |

## Goal
Assess **every** patient message for risk using two independent layers — a deterministic keyword scanner and an LLM
classifier (`safety` role, `gemma`) — persist safety events, keep the session's risk level, and run the crisis protocol
(pause the interview + create an urgent clinician alert) when risk is imminent.

M05 exposes a service; M06 calls it inside the message pipeline. M05 adds **no routes**.

> Rules that must never be weakened: (1) the keyword layer works with no model; (2) imminent keyword hits act
> immediately without waiting for a model; (3) a model failure never lowers risk or crashes the turn;
> (4) risk level of a session never decreases.

## Read first
`CONTRACTS.md` §1 (risk enums), §3 (state machine), §4 (`SafetyEvent`, `Alert`, `Session.riskLevel`), §9 (`safety`, `crisis` events),
§12 (`SafetyClassifierOutput`, transcript format). M04 `isPhq9Item9Positive`.

## Files
```
apps/api/src/modules/safety/
  keywords.ts          phrase lists + scanner
  classifier.ts        LLM classifier prompt + call
  safety.service.ts    assessMessage, recordInstrumentRisk
  keywords.test.ts  classifier.test.ts  safety.service.test.ts
packages/shared/src/crisis.ts   (add CRISIS_MESSAGE, ELEVATED_RESOURCES_TEXT)
```

## Behavior

### Shared copy (add to `crisis.ts`)
```ts
export const CRISIS_MESSAGE =
  "I'm really glad you told me. What you're going through matters, and you deserve support right now. " +
  "I'm going to pause our conversation so you can reach someone who can help immediately. " +
  "Your care team has also been notified.";
export const ELEVATED_RESOURCES_TEXT =
  "If you ever feel unsafe, you can call or text 988 any time, day or night.";
```

### keywords.ts
```ts
export interface KeywordResult { level: RiskLevel; categories: RiskCategory[]; evidence: string }
export function normalize(text: string): string; // lowercase, curly→straight quotes, collapse whitespace, strip punctuation except apostrophes
export function scanKeywords(text: string): KeywordResult; // highest-level match wins; categories = union of matches at all levels; evidence = matched phrase as it appears in the ORIGINAL text (case preserved) for the highest match
```
Match whole phrases with word boundaries on the normalized text (also try with apostrophes removed, so "im", "dont" match).
Phrase table (extend thoughtfully; keep imminent list to **first-person intent / plan / means / timeline** phrases):

| Level | Category | Phrases (examples — implement at least these) |
|---|---|---|
| imminent | suicidal_ideation | i am going to kill myself · i'm going to kill myself · i will kill myself · i'm going to end my life · i am going to end my life · i have a plan to kill myself · i plan to kill myself · i'm going to end it tonight · tonight i will end it · this is my goodbye · i have the pills ready |
| imminent | harm_to_others | i am going to kill him/her/them · i'm going to kill him/her/them · i'm going to hurt someone |
| elevated | suicidal_ideation | kill myself · suicide · suicidal · end my life · want to die · wish i was dead · wish i were dead · better off dead · don't want to be alive · don't want to be here anymore · no reason to live |
| elevated | self_harm | hurt myself · hurting myself · cut myself · cutting myself · self harm · self-harm · burn myself |
| elevated | substance_emergency | overdose · overdosed · took too many pills |
| elevated | harm_to_others | kill him · kill her · kill them · hurt someone |
| elevated | abuse | hits me · beats me · being abused · abusing me · afraid to go home |
| elevated | psychosis | voices telling me · voices tell me to |
| concern | suicidal_ideation | hopeless · can't go on · no way out · give up on everything · burden to everyone · worthless |

Known limitation (documented, intentional): negation is **not** handled ("I would never kill myself" → elevated). The classifier and
the interviewer's gentle safety follow-up handle nuance; over-triggering at *elevated* is acceptable, missing risk is not.

### classifier.ts
```ts
export async function classifyRisk(deps, args: {
  text: string; recent: { turnId: number; sender: Sender; text: string }[]; cacheSalt: string;
}): Promise<SafetyClassifierOutput>; // throws on LLM failure (caller handles)
```
- `deps.llm.completeJson('safety', { schema: SafetyClassifierOutputSchema, cacheSalt, messages })` with the role defaults (temp 0, thinking off, 4 s).
- `recent` = last 6 messages before this one, rendered with `renderTranscript`.
- System prompt (store as a constant; keep wording):
```
You are a clinical safety classifier for a mental-health intake companion. You do not chat.
Classify the risk in the PATIENT MESSAGE, using the recent conversation only as context.
Return ONLY JSON: {"level":"none|concern|elevated|imminent","categories":[...],"evidence":"<exact phrase from the PATIENT MESSAGE or empty>"}
categories ⊆ ["suicidal_ideation","self_harm","harm_to_others","abuse","psychosis","substance_emergency"]
Levels:
- imminent: current intent, plan, available means, or timeline to harm self or others; or an ongoing emergency (e.g., has just overdosed).
- elevated: thoughts of death, suicide or self-harm without a plan; recent self-harm; ongoing abuse; hearing voices telling them to do harm; harm-to-others thoughts without intent.
- concern: hopelessness, feeling trapped or a burden, without thoughts of death.
- none: none of the above. Ordinary sadness, stress or anxiety is "none".
Denials ("I would never hurt myself") are "none" unless other risk is present.
When uncertain between two levels, choose the higher one.
```
- User message: `TRANSCRIPT:` block of `recent`, blank line, `PATIENT MESSAGE: <text>`.

### safety.service.ts
```ts
export interface SafetyAssessment {
  level: RiskLevel; categories: RiskCategory[]; evidence: string;
  keyword: KeywordResult; model: SafetyClassifierOutput | null; modelError: boolean;
  crisis: boolean;                 // level === 'imminent'
  showResources: boolean;          // level is elevated or imminent
  needsSafetyFollowUp: boolean;    // level === 'elevated' (M06 planner sets focus 'safety_followup' next)
  session: Session;                // updated session row
}
export async function assessMessage(deps: AppDeps, args: {
  session: Session; turnId: number; text: string; recent: { turnId: number; sender: Sender; text: string }[]; actorId: string;
}): Promise<SafetyAssessment>;

export async function recordInstrumentRisk(deps: AppDeps, args: {
  sessionId: string; turnId: number; actorId: string;
}): Promise<void>;
```
`assessMessage` algorithm:
1. `kw = scanKeywords(text)`.
2. If `kw.level === 'imminent'` → **skip the model** (`model = null`, `modelError = false`). Else call `classifyRisk`; on any error
   set `model = null`, `modelError = true`, log `warn('safety_model_failed', { sessionId })` — continue with keyword result.
3. `level = maxRisk(kw.level, model?.level ?? 'none')`; `categories` = union (stable order of `RISK_CATEGORIES`);
   `evidence` = `kw.evidence` if keyword level ≥ model level and non-empty, else `model.evidence` **only if** it is a
   case-insensitive substring of `text`, else `''`.
4. In one `prisma.$transaction`:
   - Insert a `SafetyEvent` for **each** layer whose level ≠ `none` (`source: 'keyword' | 'model'`, own categories/evidence).
   - `session.riskLevel = maxRisk(session.riskLevel, level)` (never decreases).
   - If `level === 'imminent'`: `assertTransition(session.state, 'CRISIS_PAUSED')`, set state; create one `Alert`
     (`level 'imminent'`, evidence, `safetyEventId` = the keyword event if present, else the model event).
5. After commit: audit `safety.event` (meta: `{ level, sources: 'keyword,model' }` — no text) for each event, and `alert.create` if created.
6. Return `SafetyAssessment`.

`recordInstrumentRisk` (called by M06 when the tracker or a tap makes phq9_9 positive):
- If the session already has a SafetyEvent with `source: 'instrument'` → no-op (dedupe).
- Else insert `SafetyEvent { level: 'elevated', categories: ['suicidal_ideation'], evidence: '', source: 'instrument' }`
  and raise `session.riskLevel` to at least `elevated`. Audit `safety.event`. (No alert — no imminence signal.)

## Tests
`keywords.test.ts` (table-driven)
- imminent: "I'm going to kill myself tonight" → imminent, suicidal_ideation, evidence preserves original case
- curly apostrophe "I’m going to end my life" → imminent; "im going to kill myself" → imminent
- elevated: "sometimes I wish I was dead" → elevated; "I've been cutting myself" → self_harm; "he hits me when he drinks" → abuse
- concern: "everything feels hopeless" → concern
- negatives: "I killed it at my presentation", "this traffic is killing me", "skill myself up", "suicide squad movie" (document: "suicide" matches → elevated is acceptable; assert whatever your table produces and comment why), "" → none
- negation limitation: "I would never kill myself" → elevated (documented)
- multiple matches: highest level wins, categories unioned

`classifier.test.ts`
- should call `completeJson` with role `safety`, the session cacheSalt, transcript block of ≤6 recent turns, and `PATIENT MESSAGE:` line
- should return parsed output; should propagate LLM errors

`safety.service.test.ts` (MockLlmClient + real test DB)
- none/none → level none, no events, session unchanged, `showResources false`
- model elevated, keyword none → one `model` event, session.riskLevel elevated, `needsSafetyFollowUp true`, state INTERVIEWING
- keyword imminent → model **not called** (assert `llm.calls` empty for safety), state CRISIS_PAUSED, one Alert linked to keyword event
- model imminent → CRISIS_PAUSED + Alert linked to model event
- model throws → `modelError true`, keyword level used, warn logged, no exception
- model throws and keyword none → level none, turn continues (documented fail-open for *model* only)
- model evidence not in text → evidence ''
- session already elevated + new none → riskLevel stays elevated
- both layers fire → two events, alert uses keyword event
- `recordInstrumentRisk` twice → exactly one instrument event; riskLevel ≥ elevated
- audit rows written with no message text in meta

## Verification
```bash
npm test -w @pvc/api -- safety
npm run typecheck && npm run lint && npm test
# Optional live check of the classifier:
LIVE_LLM=1 LLM_MODE=live npm test -w @pvc/api -- safety.live   # if you add a live test with 5 labelled examples
```

## Definition of Done
- [ ] Keyword scanner, classifier, `assessMessage`, `recordInstrumentRisk` implemented exactly as specified
- [ ] The four "never weaken" rules in the Goal each have at least one test
- [ ] Crisis copy constants exported from `@pvc/shared`
- [ ] All tests above pass; CONVENTIONS §7 checklist complete; PROGRESS.md updated
