import { useEffect, useState } from 'react';
import { api, ApiError } from '../../lib/api';
import { PageSkeleton } from '../../components/ui/Skeleton';
import { Card, PageHeader } from '../../components/ui/Card';
import { Donut } from '../../components/ui/Gauge';
import { ErrorState } from '../../components/ui/ErrorState';
import { useLang } from '../../lib/i18n';
import { PALETTE } from '../../lib/palette';

interface Kpi {
  label: string;
  value: string;
  trend: string;
  trendColor: string;
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
  donutTitle: string;
  monthlyTitle: string;
  donutEmptyHint: string | null;
  monthlyEmptyHint: string | null;
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
        {data.kpis.map((kpi, i) => {
          const destaque = i === 0;
          return (
            <div key={kpi.label} className={`rounded-card border border-border p-5 ${destaque ? 'bg-navy' : 'bg-white'}`}>
              <div className={`text-[13px] font-semibold ${destaque ? 'text-onNavy' : 'text-textSecondary'}`}>{kpi.label}</div>
              <div className={`font-extrabold mt-2.5 tracking-tight ${destaque ? 'text-[26px] text-white' : 'text-[26px] text-navy'}`}>{kpi.value}</div>
              <div className="text-[12.5px] mt-2 font-semibold" style={{ color: destaque && kpi.trendColor === PALETTE.textSecondary ? PALETTE.onNavy : kpi.trendColor }}>
                {kpi.trend}
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid gap-4" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
        <Card>
          <div className="font-bold text-[15px] mb-5">{data.monthlyTitle}</div>
          {data.monthlyEmptyHint ? (
            <div className="h-[180px] flex items-center justify-center text-[12.5px] text-textSecondary">{data.monthlyEmptyHint}</div>
          ) : (
          <div className="flex items-end gap-4 h-[180px] px-1">
            {data.monthlyBars.map((bar) => (
              <div key={bar.label} className="flex-1 flex flex-col items-center gap-2 h-full justify-end">
                <div className="text-[11.5px] text-textSecondary font-semibold">{bar.valueLabel}</div>
                <div className="w-full rounded-t-md" style={{ maxWidth: 38, height: `${bar.heightPct}%`, background: bar.color, borderRadius: '6px 6px 2px 2px' }} />
                <div className="text-xs text-textSecondary">{bar.label}</div>
              </div>
            ))}
          </div>
          )}
        </Card>

        <Card className="flex flex-col items-center">
          <div className="font-bold text-[15px] self-start mb-4">{data.donutTitle}</div>
          <Donut stops={data.riskDonutStops} size={150}>
            <div className="text-xl font-extrabold">{data.activeDuplicatas}</div>
            <div className="text-[11.5px] text-textSecondary">{t('dashboard.operacoes', 'operações')}</div>
          </Donut>
          {data.donutEmptyHint && <div className="text-[12.5px] text-textSecondary text-center mt-4">{data.donutEmptyHint}</div>}
          {!data.donutEmptyHint && (
          <div className="flex flex-col gap-2 w-full mt-5">
            {data.ratingLegend.map((r) => (
              <div key={r.label} className="flex items-center gap-2 text-[13px]">
                <span className="rounded-[2px]" style={{ width: 9, height: 9, background: r.color }} />
                <span className="flex-1 text-textSecondary">{r.label}</span>
                <span className="font-bold">{r.pct}</span>
              </div>
            ))}
          </div>
          )}
        </Card>
      </div>
    </div>
  );
}
