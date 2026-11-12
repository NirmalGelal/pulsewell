export const PHQ9_KEYS = [
  'phq9_1',
  'phq9_2',
  'phq9_3',
  'phq9_4',
  'phq9_5',
  'phq9_6',
  'phq9_7',
  'phq9_8',
  'phq9_9',
] as const;
export const GAD7_KEYS = [
  'gad7_1',
  'gad7_2',
  'gad7_3',
  'gad7_4',
  'gad7_5',
  'gad7_6',
  'gad7_7',
] as const;
export type Phq9Key = (typeof PHQ9_KEYS)[number];
export type Gad7Key = (typeof GAD7_KEYS)[number];
export type InstrumentItemKey = Phq9Key | Gad7Key;
export const INSTRUMENT_ITEM_KEYS = [...PHQ9_KEYS, ...GAD7_KEYS] as const;

// Interview domains (coverage checklist). Order = default interview order.
export const DOMAIN_KEYS = [
  'chief_concern',
  'mood_anxiety',
  'sleep_appetite_energy',
  'functioning',
  'substance_use',
  'safety',
  'history',
  'supports',
  'goals',
  'priorities',
] as const;
export type DomainKey = (typeof DOMAIN_KEYS)[number];

export type ChecklistKey = InstrumentItemKey | DomainKey;
export const CHECKLIST_KEYS = [...INSTRUMENT_ITEM_KEYS, ...DOMAIN_KEYS] as const;

// Report summary sections (clinician headings in parentheses)
export const SUMMARY_SECTIONS = [
  'chiefConcern', // Chief concern
  'presentConcern', // History of present concern (onset, course, triggers)
  'moodAnxiety', // Mood & anxiety
  'sleepAppetiteEnergy', // Sleep, appetite, energy
  'functioning', // Functioning (work/school, home, relationships)
  'substanceUse', // Substance use
  'history', // Past psychiatric history, treatment, medications
  'supports', // Supports & strengths
  'carePreferences', // Goals & care preferences
] as const;
export type SummarySection = (typeof SUMMARY_SECTIONS)[number];

// Sections a patient edit may target
export const EDITABLE_SECTIONS = [...SUMMARY_SECTIONS, 'priorities', 'quotes'] as const;
export type EditableSection = (typeof EDITABLE_SECTIONS)[number];
// Sections a patient may only annotate (never correct/remove)
export const ANNOTATE_ONLY_SECTIONS = ['risk', 'screening'] as const;
export type AnnotatableSection = EditableSection | (typeof ANNOTATE_ONLY_SECTIONS)[number];
export const ANNOTATABLE_SECTIONS = [...EDITABLE_SECTIONS, ...ANNOTATE_ONLY_SECTIONS] as const;
