import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, clinicianUser } from '@/test/handlers';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';
import { clinicianReport, queueItem } from './fixtures';

function setup() {
  server.use(
    http.get(`${API}/api/clinician/alerts`, () => HttpResponse.json({ alerts: [] })),
    http.get(`${API}/api/clinician/queue`, () =>
      HttpResponse.json({
        items: [
          queueItem({ reportId: 'r0', sessionId: 's0', approvedAt: '2026-10-01T00:00:00.000Z' }),
          queueItem({ reportId: 'r1', sessionId: 's1', approvedAt: '2026-11-11T00:00:00.000Z' }),
        ],
      }),
    ),
    http.get(`${API}/api/clinician/reports/r1`, () => HttpResponse.json(clinicianReport())),
  );
  return renderApp('/clinician/reports/r1', clinicianUser);
}

async function ask() {
  await userEvent.click(await screen.findByRole('tab', { name: 'Ask' }));
  await userEvent.type(screen.getByLabelText(/Ask about this patient/), 'How has sleep changed?');
  await userEvent.click(screen.getByRole('button', { name: 'Ask' }));
}

describe('Ask', () => {
  it('should render the answer with reference chips', async () => {
    setup();
    server.use(
      http.post(`${API}/api/clinician/patients/p1/ask`, () =>
        HttpResponse.json({
          answer: 'Sleep was poor [S1:T2] and is now about four hours [S2:T4].',
          citations: [],
          model: 'mock-assistant',
        }),
      ),
    );
    await ask();
    expect(await screen.findByText(/Sleep was poor/)).toBeInTheDocument();
    expect(screen.getByText('Answers come only from approved records.')).toBeInTheDocument();
    // S2 is the current session -> jump chip; S1 is an earlier report -> link
    expect(
      await screen.findByRole('link', { name: /Open earlier report, turn 2/ }),
    ).toHaveAttribute('href', '/clinician/reports/r0');
    await userEvent.click(screen.getAllByRole('button', { name: 'Show turn 4 in transcript' })[0]!);
    expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('should show a retry message on 503', async () => {
    setup();
    server.use(
      http.post(`${API}/api/clinician/patients/p1/ask`, () =>
        HttpResponse.json({ error: { code: 'LLM_UNAVAILABLE', message: 'x' } }, { status: 503 }),
      ),
    );
    await ask();
    expect(await screen.findByText(/assistant is unavailable.*try again/i)).toBeInTheDocument();
  });
});
