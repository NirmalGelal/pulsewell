import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ModalShell } from '@/components/ModalShell';

interface Props {
  title: string;
  patientName: string;
  email?: string;
  password: string;
  onDone: () => void;
}

/** One-time reveal. No Escape or backdrop dismissal: closing is an explicit, acknowledged action. */
export function TemporaryPasswordReveal({ title, patientName, email, password, onDone }: Props) {
  const titleId = useId();
  const bodyId = useId();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
    } catch {
      toast.error('Could not copy. Select the password and copy it by hand.');
    }
  };

  return (
    <ModalShell role="alertdialog" labelledBy={titleId} describedBy={bodyId} className="max-w-lg">
      <h2 id={titleId} className="text-[1.4375rem] leading-tight">
        {title}
      </h2>
      <div id={bodyId} className="mt-3 space-y-3 text-[0.9375rem] leading-relaxed">
        <p>
          Temporary password for <span className="font-medium">{patientName}</span>
          {email ? (
            <>
              {' '}
              (<span className="tabular-nums">{email}</span>)
            </>
          ) : null}
          :
        </p>
        <div className="flex items-center gap-2">
          <code
            aria-label="Temporary password"
            className="flex-1 select-all rounded-lg border bg-surface px-3 py-2.5 text-center font-mono text-[1.4375rem] tracking-wider"
          >
            {password}
          </code>
          <Button type="button" variant="outline" size="lg" onClick={copy}>
            {copied ? 'Copied' : 'Copy password'}
          </Button>
        </div>
        <p className="text-muted-foreground">
          Share this with the patient in person or by phone. Do not send it by email or text
          message. They must choose a new password the first time they log in.
        </p>
        <p className="rounded-lg border border-warn-border bg-warn-soft px-3 py-2 font-medium">
          This password will not be shown again. If it is lost, reset the password to get a new one.
        </p>
      </div>
      <div className="mt-6 flex justify-end">
        <Button size="lg" onClick={onDone} data-autofocus>
          I have shared the password
        </Button>
      </div>
    </ModalShell>
  );
}
