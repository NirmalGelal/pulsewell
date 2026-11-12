import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { API, clinicianUser } from '@/test/handlers';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

function setup(patients: unknown[] = []) {
  server.use(
    http.get(`${API}/api/clinician/alerts`, () => HttpResponse.json({ alerts: [] })),
    http.get(`${API}/api/clinician/queue`, () => HttpResponse.json({ items: [] })),
    http.get(`${API}/api/clinician/patients`, () => HttpResponse.json({ patients })),
  );
}

const created = {
  patient: { id: 'p9', email: 'pat@demo.test', displayName: 'Pat Newman' },
  temporaryPassword: 'Kq7mT3xWzR4n',
};

describe('Add patient', () => {
  it('should validate before calling the API', async () => {
    setup();
    const posted = vi.fn();
    server.use(
      http.post(`${API}/api/clinician/patients`, () => {
        posted();
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    renderApp('/clinician/patients', clinicianUser);
    await userEvent.click(await screen.findByRole('button', { name: 'Add patient' }));
    await userEvent.type(screen.getByLabelText('Patient name'), 'Pat Newman');
    await userEvent.type(screen.getByLabelText('Patient email'), 'not-an-email');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
    expect(posted).not.toHaveBeenCalled();
  });

  it('should create the account and show the temporary password once', async () => {
    setup();
    const body = vi.fn();
    server.use(
      http.post(`${API}/api/clinician/patients`, async ({ request }) => {
        body(await request.json());
        return HttpResponse.json(created, { status: 201 });
      }),
    );
    renderApp('/clinician/patients', clinicianUser);
    await userEvent.click(await screen.findByRole('button', { name: 'Add patient' }));
    await userEvent.type(screen.getByLabelText('Patient name'), 'Pat Newman');
    await userEvent.type(screen.getByLabelText('Patient email'), 'Pat@Demo.test');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(body).toHaveBeenCalledWith({ email: 'pat@demo.test', displayName: 'Pat Newman' });
    expect(within(dialog).getByLabelText('Temporary password')).toHaveTextContent('Kq7mT3xWzR4n');
    expect(within(dialog).getByText(/will not be shown again/i)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Copy password' })).toBeInTheDocument();

    await userEvent.click(
      within(dialog).getByRole('button', { name: 'I have shared the password' }),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByText('Kq7mT3xWzR4n')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('Kq7mT3xWzR4n');
  });

  it('should show a clear message for a duplicate email', async () => {
    setup();
    server.use(
      http.post(`${API}/api/clinician/patients`, () =>
        HttpResponse.json(
          { error: { code: 'CONFLICT', message: 'An account with that email already exists' } },
          { status: 409 },
        ),
      ),
    );
    renderApp('/clinician/patients', clinicianUser);
    await userEvent.click(await screen.findByRole('button', { name: 'Add patient' }));
    await userEvent.type(screen.getByLabelText('Patient name'), 'Pat');
    await userEvent.type(screen.getByLabelText('Patient email'), 'pat@demo.test');
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists/i);
  });
});

describe('Reset password', () => {
  it('should confirm, then reveal the new password once', async () => {
    setup([{ id: 'p1', displayName: 'Sam R.', lastApprovedAt: null, riskLevel: 'none' }]);
    server.use(
      http.post(`${API}/api/clinician/patients/p1/reset-password`, () =>
        HttpResponse.json({ temporaryPassword: 'Zx8cV2bNm5Qd' }),
      ),
    );
    renderApp('/clinician/patients/p1', clinicianUser);
    await userEvent.click(await screen.findByRole('button', { name: 'Reset password' }));
    const confirm = await screen.findByRole('alertdialog');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Reset password' }));
    const reveal = await screen.findByRole('alertdialog', { name: 'Password reset' });
    expect(within(reveal).getByLabelText('Temporary password')).toHaveTextContent('Zx8cV2bNm5Qd');
    await userEvent.click(
      within(reveal).getByRole('button', { name: 'I have shared the password' }),
    );
    expect(document.body.textContent).not.toContain('Zx8cV2bNm5Qd');
  });
});
