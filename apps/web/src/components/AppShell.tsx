import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Wordmark } from '@/components/Wordmark';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';

interface AppShellProps {
  variant: 'patient' | 'clinician';
  children: ReactNode;
  /** Extra controls rendered in the header, left of the user name. */
  actions?: ReactNode;
}

export function AppShell({ variant, children, actions }: AppShellProps) {
  const { user, logout } = useAuth();
  const patient = variant === 'patient';
  return (
    <div className={cn('flex min-h-screen flex-col bg-background', !patient && 'text-[0.9rem]')}>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[var(--z-modal)] focus:rounded-md focus:border focus:bg-background focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className={cn('border-b bg-background', patient ? 'py-3' : 'py-2')}>
        <div
          className={cn(
            'mx-auto flex items-center justify-between gap-3 px-4',
            patient ? 'max-w-[42rem]' : 'max-w-none sm:px-6',
          )}
        >
          <Wordmark />
          <div className="flex items-center gap-2">
            {actions}
            {user && (
              <span className="hidden text-[0.9375rem] text-muted-foreground sm:inline">
                {user.displayName}
              </span>
            )}
            <Button
              variant="ghost"
              size={patient ? 'default' : 'sm'}
              onClick={logout}
              aria-label="Log out"
            >
              <LogOut aria-hidden="true" />
              <span>Log out</span>
            </Button>
          </div>
        </div>
      </header>
      <main id="main" className="flex flex-1 flex-col outline-none" tabIndex={-1}>
        {children}
      </main>
    </div>
  );
}
