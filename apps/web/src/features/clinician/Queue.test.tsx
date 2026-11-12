import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, clinicianUser } from '@/test/handlers';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';
import { queueItem } from './fixtures';

const items = [
  queueItem({
    reportId: 'r-alex',
    patient: { id: 'p2', displayName: 'Alex M.' },
    riskLevel: 'elevated',
    phq9: { total: 18, band: 'moderately_severe' },
    gad7: { total: null, band: null },
    topPriority: 'x'.repeat(120),
  }),
  queueItem({
    reportId: 'r-sam',
    trend: { phq9Delta: -4, gad7Delta: 3 },
    hasUnacknowledgedAlert: true,
  }),
  queueItem({ reportId: 'r-old', patient: { id: 'p9', displayName: 'Old R.' }, reviewed: true }),
];

function setup() {
  server.use(
    http.get(`${API}/api/clinician/queue`, () => HttpResponse.json({ items })),
    http.get(`${API}/api/clinician/alerts`, () => HttpResponse.json({ alerts: [] })),
    http.get(`${API}/api/clinician/reports/:id`, () => HttpResponse.json({}, { status: 404 })),
  );
  return renderApp('/clinician', clinicianUser);
}

describe('Queue', () => {
  it('should list unreviewed reports in received order and filter by tab', async () => {
    setup();
    await screen.findByText('Alex M.');
    const rows = screen.getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getByText('Alex M.')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Sam R.')).toBeInTheDocument();
    expect(screen.queryByText('Old R.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'All' }));
    expect(screen.getByText('Old R.')).toBeInTheDocument();
  });

  it('should show trend arrows with deltas, an em dash for incomplete scores and truncate priority', async () => {
    setup();
    await screen.findByText('Sam R.');
    const sam = screen.getByRole('row', { name: /Sam R\./ });
    expect(within(sam).getByLabelText('down 4')).toHaveTextContent('▼4');
    expect(within(sam).getByLabelText('up 3')).toHaveTextContent('▲3');
    expect(within(sam).getByText('Unacknowledged alert')).toBeInTheDocument();
    const alex = screen.getByRole('row', { name: /Alex M\./ });
    expect(within(alex).getByText('—')).toBeInTheDocument();
    expect(within(alex).getByText(`${'x'.repeat(79)}…`)).toBeInTheDocument();
  });

  it('should open the report when Enter is pressed on a row', async () => {
    setup();
    const row = await screen.findByRole('row', { name: /Sam R\./ });
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('location')).toHaveTextContent('/clinician/reports/r-sam');
  });

  it('should show the empty state', async () => {
    server.use(
      http.get(`${API}/api/clinician/queue`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/api/clinician/alerts`, () => HttpResponse.json({ alerts: [] })),
    );
    renderApp('/clinician', clinicianUser);
    expect(await screen.findByText('No reports waiting.')).toBeInTheDocument();
  });
});
