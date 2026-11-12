import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertOctagon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { AlertDtoSchema } from '@pvc/shared';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { clinicianKeys, relativeTime } from './common';

const AlertsResponseSchema = z.object({ alerts: z.array(AlertDtoSchema) });
export const ALERT_POLL_MS = 15000;

export function AlertBanner() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const alerts = useQuery({
    queryKey: clinicianKeys.alerts,
    queryFn: () => api.get('/api/clinician/alerts?status=open', AlertsResponseSchema),
    refetchInterval: ALERT_POLL_MS,
  });
  const ack = useMutation({
    mutationFn: (id: string) => api.post(`/api/clinician/alerts/${id}/ack`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: clinicianKeys.alerts });
      void qc.invalidateQueries({ queryKey: clinicianKeys.queue });
      void qc.invalidateQueries({ queryKey: clinicianKeys.patients });
    },
    onError: () => toast.error("Couldn't acknowledge the alert. Please try again."),
  });

  const open = alerts.data?.alerts.filter((a) => a.acknowledgedAt === null) ?? [];
  if (open.length === 0) return null;
  return (
    <div className="flex flex-col">
      {open.map((a) => (
        <div
          key={a.id}
          role="alert"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-danger bg-danger px-4 py-2.5 text-danger-foreground"
        >
          <AlertOctagon className="size-5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[0.9375rem] leading-snug">
            <strong className="font-semibold">Urgent safety alert: {a.patient.displayName}</strong>
            <span className="mx-2 opacity-60" aria-hidden="true">
              /
            </span>
            <span className="font-serif text-base italic">&ldquo;{a.evidence}&rdquo;</span>
            <span className="ml-2 whitespace-nowrap text-[0.8125rem] tabular-nums opacity-90">
              {relativeTime(a.createdAt)}
            </span>
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={ack.isPending}
              onClick={() => ack.mutate(a.id)}
            >
              Acknowledge alert
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="border-danger-foreground/60 bg-transparent text-danger-foreground hover:bg-danger-foreground/15 hover:text-danger-foreground"
              onClick={() => navigate(`/clinician/patients/${a.patient.id}`)}
            >
              View patient
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
