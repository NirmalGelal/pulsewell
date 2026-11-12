import { cn } from '@/lib/utils';

/** PulseWell typographic wordmark. "Pulse" in ink-blue, "Well" in the muted ink. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'whitespace-nowrap font-serif text-[1.1875rem] font-medium tracking-tight text-primary',
        className,
      )}
    >
      Pulse<span className="text-muted-foreground">Well</span>
    </span>
  );
}
