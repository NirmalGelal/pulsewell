import { useId, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ModalShell } from './ModalShell';

interface ConfirmDialogProps {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  cancelLabel = 'Cancel',
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const bodyId = useId();
  return (
    <ModalShell role="alertdialog" labelledBy={titleId} describedBy={bodyId} onEscape={onCancel}>
      <h2 id={titleId} className="text-[1.4375rem] leading-tight">
        {title}
      </h2>
      <div id={bodyId} className="mt-3 text-base leading-relaxed text-muted-foreground">
        {children}
      </div>
      <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="outline" size="lg" onClick={onCancel} disabled={busy}>
          {cancelLabel}
        </Button>
        <Button size="lg" onClick={onConfirm} disabled={busy} data-autofocus>
          {confirmLabel}
        </Button>
      </div>
    </ModalShell>
  );
}
