import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { z } from 'zod';
import { RISK_LEVELS } from '@pvc/shared';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { clinicianKeys, QueueResponseSchema, RiskBadge, formatShortDate } from './common';
import { QueueTable } from './Queue';
import { AddPatientDialog } from './AddPatientDialog';
import { AskPanel, FollowUpDialog } from './panels';
import { ResetPasswordButton } from './ResetPasswordButton';

const PatientsResponseSchema = z.object({
  patients: z.array(
    z.object({
      id: z.string(),
      displayName: z.string(),
      lastApprovedAt: z.string().nullable(),
      riskLevel: z.enum(RISK_LEVELS),
    }),
  ),
});

export function PatientList() {
  const [adding, setAdding] = useState(false);
  const q = useQuery({
    queryKey: clinicianKeys.patients,
    queryFn: () => api.get('/api/clinician/patients', PatientsResponseSchema),
  });
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 sm:px-6">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-[1.75rem] leading-tight">Patients</h1>
        <Button onClick={() => setAdding(true)}>Add patient</Button>
      </div>
      {q.isPending ? (
        <div role="status" aria-label="Loading patients" className="flex flex-col gap-px">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded bg-surface" />
          ))}
        </div>
      ) : q.isError ? (
        <p role="alert" className="text-danger">
          Couldn&apos;t load patients. Refresh the page to try again.
        </p>
      ) : q.data.patients.length === 0 ? (
        <div>
          <p className="font-serif text-lg">No linked patients.</p>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Add a patient to create their account and get a temporary password to share.
          </p>
        </div>
      ) : (
        <ul className="divide-y overflow-hidden rounded-lg border">
          {q.data.patients.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 transition-colors duration-150 hover:bg-surface"
            >
              <Link
                to={`/clinician/patients/${p.id}`}
                className="min-w-40 flex-1 font-medium underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                {p.displayName}
              </Link>
              <RiskBadge level={p.riskLevel} />
              <span className="whitespace-nowrap text-right text-sm tabular-nums text-muted-foreground">
                {p.lastApprovedAt
                  ? `Last approved ${formatShortDate(p.lastApprovedAt)}`
                  : 'No approved reports'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {adding && <AddPatientDialog onClose={() => setAdding(false)} />}
    </div>
  );
}

export function PatientDetail() {
  const { id = '' } = useParams();
  const [followUp, setFollowUp] = useState(false);
  const q = useQuery({
    queryKey: clinicianKeys.queue,
    queryFn: () => api.get('/api/clinician/queue', QueueResponseSchema),
  });
  const patients = useQuery({
    queryKey: clinicianKeys.patients,
    queryFn: () => api.get('/api/clinician/patients', PatientsResponseSchema),
  });
  const items = (q.data?.items ?? []).filter((i) => i.patient.id === id);
  const name =
    patients.data?.patients.find((p) => p.id === id)?.displayName ??
    items[0]?.patient.displayName ??
    'Patient';
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6">
      <p className="mb-1 text-sm">
        <Link to="/clinician/patients" className="text-primary underline underline-offset-2">
          All patients
        </Link>
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex-1 text-[1.75rem] leading-tight">{name}</h1>
        <ResetPasswordButton patientId={id} patientName={name} />
        <Button variant="outline" onClick={() => setFollowUp(true)}>
          Send follow-up questions
        </Button>
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="pt-reports" className="min-w-0">
          <h2 id="pt-reports" className="mb-2 text-lg">
            Approved reports
          </h2>
          <div className="overflow-hidden rounded-lg border">
            <QueueTable items={items} empty="No approved reports for this patient." />
          </div>
        </section>
        <section aria-labelledby="pt-ask" className="min-w-0 rounded-lg bg-surface p-4">
          <h2 id="pt-ask" className="mb-3 text-lg">
            Ask the record
          </h2>
          <AskPanel patientId={id} />
        </section>
      </div>
      {followUp && <FollowUpDialog patientId={id} onClose={() => setFollowUp(false)} />}
    </div>
  );
}
