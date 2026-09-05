import { useEffect, useState } from 'react';
import { api, downloadFile, ApiError } from '../../lib/api';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorState } from '../../components/ui/ErrorState';
import { useLang } from '../../lib/i18n';
import { PALETTE } from '../../lib/palette';
import { Badge } from '../../components/ui/Badge';

interface Historico {
  data: string;
  empresa: string;
  investidoFmt: string;
  retornoFmt: string;
  status: string;
  comRegresso: boolean;
}
interface HistoricoData {
  totalInvestidoFmt: string;
  retornoAcumuladoFmt: string;
  rentabilidadeMediaFmt: string;
  historico: Historico[];
  page: number;
  pageSize: number;
  total: number;
}
interface InstitutionalStatus {
  enabled: boolean;
  priceFmt: string;
  planOk: boolean;
  requiredPlan: string;
}
interface InstitutionalAnalytics {
  posicoesAtivas: number;
  comRegressoPct: number;
  comSeguroPct: number;
  ratingDistribution: { rating: string; valorFmt: string; pct: number }[];
  maioresExposicoes: { sacado: string; valorFmt: string; pct: number }[];
}
interface RebalanceView {
  totalInvestidoFmt: string;
  posicoesAtivas: number;
  profile: 'conservador' | 'moderado' | 'arrojado';
  usingDefaultProfile: boolean;
  ratingComparison: { rating: string; actualPct: number; targetPct: number; valorFmt: string }[];
  sacadoConcentration: { sacado: string; valorFmt: string; pct: number; limitPct: number; overLimit: boolean }[];
  suggestions: { type: string; message: string; valorFmt: string }[];
}
interface PerformanceDashboard {
  positionsCount: number;
  totalInvestidoFmt: string;
  retornoMedioPonderadoPct: number;
  volatilidadePct: number;
  sharpeLike: number | null;
  riskFreeRateAnnualPct: number;
  maiorConcentracaoSacadoPct: number;
  sacadosDistintos: number;
  positions: { duplicataId: string; sacado: string; retornoAnualizadoPct: number; diasCarencia: number }[];
}

const COLS = '1fr 1.4fr 0.9fr 0.9fr 0.9fr 1fr';

export function HistoricoPage() {
  const { t } = useLang();
  const [data, setData] = useState<HistoricoData | null>(null);
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [institutional, setInstitutional] = useState<InstitutionalStatus | null>(null);
  const [analytics, setAnalytics] = useState<InstitutionalAnalytics | null>(null);
  const [institutionalError, setInstitutionalError] = useState('');
  const [exportingReport, setExportingReport] = useState(false);
  const [rebalance, setRebalance] = useState<RebalanceView | null>(null);
  const [irYear, setIrYear] = useState(new Date().getFullYear());
  const [exportingIr, setExportingIr] = useState(false);
  const [performance, setPerformance] = useState<PerformanceDashboard | null>(null);
  const [riskFreeInput, setRiskFreeInput] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [secondaryLoadError, setSecondaryLoadError] = useState(false);

  const loadHistorico = () => {
    setLoadError(null);
    api
      .get<HistoricoData>(`/historico?page=${page}&pageSize=10`)
      .then(setData)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Falha ao carregar o extrato.'));
  };

  useEffect(() => {
    loadHistorico();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    api
      .get<RebalanceView>('/historico/rebalanceamento')
      .then(setRebalance)
      .catch(() => setSecondaryLoadError(true));
  }, []);

  const loadPerformance = (riskFree: number) => {
    api
      .get<PerformanceDashboard>(`/historico/performance?riskFree=${riskFree}`)
      .then(setPerformance)
      .catch(() => setSecondaryLoadError(true));
  };

  useEffect(() => {
    loadPerformance(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    api
      .get<InstitutionalStatus>('/historico/institutional/status')
      .then(setInstitutional)
      .catch(() => setSecondaryLoadError(true));
  }, []);

  useEffect(() => {
    if (institutional?.enabled) {
      api
        .get<InstitutionalAnalytics>('/historico/institutional/analytics')
        .then(setAnalytics)
        .catch(() => setSecondaryLoadError(true));
    } else setAnalytics(null);
  }, [institutional?.enabled]);

  const toggleInstitutional = async (enabled: boolean) => {
    setInstitutionalError('');
    try {
      const res = await api.post<{ enabled: boolean; priceFmt: string }>('/historico/institutional/assinar', { enabled });
      setInstitutional((prev) => (prev ? { ...prev, enabled: res.enabled } : prev));
    } catch (err) {
      setInstitutionalError(err instanceof ApiError ? err.message : 'Não foi possível atualizar a assinatura.');
    }
  };

  const exportReport = async () => {
    setExportingReport(true);
    try {
      await downloadFile('/historico/institutional/report.pdf', 'relatorio-institucional.pdf');
    } finally {
      setExportingReport(false);
    }
  };

  const historico = data?.historico ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  const exportAs = async (format: 'csv' | 'pdf') => {
    setExporting(true);
    try {
      await downloadFile(`/historico/export.${format}`, `historico.${format}`);
    } finally {
      setExporting(false);
    }
  };

  const exportInformeRendimentos = async () => {
    setExportingIr(true);
    try {
      await downloadFile(`/historico/informe-rendimentos.pdf?year=${irYear}`, `informe-rendimentos-${irYear}.pdf`);
    } finally {
      setExportingIr(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t('historico.title', 'Carteira & Histórico')}
        subtitle={t('historico.subtitle', 'Suas operações concluídas e retornos obtidos')}
        right={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => exportAs('csv')} disabled={exporting}>
              {exporting ? 'Exportando…' : 'Exportar CSV'}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => exportAs('pdf')} disabled={exporting}>
              {exporting ? 'Exportando…' : 'Exportar PDF'}
            </Button>
          </div>
        }
      />

      {loadError && <ErrorState message={loadError} onRetry={loadHistorico} />}
      {secondaryLoadError && (
        <div className="mb-3 text-[11.5px] text-textSecondary">Algumas seções auxiliares (rebalanceamento, performance ou analytics) não puderam ser carregadas.</div>
      )}

      {!loadError && (
      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <NavyCard>
          <div className="text-textTertiary text-[13px] font-semibold">Total investido</div>
          <div className="text-2xl font-extrabold mt-2.5">{data?.totalInvestidoFmt ?? '—'}</div>
        </NavyCard>
        <Card>
          <div className="text-textSecondary text-[13px] font-semibold">Retorno acumulado</div>
          <div className="text-2xl font-extrabold mt-2.5 text-green">{data?.retornoAcumuladoFmt ?? '—'}</div>
        </Card>
        <Card>
          <div className="text-textSecondary text-[13px] font-semibold">Rentabilidade média</div>
          <div className="text-2xl font-extrabold mt-2.5">{data?.rentabilidadeMediaFmt ?? '—'}</div>
        </Card>
      </div>
      )}

      {rebalance && rebalance.posicoesAtivas > 0 && (
        <Card className="mb-4 px-6 py-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <div className="font-bold text-[14px]">Rebalanceamento sugerido</div>
            <Badge variant="neutral">
              Perfil {rebalance.profile === 'conservador' ? 'Conservador' : rebalance.profile === 'moderado' ? 'Moderado' : 'Arrojado'}
              {rebalance.usingDefaultProfile ? ' (padrão — responda o questionário de suitability)' : ''}
            </Badge>
          </div>
          <div className="text-textSecondary text-[12.5px] mb-3.5">
            Comparação da sua alocação atual com a faixa alvo do seu perfil — não executa nada automaticamente, apenas sugere.
          </div>
          <div className="grid gap-1.5 mb-3.5">
            {rebalance.ratingComparison.map((r) => (
              <div key={r.rating} className="flex items-center justify-between text-[12.5px]">
                <span className="text-textSecondary w-8">{r.rating}</span>
                <span className="font-mono-num">
                  {r.actualPct}% atual · {r.targetPct}% alvo
                </span>
              </div>
            ))}
          </div>
          {rebalance.suggestions.length === 0 ? (
            <div className="text-[12.5px] text-green font-semibold">Sua carteira está dentro das faixas recomendadas para seu perfil.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {rebalance.suggestions.map((s, i) => (
                <div key={i} className="text-[12.5px] bg-surface border border-border rounded-lg px-3.5 py-2.5">
                  {s.message}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="mb-4 px-6 py-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <div className="font-bold text-[14px]">Central fiscal — informe de rendimentos</div>
        </div>
        <div className="text-textSecondary text-[12.5px] mb-3.5">
          Estimativa de IRRF pela tabela regressiva sobre suas operações reais do ano-calendário — documento de apoio à sua declaração de IR, não uma
          retenção automática (a Lastro ainda não retém imposto nas liquidações).
        </div>
        <div className="flex items-center gap-2.5">
          <input aria-label="Ano-calendário do informe"
            type="number"
            min={2020}
            max={new Date().getFullYear()}
            className="w-24 px-3 py-2 rounded-md border border-inputBorder text-[13px]"
            value={irYear}
            onChange={(e) => setIrYear(Number(e.target.value) || new Date().getFullYear())}
          />
          <Button size="sm" variant="secondary" disabled={exportingIr} onClick={exportInformeRendimentos}>
            {exportingIr ? 'Gerando…' : 'Baixar informe (PDF)'}
          </Button>
        </div>
      </Card>

      {performance && performance.positionsCount > 0 && (
        <Card className="mb-4 px-6 py-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <div className="font-bold text-[14px]">Desempenho ajustado ao risco</div>
          </div>
          <div className="text-textSecondary text-[12.5px] mb-3.5">
            Retorno anualizado ponderado e dispersão entre suas posições atuais — não é uma volatilidade de série temporal (a duplicata não tem
            marcação a mercado diária), e o retorno livre de risco abaixo é o valor que você informar, não uma taxa CDI/SELIC ao vivo.
          </div>
          <div className="flex items-center gap-2.5 mb-3.5">
            <span className="text-textSecondary text-[12.5px]">Taxa livre de risco (% a.a.)</span>
            <input aria-label="Taxa livre de risco (% a.a.)"
              type="number"
              step="0.1"
              className="w-24 px-3 py-2 rounded-md border border-inputBorder text-[13px]"
              value={riskFreeInput}
              onChange={(e) => setRiskFreeInput(Number(e.target.value) || 0)}
            />
            <Button size="sm" variant="secondary" onClick={() => loadPerformance(riskFreeInput)}>
              Recalcular
            </Button>
          </div>
          <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <div>
              <div className="text-textSecondary text-[11.5px] font-bold uppercase">Retorno anualizado médio</div>
              <div className="font-mono-num text-lg font-extrabold mt-1">{performance.retornoMedioPonderadoPct.toFixed(2).replace('.', ',')}%</div>
            </div>
            <div>
              <div className="text-textSecondary text-[11.5px] font-bold uppercase">Volatilidade (dispersão)</div>
              <div className="font-mono-num text-lg font-extrabold mt-1">{performance.volatilidadePct.toFixed(2).replace('.', ',')}%</div>
            </div>
            <div>
              <div className="text-textSecondary text-[11.5px] font-bold uppercase">Índice tipo Sharpe</div>
              <div className="font-mono-num text-lg font-extrabold mt-1">{performance.sharpeLike == null ? '—' : performance.sharpeLike.toFixed(2).replace('.', ',')}</div>
            </div>
            <div>
              <div className="text-textSecondary text-[11.5px] font-bold uppercase">Maior concentração (sacado)</div>
              <div className="font-mono-num text-lg font-extrabold mt-1">{performance.maiorConcentracaoSacadoPct.toFixed(1).replace('.', ',')}%</div>
            </div>
          </div>
          <div className="text-textTertiary text-[11.5px] mb-2">
            {performance.positionsCount} posições · {performance.sacadosDistintos} sacados distintos · {performance.totalInvestidoFmt} investidos
          </div>
          <div className="flex flex-col gap-1.5">
            {performance.positions.slice(0, 8).map((p) => (
              <div key={p.duplicataId} className="flex items-center justify-between text-[12.5px] bg-surface border border-border rounded-lg px-3.5 py-2.5">
                <span className="font-semibold flex-1 min-w-0 truncate">{p.sacado}</span>
                <span className="text-textSecondary">{p.diasCarencia}d</span>
                <span className="font-mono-num font-bold ml-3">{p.retornoAnualizadoPct.toFixed(2).replace('.', ',')}% a.a.</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mb-4 px-6 py-5">
        <div className="font-bold text-[14px] mb-3.5">Saúde da carteira — mesma linguagem usada em FIDCs</div>
        <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <div className="flex justify-between items-center text-[13px] mb-1.5">
              <span className="text-textSecondary">Atraso ≤ 15 dias (% do PL)</span>
              <span className="font-bold font-mono-num">8,2%</span>
            </div>
            <ProgressBar pct={8.2} color={PALETTE.amber} height={7} />
            <div className="text-textTertiary text-[11.5px] mt-1">Faixa saudável de mercado: 7,5%–9%</div>
          </div>
          <div>
            <div className="flex justify-between items-center text-[13px] mb-1.5">
              <span className="text-textSecondary">Inadimplência ≥ 90 dias (% do PL)</span>
              <span className="font-bold font-mono-num">3,9%</span>
            </div>
            <ProgressBar pct={3.9} color={PALETTE.green} height={7} />
            <div className="text-textTertiary text-[11.5px] mt-1">Faixa saudável de mercado: 3,5%–5%</div>
          </div>
        </div>
      </Card>

      {institutional && (
        <NavyCard className="mb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-1">
            <div>
              <div className="font-bold text-[15px] mb-1.5">Relatórios Institucionais</div>
              <div className="text-onNavy text-[13px] leading-relaxed max-w-[600px]">
                Analytics de carteira acima do extrato por operação — concentração por rating, maiores exposições e desempenho mensal, com relatório em PDF pronto para o comitê. {institutional.priceFmt}/mês, a partir do plano {institutional.requiredPlan === 'pro' ? 'Pro' : institutional.requiredPlan}.
              </div>
            </div>
            {institutional.planOk ? (
              <Toggle on={institutional.enabled} onClick={() => toggleInstitutional(!institutional.enabled)} />
            ) : (
              <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: PALETTE.navyBorder, color: PALETTE.blueSoft }}>
                Requer plano {institutional.requiredPlan === 'pro' ? 'Pro' : institutional.requiredPlan}
              </span>
            )}
          </div>
          {institutionalError && <div className="text-[11.5px] mt-1" style={{ color: PALETTE.redOnNavy }}>{institutionalError}</div>}

          {institutional.enabled && analytics && (
            <div className="mt-4 pt-4 border-t border-navyBorder">
              <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div>
                  <div className="text-onNavy text-[11.5px] font-bold uppercase">Posições ativas</div>
                  <div className="font-mono-num text-lg font-extrabold mt-1">{analytics.posicoesAtivas}</div>
                </div>
                <div>
                  <div className="text-onNavy text-[11.5px] font-bold uppercase">Com regresso</div>
                  <div className="font-mono-num text-lg font-extrabold mt-1">{analytics.comRegressoPct}%</div>
                </div>
                <div>
                  <div className="text-onNavy text-[11.5px] font-bold uppercase">Com seguro</div>
                  <div className="font-mono-num text-lg font-extrabold mt-1">{analytics.comSeguroPct}%</div>
                </div>
              </div>
              <div className="grid gap-5 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <div className="font-bold text-[12.5px] mb-2">Distribuição por rating</div>
                  <div className="flex flex-col gap-1.5">
                    {analytics.ratingDistribution.map((r) => (
                      <div key={r.rating} className="flex items-center justify-between text-[12.5px]">
                        <span className="text-onNavy">{r.rating}</span>
                        <span className="font-mono-num">{r.valorFmt} ({r.pct}%)</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="font-bold text-[12.5px] mb-2">Maiores exposições</div>
                  <div className="flex flex-col gap-1.5">
                    {analytics.maioresExposicoes.length === 0 && <span className="text-onNavy text-[12.5px]">Nenhuma operação registrada ainda.</span>}
                    {analytics.maioresExposicoes.map((e) => (
                      <div key={e.sacado} className="flex items-center justify-between text-[12.5px] gap-2">
                        <span className="text-onNavy flex-1 min-w-0 truncate">{e.sacado}</span>
                        <span className="font-mono-num flex-shrink-0">{e.valorFmt} ({e.pct}%)</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={exportReport} disabled={exportingReport}>
                {exportingReport ? 'Exportando…' : 'Baixar relatório institucional (PDF)'}
              </Button>
            </div>
          )}
        </NavyCard>
      )}

      <div role="table" aria-label="Operações concluídas" className="bg-white border border-border rounded-card overflow-hidden">
        <div role="rowgroup"><div role="row" className="grid gap-3 px-5 py-3.5 bg-surface border-b border-border text-xs font-bold text-textSecondary uppercase tracking-wide" style={{ gridTemplateColumns: COLS }}>
          <div role="columnheader">Data</div>
          <div role="columnheader">Empresa</div>
          <div role="columnheader">Investido</div>
          <div role="columnheader">Retorno</div>
          <div role="columnheader">Status</div>
          <div role="columnheader">Coobrigação</div>
        </div></div>
        {historico.map((h, i) => (
          <div role="row" key={i} className="grid gap-3 px-5 py-4 border-b border-border last:border-b-0 items-center text-sm" style={{ gridTemplateColumns: COLS }}>
            <div role="cell" className="text-textSecondary font-mono-num text-[13px]">{h.data}</div>
            <div role="cell" className="font-semibold">{h.empresa}</div>
            <div role="cell" className="font-mono-num">{h.investidoFmt}</div>
            <div role="cell" className="font-mono-num text-green font-bold">{h.retornoFmt}</div>
            <Badge role="cell" variant="success" className="inline-block">{h.status}</Badge>
            <span role="cell"
              className="inline-block text-[11.5px] font-bold px-2.5 py-1 rounded-md w-fit"
              style={h.comRegresso ? { background: PALETTE.chip, color: PALETTE.blue } : { background: PALETTE.hairline, color: PALETTE.textSecondary }}
              title="Res. BCB 540/2025 — aquisição com regresso: o cedente permanece coobrigado pela duplicata"
            >
              {h.comRegresso ? 'Com regresso' : 'Sem regresso'}
            </span>
          </div>
        ))}
        {!loadError && historico.length === 0 && <EmptyState title={t('historico.emptyTitle', 'Nenhuma operação ainda')} hint={t('historico.emptyHint', 'Suas operações concluídas vão aparecer aqui')} />}
        {historico.length > 0 && totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-border text-[12.5px] text-textSecondary">
            <span>
              Página {data?.page} de {totalPages} — {data?.total} operações
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 rounded-md border border-inputBorder bg-white font-bold disabled:opacity-40 cursor-pointer disabled:cursor-default"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-md border border-inputBorder bg-white font-bold disabled:opacity-40 cursor-pointer disabled:cursor-default"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
