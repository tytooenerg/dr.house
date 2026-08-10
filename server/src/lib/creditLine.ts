import { db } from '../db/index.js';
import { listOpenDisputesByCedente } from '../db/disputes.js';
import { addLedgerEntry } from '../db/misc.js';
import { fmtBRL } from './format.js';
import { ratingFromScore } from './riscoCore.js';
import {
  createDraw,
  getCreditLineByCedente,
  listAllDraws,
  listOpenDraws,
  setCreditLineUtilizado,
  settleDraw,
  updateDrawBalance,
  upsertCreditLine,
  type CreditLineDrawRow,
} from '../db/creditLine.js';
import type { Rating } from '../data/seed.js';

// Linha de crédito rotativa — a real second lending product alongside duplicata purchase,
// but funded and underwritten differently: this is working-capital advanced against the
// cedente's own real emission track record on Lastro (not a specific duplicata an investor
// is buying). The limit is entirely derived from the cedente's real last-90-days book —
// never a flat number, never something an admin types in by hand.

const MIN_DUPLICATAS_90D = 3; // no track record yet → not eligible, full stop
const MAX_LIMIT = 3_000_000;

// More conservative than the marketplace's own AA-C deságio bands (dynamicPricing.ts)
// because this is unsecured working capital against the cedente itself, not a specific
// insured/registered receivable an investor is buying — real risk, real higher price.
const LIMIT_MULTIPLIER: Record<Rating, number> = { AA: 0.6, A: 0.45, B: 0.3, C: 0.15 };
const RATE_AM: Record<Rating, number> = { AA: 2.2, A: 2.8, B: 3.8, C: 5.5 };

export interface CreditOffer {
  eligible: boolean;
  motivo?: string;
  rating?: Rating;
  limite: number;
  taxaAm: number;
  avgMonthlyVolume: number;
  avgScore: number;
  duplicatasCount: number;
}

// Deterministic and re-computable at any time — every read of the credit line refreshes
// the offer from the cedente's *current* real 90-day book, exactly like the marketplace's
// own dynamic pricing recomputes from the platform's real 30-day supply/demand instead of
// caching a number from account-opening day.
export function computeCreditOffer(cedenteId: number): CreditOffer {
  const rows = db
    .prepare(`SELECT valor, score FROM duplicatas WHERE cedente_id = ? AND sandbox = 0 AND created_at >= datetime('now', '-90 days')`)
    .all(cedenteId) as { valor: number; score: number | null }[];

  if (rows.length < MIN_DUPLICATAS_90D) {
    return {
      eligible: false,
      motivo: `É necessário ter ao menos ${MIN_DUPLICATAS_90D} duplicatas emitidas nos últimos 90 dias para construir um histórico de crédito (hoje: ${rows.length}).`,
      limite: 0,
      taxaAm: 0,
      avgMonthlyVolume: 0,
      avgScore: 0,
      duplicatasCount: rows.length,
    };
  }

  const openDisputes = listOpenDisputesByCedente(cedenteId);
  if (openDisputes.length > 0) {
    return {
      eligible: false,
      motivo: `Existem ${openDisputes.length} disputa(s) em aberto envolvendo suas duplicatas — a linha fica suspensa até a resolução.`,
      limite: 0,
      taxaAm: 0,
      avgMonthlyVolume: 0,
      avgScore: 0,
      duplicatasCount: rows.length,
    };
  }

  const totalVolume = rows.reduce((s, r) => s + r.valor, 0);
  const avgMonthlyVolume = totalVolume / 3; // 90 days ≈ 3 months
  const avgScore = rows.reduce((s, r) => s + (r.score ?? 60), 0) / rows.length;
  const rating = ratingFromScore(avgScore);
  const limite = Math.min(MAX_LIMIT, Math.round(avgMonthlyVolume * LIMIT_MULTIPLIER[rating]));

  return {
    eligible: true,
    rating,
    limite,
    taxaAm: RATE_AM[rating],
    avgMonthlyVolume,
    avgScore,
    duplicatasCount: rows.length,
  };
}

// Lazy interest accrual — same principle as the rest of the platform's time-based
// computations (dynamic pricing's 30-day window, insurance premiums, IR withholding):
// no cron job required. Whoever next looks at the line (an overview call, a draw, a
// repayment) accrues whatever interest is actually owed since the last look, simple
// (non-compounding within the same call) daily proration of the monthly rate.
function accrueDraw(draw: CreditLineDrawRow): number {
  const elapsedMs = Date.now() - new Date(draw.last_accrual_at).getTime();
  const elapsedDays = Math.max(0, elapsedMs / (1000 * 60 * 60 * 24));
  if (elapsedDays <= 0) return draw.saldo_devedor;
  const interest = draw.saldo_devedor * (draw.taxa_am / 100) * (elapsedDays / 30);
  const newBalance = draw.saldo_devedor + interest;
  updateDrawBalance(draw.id, newBalance, new Date().toISOString());
  return newBalance;
}

function refreshUtilizado(lineId: number): number {
  const openDraws = listOpenDraws(lineId);
  const total = openDraws.reduce((sum, d) => sum + accrueDraw(d), 0);
  setCreditLineUtilizado(lineId, total);
  return total;
}

export interface CreditLineOverview {
  eligible: boolean;
  motivo?: string;
  rating?: Rating;
  limiteFmt: string;
  utilizadoFmt: string;
  disponivelFmt: string;
  taxaAmFmt: string;
  limite: number;
  utilizado: number;
  disponivel: number;
  draws: { id: number; valorOriginalFmt: string; saldoDevedorFmt: string; taxaAmFmt: string; status: string; criadoEm: string }[];
}

export function buildCreditLineOverview(cedenteId: number): CreditLineOverview {
  const offer = computeCreditOffer(cedenteId);

  if (!offer.eligible) {
    return {
      eligible: false,
      motivo: offer.motivo,
      limiteFmt: fmtBRL(0),
      utilizadoFmt: fmtBRL(0),
      disponivelFmt: fmtBRL(0),
      taxaAmFmt: '—',
      limite: 0,
      utilizado: 0,
      disponivel: 0,
      draws: [],
    };
  }

  const line = upsertCreditLine(cedenteId, offer.limite, offer.taxaAm);
  const utilizado = refreshUtilizado(line.id);
  const disponivel = Math.max(0, line.limite - utilizado);
  const draws = listAllDraws(line.id).map((d) => ({
    id: d.id,
    valorOriginalFmt: fmtBRL(d.valor_original),
    saldoDevedorFmt: fmtBRL(d.saldo_devedor),
    taxaAmFmt: d.taxa_am.toFixed(1).replace('.', ',') + '% a.m.',
    status: d.status,
    criadoEm: d.created_at,
  }));

  return {
    eligible: true,
    rating: offer.rating,
    limiteFmt: fmtBRL(line.limite),
    utilizadoFmt: fmtBRL(utilizado),
    disponivelFmt: fmtBRL(disponivel),
    taxaAmFmt: line.taxa_am.toFixed(1).replace('.', ',') + '% a.m.',
    limite: line.limite,
    utilizado,
    disponivel,
    draws,
  };
}

export type DrawOutcome = { status: 200; body: { ok: true; disponivelFmt: string } } | { status: 400 | 403 | 409; body: { error: string; message: string } };

export function drawCreditLine(cedenteId: number, valor: number): DrawOutcome {
  const offer = computeCreditOffer(cedenteId);
  if (!offer.eligible) {
    return { status: 403, body: { error: 'not_eligible', message: offer.motivo ?? 'Linha de crédito não disponível.' } };
  }
  const line = upsertCreditLine(cedenteId, offer.limite, offer.taxaAm);
  const utilizado = refreshUtilizado(line.id);
  const disponivel = line.limite - utilizado;
  if (valor <= 0) return { status: 400, body: { error: 'invalid_amount', message: 'Valor deve ser positivo.' } };
  if (valor > disponivel) {
    return { status: 409, body: { error: 'limit_exceeded', message: `Valor solicitado excede o disponível (${fmtBRL(disponivel)}).` } };
  }
  createDraw(line.id, valor, line.taxa_am);
  setCreditLineUtilizado(line.id, utilizado + valor);
  addLedgerEntry(cedenteId, new Date().toLocaleDateString('pt-BR'), `Saque da linha de crédito rotativa — ${fmtBRL(valor)} a ${line.taxa_am.toFixed(1).replace('.', ',')}% a.m.`, valor);
  return { status: 200, body: { ok: true, disponivelFmt: fmtBRL(disponivel - valor) } };
}

export type RepayOutcome = { status: 200; body: { ok: true; utilizadoFmt: string } } | { status: 400 | 404 | 409; body: { error: string; message: string } };

// Oldest-open-draw-first, same "first in, first out" principle a real revolving line uses
// — a partial payment always reduces the draw that's been accruing interest the longest.
export function repayCreditLine(cedenteId: number, valor: number): RepayOutcome {
  if (valor <= 0) return { status: 400, body: { error: 'invalid_amount', message: 'Valor deve ser positivo.' } };
  const line = getCreditLineByCedente(cedenteId);
  if (!line) return { status: 404, body: { error: 'not_found', message: 'Nenhuma linha de crédito aberta.' } };

  const openDraws = listOpenDraws(line.id);
  if (openDraws.length === 0) return { status: 409, body: { error: 'nothing_to_repay', message: 'Não há saldo devedor em aberto.' } };

  let remaining = valor;
  for (const draw of openDraws) {
    if (remaining <= 0) break;
    const balance = accrueDraw(draw); // fully accrued as of now before applying the payment
    const paid = Math.min(remaining, balance);
    const newBalance = balance - paid;
    remaining -= paid;
    if (newBalance <= 0.005) settleDraw(draw.id);
    else updateDrawBalance(draw.id, newBalance, new Date().toISOString());
  }

  const utilizado = refreshUtilizado(line.id);
  const actuallyPaid = valor - remaining;
  if (actuallyPaid > 0) {
    addLedgerEntry(cedenteId, new Date().toLocaleDateString('pt-BR'), `Pagamento da linha de crédito rotativa — ${fmtBRL(actuallyPaid)}`, -actuallyPaid);
  }
  return { status: 200, body: { ok: true, utilizadoFmt: fmtBRL(utilizado) } };
}
