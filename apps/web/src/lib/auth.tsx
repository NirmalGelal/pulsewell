import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Navigate } from 'react-router-dom';
import { UserDtoSchema, type Role, type UserDto } from '@pvc/shared';
import { z } from 'zod';
import { api, clearToken, getToken, setToken, setUnauthorizedHandler } from './api';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: UserDto | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<UserDto>;
  logout: () => void;
  /** Replace the cached user, e.g. after a password change clears `mustChangePassword`. */
  updateUser: (user: UserDto) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const LoginResponseSchema = z.object({ token: z.string(), user: UserDtoSchema });
const MeResponseSchema = z.object({ user: UserDtoSchema });

export const homeFor = (role: Role): string =>
  role === 'CLINICIAN' ? '/clinician' : role === 'PATIENT' ? '/patient' : '/login';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [status, setStatus] = useState<AuthStatus>(() =>
    getToken() ? 'loading' : 'unauthenticated',
  );

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setStatus('unauthenticated');
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    let cancelled = false;
    api
      .get('/api/auth/me', MeResponseSchema)
      .then((r) => {
        if (cancelled) return;
        setUser(r.user);
        setStatus('authenticated');
      })
      .catch(() => {
        if (cancelled) return;
        clearToken();
        setUser(null);
        setStatus('unauthenticated');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post('/api/auth/login', { email, password }, LoginResponseSchema);
    setToken(r.token);
    setUser(r.user);
    setStatus('authenticated');
    return r.user;
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const updateUser = useCallback((u: UserDto) => setUser(u), []);

  const value = useMemo(
    () => ({ user, status, login, logout, updateUser }),
    [user, status, login, logout, updateUser],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user, status } = useAuth();
  if (status === 'loading')
    return (
      <p role="status" className="p-8 text-center text-muted-foreground">
        Loading…
      </p>
    );
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to={homeFor(user.role)} replace />;
  return <>{children}</>;
}
