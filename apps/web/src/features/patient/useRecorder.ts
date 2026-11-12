import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderStart = 'ok' | 'denied' | 'unsupported' | 'error';

export function recordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

interface Options {
  /** Called with the finished recording (also after the max-length auto stop). */
  onStop: (audio: Blob) => void;
  maxSeconds?: number;
}

/** MediaRecorder wrapper: webm/opus when available, 120 s cap, optional input level for the UI. */
export function useRecorder({ onStop, maxSeconds = 120 }: Options) {
  const [state, setState] = useState<'idle' | 'recording'>('idle');
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const cleanupRef = useRef<() => void>(() => undefined);
  const onStopRef = useRef(onStop);
  onStopRef.current = onStop;

  const stop = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== 'inactive') r.stop();
  }, []);

  const start = useCallback(async (): Promise<RecorderStart> => {
    if (!recordingSupported()) return 'unsupported';
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      return name === 'NotAllowedError' ||
        name === 'SecurityError' ||
        name === 'PermissionDeniedError'
        ? 'denied'
        : 'error';
    }
    try {
      const preferred = 'audio/webm;codecs=opus';
      const mimeType = MediaRecorder.isTypeSupported?.(preferred) ? preferred : undefined;
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      const chunks: Blob[] = [];
      let audioCtx: AudioContext | null = null;
      let raf = 0;
      const timers: { tick?: ReturnType<typeof setInterval> } = {};

      const teardown = () => {
        if (timers.tick) clearInterval(timers.tick);
        if (raf) cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        void audioCtx?.close().catch(() => undefined);
        setLevel(0);
        setElapsed(0);
        setState('idle');
        recorderRef.current = null;
      };
      cleanupRef.current = teardown;

      recorder.ondataavailable = (e: BlobEvent) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mimeType || 'audio/webm';
        teardown();
        cleanupRef.current = () => undefined;
        onStopRef.current(new Blob(chunks, { type }));
      };

      if (typeof AudioContext !== 'undefined') {
        try {
          audioCtx = new AudioContext();
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          audioCtx.createMediaStreamSource(stream).connect(analyser);
          const data = new Uint8Array(analyser.frequencyBinCount);
          const tick = () => {
            analyser.getByteTimeDomainData(data);
            let peak = 0;
            for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
            setLevel(Math.min(1, peak / 64));
            raf = requestAnimationFrame(tick);
          };
          tick();
        } catch {
          /* level meter is optional */
        }
      }

      recorderRef.current = recorder;
      recorder.start();
      setState('recording');
      const startedAt = Date.now();
      timers.tick = setInterval(() => {
        const secs = Math.floor((Date.now() - startedAt) / 1000);
        setElapsed(secs);
        if (secs >= maxSeconds) stop();
      }, 500);
      return 'ok';
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      return 'error';
    }
  }, [maxSeconds, stop]);

  useEffect(
    () => () => {
      const r = recorderRef.current;
      if (r) {
        r.onstop = null;
        if (r.state !== 'inactive') r.stop();
      }
      cleanupRef.current();
    },
    [],
  );

  return { start, stop, state, level, elapsed };
}
