import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../lib/api';
import { PageHeader, Card } from '../../components/ui/Card';
import { Segmented } from '../../components/ui/Segmented';
import { AiTag } from '../../components/ui/Badge';
import { ErrorState } from '../../components/ui/ErrorState';
import { SelfServiceAgentCard } from '../../components/agents/SelfServiceAgentCard';
import { useLang } from '../../lib/i18n';
import { useSession } from '../../state/SessionContext';
import { PALETTE } from '../../lib/palette';

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
  tipo: 'deficit' | 'antecipacao_recomendada' | 'ok' | 'concentracao';
  mensagem: string;
}
interface DreSimplificado {
  periodoDias: number;
  receitaRealizadaFmt: string;
  despesaRealizadaFmt: string;
  resultadoFmt: string;
  resultado: number;
}
interface SaldoBancarioReal {
  saldoMedioFmt: string;
  receitaMediaMensalFmt: string;
  volatilidadePct: number;
  fonte: string;
}
interface MarketBenchmark {
  seuRatingMedio: 'AA' | 'A' | 'B' | 'C' | null;
  suaTaxaInadimplenciaPct: number | null;
  mercadoTaxaInadimplenciaPct: number | null;
  comparacao: 'melhor' | 'pior' | 'igual' | null;
}
interface CashflowForecast {
  disponivelParaAntecipacaoFmt: string;
  totalRecebiveisPendentesFmt: string;
  totalContasAPagarPendentesFmt: string;
  recebiveisExternosFmt: string;
  recebiveisExternos: number;
  scenarios: ScenarioResult[];
  insights: CashflowInsight[];
  dre: DreSimplificado | null;
  saldoBancarioReal: SaldoBancarioReal | null;
  benchmark: MarketBenchmark | null;
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
      <line x1={padding.left} y1={zeroY} x2={width - padding.right} y2={zeroY} stroke={PALETTE.inputBorder} strokeWidth={1} strokeDasharray="4 4" />
      <path d={linePath} fill="none" stroke={PALETTE.blue} strokeWidth={2.5} />
      {points.map((p, i) => (
        <g key={p.days}>
          <circle cx={x(i)} cy={y(p.saldoProjetado)} r={4} fill={p.deficit ? PALETTE.red : PALETTE.blue} />
          <text x={x(i)} y={height - 8} textAnchor="middle" fontSize="10.5" fill={PALETTE.textSecondary}>
            {p.days}d
          </text>
        </g>
      ))}
      <text x={4} y={y(max) + 4} fontSize="10" fill={PALETTE.textSecondary}>
        {max >= 0 ? '+' : ''}
        {Math.round(max / 1000)}k
      </text>
      <text x={4} y={y(min) + 4} fontSize="10" fill={PALETTE.textSecondary}>
        {Math.round(min / 1000)}k
      </text>
    </svg>
  );
}

const INSIGHT_STYLE: Record<CashflowInsight['tipo'], { background: string; color: string }> = {
  deficit: { background: PALETTE.redBg, color: PALETTE.red },
  antecipacao_recomendada: { background: PALETTE.chip, color: PALETTE.blue },
  concentracao: { background: PALETTE.amberBg, color: PALETTE.amber },
  ok: { background: PALETTE.greenBg, color: PALETTE.green },
};

export function AiCfoPage() {
  const { t } = useLang();
  const { user } = useSession();
  const isEmpresarial = user?.plan === 'empresarial';
  const [forecast, setForecast] = useState<CashflowForecast | null>(null);
  const [scenario, setScenario] = useState<ScenarioResult['scenario']>('base');
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = () => {
    setLoadError(null);
    api
      .get<CashflowForecast>('/cashflow/forecast')
      .then(setForecast)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar a projeção de caixa.'));
  };

  useEffect(() => {
    load();
  }, []);

  if (loadError) return <ErrorState message={loadError} onRetry={load} />;
  if (!forecast) return null;

  const active = forecast.scenarios.find((s) => s.scenario === scenario) ?? forecast.scenarios[0];

  return (
    <div>
      <PageHeader
        title={t('aiCfo.title', 'AI CFO — Projeção de Caixa')}
        subtitle={t(
          'aiCfo.subtitle',
          'Projeção baseada nos seus recebíveis reais (Minhas Duplicatas + ERP conectado) e contas a pagar cadastradas — sem números inventados',
        )}
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
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
        <Card>
          <div className="text-[11.5px] font-bold text-textSecondary uppercase mb-1.5">Recebíveis externos (ERP)</div>
          <div className="font-mono-num font-bold text-lg">{forecast.recebiveisExternosFmt}</div>
          {forecast.recebiveisExternos === 0 && (
            <div className="text-[11px] text-textTertiary mt-1">
              Conecte um ERP em <Link to="/app/erp" className="text-blue">Integrações ERP</Link> pra somar aqui o que você recebe fora da Lastro.
            </div>
          )}
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
              <div className="font-mono-num font-bold text-[12.5px]" style={{ color: p.deficit ? PALETTE.red : PALETTE.green }}>
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
            <div key={i} className="text-[13px] px-3.5 py-2.5 rounded-lg" style={INSIGHT_STYLE[insight.tipo]}>
              {insight.mensagem}
            </div>
          ))}
        </div>
      </Card>

      <div className="mb-6">
        <SelfServiceAgentCard
          agentId="cfo"
          title="Converse com o CFO Digital"
          placeholder="Ex: devo antecipar duplicatas agora? minha carteira está concentrada em poucos clientes?"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
        <Card>
          <div className="font-bold text-[14px] mb-3">DRE simplificado (90 dias)</div>
          {forecast.dre ? (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-[13px]">
                <span className="text-textSecondary">Receita realizada</span>
                <span className="font-mono-num font-bold text-green">{forecast.dre.receitaRealizadaFmt}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-textSecondary">Despesa realizada</span>
                <span className="font-mono-num font-bold text-red">{forecast.dre.despesaRealizadaFmt}</span>
              </div>
              <div className="h-px bg-hairline my-1" />
              <div className="flex justify-between text-[13px] font-bold">
                <span>Resultado</span>
                <span className="font-mono-num" style={{ color: forecast.dre.resultado >= 0 ? PALETTE.green : PALETTE.red }}>{forecast.dre.resultadoFmt}</span>
              </div>
              <div className="text-[11px] text-textTertiary mt-1">Valor bruto, sem descontar taxa/deságio da Lastro — visão simplificada, não substitui sua contabilidade.</div>
            </div>
          ) : (
            <EmpresarialUpsell isEmpresarial={isEmpresarial} />
          )}
        </Card>

        <Card>
          <div className="font-bold text-[14px] mb-3">Saldo bancário real</div>
          {forecast.saldoBancarioReal ? (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-[13px]">
                <span className="text-textSecondary">Saldo médio</span>
                <span className="font-mono-num font-bold">{forecast.saldoBancarioReal.saldoMedioFmt}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-textSecondary">Receita média mensal</span>
                <span className="font-mono-num font-bold">{forecast.saldoBancarioReal.receitaMediaMensalFmt}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-textSecondary">Volatilidade</span>
                <span className="font-mono-num font-bold">{forecast.saldoBancarioReal.volatilidadePct}%</span>
              </div>
              <div className="text-[11px] text-textTertiary mt-1">Via Open Finance ({forecast.saldoBancarioReal.fonte}), com seu consentimento.</div>
            </div>
          ) : isEmpresarial ? (
            <div className="text-[13px] text-textSecondary">
              Cadastre o CNPJ da sua empresa em <Link to="/app/erp" className="text-blue">Integrações ERP</Link> pra habilitar o saldo bancário real via Open Finance.
            </div>
          ) : (
            <EmpresarialUpsell isEmpresarial={isEmpresarial} />
          )}
        </Card>

        <Card>
          <div className="font-bold text-[14px] mb-3">Benchmark de mercado</div>
          {forecast.benchmark ? (
            <div className="flex flex-col gap-2">
              <div className="flex justify-between text-[13px]">
                <span className="text-textSecondary">Rating médio da sua carteira</span>
                <span className="font-mono-num font-bold">{forecast.benchmark.seuRatingMedio ?? '—'}</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-textSecondary">Sua inadimplência</span>
                <span className="font-mono-num font-bold">{forecast.benchmark.suaTaxaInadimplenciaPct ?? '—'}%</span>
              </div>
              <div className="flex justify-between text-[13px]">
                <span className="text-textSecondary">Média do mercado (mesmo rating)</span>
                <span className="font-mono-num font-bold">{forecast.benchmark.mercadoTaxaInadimplenciaPct ?? '—'}%</span>
              </div>
              {forecast.benchmark.comparacao && (
                <div
                  className="text-[12px] font-bold mt-1"
                  style={{ color: forecast.benchmark.comparacao === 'melhor' ? PALETTE.green : forecast.benchmark.comparacao === 'pior' ? PALETTE.red : PALETTE.textSecondary }}
                >
                  Você está {forecast.benchmark.comparacao === 'melhor' ? 'melhor' : forecast.benchmark.comparacao === 'pior' ? 'pior' : 'igual'} que a média do mercado (Lastro Index)
                </div>
              )}
            </div>
          ) : (
            <EmpresarialUpsell isEmpresarial={isEmpresarial} />
          )}
        </Card>
      </div>
    </div>
  );
}

function EmpresarialUpsell({ isEmpresarial }: { isEmpresarial: boolean }) {
  if (isEmpresarial) {
    return <div className="text-[13px] text-textSecondary">Ainda não há dados suficientes pra calcular isto.</div>;
  }
  return (
    <div className="text-[13px] text-textSecondary">
      Disponível a partir do plano Empresarial. <Link to="/app/assinatura" className="text-blue font-bold">Ver planos</Link>
    </div>
  );
}
