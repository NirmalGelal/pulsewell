import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Phone, Send } from 'lucide-react';
import {
  CRISIS_MESSAGE,
  CRISIS_RESOURCES,
  ELEVATED_RESOURCES_TEXT,
  PatientReportDtoSchema,
  SessionDetailDtoSchema,
  type CrisisResource,
  type InputMode,
  type InstrumentItemKey,
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
import { CrisisOverlay } from '../CrisisOverlay';
import { CallControls } from './CallControls';
import { Captions } from './Captions';
import { CompanionAvatar, type AvatarState } from './CompanionAvatar';
import { PreJoin } from './PreJoin';
import { PRIVACY_LINE, SelfView } from './SelfView';
import {
  getSpeakAnswers,
  setMode,
  setSpeakAnswers as storeSpeakAnswers,
  textPath,
  videoSupported,
} from './prefs';
import { takeSentences } from './speech';
import { useCamera, type Camera } from './useCamera';
import { dictationSupported, useDictation } from './useDictation';
import { useSpeechOutput } from './useSpeechOutput';

const CALL_988 = CRISIS_RESOURCES.find((r) => r.id === '988')?.href ?? 'tel:988';
const join = (a: string, b: string) => (a.trim() ? `${a.trimEnd()} ${b}` : b);

function allSentences(text: string): string[] {
  const { sentences, rest } = takeSentences(text);
  return rest.trim() ? [...sentences, rest.trim()] : sentences;
}

export default function VideoSession() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const camera = useCamera();
  const [phase, setPhase] = useState<'prejoin' | 'call'>('prejoin');
  const [speakAnswers, setSpeak] = useState(getSpeakAnswers);
  const supported = videoSupported();

  const detailQuery = useQuery({
    queryKey: queryKeys.session(id),
    queryFn: () => api.get<SessionDetailDto>(`/api/sessions/${id}`, SessionDetailDtoSchema),
    enabled: supported,
  });
  const detail = detailQuery.data;
  const sessionState = detail?.session.state;

  useEffect(() => {
    if (
      sessionState === 'PATIENT_REVIEW' ||
      sessionState === 'SUBMITTED' ||
      sessionState === 'CLINICIAN_REVIEWED'
    ) {
      navigate(`/patient/session/${id}/review`, { replace: true });
    }
  }, [sessionState, id, navigate]);

  const setSpeakAnswers = (on: boolean) => {
    setSpeak(on);
    storeSpeakAnswers(on);
  };

  if (!supported) {
    return (
      <div className="mx-auto w-full max-w-[42rem] px-4 pt-14">
        <h1 className="text-[1.75rem] leading-tight">Video sessions are not available here</h1>
        <p className="mt-2 text-[1.1875rem] text-muted-foreground">
          This browser cannot play the companion's voice. Your text conversation works the same way,
          with the same history.
        </p>
        <Link to={textPath(id)} className={cn(buttonVariants(), 'mt-6 h-12 px-6 text-[1.0625rem]')}>
          Continue in text
        </Link>
      </div>
    );
  }
  if (detailQuery.isError && !detail) {
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
  if (!detail || !detailQuery.isFetchedAfterMount) {
    return (
      <div role="status" className="mx-auto w-full max-w-[42rem] space-y-4 px-4 pt-14">
        <Skeleton className="h-6 w-4/5" />
        <Skeleton className="h-6 w-3/5" />
        <span className="sr-only">Loading your conversation…</span>
      </div>
    );
  }

  if (phase === 'prejoin') {
    return (
      <PreJoin
        sessionId={id}
        camera={camera}
        dictationSupported={dictationSupported()}
        speakAnswers={speakAnswers}
        onSpeakAnswers={setSpeakAnswers}
        onStart={() => setPhase('call')}
      />
    );
  }
  return (
    <Call
      id={id}
      initial={detail}
      camera={camera}
      speakAnswers={speakAnswers}
      setSpeakAnswers={setSpeakAnswers}
    />
  );
}

interface CallProps {
  id: string;
  initial: SessionDetailDto;
  camera: Camera;
  speakAnswers: boolean;
  setSpeakAnswers: (on: boolean) => void;
}

interface FailedSend {
  text: string;
  mode: InputMode;
  answerFor?: { key: InstrumentItemKey; value: 0 | 1 | 2 | 3 };
}

function Call({ id, initial, camera, speakAnswers, setSpeakAnswers }: CallProps) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const speech = useSpeechOutput();
  const dictation = dictationSupported();

  const lastMessage = initial.messages[initial.messages.length - 1];
  const [progress, setProgress] = useState<ProgressDto>(initial.progress);
  const [pendingItem, setPendingItem] = useState<PendingItemDto | null>(initial.pendingItem);
  const [state, setState] = useState<SessionState>(initial.session.state);
  const [hasPatientMessage, setHasPatientMessage] = useState(
    initial.messages.some((m) => m.sender === 'PATIENT'),
  );
  const [companionText, setCompanionText] = useState(
    lastMessage?.sender === 'COMPANION' ? lastMessage.text : '',
  );
  const [patientText, setPatientText] = useState('');
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<FailedSend | null>(null);
  const [captions, setCaptions] = useState(true);
  const [banner, setBanner] = useState(initial.session.riskLevel === 'elevated');
  const [crisis, setCrisis] = useState<{ message: string; resources: CrisisResource[] } | null>(
    initial.session.state === 'CRISIS_PAUSED'
      ? { message: CRISIS_MESSAGE, resources: CRISIS_RESOURCES }
      : null,
  );
  const [resuming, setResuming] = useState(false);
  const [micBlocked, setMicBlocked] = useState(false);
  const [finish, setFinish] = useState<'idle' | 'working' | 'error'>('idle');
  const [confirmFinish, setConfirmFinish] = useState(false);

  const draftRef = useRef(draft);
  draftRef.current = draft;
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const crisisRef = useRef(crisis !== null);
  const bufRef = useRef('');
  const fullRef = useRef('');
  const dictBase = useRef('');
  const enqueueRef = useRef(speech.enqueue);
  enqueueRef.current = speech.enqueue;
  const speechRef = useRef(speech);
  speechRef.current = speech;
  const sendRef = useRef<(t: string, m: InputMode, a?: FailedSend['answerFor']) => Promise<void>>(
    async () => undefined,
  );

  // The companion greets the patient (or repeats the question they have not answered yet).
  useEffect(() => {
    if (lastMessage?.sender !== 'COMPANION' || crisisRef.current) return;
    if (initial.session.state !== 'INTERVIEWING') return;
    for (const s of allSentences(lastMessage.text)) enqueueRef.current(s);
    speechRef.current.finish();
    return () => speechRef.current.cancel();
    // Runs once per mount; later replies are spoken as they stream in.
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const handleEvent = useCallback(
    (ev: MessageStreamEvent) => {
      switch (ev.event) {
        case 'patient_message':
          setHasPatientMessage(true);
          break;
        case 'safety':
          if (ev.data.showResources) setBanner(true);
          break;
        case 'crisis':
          crisisRef.current = true;
          speechRef.current.cancel();
          bufRef.current = '';
          fullRef.current = '';
          setCompanionText('');
          setState(ev.data.session.state);
          setCrisis({ message: ev.data.message, resources: ev.data.resources });
          setBanner(true);
          camera.disable();
          break;
        case 'token': {
          if (crisisRef.current) break;
          fullRef.current += ev.data.delta;
          setCompanionText(fullRef.current);
          const { sentences, rest } = takeSentences(bufRef.current + ev.data.delta);
          bufRef.current = rest;
          for (const s of sentences) enqueueRef.current(s);
          break;
        }
        case 'companion_message': {
          if (crisisRef.current) break;
          setCompanionText(ev.data.message.text);
          const tail = fullRef.current ? bufRef.current : ev.data.message.text;
          for (const s of allSentences(tail)) enqueueRef.current(s);
          bufRef.current = '';
          fullRef.current = '';
          break;
        }
        case 'done':
          setProgress(ev.data.progress);
          setPendingItem(ev.data.pendingItem);
          break;
        case 'error':
          throw new ApiError(0, ev.data.code, ev.data.message);
      }
    },
    [camera],
  );

  const send = useCallback(
    async (text: string, mode: InputMode, answerFor?: FailedSend['answerFor']) => {
      if (sendingRef.current || !text.trim()) return;
      sendingRef.current = true;
      setSending(true);
      setFailed(null);
      setDraft('');
      setPatientText(text);
      setPendingItem(null);
      speechRef.current.cancel();
      bufRef.current = '';
      fullRef.current = '';
      setCompanionText('');
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await postSse(
          `/api/sessions/${id}/messages`,
          { text, inputMode: mode, ...(answerFor ? { answerFor } : {}) },
          { onEvent: handleEvent, signal: controller.signal },
        );
        void qc.invalidateQueries({ queryKey: queryKeys.session(id) });
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (err instanceof ApiError && err.status === 409) return;
        setFailed({ text, mode, answerFor });
        void qc.invalidateQueries({ queryKey: queryKeys.session(id) });
        toast.error('The companion lost its connection.');
      } finally {
        speechRef.current.finish();
        sendingRef.current = false;
        setSending(false);
      }
    },
    [id, handleEvent, qc],
  );
  sendRef.current = send;

  const interviewing = state === 'INTERVIEWING' && !crisis;
  const patientTurn = interviewing && !sending && !speech.speaking && finish === 'idle';

  const { cancelPause } = useDictation({
    active: speakAnswers && dictation && patientTurn && !micBlocked,
    onSession: () => {
      dictBase.current = draftRef.current;
    },
    onInterim: (t) => setDraft(join(dictBase.current, t)),
    onCommit: () => {
      const t = draftRef.current.trim();
      if (t) void sendRef.current(t, 'VOICE');
    },
    onBlocked: () => {
      setMicBlocked(true);
      setSpeakAnswers(false);
    },
  });

  const interrupt = () => speech.cancel();

  const onDraftChange = (v: string) => {
    setDraft(v);
    cancelPause();
    if (speech.speaking) speech.cancel();
  };

  const resume = async () => {
    setResuming(true);
    try {
      const d = await api.post<SessionDetailDto>(
        `/api/sessions/${id}/resume`,
        { confirmSafe: true },
        SessionDetailDtoSchema,
      );
      qc.setQueryData(queryKeys.session(id), d);
      crisisRef.current = false;
      setState(d.session.state);
      setProgress(d.progress);
      setPendingItem(d.pendingItem);
      setCrisis(null);
      if (d.session.riskLevel === 'elevated') setBanner(true);
    } catch {
      toast.error("We couldn't continue just now. Please try again.");
    } finally {
      setResuming(false);
    }
  };

  const runFinish = useCallback(async () => {
    setConfirmFinish(false);
    speechRef.current.cancel();
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

  const switchToText = async () => {
    abortRef.current?.abort();
    speech.cancel();
    setMode('text');
    try {
      await qc.fetchQuery({
        queryKey: queryKeys.session(id),
        queryFn: () => api.get<SessionDetailDto>(`/api/sessions/${id}`, SessionDetailDtoSchema),
        staleTime: 0,
      });
    } catch {
      /* the text chat loads the session itself */
    }
    navigate(textPath(id));
  };

  const toggleCamera = async () => {
    if (camera.status === 'on') camera.disable();
    else if ((await camera.enable()) === 'denied')
      toast('Camera access is blocked in your browser settings. You can keep going without it.');
  };

  if (finish !== 'idle') {
    return (
      <div className="mx-auto flex w-full max-w-[42rem] flex-1 flex-col justify-center px-4 py-14">
        {finish === 'working' ? (
          <div role="status">
            <h1 className="text-[1.75rem] leading-tight">Preparing your summary…</h1>
            <p className="mt-2 text-[1.1875rem] text-muted-foreground">
              This can take up to a minute. You will read it before anyone else does.
            </p>
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

  const avatarState: AvatarState = crisis
    ? 'idle'
    : speech.speaking
      ? 'speaking'
      : sending
        ? 'thinking'
        : 'listening';
  const caption = crisis
    ? 'Paused'
    : { idle: 'Resting', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking' }[
        avatarState
      ];
  const dictating = speakAnswers && dictation && patientTurn && !micBlocked;

  return (
    <div className="mx-auto w-full max-w-5xl flex-1 px-4 pb-6">
      {banner && (
        <div
          role="region"
          aria-label="Support resources"
          className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-warn-border bg-warn-soft p-3"
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

      <div className="mt-4 grid gap-5 md:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] md:gap-10">
        <section aria-label="Video call" className="md:self-start">
          <div className="relative overflow-hidden rounded-lg border bg-surface">
            <div className="mx-auto aspect-[4/5] h-[36vh] min-h-48 md:h-auto md:w-full">
              <CompanionAvatar
                state={avatarState}
                mouthOpen={speech.mouthOpen}
                className="h-full w-full"
              />
            </div>
            <div className="absolute bottom-2 right-2 w-24 overflow-hidden rounded-md border-2 border-background bg-surface-strong shadow-sm sm:w-32">
              {camera.stream ? (
                <SelfView stream={camera.stream} className="aspect-[4/3] w-full" />
              ) : (
                <div className="flex aspect-[4/3] w-full items-center justify-center px-1 text-center text-[0.75rem] text-muted-foreground">
                  Camera off
                </div>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <p className="font-medium">Your companion</p>
            <p role="status" className="text-[0.9375rem] text-muted-foreground">
              {caption}
            </p>
          </div>
        </section>

        <div className="min-w-0 space-y-5">
          <Captions
            companion={companionText}
            patient={patientText}
            visible={captions}
            thinking={sending}
          />

          {interviewing && pendingItem && !sending && (
            <fieldset className="space-y-3">
              <legend className="font-serif text-[1.25rem] leading-snug">
                {pendingItem.prompt}
              </legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {pendingItem.options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className="flex min-h-12 items-center gap-3 rounded-lg border border-input bg-background px-4 py-2 text-left text-[1.0625rem] leading-snug outline-none transition-colors duration-150 ease-out hover:border-primary hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring active:bg-surface-strong"
                    onClick={() =>
                      void send(o.label, 'TAP', { key: pendingItem.key, value: o.value })
                    }
                  >
                    <span
                      aria-hidden="true"
                      className="size-4 shrink-0 rounded-full border-2 border-input"
                    />
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {failed && (
            <div role="alert" className="flex flex-wrap items-center gap-3">
              <p className="text-base">Your answer was not sent.</p>
              <Button
                variant="outline"
                className="h-11"
                onClick={() => void send(failed.text, failed.mode, failed.answerFor)}
              >
                Send again
              </Button>
            </div>
          )}

          {micBlocked && (
            <p role="alert" className="text-base">
              Speech input is blocked in your browser. You can type your answers instead.
            </p>
          )}
          {dictating && (
            <p role="status" className="text-base text-muted-foreground">
              Listening to you. I will send your words after a pause.
            </p>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (interviewing && draft.trim())
                void send(draft.trim(), dictating ? 'VOICE' : 'TEXT');
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <textarea
              aria-label="Your message"
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (interviewing && !sending && draft.trim()) void send(draft.trim(), 'TEXT');
                }
              }}
              disabled={sending || !interviewing}
              rows={1}
              maxLength={4000}
              placeholder="Type your answer here"
              className="min-h-14 w-full flex-1 basis-full resize-none rounded-lg border border-input bg-background px-4 py-3 text-[1.0625rem] leading-relaxed outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:bg-surface disabled:opacity-60 sm:basis-0"
            />
            <Button
              type="submit"
              aria-label="Send message"
              disabled={sending || !interviewing || !draft.trim()}
              className="h-14 flex-1 px-5 text-base sm:flex-none"
            >
              <Send aria-hidden="true" className="size-5" />
              <span aria-hidden="true">Send</span>
            </Button>
          </form>
        </div>
      </div>

      <div className="mt-6 space-y-2 border-t pt-4">
        <CallControls
          dictationSupported={dictation && !micBlocked}
          speakAnswers={speakAnswers}
          onToggleSpeak={() => setSpeakAnswers(!speakAnswers)}
          cameraStatus={camera.status}
          onToggleCamera={() => void toggleCamera()}
          captions={captions}
          onToggleCaptions={() => setCaptions((c) => !c)}
          companionSpeaking={speech.speaking}
          onInterrupt={interrupt}
          onSwitchToText={() => void switchToText()}
          onFinish={() => {
            if (!progress.canFinish) setConfirmFinish(true);
            else void runFinish();
          }}
          finishDisabled={!hasPatientMessage || sending}
        />
        <p className="text-[0.8125rem] text-muted-foreground">
          {PRIVACY_LINE} AI companion, not a doctor. You can skip any question.
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
