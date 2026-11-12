import type { ReactElement } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { UserDto } from '@pvc/shared';
import { Toaster } from '@/components/ui/sonner';
import { AuthProvider } from '@/lib/auth';
import { createQueryClient } from '@/lib/query';
import { AppRoutes } from '@/routes';
import { API, patientUser } from './handlers';
import { server } from './server';

function Where() {
  const loc = useLocation();
  return <output data-testid="location">{loc.pathname}</output>;
}

/** Logs a user in (token + /me handler), then renders the full route tree at `route`. */
export function renderApp(route: string, user: UserDto | null = patientUser) {
  if (user) {
    localStorage.setItem('pvc.token', 'test-token');
    server.use(http.get(`${API}/api/auth/me`, () => HttpResponse.json({ user })));
  }
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false } });
  const view = render(wrap(<AppRoutes />, route, client));
  return { ...view, client };
}

function wrap(ui: ReactElement, route: string, client = createQueryClient()) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>
          {ui}
          <Where />
          <Toaster />
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
