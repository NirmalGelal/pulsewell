import { describe, expect, it } from 'vitest';
import { buildEvidenceItem, buildReportContent, type Sender } from '@pvc/shared';
import { computeRedactedTurns, toClinicianContent } from './redaction';

const messages = [1, 2, 3, 4, 5, 6].map((turnId) => ({
  turnId,
  sender: (turnId % 2 === 1 ? 'COMPANION' : 'PATIENT') as Sender,
}));

describe('computeRedactedTurns', () => {
  it('should redact turns cited only by removed items and quotes', () => {
    const c = buildReportContent({
      priorities: [buildEvidenceItem({ id: 'priorities-1', turnIds: [2], removedByPatient: true })],
      summary: {
        presentConcern: [],
        history: [buildEvidenceItem({ id: 'history-1', turnIds: [4] })],
      },
      quotes: [{ id: 'quote-1', text: 'x', turnId: 6, removedByPatient: true }],
    });
    expect(computeRedactedTurns(c, messages, [])).toEqual([2, 6]);
  });

  it('should not redact a turn also cited by a kept item or quote', () => {
    const c = buildReportContent({
      priorities: [
        buildEvidenceItem({ id: 'priorities-1', turnIds: [2, 4], removedByPatient: true }),
      ],
      summary: {
        presentConcern: [],
        history: [buildEvidenceItem({ id: 'history-1', turnIds: [2] })],
      },
      quotes: [{ id: 'quote-1', text: 'x', turnId: 4 }],
    });
    expect(computeRedactedTurns(c, messages, [])).toEqual([]);
  });

  it('should never redact a turn with a safety event or a companion turn', () => {
    const c = buildReportContent({
      priorities: [
        buildEvidenceItem({ id: 'priorities-1', turnIds: [2, 4, 3], removedByPatient: true }),
      ],
    });
    expect(computeRedactedTurns(c, messages, [2])).toEqual([4]);
  });
});

describe('toClinicianContent', () => {
  it('should strip only removed items and quotes', () => {
    const c = buildReportContent({
      priorities: [
        buildEvidenceItem({
          id: 'priorities-1',
          removedByPatient: true,
          patientCorrection: 'mine',
          turnIds: [2],
        }),
        buildEvidenceItem({ id: 'priorities-2', turnIds: [4] }),
      ],
      quotes: [
        { id: 'quote-1', text: 'secret', turnId: 2, removedByPatient: true },
        { id: 'quote-2', text: 'shown', turnId: 4 },
      ],
    });
    const out = toClinicianContent(c);
    expect(out.priorities[0]).toMatchObject({
      id: 'priorities-1',
      text: '',
      patientText: '',
      patientCorrection: '',
      turnIds: [],
      removedByPatient: true,
    });
    expect(out.priorities[1]).toEqual(c.priorities[1]);
    expect(out.quotes[0]!.text).toBe('');
    expect(out.quotes[1]!.text).toBe('shown');
    expect(out.screening).toEqual(c.screening);
    expect(c.priorities[0]!.text).not.toBe('');
  });
});
