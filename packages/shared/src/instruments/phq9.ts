import type { InstrumentItemKey } from '../keys';

export interface InstrumentItemDef {
  key: InstrumentItemKey;
  officialText: string;
  shortLabel: string;
  conversational: string;
  confirmPrompt: string;
}

export const INSTRUMENT_ATTRIBUTION =
  'PHQ-9 and GAD-7 developed by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues, with an educational grant from Pfizer Inc. No permission required to reproduce, translate, display or distribute.';

export const PHQ9_ITEMS: InstrumentItemDef[] = [
  {
    key: 'phq9_1',
    officialText: 'Little interest or pleasure in doing things',
    shortLabel: 'Interest',
    conversational:
      'Have you been finding less enjoyment or interest in the things you usually like doing?',
    confirmPrompt:
      'How often has having little interest or pleasure in doing things bothered you over the last 2 weeks?',
  },
  {
    key: 'phq9_2',
    officialText: 'Feeling down, depressed, or hopeless',
    shortLabel: 'Low mood',
    conversational: 'How often have you been feeling down, low, or hopeless lately?',
    confirmPrompt:
      'How often has feeling down, depressed, or hopeless bothered you over the last 2 weeks?',
  },
  {
    key: 'phq9_3',
    officialText: 'Trouble falling or staying asleep, or sleeping too much',
    shortLabel: 'Sleep',
    conversational:
      'How has your sleep been lately — trouble falling asleep, staying asleep, or sleeping more than usual?',
    confirmPrompt: 'How often has trouble with sleep bothered you over the last 2 weeks?',
  },
  {
    key: 'phq9_4',
    officialText: 'Feeling tired or having little energy',
    shortLabel: 'Energy',
    conversational: 'How has your energy been? Do you feel tired or worn out much of the time?',
    confirmPrompt:
      'How often has feeling tired or low on energy bothered you over the last 2 weeks?',
  },
  {
    key: 'phq9_5',
    officialText: 'Poor appetite or overeating',
    shortLabel: 'Appetite',
    conversational: 'How has your appetite been — eating much less, or much more, than usual?',
    confirmPrompt:
      'How often has a poor appetite or overeating bothered you over the last 2 weeks?',
  },
  {
    key: 'phq9_6',
    officialText:
      'Feeling bad about yourself — or that you are a failure or have let yourself or your family down',
    shortLabel: 'Self-worth',
    conversational:
      'How have you been feeling about yourself lately? Do you find yourself being hard on yourself or feeling like you have let people down?',
    confirmPrompt:
      'How often has feeling bad about yourself, or that you have let yourself or others down, bothered you over the last 2 weeks?',
  },
  {
    key: 'phq9_7',
    officialText:
      'Trouble concentrating on things, such as reading the newspaper or watching television',
    shortLabel: 'Concentration',
    conversational:
      'How has your focus been? For example, is it hard to concentrate on reading or watching something?',
    confirmPrompt: 'How often has trouble concentrating bothered you over the last 2 weeks?',
  },
  {
    key: 'phq9_8',
    officialText:
      'Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual',
    shortLabel: 'Slowed or restless',
    conversational:
      'Have you or others noticed you moving or talking more slowly than usual, or feeling so restless you cannot sit still?',
    confirmPrompt:
      'How often has moving or speaking noticeably slowly, or being unusually fidgety or restless, bothered you over the last 2 weeks?',
  },
  {
    key: 'phq9_9',
    officialText: 'Thoughts that you would be better off dead or of hurting yourself in some way',
    shortLabel: 'Self-harm thoughts',
    conversational:
      "Sometimes when people feel this way, they have thoughts that they'd be better off dead or of hurting themselves. Have you had thoughts like that over the last couple of weeks?",
    confirmPrompt:
      'How often have you had thoughts that you would be better off dead or of hurting yourself over the last 2 weeks?',
  },
];
