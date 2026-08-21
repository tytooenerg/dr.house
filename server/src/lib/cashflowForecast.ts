import { listByCedente as listDuplicatasByCedente } from '../db/duplicatas.js';
import { listByCedente as listPayablesByCedente } from '../db/payables.js';
import type { PayableRow } from '../db/payables.js';
import type { DuplicataRow } from '../db/types.js';
import { estimateDefaultProbability } from './defaultProbability.js';
import { parseFlexibleDate, fmtBRL } from './format.js';

// Statuses where the cedente still expects to receive money — either from Lastro (once the
// duplicata sells/finances) or, if never sold, from the sacado directly at vencimento.
// 'vendida' and 'paga' both mean the cedente already has the cash in hand.
const PENDING_STATUSES = new Set(['pendente_analise', 'aprovada', 'no_mercado']);
// Already validated and sitting in the marketplace — antecipação is a click away, not
// blocked on further analysis. This is what "quanto tenho disponível para antecipar hoje"
// actually means.
const ELIGIBLE_NOW_STATUSES = new Set(['aprovada', 'no_mercado']);

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
  tipo: 'deficit' | 'antecipacao_recomendada' | 'ok';
  mensagem: string;
}

export interface CashflowForecast {
  disponivelParaAntecipacaoFmt: string;
  disponivelParaAntecipacao: number;
  totalRecebiveisPendentesFmt: string;
  totalContasAPagarPendentesFmt: string;
  scenarios: ScenarioResult[];
  insights: CashflowInsight[];
  geradoEm: string;
}

const MAX_HORIZON = FORECAST_HORIZONS_DAYS[FORECAST_HORIZONS_DAYS.length - 1];

export function buildCashflowForecast(cedenteId: number): CashflowForecast {
  const today = startOfToday();
  const duplicatas = listDuplicatasByCedente(cedenteId).filter((d) => PENDING_STATUSES.has(d.status));
  const payables = listPayablesByCedente(cedenteId).filter((p) => p.status === 'pendente');

  const disponivelParaAntecipacao = duplicatas
    .filter((d) => ELIGIBLE_NOW_STATUSES.has(d.status))
    .reduce((sum, d) => sum + d.valor, 0);
  const totalRecebiveisPendentes = duplicatas.reduce((sum, d) => sum + d.valor, 0);
  const totalContasAPagarPendentes = payables.reduce((sum, p) => sum + p.valor, 0);

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

  const scenarios: ScenarioResult[] = (['pessimista', 'base', 'otimista'] as Scenario[]).map((scenario) => {
    // Slower-paying-sacado risk shifts the effective collection date, not just the PD —
    // so a receivable due just inside a horizon can fall just outside it in pessimista.
    const delayDays = RECEIVABLE_DELAY_DAYS[scenario];
    // An unplanned expense shock, sized off this cedente's own real pending obligations,
    // lands once (at UNPLANNED_EXPENSE_DAY) and persists in every later horizon.
    const unplannedExpense = totalContasAPagarPendentes * UNPLANNED_EXPENSE_PCT_OF_PAYABLES[scenario];

    const points: HorizonPoint[] = FORECAST_HORIZONS_DAYS.map((horizonDays) => {
      const receitaEsperada = receivableEntries
        .filter((e) => e.days + delayDays <= horizonDays)
        .reduce((sum, e) => {
          const pd = Math.min(1, estimateDefaultProbability(e.d).pd * PD_MULTIPLIER[scenario]);
          return sum + e.d.valor * (1 - pd);
        }, 0);
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

  return {
    disponivelParaAntecipacaoFmt: fmtBRL(disponivelParaAntecipacao),
    disponivelParaAntecipacao,
    totalRecebiveisPendentesFmt: fmtBRL(totalRecebiveisPendentes),
    totalContasAPagarPendentesFmt: fmtBRL(totalContasAPagarPendentes),
    scenarios,
    insights,
    geradoEm: new Date().toISOString(),
  };
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
