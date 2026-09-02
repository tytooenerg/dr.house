import { listByCedente as listDuplicatasByCedente, listSettledByCedenteSince } from '../db/duplicatas.js';
import { listByCedente as listPayablesByCedente, listPaidByCedenteSince } from '../db/payables.js';
import { listErpReceivablesByCedente } from '../db/erpReceivables.js';
import type { PayableRow } from '../db/payables.js';
import type { DuplicataRow, Plan } from '../db/types.js';
import { estimateDefaultProbability } from './defaultProbability.js';
import { ratingFromScore } from './riscoCore.js';
import type { Rating } from '../data/seed.js';
import { buildMarketIndex } from './marketIndex.js';
import { consultarFluxoDeCaixa } from './openFinance.js';
import { parseFlexibleDate, fmtBRL } from './format.js';

// Statuses where the cedente still expects to receive money — either from Lastro (once the
// duplicata sells/finances) or, if never sold, from the sacado directly at vencimento.
// 'vendida' and 'paga' both mean the cedente already has the cash in hand. Exported — the AI
// CFO agent's sub-agents (lib/agents/cfoConcentracao.ts, lib/agents/cfoAntecipacao.ts) reuse
// the exact same definition instead of re-deciding which statuses "still pending" means.
export const PENDING_STATUSES = new Set(['pendente_analise', 'aprovada', 'no_mercado']);
// Already validated and sitting in the marketplace — antecipação is a click away, not
// blocked on further analysis. This is what "quanto tenho disponível para antecipar hoje"
// actually means.
export const ELIGIBLE_NOW_STATUSES = new Set(['aprovada', 'no_mercado']);

export const FORECAST_HORIZONS_DAYS = [7, 30, 60, 90, 180, 365] as const;
export type ForecastHorizon = (typeof FORECAST_HORIZONS_DAYS)[number];

export type Scenario = 'pessimista' | 'base' | 'otimista';
// How much worse/better than the platform's own PD estimate (lib/defaultProbability.ts)
// each scenario assumes a sacado is to collect from — not a second, independently-fit
// model (this codebase is honest that it doesn't have the labeled history for that yet),
// just a documented multiplier on the one real estimate that does exist.
const PD_MULTIPLIER: Record<Scenario, number> = { otimista: 0.5, base: 1, pessimista: 1.75 };

// A sacado paying slower than its stated vencimento is a real, distinct failure mode from
// an outright default — until now every scenario shared the same due date and only varied
// default risk, which meant "pessimista" never modeled "gets paid, just late". This shifts
// the effective collection date per scenario (days added/subtracted before the horizon
// comparison below), same documented-multiplier honesty as PD_MULTIPLIER: not a fitted
// payment-delay distribution (no labeled history for that either), just a stated assumption.
const RECEIVABLE_DELAY_DAYS: Record<Scenario, number> = { otimista: 0, base: 0, pessimista: 15 };

// The other side of the same gap: every scenario used to vary only receivable risk, never
// an unplanned hit to the payables side (an emergency repair, a tax reassessment, a
// supplier price shock). Pessimista adds one, sized off the cedente's own real pending
// obligations — not an arbitrary constant — so it scales with how big this cedente's
// obligations already are; base/otimista assume no such shock.
const UNPLANNED_EXPENSE_PCT_OF_PAYABLES: Record<Scenario, number> = { otimista: 0, base: 0, pessimista: 0.15 };
const UNPLANNED_EXPENSE_DAY = 30;

// Recebíveis vindos do ERP (feature "AI CFO enxerga o ERP", Pro+) nunca passaram pela
// esteira de risco da Lastro — não têm score, então não têm uma estimateDefaultProbability
// real. Em vez de fingir uma PD calculada, aplica um deságio documentado e fixo por
// cenário — mesma honestidade de PD_MULTIPLIER/RECEIVABLE_DELAY_DAYS acima: uma premissa
// declarada, não um modelo.
const ERP_RECEIVABLE_HAIRCUT_PCT: Record<Scenario, number> = { otimista: 0, base: 0.05, pessimista: 0.2 };

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

// Recurring payables (aluguel, folha…) only ever have ONE stored vencimento — this expands
// that single row into every monthly occurrence that falls inside the forecast window, so a
// 365-day projection doesn't silently miss 11 months of rent.
function expandOccurrences(p: PayableRow, today: Date, maxDays: number): Date[] {
  const first = parseFlexibleDate(p.vencimento);
  if (!p.recorrente) return daysBetween(today, first) <= maxDays ? [first] : [];
  const out: Date[] = [];
  const cursor = new Date(first);
  // Walk forward from the stored due date (which may already be in the past) until we
  // either exit the window or pass it — walking, not computing an offset, keeps this
  // correct across variable month lengths.
  while (daysBetween(today, cursor) < 0) cursor.setMonth(cursor.getMonth() + 1);
  while (daysBetween(today, cursor) <= maxDays) {
    out.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

export interface HorizonPoint {
  days: number;
  receitaEsperadaFmt: string;
  despesaEsperadaFmt: string;
  saldoProjetadoFmt: string;
  saldoProjetado: number;
  deficit: boolean;
}

export interface ScenarioResult {
  scenario: Scenario;
  points: HorizonPoint[];
}

export interface CashflowInsight {
  tipo: 'deficit' | 'antecipacao_recomendada' | 'ok' | 'concentracao';
  mensagem: string;
}

export interface DreSimplificado {
  periodoDias: number;
  receitaRealizadaFmt: string;
  despesaRealizadaFmt: string;
  resultadoFmt: string;
  resultado: number;
}

export interface SaldoBancarioReal {
  saldoMedioFmt: string;
  receitaMediaMensalFmt: string;
  volatilidadePct: number;
  fonte: string;
}

export interface MarketBenchmark {
  seuRatingMedio: Rating | null;
  suaTaxaInadimplenciaPct: number | null;
  mercadoTaxaInadimplenciaPct: number | null;
  comparacao: 'melhor' | 'pior' | 'igual' | null;
}

export interface CashflowForecast {
  disponivelParaAntecipacaoFmt: string;
  disponivelParaAntecipacao: number;
  totalRecebiveisPendentesFmt: string;
  totalContasAPagarPendentesFmt: string;
  // Feature "AI CFO enxerga o ERP" (Pro+) — recebíveis reais da empresa que nunca viraram
  // duplicata na Lastro (db/erpReceivables.ts), separados do total acima pra deixar claro
  // que são uma fonte diferente, com um deságio de risco genérico (não o score real da
  // Lastro) aplicado na projeção por cenário.
  recebiveisExternosFmt: string;
  recebiveisExternos: number;
  scenarios: ScenarioResult[];
  insights: CashflowInsight[];
  // Os três abaixo só vêm preenchidos no plano Empresarial — null no Pro, com o motivo
  // explícito pro cliente saber que é upgrade, não bug.
  dre: DreSimplificado | null;
  saldoBancarioReal: SaldoBancarioReal | null;
  benchmark: MarketBenchmark | null;
  geradoEm: string;
}

const MAX_HORIZON = FORECAST_HORIZONS_DAYS[FORECAST_HORIZONS_DAYS.length - 1];
const DRE_PERIODO_DIAS = 90;

export async function buildCashflowForecast(cedenteId: number, plan: Plan, companyCnpj: string): Promise<CashflowForecast> {
  const today = startOfToday();
  const allDuplicatas = listDuplicatasByCedente(cedenteId);
  const duplicatas = allDuplicatas.filter((d) => PENDING_STATUSES.has(d.status));
  const payables = listPayablesByCedente(cedenteId).filter((p) => p.status === 'pendente');
  const erpReceivables = listErpReceivablesByCedente(cedenteId);

  const disponivelParaAntecipacao = duplicatas
    .filter((d) => ELIGIBLE_NOW_STATUSES.has(d.status))
    .reduce((sum, d) => sum + d.valor, 0);
  const totalRecebiveisPendentes = duplicatas.reduce((sum, d) => sum + d.valor, 0);
  const totalContasAPagarPendentes = payables.reduce((sum, p) => sum + p.valor, 0);
  const totalRecebiveisExternos = erpReceivables.reduce((sum, r) => sum + r.valor, 0);

  // Pre-expand payable occurrences once (scenario-independent) against the largest horizon.
  const payableOccurrences: { valor: number; days: number }[] = [];
  for (const p of payables) {
    for (const occ of expandOccurrences(p, today, MAX_HORIZON)) {
      payableOccurrences.push({ valor: p.valor, days: daysBetween(today, occ) });
    }
  }

  const receivableEntries = duplicatas.map((d) => ({
    d,
    days: daysBetween(today, parseFlexibleDate(d.vencimento)),
  }));
  const erpReceivableEntries = erpReceivables.map((r) => ({
    r,
    days: daysBetween(today, parseFlexibleDate(r.vencimento)),
  }));

  const scenarios: ScenarioResult[] = (['pessimista', 'base', 'otimista'] as Scenario[]).map((scenario) => {
    // Slower-paying-sacado risk shifts the effective collection date, not just the PD —
    // so a receivable due just inside a horizon can fall just outside it in pessimista.
    const delayDays = RECEIVABLE_DELAY_DAYS[scenario];
    // An unplanned expense shock, sized off this cedente's own real pending obligations,
    // lands once (at UNPLANNED_EXPENSE_DAY) and persists in every later horizon.
    const unplannedExpense = totalContasAPagarPendentes * UNPLANNED_EXPENSE_PCT_OF_PAYABLES[scenario];
    const erpHaircut = ERP_RECEIVABLE_HAIRCUT_PCT[scenario];

    const points: HorizonPoint[] = FORECAST_HORIZONS_DAYS.map((horizonDays) => {
      const receitaLastro = receivableEntries
        .filter((e) => e.days + delayDays <= horizonDays)
        .reduce((sum, e) => {
          const pd = Math.min(1, estimateDefaultProbability(e.d).pd * PD_MULTIPLIER[scenario]);
          return sum + e.d.valor * (1 - pd);
        }, 0);
      const receitaExterna = erpReceivableEntries
        .filter((e) => e.days + delayDays <= horizonDays)
        .reduce((sum, e) => sum + e.r.valor * (1 - erpHaircut), 0);
      const receitaEsperada = receitaLastro + receitaExterna;
      let despesaEsperada = payableOccurrences.filter((o) => o.days <= horizonDays).reduce((sum, o) => sum + o.valor, 0);
      if (unplannedExpense > 0 && horizonDays >= UNPLANNED_EXPENSE_DAY) despesaEsperada += unplannedExpense;
      const saldoProjetado = receitaEsperada - despesaEsperada;
      return {
        days: horizonDays,
        receitaEsperadaFmt: fmtBRL(receitaEsperada),
        despesaEsperadaFmt: fmtBRL(despesaEsperada),
        saldoProjetadoFmt: fmtBRL(saldoProjetado),
        saldoProjetado,
        deficit: saldoProjetado < 0,
      };
    });
    return { scenario, points };
  });

  const insights = buildInsights(scenarios, disponivelParaAntecipacao);
  const concentracao = buildConcentracaoInsight(duplicatas, erpReceivables);
  if (concentracao) insights.push(concentracao);

  const isEmpresarial = plan === 'empresarial';
  const [dre, saldoBancarioReal, benchmark] = await Promise.all([
    isEmpresarial ? buildDre(cedenteId, today) : Promise.resolve(null),
    isEmpresarial ? buildSaldoBancarioReal(companyCnpj) : Promise.resolve(null),
    isEmpresarial ? Promise.resolve(buildBenchmark(allDuplicatas, today)) : Promise.resolve(null),
  ]);

  return {
    disponivelParaAntecipacaoFmt: fmtBRL(disponivelParaAntecipacao),
    disponivelParaAntecipacao,
    totalRecebiveisPendentesFmt: fmtBRL(totalRecebiveisPendentes),
    totalContasAPagarPendentesFmt: fmtBRL(totalContasAPagarPendentes),
    recebiveisExternosFmt: fmtBRL(totalRecebiveisExternos),
    recebiveisExternos: totalRecebiveisExternos,
    scenarios,
    insights,
    dre,
    saldoBancarioReal,
    benchmark,
    geradoEm: new Date().toISOString(),
  };
}

const CONCENTRATION_INSIGHT_THRESHOLD = 0.5;
const CONCENTRATION_MIN_ENTRIES = 3;

// Feature "AI CFO — concentração de clientes" (Pro+): a saúde do fluxo de caixa não é só
// "quanto entra e quando" — depender demais de um único sacado/cliente é um risco de
// gestão por si só, mesmo que cada recebível individualmente esteja em dia. Combina
// duplicatas na Lastro + recebíveis do ERP (o mesmo dado que já alimenta a projeção acima)
// pra dar essa visão consolidada que nenhuma das duas fontes sozinha mostra.
function buildConcentracaoInsight(duplicatas: DuplicataRow[], erpReceivables: { cliente: string; valor: number }[]): CashflowInsight | null {
  // Minimum on total *entries* combined, not distinct clients — even 2 clients across
  // several transactions is enough data to call a real pattern; 1 duplicata + 1 recebível
  // ERP with the same 2 counterparties isn't.
  if (duplicatas.length + erpReceivables.length < CONCENTRATION_MIN_ENTRIES) return null;

  const porCliente = new Map<string, number>();
  for (const d of duplicatas) porCliente.set(d.sacado_nome, (porCliente.get(d.sacado_nome) ?? 0) + d.valor);
  for (const r of erpReceivables) porCliente.set(r.cliente, (porCliente.get(r.cliente) ?? 0) + r.valor);

  const total = [...porCliente.values()].reduce((s, v) => s + v, 0);
  if (total <= 0) return null;
  let maiorCliente = '';
  let maiorValor = 0;
  for (const [cliente, valor] of porCliente) {
    if (valor > maiorValor) {
      maiorValor = valor;
      maiorCliente = cliente;
    }
  }
  const share = maiorValor / total;
  if (share < CONCENTRATION_INSIGHT_THRESHOLD) return null;
  return {
    tipo: 'concentracao',
    mensagem: `${(share * 100).toFixed(0)}% do seu total a receber (Lastro + ERP conectado) está concentrado em um único cliente ("${maiorCliente}") — considere diversificar sua base pra reduzir o risco de gestão.`,
  };
}

// Feature "AI CFO — DRE simplificado" (Empresarial): receita realizada (duplicatas
// liquidadas via Lastro no período) menos despesa realizada (contas a pagar já pagas no
// período) — valor bruto, não líquido da taxa/deságio da Lastro (uma DRE contábil de
// verdade nettaria isso; esta é deliberadamente simplificada, não uma substituta pra
// contabilidade real).
async function buildDre(cedenteId: number, today: Date): Promise<DreSimplificado> {
  const sinceIso = new Date(today.getTime() - DRE_PERIODO_DIAS * 86400000).toISOString();
  const settled = listSettledByCedenteSince(cedenteId, sinceIso);
  const paid = listPaidByCedenteSince(cedenteId, sinceIso);
  const receitaRealizada = settled.reduce((sum, s) => sum + s.valor, 0);
  const despesaRealizada = paid.reduce((sum, p) => sum + p.valor, 0);
  const resultado = receitaRealizada - despesaRealizada;
  return {
    periodoDias: DRE_PERIODO_DIAS,
    receitaRealizadaFmt: fmtBRL(receitaRealizada),
    despesaRealizadaFmt: fmtBRL(despesaRealizada),
    resultadoFmt: fmtBRL(resultado),
    resultado,
  };
}

// Feature "AI CFO — saldo bancário real" (Empresarial): reaproveita lib/openFinance.ts
// (real-when-configured), até aqui só consultado com o CNPJ de um sacado durante análise
// de risco — aqui é a primeira vez que é consultado com o CNPJ da própria empresa
// cedente. Retorna null honestamente (não um valor fabricado) sem OPEN_FINANCE_API_URL/KEY
// configurado, sem CNPJ cadastrado, ou sem consentimento no agregador pra este CNPJ.
async function buildSaldoBancarioReal(companyCnpj: string): Promise<SaldoBancarioReal | null> {
  if (!companyCnpj.trim()) return null;
  const signal = await consultarFluxoDeCaixa(companyCnpj);
  if (!signal) return null;
  return {
    saldoMedioFmt: fmtBRL(signal.saldoMedio),
    receitaMediaMensalFmt: fmtBRL(signal.receitaMediaMensal),
    volatilidadePct: signal.volatilidadePct,
    fonte: signal.fonte,
  };
}

// Feature "AI CFO — benchmark de mercado" (Empresarial): compara a inadimplência real da
// própria carteira de duplicatas do cedente (mesmo cálculo do Lastro Index —
// lib/marketIndex.ts — vencidas e não vendidas até hoje, agora aplicado só ao histórico
// deste cedente) contra a média do mercado pro rating equivalente. O mesmo agregado que
// agora também é vendido como produto de API standalone, reaproveitado aqui como insight
// de gestão em vez de dado vendido.
function buildBenchmark(allDuplicatas: DuplicataRow[], today: Date): MarketBenchmark {
  if (allDuplicatas.length === 0) return { seuRatingMedio: null, suaTaxaInadimplenciaPct: null, mercadoTaxaInadimplenciaPct: null, comparacao: null };
  const scoreMedio = allDuplicatas.reduce((sum, d) => sum + (d.score ?? 60), 0) / allDuplicatas.length;
  const seuRatingMedio = ratingFromScore(scoreMedio);

  const vencidas = allDuplicatas.filter((d) => parseFlexibleDate(d.vencimento) < today);
  const inadimplentes = vencidas.filter((d) => d.status !== 'vendida');
  const suaTaxaInadimplenciaPct = vencidas.length > 0 ? +((inadimplentes.length / vencidas.length) * 100).toFixed(1) : null;

  const index = buildMarketIndex();
  const bucket = index.porRating.find((b) => b.rating === seuRatingMedio);
  const mercadoTaxaInadimplenciaPct = bucket?.taxaInadimplenciaPct ?? null;

  let comparacao: MarketBenchmark['comparacao'] = null;
  if (suaTaxaInadimplenciaPct !== null && mercadoTaxaInadimplenciaPct !== null) {
    comparacao = suaTaxaInadimplenciaPct < mercadoTaxaInadimplenciaPct ? 'melhor' : suaTaxaInadimplenciaPct > mercadoTaxaInadimplenciaPct ? 'pior' : 'igual';
  }
  return { seuRatingMedio, suaTaxaInadimplenciaPct, mercadoTaxaInadimplenciaPct, comparacao };
}

function buildInsights(scenarios: ScenarioResult[], disponivelParaAntecipacao: number): CashflowInsight[] {
  const base = scenarios.find((s) => s.scenario === 'base')!;
  const insights: CashflowInsight[] = [];
  const firstDeficit = base.points.find((p) => p.deficit);
  if (firstDeficit) {
    const falta = Math.abs(firstDeficit.saldoProjetado);
    insights.push({
      tipo: 'deficit',
      mensagem: `No cenário base, você terá déficit de caixa de ${fmtBRL(falta)} em até ${firstDeficit.days} dias.`,
    });
    if (disponivelParaAntecipacao > 0) {
      const recomendado = Math.min(falta, disponivelParaAntecipacao);
      insights.push({
        tipo: 'antecipacao_recomendada',
        mensagem: `Você tem ${fmtBRL(disponivelParaAntecipacao)} em recebíveis elegíveis para antecipação — recomendamos antecipar pelo menos ${fmtBRL(recomendado)} para cobrir o déficit.`,
      });
    }
  } else {
    insights.push({ tipo: 'ok', mensagem: 'Nenhum déficit de caixa projetado no cenário base para os próximos 365 dias.' });
  }
  return insights;
}
