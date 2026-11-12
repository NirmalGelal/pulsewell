import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { homeFor, useAuth } from '@/lib/auth';

export default function Login() {
  const { user, login, status } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'authenticated' && user) return <Navigate to={homeFor(user.role)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email.trim(), password);
      navigate(homeFor(u.role), { replace: true });
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'That email or password is not right. Please try again.'
          : err instanceof ApiError
            ? err.message
            : 'Something went wrong. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[26rem] flex-col justify-center px-5 py-10">
      <p className="font-serif text-[1.1875rem] font-medium tracking-tight text-primary">
        Patient Voice<span className="text-muted-foreground"> Companion</span>
      </p>
      <h1 className="mt-10 text-[2.125rem] leading-tight">Log in to continue</h1>
      <p className="mt-3 text-muted-foreground">
        You will see a summary of your conversation and decide what is shared before your clinician
        reads it.
      </p>
      <form onSubmit={submit} className="mt-8 space-y-5">
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-[0.9375rem] font-medium">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-12 text-base"
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="password" className="block text-[0.9375rem] font-medium">
            Password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-12 text-base"
          />
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-lg border border-warn-border bg-warn-soft px-4 py-3 text-[0.9375rem]"
          >
            {error}
          </p>
        )}
        <Button type="submit" disabled={busy} className="h-12 w-full text-base">
          {busy ? 'Logging in…' : 'Log in'}
        </Button>
        {import.meta.env.DEV && (
          <p className="border-t pt-4 text-[0.8125rem] text-muted-foreground tabular-nums">
            Demo: patient@demo.test / demo1234
          </p>
        )}
      </form>
    </main>
  );
}
