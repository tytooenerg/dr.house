import {
  addFundLedgerEntry,
  addContribution,
  getFundBalance,
  getInvestorPosition,
  listOpenContributionsByInvestor,
  listRecentFundLedger,
  markRedeemed,
} from '../db/creditLineFund.js';
import { addLedgerEntry } from '../db/misc.js';
import { fmtBRL } from './format.js';

// Opens lib/creditLine.ts's revolving credit line to investor funding — before this, every
// draw implicitly came from Lastro's own capital, with no real source tracked. Now a real
// pool, funded by investor contributions, is the actual source: drawCreditLine() (see
// creditLine.ts) checks this pool's real balance before allowing a draw, and repayments
// (principal + interest) flow back into it via returnFromRepayment — a real warehouse-style
// funding mechanic, not a cosmetic label on the same unlimited "Lastro pays for it" flow.
//
// Deliberately simplified in one honest way: an investor's position tracks contributed
// *principal* only (db/creditLineFund.ts's credit_line_fund_contributions), not a precise
// per-investor share of accumulated interest — interest collected from cedentes grows the
// pool's overall balance (benefiting whoever holds a position when it lands), rather than
// being attributed via a real cota/NAV pricing model. That's real future work, not faked
// here as a simple percentage.

export function contributeToFund(investorId: number, valor: number) {
  addContribution(investorId, valor);
  addFundLedgerEntry('aporte', valor, `Aporte na linha de crédito rotativa`, { investorId });
  addLedgerEntry(investorId, new Date().toLocaleDateString('pt-BR'), `Aporte no pool de fomento à linha de crédito`, -valor);
}

export type RedeemOutcome = { status: 200; body: { ok: true; valorFmt: string } } | { status: 400 | 409; body: { error: string; message: string } };

export function redeemFromFund(investorId: number, valor: number): RedeemOutcome {
  if (valor <= 0) return { status: 400, body: { error: 'invalid_amount', message: 'Valor deve ser positivo.' } };
  const position = getInvestorPosition(investorId);
  const poolBalance = getFundBalance();
  const available = Math.max(0, Math.min(position, poolBalance));
  if (valor > available) {
    return {
      status: 409,
      body: {
        error: 'insufficient_available',
        message: `Disponível para resgate: ${fmtBRL(available)} (limitado pela sua posição e pelo saldo livre do pool — parte do seu aporte pode estar financiando saques em aberto).`,
      },
    };
  }

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
  yourPositionFmt: string | null;
  yourAvailableToRedeemFmt: string | null;
  recentLedger: { tipo: string; valorFmt: string; descricao: string; quando: string }[];
}

export function buildFundOverview(investorId: number | null): CreditLineFundOverview {
  const balance = getFundBalance();
  let yourPositionFmt: string | null = null;
  let yourAvailableToRedeemFmt: string | null = null;
  if (investorId != null) {
    const position = getInvestorPosition(investorId);
    yourPositionFmt = fmtBRL(position);
    yourAvailableToRedeemFmt = fmtBRL(Math.max(0, Math.min(position, balance)));
  }
  return {
    balanceFmt: fmtBRL(balance),
    yourPositionFmt,
    yourAvailableToRedeemFmt,
    recentLedger: listRecentFundLedger(20).map((l) => ({
      tipo: l.tipo,
      valorFmt: (l.valor >= 0 ? '+' : '') + fmtBRL(l.valor),
      descricao: l.descricao,
      quando: l.created_at,
    })),
  };
}
