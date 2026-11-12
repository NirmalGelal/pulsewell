import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import Chat from './Chat';
import Consent from './Consent';
import Home from './Home';
import Review from './Review';
import VideoSession from './video/VideoSession';

export default function PatientRoutes() {
  return (
    <AppShell variant="patient">
      <Routes>
        <Route index element={<Home />} />
        <Route path="consent" element={<Consent />} />
        <Route path="session/:id" element={<Chat />} />
        <Route path="session/:id/video" element={<VideoSession />} />
        <Route path="session/:id/review" element={<Review />} />
        <Route path="*" element={<Navigate to="/patient" replace />} />
      </Routes>
    </AppShell>
  );
}
