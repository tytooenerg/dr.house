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
// Abaixo deste prazo a plataforma NÃO anualiza. Anualizar multiplica o retorno do período
// por 365/dias: a 1 dia o fator é 365, e 2% viram 730% a.a. — um número que não descreve
// desempenho nenhum, mas que aparecia como "retorno anualizado médio" do investidor. Comprar
// uma duplicata perto do vencimento é operação normal neste mercado (é justamente a de menor
// risco), então isto não é um caso de borda raro. 30 dias é o menor prazo em que o fator de
// anualização (12x) ainda é o de uma conta mensal reconhecível.
export const DIAS_MINIMOS_PARA_ANUALIZAR = 30;

export interface PerformancePosition {
  duplicataId: string;
  sacado: string;
  valor: number;
  retorno: number;
  diasCarencia: number;
  /** Retorno do período — sempre honesto, qualquer que seja o prazo. */
  retornoPeriodoPct: number;
  /** null quando o prazo é curto demais pra anualizar sem inventar um número. */
  retornoAnualizadoPct: number | null;
}

export interface PerformanceDashboard {
  year: number | null;
  positionsCount: number;
  totalInvestido: number;
  totalInvestidoFmt: string;
  /** null quando nenhuma posição tem prazo suficiente pra anualizar. */
  retornoMedioPonderadoPct: number | null;
  volatilidadePct: number | null;
  sharpeLike: number | null;
  /** Sempre presente: não depende de anualização. */
  retornoPeriodoPonderadoPct: number;
  /** Quantas posições ficaram de fora dos agregados anualizados, e por quê. */
  posicoesSemAnualizacao: number;
  diasMinimosParaAnualizar: number;
  saude: SaudeCarteira;
  riskFreeRateAnnualPct: number;
  maiorConcentracaoSacadoPct: number;
  sacadosDistintos: number;
  positions: PerformancePosition[];
}


// "Saúde da carteira", na linguagem que um FIDC usa: quanto do capital investido está
// parado em título vencido e não pago. Estava escrito à mão na tela (8,2% e 3,9%), igual
// para todo investidor — inclusive pra quem não tem posição nenhuma. Aqui sai das posições
// reais: vencida = passou do vencimento e a duplicata não está 'paga'.
//
// Sem "faixa saudável de mercado" ao lado: a tela afirmava 7,5%–9% e 3,5%–5% sem fonte, e
// este repositório não tem uma série de mercado verificável pra sustentar esses intervalos.
// Melhor mostrar o número da carteira sem uma régua inventada do que com ela.
export interface SaudeCarteira {
  atrasoAte15Pct: number;
  atrasoAte15Valor: number;
  inadimplencia90Pct: number;
  inadimplencia90Valor: number;
  /** Base do percentual: o total investido, para o leitor saber sobre o que é a fração. */
  baseInvestido: number;
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
    const retornoPeriodoPct = valor > 0 ? (p.retorno / valor) * 100 : 0;
    const retornoAnualizadoPct = diasCarencia >= DIAS_MINIMOS_PARA_ANUALIZAR ? retornoPeriodoPct * (365 / diasCarencia) : null;
    return { duplicataId: p.duplicata_id, sacado: p.sacado_nome, valor, retorno: p.retorno, diasCarencia, retornoPeriodoPct, retornoAnualizadoPct };
  });

  const totalInvestido = positions.reduce((s, p) => s + p.valor, 0);

  // Média e dispersão só sobre o que pôde ser anualizado. Misturar aqui um número que a
  // posição não sustenta contaminaria os dois agregados — e o Sharpe-like, que sai deles.
  const anualizaveis = positions.filter((p): p is PerformancePosition & { retornoAnualizadoPct: number } => p.retornoAnualizadoPct !== null);
  const baseAnualizavel = anualizaveis.reduce((s, p) => s + p.valor, 0);
  const retornoMedioPonderadoPct =
    baseAnualizavel > 0 ? anualizaveis.reduce((s, p) => s + p.retornoAnualizadoPct * p.valor, 0) / baseAnualizavel : null;

  const variance =
    baseAnualizavel > 0 && retornoMedioPonderadoPct !== null
      ? anualizaveis.reduce((s, p) => s + p.valor * (p.retornoAnualizadoPct - retornoMedioPonderadoPct) ** 2, 0) / baseAnualizavel
      : 0;
  const volatilidadePct = baseAnualizavel > 0 ? Math.sqrt(variance) : null;

  // Retorno do PERÍODO ponderado: este existe sempre, porque não depende de anualizar nada.
  const retornoPeriodoPonderadoPct =
    totalInvestido > 0 ? positions.reduce((s, p) => s + p.retornoPeriodoPct * p.valor, 0) / totalInvestido : 0;

  // Undefined (not zero) with fewer than 2 positions or zero dispersion — a Sharpe-like
  // ratio over a single data point or with no measurable spread isn't a real signal.
  const sharpeLike =
    anualizaveis.length >= 2 && volatilidadePct !== null && volatilidadePct > 0 && retornoMedioPonderadoPct !== null
      ? (retornoMedioPonderadoPct - riskFree) / volatilidadePct
      : null;

  // Dias de atraso de cada posição: positivo quando o vencimento já passou e a duplicata
  // não foi paga. Uma duplicata paga nunca conta como atraso, por mais tarde que tenha sido.
  const agora = Date.now();
  let atraso15 = 0;
  let atraso90 = 0;
  for (const p of purchases) {
    if (p.duplicata_status === 'paga') continue;
    const diasAtraso = Math.floor((agora - parseFlexibleDate(p.vencimento).getTime()) / (24 * 3600 * 1000));
    if (diasAtraso <= 0) continue;
    const investido = precoPago(p);
    if (diasAtraso >= 90) atraso90 += investido;
    else if (diasAtraso <= 15) atraso15 += investido;
  }
  const saude: SaudeCarteira = {
    atrasoAte15Valor: atraso15,
    atrasoAte15Pct: totalInvestido > 0 ? (atraso15 / totalInvestido) * 100 : 0,
    inadimplencia90Valor: atraso90,
    inadimplencia90Pct: totalInvestido > 0 ? (atraso90 / totalInvestido) * 100 : 0,
    baseInvestido: totalInvestido,
  };

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
    retornoPeriodoPonderadoPct,
    posicoesSemAnualizacao: positions.length - anualizaveis.length,
    diasMinimosParaAnualizar: DIAS_MINIMOS_PARA_ANUALIZAR,
    saude,
    riskFreeRateAnnualPct: riskFree,
    maiorConcentracaoSacadoPct,
    sacadosDistintos: bySacado.size,
    positions: positions.slice().sort((a, b) => b.retornoPeriodoPct - a.retornoPeriodoPct),
  };
}
