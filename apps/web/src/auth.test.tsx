import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { API, clinicianUser, patientUser } from './test/handlers';
import { renderApp } from './test/render';
import { server } from './test/server';

const loc = () => screen.getByTestId('location').textContent;

async function login(email: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Email'), email);
  await user.type(screen.getByLabelText('Password'), 'demo1234');
  await user.click(screen.getByRole('button', { name: 'Log in' }));
}

describe('auth', () => {
  it('should redirect a patient to /patient after login', async () => {
    server.use(
      http.post(`${API}/api/auth/login`, () =>
        HttpResponse.json({ token: 't', user: patientUser }),
      ),
      http.get(`${API}/api/auth/me`, () => HttpResponse.json({ user: patientUser })),
    );
    renderApp('/login', null);
    await login('patient@demo.test');
    expect(await screen.findByRole('heading', { name: /Hello, Sam/ })).toBeInTheDocument();
    expect(loc()).toBe('/patient');
    expect(localStorage.getItem('pvc.token')).toBe('t');
  });

  it('should redirect a clinician to /clinician after login', async () => {
    server.use(
      http.post(`${API}/api/auth/login`, () =>
        HttpResponse.json({ token: 't', user: clinicianUser }),
      ),
    );
    server.use(
      http.get(`${API}/api/clinician/queue`, () => HttpResponse.json({ items: [] })),
      http.get(`${API}/api/clinician/alerts`, () => HttpResponse.json({ alerts: [] })),
    );
    renderApp('/login', null);
    await login('clinician@demo.test');
    expect(await screen.findByRole('heading', { name: 'Review queue' })).toBeInTheDocument();
    expect(loc()).toBe('/clinician');
  });

  it('should redirect to the home of the user role when the route is for another role', async () => {
    renderApp('/clinician', patientUser);
    expect(await screen.findByRole('heading', { name: /Hello, Sam/ })).toBeInTheDocument();
    expect(loc()).toBe('/patient');
  });

  it('should send logged-out visitors to /login', async () => {
    renderApp('/patient', null);
    expect(await screen.findByRole('button', { name: 'Log in' })).toBeInTheDocument();
    expect(loc()).toBe('/login');
  });

  it('should show a message for bad credentials', async () => {
    server.use(
      http.post(`${API}/api/auth/login`, () =>
        HttpResponse.json(
          { error: { code: 'UNAUTHENTICATED', message: 'Invalid credentials' } },
          { status: 401 },
        ),
      ),
    );
    renderApp('/login', null);
    await login('patient@demo.test');
    expect(await screen.findByRole('alert')).toHaveTextContent(/not right/);
    expect(loc()).toBe('/login');
  });

  it('should show the demo hint in development', async () => {
    renderApp('/login', null);
    expect(await screen.findByText(/Demo: patient@demo.test/)).toBeInTheDocument();
  });
});
