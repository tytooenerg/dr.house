import { Navigate } from 'react-router-dom';
import { useSession } from '../state/SessionContext';
import { DEFAULT_TAB_BY_ROLE, NAV_ITEMS } from '../data/navConfig';

export function Gate({ tab, children }: { tab: string; children: React.ReactNode }) {
  const { user } = useSession();
  if (!user) return null;
  if (!user.navTabs.includes(tab)) {
    const fallback = DEFAULT_TAB_BY_ROLE[user.role];
    const item = NAV_ITEMS.find((i) => i.key === fallback);
    return <Navigate to={item?.path || '/app/dashboard'} replace />;
  }
  return <>{children}</>;
}
