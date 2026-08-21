import type { Plan } from '../state/SessionContext';

const PLAN_RANK: Record<Plan, number> = { basico: 0, pro: 1, empresarial: 2 };
export const PLAN_LABELS: Record<Plan, string> = { basico: 'Básico', pro: 'Pro', empresarial: 'Empresarial' };

export function planAtLeast(plan: Plan, required: Plan): boolean {
  return PLAN_RANK[plan] >= PLAN_RANK[required];
}
