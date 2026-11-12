import type { DomainKey, SummarySection } from '../keys';

export interface DomainDef {
  key: DomainKey;
  label: string;
  plainLabel: string;
  hint: string;
  required: boolean;
}

export const DOMAINS: DomainDef[] = [
  {
    key: 'chief_concern',
    label: 'Chief concern',
    plainLabel: 'What brought you here',
    hint: "What's been going on that made you want to talk to someone?",
    required: true,
  },
  {
    key: 'mood_anxiety',
    label: 'Mood & anxiety',
    plainLabel: 'Mood and worry',
    hint: 'How has your mood been, and how much has worry been part of your days?',
    required: false,
  },
  {
    key: 'sleep_appetite_energy',
    label: 'Sleep, appetite, energy',
    plainLabel: 'Sleep, eating and energy',
    hint: 'How have your sleep, appetite and energy been?',
    required: false,
  },
  {
    key: 'functioning',
    label: 'Functioning',
    plainLabel: 'Daily life',
    hint: 'How has this affected work or school, home, or the people around you?',
    required: false,
  },
  {
    key: 'substance_use',
    label: 'Substance use',
    plainLabel: 'Alcohol and other substances',
    hint: 'Some people use alcohol or other substances to cope. Has that been part of things for you?',
    required: false,
  },
  {
    key: 'safety',
    label: 'Safety',
    plainLabel: 'Staying safe',
    hint: '(asked via phq9_9 / safety follow-up)',
    required: false,
  },
  {
    key: 'history',
    label: 'Past history',
    plainLabel: 'Past care',
    hint: 'Have you had support for your mental health before — counseling, medication, or a diagnosis?',
    required: false,
  },
  {
    key: 'supports',
    label: 'Supports & strengths',
    plainLabel: 'Support and strengths',
    hint: 'Who or what helps you when things are hard?',
    required: false,
  },
  {
    key: 'goals',
    label: 'Care preferences',
    plainLabel: 'What you want from care',
    hint: 'What kind of help are you hoping for — talking with someone, medication, both, or not sure yet?',
    required: false,
  },
  {
    key: 'priorities',
    label: 'Patient priorities',
    plainLabel: 'What matters most',
    hint: 'If your clinician could help with just one thing first, what would it be?',
    required: true,
  },
];

export const SUMMARY_SECTION_LABELS: Record<SummarySection, { label: string; plainLabel: string }> =
  {
    chiefConcern: { label: 'Chief concern', plainLabel: 'What brought you here' },
    presentConcern: {
      label: 'History of present concern',
      plainLabel: 'How it started and how it has been',
    },
    moodAnxiety: { label: 'Mood & anxiety', plainLabel: 'Mood and worry' },
    sleepAppetiteEnergy: {
      label: 'Sleep, appetite, energy',
      plainLabel: 'Sleep, eating and energy',
    },
    functioning: { label: 'Functioning', plainLabel: 'Daily life' },
    substanceUse: { label: 'Substance use', plainLabel: 'Alcohol and other substances' },
    history: { label: 'Past psychiatric history & treatment', plainLabel: 'Past care' },
    supports: { label: 'Supports & strengths', plainLabel: 'Support and strengths' },
    carePreferences: { label: 'Goals & care preferences', plainLabel: 'What you want from care' },
  };
