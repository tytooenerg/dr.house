import { Navigate, Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { NotificationBell } from './NotificationBell';
import { AiChat } from './AiChat';
import { useSession } from '../state/SessionContext';
import { useIsMobile } from '../lib/useIsMobile';
import { OnboardingModal } from '../pages/auth/OnboardingModal';
import { ErrorBoundary } from '../components/ErrorBoundary';

export function AppShell() {
  const { user, loading } = useSession();
  const isMobile = useIsMobile();

  if (loading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (user.needsKyb) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen w-full bg-bg text-navy relative" style={{ flexDirection: isMobile ? 'column' : 'row' }}>
      <NotificationBell />
      <Sidebar />
      <div className="flex-1 min-w-0" style={{ padding: isMobile ? '20px 18px' : '36px 44px', maxWidth: 1240 }}>
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </div>
      <AiChat />
      {user.showOnboarding && <OnboardingModal />}
    </div>
  );
}
