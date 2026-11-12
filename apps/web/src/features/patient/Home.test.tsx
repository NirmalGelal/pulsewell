import { screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import type { SessionState } from '@pvc/shared';
import { API } from '@/test/handlers';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const summary = (
  id: string,
  state: SessionState,
  reportStatus: 'DRAFT' | 'APPROVED' | null = null,
) => ({
  id,
  state,
  riskLevel: 'none',
  startedAt: '2026-11-01T18:00:00.000Z',
  endedAt: null,
  reportStatus,
});
const withSessions = (sessions: ReturnType<typeof summary>[]) =>
  server.use(http.get(`${API}/api/sessions`, () => HttpResponse.json({ sessions })));

describe('Home', () => {
  it('should offer to start a conversation when none is active', async () => {
    withSessions([summary('a', 'SUBMITTED', 'APPROVED')]);
    renderApp('/patient');
    const link = await screen.findByRole('link', { name: 'Start a conversation' });
    expect(link).toHaveAttribute('href', '/patient/consent');
  });

  it('should offer to continue an active or paused conversation', async () => {
    withSessions([summary('a', 'CRISIS_PAUSED')]);
    renderApp('/patient');
    const link = await screen.findByRole('link', { name: 'Continue your conversation' });
    expect(link).toHaveAttribute('href', '/patient/session/a');
  });

  it('should show a follow-up card from the clinician', async () => {
    server.use(
      http.get(`${API}/api/patient/follow-ups`, () =>
        HttpResponse.json({
          followUps: [
            {
              id: 'f',
              clinician: { id: 'c', displayName: 'Dr. Lee' },
              questions: ['How is sleep?'],
              status: 'PENDING',
              createdAt: '2026-11-10T10:00:00.000Z',
            },
          ],
        }),
      ),
    );
    renderApp('/patient');
    expect(
      await screen.findByText('Dr. Lee asked a few questions for your next check-in.'),
    ).toBeInTheDocument();
  });

  it('should show friendly status labels and link to the right screen', async () => {
    withSessions([
      summary('1', 'INTERVIEWING'),
      summary('2', 'GENERATING_REPORT'),
      summary('3', 'PATIENT_REVIEW', 'DRAFT'),
      summary('4', 'SUBMITTED', 'APPROVED'),
      summary('5', 'CLINICIAN_REVIEWED', 'APPROVED'),
      summary('6', 'CRISIS_PAUSED'),
    ]);
    renderApp('/patient');
    for (const label of [
      'In progress',
      'Preparing summary',
      'Ready for your review',
      'Sent to your clinician',
      'Reviewed by your clinician',
      'Paused',
    ])
      expect(await screen.findByText(label)).toBeInTheDocument();
    const review = screen.getByText('Ready for your review').closest('a');
    expect(review).toHaveAttribute('href', '/patient/session/3/review');
    expect(screen.getByText('In progress').closest('a')).toHaveAttribute(
      'href',
      '/patient/session/1',
    );
  });
});
