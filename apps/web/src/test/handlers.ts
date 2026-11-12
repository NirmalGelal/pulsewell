import { http, HttpResponse } from 'msw';
import {
  buildReportContent,
  type PatientReportDto,
  type SessionDetailDto,
  type UserDto,
} from '@pvc/shared';

export const API = 'http://localhost:4000';

export const patientUser: UserDto = {
  id: 'u-patient',
  email: 'patient@demo.test',
  role: 'PATIENT',
  displayName: 'Sam Rivera',
  mustChangePassword: false,
};
export const clinicianUser: UserDto = {
  id: 'u-clin',
  email: 'clinician@demo.test',
  role: 'CLINICIAN',
  displayName: 'Dr. Jordan Lee',
  mustChangePassword: false,
};

export function sessionDetail(over: Partial<SessionDetailDto> = {}): SessionDetailDto {
  return {
    session: {
      id: 's1',
      state: 'INTERVIEWING',
      riskLevel: 'none',
      startedAt: '2026-11-11T18:00:00.000Z',
      endedAt: null,
    },
    messages: [
      {
        id: 'm1',
        turnId: 1,
        sender: 'COMPANION',
        text: 'Hi, I am here to listen. How have you been?',
        inputMode: 'TEXT',
        createdAt: '2026-11-11T18:00:01.000Z',
      },
    ],
    progress: {
      covered: 0,
      total: 26,
      percent: 0,
      missingRequired: ['chief_concern'],
      canFinish: false,
    },
    pendingItem: null,
    hasReport: false,
    ...over,
  };
}

export function reportDto(
  over: Parameters<typeof buildReportContent>[0] = {},
  status: 'DRAFT' | 'APPROVED' = 'DRAFT',
): PatientReportDto {
  return { reportId: 'r1', status, content: buildReportContent(over) };
}

export const handlers = [
  http.get(`${API}/api/health`, () => HttpResponse.json({ ok: true, llmMode: 'mock' })),
  http.get(`${API}/api/patient/clinicians`, () =>
    HttpResponse.json({ clinicians: [{ id: 'c1', displayName: 'Dr. Jordan Lee' }] }),
  ),
  http.get(`${API}/api/patient/follow-ups`, () => HttpResponse.json({ followUps: [] })),
  http.get(`${API}/api/sessions`, () => HttpResponse.json({ sessions: [] })),
];

export const sseBody = (events: [string, unknown][]) =>
  events.map(([e, d]) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`).join('');

export const sseResponse = (events: [string, unknown][]) =>
  new HttpResponse(sseBody(events), { headers: { 'Content-Type': 'text/event-stream' } });
