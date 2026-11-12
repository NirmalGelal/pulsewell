import {
  DOMAIN_KEYS,
  ReportContentSchema,
  isCovered,
  riskRank,
  scoreInstrument,
  type ChecklistItemLike,
  type DomainKey,
  type EvidenceItem,
  type Quote,
  type ReportContent,
  type RiskCategory,
  type RiskFlag,
  type RiskLevel,
  type SafetySource,
  type SummarySection,
} from '@pvc/shared';

export interface SafetyEventLike {
  turnId: number;
  level: RiskLevel;
  categories: RiskCategory[];
  evidence: string;
  source: SafetySource;
}

export function buildRiskFlags(events: SafetyEventLike[]): RiskFlag[] {
  const best = new Map<string, RiskFlag>();
  for (const e of events) {
    for (const category of e.categories) {
      const key = `${category}:${e.turnId}`;
      const cur = best.get(key);
      if (!cur || riskRank(e.level) > riskRank(cur.level)) {
        best.set(key, {
          category,
          level: e.level,
          evidence: e.evidence,
          turnId: e.turnId,
          source: e.source,
        });
      }
    }
  }
  return [...best.values()].sort(
    (a, b) => riskRank(b.level) - riskRank(a.level) || a.turnId - b.turnId,
  );
}

export interface AssembleInput {
  sessionId: string;
  displayName: string;
  startedAt: Date;
  endedAt: Date;
  riskLevel: RiskLevel;
  checklist: ChecklistItemLike[];
  safetyEvents: SafetyEventLike[];
  priorities: EvidenceItem[];
  summary: Record<SummarySection, EvidenceItem[]>;
  quotes: Quote[];
  writerNotDiscussed: DomainKey[];
  writerModel: string;
  verifierModel: string | null;
  now: Date;
  verification: {
    claimsChecked: number;
    claimsRemoved: number;
    quotesRemoved: number;
    regenerated: boolean;
  };
}

export function assembleReport(input: AssembleInput): ReportContent {
  const byKey = new Map(input.checklist.map((i) => [i.key as string, i]));
  const declinedTopics = DOMAIN_KEYS.filter((k) => byKey.get(k)?.status === 'declined');
  const covered = new Set<DomainKey>(
    DOMAIN_KEYS.filter((k) => {
      const it = byKey.get(k);
      return !!it && isCovered(it);
    }),
  );
  const declined = new Set<DomainKey>(declinedTopics);
  const writerSet = new Set(input.writerNotDiscussed);
  // (not covered ∪ writer's list) − covered − declined, in DOMAIN_KEYS order.
  const union = new Set<DomainKey>([...DOMAIN_KEYS.filter((k) => !covered.has(k)), ...writerSet]);
  const notDiscussed = DOMAIN_KEYS.filter(
    (k) => union.has(k) && !covered.has(k) && !declined.has(k),
  );
  const minutes = Math.max(
    1,
    Math.round((input.endedAt.getTime() - input.startedAt.getTime()) / 60000),
  );
  return ReportContentSchema.parse({
    schemaVersion: 1,
    patient: { displayName: input.displayName },
    session: {
      id: input.sessionId,
      startedAt: input.startedAt.toISOString(),
      endedAt: input.endedAt.toISOString(),
      durationMinutes: minutes,
    },
    risk: { level: input.riskLevel, flags: buildRiskFlags(input.safetyEvents) },
    priorities: input.priorities,
    screening: {
      phq9: scoreInstrument('phq9', input.checklist),
      gad7: scoreInstrument('gad7', input.checklist),
    },
    summary: input.summary,
    quotes: input.quotes,
    notDiscussed,
    declinedTopics,
    patientAnnotations: [],
    provenance: {
      aiGenerated: true,
      writerModel: input.writerModel,
      verifierModel: input.verifierModel,
      generatedAt: input.now.toISOString(),
      verification: input.verification,
    },
  });
}
