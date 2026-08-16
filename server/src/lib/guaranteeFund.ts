import { z } from 'zod';
import {
  addFundLedgerEntry,
  getFundBalance,
  listRecentFundLedger,
  createFundClaim,
  getFundClaim,
  hasOpenOrApprovedClaim,
  listFundClaims,
  decideFundClaim,
} from '../db/guaranteeFund.js';
import { getDuplicata, listPurchasesByInvestor } from '../db/duplicatas.js';
import { addLedgerEntry } from '../db/misc.js';
import { fmtBRL, parseFlexibleDate } from './format.js';
import { allocateClaimLoss } from './guaranteeFundTranches.js';
import type { UserRow } from '../db/types.js';

// A real pooled reserve, funded by a slice of Lastro's own platform fee — never an extra
// charge to cedente or investidor, just how Lastro allocates part of its own fee revenue.
// Covers defaults on *uninsured* duplicatas only — an insured one already has a real
// claims path via the seguradora (lib/seguradoraCore.ts); this exists specifically for
// the gap that leaves open, same principle real "fundo de proteção" layers use.
export const FUND_CONTRIBUTION_PCT = 0.1; // 10% of Lastro's own platform fee, not an extra cost
export const FUND_COVERAGE_PCT = 0.8; // the fund covers at most 80% of a claim — never a promise of full recovery

// Called from settlePurchase (lib/settlement.ts) right after the platform fee is computed
// — records the contribution as its own ledger line, entirely separate from what the
// cedente/investidor actually see move.
export function contributeToFund(duplicataId: string, platformFee: number) {
  const contribution = platformFee * FUND_CONTRIBUTION_PCT;
  if (contribution <= 0) return;
  addFundLedgerEntry('contribuicao', contribution, `Contribuição automática — ${(FUND_CONTRIBUTION_PCT * 100).toFixed(0)}% da taxa de plataforma`, duplicataId);
}

export interface FundOverview {
  balanceFmt: string;
  contributionPct: number;
  coveragePct: number;
  recentLedger: { tipo: string; valorFmt: string; descricao: string; quando: string }[];
}

export function buildFundOverview(): FundOverview {
  return {
    balanceFmt: fmtBRL(getFundBalance()),
    contributionPct: FUND_CONTRIBUTION_PCT * 100,
    coveragePct: FUND_COVERAGE_PCT * 100,
    recentLedger: listRecentFundLedger(20).map((l) => ({
      tipo: l.tipo,
      valorFmt: (l.valor >= 0 ? '+' : '') + fmtBRL(l.valor),
      descricao: l.descricao,
      quando: l.created_at,
    })),
  };
}

export const fundClaimSchema = z.object({ duplicataId: z.string().trim().min(1) });

export type FileFundClaimOutcome =
  | { status: 200; body: { ok: true; claimId: number } }
  | { status: 403; body: { error: string; message: string } }
  | { status: 404; body: { error: 'not_found'; message: string } }
  | { status: 409; body: { error: string; message: string } };

// Eligibility: the investor must actually hold this position, it must be uninsured (an
// insured one goes through the seguradora instead), and it must be genuinely overdue —
// same "a claim is only real once the payment date has actually passed" principle as
// db/duplicatas.ts's listClaimableByInsurerKey for insured sinistros.
export function fileFundClaim(investor: UserRow, duplicataId: string): FileFundClaimOutcome {
  if (investor.role !== 'investidor') {
    return { status: 403, body: { error: 'forbidden', message: 'Apenas contas de investidor podem acionar o fundo de garantia.' } };
  }
  const d = getDuplicata(duplicataId);
  if (!d) return { status: 404, body: { error: 'not_found', message: 'Duplicata não encontrada.' } };
  const purchase = listPurchasesByInvestor(investor.id).find((p) => p.duplicata_id === duplicataId && p.active);
  if (!purchase) {
    return { status: 403, body: { error: 'not_owner', message: 'Você não possui uma posição ativa nesta duplicata.' } };
  }
  if (d.insurer_key) {
    return { status: 409, body: { error: 'insured', message: 'Esta duplicata é segurada — acione o sinistro pela seguradora, não pelo fundo de garantia.' } };
  }
  if (parseFlexibleDate(d.vencimento).getTime() >= Date.now()) {
    return { status: 409, body: { error: 'not_overdue', message: 'Esta duplicata ainda não está vencida.' } };
  }
  if (hasOpenOrApprovedClaim(duplicataId)) {
    return { status: 409, body: { error: 'already_claimed', message: 'Já existe um acionamento em aberto ou aprovado para esta duplicata.' } };
  }
  const claim = createFundClaim(duplicataId, investor.id, purchase.valor);
  return { status: 200, body: { ok: true, claimId: claim.id } };
}

export const fundClaimDecisionSchema = z.object({ decision: z.enum(['aprovado', 'negado']), note: z.string().trim().min(1) });

export type DecideFundClaimOutcome =
  | { status: 200; body: { ok: true; valorPagoFmt: string | null } }
  | { status: 404; body: { error: 'not_found'; message: string } }
  | { status: 409; body: { error: 'already_decided'; message: string } };

// Payout is capped both by FUND_COVERAGE_PCT (the fund never promises full recovery) and
// by the fund's real available balance (it can never pay out more than it actually has) —
// a real reserve, not an unlimited backstop pretending to be one.
export function decideFundClaimOutcome(adminId: number, claimId: number, decision: 'aprovado' | 'negado', note: string): DecideFundClaimOutcome {
  const claim = getFundClaim(claimId);
  if (!claim) return { status: 404, body: { error: 'not_found', message: 'Acionamento não encontrado.' } };
  if (claim.status !== 'aberto') return { status: 409, body: { error: 'already_decided', message: 'Este acionamento já foi decidido.' } };

  if (decision === 'negado') {
    decideFundClaim(claimId, 'negado', null, adminId, note);
    return { status: 200, body: { ok: true, valorPagoFmt: null } };
  }

  const balance = getFundBalance();
  const maxCoverage = claim.valor_solicitado * FUND_COVERAGE_PCT;
  const valorPago = Math.max(0, Math.min(maxCoverage, balance));
  decideFundClaim(claimId, 'aprovado', valorPago, adminId, note);
  if (valorPago > 0) {
    // Attribution (base capital first, then júnior, then sênior) has to run against the
    // pre-payout balances — it reads getFundBalance()/getTrancheNav() itself, so it must
    // happen before the debit below changes what those return, or the waterfall would be
    // computed against an already-reduced balance and shift loss onto the wrong layer.
    allocateClaimLoss(valorPago, claim.duplicata_id);
    addFundLedgerEntry('sinistro_pago', -valorPago, `Pagamento de acionamento #${claimId} — duplicata ${claim.duplicata_id}`, claim.duplicata_id);
    addLedgerEntry(claim.investor_id, new Date().toLocaleDateString('pt-BR'), `Fundo de garantia — indenização parcial da duplicata ${claim.duplicata_id}`, valorPago);
  }
  return { status: 200, body: { ok: true, valorPagoFmt: fmtBRL(valorPago) } };
}

// Real, actionable list for the investor — every active position they hold that's
// uninsured, genuinely overdue, and has no open/approved claim yet — so "Acionar o fundo
// de garantia" is a button next to a specific real position, not a form asking the
// investor to type a duplicata id from memory.
export function listEligiblePositionsForFundClaim(investorId: number) {
  return listPurchasesByInvestor(investorId)
    .filter((p) => p.active)
    .map((p) => ({ purchase: p, duplicata: getDuplicata(p.duplicata_id) }))
    .filter(
      (x) =>
        x.duplicata &&
        !x.duplicata.insurer_key &&
        parseFlexibleDate(x.duplicata.vencimento).getTime() < Date.now() &&
        !hasOpenOrApprovedClaim(x.purchase.duplicata_id)
    )
    .map((x) => ({
      duplicataId: x.purchase.duplicata_id,
      sacado: x.purchase.sacado_nome,
      valorFmt: fmtBRL(x.purchase.valor),
      vencimento: x.duplicata!.vencimento,
    }));
}

export function listFundClaimsForAdmin(status?: 'aberto' | 'aprovado' | 'negado') {
  return listFundClaims(status).map((c) => ({
    id: c.id,
    duplicataId: c.duplicata_id,
    sacado: c.sacado_nome,
    investidor: c.investor_company_name,
    valorSolicitadoFmt: fmtBRL(c.valor_solicitado),
    valorPagoFmt: c.valor_pago != null ? fmtBRL(c.valor_pago) : null,
    status: c.status,
    note: c.note,
    createdAt: c.created_at,
  }));
}
