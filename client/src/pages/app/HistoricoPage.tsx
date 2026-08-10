import { useEffect, useState } from 'react';
import { api, downloadFile, ApiError } from '../../lib/api';
import { PageHeader, Card, NavyCard } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Toggle } from '../../components/ui/Toggle';
import { ProgressBar } from '../../components/ui/ProgressBar';
import { EmptyState } from '../../components/ui/EmptyState';
import { useLang } from '../../lib/i18n';

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
interface FundEligiblePosition {
  duplicataId: string;
  sacado: string;
  valorFmt: string;
  vencimento: string;
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
  const [fundEligible, setFundEligible] = useState<FundEligiblePosition[]>([]);
  const [filingClaimId, setFilingClaimId] = useState<string | null>(null);
  const [fundClaimError, setFundClaimError] = useState('');
  const [fundClaimSuccessIds, setFundClaimSuccessIds] = useState<Set<string>>(new Set());
  const [performance, setPerformance] = useState<PerformanceDashboard | null>(null);
  const [riskFreeInput, setRiskFreeInput] = useState(0);

  useEffect(() => {
    api.get<HistoricoData>(`/historico?page=${page}&pageSize=10`).then(setData);
  }, [page]);

  useEffect(() => {
    api.get<RebalanceView>('/historico/rebalanceamento').then(setRebalance);
  }, []);

  const loadPerformance = (riskFree: number) => {
    api.get<PerformanceDashboard>(`/historico/performance?riskFree=${riskFree}`).then(setPerformance);
  };

  useEffect(() => {
    loadPerformance(0);
  }, []);

  const loadFundEligible = () => api.get<{ eligible: FundEligiblePosition[] }>('/guarantee-fund/eligible').then((d) => setFundEligible(d.eligible));

  useEffect(() => {
    loadFundEligible();
  }, []);

  const fileFundClaim = async (duplicataId: string) => {
    setFundClaimError('');
    setFilingClaimId(duplicataId);
    try {
      await api.post('/guarantee-fund/claims', { duplicataId });
      setFundClaimSuccessIds((prev) => new Set(prev).add(duplicataId));
      await loadFundEligible();
    } catch (err) {
      setFundClaimError(err instanceof ApiError ? err.message : 'Não foi possível acionar o fundo de garantia.');
    } finally {
      setFilingClaimId(null);
    }
  };

  useEffect(() => {
    api.get<InstitutionalStatus>('/historico/institutional/status').then(setInstitutional);
  }, []);

  useEffect(() => {
    if (institutional?.enabled) api.get<InstitutionalAnalytics>('/historico/institutional/analytics').then(setAnalytics);
    else setAnalytics(null);
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

      <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <NavyCard>
          <div className="text-[#8B97AC] text-[13px] font-semibold">Total investido</div>
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

      {rebalance && rebalance.posicoesAtivas > 0 && (
        <Card className="mb-4 px-6 py-5">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
            <div className="font-bold text-[14.5px]">Rebalanceamento sugerido</div>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#EEF1F5] text-textSecondary">
              Perfil {rebalance.profile === 'conservador' ? 'Conservador' : rebalance.profile === 'moderado' ? 'Moderado' : 'Arrojado'}
              {rebalance.usingDefaultProfile ? ' (padrão — responda o questionário de suitability)' : ''}
            </span>
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
                <div key={i} className="text-[12.5px] bg-[#F7F8FA] border border-border rounded-lg px-3.5 py-2.5">
                  {s.message}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {(fundEligible.length > 0 || fundClaimSuccessIds.size > 0) && (
        <Card className="mb-4 px-6 py-5">
          <div className="font-bold text-[14.5px] mb-1">Fundo de garantia</div>
          <div className="text-textSecondary text-[12.5px] mb-3.5">
            Posições sem seguro contratado que já venceram e ainda não foram pagas — você pode acionar o fundo de garantia da plataforma, que cobre
            até 80% do valor, limitado ao saldo real disponível no fundo.
          </div>
          {fundClaimError && <div className="mb-2 text-red text-[12.5px] font-semibold">{fundClaimError}</div>}
          <div className="flex flex-col gap-2">
            {fundEligible.map((p) => (
              <div key={p.duplicataId} className="flex items-center justify-between text-[12.5px] bg-[#F7F8FA] border border-border rounded-lg px-3.5 py-2.5">
                <span className="font-semibold">{p.sacado}</span>
                <span className="text-textSecondary">venceu em {p.vencimento}</span>
                <span className="font-mono-num font-bold">{p.valorFmt}</span>
                <Button size="sm" variant="secondary" disabled={filingClaimId === p.duplicataId} onClick={() => fileFundClaim(p.duplicataId)}>
                  {filingClaimId === p.duplicataId ? 'Enviando…' : 'Acionar fundo'}
                </Button>
              </div>
            ))}
            {[...fundClaimSuccessIds]
              .filter((id) => !fundEligible.some((p) => p.duplicataId === id))
              .map((id) => (
                <div key={id} className="text-[12.5px] text-green font-semibold">
                  Acionamento registrado para {id} — um admin vai revisar.
                </div>
              ))}
          </div>
        </Card>
      )}

      <Card className="mb-4 px-6 py-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <div className="font-bold text-[14.5px]">Central fiscal — informe de rendimentos</div>
        </div>
        <div className="text-textSecondary text-[12.5px] mb-3.5">
          Estimativa de IRRF pela tabela regressiva sobre suas operações reais do ano-calendário — documento de apoio à sua declaração de IR, não uma
          retenção automática (a Lastro ainda não retém imposto nas liquidações).
        </div>
        <div className="flex items-center gap-2.5">
          <input
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
            <div className="font-bold text-[14.5px]">Desempenho ajustado ao risco</div>
          </div>
          <div className="text-textSecondary text-[12.5px] mb-3.5">
            Retorno anualizado ponderado e dispersão entre suas posições atuais — não é uma volatilidade de série temporal (a duplicata não tem
            marcação a mercado diária), e o retorno livre de risco abaixo é o valor que você informar, não uma taxa CDI/SELIC ao vivo.
          </div>
          <div className="flex items-center gap-2.5 mb-3.5">
            <span className="text-textSecondary text-[12.5px]">Taxa livre de risco (% a.a.)</span>
            <input
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
              <div key={p.duplicataId} className="flex items-center justify-between text-[12.5px] bg-[#F7F8FA] border border-border rounded-lg px-3.5 py-2.5">
                <span className="font-semibold flex-1 min-w-0 truncate">{p.sacado}</span>
                <span className="text-textSecondary">{p.diasCarencia}d</span>
                <span className="font-mono-num font-bold ml-3">{p.retornoAnualizadoPct.toFixed(2).replace('.', ',')}% a.a.</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="mb-4 px-6 py-5">
        <div className="font-bold text-[14.5px] mb-3.5">Saúde da carteira — mesma linguagem usada em FIDCs</div>
        <div className="grid gap-5" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <div className="flex justify-between items-center text-[13px] mb-1.5">
              <span className="text-textSecondary">Atraso ≤ 15 dias (% do PL)</span>
              <span className="font-bold font-mono-num">8,2%</span>
            </div>
            <ProgressBar pct={8.2} color="#B8790A" height={7} />
            <div className="text-textTertiary text-[11.5px] mt-1">Faixa saudável de mercado: 7,5%–9%</div>
          </div>
          <div>
            <div className="flex justify-between items-center text-[13px] mb-1.5">
              <span className="text-textSecondary">Inadimplência ≥ 90 dias (% do PL)</span>
              <span className="font-bold font-mono-num">3,9%</span>
            </div>
            <ProgressBar pct={3.9} color="#0A5C36" height={7} />
            <div className="text-textTertiary text-[11.5px] mt-1">Faixa saudável de mercado: 3,5%–5%</div>
          </div>
        </div>
      </Card>

      {institutional && (
        <NavyCard className="mb-4">
          <div className="flex items-center justify-between gap-4 flex-wrap mb-1">
            <div>
              <div className="font-bold text-[15px] mb-1.5">Relatórios Institucionais</div>
              <div className="text-[#9FB3D6] text-[13.5px] leading-relaxed max-w-[600px]">
                Analytics de carteira acima do extrato por operação — concentração por rating, maiores exposições e desempenho mensal, com relatório em PDF pronto para o comitê. {institutional.priceFmt}/mês, a partir do plano {institutional.requiredPlan === 'pro' ? 'Pro' : institutional.requiredPlan}.
              </div>
            </div>
            {institutional.planOk ? (
              <Toggle on={institutional.enabled} onClick={() => toggleInstitutional(!institutional.enabled)} />
            ) : (
              <span className="text-[11.5px] font-bold px-2.5 py-1 rounded-md" style={{ background: '#2A3F5F', color: '#C7D6FF' }}>
                Requer plano {institutional.requiredPlan === 'pro' ? 'Pro' : institutional.requiredPlan}
              </span>
            )}
          </div>
          {institutionalError && <div className="text-[11.5px] mt-1" style={{ color: '#FF9E9E' }}>{institutionalError}</div>}

          {institutional.enabled && analytics && (
            <div className="mt-4 pt-4 border-t border-[#2A3F5F]">
              <div className="grid gap-4 mb-4" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div>
                  <div className="text-[#9FB3D6] text-[11.5px] font-bold uppercase">Posições ativas</div>
                  <div className="font-mono-num text-lg font-extrabold mt-1">{analytics.posicoesAtivas}</div>
                </div>
                <div>
                  <div className="text-[#9FB3D6] text-[11.5px] font-bold uppercase">Com regresso</div>
                  <div className="font-mono-num text-lg font-extrabold mt-1">{analytics.comRegressoPct}%</div>
                </div>
                <div>
                  <div className="text-[#9FB3D6] text-[11.5px] font-bold uppercase">Com seguro</div>
                  <div className="font-mono-num text-lg font-extrabold mt-1">{analytics.comSeguroPct}%</div>
                </div>
              </div>
              <div className="grid gap-5 mb-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div>
                  <div className="font-bold text-[12.5px] mb-2">Distribuição por rating</div>
                  <div className="flex flex-col gap-1.5">
                    {analytics.ratingDistribution.map((r) => (
                      <div key={r.rating} className="flex items-center justify-between text-[12.5px]">
                        <span className="text-[#9FB3D6]">{r.rating}</span>
                        <span className="font-mono-num">{r.valorFmt} ({r.pct}%)</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="font-bold text-[12.5px] mb-2">Maiores exposições</div>
                  <div className="flex flex-col gap-1.5">
                    {analytics.maioresExposicoes.length === 0 && <span className="text-[#9FB3D6] text-[12px]">Nenhuma operação registrada ainda.</span>}
                    {analytics.maioresExposicoes.map((e) => (
                      <div key={e.sacado} className="flex items-center justify-between text-[12.5px] gap-2">
                        <span className="text-[#9FB3D6] flex-1 min-w-0 truncate">{e.sacado}</span>
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

      <div className="bg-white border border-border rounded-card overflow-hidden">
        <div className="grid gap-3 px-5 py-3.5 bg-[#F7F8FA] border-b border-border text-xs font-bold text-textSecondary uppercase tracking-wide" style={{ gridTemplateColumns: COLS }}>
          <div>Data</div>
          <div>Empresa</div>
          <div>Investido</div>
          <div>Retorno</div>
          <div>Status</div>
          <div>Coobrigação</div>
        </div>
        {historico.map((h, i) => (
          <div key={i} className="grid gap-3 px-5 py-4 border-b border-border last:border-b-0 items-center text-sm" style={{ gridTemplateColumns: COLS }}>
            <div className="text-textSecondary font-mono-num text-[13px]">{h.data}</div>
            <div className="font-semibold">{h.empresa}</div>
            <div className="font-mono-num">{h.investidoFmt}</div>
            <div className="font-mono-num text-green font-bold">{h.retornoFmt}</div>
            <span className="inline-block text-[11.5px] font-bold px-2.5 py-1 rounded-md bg-greenBg text-green w-fit">{h.status}</span>
            <span
              className="inline-block text-[11.5px] font-bold px-2.5 py-1 rounded-md w-fit"
              style={h.comRegresso ? { background: '#EEF3FF', color: '#1E5EFF' } : { background: '#F0F2F5', color: '#5B6472' }}
              title="Res. BCB 540/2025 — aquisição com regresso: o cedente permanece coobrigado pela duplicata"
            >
              {h.comRegresso ? 'Com regresso' : 'Sem regresso'}
            </span>
          </div>
        ))}
        {historico.length === 0 && <EmptyState title={t('historico.emptyTitle', 'Nenhuma operação ainda')} hint={t('historico.emptyHint', 'Suas operações concluídas vão aparecer aqui')} />}
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
