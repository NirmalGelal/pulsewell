import type { InstrumentItemDef } from './phq9';

export const GAD7_ITEMS: InstrumentItemDef[] = [
  {
    key: 'gad7_1',
    officialText: 'Feeling nervous, anxious or on edge',
    shortLabel: 'Nervous or on edge',
    conversational: 'How often have you been feeling nervous, anxious, or on edge?',
    confirmPrompt:
      'How often has feeling nervous, anxious or on edge bothered you over the last 2 weeks?',
  },
  {
    key: 'gad7_2',
    officialText: 'Not being able to stop or control worrying',
    shortLabel: 'Worry control',
    conversational: 'When you start worrying, how hard is it to stop or get a handle on it?',
    confirmPrompt:
      'How often has not being able to stop or control worrying bothered you over the last 2 weeks?',
  },
  {
    key: 'gad7_3',
    officialText: 'Worrying too much about different things',
    shortLabel: 'Excess worry',
    conversational: 'Do you find yourself worrying a lot about many different things?',
    confirmPrompt:
      'How often has worrying too much about different things bothered you over the last 2 weeks?',
  },
  {
    key: 'gad7_4',
    officialText: 'Trouble relaxing',
    shortLabel: 'Relaxing',
    conversational: 'How easy is it for you to unwind and relax these days?',
    confirmPrompt: 'How often has trouble relaxing bothered you over the last 2 weeks?',
  },
  {
    key: 'gad7_5',
    officialText: 'Being so restless that it is hard to sit still',
    shortLabel: 'Restlessness',
    conversational: 'Do you feel so restless that it is hard to sit still?',
    confirmPrompt:
      'How often has being so restless that it is hard to sit still bothered you over the last 2 weeks?',
  },
  {
    key: 'gad7_6',
    officialText: 'Becoming easily annoyed or irritable',
    shortLabel: 'Irritability',
    conversational:
      'Have you noticed yourself getting annoyed or irritable more easily than usual?',
    confirmPrompt:
      'How often has becoming easily annoyed or irritable bothered you over the last 2 weeks?',
  },
  {
    key: 'gad7_7',
    officialText: 'Feeling afraid as if something awful might happen',
    shortLabel: 'Fear of something awful',
    conversational: 'Have you had a sense of dread, as if something awful might happen?',
    confirmPrompt:
      'How often has feeling afraid, as if something awful might happen, bothered you over the last 2 weeks?',
  },
];
