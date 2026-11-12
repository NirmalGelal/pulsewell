import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { API, clinicianUser } from '@/test/handlers';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';
import { alertDto } from './fixtures';
import { ALERT_POLL_MS } from './AlertBanner';

function mock(alerts: ReturnType<typeof alertDto>[]) {
  server.use(
    http.get(`${API}/api/clinician/queue`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/api/clinician/alerts`, () => HttpResponse.json({ alerts })),
  );
}

describe('AlertBanner', () => {
  it('should show open alerts with patient, evidence and relative time', async () => {
    mock([alertDto()]);
    renderApp('/clinician', clinicianUser);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Urgent safety alert: Riley K.');
    expect(alert).toHaveTextContent("I'm going to end it tonight");
    expect(alert).toHaveTextContent('5 min ago');
    expect(screen.getByRole('button', { name: 'View patient' })).toBeInTheDocument();
  });

  it('should acknowledge via the API and remove the alert', async () => {
    let open = [alertDto()];
    const acked = vi.fn();
    server.use(
      http.get(`${API}/api/clinician/queue`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/api/clinician/alerts`, () => HttpResponse.json({ alerts: open })),
      http.post(`${API}/api/clinician/alerts/a1/ack`, () => {
        acked();
        open = [];
        return HttpResponse.json(alertDto({ acknowledgedAt: new Date().toISOString() }));
      }),
    );
    renderApp('/clinician', clinicianUser);
    await userEvent.click(await screen.findByRole('button', { name: 'Acknowledge alert' }));
    await waitFor(() => expect(acked).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(/Urgent safety alert/)).not.toBeInTheDocument());
  });

  it('should poll every 15 seconds', () => {
    expect(ALERT_POLL_MS).toBe(15000);
  });

  it('should navigate to the patient on View patient', async () => {
    mock([alertDto()]);
    renderApp('/clinician', clinicianUser);
    server.use(
      http.get(`${API}/api/clinician/patients`, () => HttpResponse.json({ patients: [] })),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'View patient' }));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/clinician/patients/p3'),
    );
  });
});
