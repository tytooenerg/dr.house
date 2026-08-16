import { z } from 'zod';
import {
  addTrancheLedgerEntry,
  addTrancheQuotaMovement,
  getInvestorTrancheQuotas,
  getTotalTrancheQuotas,
  getTrancheNav,
  listRecentTrancheLedger,
  type TrancheClasse,
} from '../db/guaranteeFundTranches.js';
import { addFundLedgerEntry, getFundBalance } from '../db/guaranteeFund.js';
import { addLedgerEntry } from '../db/misc.js';
import { getFloatSetting, setPlatformSetting } from '../db/platformSettings.js';
import { fmtBRL } from './format.js';
import type { UserRow } from '../db/types.js';

// Opens the guarantee fund (lib/guaranteeFund.ts) to real investor capital, in two cota/NAV
// classes — same mechanic lib/creditLineFund.ts already uses for the revolving credit line
// pool, now with a `classe` dimension. An aporte is real cash: it lands in the same shared
// guarantee_fund_ledger a sinistro payout draws from (db/guaranteeFund.ts), not a side
// pool — the tranche tables here are attribution only (who "owns" which slice of that real
// balance, and in what order it's the one that absorbs a loss).
//
// Loss waterfall on a paid sinistro (allocateClaimLoss below): 1) Lastro's own base
// contribution (the fund's original, non-tranched 10%-of-fee reserve — see
// FUND_CONTRIBUTION_PCT in lib/guaranteeFund.ts) absorbs first; 2) then júnior; 3) then
// sênior, only once both are exhausted. Sênior is therefore the protected, conservative
// tranche — junior the higher-risk, higher-yield one — the same ordering a real
// mezzanine/senior structure uses, just with Lastro's own capital as the deepest layer
// instead of a separate first-loss class.
const INITIAL_COTA_PRICE = 1;

const YIELD_SETTING_KEY: Record<TrancheClasse, string> = {
  senior: 'guarantee_fund_yield_apr_senior',
  junior: 'guarantee_fund_yield_apr_junior',
};
const DEFAULT_YIELD_APR: Record<TrancheClasse, number> = { senior: 0.09, junior: 0.16 };

export function getYieldApr(classe: TrancheClasse): number {
  return getFloatSetting(YIELD_SETTING_KEY[classe], DEFAULT_YIELD_APR[classe]);
}

export function setYieldApr(classe: TrancheClasse, apr: number, adminId?: number) {
  setPlatformSetting(YIELD_SETTING_KEY[classe], String(apr), adminId);
}

export function getTrancheCotaPrice(classe: TrancheClasse): number {
  const totalQuotas = getTotalTrancheQuotas(classe);
  if (totalQuotas <= 0) return INITIAL_COTA_PRICE;
  return Math.max(0, getTrancheNav(classe)) / totalQuotas;
}

export interface TrancheOverview {
  classe: TrancheClasse;
  navFmt: string;
  cotaPriceFmt: string;
  yieldAprFmt: string;
  minhaPosicaoFmt: string | null;
  recentLedger: { tipo: string; valorFmt: string; descricao: string; quando: string }[];
}

export function buildTrancheOverview(classe: TrancheClasse, investorId?: number): TrancheOverview {
  const cotaPrice = getTrancheCotaPrice(classe);
  const minhaPosicao = investorId ? getInvestorTrancheQuotas(investorId, classe) * cotaPrice : null;
  return {
    classe,
    navFmt: fmtBRL(Math.max(0, getTrancheNav(classe))),
    cotaPriceFmt: fmtBRL(cotaPrice),
    yieldAprFmt: (getYieldApr(classe) * 100).toFixed(1).replace('.', ',') + '% a.a.',
    minhaPosicaoFmt: minhaPosicao != null ? fmtBRL(minhaPosicao) : null,
    recentLedger: listRecentTrancheLedger(classe, 15).map((l) => ({
      tipo: l.tipo,
      valorFmt: (l.valor >= 0 ? '+' : '') + fmtBRL(l.valor),
      descricao: l.descricao,
      quando: l.created_at,
    })),
  };
}

export const trancheContribSchema = z.object({ classe: z.enum(['senior', 'junior']), valor: z.number().positive().max(50_000_000) });

export function contributeToTranche(investor: UserRow, classe: TrancheClasse, valor: number) {
  const cotaPrice = getTrancheCotaPrice(classe);
  const quotas = valor / cotaPrice;
  addTrancheQuotaMovement(investor.id, classe, quotas, cotaPrice);
  addTrancheLedgerEntry(classe, 'aporte', valor, `Aporte de ${investor.company_name}`, investor.id);
  // Real cash into the same shared pool a sinistro payout draws from — 'contribuicao' is
  // the exact tipo Lastro's own automatic fee-based contribution already uses (see
  // lib/guaranteeFund.ts's contributeToFund), reused here since an investor aporte is
  // economically the same thing: money into the fund.
  addFundLedgerEntry('contribuicao', valor, `Aporte de investidor — tranche ${classe} (${investor.company_name})`);
  addLedgerEntry(investor.id, new Date().toLocaleDateString('pt-BR'), `Aporte no fundo de garantia — tranche ${classe}`, -valor);
}

export type RedeemTrancheOutcome = { status: 200; body: { ok: true; valorFmt: string } } | { status: 400 | 409; body: { error: string; message: string } };

export function redeemFromTranche(investor: UserRow, classe: TrancheClasse, valor: number): RedeemTrancheOutcome {
  if (valor <= 0) return { status: 400, body: { error: 'invalid_amount', message: 'Valor deve ser positivo.' } };
  const cotaPrice = getTrancheCotaPrice(classe);
  const equityValue = getInvestorTrancheQuotas(investor.id, classe) * cotaPrice;
  // Capped by the fund's real, shared cash too — a redemption can't hand out money the
  // pool doesn't actually have on hand, the same real-balance cap db/guaranteeFund.ts's
  // sinistro payout and lib/creditLineFund.ts's redeemFromFund both already enforce. When
  // several tranches (and Lastro's own base) compete for the same limited real cash, this
  // is first-come-first-served — a real liquidity-mismatch limitation any fund with this
  // structure has, not hidden here.
  const fundBalance = getFundBalance();
  const available = Math.max(0, Math.min(equityValue, fundBalance));
  if (valor > available) {
    return {
      status: 409,
      body: {
        error: 'insufficient_available',
        message: `Disponível para resgate: ${fmtBRL(available)} (sua posição já inclui rendimento/perda acumulados; limitado também pelo saldo real do fundo).`,
      },
    };
  }
  addTrancheQuotaMovement(investor.id, classe, -(valor / cotaPrice), cotaPrice);
  addTrancheLedgerEntry(classe, 'resgate', -valor, `Resgate de ${investor.company_name}`, investor.id);
  addFundLedgerEntry('ajuste_admin', -valor, `Resgate de investidor — tranche ${classe} (${investor.company_name})`);
  addLedgerEntry(investor.id, new Date().toLocaleDateString('pt-BR'), `Resgate do fundo de garantia — tranche ${classe}`, valor);
  return { status: 200, body: { ok: true, valorFmt: fmtBRL(valor) } };
}

export interface ClaimLossAllocation {
  fromBase: number;
  fromJunior: number;
  fromSenior: number;
}

// Called from lib/guaranteeFund.ts's decideFundClaimOutcome right after a sinistro payout
// amount is computed — purely attribution (which layer "owns" this loss), the actual cash
// debit from the fund's real balance is still the single 'sinistro_pago' entry that
// function already writes, unchanged.
export function allocateClaimLoss(valorPago: number, duplicataId: string): ClaimLossAllocation {
  if (valorPago <= 0) return { fromBase: 0, fromJunior: 0, fromSenior: 0 };
  const totalBalance = getFundBalance();
  const juniorNav = Math.max(0, getTrancheNav('junior'));
  const seniorNav = Math.max(0, getTrancheNav('senior'));
  const baseBalance = Math.max(0, totalBalance - juniorNav - seniorNav);

  const fromBase = Math.min(valorPago, baseBalance);
  const remaining1 = valorPago - fromBase;
  const fromJunior = Math.min(remaining1, juniorNav);
  const remaining2 = remaining1 - fromJunior;
  const fromSenior = Math.min(remaining2, seniorNav);

  if (fromJunior > 0) addTrancheLedgerEntry('junior', 'perda_absorvida', -fromJunior, `Perda absorvida — sinistro da duplicata ${duplicataId}`);
  if (fromSenior > 0) addTrancheLedgerEntry('senior', 'perda_absorvida', -fromSenior, `Perda absorvida — sinistro da duplicata ${duplicataId}`);
  return { fromBase, fromJunior, fromSenior };
}

export interface YieldDistributionResult {
  seniorPagoFmt: string;
  juniorPagoFmt: string;
}

// Admin-triggered (GET/POST /admin/guarantee-fund/tranches/distribuir-rendimento), same
// shape as lib/apiOverageBilling.ts/lib/whitelabelBilling.ts's periodic jobs — not real-
// time interest accrual, a discrete distribution applying (APR ÷ 12) to each class's
// current NAV. Funded from Lastro's own base contribution (the only place this yield can
// honestly come from — the fund doesn't hold any yield-bearing asset the way the credit
// line fund's outstanding draws do), capped so it never pays out more than that base
// balance actually has; scaled down proportionally between the two classes if it doesn't.
export function runTrancheYieldDistribution(adminId: number): YieldDistributionResult {
  const totalBalance = getFundBalance();
  const juniorNav = Math.max(0, getTrancheNav('junior'));
  const seniorNav = Math.max(0, getTrancheNav('senior'));
  const baseBalance = Math.max(0, totalBalance - juniorNav - seniorNav);

  const juniorWanted = juniorNav * (getYieldApr('junior') / 12);
  const seniorWanted = seniorNav * (getYieldApr('senior') / 12);
  const totalWanted = juniorWanted + seniorWanted;
  const scale = totalWanted > 0 && totalWanted > baseBalance ? baseBalance / totalWanted : 1;
  const juniorPago = juniorWanted * scale;
  const seniorPago = seniorWanted * scale;

  if (juniorPago > 0) addTrancheLedgerEntry('junior', 'rendimento', juniorPago, 'Distribuição mensal de rendimento (tranche júnior)');
  if (seniorPago > 0) addTrancheLedgerEntry('senior', 'rendimento', seniorPago, 'Distribuição mensal de rendimento (tranche sênior)');
  const totalPago = juniorPago + seniorPago;
  if (totalPago > 0) {
    addFundLedgerEntry('ajuste_admin', -totalPago, `Distribuição de rendimento às tranches — admin #${adminId}`);
  }
  return { seniorPagoFmt: fmtBRL(seniorPago), juniorPagoFmt: fmtBRL(juniorPago) };
}
