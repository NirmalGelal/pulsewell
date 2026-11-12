import { AlertOctagon, AlertTriangle, Bell, CircleDot, Minus } from 'lucide-react';
import { z } from 'zod';
import { QueueItemDtoSchema, type RiskLevel } from '@pvc/shared';
import { cn } from '@/lib/utils';

export const QueueResponseSchema = z.object({ items: z.array(QueueItemDtoSchema) });

export const clinicianKeys = {
  queue: ['clinician', 'queue'] as const,
  alerts: ['clinician', 'alerts'] as const,
  patients: ['clinician', 'patients'] as const,
  report: (id: string) => ['clinician', 'report', id] as const,
};

const RISK_STYLE: Record<RiskLevel, string> = {
  imminent: 'bg-danger text-danger-foreground font-semibold',
  elevated: 'border border-danger-border bg-danger-soft text-danger font-semibold',
  concern: 'border border-warn-border bg-warn-soft text-warn font-medium',
  none: 'text-muted-foreground',
};

const RISK_ICON: Record<RiskLevel, typeof Bell> = {
  imminent: AlertOctagon,
  elevated: AlertTriangle,
  concern: CircleDot,
  none: Minus,
};

/** Risk in words and an icon, never color alone. Strong red is only for imminent. */
export function RiskBadge({ level, alert }: { level: RiskLevel; alert?: boolean }) {
  const Icon = RISK_ICON[level];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          'inline-flex h-6 items-center gap-1 rounded px-1.5 text-[0.8125rem]',
          level !== 'none' && 'capitalize',
          RISK_STYLE[level],
        )}
      >
        <Icon className="size-3.5" aria-hidden="true" />
        {level === 'none' ? 'No risk flag' : level}
      </span>
      {alert && (
        <span title="Unacknowledged urgent alert" className="text-danger">
          <Bell className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Unacknowledged alert</span>
        </span>
      )}
    </span>
  );
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} h ago`;
  const days = Math.round(hr / 24);
  if (days < 14) return days === 1 ? 'yesterday' : `${days} days ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** Clickable reference to a transcript turn. */
export function EvidenceChip({
  turnId,
  onJump,
}: {
  turnId: number;
  onJump?: (turnId: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onJump?.(turnId)}
      aria-label={`Show turn ${turnId} in transcript`}
      className={EVIDENCE_CHIP}
    >
      T{turnId}
    </button>
  );
}

export const EVIDENCE_CHIP =
  'inline-flex h-5 items-center rounded-sm bg-mark px-1.5 text-xs font-medium tabular-nums text-mark-foreground transition-colors duration-150 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
