import { cn } from '@/lib/utils';

interface CaptionsProps {
  companion: string;
  patient: string;
  visible: boolean;
  thinking: boolean;
}

/** Live captions. The companion's words are serif and large; they stay in the a11y tree when hidden. */
export function Captions({ companion, patient, visible, thinking }: CaptionsProps) {
  return (
    <div aria-live="polite" aria-label="Captions" role="log" className="space-y-4">
      <p
        className={cn(
          'min-h-[4.5rem] whitespace-pre-wrap font-serif text-[1.5rem] leading-[1.45]',
          !visible && 'sr-only',
        )}
      >
        <span className="sr-only">Companion: </span>
        {companion || (thinking ? <span className="text-muted-foreground">…</span> : '')}
      </p>
      {patient && (
        <p
          className={cn(
            'whitespace-pre-wrap text-[1.0625rem] leading-relaxed text-muted-foreground',
            !visible && 'sr-only',
          )}
        >
          <span>You said: </span>
          {patient}
        </p>
      )}
    </div>
  );
}
