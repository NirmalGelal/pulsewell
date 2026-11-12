import {
  GAD7_KEYS,
  PHQ9_KEYS,
  SUMMARY_SECTIONS,
  type InstrumentItemKey,
  type SummarySection,
} from './keys';
import { scoreInstrument, type ChecklistItemLike } from './instruments/scoring';
import type { EvidenceItem, InstrumentResult, ReportContent } from './schemas/report';

export type DeepPartial<T> = T extends (infer U)[]
  ? U[]
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

export function buildEvidenceItem(o: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    id: 'presentConcern-1',
    text: 'Reports low mood since August.',
    patientText: 'You said your mood has been low since August.',
    turnIds: [2],
    ...o,
  };
}

export function buildInstrumentResult(
  kind: 'phq9' | 'gad7',
  values?: (0 | 1 | 2 | 3 | null)[],
): InstrumentResult {
  const keys: readonly InstrumentItemKey[] = kind === 'phq9' ? PHQ9_KEYS : GAD7_KEYS;
  const checklist: ChecklistItemLike[] = [];
  keys.forEach((key, i) => {
    const value = values?.[i] ?? null;
    if (value !== null) {
      checklist.push({
        key,
        status: 'answered',
        value,
        confidence: 1,
        source: 'patient_tap',
        turnIds: [1],
      });
    }
  });
  return scoreInstrument(kind, checklist);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, over: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = v === undefined ? out[k] : deepMerge(out[k], v);
  }
  return out as T;
}

export function buildReportContent(o: DeepPartial<ReportContent> = {}): ReportContent {
  const summary = Object.fromEntries(SUMMARY_SECTIONS.map((s) => [s, []])) as unknown as Record<
    SummarySection,
    EvidenceItem[]
  >;
  summary.presentConcern = [buildEvidenceItem()];
  const base: ReportContent = {
    schemaVersion: 1,
    patient: { displayName: 'Demo Patient' },
    session: {
      id: 'session-1',
      startedAt: '2026-11-11T18:00:00.000Z',
      endedAt: '2026-11-11T18:20:00.000Z',
      durationMinutes: 20,
    },
    risk: { level: 'none', flags: [] },
    priorities: [
      buildEvidenceItem({
        id: 'priorities-1',
        text: 'Wants help improving sleep.',
        patientText: 'You want help with your sleep.',
        turnIds: [4],
      }),
    ],
    screening: { phq9: buildInstrumentResult('phq9'), gad7: buildInstrumentResult('gad7') },
    summary,
    quotes: [{ id: 'quote-1', text: 'I just feel tired all the time', turnId: 2 }],
    notDiscussed: [],
    declinedTopics: [],
    patientAnnotations: [],
    provenance: {
      aiGenerated: true,
      writerModel: 'mock-writer',
      verifierModel: 'mock-verifier',
      generatedAt: '2026-11-11T18:21:00.000Z',
      verification: { claimsChecked: 0, claimsRemoved: 0, quotesRemoved: 0, regenerated: false },
    },
  };
  return deepMerge(base, o);
}
