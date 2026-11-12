import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { CONSENT_VERSION, SessionDetailDtoSchema, type SessionDetailDto } from '@pvc/shared';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { setMode, videoPath, videoSupported } from './video/prefs';

const CliniciansSchema = z.object({
  clinicians: z.array(z.object({ id: z.string(), displayName: z.string() })),
});

export default function Consent() {
  const navigate = useNavigate();
  const wantsVideo = useSearchParams()[0].get('mode') === 'video' && videoSupported();
  const qc = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clinicians = useQuery({
    queryKey: queryKeys.clinicians,
    queryFn: () => api.get('/api/patient/clinicians', CliniciansSchema),
  });

  const start = useMutation({
    mutationFn: () =>
      api.post<SessionDetailDto>(
        '/api/sessions',
        { consent: { accepted: true, version: CONSENT_VERSION } },
        SessionDetailDtoSchema,
      ),
    onSuccess: (detail) => {
      qc.setQueryData(queryKeys.session(detail.session.id), detail);
      void qc.invalidateQueries({ queryKey: queryKeys.sessions });
      if (wantsVideo) setMode('video');
      navigate(
        wantsVideo ? videoPath(detail.session.id) : `/patient/session/${detail.session.id}`,
        {
          replace: true,
        },
      );
    },
    onError: (err) => {
      const existing =
        err instanceof ApiError && err.status === 409
          ? (err.details as { sessionId?: string } | undefined)?.sessionId
          : undefined;
      if (existing) {
        navigate(wantsVideo ? videoPath(existing) : `/patient/session/${existing}`, {
          replace: true,
        });
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    },
  });

  const names = clinicians.data?.clinicians.map((c) => c.displayName).join(', ');

  return (
    <div className="mx-auto w-full max-w-[42rem] px-4 pb-16 pt-10 sm:pt-14">
      <h1 className="text-[2.125rem] leading-tight">Before we begin</h1>
      <p className="mt-3 text-[1.1875rem] text-muted-foreground">
        Here is what to expect. Please read it through.
      </p>
      <ul className="mt-8 border-t text-[1.0625rem] leading-relaxed">
        {[
          <>
            This is an AI companion, not a therapist or doctor. It won't diagnose you or give
            medical advice.
          </>,
          <>
            It will ask about how you've been feeling so your clinician can understand you better.
          </>,
          <>You can skip any question and stop at any time.</>,
          <>
            Before anything is shared, you'll see a summary and can correct it, add notes, or remove
            parts.
          </>,
          <>Who will see it: {names ?? '…'}.</>,
          <>
            If you tell us you're in immediate danger, we'll pause, show you how to get help right
            away, and alert your care team, even before you approve the summary.
          </>,
          <>Your voice recordings are turned into text and never stored.</>,
        ].map((item, i) => (
          <li key={i} className="border-b py-4">
            {item}
          </li>
        ))}
      </ul>
      <label className="mt-8 flex min-h-12 cursor-pointer items-start gap-4 text-[1.1875rem]">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="mt-0.5 size-6 shrink-0 accent-[var(--primary)]"
        />
        <span>I understand and agree</span>
      </label>
      {error && (
        <p role="alert" className="mt-4 text-foreground">
          {error}
        </p>
      )}
      <Button
        className="mt-6 h-14 w-full text-[1.1875rem]"
        disabled={!agreed || start.isPending}
        onClick={() => {
          setError(null);
          start.mutate();
        }}
      >
        {start.isPending ? 'Starting…' : wantsVideo ? 'Start video session' : 'Start'}
      </Button>
      {videoSupported() && (
        <Link
          to={wantsVideo ? '/patient/consent' : '/patient/consent?mode=video'}
          replace
          className="mt-3 inline-flex min-h-11 items-center text-base underline underline-offset-4"
        >
          {wantsVideo ? 'Use text chat instead' : 'Use a video session instead'}
        </Link>
      )}
    </div>
  );
}
