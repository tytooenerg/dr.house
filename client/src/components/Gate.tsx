import { Navigate } from 'react-router-dom';
import { useSession } from '../state/SessionContext';
import { DEFAULT_TAB_BY_ROLE, NAV_ITEMS } from '../data/navConfig';

export function Gate({ tab, children }: { tab: string; children: React.ReactNode }) {
  const { session } = useSession();
  if (!session) return null;
  if (!session.navTabs.includes(tab)) {
    const fallback = DEFAULT_TAB_BY_ROLE[session.userRole || 'investidor'];
    const item = NAV_ITEMS.find((i) => i.key === fallback);
    return <Navigate to={item?.path || '/app/dashboard'} replace />;
  }
  return <>{children}</>;
}
