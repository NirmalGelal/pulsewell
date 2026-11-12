import type { AnswerOption } from '../schemas/dto';

export const INSTRUMENT_TIMEFRAME = 'over the last 2 weeks';
export const ANSWER_OPTIONS: AnswerOption[] = [
  { value: 0, label: 'Not at all' },
  { value: 1, label: 'Several days' },
  { value: 2, label: 'More than half the days' },
  { value: 3, label: 'Nearly every day' },
];
export const CONFIDENCE_THRESHOLD = 0.7;
