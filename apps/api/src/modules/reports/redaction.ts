import {
  SUMMARY_SECTIONS,
  type EvidenceItem,
  type Quote,
  type ReportContent,
  type Sender,
} from '@pvc/shared';

/** Pure: PATIENT turns cited only by removed items/quotes and carrying no SafetyEvent. */
export function computeRedactedTurns(
  content: ReportContent,
  messages: { turnId: number; sender: Sender }[],
  safetyEventTurnIds: Iterable<number>,
): number[] {
  const kept = new Set<number>();
  const removed = new Set<number>();
  const visit = (turnIds: number[], isRemoved: boolean | undefined) => {
    for (const t of turnIds) (isRemoved ? removed : kept).add(t);
  };
  const items: EvidenceItem[] = [
    ...content.priorities,
    ...SUMMARY_SECTIONS.flatMap((s) => content.summary[s]),
  ];
  for (const i of items) visit(i.turnIds, i.removedByPatient);
  for (const q of content.quotes) visit([q.turnId], q.removedByPatient);
  const safety = new Set(safetyEventTurnIds);
  const patient = new Set(messages.filter((m) => m.sender === 'PATIENT').map((m) => m.turnId));
  return [...removed]
    .filter((t) => patient.has(t) && !kept.has(t) && !safety.has(t))
    .sort((a, b) => a - b);
}

const stripItem = (i: EvidenceItem): EvidenceItem =>
  i.removedByPatient ? { ...i, text: '', patientText: '', patientCorrection: '', turnIds: [] } : i;
const stripQuote = (q: Quote): Quote => (q.removedByPatient ? { ...q, text: '' } : q);

/** Pure (used by M08): blanks the text of items the patient chose not to share. */
export function toClinicianContent(content: ReportContent): ReportContent {
  return {
    ...content,
    priorities: content.priorities.map(stripItem),
    summary: Object.fromEntries(
      SUMMARY_SECTIONS.map((s) => [s, content.summary[s].map(stripItem)]),
    ) as ReportContent['summary'],
    quotes: content.quotes.map(stripQuote),
  };
}
