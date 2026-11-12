import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { API, clinicianUser } from '@/test/handlers';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';
import { clinicianReport } from './fixtures';

function setup() {
  server.use(
    http.get(`${API}/api/clinician/alerts`, () => HttpResponse.json({ alerts: [] })),
    http.get(`${API}/api/clinician/queue`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/api/clinician/reports/r1`, () => HttpResponse.json(clinicianReport())),
  );
  return renderApp('/clinician/reports/r1', clinicianUser);
}

describe('Notes', () => {
  it('should create a private note and list it', async () => {
    setup();
    const posted = vi.fn();
    server.use(
      http.post(`${API}/api/clinician/reports/r1/notes`, async ({ request }) => {
        posted(await request.json());
        return HttpResponse.json(
          {
            id: 'n1',
            text: 'Follow up on sleep',
            createdAt: '2026-11-12T10:00:00.000Z',
            clinicianName: 'Dr. Jordan Lee',
          },
          { status: 201 },
        );
      }),
    );
    await userEvent.click(await screen.findByRole('tab', { name: /Notes/ }));
    expect(screen.getByText('Private. Not visible to the patient.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Add a note'), 'Follow up on sleep');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));
    expect(await screen.findByText('Follow up on sleep')).toBeInTheDocument();
    expect(posted).toHaveBeenCalledWith({ text: 'Follow up on sleep' });
  });
});

describe('FollowUp', () => {
  async function open() {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'Send follow-up questions' }));
    return screen.findByRole('dialog');
  }

  it('should block empty questions', async () => {
    await open();
    await userEvent.click(screen.getByRole('button', { name: 'Send questions' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/empty question/i);
  });

  it('should allow at most 3 questions', async () => {
    await open();
    const add = () => screen.queryByRole('button', { name: 'Add another question' });
    await userEvent.click(add()!);
    await userEvent.click(add()!);
    expect(screen.getAllByLabelText(/^Question \d$/)).toHaveLength(3);
    expect(add()).not.toBeInTheDocument();
  });

  it('should send the questions and confirm with a toast', async () => {
    const posted = vi.fn();
    server.use(
      http.post(`${API}/api/clinician/patients/p1/follow-ups`, async ({ request }) => {
        posted(await request.json());
        return HttpResponse.json(
          {
            id: 'f1',
            clinician: { id: 'c', displayName: 'Dr' },
            questions: ['x'],
            status: 'PENDING',
            createdAt: '2026-11-12T10:00:00.000Z',
          },
          { status: 201 },
        );
      }),
    );
    await open();
    await userEvent.type(screen.getByLabelText('Question 1'), 'How is your appetite?');
    await userEvent.click(screen.getByRole('button', { name: 'Send questions' }));
    await waitFor(() =>
      expect(posted).toHaveBeenCalledWith({ questions: ['How is your appetite?'] }),
    );
    expect(await screen.findByText(/The companion will ask these/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
