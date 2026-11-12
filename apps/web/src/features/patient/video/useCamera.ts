import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraStatus = 'off' | 'requesting' | 'on' | 'denied' | 'unavailable';

/**
 * Optional, strictly local camera for the self-view tile. The stream is only ever attached to a
 * <video> element: it is never recorded, uploaded, or read by any other code.
 */
export function useCamera() {
  const [status, setStatus] = useState<CameraStatus>('off');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const alive = useRef(true);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const enable = useCallback(async (): Promise<CameraStatus> => {
    if (streamRef.current) return 'on';
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setStatus('unavailable');
      return 'unavailable';
    }
    setStatus('requesting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (!alive.current) {
        s.getTracks().forEach((t) => t.stop());
        return 'off';
      }
      streamRef.current = s;
      setStream(s);
      setStatus('on');
      return 'on';
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      const next: CameraStatus =
        name === 'NotFoundError' || name === 'OverconstrainedError' ? 'unavailable' : 'denied';
      if (alive.current) setStatus(next);
      return next;
    }
  }, []);

  const disable = useCallback(() => {
    stop();
    setStatus('off');
  }, [stop]);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return { status, stream, enable, disable };
}
export type Camera = ReturnType<typeof useCamera>;
