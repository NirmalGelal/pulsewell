import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, reportDto, sessionDetail } from '@/test/handlers';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

function expectNamedControls() {
  const unnamed = screen
    .getAllByRole('button')
    .filter((b) => !(b.getAttribute('aria-label') || b.textContent?.trim()));
  expect(unnamed).toEqual([]);
  const links = screen
    .getAllByRole('link')
    .filter((a) => !(a.getAttribute('aria-label') || a.textContent?.trim()));
  expect(links).toEqual([]);
}

describe('accessibility', () => {
  it('should give every chat button and field an accessible name', async () => {
    server.use(
      http.get(`${API}/api/sessions/s1`, () =>
        HttpResponse.json(
          sessionDetail({
            pendingItem: {
              key: 'phq9_1',
              prompt: 'How often?',
              options: [
                { value: 0, label: 'Not at all' },
                { value: 1, label: 'Several days' },
                { value: 2, label: 'More than half the days' },
                { value: 3, label: 'Nearly every day' },
              ],
            },
          }),
        ),
      ),
    );
    renderApp('/patient/session/s1');
    await screen.findByRole('textbox', { name: 'Your message' });
    expectNamedControls();
    expect(screen.getByRole('progressbar', { name: 'Conversation progress' })).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Your message' }), 'x');
  });

  it('should give every review button and field an accessible name', async () => {
    server.use(
      http.get(`${API}/api/sessions/s1/report`, () =>
        HttpResponse.json(reportDto({ risk: { level: 'elevated' } })),
      ),
    );
    renderApp('/patient/session/s1/review');
    await screen.findByRole('heading', { level: 1 });
    expectNamedControls();
    await userEvent.click(screen.getAllByRole('button', { name: /Add a note/ })[0]!);
    expect(screen.getByRole('textbox', { name: 'Your note' })).toBeInTheDocument();
    expectNamedControls();
  });
});
