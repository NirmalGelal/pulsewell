import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalShellProps {
  role?: 'dialog' | 'alertdialog';
  labelledBy: string;
  describedBy?: string;
  /** Called on Escape. Omit to make the modal impossible to dismiss with the keyboard. */
  onEscape?: () => void;
  fullScreen?: boolean;
  className?: string;
  children: ReactNode;
}

/** Accessible modal with a focus trap. Focus starts on `[data-autofocus]` (else the first focusable) and returns on unmount. */
export function ModalShell({
  role = 'dialog',
  labelledBy,
  describedBy,
  onEscape,
  fullScreen,
  className,
  children,
}: ModalShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  const escapeRef = useRef(onEscape);
  escapeRef.current = onEscape;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const root = ref.current;
    if (root) {
      const target =
        root.querySelector<HTMLElement>('[data-autofocus]') ??
        root.querySelector<HTMLElement>(FOCUSABLE);
      (target ?? root).focus();
    }
    return () => previous?.focus?.();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      if (escapeRef.current) {
        e.stopPropagation();
        escapeRef.current();
      } else e.preventDefault();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = ref.current;
    if (!root) return;
    const items = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !root.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !root.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-foreground/40 p-4',
        fullScreen && 'overflow-y-auto bg-background',
      )}
    >
      <div
        ref={ref}
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className={cn(
          'w-full max-w-md rounded-xl border bg-card p-6 text-card-foreground shadow-md outline-none',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
