import {
  EDITABLE_SECTIONS,
  ReportContentSchema,
  SUMMARY_SECTIONS,
  type EvidenceItem,
  type ReportContent,
  type ReportEditInput,
  type SummarySection,
} from '@pvc/shared';
import { badRequest } from '../../lib/errors';

export interface AppliedEdit {
  kind: ReportEditInput['kind'];
  section: ReportEditInput['section'];
  itemId: string | null;
  originalText: string | null;
  newText: string | null;
}

const isEditable = (s: string): boolean => (EDITABLE_SECTIONS as readonly string[]).includes(s);

/** Pure: applies edits in order on a copy. Throws a 400 AppError on the first invalid edit. */
export function applyEdits(
  content: ReportContent,
  edits: ReportEditInput[],
  now: Date,
): { content: ReportContent; applied: AppliedEdit[] } {
  const next = structuredClone(content);
  const applied: AppliedEdit[] = [];
  for (const edit of edits) {
    if (edit.kind === 'annotate') {
      next.patientAnnotations.push({
        id: `ann-${next.patientAnnotations.length + 1}`,
        section: edit.section,
        text: edit.text,
        createdAt: now.toISOString(),
      });
      applied.push({
        kind: 'annotate',
        section: edit.section,
        itemId: null,
        originalText: null,
        newText: edit.text,
      });
      continue;
    }
    if (!isEditable(edit.section))
      throw badRequest(`Section "${edit.section}" can only be annotated`);
    if (edit.section === 'quotes') {
      if (edit.kind === 'correct') throw badRequest('Quotes are verbatim and cannot be corrected');
      const q = next.quotes.find((x) => x.id === edit.itemId);
      if (!q) throw badRequest(`Unknown item "${edit.itemId}"`);
      q.removedByPatient = true;
      applied.push({
        kind: 'remove',
        section: 'quotes',
        itemId: q.id,
        originalText: q.text,
        newText: null,
      });
      continue;
    }
    const list: EvidenceItem[] =
      edit.section === 'priorities'
        ? next.priorities
        : next.summary[edit.section as SummarySection];
    if (
      edit.section !== 'priorities' &&
      !(SUMMARY_SECTIONS as readonly string[]).includes(edit.section)
    )
      throw badRequest(`Unknown section "${edit.section}"`);
    const item = list.find((x) => x.id === edit.itemId);
    if (!item) throw badRequest(`Unknown item "${edit.itemId}"`);
    if (edit.kind === 'correct') {
      item.patientCorrection = edit.text;
      applied.push({
        kind: 'correct',
        section: edit.section,
        itemId: item.id,
        originalText: item.patientText,
        newText: edit.text,
      });
    } else {
      item.removedByPatient = true;
      applied.push({
        kind: 'remove',
        section: edit.section,
        itemId: item.id,
        originalText: item.patientText,
        newText: null,
      });
    }
  }
  return { content: ReportContentSchema.parse(next), applied };
}
