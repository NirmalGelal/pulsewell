import { Link, Navigate, Route, Routes } from 'react-router-dom';
import ClinicianRoutes from '@/features/clinician/ClinicianRoutes';
import Login from '@/features/auth/Login';
import PatientRoutes from '@/features/patient/PatientRoutes';
import { homeFor, RequireRole, useAuth } from '@/lib/auth';

function RootRedirect() {
  const { user, status } = useAuth();
  if (status === 'loading')
    return (
      <p role="status" className="p-8 text-center">
        Loading…
      </p>
    );
  return <Navigate to={user ? homeFor(user.role) : '/login'} replace />;
}

function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">We couldn't find that page</h1>
      <Link to="/" className="text-primary underline underline-offset-4">
        Go to the start
      </Link>
    </main>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<RootRedirect />} />
      <Route
        path="/patient/*"
        element={
          <RequireRole role="PATIENT">
            <PatientRoutes />
          </RequireRole>
        }
      />
      <Route
        path="/clinician/*"
        element={
          <RequireRole role="CLINICIAN">
            <ClinicianRoutes />
          </RequireRole>
        }
      />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
