import { QueryClient } from '@tanstack/react-query';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
  });
}

export const queryKeys = {
  session: (id: string) => ['session', id] as const,
  sessions: ['sessions'] as const,
  report: (sessionId: string) => ['report', sessionId] as const,
  followUps: ['followUps'] as const,
  clinicians: ['clinicians'] as const,
};
