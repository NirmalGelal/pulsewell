import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

export const PRIVACY_LINE = 'Your video stays on your device and is not recorded.';

/** Mirrored local preview. Muted, never recorded, never sent anywhere. */
export function SelfView({ stream, className }: { stream: MediaStream; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.srcObject = stream;
    return () => {
      if (el) el.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={ref}
      autoPlay
      muted
      playsInline
      aria-label="Your camera preview"
      className={cn('-scale-x-100 bg-surface-strong object-cover', className)}
    />
  );
}
