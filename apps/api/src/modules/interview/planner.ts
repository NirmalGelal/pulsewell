import {
  INSTRUMENT_ITEM_KEYS,
  DOMAIN_KEYS,
  domainDef,
  isCovered,
  itemDef,
  needsConfirmation,
  type ChecklistItemLike,
  type ChecklistKey,
  type DomainKey,
  type FocusKey,
  type InstrumentItemKey,
  type InterviewState,
} from '@pvc/shared';

export const INTERVIEW_ORDER: ChecklistKey[] = [
  'chief_concern',
  'mood_anxiety',
  'phq9_1',
  'phq9_2',
  'gad7_1',
  'gad7_2',
  'gad7_3',
  'sleep_appetite_energy',
  'phq9_3',
  'phq9_4',
  'phq9_5',
  'functioning',
  'phq9_6',
  'phq9_7',
  'phq9_8',
  'gad7_4',
  'gad7_5',
  'gad7_6',
  'gad7_7',
  'substance_use',
  'history',
  'phq9_9',
  'supports',
  'goals',
  'priorities',
]; // 'safety' domain is filled from phq9_9, never asked directly

export const MAX_TURN_ID = 120;

export const SPECIAL_HINTS = {
  open_story:
    'Reflect what they shared in one short sentence and invite them to say a little more about it.',
  safety_followup:
    'Gently and directly ask whether they are safe right now, and whether they have thought about acting on these feelings or have a plan.',
  wrap_up:
    'Briefly summarize what you heard in 2–3 sentences, ask if anything important is missing, and let them know they can press Finish when ready.',
} as const;

const INSTRUMENT_SET: ReadonlySet<string> = new Set(INSTRUMENT_ITEM_KEYS);
const DOMAIN_SET: ReadonlySet<string> = new Set(DOMAIN_KEYS);

export const isInstrumentKey = (k: string | null | undefined): k is InstrumentItemKey =>
  !!k && INSTRUMENT_SET.has(k);

/** Single-line hint describing what a focus is about (used by interviewer and tracker prompts). */
export function focusHint(focus: FocusKey): string {
  if (isInstrumentKey(focus)) return itemDef(focus).conversational;
  if (DOMAIN_SET.has(focus)) return domainDef(focus as DomainKey).hint;
  switch (focus) {
    case 'open_story':
    case 'safety_followup':
    case 'wrap_up':
      return SPECIAL_HINTS[focus];
    default:
      return 'Ask the question your clinician asked, in your own gentle words.';
  }
}

export function planNextFocus(input: {
  checklist: ChecklistItemLike[];
  state: InterviewState;
  patientTurnCount: number;
  nextTurnId: number;
  needsSafetyFollowUp: boolean;
}): { focus: FocusKey; hint: string; followUpIndex?: number } {
  const { checklist, state, patientTurnCount, nextTurnId } = input;
  const byKey = new Map(checklist.map((i) => [i.key, i]));
  const attempts = (k: FocusKey) => state.attempts[k] ?? 0;

  if (nextTurnId > MAX_TURN_ID) return { focus: 'wrap_up', hint: SPECIAL_HINTS.wrap_up };

  if (input.needsSafetyFollowUp && !state.safetyFollowUpDone)
    return { focus: 'safety_followup', hint: SPECIAL_HINTS.safety_followup };

  const last = state.lastFocus;
  if (isInstrumentKey(last) && needsConfirmation(byKey.get(last), last) && attempts(last) < 2)
    return { focus: last, hint: itemDef(last).confirmPrompt };

  if (patientTurnCount === 1) return { focus: 'open_story', hint: SPECIAL_HINTS.open_story };

  if (state.askedFollowUps < state.followUpQuestions.length && patientTurnCount >= 2) {
    const q = (state.followUpQuestions[state.askedFollowUps] ?? '').replace(/\s+/g, ' ');
    return {
      focus: 'follow_up_question',
      hint: `Your clinician asked: "${q}"`,
      followUpIndex: state.askedFollowUps,
    };
  }

  for (const key of INTERVIEW_ORDER) {
    const item = byKey.get(key);
    if (item && isCovered(item)) continue;
    if (attempts(key) >= 2) continue;
    return { focus: key, hint: focusHint(key) };
  }
  return { focus: 'wrap_up', hint: SPECIAL_HINTS.wrap_up };
}
