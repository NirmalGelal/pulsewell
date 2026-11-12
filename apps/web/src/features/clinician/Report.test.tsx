import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { buildEvidenceItem, buildInstrumentResult } from '@pvc/shared';
import { API, clinicianUser } from '@/test/handlers';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';
import { clinicianReport, turn } from './fixtures';
import { REPORT_BANNER } from './Report';

function setup(report = clinicianReport()) {
  server.use(
    http.get(`${API}/api/clinician/alerts`, () => HttpResponse.json({ alerts: [] })),
    http.get(`${API}/api/clinician/queue`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/api/clinician/reports/r1`, () => HttpResponse.json(report)),
  );
  return renderApp('/clinician/reports/r1', clinicianUser);
}

describe('Report', () => {
  it('should show the AI banner and sections in order', async () => {
    setup();
    expect(await screen.findByText(REPORT_BANNER)).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings).toEqual([
      'Patient priorities',
      'Screening',
      'Clinical summary',
      "In the patient's words",
      'Patient notes, gaps and declined topics',
    ]);
  });

  it('should show risk flags with evidence before priorities', async () => {
    setup(
      clinicianReport({
        risk: {
          level: 'elevated',
          flags: [
            {
              category: 'suicidal_ideation',
              level: 'elevated',
              evidence: 'sometimes wish I was not here',
              turnId: 4,
              source: 'model',
            },
          ],
        },
      }),
    );
    await screen.findByText(REPORT_BANNER);
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings[0]).toBe('Risk flags');
    expect(screen.getByText(/sometimes wish I was not here/)).toBeInTheDocument();
  });

  it('should hide removed items entirely and show the placeholder', async () => {
    setup(
      clinicianReport({
        summary: {
          moodAnxiety: [
            buildEvidenceItem({
              id: 'moodAnxiety-1',
              text: '',
              patientText: '',
              turnIds: [],
              removedByPatient: true,
              patientCorrection: '',
            }),
          ],
        },
        quotes: [{ id: 'q1', text: '', turnId: 2, removedByPatient: true }],
      }),
    );
    expect(await screen.findByText('Patient chose not to share this item.')).toBeInTheDocument();
    expect(screen.getByText('Patient chose not to share this quote.')).toBeInTheDocument();
  });

  it('should show the patient correction next to the AI text', async () => {
    setup(
      clinicianReport({
        summary: {
          presentConcern: [
            buildEvidenceItem({
              text: 'Reports low mood since August.',
              patientCorrection: 'Low mood since September.',
            }),
          ],
        },
      }),
    );
    expect(await screen.findByText('Reports low mood since August.')).toBeInTheDocument();
    expect(screen.getByText(/Patient correction:/).parentElement).toHaveTextContent(
      'Low mood since September.',
    );
  });

  it('should highlight phq9_9 when at least 1 and show incomplete scores', async () => {
    const v = [1, 1, 1, 1, 1, 1, 1, 1, 1] as const;
    setup(
      clinicianReport({
        screening: {
          phq9: buildInstrumentResult('phq9', [...v]),
          gad7: buildInstrumentResult('gad7', [1, 1]),
        },
      }),
    );
    await screen.findByText(REPORT_BANNER);
    expect(screen.getByText(/Incomplete \(partial sum 2; 5 missing\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Show PHQ-9 items/ }));
    const table = screen.getByRole('table', { name: 'PHQ-9 items' });
    const flagged = within(table)
      .getAllByRole('row')
      .filter((r) => r.dataset.flag === 'true');
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toHaveTextContent('safety item');
  });

  it('should switch to the transcript, focus the turn and highlight it when a chip is clicked', async () => {
    setup();
    await screen.findByText(REPORT_BANNER);
    await userEvent.click(screen.getByRole('tab', { name: 'Ask' }));
    expect(screen.queryByRole('list', { name: 'Transcript' })).not.toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Show turn 2 in transcript' })[0]!);
    expect(screen.getByRole('tab', { name: 'Transcript' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await waitFor(() => expect(document.getElementById('turn-2')).toHaveFocus());
    expect(document.getElementById('turn-2')).toHaveAttribute('data-highlighted', 'true');
  });

  it('should show the redacted turn placeholder and mark safety turns', async () => {
    setup(
      clinicianReport(
        {},
        {
          transcript: [
            turn(1, 'COMPANION', 'Hi'),
            turn(2, 'PATIENT', null, { redacted: true }),
            turn(3, 'PATIENT', 'dark thoughts', { hasSafetyEvent: true }),
          ],
        },
      ),
    );
    expect(await screen.findByText('[Patient chose not to share this part]')).toBeInTheDocument();
    expect(screen.getByText('Safety flag')).toBeInTheDocument();
  });

  it('should mark reviewed and update the header', async () => {
    setup();
    server.use(
      http.post(`${API}/api/clinician/reports/r1/review`, () =>
        HttpResponse.json({ reviewedAt: '2026-11-12T10:00:00.000Z' }),
      ),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }));
    const done = await screen.findByRole('button', { name: /^Reviewed / });
    expect(done).toBeDisabled();
  });
});
