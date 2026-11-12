import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CreatePatientRequestSchema, CreatePatientResponseSchema } from '@pvc/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ModalShell } from '@/components/ModalShell';
import { ApiError, api } from '@/lib/api';
import { clinicianKeys } from './common';
import { TemporaryPasswordReveal } from './TemporaryPasswordReveal';

export function AddPatientDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Held in component state only; never put in the query cache, storage or the URL.
  const [created, setCreated] = useState<{
    name: string;
    email: string;
    password: string;
  } | null>(null);

  const create = useMutation({
    mutationFn: (body: { email: string; displayName: string }) =>
      api.post('/api/clinician/patients', body, CreatePatientResponseSchema),
    onSuccess: (r) => {
      setCreated({
        name: r.patient.displayName,
        email: r.patient.email,
        password: r.temporaryPassword,
      });
      void qc.invalidateQueries({ queryKey: clinicianKeys.patients });
    },
    onError: (e) =>
      setError(
        e instanceof ApiError && e.status === 409
          ? 'An account with that email already exists.'
          : "Couldn't create the account. Please try again.",
      ),
    gcTime: 0,
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const parsed = CreatePatientRequestSchema.safeParse({ email, displayName });
    if (!parsed.success) {
      const fields = parsed.error.issues.map((i) => i.path[0]);
      setError(
        fields.includes('email')
          ? 'Enter a valid email address.'
          : 'Enter a name of 1 to 80 characters.',
      );
      return;
    }
    setError(null);
    create.mutate(parsed.data);
  };

  if (created)
    return (
      <TemporaryPasswordReveal
        title="Account created"
        patientName={created.name}
        email={created.email}
        password={created.password}
        onDone={onClose}
      />
    );

  return (
    <ModalShell labelledBy="ap-title" onEscape={onClose} className="max-w-md">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div>
          <h2 id="ap-title" className="text-xl">
            Add patient
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            We create the account and give you a temporary password to share. The patient chooses
            their own password at first login, and is linked to you.
          </p>
        </div>
        <div className="space-y-1">
          <label htmlFor="ap-name" className="block text-sm font-medium">
            Patient name
          </label>
          <Input
            id="ap-name"
            data-autofocus
            autoComplete="off"
            maxLength={80}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="ap-email" className="block text-sm font-medium">
            Patient email
          </label>
          <Input
            id="ap-email"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create account'}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}
