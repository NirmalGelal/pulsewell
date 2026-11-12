# M04 — Clinical Instruments, Scoring & Coverage

| | |
|---|---|
| **Depends on** | M01 |
| **Workspaces** | `packages/shared` (pure TypeScript — no I/O, no LLM) |
| **Size** | Small–medium, but correctness-critical |

## Goal
The deterministic clinical core: PHQ-9 and GAD-7 definitions, scoring and severity bands; interview domain definitions;
the rules that decide which checklist items are "covered", what the progress bar shows, and when a frequency
confirmation (answer chips) is needed. Used by the API (M06, M07, M08) **and** the web app (M09, M10), so it lives in `@pvc/shared`.

> Principle: **numbers come from code**. LLMs may extract an answer; only this module computes totals and bands.

## Read first
`CONTRACTS.md` §1 (`SeverityBand`, `ItemStatus`, `ChecklistSource`), §2 (keys), §6 (`ProgressDto`, `PendingItemDto`, `AnswerOption`),
§7 (`InstrumentResult`), §12 (`TrackerOutput`).

## Files
```
packages/shared/src/instruments/
  options.ts       answer options + timeframe
  phq9.ts          gad7.ts          domains.ts
  scoring.ts       coverage.ts      index.ts
  *.test.ts
packages/shared/src/index.ts      (re-export)
packages/shared/src/fixtures.ts   (use real scoring for bands in buildInstrumentResult)
```

## Content

### options.ts
```ts
export const INSTRUMENT_TIMEFRAME = 'over the last 2 weeks';
export const ANSWER_OPTIONS: AnswerOption[] = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'Several days' },
  { value: 2, label: 'More than half the days' },
  { value: 3, label: 'Nearly every day' },
];
export const CONFIDENCE_THRESHOLD = 0.7;
```

### phq9.ts / gad7.ts
```ts
export interface InstrumentItemDef {
  key: InstrumentItemKey;
  officialText: string;   // standard item wording (shown to clinicians)
  shortLabel: string;     // compact label for tables ("Sleep", "Worry control")
  conversational: string; // how the companion may ask it naturally (FOCUS_HINT)
  confirmPrompt: string;  // short chip-question: "How often has <topic> bothered you over the last 2 weeks?"
}
export const PHQ9_ITEMS: InstrumentItemDef[]; export const GAD7_ITEMS: InstrumentItemDef[];
export const INSTRUMENT_ATTRIBUTION =
  'PHQ-9 and GAD-7 developed by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues, with an educational grant from Pfizer Inc. No permission required to reproduce, translate, display or distribute.';
```
PHQ-9 official texts (in order): 1 Little interest or pleasure in doing things · 2 Feeling down, depressed, or hopeless ·
3 Trouble falling or staying asleep, or sleeping too much · 4 Feeling tired or having little energy · 5 Poor appetite or overeating ·
6 Feeling bad about yourself — or that you are a failure or have let yourself or your family down ·
7 Trouble concentrating on things, such as reading the newspaper or watching television ·
8 Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual ·
9 Thoughts that you would be better off dead or of hurting yourself in some way.

GAD-7 official texts: 1 Feeling nervous, anxious or on edge · 2 Not being able to stop or control worrying ·
3 Worrying too much about different things · 4 Trouble relaxing · 5 Being so restless that it is hard to sit still ·
6 Becoming easily annoyed or irritable · 7 Feeling afraid as if something awful might happen.

Write the `conversational` versions yourself: warm, plain, one question, no clinical words, e.g. phq9_3 → "How has your sleep been lately — trouble falling asleep, staying asleep, or sleeping more than usual?"
phq9_9's conversational text must be gentle and direct (asking about suicidal thoughts directly is clinically recommended and does not increase risk):
"Sometimes when people feel this way, they have thoughts that they'd be better off dead or of hurting themselves. Have you had thoughts like that over the last couple of weeks?"

### domains.ts
```ts
export interface DomainDef { key: DomainKey; label: string; plainLabel: string; hint: string; required: boolean }
export const DOMAINS: DomainDef[]; // in DOMAIN_KEYS order
```
| key | label (clinician) | plainLabel (patient) | hint (FOCUS_HINT) | required |
|---|---|---|---|---|
| chief_concern | Chief concern | What brought you here | What's been going on that made you want to talk to someone? | ✅ |
| mood_anxiety | Mood & anxiety | Mood and worry | How has your mood been, and how much has worry been part of your days? | |
| sleep_appetite_energy | Sleep, appetite, energy | Sleep, eating and energy | How have your sleep, appetite and energy been? | |
| functioning | Functioning | Daily life | How has this affected work or school, home, or the people around you? | |
| substance_use | Substance use | Alcohol and other substances | Some people use alcohol or other substances to cope. Has that been part of things for you? | |
| safety | Safety | Staying safe | (asked via phq9_9 / safety follow-up) | |
| history | Past history | Past care | Have you had support for your mental health before — counseling, medication, or a diagnosis? | |
| supports | Supports & strengths | Support and strengths | Who or what helps you when things are hard? | |
| goals | Care preferences | What you want from care | What kind of help are you hoping for — talking with someone, medication, both, or not sure yet? | |
| priorities | Patient priorities | What matters most | If your clinician could help with just one thing first, what would it be? | ✅ |

Also export report-section headings (used by M09 patient review and M10 clinician report):
```ts
export const SUMMARY_SECTION_LABELS: Record<SummarySection, { label: string; plainLabel: string }> = {
  chiefConcern:        { label: 'Chief concern',                     plainLabel: 'What brought you here' },
  presentConcern:      { label: 'History of present concern',        plainLabel: 'How it started and how it has been' },
  moodAnxiety:         { label: 'Mood & anxiety',                    plainLabel: 'Mood and worry' },
  sleepAppetiteEnergy: { label: 'Sleep, appetite, energy',           plainLabel: 'Sleep, eating and energy' },
  functioning:         { label: 'Functioning',                       plainLabel: 'Daily life' },
  substanceUse:        { label: 'Substance use',                     plainLabel: 'Alcohol and other substances' },
  history:             { label: 'Past psychiatric history & treatment', plainLabel: 'Past care' },
  supports:            { label: 'Supports & strengths',              plainLabel: 'Support and strengths' },
  carePreferences:     { label: 'Goals & care preferences',          plainLabel: 'What you want from care' },
};
```

### scoring.ts
```ts
export function phq9Band(total: number): SeverityBand;  // 0–4 minimal, 5–9 mild, 10–14 moderate, 15–19 moderately_severe, 20–27 severe
export function gad7Band(total: number): SeverityBand;  // 0–4 minimal, 5–9 mild, 10–14 moderate, 15–21 severe
// both throw RangeError outside 0..27 / 0..21 or for non-integers

export interface ChecklistItemLike {
  key: ChecklistKey; status: ItemStatus; value: number | null; confidence: number; source: ChecklistSource; turnIds: number[]; note?: string | null;
}
export function scoreInstrument(kind: 'phq9' | 'gad7', items: ChecklistItemLike[]): InstrumentResult;
```
`scoreInstrument` rules:
- Output `items` in key order, always all 9/7.
- An item **counts** (has a value) only if `status === 'answered'`, `value ∈ {0,1,2,3}`, and (`source === 'patient_tap'` or `confidence ≥ CONFIDENCE_THRESHOLD`).
- Counted → `{ value, status: 'answered' }`; declined → `{ value: null, status: 'declined' }`; partial or low-confidence → `{ value: null, status: 'partial' }`; absent → `{ value: null, status: 'missing' }`.
- `partialSum` = sum of counted values; `complete` = all items counted; `total` and `band` only when complete, else `null`.

```ts
export function describeBand(kind: 'phq9' | 'gad7', band: SeverityBand): { clinical: string; plain: string };
```
- clinical: e.g. `"Moderate depressive symptom severity (PHQ-9 10–14)"`, `"Mild anxiety symptom severity (GAD-7 5–9)"`.
- plain (second person, never diagnostic, never alarming): e.g. moderate → `"Your answers fall in the moderate range. That's worth talking through with your clinician."`
  minimal → `"Your answers fall in the minimal range."` Severe → `"Your answers fall in the severe range. Your clinician will want to talk about this with you soon."`
- Must not contain the words "you have", "diagnos", "disorder".

### coverage.ts
```ts
export function isCovered(item: ChecklistItemLike): boolean;
  // declined → true; answered domain → true; answered instrument → counted per scoreInstrument rules; else false
export function needsConfirmation(item: ChecklistItemLike | undefined, key: InstrumentItemKey): boolean;
  // instrument item present and not covered and not declined (i.e., partial or low-confidence answered)
export function computeProgress(items: ChecklistItemLike[]): ProgressDto;
  // total = 26; covered = count isCovered over CHECKLIST_KEYS; percent = round(covered/total*100);
  // missingRequired = every INSTRUMENT_ITEM_KEY not covered + required domains (chief_concern, priorities) not covered,
  //   in CHECKLIST_KEYS order; canFinish = missingRequired.length === 0
export function pendingItemFor(key: InstrumentItemKey): PendingItemDto; // prompt = item.confirmPrompt, options = ANSWER_OPTIONS
export function mergeChecklistUpdate(existing: ChecklistItemLike | undefined, update: TrackerOutput['updates'][number]): ChecklistItemLike | null;
export function isPhq9Item9Positive(items: ChecklistItemLike[]): boolean; // counted phq9_9 value ≥ 1
export function itemDef(key: InstrumentItemKey): InstrumentItemDef; export function domainDef(key: DomainKey): DomainDef;
```
`mergeChecklistUpdate` rules (returns the new item, or `null` = no change):
1. If `existing?.source === 'patient_tap'` → `null` (a patient's explicit answer is never overwritten by the tracker).
2. Instrument key with `status: 'answered'` and `value === null` → treat as `partial`.
3. Domain key: force `value = null`; truncate `note` to 200 chars.
4. Otherwise the update replaces status/value/confidence/note; `turnIds` = sorted union of existing and update; `source = 'tracker'`.
5. Update with `confidence` outside 0..1 or empty `turnIds` → `null` (ignored; the caller logs it).

## Tests
`scoring.test.ts`
- PHQ-9 band boundaries: 0, 4, 5, 9, 10, 14, 15, 19, 20, 27 → expected bands; 28 and -1 and 2.5 throw
- GAD-7 band boundaries: 0, 4, 5, 9, 10, 14, 15, 21; 22 throws
- all items answered with conf 0.9 → complete, total, band
- one item confidence 0.5 → partial, `total: null`, `band: null`, `partialSum` excludes it
- `patient_tap` with confidence 0.1 still counts
- declined item → status declined, not complete
- missing item → status missing; items always length 9/7 in key order
- value 4 or -1 in input is not counted (treated as partial)

`describe.test.ts`
- every band × kind returns clinical + plain strings
- no plain string contains "you have", "diagnos", "disorder" (loop all)

`coverage.test.ts`
- empty checklist → covered 0, total 26, percent 0, missingRequired = 16 instrument keys + chief_concern + priorities, canFinish false
- all instrument items covered + chief_concern + priorities → canFinish true even if other domains missing
- declined counts as covered
- `needsConfirmation` true for partial and low-confidence answered; false for declined, tapped, absent
- `pendingItemFor('gad7_2')` returns confirmPrompt and 4 options with values 0..3
- `mergeChecklistUpdate`: never overwrites patient_tap; answered+null → partial; domain value forced null; note truncated to 200;
  turnIds union sorted unique; invalid confidence ignored; empty turnIds ignored
- `isPhq9Item9Positive` true for counted value 1..3; false for 0, partial, missing

`content.test.ts`
- PHQ9_ITEMS has 9 items with keys in order, GAD7_ITEMS 7; every item has non-empty texts
- DOMAINS covers every DOMAIN_KEY exactly once; required flags only on chief_concern and priorities
- SUMMARY_SECTION_LABELS has an entry for every SUMMARY_SECTIONS key

## Verification
```bash
npm test -w @pvc/shared
npm run typecheck && npm run lint && npm test
```

## Definition of Done
- [ ] All functions exported from `@pvc/shared`
- [ ] Official item texts exact; attribution string included
- [ ] `buildInstrumentResult` fixture now fills `band` using `scoreInstrument`
- [ ] All tests above pass; CONVENTIONS §7 checklist complete; PROGRESS.md updated
