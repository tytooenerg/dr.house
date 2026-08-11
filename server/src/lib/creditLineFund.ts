import {
  addFundLedgerEntry,
  addContribution,
  addQuotaMovement,
  getFundBalance,
  getInvestorPosition,
  getInvestorQuotas,
  getTotalQuotas,
  listOpenContributionsByInvestor,
  listRecentFundLedger,
  markRedeemed,
} from '../db/creditLineFund.js';
import { listAllOpenDrawsGlobal } from '../db/creditLine.js';
import { addLedgerEntry } from '../db/misc.js';
import { fmtBRL } from './format.js';

// Opens lib/creditLine.ts's revolving credit line to investor funding — before this, every
// draw implicitly came from Lastro's own capital, with no real source tracked. Now a real
// pool, funded by investor contributions, is the actual source: drawCreditLine() (see
// creditLine.ts) checks this pool's real balance before allowing a draw, and repayments
// (principal + interest) flow back into it via returnFromRepayment — a real warehouse-style
// funding mechanic, not a cosmetic label on the same unlimited "Lastro pays for it" flow.
//
// Real per-investor yield attribution via a cota/NAV pricing model — the same mechanic a
// Brazilian FIDC uses, closing what was previously a documented simplification (interest
// just grew the shared pool, benefiting "whoever held a position when it landed" instead of
// each contributor proportionally). Every aporte buys quotas at the fund's current cota
// price; every resgate sells quotas back at the current price. Interest returned from
// repayments never mints new quotas — it only grows NAV, so the price itself rises for
// whoever already holds quotas at that moment, distributing yield proportional to how
// much/how long each investor actually had in the fund. Cota price starts at R$1,00 at
// inception (`INITIAL_COTA_PRICE`), the same bootstrap convention a real fund uses.
//
// NAV = cash actually sitting in the ledger (getFundBalance) + the real value of the
// receivables the pool currently owns (open draws' *last-accrued* saldo_devedor). That
// balance is deliberately not re-accrued live here — lib/creditLine.ts's own accrueDraw
// already only catches interest up whenever something actually looks at a given draw (a
// draw/repay call, or buildCreditLineOverview), the same lazy-accrual principle the rest of
// this codebase uses everywhere else. Recomputing it live here would need importing from
// lib/creditLine.ts, which itself imports from this module — a circular import avoided by
// reading the already-accrued-as-of-last-look balance instead. In practice this means the
// cota price seen by a contribution/redemption can be very slightly stale for a draw nobody
// has touched recently, never materially wrong.
const INITIAL_COTA_PRICE = 1;

export function computeFundNav(): number {
  const cash = getFundBalance();
  const outstanding = listAllOpenDrawsGlobal().reduce((sum, d) => sum + d.saldo_devedor, 0);
  return cash + outstanding;
}

export function getCotaPrice(): number {
  const totalQuotas = getTotalQuotas();
  if (totalQuotas <= 0) return INITIAL_COTA_PRICE;
  return computeFundNav() / totalQuotas;
}

export function contributeToFund(investorId: number, valor: number) {
  const cotaPrice = getCotaPrice();
  const quotas = valor / cotaPrice;
  addContribution(investorId, valor); // kept for the "principal aportado" reference figure — see buildFundOverview
  addQuotaMovement(investorId, quotas, cotaPrice);
  addFundLedgerEntry('aporte', valor, `Aporte na linha de crédito rotativa`, { investorId });
  addLedgerEntry(investorId, new Date().toLocaleDateString('pt-BR'), `Aporte no pool de fomento à linha de crédito`, -valor);
}

export type RedeemOutcome = { status: 200; body: { ok: true; valorFmt: string } } | { status: 400 | 409; body: { error: string; message: string } };

export function redeemFromFund(investorId: number, valor: number): RedeemOutcome {
  if (valor <= 0) return { status: 400, body: { error: 'invalid_amount', message: 'Valor deve ser positivo.' } };
  const cotaPrice = getCotaPrice();
  const equityValue = getInvestorQuotas(investorId) * cotaPrice; // principal + accumulated yield, at today's price
  const poolBalance = getFundBalance(); // cash only — can't hand out cash the pool doesn't actually have on hand
  const available = Math.max(0, Math.min(equityValue, poolBalance));
  if (valor > available) {
    return {
      status: 409,
      body: {
        error: 'insufficient_available',
        message: `Disponível para resgate: ${fmtBRL(available)} (sua posição já inclui rendimento acumulado; limitado também pelo saldo livre do pool — parte do seu aporte pode estar financiando saques em aberto).`,
      },
    };
  }

  addQuotaMovement(investorId, -(valor / cotaPrice), cotaPrice);

  // Still consumes the FIFO principal-tracking rows below for the "principal aportado"
  // reference figure in buildFundOverview — no longer the source of truth for how much an
  // investor can redeem (getInvestorQuotas × getCotaPrice is), since a redemption can now
  // legitimately exceed raw contributed principal once yield has accrued. Safe either way:
  // markRedeemed never takes more than what's left outstanding on a given contribution row.
  let remaining = valor;
  for (const contribution of listOpenContributionsByInvestor(investorId)) {
    if (remaining <= 0) break;
    const outstanding = contribution.valor_aportado - contribution.valor_resgatado;
    const take = Math.min(remaining, outstanding);
    markRedeemed(contribution.id, take);
    remaining -= take;
  }

  addFundLedgerEntry('resgate', -valor, `Resgate do pool de fomento à linha de crédito`, { investorId });
  addLedgerEntry(investorId, new Date().toLocaleDateString('pt-BR'), `Resgate do pool de fomento à linha de crédito`, valor);
  return { status: 200, body: { ok: true, valorFmt: fmtBRL(valor) } };
}

// Called from lib/creditLine.ts's drawCreditLine, right after the pool's real balance was
// confirmed sufficient — records exactly which draw the pool's money went to.
export function fundDraw(drawId: number, valor: number) {
  addFundLedgerEntry('saque_financiado', -valor, `Saque financiado — linha de crédito #${drawId}`, { drawId });
}

// Called from lib/creditLine.ts's repayCreditLine, once per draw actually paid down —
// principal and any accrued interest both return to the pool for real, growing its balance.
export function returnFromRepayment(drawId: number, valor: number) {
  if (valor <= 0) return;
  addFundLedgerEntry('retorno', valor, `Retorno de pagamento — linha de crédito #${drawId}`, { drawId });
}

export interface CreditLineFundOverview {
  balanceFmt: string;
  navFmt: string;
  cotaPriceFmt: string;
  yourPositionFmt: string | null;
  yourPrincipalAportadoFmt: string | null;
  yourAvailableToRedeemFmt: string | null;
  recentLedger: { tipo: string; valorFmt: string; descricao: string; quando: string }[];
}

export function buildFundOverview(investorId: number | null): CreditLineFundOverview {
  const balance = getFundBalance();
  const nav = computeFundNav();
  const cotaPrice = getCotaPrice();
  let yourPositionFmt: string | null = null;
  let yourPrincipalAportadoFmt: string | null = null;
  let yourAvailableToRedeemFmt: string | null = null;
  if (investorId != null) {
    const equityValue = getInvestorQuotas(investorId) * cotaPrice;
    yourPositionFmt = fmtBRL(equityValue);
    yourPrincipalAportadoFmt = fmtBRL(getInvestorPosition(investorId));
    yourAvailableToRedeemFmt = fmtBRL(Math.max(0, Math.min(equityValue, balance)));
  }
  return {
    balanceFmt: fmtBRL(balance),
    navFmt: fmtBRL(nav),
    cotaPriceFmt: 'R$ ' + cotaPrice.toFixed(4).replace('.', ','),
    yourPositionFmt,
    yourPrincipalAportadoFmt,
    yourAvailableToRedeemFmt,
    recentLedger: listRecentFundLedger(20).map((l) => ({
      tipo: l.tipo,
      valorFmt: (l.valor >= 0 ? '+' : '') + fmtBRL(l.valor),
      descricao: l.descricao,
      quando: l.created_at,
    })),
  };
}
