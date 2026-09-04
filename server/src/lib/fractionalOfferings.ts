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
import { aceiteConfirmado } from './aceiteCore.js';
import { addLedgerEntry } from '../db/misc.js';
import { platformFee, pctLabel } from './settlement.js';
import { computePurchasePrice } from './marketCompute.js';
import { fmtBRL, fmtBRLSigned } from './format.js';
import type { UserRow, DuplicataRow } from '../db/types.js';
import type { FractionalOfferingRow } from '../db/fractionalOfferings.js';

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
  // Achado corrigido: esta checagem nunca olhava o aceite do sacado — nem sequer o
  // padrão fraco de excluir 'contestada' que os outros pontos de compra tinham. Uma
  // duplicata só pode ser negociada (fracionada inclusive) depois que o sacado aceita
  // (explícito ou tácito).
  if (!aceiteConfirmado(duplicataId)) {
    return { eligible: false, reason: 'Aguardando aceite do sacado (ou o prazo tácito vencer) antes de poder fracionar esta duplicata.' };
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

  // O valor de face do lote de tokens (o que o cedente teria recebido cheio, e o que cada
  // token vale de verdade no vencimento — ver settleFractionalAtMaturity abaixo) é
  // diferente do preço que o investidor de fato paga agora: mesmo deságio real de
  // lib/marketCompute.ts's computePurchasePrice que a compra integral já usa, prorateado
  // por token — antes, o investidor pagava o valor de face inteiro (zero retorno possível)
  // e o "retorno" mostrado era só um número fabricado por Math.random(), nunca creditado.
  const facevalorTokens = tokens * offering.token_valor;
  const fee = platformFee(facevalorTokens);
  const { precoCompra: precoCompraTotal } = computePurchasePrice(d);
  const precoPorToken = precoCompraTotal / FRACTIONAL_TOTAL_TOKENS;
  const valorInvestido = tokens * precoPorToken;
  const net = valorInvestido - fee;
  // Ganho real (ainda não realizado) capturado nesta compra — a diferença entre o que o
  // token vale de face e o que foi de fato pago por ele agora. Só vira dinheiro de verdade
  // quando a duplicata for paga no vencimento (settleFractionalAtMaturity credita cada
  // holder pelo valor de face cheio dos seus tokens).
  const descontoCapturado = Math.round(facevalorTokens - valorInvestido);

  addLedgerEntry(investor.id, new Date().toLocaleDateString('pt-BR'), `Compra fracionada — duplicata ${duplicataId} (${tokens} token(s)) — ${d.sacado_nome}`, -valorInvestido);
  if (d.cedente_id) {
    addLedgerEntry(
      d.cedente_id,
      new Date().toLocaleDateString('pt-BR'),
      `Liquidação fracionada da duplicata ${duplicataId} — taxa de plataforma ${pctLabel(facevalorTokens)} descontada (${fmtBRL(fee)})`,
      net
    );
  }
  createHolding(offering.id, investor.id, tokens, valorInvestido, descontoCapturado);
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

// Chamado por lib/aceiteCore.ts's reportPayment quando o sacado reporta o pagamento de uma
// duplicata que tem (ou teve) um fracionamento — currentCreditorFor (legalCollectionFee.ts)
// só conhece a tabela `purchases` de compra integral, então sem isso o pagamento caía no
// fallback e creditava o CEDENTE de novo (que já recebeu na emissão/venda dos tokens),
// deixando todo investidor fracionado sem receber nada de volta. Credita cada holder pelo
// valor de face cheio dos tokens que ele tem (mesmo espírito de settlement.ts's
// settleAtMaturity: o deságio já foi capturado na compra, aqui é só o valor de face
// voltando) — e, se a oferta nunca foi 100% vendida, credita o cedente pela fração de
// tokens que ele nunca vendeu (ele continua sendo o dono real desse pedaço até vendê-lo).
export function settleFractionalAtMaturity(duplicata: DuplicataRow, offering: FractionalOfferingRow): void {
  const hoje = new Date().toLocaleDateString('pt-BR');
  for (const h of listHoldingsForOffering(offering.id)) {
    addLedgerEntry(h.investor_id, hoje, `Pagamento recebido no vencimento — duplicata ${duplicata.id} (${h.tokens} token(s) fracionados)`, h.tokens * offering.token_valor);
  }
  const tokensNaoVendidos = offering.total_tokens - offering.tokens_vendidos;
  if (tokensNaoVendidos > 0 && duplicata.cedente_id) {
    addLedgerEntry(
      duplicata.cedente_id,
      hoje,
      `Pagamento recebido no vencimento — duplicata ${duplicata.id} (${tokensNaoVendidos} token(s) nunca vendidos, ainda seus)`,
      tokensNaoVendidos * offering.token_valor
    );
  }
}

export function listMyFractionalHoldings(investorId: number) {
  return listHoldingsByInvestor(investorId).map((h) => ({
    duplicataId: h.duplicata_id,
    sacado: h.sacado_nome,
    tokens: h.tokens,
    totalTokens: h.total_tokens,
    pctPosicao: Math.round((h.tokens / h.total_tokens) * 100),
    valorInvestidoFmt: fmtBRL(h.valor_investido),
    // Ganho real (deságio já capturado na compra), ainda NÃO realizado em caixa — só vira
    // dinheiro de verdade quando a duplicata for paga no vencimento
    // (settleFractionalAtMaturity acima). Antes era um número fabricado por Math.random().
    retornoFmt: fmtBRLSigned(h.retorno),
    quando: h.created_at,
  }));
}
