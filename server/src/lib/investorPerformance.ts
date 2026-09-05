import { listPurchasesByInvestor } from '../db/duplicatas.js';
import { fmtBRL, parseFlexibleDate, toIsoUtc } from './format.js';
import { precoPago } from './investorPositions.js';

// Real risk-adjusted performance for an investor's own book — retorno vs. volatilidade,
// not just the flat "saldo + histórico" Carteira & Histórico already shows. Built entirely
// from real positions (same source `lib/incomeTaxStatement.ts` and `lib/portfolioRebalance.ts`
// already use — listPurchasesByInvestor), deterministic math, no LLM, no fabricated
// external rate.
//
// Two honest limitations, stated wherever this surfaces: (1) "volatilidade" here is the
// weighted cross-sectional dispersion of annualized returns *across the investor's own
// current positions* — a real, computed number, but not a time-series volatility (which
// would need daily NAV marks this platform doesn't produce, since a duplicata isn't
// marked-to-market day to day). (2) the risk-free rate used for the Sharpe-like ratio is
// caller-supplied (default 0%), never a hardcoded "current CDI/SELIC" figure this codebase
// has no live, verified source for — same discipline as `lib/darfGenerator.ts` refusing to
// assert a specific real-time number it can't actually confirm.
export interface PerformancePosition {
  duplicataId: string;
  sacado: string;
  valor: number;
  retorno: number;
  diasCarencia: number;
  retornoAnualizadoPct: number;
}

export interface PerformanceDashboard {
  year: number | null;
  positionsCount: number;
  totalInvestido: number;
  totalInvestidoFmt: string;
  retornoMedioPonderadoPct: number;
  volatilidadePct: number;
  sharpeLike: number | null;
  riskFreeRateAnnualPct: number;
  maiorConcentracaoSacadoPct: number;
  sacadosDistintos: number;
  positions: PerformancePosition[];
}


export function buildPerformanceDashboard(userId: number, opts: { year?: number | null; riskFreeRateAnnualPct?: number } = {}): PerformanceDashboard {
  const riskFree = opts.riskFreeRateAnnualPct ?? 0;
  let purchases = listPurchasesByInvestor(userId);
  if (opts.year != null) {
    purchases = purchases.filter((p) => new Date(toIsoUtc(p.created_at)).getUTCFullYear() === opts.year);
  }

  const positions: PerformancePosition[] = purchases.map((p) => {
    const dataAplicacao = new Date(toIsoUtc(p.created_at));
    const dataResgate = parseFlexibleDate(p.vencimento);
    const diasCarencia = Math.max(1, Math.round((dataResgate.getTime() - dataAplicacao.getTime()) / (24 * 3600 * 1000)));
    const valor = precoPago(p);
    const retornoPct = valor > 0 ? (p.retorno / valor) * 100 : 0;
    const retornoAnualizadoPct = retornoPct * (365 / diasCarencia);
    return { duplicataId: p.duplicata_id, sacado: p.sacado_nome, valor, retorno: p.retorno, diasCarencia, retornoAnualizadoPct };
  });

  const totalInvestido = positions.reduce((s, p) => s + p.valor, 0);
  const retornoMedioPonderadoPct =
    totalInvestido > 0 ? positions.reduce((s, p) => s + p.retornoAnualizadoPct * p.valor, 0) / totalInvestido : 0;

  const variance =
    totalInvestido > 0
      ? positions.reduce((s, p) => s + p.valor * (p.retornoAnualizadoPct - retornoMedioPonderadoPct) ** 2, 0) / totalInvestido
      : 0;
  const volatilidadePct = Math.sqrt(variance);

  // Undefined (not zero) with fewer than 2 positions or zero dispersion — a Sharpe-like
  // ratio over a single data point or with no measurable spread isn't a real signal.
  const sharpeLike = positions.length >= 2 && volatilidadePct > 0 ? (retornoMedioPonderadoPct - riskFree) / volatilidadePct : null;

  const bySacado = new Map<string, number>();
  for (const p of positions) bySacado.set(p.sacado, (bySacado.get(p.sacado) ?? 0) + p.valor);
  const maiorConcentracaoSacadoPct = totalInvestido > 0 ? (Math.max(0, ...[...bySacado.values()]) / totalInvestido) * 100 : 0;

  return {
    year: opts.year ?? null,
    positionsCount: positions.length,
    totalInvestido,
    totalInvestidoFmt: fmtBRL(totalInvestido),
    retornoMedioPonderadoPct,
    volatilidadePct,
    sharpeLike,
    riskFreeRateAnnualPct: riskFree,
    maiorConcentracaoSacadoPct,
    sacadosDistintos: bySacado.size,
    positions: positions.slice().sort((a, b) => b.retornoAnualizadoPct - a.retornoAnualizadoPct),
  };
}
