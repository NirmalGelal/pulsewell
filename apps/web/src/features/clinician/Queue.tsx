import { useState, type KeyboardEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { QueueItemDto } from '@pvc/shared';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { clinicianKeys, QueueResponseSchema, relativeTime, RiskBadge } from './common';

function Trend({ delta }: { delta: number | null | undefined }) {
  if (delta === null || delta === undefined) return null;
  if (delta === 0)
    return (
      <span className="text-xs text-muted-foreground" aria-label="no change">
        ±0
      </span>
    );
  return (
    <span
      className={cn('text-xs font-medium', delta < 0 ? 'text-ok' : 'text-warn')}
      aria-label={`${delta < 0 ? 'down' : 'up'} ${Math.abs(delta)}`}
    >
      {delta < 0 ? '▼' : '▲'}
      {Math.abs(delta)}
    </span>
  );
}

const bandLabel = (band: string | null) =>
  band ? band.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : '';

function Score({
  total,
  band,
  delta,
}: {
  total: number | null;
  band: string | null;
  delta?: number | null;
}) {
  if (total === null)
    return (
      <span className="whitespace-nowrap">
        <span className="text-muted-foreground">—</span>{' '}
        <span className="text-[0.8125rem] text-muted-foreground">Incomplete</span>
      </span>
    );
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
      <strong className="w-5 text-right font-semibold tabular-nums">{total}</strong>
      <span className="text-[0.8125rem] text-muted-foreground">{bandLabel(band)}</span>
      <Trend delta={delta} />
    </span>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const TH = 'px-3 py-2 text-[0.8125rem] font-medium text-muted-foreground';

export function QueueTable({
  items,
  empty = 'No reports waiting.',
}: {
  items: QueueItemDto[];
  empty?: string;
}) {
  const navigate = useNavigate();
  if (items.length === 0)
    return (
      <div className="px-4 py-10">
        <p className="font-serif text-lg">{empty}</p>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Reports appear here after a patient approves what to share.
        </p>
      </div>
    );
  const open = (id: string) => navigate(`/clinician/reports/${id}`);
  const onKey = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter') open(id);
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[60rem] border-collapse text-left text-sm">
        <thead className="bg-surface">
          <tr className="border-b">
            <th scope="col" className={TH}>
              Patient
            </th>
            <th scope="col" className={TH}>
              Risk
            </th>
            <th scope="col" className={TH}>
              PHQ-9
            </th>
            <th scope="col" className={TH}>
              GAD-7
            </th>
            <th scope="col" className={TH}>
              Top priority
            </th>
            <th scope="col" className={TH}>
              Approved
            </th>
            <th scope="col" className={TH}>
              Status
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr
              key={it.reportId}
              tabIndex={0}
              onClick={() => open(it.reportId)}
              onKeyDown={(e) => onKey(e, it.reportId)}
              aria-label={`Open report for ${it.patient.displayName}`}
              className={cn(
                'cursor-pointer border-b transition-colors duration-150 last:border-b-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                it.hasUnacknowledgedAlert
                  ? 'bg-danger-soft hover:bg-danger-soft/70'
                  : 'hover:bg-surface',
                it.reviewed && 'text-muted-foreground',
              )}
            >
              <td className="whitespace-nowrap px-3 py-2.5 font-medium">
                {it.patient.displayName}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5">
                <RiskBadge level={it.riskLevel} alert={it.hasUnacknowledgedAlert} />
              </td>
              <td className="px-3 py-2.5">
                <Score {...it.phq9} delta={it.trend?.phq9Delta} />
              </td>
              <td className="px-3 py-2.5">
                <Score {...it.gad7} delta={it.trend?.gad7Delta} />
              </td>
              <td className="max-w-[22rem] px-3 py-2.5">
                {it.topPriority ? truncate(it.topPriority, 80) : '—'}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">
                {relativeTime(it.approvedAt)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5">
                {it.reviewed ? (
                  <span className="inline-flex items-center gap-1 text-ok">
                    <Check className="size-3.5" aria-hidden="true" />
                    Reviewed
                  </span>
                ) : (
                  <span className="font-medium text-foreground">Needs review</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Queue() {
  const [tab, setTab] = useState<'needs' | 'all'>('needs');
  const q = useQuery({
    queryKey: clinicianKeys.queue,
    queryFn: () => api.get('/api/clinician/queue', QueueResponseSchema),
  });
  const items = q.data?.items ?? [];
  const pending = items.filter((i) => !i.reviewed);
  const shown = tab === 'needs' ? pending : items;
  const alerts = pending.filter((i) => i.hasUnacknowledgedAlert).length;
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-[1.75rem] leading-tight">Review queue</h1>
          {q.data && (
            <p className="mt-0.5 text-sm text-muted-foreground tabular-nums">
              {pending.length} to review
              {alerts > 0 && `, ${alerts} with an unacknowledged alert`}
            </p>
          )}
        </div>
        <div
          role="tablist"
          aria-label="Queue filter"
          className="flex gap-0.5 rounded-lg bg-surface-strong p-0.5"
        >
          {(
            [
              ['needs', 'Needs review'],
              ['all', 'All'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              role="tab"
              type="button"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                'rounded-md px-3 py-1 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                tab === k
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-lg border">
        {q.isPending ? (
          <div role="status" aria-label="Loading the queue" className="flex flex-col gap-px p-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-9 animate-pulse rounded bg-surface" />
            ))}
          </div>
        ) : q.isError ? (
          <p role="alert" className="p-6 text-danger">
            Couldn&apos;t load the queue. Refresh the page to try again.
          </p>
        ) : (
          <QueueTable items={shown} />
        )}
      </div>
    </div>
  );
}
