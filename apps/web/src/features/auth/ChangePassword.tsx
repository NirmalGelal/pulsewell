import { useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ChangePasswordRequestSchema, MIN_PASSWORD_LENGTH, UserDtoSchema } from '@pvc/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';

const ResponseSchema = z.object({ user: UserDtoSchema });

/** Renders `children` only once the signed-in user no longer has to change a temporary password. */
export function PasswordChangeGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.mustChangePassword) return <ChoosePassword />;
  return <>{children}</>;
}

export function ChoosePassword() {
  const { updateUser, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < MIN_PASSWORD_LENGTH)
      return setError(`Your new password needs at least ${MIN_PASSWORD_LENGTH} characters.`);
    if (next !== confirm) return setError('The two new passwords do not match.');
    const body = { currentPassword: current, newPassword: next };
    const parsed = ChangePasswordRequestSchema.safeParse(body);
    if (!parsed.success)
      return setError('Choose a new password that is different from the temporary one.');
    setBusy(true);
    setError(null);
    try {
      const r = await api.post('/api/auth/change-password', parsed.data, ResponseSchema);
      updateUser(r.user);
      navigate(homeFor(r.user.role), { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? 'The temporary password is not right. Check it and try again.'
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const type = show ? 'text' : 'password';
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[26rem] flex-col justify-center px-5 py-10">
      <p className="font-serif text-[1.1875rem] font-medium tracking-tight text-primary">
        Patient Voice<span className="text-muted-foreground"> Companion</span>
      </p>
      <h1 className="mt-10 text-[2.125rem] leading-tight">Choose a new password</h1>
      <p className="mt-3 text-muted-foreground">
        You logged in with a temporary password. Pick one only you know. You will use it from now
        on.
      </p>
      <form onSubmit={submit} noValidate className="mt-8 space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="cp-current" className="block text-[0.9375rem] font-medium">
            Temporary password
          </label>
          <Input
            id="cp-current"
            type={type}
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            className="h-12 text-base"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="cp-new" className="block text-[0.9375rem] font-medium">
            New password
          </label>
          <Input
            id="cp-new"
            type={type}
            autoComplete="new-password"
            aria-describedby="cp-hint"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            className="h-12 text-base"
          />
          <p id="cp-hint" className="text-[0.8125rem] text-muted-foreground">
            At least {MIN_PASSWORD_LENGTH} characters. A few words in a row works well.
          </p>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="cp-confirm" className="block text-[0.9375rem] font-medium">
            Confirm new password
          </label>
          <Input
            id="cp-confirm"
            type={type}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="h-12 text-base"
          />
        </div>
        <label className="flex items-center gap-2 text-[0.9375rem]">
          <input
            type="checkbox"
            checked={show}
            onChange={(e) => setShow(e.target.checked)}
            className="size-4"
          />
          Show passwords
        </label>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-warn-border bg-warn-soft px-4 py-3 text-[0.9375rem]"
          >
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="h-12 w-full text-base">
          {busy ? 'Saving…' : 'Save new password'}
        </Button>
        <button
          type="button"
          onClick={logout}
          className="block text-[0.9375rem] text-muted-foreground underline underline-offset-4"
        >
          Log out
        </button>
      </form>
    </main>
  );
}
