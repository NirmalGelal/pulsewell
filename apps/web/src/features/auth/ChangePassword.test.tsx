import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { API, patientUser } from '@/test/handlers';
import { renderApp } from '@/test/render';
import { server } from '@/test/server';

const forced = { ...patientUser, mustChangePassword: true };

async function fill(current: string, next: string, confirm: string) {
  await userEvent.type(await screen.findByLabelText('Temporary password'), current);
  await userEvent.type(screen.getByLabelText('New password'), next);
  await userEvent.type(screen.getByLabelText('Confirm new password'), confirm);
  await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
}

describe('Forced password change', () => {
  it('should block patient routes and show the choose-password screen', async () => {
    renderApp('/patient', forced);
    expect(
      await screen.findByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Start|Begin/)).not.toBeInTheDocument();
  });

  it('should also block deep patient routes', async () => {
    renderApp('/patient/review/abc', forced);
    expect(
      await screen.findByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();
  });

  it('should reject short and mismatched passwords without calling the API', async () => {
    const called = vi.fn();
    server.use(
      http.post(`${API}/api/auth/change-password`, () => {
        called();
        return HttpResponse.json({ user: patientUser });
      }),
    );
    renderApp('/patient', forced);
    await fill('Temp1234abcd', 'short', 'short');
    expect(await screen.findByRole('alert')).toHaveTextContent(/at least 10/i);
    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.clear(screen.getByLabelText('Confirm new password'));
    await userEvent.type(screen.getByLabelText('New password'), 'a-long-new-pass');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a-long-new-pasz');
    await userEvent.click(screen.getByRole('button', { name: 'Save new password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match/i);
    expect(called).not.toHaveBeenCalled();
  });

  it('should toggle password visibility', async () => {
    renderApp('/patient', forced);
    const field = await screen.findByLabelText('New password');
    expect(field).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByLabelText('Show passwords'));
    expect(field).toHaveAttribute('type', 'text');
  });

  it('should save, then continue to the patient home', async () => {
    const body = vi.fn();
    server.use(
      http.post(`${API}/api/auth/change-password`, async ({ request }) => {
        body(await request.json());
        return HttpResponse.json({ user: patientUser });
      }),
    );
    renderApp('/patient', forced);
    await fill('Temp1234abcd', 'a-long-new-pass', 'a-long-new-pass');
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { name: 'Choose a new password' }),
      ).not.toBeInTheDocument(),
    );
    expect(body).toHaveBeenCalledWith({
      currentPassword: 'Temp1234abcd',
      newPassword: 'a-long-new-pass',
    });
    expect(screen.getByTestId('location')).toHaveTextContent('/patient');
  });

  it('should show an error when the temporary password is wrong', async () => {
    server.use(
      http.post(`${API}/api/auth/change-password`, () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'Current password is not correct' } },
          { status: 400 },
        ),
      ),
    );
    renderApp('/patient', forced);
    await fill('wrong-wrong', 'a-long-new-pass', 'a-long-new-pass');
    expect(await screen.findByRole('alert')).toHaveTextContent(/temporary password is not right/i);
    expect(screen.getByRole('heading', { name: 'Choose a new password' })).toBeInTheDocument();
  });
});
