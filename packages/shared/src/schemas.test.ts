import { describe, expect, it } from 'vitest';
import {
  AssistantOutputSchema,
  CreateFollowUpRequestSchema,
  CreateSessionRequestSchema,
  InterviewStateSchema,
  MessageStreamEventSchema,
  ReportContentSchema,
  ReportEditInputSchema,
  SSE_EVENT_NAMES,
  SendMessageRequestSchema,
  TrackerOutputSchema,
  WriterOutputSchema,
  CRISIS_RESOURCES,
  buildReportContent,
  renderTranscript,
} from './index';

const message = {
  id: 'm1',
  turnId: 1,
  sender: 'COMPANION',
  text: 'Hi',
  inputMode: 'TEXT',
  createdAt: '2026-11-11T18:00:00.000Z',
};
const session = {
  id: 's1',
  state: 'INTERVIEWING',
  riskLevel: 'none',
  startedAt: '2026-11-11T18:00:00.000Z',
  endedAt: null,
};

describe('report schema', () => {
  it('should accept buildReportContent()', () => {
    expect(ReportContentSchema.safeParse(buildReportContent()).success).toBe(true);
  });
  it('should reject report missing a summary section', () => {
    const r = buildReportContent() as unknown as { summary: Record<string, unknown> };
    delete r.summary.supports;
    expect(ReportContentSchema.safeParse(r).success).toBe(false);
  });
  it('should reject schemaVersion 2', () => {
    expect(
      ReportContentSchema.safeParse({ ...buildReportContent(), schemaVersion: 2 }).success,
    ).toBe(false);
  });
  it('should allow deep overrides in buildReportContent', () => {
    const r = buildReportContent({ risk: { level: 'elevated' } });
    expect(r.risk.level).toBe('elevated');
    expect(r.risk.flags).toEqual([]);
  });
});

describe('request schemas', () => {
  it('should parse each ReportEditInput kind', () => {
    expect(
      ReportEditInputSchema.safeParse({
        kind: 'correct',
        section: 'moodAnxiety',
        itemId: 'a',
        text: 'x',
      }).success,
    ).toBe(true);
    expect(
      ReportEditInputSchema.safeParse({ kind: 'remove', section: 'quotes', itemId: 'a' }).success,
    ).toBe(true);
    expect(
      ReportEditInputSchema.safeParse({ kind: 'annotate', section: 'priorities', text: 'x' })
        .success,
    ).toBe(true);
  });
  it('should reject correct on section risk', () => {
    expect(
      ReportEditInputSchema.safeParse({ kind: 'correct', section: 'risk', itemId: 'a', text: 'x' })
        .success,
    ).toBe(false);
  });
  it('should accept annotate on risk', () => {
    expect(
      ReportEditInputSchema.safeParse({ kind: 'annotate', section: 'risk', text: 'x' }).success,
    ).toBe(true);
  });
  it('should trim and reject whitespace-only SendMessageRequest.text', () => {
    const ok = SendMessageRequestSchema.parse({ text: '  hi  ', inputMode: 'TEXT' });
    expect(ok.text).toBe('hi');
    expect(SendMessageRequestSchema.safeParse({ text: '   ', inputMode: 'TEXT' }).success).toBe(
      false,
    );
  });
  it('should reject text > 4000 chars', () => {
    expect(
      SendMessageRequestSchema.safeParse({ text: 'a'.repeat(4001), inputMode: 'TEXT' }).success,
    ).toBe(false);
  });
  it('should reject answerFor.value = 4', () => {
    expect(
      SendMessageRequestSchema.safeParse({
        text: '4',
        inputMode: 'TAP',
        answerFor: { key: 'phq9_1', value: 4 },
      }).success,
    ).toBe(false);
  });
  it('should reject CreateSessionRequest with accepted false', () => {
    expect(
      CreateSessionRequestSchema.safeParse({ consent: { accepted: false, version: 'v1' } }).success,
    ).toBe(false);
    expect(
      CreateSessionRequestSchema.safeParse({ consent: { accepted: true, version: 'v1' } }).success,
    ).toBe(true);
  });
  it('should reject CreateFollowUpRequest with 0 or 4 questions', () => {
    expect(CreateFollowUpRequestSchema.safeParse({ questions: [] }).success).toBe(false);
    expect(
      CreateFollowUpRequestSchema.safeParse({ questions: ['abc', 'abc', 'abc', 'abc'] }).success,
    ).toBe(false);
    expect(CreateFollowUpRequestSchema.safeParse({ questions: ['abc'] }).success).toBe(true);
  });
});

describe('sse schema', () => {
  const samples = [
    { event: 'patient_message', data: { message } },
    { event: 'safety', data: { level: 'none', categories: [], showResources: false } },
    {
      event: 'crisis',
      data: { level: 'imminent', message: 'Please call', resources: CRISIS_RESOURCES, session },
    },
    { event: 'token', data: { delta: 'Hel' } },
    { event: 'companion_message', data: { message } },
    {
      event: 'done',
      data: {
        progress: {
          covered: 0,
          total: 26,
          percent: 0,
          missingRequired: ['phq9_1'],
          canFinish: false,
        },
        pendingItem: null,
      },
    },
    { event: 'error', data: { code: 'INTERNAL', message: 'x' } },
  ];
  it('should parse a sample of each SSE event', () => {
    expect(samples.map((s) => s.event)).toEqual([...SSE_EVENT_NAMES]);
    for (const s of samples) {
      const r = MessageStreamEventSchema.safeParse(s);
      expect(r.success, s.event).toBe(true);
    }
  });
  it('should reject unknown event name', () => {
    expect(MessageStreamEventSchema.safeParse({ event: 'nope', data: {} }).success).toBe(false);
  });
});

describe('llm schemas', () => {
  it('should default missing WriterOutput.summary sections to []', () => {
    const w = WriterOutputSchema.parse({
      priorities: [],
      summary: { chiefConcern: [{ text: 'a', patientText: 'b', turnIds: [1] }] },
      quotes: [],
      notDiscussed: [],
    });
    expect(w.summary.supports).toEqual([]);
    expect(w.summary.chiefConcern).toHaveLength(1);
    expect(
      WriterOutputSchema.parse({ priorities: [], quotes: [], notDiscussed: [] }).summary.history,
    ).toEqual([]);
  });
  it('should reject TrackerOutput confidence 1.5', () => {
    expect(
      TrackerOutputSchema.safeParse({
        updates: [
          {
            key: 'phq9_1',
            status: 'answered',
            value: 1,
            confidence: 1.5,
            note: null,
            turnIds: [1],
          },
        ],
      }).success,
    ).toBe(false);
  });
  it('should parse InterviewState defaults from {}', () => {
    expect(InterviewStateSchema.parse({})).toEqual({
      lastFocus: null,
      attempts: {},
      askedFollowUps: 0,
      followUpQuestions: [],
      safetyFollowUpDone: false,
    });
  });
  it('should parse AssistantOutput', () => {
    expect(
      AssistantOutputSchema.safeParse({ answer: 'x', citations: [{ ref: 'S1:T2' }] }).success,
    ).toBe(true);
  });
  it('renderTranscript should output TRANSCRIPT: then turn lines, flattening newlines', () => {
    const out = renderTranscript([
      { turnId: 1, sender: 'COMPANION', text: 'Hello' },
      { turnId: 2, sender: 'PATIENT', text: 'line one\nline two' },
    ]);
    expect(out).toBe('TRANSCRIPT:\n[T1] COMPANION: Hello\n[T2] PATIENT: line one line two');
  });
});
