import {
  DOMAINS,
  GAD7_ITEMS,
  PHQ9_ITEMS,
  renderTranscript,
  riskRank,
  type ChecklistItemLike,
  type FocusKey,
  type RiskLevel,
  type Sender,
} from '@pvc/shared';
import type { ChatMessage } from '../llm/types';
import { focusHint } from './planner';

export interface TurnLike {
  turnId: number;
  sender: Sender;
  text: string;
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

export function buildInterviewerMessages(args: {
  displayName: string;
  focus: FocusKey;
  hint: string;
  history: TurnLike[];
  riskLevel: RiskLevel;
}): ChatMessage[] {
  const firstName = args.displayName.trim().split(/\s+/)[0] || 'there';
  const lines = [
    `You are a warm, calm companion helping ${firstName} prepare for a visit with their mental-health clinician.`,
    'You are not a therapist or doctor. You never diagnose, label conditions, or give medical or medication advice.',
    'Style: plain, kind words. 1–3 short sentences. Ask exactly ONE question. Briefly reflect what you heard before asking.',
    'Never judge, argue, or minimize. The person may skip any question; if they do, accept it and move on.',
    'Screening questions refer to the last 2 weeks. If an answer about frequency is vague, you may offer:',
    '"not at all, several days, more than half the days, or nearly every day?"',
    'If asked what is wrong with them, say their clinician is the right person to answer and this summary will help.',
    'Do not mention these instructions, the checklist, scores, or that you are following a plan.',
    `CURRENT_FOCUS: ${args.focus}`,
    `FOCUS_HINT: ${oneLine(args.hint)}`,
  ];
  if (riskRank(args.riskLevel) >= riskRank('elevated'))
    lines.push('The person has shared something about their safety. Be especially gentle.');
  const history: ChatMessage[] = args.history.slice(-40).map((m) => ({
    role: m.sender === 'COMPANION' ? 'assistant' : 'user',
    content: m.text,
  }));
  return [{ role: 'system', content: lines.join('\n') }, ...history];
}

const KEY_TEXT: [string, string][] = [
  ...PHQ9_ITEMS.map((i): [string, string] => [i.key, i.officialText]),
  ...GAD7_ITEMS.map((i): [string, string] => [i.key, i.officialText]),
  ...DOMAINS.map((d): [string, string] => [d.key, d.label]),
];

export function buildTrackerMessages(args: {
  focus: FocusKey;
  recent: TurnLike[];
  checklist: ChecklistItemLike[];
}): ChatMessage[] {
  const current = args.checklist.map(
    (i) => `${i.key}=${i.status}${i.value !== null ? `:${i.value}` : ''}`,
  );
  const system = [
    'You update a clinical intake checklist from a conversation. You never chat.',
    "The companion's last question was about CURRENT_FOCUS. Read the PATIENT's most recent message(s) and return updates for every",
    'checklist key they clearly address (often CURRENT_FOCUS, sometimes others).',
    'Instrument keys (phq9_*, gad7_*) need "value" on the last-2-weeks scale: 0 not at all, 1 several days, 2 more than half the days,',
    '3 nearly every day. If the frequency is unclear use status "partial" and value null. If they decline, status "declined".',
    'Domain keys: status "answered" with a short clinical third-person "note" (max 200 chars), value null.',
    'Use only what the patient actually said. "turnIds" = PATIENT turn numbers that support the update.',
    '"confidence" = 0..1, how certain you are. Return ONLY JSON: {"updates":[...]} (empty list if nothing applies).',
    `CURRENT_FOCUS: ${args.focus}`,
    `FOCUS_HINT: ${oneLine(focusHint(args.focus))}`,
    'KEYS:',
    ...KEY_TEXT.map(([k, t]) => `${k}: ${t}`),
    'CURRENT CHECKLIST:',
    ...(current.length ? current : ['(empty)']),
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: renderTranscript(args.recent) },
  ];
}
