import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Phone, Video, Volume2, VolumeOff } from 'lucide-react';
import {
  CRISIS_MESSAGE,
  CRISIS_RESOURCES,
  ELEVATED_RESOURCES_TEXT,
  PatientReportDtoSchema,
  SessionDetailDtoSchema,
  type CrisisResource,
  type InputMode,
  type InstrumentItemKey,
  type MessageDto,
  type MessageStreamEvent,
  type PendingItemDto,
  type ProgressDto,
  type SessionDetailDto,
  type SessionState,
} from '@pvc/shared';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError, api } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { postSse } from '@/lib/sse';
import { cn } from '@/lib/utils';
import { Composer } from './Composer';
import { CrisisOverlay } from './CrisisOverlay';
import { useReadAloud } from './useReadAloud';
import { setMode, videoPath, videoSupported } from './video/prefs';

type FinishState = 'idle' | 'working' | 'error';

interface CrisisInfo {
  message: string;
  resources: CrisisResource[];
}

export function progressCaption(p: ProgressDto): string {
  if (p.canFinish) return 'Ready when you are';
  if (p.percent < 30) return 'Getting to know you';
  if (p.percent <= 70) return 'Halfway there';
  return 'Almost done';
}

const CALL_988 = CRISIS_RESOURCES.find((r) => r.id === '988')?.href ?? 'tel:988';

export default function Chat() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const readAloud = useReadAloud();
  const speakRef = useRef(readAloud.speak);
  speakRef.current = readAloud.speak;

  const detailQuery = useQuery({
    queryKey: queryKeys.session(id),
    queryFn: () => api.get<SessionDetailDto>(`/api/sessions/${id}`, SessionDetailDtoSchema),
  });

  const [seeded, setSeeded] = useState(false);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [progress, setProgress] = useState<ProgressDto | null>(null);
  const [pendingItem, setPendingItem] = useState<PendingItemDto | null>(null);
  const [state, setState] = useState<SessionState>('INTERVIEWING');
  const [streaming, setStreaming] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState('');
  const [inputMode, setInputMode] = useState<InputMode>('TEXT');
  const [banner, setBanner] = useState(false);
  const [crisis, setCrisis] = useState<CrisisInfo | null>(null);
  const [resuming, setResuming] = useState(false);
  const [finish, setFinish] = useState<FinishState>('idle');
  const [confirmFinish, setConfirmFinish] = useState(false);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const finishStarted = useRef(false);
  const endRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  const applyDetail = useCallback((d: SessionDetailDto) => {
    setMessages(d.messages);
    setProgress(d.progress);
    setPendingItem(d.pendingItem);
    setState(d.session.state);
    if (d.session.state === 'CRISIS_PAUSED') {
      setCrisis((c) => c ?? { message: CRISIS_MESSAGE, resources: CRISIS_RESOURCES });
    } else {
      setCrisis(null);
    }
    if (d.session.riskLevel === 'elevated') setBanner(true);
  }, []);

  // Seed local conversation state once from the first successful load.
  useEffect(() => {
    if (seeded || !detailQuery.data) return;
    applyDetail(detailQuery.data);
    setSeeded(true);
  }, [seeded, detailQuery.data, applyDetail]);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Sessions past the interview belong on the review screen.
  useEffect(() => {
    if (
      seeded &&
      (state === 'PATIENT_REVIEW' || state === 'SUBMITTED' || state === 'CLINICIAN_REVIEWED')
    ) {
      navigate(`/patient/session/${id}/review`, { replace: true });
    }
  }, [seeded, state, id, navigate]);

  // Keep the newest message in view unless the reader scrolled up.
  useEffect(() => {
    const onScroll = () => {
      const root = document.documentElement;
      stickRef.current = root.scrollHeight - window.scrollY - window.innerHeight < 160;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useEffect(() => {
    if (stickRef.current) endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages, streaming, sending, pendingItem]);

  const runFinish = useCallback(async () => {
    setConfirmFinish(false);
    setFinish('working');
    try {
      await api.post(`/api/sessions/${id}/finish`, undefined, PatientReportDtoSchema);
      void qc.invalidateQueries({ queryKey: queryKeys.sessions });
      void qc.invalidateQueries({ queryKey: queryKeys.session(id) });
      navigate(`/patient/session/${id}/review`, { replace: true });
    } catch {
      setFinish('error');
    }
  }, [id, qc, navigate]);

  // Returning to a session whose summary was still being prepared: retry finishing.
  useEffect(() => {
    if (seeded && state === 'GENERATING_REPORT' && !finishStarted.current) {
      finishStarted.current = true;
      void runFinish();
    }
  }, [seeded, state, runFinish]);

  const handleEvent = useCallback((ev: MessageStreamEvent) => {
    switch (ev.event) {
      case 'patient_message':
        setMessages((m) => [...m, ev.data.message]);
        break;
      case 'safety':
        if (ev.data.showResources) setBanner(true);
        break;
      case 'crisis':
        setStreaming(null);
        setState(ev.data.session.state);
        setCrisis({ message: ev.data.message, resources: ev.data.resources });
        setBanner(true);
        break;
      case 'token':
        setStreaming((s) => (s ?? '') + ev.data.delta);
        break;
      case 'companion_message':
        setStreaming(null);
        setMessages((m) => [...m, ev.data.message]);
        speakRef.current(ev.data.message.text);
        break;
      case 'done':
        setProgress(ev.data.progress);
        setPendingItem(ev.data.pendingItem);
        break;
      case 'error':
        throw new ApiError(0, ev.data.code, ev.data.message);
    }
  }, []);

  const send = useCallback(
    async (
      text: string,
      mode: InputMode,
      answerFor?: { key: InstrumentItemKey; value: 0 | 1 | 2 | 3 },
    ) => {
      if (sendingRef.current || !text.trim()) return;
      sendingRef.current = true;
      setSending(true);
      setDraft('');
      setInputMode('TEXT');
      setPendingItem(null);
      stickRef.current = true;
      const controller = new AbortController();
      abortRef.current = controller;
      const restore = () => {
        if (!draftRef.current) {
          setDraft(text);
          if (mode === 'VOICE') setInputMode('VOICE');
        }
      };
      try {
        await postSse(
          `/api/sessions/${id}/messages`,
          { text, inputMode: mode, ...(answerFor ? { answerFor } : {}) },
          { onEvent: handleEvent, signal: controller.signal },
        );
        void qc.invalidateQueries({ queryKey: queryKeys.session(id) });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setStreaming(null);
        if (err instanceof ApiError && err.status === 409) return; // a reply is already in progress
        // Put the unsent words back so nothing the patient wrote is lost.
        restore();
        void qc.invalidateQueries({ queryKey: queryKeys.session(id) });
        toast.error('The companion lost its connection.');
      } finally {
        sendingRef.current = false;
        setSending(false);
      }
    },
    [id, handleEvent, qc],
  );

  const resume = async () => {
    setResuming(true);
    try {
      const d = await api.post<SessionDetailDto>(
        `/api/sessions/${id}/resume`,
        { confirmSafe: true },
        SessionDetailDtoSchema,
      );
      qc.setQueryData(queryKeys.session(id), d);
      applyDetail(d);
    } catch {
      toast.error("We couldn't continue just now. Please try again.");
    } finally {
      setResuming(false);
    }
  };

  const requestFinish = () => {
    if (progress && !progress.canFinish) setConfirmFinish(true);
    else void runFinish();
  };

  if (detailQuery.isError && !seeded) {
    return (
      <div className="mx-auto w-full max-w-[42rem] px-4 pt-14">
        <div role="alert">
          <h1 className="text-[1.75rem] leading-tight">We couldn't open this conversation</h1>
          <p className="mt-2 text-muted-foreground">Nothing was lost. Please try again.</p>
          <Button size="lg" className="mt-5 h-12" onClick={() => void detailQuery.refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  if (!seeded || !progress) {
    return (
      <div role="status" className="mx-auto w-full max-w-[42rem] space-y-4 px-4 pt-14">
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-6 w-4/5" />
        <Skeleton className="h-6 w-3/5" />
        <span className="sr-only">Loading your conversation…</span>
      </div>
    );
  }

  if (finish !== 'idle') {
    return (
      <div className="mx-auto flex w-full max-w-[42rem] flex-1 flex-col justify-center px-4 py-14">
        {finish === 'working' ? (
          <div role="status">
            <h1 className="text-[1.75rem] leading-tight">Preparing your summary…</h1>
            <p className="mt-2 text-[1.1875rem] text-muted-foreground">
              This can take up to a minute. You will read it before anyone else does.
            </p>
            <div aria-hidden="true" className="mt-8 space-y-3">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
        ) : (
          <div role="alert">
            <h1 className="text-[1.75rem] leading-tight">We couldn't prepare your summary yet</h1>
            <p className="mt-2 text-[1.1875rem] text-muted-foreground">
              Nothing was lost. Please try again.
            </p>
            <Button size="lg" className="mt-5 h-12" onClick={() => void runFinish()}>
              Try again
            </Button>
          </div>
        )}
      </div>
    );
  }

  const hasPatientMessage = messages.some((m) => m.sender === 'PATIENT');
  const interviewing = state === 'INTERVIEWING';
  const typing = sending && streaming === null && !crisis;

  return (
    <div className="mx-auto flex w-full max-w-[42rem] flex-1 flex-col px-4">
      <div className="sticky top-0 z-[var(--z-sticky)] -mx-4 space-y-3 border-b bg-background px-4 pb-3 pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 flex-1 text-[0.9375rem] font-medium">{progressCaption(progress)}</p>
          {readAloud.supported && (
            <Button
              variant={readAloud.enabled ? 'default' : 'outline'}
              aria-pressed={readAloud.enabled}
              onClick={readAloud.toggle}
              className="h-10 px-3"
            >
              {readAloud.enabled ? (
                <Volume2 aria-hidden="true" />
              ) : (
                <VolumeOff aria-hidden="true" />
              )}
              <span>Read aloud</span>
            </Button>
          )}
          {videoSupported() && interviewing && (
            <Button
              variant="outline"
              className="h-10 px-3"
              onClick={() => {
                abortRef.current?.abort();
                setMode('video');
                navigate(videoPath(id));
              }}
            >
              <Video aria-hidden="true" />
              <span>Switch to video</span>
            </Button>
          )}
          <Button
            variant="outline"
            className="h-10 px-4"
            onClick={requestFinish}
            disabled={!hasPatientMessage || sending}
          >
            Finish
          </Button>
        </div>
        <div
          role="progressbar"
          aria-label="Conversation progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress.percent}
          className="h-1.5 overflow-hidden rounded-sm bg-surface-strong"
        >
          <div
            className="h-full bg-primary transition-[width] duration-200 ease-out"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        {banner && (
          <div
            role="region"
            aria-label="Support resources"
            className="flex flex-wrap items-center gap-3 rounded-lg border border-warn-border bg-warn-soft p-3"
          >
            <p className="min-w-[14rem] flex-1 text-[0.9375rem]">{ELEVATED_RESOURCES_TEXT}</p>
            <a href={CALL_988} className={cn(buttonVariants(), 'h-11 gap-2 px-4')}>
              <Phone aria-hidden="true" className="size-4" />
              Call 988
            </a>
            <a href="sms:988" className={cn(buttonVariants({ variant: 'outline' }), 'h-11 px-4')}>
              Text 988
            </a>
          </div>
        )}
      </div>

      <div
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        className="flex-1 space-y-7 py-8"
      >
        {messages.map((m) => (
          <Bubble key={m.id} sender={m.sender} text={m.text} />
        ))}
        {streaming !== null && <Bubble sender="COMPANION" text={streaming} />}
        {typing && (
          <p
            aria-label="The companion is typing"
            className="font-serif text-[1.25rem] italic text-muted-foreground"
          >
            <span aria-hidden="true">Writing a reply…</span>
          </p>
        )}
        <div ref={endRef} />
      </div>

      <div className="sticky bottom-0 z-[var(--z-sticky)] -mx-4 space-y-3 border-t bg-background px-4 pb-3 pt-4">
        {interviewing && pendingItem && !sending && (
          <fieldset className="space-y-3">
            <legend className="font-serif text-[1.25rem] leading-snug">{pendingItem.prompt}</legend>
            <div className="grid grid-cols-2 gap-2">
              {pendingItem.options.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className="group flex min-h-12 items-center gap-2.5 rounded-lg border border-input bg-background px-3 py-2 text-left text-base sm:min-h-14 sm:gap-3 sm:px-4 sm:py-3 sm:text-[1.0625rem] leading-snug outline-none transition-colors duration-150 ease-out hover:border-primary hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:bg-surface-strong"
                  onClick={() =>
                    void send(o.label, 'TAP', { key: pendingItem.key, value: o.value })
                  }
                >
                  <span
                    aria-hidden="true"
                    className="size-4 shrink-0 rounded-full border-2 border-input transition-colors group-hover:border-primary"
                  />
                  <span>{o.label}</span>
                </button>
              ))}
            </div>
            <p className="text-[0.8125rem] text-muted-foreground">Or type your own answer below.</p>
          </fieldset>
        )}
        <Composer
          value={draft}
          onChange={setDraft}
          onVoice={() => setInputMode('VOICE')}
          onSend={() => void send(draft.trim(), inputMode)}
          disabled={sending || !interviewing}
        />
        <p className="text-center text-[0.8125rem] text-muted-foreground">
          AI companion, not a doctor. You can skip any question.
        </p>
      </div>

      {confirmFinish && (
        <ConfirmDialog
          title="Finish now?"
          confirmLabel="Finish now"
          cancelLabel="Keep going"
          onConfirm={() => void runFinish()}
          onCancel={() => setConfirmFinish(false)}
        >
          Some questions aren't answered yet. Your clinician will see which ones are missing. Finish
          now?
        </ConfirmDialog>
      )}

      {crisis && (
        <CrisisOverlay
          message={crisis.message}
          resources={crisis.resources}
          busy={resuming}
          onResume={() => void resume()}
          onFinish={() => void runFinish()}
        />
      )}
    </div>
  );
}

function Bubble({ sender, text }: { sender: 'PATIENT' | 'COMPANION'; text: string }) {
  const mine = sender === 'PATIENT';
  return (
    <div className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
      <div
        className={cn(
          'whitespace-pre-wrap',
          mine
            ? 'max-w-[85%] rounded-lg bg-surface-strong px-4 py-3 text-[1.0625rem] leading-relaxed'
            : 'max-w-[34rem] font-serif text-[1.375rem] leading-[1.5]',
        )}
      >
        <span className="sr-only">{mine ? 'You said: ' : 'Companion: '}</span>
        {text}
      </div>
    </div>
  );
}
