import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ResetPasswordResponseSchema } from '@pvc/shared';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { TemporaryPasswordReveal } from './TemporaryPasswordReveal';

export function ResetPasswordButton({
  patientId,
  patientName,
}: {
  patientId: string;
  patientName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const reset = useMutation({
    mutationFn: () =>
      api.post(
        `/api/clinician/patients/${patientId}/reset-password`,
        {},
        ResetPasswordResponseSchema,
      ),
    onSuccess: (r) => {
      setConfirming(false);
      setPassword(r.temporaryPassword);
    },
    onError: () => setError(true),
    gcTime: 0,
  });
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setError(false);
          setConfirming(true);
        }}
      >
        Reset password
      </Button>
      {confirming && (
        <ConfirmDialog
          title="Reset this password?"
          confirmLabel="Reset password"
          busy={reset.isPending}
          onConfirm={() => reset.mutate()}
          onCancel={() => setConfirming(false)}
        >
          <p>
            {patientName}&apos;s current password stops working right away. You will get a new
            temporary password to share, and they must choose their own at next login.
          </p>
          {error && (
            <p role="alert" className="mt-2 text-danger">
              Couldn&apos;t reset the password. Please try again.
            </p>
          )}
        </ConfirmDialog>
      )}
      {password && (
        <TemporaryPasswordReveal
          title="Password reset"
          patientName={patientName}
          password={password}
          onDone={() => setPassword(null)}
        />
      )}
    </>
  );
}
