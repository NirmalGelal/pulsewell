import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, sessionDetail } from '@/test/handlers';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

describe('Consent', () => {
  it('should keep Start disabled until the checkbox is ticked and list clinician names', async () => {
    renderApp('/patient/consent');
    const start = await screen.findByRole('button', { name: 'Start' });
    expect(start).toBeDisabled();
    expect(await screen.findByText(/Who will see it: Dr. Jordan Lee/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'I understand and agree' }));
    expect(start).toBeEnabled();
  });

  it('should create the session with consent and open the chat', async () => {
    let body: unknown;
    server.use(
      http.post(`${API}/api/sessions`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(sessionDetail(), { status: 201 });
      }),
      http.get(`${API}/api/sessions/s1`, () => HttpResponse.json(sessionDetail())),
    );
    renderApp('/patient/consent');
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(await screen.findByText(/I am here to listen/)).toBeInTheDocument();
    expect(body).toEqual({ consent: { accepted: true, version: 'v1' } });
    expect(screen.getByTestId('location')).toHaveTextContent('/patient/session/s1');
  });

  it('should navigate to the existing session on 409', async () => {
    server.use(
      http.post(`${API}/api/sessions`, () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVALID_STATE',
              message: 'in progress',
              details: { sessionId: 'existing' },
            },
          },
          { status: 409 },
        ),
      ),
      http.get(`${API}/api/sessions/existing`, () => HttpResponse.json(sessionDetail())),
    );
    renderApp('/patient/consent');
    await userEvent.click(await screen.findByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    await screen.findByText(/I am here to listen/);
    expect(screen.getByTestId('location')).toHaveTextContent('/patient/session/existing');
  });
});
