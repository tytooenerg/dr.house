import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useSession } from '../../state/SessionContext';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import type { Plan } from '../../state/SessionContext';

interface PlanDef {
  key: Plan;
  label: string;
  priceFmt: string;
  features: string[];
}
interface BillingData {
  billingEnabled: boolean;
  currentPlan: Plan;
  subscriptionStatus: string;
  currentPeriodEnd: string | null;
  plans: PlanDef[];
}

const PLAN_RANK: Record<Plan, number> = { basico: 0, pro: 1, empresarial: 2 };

export function AssinaturaPage() {
  const { refresh } = useSession();
  const [data, setData] = useState<BillingData | null>(null);
  const [busyPlan, setBusyPlan] = useState<Plan | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = () => api.get<BillingData>('/billing').then(setData);

  useEffect(() => {
    load();
  }, []);

  const choosePlan = async (plan: Plan) => {
    setBusyPlan(plan);
    setNotice(null);
    try {
      const res = await api.post<{ simulated: boolean; url: string | null }>('/billing/checkout', { plan });
      if (res.url) {
        window.location.href = res.url;
        return;
      }
      setNotice(plan === 'basico' ? 'Assinatura cancelada — você voltou ao plano Básico.' : `Plano ${plan} ativado (modo demo, sem cobrança real).`);
      await Promise.all([load(), refresh()]);
    } finally {
      setBusyPlan(null);
    }
  };

  const openPortal = async () => {
    const res = await api.post<{ simulated: boolean; url: string | null; message?: string }>('/billing/portal');
    if (res.url) window.location.href = res.url;
    else setNotice(res.message ?? 'Sem faturamento real para gerenciar.');
  };

  if (!data) return <PageSkeleton />;

  return (
    <div>
      <PageHeader title="Assinatura" subtitle="Escolha o plano ideal para o volume da sua operação" />

      {!data.billingEnabled && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-chip text-blue text-[13px] font-semibold">
          Modo demo — Stripe não configurado neste ambiente. Trocar de plano aqui é instantâneo e não gera cobrança real.
        </div>
      )}
      {notice && <div className="mb-4 px-4 py-3 rounded-lg bg-greenBg text-green text-[13px] font-semibold">{notice}</div>}

      <div className="grid gap-4 mb-5" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {data.plans.map((p) => {
          const isCurrent = p.key === data.currentPlan;
          const isDowngrade = PLAN_RANK[p.key] < PLAN_RANK[data.currentPlan];
          const CardTag = p.key === 'pro' ? NavyCard : Card;
          return (
            <CardTag key={p.key} className="p-6 flex flex-col">
              <div className="font-bold text-[15px] mb-1">{p.label}</div>
              <div className="text-2xl font-extrabold mb-4">{p.priceFmt}</div>
              <ul className="flex flex-col gap-2 mb-5 flex-1">
                {p.features.map((f) => (
                  <li key={f} className={`text-[13px] flex items-start gap-2 ${p.key === 'pro' ? 'text-[#D6DCE5]' : 'text-textSecondary'}`}>
                    <span className="mt-1 w-1.5 h-1.5 rounded-full bg-current flex-shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                variant={isCurrent ? 'secondary' : p.key === 'pro' ? 'primary' : 'secondary'}
                disabled={isCurrent || busyPlan !== null}
                onClick={() => choosePlan(p.key)}
              >
                {isCurrent ? 'Plano atual' : busyPlan === p.key ? 'Processando…' : isDowngrade ? 'Voltar a este plano' : 'Fazer upgrade'}
              </Button>
            </CardTag>
          );
        })}
      </div>

      {data.currentPlan !== 'basico' && (
        <Card className="p-5 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="font-bold text-[14px]">Gerenciar assinatura</div>
            <div className="text-textSecondary text-[13px] mt-0.5">
              Status: {data.subscriptionStatus === 'active_demo' ? 'ativa (demo)' : data.subscriptionStatus}
              {data.currentPeriodEnd && ` — renova em ${new Date(data.currentPeriodEnd).toLocaleDateString('pt-BR')}`}
            </div>
          </div>
          <Button variant="secondary" onClick={openPortal}>
            Gerenciar / cancelar
          </Button>
        </Card>
      )}
    </div>
  );
}
