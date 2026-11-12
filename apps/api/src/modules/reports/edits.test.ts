import { describe, expect, it } from 'vitest';
import { EditReportRequestSchema, buildEvidenceItem, buildReportContent } from '@pvc/shared';
import { applyEdits } from './edits';

const now = new Date('2026-11-11T19:00:00Z');
const content = () =>
  buildReportContent({
    quotes: [{ id: 'quote-1', text: 'I feel low.', turnId: 2 }],
    summary: { moodAnxiety: [buildEvidenceItem({ id: 'moodAnxiety-1' })] },
  });

describe('applyEdits', () => {
  it('should correct a summary item and keep the AI text', () => {
    const c = content();
    const r = applyEdits(
      c,
      [
        {
          kind: 'correct',
          section: 'moodAnxiety',
          itemId: 'moodAnxiety-1',
          text: 'Actually since July.',
        },
      ],
      now,
    );
    const item = r.content.summary.moodAnxiety[0]!;
    expect(item.patientCorrection).toBe('Actually since July.');
    expect(item.text).toBe(c.summary.moodAnxiety[0]!.text);
    expect(r.applied[0]).toMatchObject({
      originalText: item.patientText,
      newText: 'Actually since July.',
    });
    expect(c.summary.moodAnxiety[0]!.patientCorrection).toBeUndefined();
  });

  it('should correct and remove priorities', () => {
    const r = applyEdits(
      content(),
      [
        { kind: 'correct', section: 'priorities', itemId: 'priorities-1', text: 'Sleep.' },
        { kind: 'remove', section: 'priorities', itemId: 'priorities-1' },
      ],
      now,
    );
    expect(r.content.priorities[0]).toMatchObject({
      patientCorrection: 'Sleep.',
      removedByPatient: true,
    });
  });

  it('should remove a quote but refuse to correct one', () => {
    const r = applyEdits(
      content(),
      [{ kind: 'remove', section: 'quotes', itemId: 'quote-1' }],
      now,
    );
    expect(r.content.quotes[0]!.removedByPatient).toBe(true);
    expect(() =>
      applyEdits(
        content(),
        [{ kind: 'correct', section: 'quotes', itemId: 'quote-1', text: 'x' }],
        now,
      ),
    ).toThrow();
  });

  it('should annotate any section with sequential ids', () => {
    const r = applyEdits(
      content(),
      [
        { kind: 'annotate', section: 'risk', text: 'Context for this.' },
        { kind: 'annotate', section: 'screening', text: 'Second.' },
      ],
      now,
    );
    expect(r.content.patientAnnotations.map((a) => a.id)).toEqual(['ann-1', 'ann-2']);
    expect(r.content.patientAnnotations[0]).toMatchObject({
      section: 'risk',
      createdAt: now.toISOString(),
    });
    const r2 = applyEdits(
      r.content,
      [{ kind: 'annotate', section: 'history', text: 'Third' }],
      now,
    );
    expect(r2.content.patientAnnotations[2]!.id).toBe('ann-3');
  });

  it('should reject remove/correct on risk or screening (schema and function)', () => {
    expect(
      EditReportRequestSchema.safeParse({
        edits: [{ kind: 'remove', section: 'risk', itemId: 'x' }],
      }).success,
    ).toBe(false);
    expect(() =>
      applyEdits(content(), [{ kind: 'remove', section: 'risk', itemId: 'x' } as never], now),
    ).toThrow();
  });

  it('should reject unknown item ids', () => {
    expect(() =>
      applyEdits(content(), [{ kind: 'remove', section: 'history', itemId: 'history-9' }], now),
    ).toThrow(/Unknown item/);
  });
});
