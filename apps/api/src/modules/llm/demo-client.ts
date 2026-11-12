import type { ZodType, ZodTypeDef } from 'zod';
import {
  DOMAIN_KEYS,
  INSTRUMENT_ITEM_KEYS,
  type AssistantOutput,
  type LlmRole,
  type SafetyClassifierOutput,
  type SummarySection,
  type TrackerOutput,
  type VerifierOutput,
  type WriterOutput,
} from '@pvc/shared';
import type { LlmCallOptions, LlmClient, LlmJsonResult, LlmTextResult } from './types';

const ACKS = [
  'Thank you for sharing that.',
  'That sounds really hard.',
  'I appreciate you telling me.',
  'Okay, I hear you.',
];
const WRAP_UP =
  "Thank you. I have what I need to prepare your summary. When you're ready, press Finish.";

interface Turn {
  turnId: number;
  sender: 'PATIENT' | 'COMPANION';
  text: string;
}

const allText = (opts: LlmCallOptions) => opts.messages.map((m) => m.content).join('\n');

function marker(opts: LlmCallOptions, name: string): string {
  const m = allText(opts).match(new RegExp(`^${name}:[ \\t]*(.*)$`, 'm'));
  return m ? m[1]!.trim() : '';
}

function parseTurns(opts: LlmCallOptions): Turn[] {
  const turns: Turn[] = [];
  const re = /^\[T(\d+)\] (PATIENT|COMPANION): (.*)$/gm;
  const text = allText(opts);
  const start = text.indexOf('TRANSCRIPT:');
  for (const m of (start === -1 ? text : text.slice(start)).matchAll(re)) {
    turns.push({ turnId: Number(m[1]), sender: m[2] as Turn['sender'], text: m[3]! });
  }
  return turns;
}

const VALUE_PHRASES: [0 | 1 | 2 | 3, string[]][] = [
  [3, ['nearly every day', 'every day', 'all the time', 'always']],
  [2, ['more than half', 'often', 'most days', 'a lot']],
  [1, ['several days', 'sometimes', 'a few', 'a little']],
  [0, ['not at all', 'never', 'no']],
];

function phraseValue(text: string): 0 | 1 | 2 | 3 | null {
  const t = text.toLowerCase();
  for (const [value, phrases] of VALUE_PHRASES) {
    if (phrases.some((p) => new RegExp(`\\b${p}\\b`).test(t))) return value;
  }
  return null;
}

const first120 = (s: string) => s.slice(0, 120);

function interviewerText(opts: LlmCallOptions): string {
  const focus = marker(opts, 'CURRENT_FOCUS');
  if (focus === 'wrap_up') return WRAP_UP;
  const hint = marker(opts, 'FOCUS_HINT');
  const patientTurns = parseTurns(opts).filter((t) => t.sender === 'PATIENT').length;
  const turnCount =
    patientTurns || opts.messages.filter((m) => m.role === 'user' || m.role === 'assistant').length;
  const ack = ACKS[turnCount % ACKS.length]!;
  return hint ? `${ack} ${hint}` : ack;
}

function trackerOutput(opts: LlmCallOptions): TrackerOutput {
  const focus = marker(opts, 'CURRENT_FOCUS');
  const last = parseTurns(opts)
    .filter((t) => t.sender === 'PATIENT')
    .at(-1);
  if (!last) return { updates: [] };
  if ((INSTRUMENT_ITEM_KEYS as readonly string[]).includes(focus)) {
    const value = phraseValue(last.text);
    return {
      updates: [
        {
          key: focus as TrackerOutput['updates'][number]['key'],
          status: value === null ? 'partial' : 'answered',
          value,
          confidence: value === null ? 0.4 : 0.9,
          note: null,
          turnIds: [last.turnId],
        },
      ],
    };
  }
  const domain = focus === 'open_story' ? 'chief_concern' : focus;
  if ((DOMAIN_KEYS as readonly string[]).includes(domain)) {
    return {
      updates: [
        {
          key: domain as TrackerOutput['updates'][number]['key'],
          status: 'answered',
          value: null,
          confidence: 0.8,
          note: first120(last.text),
          turnIds: [last.turnId],
        },
      ],
    };
  }
  return { updates: [] };
}

function writerOutput(opts: LlmCallOptions): WriterOutput {
  const turns = parseTurns(opts);
  const patient = turns.filter((t) => t.sender === 'PATIENT' && t.turnId > 1);
  const item = (t: Turn) => ({
    text: first120(t.text),
    patientText: `You said: ${t.text}`,
    turnIds: [t.turnId],
  });
  const summary: Partial<Record<SummarySection, ReturnType<typeof item>[]>> = {};
  if (patient[0]) summary.chiefConcern = [item(patient[0])];
  if (patient[1]) summary.presentConcern = [item(patient[1])];
  const priorities = turns
    .map((t, i) => ({ t, prev: turns[i - 1] }))
    .filter(
      ({ t, prev }) =>
        t.sender === 'PATIENT' && prev?.sender === 'COMPANION' && /most|priority/i.test(prev.text),
    )
    .slice(0, 3)
    .map(({ t }) => item(t));
  const quotes = turns
    .filter((t) => t.sender === 'PATIENT')
    .sort((a, b) => b.text.length - a.text.length)
    .slice(0, 3)
    .map((t) => {
      const sentence = t.text.match(/^.*?[.!?](?=\s|$)/)?.[0] ?? t.text;
      return { text: sentence, turnId: t.turnId };
    });
  return {
    priorities,
    summary: summary as WriterOutput['summary'],
    quotes,
    notDiscussed: [],
  };
}

function assistantOutput(opts: LlmCallOptions): AssistantOutput {
  const m = allText(opts).match(/^\[(S\d+:T\d+)\] PATIENT:/m);
  return {
    answer: 'Demo mode: no model connected. The most relevant passage is cited.',
    citations: m ? [{ ref: m[1]! }] : [],
  };
}

/** Deterministic, network-free client for building and demoing the app. */
export class DemoLlmClient implements LlmClient {
  readonly mode = 'demo' as const;

  private produce(role: LlmRole, opts: LlmCallOptions): string | object {
    switch (role) {
      case 'interviewer':
        return interviewerText(opts);
      case 'safety':
        return { level: 'none', categories: [], evidence: '' } satisfies SafetyClassifierOutput;
      case 'tracker':
        return trackerOutput(opts);
      case 'reportWriter':
        return writerOutput(opts);
      case 'verifier':
        return { unsupported: [] } satisfies VerifierOutput;
      case 'assistant':
        return assistantOutput(opts);
      case 'stt':
        return { text: 'I have been feeling really tired and down lately.' };
    }
  }

  async complete(role: LlmRole, opts: LlmCallOptions): Promise<LlmTextResult> {
    const v = this.produce(role, opts);
    return { text: typeof v === 'string' ? v : JSON.stringify(v), model: `demo-${role}` };
  }

  async completeJson<T>(
    role: LlmRole,
    opts: LlmCallOptions & { schema: ZodType<T, ZodTypeDef, unknown> },
  ): Promise<LlmJsonResult<T>> {
    const v = this.produce(role, opts);
    const data = opts.schema.parse(typeof v === 'string' ? JSON.parse(v) : v);
    return { data, model: `demo-${role}` };
  }

  stream(
    role: LlmRole,
    opts: LlmCallOptions,
  ): AsyncIterable<string> & { result: Promise<LlmTextResult> } {
    const v = this.produce(role, opts);
    const text = typeof v === 'string' ? v : JSON.stringify(v);
    const words = text.match(/\S+\s*/g) ?? [];
    const result = Promise.resolve({ text, model: `demo-${role}` });
    const gen = (async function* () {
      for (const w of words) yield w;
    })();
    return Object.assign(gen as AsyncIterable<string>, { result });
  }

  async transcribe(): Promise<LlmTextResult> {
    return { text: 'I have been feeling really tired and down lately.', model: 'demo-stt' };
  }
}
