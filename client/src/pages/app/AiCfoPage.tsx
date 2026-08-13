import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Segmented } from '../../components/ui/Segmented';
import { AiTag } from '../../components/ui/Badge';
import { useLang } from '../../lib/i18n';

interface HorizonPoint {
  days: number;
  receitaEsperadaFmt: string;
  despesaEsperadaFmt: string;
  saldoProjetadoFmt: string;
  saldoProjetado: number;
  deficit: boolean;
}
interface ScenarioResult {
  scenario: 'pessimista' | 'base' | 'otimista';
  points: HorizonPoint[];
}
interface CashflowInsight {
  tipo: 'deficit' | 'antecipacao_recomendada' | 'ok';
  mensagem: string;
}
interface CashflowForecast {
  disponivelParaAntecipacaoFmt: string;
  totalRecebiveisPendentesFmt: string;
  totalContasAPagarPendentesFmt: string;
  scenarios: ScenarioResult[];
  insights: CashflowInsight[];
  geradoEm: string;
}

const SCENARIO_LABELS: Record<ScenarioResult['scenario'], string> = { pessimista: 'Pessimista', base: 'Base', otimista: 'Otimista' };

// Inline SVG line chart — this codebase has no charting dependency by design, every
// visualization here is hand-built to match (see ComparadorPage's RangeBar, RiscoPage's gauges).
function ForecastChart({ points }: { points: HorizonPoint[] }) {
  const width = 640;
  const height = 220;
  const padding = { top: 16, right: 16, bottom: 28, left: 70 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const values = points.map((p) => p.saldoProjetado);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;

  const x = (i: number) => padding.left + (i / (points.length - 1)) * innerW;
  const y = (v: number) => padding.top + innerH - ((v - min) / span) * innerH;
  const zeroY = y(0);

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.saldoProjetado)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
      <line x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY} stroke="#D6DCE5" strokeWidth={1} strokeDasharray="4 4" />
      <path d={linePath} fill="none" stroke="#1E5EFF" strokeWidth={2.5} />
      {points.map((p, i) => (
        <g key={p.days}>
          <circle cx={x(i)} cy={y(p.saldoProjetado)} r={4} fill={p.deficit ? '#B3261E' : '#1E5EFF'} />
          <text x={x(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fill="#5B6472">
            {p.days}d
          </text>
        </g>
      ))}
      <text x={4} y={y(max) + 4} fontSize="10" fill="#5B6472">
        {max >= 0 ? '+' : ''}
        {Math.round(max / 1000)}k
      </text>
      <text x={4} y={y(min) + 4} fontSize="10" fill="#5B6472">
        {Math.round(min / 1000)}k
      </text>
    </svg>
  );
}

export function AiCfoPage() {
  const { t } = useLang();
  const [forecast, setForecast] = useState<CashflowForecast | null>(null);
  const [scenario, setScenario] = useState<ScenarioResult['scenario']>('base');

  useEffect(() => {
    api.get<CashflowForecast>('/cashflow/forecast').then(setForecast);
  }, []);

  if (!forecast) return null;

  const active = forecast.scenarios.find((s) => s.scenario === scenario) ?? forecast.scenarios[0];

  return (
    <div>
      <PageHeader
        title={t('aiCfo.title', 'AI CFO — Projeção de Caixa')}
        subtitle={t(
          'aiCfo.subtitle',
          'Projeção baseada nos seus recebíveis reais (Minhas Duplicatas) e contas a pagar cadastradas — sem números inventados',
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Disponível para antecipar hoje</div>
          <div className="font-mono-num font-bold text-lg text-blue">{forecast.disponivelParaAntecipacaoFmt}</div>
        </Card>
        <Card>
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Total a receber (pendente)</div>
          <div className="font-mono-num font-bold text-lg">{forecast.totalRecebiveisPendentesFmt}</div>
        </Card>
        <Card>
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Total a pagar (pendente)</div>
          <div className="font-mono-num font-bold text-lg">{forecast.totalContasAPagarPendentesFmt}</div>
        </Card>
      </div>

      <Card className="mb-6">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <div className="font-bold text-[15px]">{t('aiCfo.projectedBalance', 'Saldo de caixa projetado')}</div>
          <Segmented options={Object.values(SCENARIO_LABELS)} value={SCENARIO_LABELS[scenario]} onChange={(v) => {
            const found = (Object.entries(SCENARIO_LABELS).find(([, label]) => label === v)?.[0] ?? 'base') as ScenarioResult['scenario'];
            setScenario(found);
          }} />
        </div>
        <ForecastChart points={active.points} />
        <div className="grid gap-2 mt-4" style={{ gridTemplateColumns: `repeat(${active.points.length}, 1fr)` }}>
          {active.points.map((p) => (
            <div key={p.days} className="text-center">
              <div className="text-[10.5px] font-bold text-textSecondary uppercase">{p.days}d</div>
              <div className="font-mono-num font-bold text-[12.5px]" style={{ color: p.deficit ? '#B3261E' : '#0A5C36' }}>
                {p.saldoProjetadoFmt}
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-2 mb-3">
          <AiTag />
          <div className="font-bold text-[15px]">{t('aiCfo.insights', 'Insights')}</div>
        </div>
        <div className="flex flex-col gap-2.5">
          {forecast.insights.map((insight, i) => (
            <div
              key={i}
              className="text-[13px] px-3.5 py-2.5 rounded-lg"
              style={{
                background: insight.tipo === 'deficit' ? '#FBEAE8' : insight.tipo === 'antecipacao_recomendada' ? '#E9EEFB' : '#EAF3EE',
                color: insight.tipo === 'deficit' ? '#B3261E' : insight.tipo === 'antecipacao_recomendada' ? '#1E5EFF' : '#0A5C36',
              }}
            >
              {insight.mensagem}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
