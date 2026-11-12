import { useCallback, useEffect, useRef } from 'react';

interface RecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort?(): void;
}
type RecognitionCtor = new () => RecognitionLike;

function getCtor(): RecognitionCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

/** Browser-native dictation only. Nothing is recorded by the app; the browser returns text. */
export const dictationSupported = (): boolean => !!getCtor();

export const PAUSE_MS = 1600;
const RESTART_MS = 250;

interface Options {
  /** Dictation should be running (the patient's turn and 'Speak my answers' is on). */
  active: boolean;
  pauseMs?: number;
  /** A new recognition run begins: snapshot the current draft as its base. */
  onSession: () => void;
  onInterim: (text: string) => void;
  /** The patient paused after speaking: the text is ready to send. */
  onCommit: () => void;
  onBlocked: () => void;
}

export function useDictation({
  active,
  pauseMs = PAUSE_MS,
  onSession,
  onInterim,
  onCommit,
  onBlocked,
}: Options) {
  const cb = useRef({ onSession, onInterim, onCommit, onBlocked });
  cb.current = { onSession, onInterim, onCommit, onBlocked };
  const recRef = useRef<RecognitionLike | null>(null);
  const pauseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;
  const blocked = useRef(false);

  const clearPause = useCallback(() => {
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    pauseTimer.current = null;
  }, []);

  useEffect(() => {
    const Ctor = getCtor();
    if (!active || !Ctor) return;
    let cancelled = false;

    const run = () => {
      if (cancelled || blocked.current) return;
      const rec = new Ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = navigator.language || 'en-US';
      rec.onresult = (e) => {
        let text = '';
        for (let i = 0; i < e.results.length; i++) text += e.results[i]![0]!.transcript;
        cb.current.onInterim(text.trim());
        clearPause();
        pauseTimer.current = setTimeout(() => {
          pauseTimer.current = null;
          rec.onend = null;
          try {
            (rec.abort ?? rec.stop).call(rec);
          } catch {
            /* already stopped */
          }
          recRef.current = null;
          cb.current.onCommit();
        }, pauseMs);
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          blocked.current = true;
          cb.current.onBlocked();
        }
      };
      rec.onend = () => {
        recRef.current = null;
        clearPause();
        if (!cancelled && activeRef.current && !blocked.current) {
          restartTimer.current = setTimeout(run, RESTART_MS);
        }
      };
      recRef.current = rec;
      cb.current.onSession();
      try {
        rec.start();
      } catch {
        recRef.current = null;
      }
    };
    run();

    return () => {
      cancelled = true;
      clearPause();
      if (restartTimer.current) clearTimeout(restartTimer.current);
      const rec = recRef.current;
      recRef.current = null;
      if (rec) {
        rec.onend = null;
        rec.onresult = null;
        try {
          (rec.abort ?? rec.stop).call(rec);
        } catch {
          /* ignore */
        }
      }
    };
  }, [active, pauseMs, clearPause]);

  return { cancelPause: clearPause };
}
