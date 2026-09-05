import { useNavigate } from 'react-router-dom';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { PLAN_LABELS } from '../lib/plan';
import type { Plan } from '../state/SessionContext';

export function UpgradeRequired({ requiredPlan, feature }: { requiredPlan: Plan; feature: string }) {
  const navigate = useNavigate();
  return (
    <Card className="max-w-[560px] text-center py-10">
      <div className="w-12 h-12 rounded-full bg-chip mx-auto mb-4 flex items-center justify-center">
        <span className="w-5 h-5 rounded-full border-2 border-blue" />
      </div>
      <div className="font-extrabold text-lg mb-2">{feature} é um recurso {PLAN_LABELS[requiredPlan]}</div>
      <div className="text-textSecondary text-[13px] mb-6">Faça upgrade da sua assinatura para desbloquear este recurso, sem perder nada do que você já tem hoje.</div>
      <Button onClick={() => navigate('/app/assinatura')}>Ver planos</Button>
    </Card>
  );
}
