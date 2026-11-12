import { describe, expect, it } from 'vitest';
import {
  AssistantOutputSchema,
  SafetyClassifierOutputSchema,
  TrackerOutputSchema,
  VerifierOutputSchema,
  WriterOutputSchema,
  renderTranscript,
  type LlmRole,
} from '@pvc/shared';
import { z } from 'zod';
import { DemoLlmClient } from './demo-client';

const demo = new DemoLlmClient();
const turns = [
  { turnId: 1, sender: 'COMPANION' as const, text: 'Hi, what brings you in today?' },
  {
    turnId: 2,
    sender: 'PATIENT' as const,
    text: 'I have been exhausted and sad. It started in the spring.',
  },
  { turnId: 3, sender: 'COMPANION' as const, text: 'Thank you. When did it begin?' },
  { turnId: 4, sender: 'PATIENT' as const, text: 'Around March, after I lost my job!' },
  { turnId: 5, sender: 'COMPANION' as const, text: 'What matters most to you right now?' },
  { turnId: 6, sender: 'PATIENT' as const, text: 'Sleeping better and feeling like myself again.' },
];
const sys = (focus: string, hint = 'How has your sleep been?') => ({
  role: 'system' as const,
  content: `You are a companion.\nCURRENT_FOCUS: ${focus}\nFOCUS_HINT: ${hint}\n`,
});
const user = (t: typeof turns) => ({ role: 'user' as const, content: renderTranscript(t) });

describe('DemoLlmClient', () => {
  it('should include the FOCUS_HINT in the interviewer reply and stream word by word', async () => {
    const opts = { messages: [sys('phq9_3', 'How has your sleep been?'), user(turns)] };
    const r = await demo.complete('interviewer', opts);
    expect(r.text).toMatch(/How has your sleep been\?$/);
    const chunks: string[] = [];
    const s = demo.stream('interviewer', opts);
    for await (const c of s) chunks.push(c);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.join('')).toBe(r.text);
    const wrap = await demo.complete('interviewer', { messages: [sys('wrap_up'), user(turns)] });
    expect(wrap.text).toContain('press Finish.');
  });

  it('should map "more than half the days" to value 2 answered for phq9_3; unknown phrase is partial', async () => {
    const mk = (text: string) => ({
      messages: [sys('phq9_3'), user([...turns, { turnId: 8, sender: 'PATIENT' as const, text }])],
      schema: TrackerOutputSchema,
    });
    const a = (await demo.completeJson('tracker', mk('More than half the days, honestly.'))).data;
    expect(a.updates[0]).toMatchObject({
      key: 'phq9_3',
      status: 'answered',
      value: 2,
      confidence: 0.9,
      turnIds: [8],
    });
    const b = (await demo.completeJson('tracker', mk('Hard to say.'))).data;
    expect(b.updates[0]).toMatchObject({ status: 'partial', value: null, confidence: 0.4 });
    const never = (await demo.completeJson('tracker', mk('Not at all'))).data;
    expect(never.updates[0]!.value).toBe(0);
    const dom = (
      await demo.completeJson('tracker', {
        messages: [sys('open_story'), user(turns)],
        schema: TrackerOutputSchema,
      })
    ).data;
    expect(dom.updates[0]).toMatchObject({
      key: 'chief_concern',
      status: 'answered',
      confidence: 0.8,
    });
    const other = (
      await demo.completeJson('tracker', {
        messages: [sys('wrap_up'), user(turns)],
        schema: TrackerOutputSchema,
      })
    ).data;
    expect(other.updates).toEqual([]);
  });

  it('should produce reportWriter output that passes WriterOutputSchema with verbatim quotes', async () => {
    const { data } = await demo.completeJson('reportWriter', {
      messages: [{ role: 'user', content: renderTranscript(turns) }],
      schema: WriterOutputSchema,
    });
    expect(data.summary.chiefConcern?.[0]?.patientText).toMatch(/^You said: /);
    expect(data.summary.presentConcern?.[0]?.turnIds).toEqual([4]);
    expect(data.priorities.map((p) => p.turnIds)).toEqual([[6]]);
    expect(data.quotes.length).toBeGreaterThan(0);
    for (const q of data.quotes) {
      const turn = turns.find((t) => t.turnId === q.turnId)!;
      expect(turn.text.includes(q.text)).toBe(true);
    }
  });

  it('should return schema-valid output for every role', async () => {
    const base = { messages: [sys('phq9_1'), user(turns)] };
    const schemas: Record<LlmRole, z.ZodType> = {
      interviewer: z.object({}).passthrough(),
      safety: SafetyClassifierOutputSchema,
      tracker: TrackerOutputSchema,
      reportWriter: WriterOutputSchema,
      verifier: VerifierOutputSchema,
      assistant: AssistantOutputSchema,
      stt: z.object({ text: z.string().min(1) }),
    };
    for (const role of Object.keys(schemas) as LlmRole[]) {
      if (role === 'interviewer') continue;
      await expect(
        demo.completeJson(role, { ...base, schema: schemas[role]! }),
      ).resolves.toBeDefined();
    }
    const a = await demo.completeJson('assistant', {
      messages: [{ role: 'user', content: 'SESSIONS:\n[S1:T2] PATIENT: I am tired' }],
      schema: AssistantOutputSchema,
    });
    expect(a.data.citations).toEqual([{ ref: 'S1:T2' }]);
    expect((await demo.transcribe()).text).toMatch(/tired/);
  });
});
