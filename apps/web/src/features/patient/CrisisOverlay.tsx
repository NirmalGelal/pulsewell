import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ModalShell } from '@/components/ModalShell';
import type { CrisisResource } from '@pvc/shared';

interface CrisisOverlayProps {
  message: string;
  resources: CrisisResource[];
  busy: boolean;
  onResume: () => void;
  onFinish: () => void;
}

/**
 * Full-screen, non-dismissable overlay. The only ways out are the two explicit actions below.
 * No close button, no Escape handler.
 */
export function CrisisOverlay({
  message,
  resources,
  busy,
  onResume,
  onFinish,
}: CrisisOverlayProps) {
  const titleId = useId();
  const bodyId = useId();
  const [confirming, setConfirming] = useState(false);
  const confirmRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  return (
    <ModalShell
      role="alertdialog"
      labelledBy={titleId}
      describedBy={bodyId}
      fullScreen
      className="my-auto max-w-xl border-2 border-danger p-6 shadow-none sm:p-8"
    >
      <h2 id={titleId} className="text-[1.75rem] leading-tight">
        Let's get you support right now
      </h2>
      <p id={bodyId} className="mt-4 text-[1.1875rem] leading-relaxed">
        {message}
      </p>
      <ul className="mt-6 space-y-3">
        {resources.map((r, i) => (
          <li key={r.id}>
            <a
              href={r.href}
              data-autofocus={i === 0 ? '' : undefined}
              className="block rounded-lg bg-danger px-5 py-4 text-danger-foreground outline-none transition-colors hover:bg-[color-mix(in_oklch,var(--danger),black_12%)] focus-visible:ring-4 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="block text-[1.1875rem] font-semibold">{r.name}</span>
              <span className="block text-[1.0625rem]">{r.action}</span>
            </a>
          </li>
        ))}
      </ul>

      {confirming ? (
        <div className="mt-8 border-t pt-6">
          <h3 ref={confirmRef} tabIndex={-1} className="text-[1.4375rem] outline-none">
            Are you safe right now?
          </h3>
          <p className="mt-2 text-base text-muted-foreground">
            If you are not safe, please use one of the options above. If you are, we can continue
            together.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" className="h-12" onClick={onResume} disabled={busy}>
              Yes, I'm safe. Continue
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="h-12"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              Go back
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-8 flex flex-col gap-3 border-t pt-6">
          <Button
            variant="outline"
            size="lg"
            className="h-12"
            onClick={() => setConfirming(true)}
            disabled={busy}
          >
            I'm safe right now. Continue
          </Button>
          <Button variant="ghost" size="lg" className="h-12" onClick={onFinish} disabled={busy}>
            Finish and send what I've shared
          </Button>
        </div>
      )}
    </ModalShell>
  );
}
