import { describe, expect, it } from 'vitest';
import {
  DOMAIN_KEYS,
  ReportContentSchema,
  SUMMARY_SECTIONS,
  type ChecklistItemLike,
  type EvidenceItem,
  type SummarySection,
} from '@pvc/shared';
import { assembleReport, buildRiskFlags, type AssembleInput } from './assemble';

const summary = Object.fromEntries(SUMMARY_SECTIONS.map((s) => [s, []])) as unknown as Record<
  SummarySection,
  EvidenceItem[]
>;
const dom = (
  key: ChecklistItemLike['key'],
  status: ChecklistItemLike['status'],
): ChecklistItemLike => ({
  key,
  status,
  value: null,
  confidence: 0.9,
  turnIds: [2],
  source: 'tracker',
});
const phq = (n: number, value: 0 | 1 | 2 | 3): ChecklistItemLike => ({
  key: `phq9_${n}` as ChecklistItemLike['key'],
  status: 'answered',
  value,
  confidence: 1,
  turnIds: [2],
  source: 'patient_tap',
});

const base = (o: Partial<AssembleInput> = {}): AssembleInput => ({
  sessionId: 's1',
  displayName: 'Sam R.',
  startedAt: new Date('2026-11-11T18:00:00Z'),
  endedAt: new Date('2026-11-11T18:20:00Z'),
  riskLevel: 'none',
  checklist: [],
  safetyEvents: [],
  priorities: [],
  summary,
  quotes: [],
  writerNotDiscussed: [],
  writerModel: 'w',
  verifierModel: 'v',
  now: new Date('2026-11-11T18:21:00Z'),
  verification: { claimsChecked: 0, claimsRemoved: 0, quotesRemoved: 0, regenerated: false },
  ...o,
});

describe('buildRiskFlags', () => {
  it('should dedupe by category+turn keeping the highest level and sort by level then turn', () => {
    const flags = buildRiskFlags([
      { turnId: 5, level: 'concern', categories: ['self_harm'], evidence: 'a', source: 'keyword' },
      {
        turnId: 3,
        level: 'elevated',
        categories: ['suicidal_ideation', 'self_harm'],
        evidence: 'b',
        source: 'model',
      },
      {
        turnId: 3,
        level: 'imminent',
        categories: ['suicidal_ideation'],
        evidence: 'c',
        source: 'keyword',
      },
      { turnId: 7, level: 'concern', categories: ['abuse'], evidence: '', source: 'instrument' },
    ]);
    expect(flags.map((f) => [f.category, f.turnId, f.level, f.source])).toEqual([
      ['suicidal_ideation', 3, 'imminent', 'keyword'],
      ['self_harm', 3, 'elevated', 'model'],
      ['self_harm', 5, 'concern', 'keyword'],
      ['abuse', 7, 'concern', 'instrument'],
    ]);
  });
});

describe('assembleReport', () => {
  it('should score instruments with scoreInstrument and pass the schema', () => {
    const c = assembleReport(base({ checklist: [phq(1, 3), phq(2, 2)] }));
    expect(ReportContentSchema.safeParse(c).success).toBe(true);
    expect(c.screening.phq9.partialSum).toBe(5);
    expect(c.screening.phq9.total).toBeNull();
    expect(c.screening.gad7.answeredCount).toBe(0);
  });

  it('should compute notDiscussed and declinedTopics', () => {
    const c = assembleReport(
      base({
        checklist: [
          dom('mood_anxiety', 'answered'),
          dom('substance_use', 'declined'),
          dom('history', 'partial'),
        ],
        writerNotDiscussed: ['mood_anxiety', 'supports'],
      }),
    );
    expect(c.declinedTopics).toEqual(['substance_use']);
    expect(c.notDiscussed).not.toContain('mood_anxiety');
    expect(c.notDiscussed).not.toContain('substance_use');
    expect(c.notDiscussed).toContain('history');
    expect(c.notDiscussed).toContain('supports');
    expect(c.notDiscussed).toEqual(DOMAIN_KEYS.filter((k) => c.notDiscussed.includes(k)));
  });

  it('should have a duration of at least 1 minute and carry provenance and risk level', () => {
    const c = assembleReport(
      base({ endedAt: new Date('2026-11-11T18:00:05Z'), riskLevel: 'elevated' }),
    );
    expect(c.session.durationMinutes).toBe(1);
    expect(c.risk.level).toBe('elevated');
    expect(c.provenance).toMatchObject({ aiGenerated: true, writerModel: 'w', verifierModel: 'v' });
    expect(base().endedAt).toBeDefined();
    expect(assembleReport(base()).session.durationMinutes).toBe(20);
  });
});
