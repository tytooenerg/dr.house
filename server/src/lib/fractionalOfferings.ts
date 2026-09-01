import { z } from 'zod';
import {
  getOfferingByDuplicata,
  createOffering,
  incrementTokensSold,
  markOfferingComplete,
  createHolding,
  listHoldingsForOffering,
  listHoldingsByInvestor,
} from '../db/fractionalOfferings.js';
import { getDuplicata, isPurchased, setStatus } from '../db/duplicatas.js';
import { addLedgerEntry } from '../db/misc.js';
import { platformFee, pctLabel } from './settlement.js';
import { fmtBRL } from './format.js';
import type { UserRow } from '../db/types.js';

// Tokenização/fracionamento — a large duplicata is split into a fixed number of tokens
// (each worth the same slice of face value) that multiple investors can buy independently
// instead of one investor having to fund the whole thing. Purely additive: never touches
// the existing whole-purchase `purchases` table or its machinery — see db/duplicatas.ts's
// isPurchased() for the one deliberate extension that keeps the two paths mutually
// exclusive (a duplicata with any fractional offering, open or complete, can never also be
// bought whole).
export const FRACTIONAL_MIN_VALOR = 150_000;
export const FRACTIONAL_TOTAL_TOKENS = 100; // each token = 1% of face value

export type FractionalEligibility = { eligible: true } | { eligible: false; reason: string };

export function checkFractionalEligibility(duplicataId: string): FractionalEligibility {
  const d = getDuplicata(duplicataId);
  if (!d) return { eligible: false, reason: 'Duplicata não encontrada.' };
  if (d.sandbox) return { eligible: false, reason: 'Duplicatas de sandbox não podem ser fracionadas.' };
  if (d.valor < FRACTIONAL_MIN_VALOR) {
    return { eligible: false, reason: `Apenas duplicatas acima de ${fmtBRL(FRACTIONAL_MIN_VALOR)} podem ser fracionadas.` };
  }
  const existingOffering = getOfferingByDuplicata(duplicataId);
  if (existingOffering) return { eligible: true }; // already fractionalized — continuing is always eligible
  if (isPurchased(duplicataId)) {
    return { eligible: false, reason: 'Esta duplicata já foi comprada integralmente e não pode mais ser fracionada.' };
  }
  if (d.status !== 'aprovada' && d.status !== 'no_mercado') {
    return { eligible: false, reason: 'Esta duplicata não está disponível para fracionamento no momento.' };
  }
  return { eligible: true };
}

export const buyTokensSchema = z.object({ tokens: z.number().int().positive().max(FRACTIONAL_TOTAL_TOKENS) });

export interface FractionalOfferingView {
  duplicataId: string;
  totalTokens: number;
  tokenValorFmt: string;
  tokensVendidos: number;
  tokensRestantes: number;
  pctVendido: number;
  status: 'aberta' | 'concluida';
  holdersCount: number;
}

export function buildOfferingView(duplicataId: string): FractionalOfferingView | null {
  const offering = getOfferingByDuplicata(duplicataId);
  if (!offering) return null;
  return {
    duplicataId,
    totalTokens: offering.total_tokens,
    tokenValorFmt: fmtBRL(offering.token_valor),
    tokensVendidos: offering.tokens_vendidos,
    tokensRestantes: offering.total_tokens - offering.tokens_vendidos,
    pctVendido: Math.round((offering.tokens_vendidos / offering.total_tokens) * 100),
    status: offering.status,
    holdersCount: new Set(listHoldingsForOffering(offering.id).map((h) => h.investor_id)).size,
  };
}

export type BuyTokensOutcome =
  | { status: 200; body: { ok: true; tokensComprados: number; valorInvestidoFmt: string; offering: FractionalOfferingView } }
  | { status: 400; body: { error: 'validation_error'; message: string } }
  | { status: 403; body: { error: string; message: string } }
  | { status: 409; body: { error: 'not_eligible' | 'insufficient_tokens'; message: string } };

export function buyFractionalTokens(investor: UserRow, duplicataId: string, tokens: number): BuyTokensOutcome {
  if (investor.role !== 'investidor') {
    return { status: 403, body: { error: 'forbidden', message: 'Apenas contas de investidor podem comprar tokens fracionados.' } };
  }
  if (investor.kyb_status !== 'approved') {
    return { status: 403, body: { error: 'kyb_required', message: 'Seu credenciamento institucional ainda está em análise.' } };
  }
  const eligibility = checkFractionalEligibility(duplicataId);
  if (!eligibility.eligible) {
    return { status: 409, body: { error: 'not_eligible', message: eligibility.reason } };
  }
  const d = getDuplicata(duplicataId)!;

  let offering = getOfferingByDuplicata(duplicataId);
  if (!offering) {
    offering = createOffering(duplicataId, FRACTIONAL_TOTAL_TOKENS, d.valor / FRACTIONAL_TOTAL_TOKENS);
  }
  if (offering.status !== 'aberta') {
    return { status: 409, body: { error: 'not_eligible', message: 'Este fracionamento já foi totalmente vendido.' } };
  }
  const restantes = offering.total_tokens - offering.tokens_vendidos;
  if (tokens > restantes) {
    return { status: 409, body: { error: 'insufficient_tokens', message: `Apenas ${restantes} token(s) ainda disponíveis nesta oferta.` } };
  }

  const valorInvestido = tokens * offering.token_valor;
  const fee = platformFee(valorInvestido);
  const net = valorInvestido - fee;
  // Same simulated-return shape as a whole purchase (db/duplicatas.ts's createPurchase) —
  // a real, dated liquidation event isn't modeled by this platform for any purchase path,
  // whole or fractional; both credit a return at purchase time.
  const retorno = Math.round(valorInvestido * (0.02 + Math.random() * 0.02));

  addLedgerEntry(investor.id, new Date().toLocaleDateString('pt-BR'), `Compra fracionada — duplicata ${duplicataId} (${tokens} token(s)) — ${d.sacado_nome}`, -valorInvestido);
  if (d.cedente_id) {
    addLedgerEntry(
      d.cedente_id,
      new Date().toLocaleDateString('pt-BR'),
      `Liquidação fracionada da duplicata ${duplicataId} — taxa de plataforma ${pctLabel(valorInvestido)} descontada (${fmtBRL(fee)})`,
      net
    );
  }
  createHolding(offering.id, investor.id, tokens, valorInvestido, retorno);
  const updated = incrementTokensSold(offering.id, tokens);
  if (updated.tokens_vendidos >= updated.total_tokens) {
    markOfferingComplete(offering.id);
    setStatus(duplicataId, 'vendida');
  }

  return {
    status: 200,
    body: { ok: true, tokensComprados: tokens, valorInvestidoFmt: fmtBRL(valorInvestido), offering: buildOfferingView(duplicataId)! },
  };
}

export function listMyFractionalHoldings(investorId: number) {
  return listHoldingsByInvestor(investorId).map((h) => ({
    duplicataId: h.duplicata_id,
    sacado: h.sacado_nome,
    tokens: h.tokens,
    totalTokens: h.total_tokens,
    pctPosicao: Math.round((h.tokens / h.total_tokens) * 100),
    valorInvestidoFmt: fmtBRL(h.valor_investido),
    retornoFmt: '+' + fmtBRL(h.retorno),
    quando: h.created_at,
  }));
}
