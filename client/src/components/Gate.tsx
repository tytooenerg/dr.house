import { Navigate } from 'react-router-dom';
import { useSession } from '../state/SessionContext';
import { DEFAULT_TAB_BY_ROLE, NAV_ITEMS } from '../data/navConfig';
import { UpgradeRequired } from './UpgradeRequired';
import { planAtLeast } from '../lib/plan';
import type { Plan } from '../state/SessionContext';

export function Gate({ tab, requiredPlan, feature, children }: { tab: string; requiredPlan?: Plan; feature?: string; children: React.ReactNode }) {
  const { user } = useSession();
  if (!user) return null;
  if (!user.navTabs.includes(tab)) {
    const fallback = DEFAULT_TAB_BY_ROLE[user.role];
    const item = NAV_ITEMS.find((i) => i.key === fallback);
    return <Navigate to={item?.path || '/app/dashboard'} replace />;
  }
  if (requiredPlan && !planAtLeast(user.plan, requiredPlan)) {
    return <UpgradeRequired requiredPlan={requiredPlan} feature={feature ?? NAV_ITEMS.find((i) => i.key === tab)?.label ?? 'Este recurso'} />;
  }
  return <>{children}</>;
}
