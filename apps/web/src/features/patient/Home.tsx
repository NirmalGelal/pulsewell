import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { FollowUpDtoSchema, SessionSummaryDtoSchema } from '@pvc/shared';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { queryKeys } from '@/lib/query';
import { cn } from '@/lib/utils';
import { formatDate, sessionPath, STATE_LABELS } from './labels';

const SessionsSchema = z.object({ sessions: z.array(SessionSummaryDtoSchema) });
const FollowUpsSchema = z.object({ followUps: z.array(FollowUpDtoSchema) });

export default function Home() {
  const { user } = useAuth();
  const sessions = useQuery({
    queryKey: queryKeys.sessions,
    queryFn: () => api.get('/api/sessions', SessionsSchema),
  });
  const followUps = useQuery({
    queryKey: queryKeys.followUps,
    queryFn: () => api.get('/api/patient/follow-ups', FollowUpsSchema),
  });

  const firstName = user?.displayName.split(/\s+/)[0] ?? '';
  const list = sessions.data?.sessions ?? [];
  const active = list.find((s) => s.state === 'INTERVIEWING' || s.state === 'CRISIS_PAUSED');
  const followUp = followUps.data?.followUps[0];

  return (
    <div className="mx-auto w-full max-w-[42rem] px-4 pb-16 pt-10 sm:pt-14">
      <h1 className="text-[2.125rem] leading-tight">Hello, {firstName}</h1>
      <p className="mt-3 max-w-[65ch] text-[1.1875rem] leading-relaxed text-muted-foreground">
        Tell your story in your own words. You can talk or type, skip any question, and stop
        whenever you like.
      </p>

      {followUp && (
        <section aria-label="Questions from your clinician" className="mt-8 border-t pt-5">
          <p className="font-serif text-[1.1875rem] leading-snug">
            {followUp.clinician.displayName} asked a few questions for your next check-in.
          </p>
          <p className="mt-1 text-muted-foreground">
            We'll bring them up gently during your conversation.
          </p>
        </section>
      )}

      <div className="mt-8">
        {sessions.isPending ? (
          <div role="status">
            <Skeleton className="h-14 w-full" />
            <span className="sr-only">Loading…</span>
          </div>
        ) : (
          <Link
            to={active ? `/patient/session/${active.id}` : '/patient/consent'}
            className={cn(buttonVariants(), 'h-14 w-full px-6 text-[1.1875rem]')}
          >
            {active ? 'Continue your conversation' : 'Start a conversation'}
          </Link>
        )}
        {sessions.isError && (
          <p role="alert" className="mt-3 text-foreground">
            We couldn't load your conversations. Please refresh.
          </p>
        )}
      </div>

      {list.length > 0 && (
        <section aria-labelledby="history-h" className="mt-14">
          <h2 id="history-h" className="text-[1.4375rem]">
            Your conversations
          </h2>
          <ul className="mt-3 border-t">
            {list.map((s) => (
              <li key={s.id} className="border-b">
                <Link
                  to={sessionPath(s.id, s.state)}
                  className="flex min-h-14 items-center justify-between gap-4 py-3 outline-none transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="font-medium tabular-nums">{formatDate(s.startedAt)}</span>
                  <span className="text-[0.9375rem] text-muted-foreground">
                    {STATE_LABELS[s.state]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
