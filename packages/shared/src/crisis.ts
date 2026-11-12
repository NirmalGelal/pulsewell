import type { CrisisResource } from './schemas/dto';

export const CRISIS_RESOURCES: CrisisResource[] = [
  {
    id: '988',
    name: '988 Suicide & Crisis Lifeline',
    action: 'Call or text 988 (24/7, free, confidential)',
    href: 'tel:988',
  },
  {
    id: 'crisis-text-line',
    name: 'Crisis Text Line',
    action: 'Text HOME to 741741',
    href: 'sms:741741?&body=HOME',
  },
  {
    id: '911',
    name: 'Emergency services',
    action: 'Call 911 if you are in immediate danger',
    href: 'tel:911',
  },
];
export const CONSENT_VERSION = 'v1';

export const CRISIS_MESSAGE =
  "I'm really glad you told me. What you're going through matters, and you deserve support right now. " +
  "I'm going to pause our conversation so you can reach someone who can help immediately. " +
  'Your care team has also been notified.';

export const ELEVATED_RESOURCES_TEXT =
  'If you ever feel unsafe, you can call or text 988 any time, day or night.';
