import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { CRISIS_MESSAGE, CRISIS_RESOURCES, type SessionDetailDto } from '@pvc/shared';
import { API, reportDto, sessionDetail, sseResponse } from '@/test/handlers';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const msg = (turnId: number, sender: 'PATIENT' | 'COMPANION', text: string) => ({
  message: {
    id: `m${turnId}`,
    turnId,
    sender,
    text,
    inputMode: 'TEXT' as const,
    createdAt: '2026-11-11T18:01:00.000Z',
  },
});
const progress = (percent: number, canFinish = false) => ({
  covered: 3,
  total: 26,
  percent,
  missingRequired: [],
  canFinish,
});

function open(detail: SessionDetailDto = sessionDetail()) {
  server.use(http.get(`${API}/api/sessions/s1`, () => HttpResponse.json(detail)));
  return renderApp('/patient/session/s1');
}

async function sendText(text: string) {
  const box = await screen.findByRole('textbox', { name: 'Your message' });
  await userEvent.type(box, text);
  await userEvent.click(screen.getByRole('button', { name: 'Send message' }));
  return box;
}

const normalTurn = (reply: string, pct = 40) =>
  sseResponse([
    ['patient_message', msg(2, 'PATIENT', 'I feel tired')],
    ['safety', { level: 'none', categories: [], showResources: false }],
    ['token', { delta: reply.slice(0, 5) }],
    ['token', { delta: reply.slice(5) }],
    ['companion_message', msg(3, 'COMPANION', reply)],
    ['done', { progress: progress(pct), pendingItem: null }],
  ]);

describe('Chat', () => {
  it('should render the streamed reply as a final message and update progress on done', async () => {
    server.use(
      http.post(`${API}/api/sessions/s1/messages`, () =>
        normalTurn('That sounds hard. Tell me more.'),
      ),
    );
    open();
    expect(await screen.findByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByText('Getting to know you')).toBeInTheDocument();
    await sendText('I feel tired');
    const log = screen.getByRole('log');
    expect(await within(log).findByText(/That sounds hard\. Tell me more\./)).toBeInTheDocument();
    expect(within(log).getByText(/I feel tired/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40'),
    );
    expect(screen.getByText('Halfway there')).toBeInTheDocument();
    expect(log).toHaveAttribute('aria-live', 'polite');
  });

  it('should show answer chips for a pending item and send a TAP with answerFor', async () => {
    let body: unknown;
    server.use(
      http.post(`${API}/api/sessions/s1/messages`, async ({ request }) => {
        body = await request.json();
        return sseResponse([
          ['patient_message', msg(2, 'PATIENT', 'Several days')],
          ['safety', { level: 'none', categories: [], showResources: false }],
          ['companion_message', msg(3, 'COMPANION', 'Thanks.')],
          ['done', { progress: progress(20), pendingItem: null }],
        ]);
      }),
    );
    open(
      sessionDetail({
        pendingItem: {
          key: 'phq9_1',
          prompt: 'Over the last 2 weeks, how often have you had little interest in doing things?',
          options: [
            { value: 0, label: 'Not at all' },
            { value: 1, label: 'Several days' },
            { value: 2, label: 'More than half the days' },
            { value: 3, label: 'Nearly every day' },
          ],
        },
      }),
    );
    expect(await screen.findByText(/little interest/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Several days' }));
    await waitFor(() =>
      expect(body).toEqual({
        text: 'Several days',
        inputMode: 'TAP',
        answerFor: { key: 'phq9_1', value: 1 },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Several days' })).not.toBeInTheDocument(),
    );
  });

  it('should show the 988 banner when safety asks for resources', async () => {
    server.use(
      http.post(`${API}/api/sessions/s1/messages`, () =>
        sseResponse([
          ['patient_message', msg(2, 'PATIENT', 'I feel hopeless')],
          ['safety', { level: 'elevated', categories: ['suicidal_ideation'], showResources: true }],
          ['companion_message', msg(3, 'COMPANION', 'I hear you.')],
          ['done', { progress: progress(10), pendingItem: null }],
        ]),
      ),
    );
    open();
    expect(screen.queryByRole('region', { name: 'Support resources' })).not.toBeInTheDocument();
    await sendText('I feel hopeless');
    const banner = await screen.findByRole('region', { name: 'Support resources' });
    expect(within(banner).getByRole('link', { name: /Call 988/ })).toHaveAttribute(
      'href',
      'tel:988',
    );
    expect(within(banner).getByRole('link', { name: /Text 988/ })).toHaveAttribute(
      'href',
      'sms:988',
    );
  });

  describe('crisis', () => {
    const crisisStream = () =>
      sseResponse([
        ['patient_message', msg(2, 'PATIENT', 'I am going to end it')],
        ['safety', { level: 'imminent', categories: ['suicidal_ideation'], showResources: true }],
        [
          'crisis',
          {
            level: 'imminent',
            message: CRISIS_MESSAGE,
            resources: CRISIS_RESOURCES,
            session: {
              id: 's1',
              state: 'CRISIS_PAUSED',
              riskLevel: 'imminent',
              startedAt: '2026-11-11T18:00:00.000Z',
              endedAt: null,
            },
          },
        ],
      ]);

    it('should show a non-dismissable alertdialog with resource links', async () => {
      server.use(http.post(`${API}/api/sessions/s1/messages`, crisisStream));
      open();
      await sendText('I am going to end it');
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toHaveTextContent(CRISIS_MESSAGE);
      for (const r of CRISIS_RESOURCES)
        expect(within(dialog).getByRole('link', { name: new RegExp(r.name) })).toHaveAttribute(
          'href',
          r.href,
        );
      expect(
        within(dialog).queryByRole('button', { name: /close|dismiss|×/i }),
      ).not.toBeInTheDocument();
      // initial focus on the first resource
      expect(within(dialog).getAllByRole('link')[0]).toHaveFocus();
      // Escape does not dismiss it
      await userEvent.keyboard('{Escape}');
      expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    });

    it('should trap focus inside the overlay', async () => {
      server.use(http.post(`${API}/api/sessions/s1/messages`, crisisStream));
      open();
      await sendText('I am going to end it');
      const dialog = await screen.findByRole('alertdialog');
      const focusables = [
        ...within(dialog).getAllByRole('link'),
        ...within(dialog).getAllByRole('button'),
      ];
      const last = focusables[focusables.length - 1]!;
      last.focus();
      await userEvent.tab();
      expect(focusables[0]).toHaveFocus();
      await userEvent.tab({ shift: true });
      expect(last).toHaveFocus();
    });

    it('should resume only after the patient confirms they are safe', async () => {
      let resumed: unknown = null;
      server.use(
        http.post(`${API}/api/sessions/s1/messages`, crisisStream),
        http.post(`${API}/api/sessions/s1/resume`, async ({ request }) => {
          resumed = await request.json();
          return HttpResponse.json(sessionDetail());
        }),
      );
      open();
      await sendText('I am going to end it');
      await screen.findByRole('alertdialog');
      await userEvent.click(screen.getByRole('button', { name: /I'm safe right now/ }));
      expect(resumed).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: /Yes, I'm safe/ }));
      await waitFor(() => expect(resumed).toEqual({ confirmSafe: true }));
      await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
      expect(screen.getByRole('textbox', { name: 'Your message' })).toBeEnabled();
    });

    it('should show the overlay when a loaded session is already CRISIS_PAUSED, and finish from it', async () => {
      server.use(
        http.post(`${API}/api/sessions/s1/finish`, () => HttpResponse.json(reportDto())),
        http.get(`${API}/api/sessions/s1/report`, () => HttpResponse.json(reportDto())),
      );
      const d = sessionDetail();
      d.session.state = 'CRISIS_PAUSED';
      open(d);
      expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
      await userEvent.click(
        screen.getByRole('button', { name: /Finish and send what I've shared/ }),
      );
      expect(
        await screen.findByRole('heading', { name: /Here's what we'll share/ }),
      ).toBeInTheDocument();
    });
  });

  it('should restore the composer text and toast when an error event arrives', async () => {
    server.use(
      http.post(`${API}/api/sessions/s1/messages`, () =>
        sseResponse([
          ['patient_message', msg(2, 'PATIENT', 'hello there')],
          ['error', { code: 'LLM_UNAVAILABLE', message: 'down' }],
        ]),
      ),
    );
    open();
    const box = await sendText('hello there');
    expect(await screen.findByText('The companion lost its connection.')).toBeInTheDocument();
    await waitFor(() => expect(box).toHaveValue('hello there'));
  });

  it('should restore the composer text on a network failure', async () => {
    server.use(http.post(`${API}/api/sessions/s1/messages`, () => HttpResponse.error()));
    open();
    const box = await sendText('are you there');
    expect(await screen.findByText('The companion lost its connection.')).toBeInTheDocument();
    await waitFor(() => expect(box).toHaveValue('are you there'));
  });

  describe('finish', () => {
    const withMessage = () => {
      const d = sessionDetail({ progress: progress(30, false) });
      d.messages.push({
        id: 'm2',
        turnId: 2,
        sender: 'PATIENT',
        text: 'hi',
        inputMode: 'TEXT',
        createdAt: '2026-11-11T18:02:00.000Z',
      });
      return d;
    };

    it('should disable Finish until the patient has written something', async () => {
      open();
      expect(await screen.findByRole('button', { name: 'Finish' })).toBeDisabled();
    });

    it('should confirm when required questions are missing, and retry after a 503', async () => {
      let calls = 0;
      server.use(
        http.post(`${API}/api/sessions/s1/finish`, () => {
          calls += 1;
          return calls === 1
            ? HttpResponse.json(
                { error: { code: 'LLM_UNAVAILABLE', message: 'x' } },
                { status: 503 },
              )
            : HttpResponse.json(reportDto());
        }),
        http.get(`${API}/api/sessions/s1/report`, () => HttpResponse.json(reportDto())),
      );
      open(withMessage());
      await userEvent.click(await screen.findByRole('button', { name: 'Finish' }));
      const dialog = await screen.findByRole('alertdialog');
      expect(dialog).toHaveTextContent(/Some questions aren't answered yet/);
      expect(calls).toBe(0);
      await userEvent.click(within(dialog).getByRole('button', { name: 'Finish now' }));
      expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
      expect(
        await screen.findByRole('heading', { name: /Here's what we'll share/ }),
      ).toBeInTheDocument();
      expect(calls).toBe(2);
    });

    it('should finish without confirmation when everything required is covered', async () => {
      server.use(
        http.post(`${API}/api/sessions/s1/finish`, () => HttpResponse.json(reportDto())),
        http.get(`${API}/api/sessions/s1/report`, () => HttpResponse.json(reportDto())),
      );
      const d = withMessage();
      d.progress = progress(90, true);
      open(d);
      await userEvent.click(await screen.findByRole('button', { name: 'Finish' }));
      expect(
        await screen.findByRole('heading', { name: /Here's what we'll share/ }),
      ).toBeInTheDocument();
    });
  });
});
