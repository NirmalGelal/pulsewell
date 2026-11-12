import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { cn } from '@/lib/utils';
import { AlertBanner } from './AlertBanner';
import { PatientDetail, PatientList } from './Patients';
import Queue from './Queue';
import Report from './Report';

const link = ({ isActive }: { isActive: boolean }) =>
  cn(
    'rounded px-2 py-1 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    isActive ? 'bg-surface-strong text-foreground' : 'text-muted-foreground hover:text-foreground',
  );

export default function ClinicianRoutes() {
  return (
    <AppShell
      variant="clinician"
      actions={
        <nav aria-label="Clinician" className="flex gap-1">
          <NavLink to="/clinician" end className={link}>
            Queue
          </NavLink>
          <NavLink to="/clinician/patients" className={link}>
            Patients
          </NavLink>
        </nav>
      }
    >
      <AlertBanner />
      <Routes>
        <Route index element={<Queue />} />
        <Route path="reports/:reportId" element={<Report />} />
        <Route path="patients" element={<PatientList />} />
        <Route path="patients/:id" element={<PatientDetail />} />
        <Route path="*" element={<Navigate to="/clinician" replace />} />
      </Routes>
    </AppShell>
  );
}
