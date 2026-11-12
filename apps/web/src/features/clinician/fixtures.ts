import {
  buildEvidenceItem,
  buildInstrumentResult,
  buildReportContent,
  type AlertDto,
  type ClinicianReportDto,
  type QueueItemDto,
} from '@pvc/shared';

export function queueItem(o: Partial<QueueItemDto> = {}): QueueItemDto {
  return {
    reportId: 'r1',
    sessionId: 's1',
    patient: { id: 'p1', displayName: 'Sam R.' },
    approvedAt: new Date(Date.now() - 3 * 3600_000).toISOString(),
    riskLevel: 'none',
    reviewed: false,
    phq9: { total: 12, band: 'moderate' },
    gad7: { total: 9, band: 'mild' },
    topPriority: 'Wants help sleeping.',
    trend: null,
    hasUnacknowledgedAlert: false,
    ...o,
  };
}

export function alertDto(o: Partial<AlertDto> = {}): AlertDto {
  return {
    id: 'a1',
    sessionId: 's9',
    patient: { id: 'p3', displayName: 'Riley K.' },
    level: 'imminent',
    evidence: "I'm going to end it tonight",
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    acknowledgedAt: null,
    ...o,
  };
}

export function clinicianReport(
  over: Parameters<typeof buildReportContent>[0] = {},
  dto: Partial<ClinicianReportDto> = {},
): ClinicianReportDto {
  const content = buildReportContent({
    patient: { displayName: 'Sam R.' },
    session: { id: 's1' },
    ...over,
  });
  return {
    reportId: 'r1',
    status: 'APPROVED',
    approvedAt: '2026-11-11T19:00:00.000Z',
    reviewedAt: null,
    patient: { id: 'p1', displayName: 'Sam R.' },
    session: {
      id: 's1',
      state: 'SUBMITTED',
      riskLevel: 'none',
      startedAt: '2026-11-11T18:00:00.000Z',
      endedAt: '2026-11-11T18:20:00.000Z',
    },
    content,
    transcript: [
      turn(1, 'COMPANION', 'Hi, what brings you in?'),
      turn(2, 'PATIENT', 'I just feel tired all the time'),
      turn(3, 'COMPANION', 'How is sleep?'),
      turn(4, 'PATIENT', 'I sleep about four hours a night.'),
    ],
    notes: [],
    history: [],
    ...dto,
  };
}

export function turn(
  turnId: number,
  sender: 'PATIENT' | 'COMPANION',
  text: string | null,
  extra: { redacted?: boolean; hasSafetyEvent?: boolean } = {},
) {
  return {
    turnId,
    sender,
    text,
    redacted: extra.redacted ?? false,
    inputMode: 'TEXT' as const,
    createdAt: '2026-11-11T18:01:00.000Z',
    hasSafetyEvent: extra.hasSafetyEvent ?? false,
  };
}

export { buildEvidenceItem, buildInstrumentResult };
