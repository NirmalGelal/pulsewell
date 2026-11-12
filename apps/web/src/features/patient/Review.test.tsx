import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { buildInstrumentResult, buildEvidenceItem, type ReportEditInput } from '@pvc/shared';
import { API, reportDto } from '@/test/handlers';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

type Over = Parameters<typeof reportDto>[0];
const full = (): Over => ({
  risk: { level: 'none' },
  screening: {
    phq9: buildInstrumentResult('phq9', [1, 1, 1, 1, 1, 1, 1, 1, 1]),
    gad7: buildInstrumentResult('gad7', [2, 2, 2]),
  },
  summary: {
    chiefConcern: [
      buildEvidenceItem({ id: 'chiefConcern-1', patientText: 'You came in because of low mood.' }),
    ],
    sleepAppetiteEnergy: [
      buildEvidenceItem({ id: 'sleepAppetiteEnergy-1', patientText: 'You are sleeping badly.' }),
    ],
  },
  notDiscussed: ['substance_use'],
});

function open(over: Over = full(), status: 'DRAFT' | 'APPROVED' = 'DRAFT') {
  server.use(
    http.get(`${API}/api/sessions/s1/report`, () => HttpResponse.json(reportDto(over, status))),
  );
  return renderApp('/patient/session/s1/review');
}

function capturePatch(over: Over = full()) {
  const bodies: { edits: ReportEditInput[] }[] = [];
  server.use(
    http.patch(`${API}/api/sessions/s1/report`, async ({ request }) => {
      bodies.push((await request.json()) as { edits: ReportEditInput[] });
      return HttpResponse.json(reportDto(over));
    }),
  );
  return bodies;
}

describe('Review', () => {
  it('should show the sections in order with the clinician name', async () => {
    open();
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: "Here's what we'll share with Dr. Jordan Lee",
      }),
    ).toBeInTheDocument();
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    const order = [
      'What matters most to you',
      'Your check-in answers',
      'Summary',
      'What brought you here',
      'Sleep, eating and energy',
      'In your words',
      'Not discussed',
    ];
    const idx = order.map((h) => headings.indexOf(h));
    expect(idx.every((i) => i >= 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(screen.queryByRole('heading', { name: 'Mood and worry' })).not.toBeInTheDocument(); // empty sections hidden
    expect(screen.getByText('Alcohol and other substances')).toBeInTheDocument();
    expect(screen.getByText('AI-prepared summary. Not a diagnosis.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Your safety' })).not.toBeInTheDocument();
  });

  it('should describe scores in plain words and never show instrument names', async () => {
    open();
    await screen.findByText(/Mood check-in/);
    expect(screen.getByText(/Your answers fall in the mild range/)).toBeInTheDocument();
    expect(screen.getByText(/You answered 3 of 7 questions/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/PHQ|GAD/i);
  });

  it('should show the safety section only when risk is elevated or higher', async () => {
    open({ ...full(), risk: { level: 'elevated' } });
    expect(await screen.findByRole('heading', { name: 'Your safety' })).toBeInTheDocument();
    expect(screen.getByText(/You shared something about your safety/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /988/ })[0]).toHaveAttribute('href', 'tel:988');
  });

  it('should send a correct edit from Fix this', async () => {
    const bodies = capturePatch();
    open();
    await userEvent.click(
      await screen.findByRole('button', { name: /Fix this: You are sleeping badly/ }),
    );
    const box = screen.getByRole('textbox', { name: 'How should this read?' });
    await userEvent.clear(box);
    await userEvent.type(box, 'You are sleeping a little better.');
    await userEvent.click(screen.getByRole('button', { name: 'Save change' }));
    await waitFor(() =>
      expect(bodies).toEqual([
        {
          edits: [
            {
              kind: 'correct',
              section: 'sleepAppetiteEnergy',
              itemId: 'sleepAppetiteEnergy-1',
              text: 'You are sleeping a little better.',
            },
          ],
        },
      ]),
    );
  });

  it("should send a remove edit only after confirming Don't share this", async () => {
    const bodies = capturePatch();
    open();
    await userEvent.click(
      await screen.findByRole('button', {
        name: /Don't share this: You want help with your sleep/,
      }),
    );
    const dialog = await screen.findByRole('alertdialog');
    expect(bodies).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: "Don't share" }));
    await waitFor(() =>
      expect(bodies).toEqual([
        { edits: [{ kind: 'remove', section: 'priorities', itemId: 'priorities-1' }] },
      ]),
    );
  });

  it('should remove a quote and send an annotate note', async () => {
    const bodies = capturePatch();
    open();
    await userEvent.click(
      await screen.findByRole('button', { name: /Don't share this: I just feel tired/ }),
    );
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: "Don't share" }),
    );
    await waitFor(() =>
      expect(bodies[0]).toEqual({
        edits: [{ kind: 'remove', section: 'quotes', itemId: 'quote-1' }],
      }),
    );

    await userEvent.click(
      screen.getByRole('button', { name: 'Add a note to your check-in answers' }),
    );
    await userEvent.type(
      screen.getByRole('textbox', { name: 'Your note' }),
      'I was having a good week.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() =>
      expect(bodies[1]).toEqual({
        edits: [{ kind: 'annotate', section: 'screening', text: 'I was having a good week.' }],
      }),
    );
  });

  it('should show corrected and removed items accordingly', async () => {
    open({
      ...full(),
      priorities: [
        buildEvidenceItem({
          id: 'priorities-1',
          patientText: 'You want help with sleep.',
          patientCorrection: 'You want help with worry.',
        }),
        buildEvidenceItem({
          id: 'priorities-2',
          patientText: 'You want to eat better.',
          removedByPatient: true,
        }),
      ],
    });
    expect(await screen.findByText('You want help with worry.')).toBeInTheDocument();
    expect(screen.getByText('(you corrected this)')).toBeInTheDocument();
    expect(screen.getByText('Not shared')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Fix this: You want to eat better/ }),
    ).not.toBeInTheDocument();
  });

  it('should approve after confirming and show the success screen', async () => {
    let approved = 0;
    server.use(
      http.post(`${API}/api/sessions/s1/report/approve`, () => {
        approved += 1;
        return HttpResponse.json({
          report: { ...reportDto(full(), 'APPROVED'), approvedAt: '2026-11-12T10:00:00.000Z' },
          session: {
            id: 's1',
            state: 'SUBMITTED',
            riskLevel: 'none',
            startedAt: '2026-11-11T18:00:00.000Z',
            endedAt: '2026-11-11T18:20:00.000Z',
          },
        });
      }),
    );
    open();
    expect(
      screen.queryByText(/Your clinician will also be able to read your conversation/),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText(
        /Your clinician will also be able to read your conversation, except the parts you choose not to share\./,
      ),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send to my clinician' }));
    expect(approved).toBe(0);
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Send' }),
    );
    expect(await screen.findByText('Sent.')).toBeInTheDocument();
    expect(screen.getByText('Your clinician will see this before your visit.')).toBeInTheDocument();
    expect(approved).toBe(1);
  });

  it('should render an approved report read-only with the sent date', async () => {
    server.use(
      http.get(`${API}/api/sessions/s1/report`, () =>
        HttpResponse.json({
          ...reportDto(full(), 'APPROVED'),
          approvedAt: '2026-11-12T10:00:00.000Z',
        }),
      ),
    );
    renderApp('/patient/session/s1/review');
    expect(await screen.findByText(/Sent on .*2026/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fix this/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Don't share/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Add a note/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to my clinician' })).not.toBeInTheDocument();
    expect(screen.getByText('AI-prepared summary. Not a diagnosis.')).toBeInTheDocument();
  });
});
