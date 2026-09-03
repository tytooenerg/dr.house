import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { Card, PageHeader } from '../../components/ui/Card';
import { Donut } from '../../components/ui/Gauge';
import { ErrorState } from '../../components/ui/ErrorState';
import { useLang } from '../../lib/i18n';

interface Kpi {
  label: string;
  value: string;
  trend: string;
  trendColor: string;
  cardBg: string;
  labelColor: string;
  valueColor: string;
  valueSize: number;
}
interface Bar {
  label: string;
  valueLabel: string;
  heightPct: number;
  color: string;
}
interface Legend {
  label: string;
  pct: string;
  color: string;
}
interface DashboardData {
  kpis: Kpi[];
  monthlyBars: Bar[];
  ratingLegend: Legend[];
  riskDonutStops: { color: string; from: number; to: number }[];
  activeDuplicatas: number;
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const { t } = useLang();

  const load = () => {
    setLoadError(null);
    api
      .get<DashboardData>('/dashboard')
      .then(setData)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar o dashboard.'));
  };

  useEffect(() => {
    load();
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!data) return <PageSkeleton />;

  return (
    <div>
      <PageHeader
        title={t('dashboard.title', 'Visão Geral')}
        subtitle={t('dashboard.subtitle', 'Resumo da sua atividade na plataforma')}
        right={<div className="text-[13px] text-textSecondary font-mono-num">{new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}</div>}
      />

      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        {data.kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-card border border-border p-5" style={{ background: kpi.cardBg }}>
            <div className="text-[13px] font-semibold" style={{ color: kpi.labelColor }}>
              {kpi.label}
            </div>
            <div className="font-extrabold mt-2.5 tracking-tight" style={{ fontSize: kpi.valueSize, color: kpi.valueColor }}>
              {kpi.value}
            </div>
            <div className="text-[12.5px] mt-2 font-semibold" style={{ color: kpi.trendColor }}>
              {kpi.trend}
            </div>
          </div>
        ))}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
        <Card>
          <div className="font-bold text-[15px] mb-5">{t('dashboard.volumeChart', 'Volume antecipado por mês')}</div>
          <div className="flex items-end gap-4 h-[180px] px-1">
            {data.monthlyBars.map((bar) => (
              <div key={bar.label} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                <div className="text-[11.5px] text-textSecondary font-semibold">{bar.valueLabel}</div>
                <div className="w-full rounded-t-md" style={{ maxWidth: 38, height: `${bar.heightPct}%`, background: bar.color, borderRadius: '6px 6px 2px 2px' }} />
                <div className="text-xs text-textSecondary">{bar.label}</div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="flex flex-col items-center">
          <div className="font-bold text-[15px] self-start mb-4">{t('dashboard.ratingChart', 'Carteira por rating')}</div>
          <Donut stops={data.riskDonutStops} size={150}>
            <div className="text-xl font-extrabold">{data.activeDuplicatas}</div>
            <div className="text-[11px] text-textSecondary">{t('dashboard.operacoes', 'operações')}</div>
          </Donut>
          <div className="flex flex-col gap-2 w-full mt-5">
            {data.ratingLegend.map((r) => (
              <div key={r.label} className="flex items-center gap-2 text-[13px]">
                <span className="rounded-[2px]" style={{ width: 9, height: 9, background: r.color }} />
                <span className="flex-1 text-textSecondary">{r.label}</span>
                <span className="font-bold">{r.pct}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
