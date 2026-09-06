import type { UserRow } from '../db/types.js';
import { getDuplicata, listMarketplace } from '../db/duplicatas.js';
import { auctionIsOpen } from './auctionGate.js';
import {
  listMyAuctionBids,
  createAuctionBid,
  getActiveAuctionBid,
  getAuctionBid,
  listActiveAuctionBids,
  setAuctionBidStatus,
} from '../db/auctionBids.js';
import { computePurchasePrice, effectiveMonthlyRatePct } from './marketCompute.js';
import { fmtBRL } from './format.js';

// O leilão primário de verdade, no lugar da encenação anterior (ver o comentário da
// migração 0067). Regras, todas verificáveis no código abaixo:
//
// - O investidor propõe uma TAXA de deságio mensal. Menor taxa = cedente recebe mais =
//   lance melhor. Quem ganha é o menor deságio; empate desempata por quem lançou antes.
// - `computePurchasePrice(d)` deixou de ser o preço de venda e virou a RESERVA: o pior
//   deságio que o cedente aceita. Lance acima dela é recusado. Se ninguém lançar dentro da
//   reserva, a duplicata simplesmente não vende e volta pro cedente reofertar.
// - Um investidor tem no máximo um lance ativo por duplicata; lançar de novo substitui o
//   anterior (não existe "retirar o lance e piorar" depois do fechamento).
//
// A adjudicação em si vive em lib/auctionClose.ts, chamada pelo job de fechamento.

export interface AuctionOutcome<T> {
  status: number;
  body: T | { error: string; message?: string };
}

export interface BidView {
  id: number;
  empresa: string;
  taxaFmt: string;
  precoFmt: string;
  quando: string;
  isMine: boolean;
}

// Taxa de reserva: o pior deságio que o CEDENTE aceita. Quando ele informa uma ao disparar o
// leilão (reserva_taxa_am, migração 0069), é ela que vale; sem isso cai na banda de mercado
// (lib/dynamicPricing.ts), que é sugestão e não decisão — antes disso a plataforma arbitrava
// sozinha o piso de quem estava vendendo.
export function reserveRate(duplicataId: string): { taxaAm: number; preco: number; doCedente: boolean } | null {
  const d = getDuplicata(duplicataId);
  if (!d) return null;
  const doCedente = d.reserva_taxa_am !== null && d.reserva_taxa_am > 0;
  const taxaAm = doCedente ? d.reserva_taxa_am! : computePurchasePrice(d).taxaAmPct;
  return { taxaAm, preco: computePurchasePrice(d, taxaAm).precoCompra, doCedente };
}

// Preço em reais que uma taxa proposta implica: a mesma fórmula de desconto por prazo que o
// resto do sistema usa, com a taxa do lance no lugar da taxa de mercado (rateOverridePct). O
// vencedor paga exatamente o que propôs, sem reprecificação e sem arredondamento — a coluna
// `preco` é REAL e a liquidação sempre trabalhou com o valor fracionário.
export function priceForRate(duplicataId: string, taxaAm: number): number | null {
  const d = getDuplicata(duplicataId);
  if (!d) return null;
  return computePurchasePrice(d, taxaAm).precoCompra;
}

export function placeAuctionBid(user: UserRow, duplicataId: string, taxaAm: number): AuctionOutcome<{ bidId: number; taxaFmt: string; precoFmt: string }> {
  if (user.role !== 'investidor')
    return { status: 403, body: { error: 'forbidden', message: 'Apenas contas de investidor podem dar lances.' } };
  if (user.kyb_status !== 'approved')
    return { status: 403, body: { error: 'kyb_required', message: 'Seu credenciamento institucional ainda está em análise — assim que for aprovado você poderá dar lances.' } };

  const open = auctionIsOpen(duplicataId);
  if (!open.ok) return { status: open.status, body: { error: open.error, message: open.message } };

  if (!Number.isFinite(taxaAm) || taxaAm <= 0)
    return { status: 400, body: { error: 'validation_error', message: 'A taxa proposta precisa ser um número maior que zero.' } };

  const reserva = reserveRate(duplicataId)!;
  if (taxaAm > reserva.taxaAm)
    return {
      status: 409,
      body: {
        error: 'above_reserve',
        message: `Lance acima da reserva: o cedente aceita no máximo ${fmtTaxa(reserva.taxaAm)} a.m. (${fmtBRL(reserva.preco)}).`,
      },
    };

  const preco = priceForRate(duplicataId, taxaAm)!;
  // Substituir o próprio lance é permitido — inclusive por um pior, enquanto o leilão está
  // aberto, já que o investidor pode ter reavaliado o risco. Quem decide é o fechamento.
  const anterior = getActiveAuctionBid(duplicataId, user.id);
  if (anterior) setAuctionBidStatus(anterior.id, 'cancelado');
  const bid = createAuctionBid(duplicataId, user.id, taxaAm, preco);
  return { status: 200, body: { bidId: bid.id, taxaFmt: fmtTaxa(taxaAm), precoFmt: fmtBRL(preco) } };
}

export function cancelAuctionBid(user: UserRow, bidId: number): AuctionOutcome<{ ok: true }> {
  const bid = getAuctionBid(bidId);
  if (!bid) return { status: 404, body: { error: 'not_found' } };
  if (bid.bidder_id !== user.id) return { status: 403, body: { error: 'forbidden', message: 'Este lance não é seu.' } };
  if (bid.status !== 'ativo') return { status: 409, body: { error: 'not_active', message: 'Este lance não está mais ativo.' } };
  const open = auctionIsOpen(bid.duplicata_id);
  if (!open.ok) return { status: open.status, body: { error: open.error, message: open.message } };
  setAuctionBidStatus(bidId, 'cancelado');
  return { status: 200, body: { ok: true } };
}

export function fmtTaxa(taxaAm: number): string {
  return taxaAm.toFixed(2).replace('.', ',') + '%';
}

// Lances reais de uma duplicata, na ordem de vitória. Substitui getLiveExtraBids, que
// fabricava concorrentes a partir de BID_TEMPLATES/EXTRA_BIDDERS.
export function viewAuctionBids(duplicataId: string, viewerId: number | null): BidView[] {
  return listActiveAuctionBids(duplicataId).map((b) => ({
    id: b.id,
    empresa: b.bidder_company_name,
    taxaFmt: fmtTaxa(b.taxa_am),
    precoFmt: fmtBRL(b.preco),
    quando: b.created_at,
    isMine: viewerId !== null && b.bidder_id === viewerId,
  }));
}

// Leilões abertos onde este investidor ainda pode lançar — usado pela Automação de Lances,
// pelas cestas e pelo Fundo Confirming, que antes compravam instantaneamente.
export function listOpenAuctions() {
  return listMarketplace().filter((d) => auctionIsOpen(d.id).ok);
}

// Lances do próprio investidor, pra tela "meus lances" saber o que está pendente,
// vencido ou perdido sem varrer o marketplace.
export function viewMyAuctionBids(bidderId: number) {
  return listMyAuctionBids(bidderId).map((b) => ({
    id: b.id,
    duplicataId: b.duplicata_id,
    sacado: b.sacado_nome,
    valorFmt: fmtBRL(b.valor),
    taxaFmt: fmtTaxa(b.taxa_am),
    precoFmt: fmtBRL(b.preco),
    status: b.status,
    closeAt: b.close_at,
    quando: b.created_at,
  }));
}

export { effectiveMonthlyRatePct, auctionIsOpen };
