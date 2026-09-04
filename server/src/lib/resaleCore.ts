import { z } from 'zod';
import { getDuplicata, createPurchase, listPurchasesByInvestor } from '../db/duplicatas.js';
import {
  createListing,
  deactivatePurchase,
  getActivePurchaseByDuplicata,
  getListing,
  getListingForPurchase,
  getPurchaseById,
  listActiveListings,
  listListingsBySeller,
  setListingStatus,
} from '../db/resaleListings.js';
import {
  bestActiveBidsByListing,
  createBid,
  getActiveBidByBidder,
  getBid,
  listActiveBidsForListing,
  listMyBids,
  setBidStatus,
  supersedeOtherActiveBids,
} from '../db/resaleBids.js';
import { addNotification } from '../db/misc.js';
import { recordAuditEvent } from '../db/audit.js';
import { informarNegociacao, type RegistradoraKey } from './registradoras.js';
import { settleResale } from './settlement.js';
import { fmtBRL, parseFlexibleDate } from './format.js';
import { COLORS } from '../data/seed.js';
import type { UserRow } from '../db/types.js';

export const createListingSchema = z.object({
  purchaseId: z.number().int().positive(),
  askingValor: z.string().trim(),
});

export const buyListingSchema = z.object({ listingId: z.number().int().positive() });

export const placeBidSchema = z.object({ listingId: z.number().int().positive(), valor: z.string().trim() });

export function parseValor(raw: string): number {
  return Number(raw.replace(/\./g, '').replace(',', '.')) || 0;
}

function daysUntil(vencimento: string): number {
  return Math.max(0, Math.round((parseFlexibleDate(vencimento).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
}

// Real market depth: the best (highest) active bid on each listing, alongside its asking
// price — a buyer sees "the market" is willing to pay X even if the seller's ask is
// higher, the same signal a real order book's top-of-book gives, without exposing who
// placed it (bidder identity is only ever shown to the listing's own seller).
export function viewResaleMarket() {
  const bestBids = bestActiveBidsByListing();
  return listActiveListings().map((l) => {
    const melhorLance = bestBids.get(l.id) ?? null;
    return {
      id: l.id,
      duplicataId: l.duplicata_id,
      sacado: l.sacado_nome,
      cedente: l.cedente_nome,
      score: l.score,
      vencimento: l.vencimento,
      diasRestantes: daysUntil(l.vencimento),
      valor: l.asking_valor,
      valorOriginalFmt: fmtBRL(l.original_valor),
      precoFmt: fmtBRL(l.asking_valor),
      variacaoPct: l.original_valor > 0 ? +(((l.asking_valor - l.original_valor) / l.original_valor) * 100).toFixed(2) : 0,
      melhorLanceFmt: melhorLance !== null ? fmtBRL(melhorLance) : null,
    };
  });
}

// Positions this investor currently holds that are still tradeable (active, not yet
// vencida, not already listed) — what the "revender" form on the client offers to sell.
export function viewMyResalablePositions(userId: number) {
  const result: { purchaseId: number; duplicataId: string; sacado: string; valorPagoFmt: string; vencimento: string; diasRestantes: number }[] = [];
  for (const purchase of listPurchasesByInvestor(userId)) {
    if (!purchase.active) continue;
    const duplicata = getDuplicata(purchase.duplicata_id);
    if (!duplicata) continue;
    if (parseFlexibleDate(duplicata.vencimento).getTime() <= Date.now()) continue;
    if (getListingForPurchase(purchase.id)) continue;
    result.push({
      purchaseId: purchase.id,
      duplicataId: duplicata.id,
      sacado: duplicata.sacado_nome,
      valorPagoFmt: fmtBRL(purchase.valor),
      vencimento: duplicata.vencimento,
      diasRestantes: daysUntil(duplicata.vencimento),
    });
  }
  return result;
}

// Sellers see the full bid book on their own listings — bidder company name and value —
// so they can pick which one (if any) to accept, unlike the anonymous "melhor lance" the
// public market view shows everyone else.
export function viewMyListings(userId: number) {
  return listListingsBySeller(userId).map((l) => ({
    id: l.id,
    duplicataId: l.duplicata_id,
    precoFmt: fmtBRL(l.asking_valor),
    status: l.status,
    lances:
      l.status === 'ativo'
        ? listActiveBidsForListing(l.id).map((b) => ({ id: b.id, bidderCompanyName: b.bidder_company_name, valorFmt: fmtBRL(b.valor) }))
        : [],
  }));
}

// Buyer-side view of the bids they've placed, across every listing — mirrors the "meus
// anúncios" seller view but from the other side of the book.
export function viewMyBids(userId: number) {
  return listMyBids(userId).map((b) => ({
    id: b.id,
    listingId: b.listing_id,
    duplicataId: b.duplicata_id,
    valorFmt: fmtBRL(b.valor),
    askingValorFmt: fmtBRL(b.asking_valor),
    status: b.status,
    listingStatus: b.listing_status,
  }));
}

export type ResaleOutcome<T> =
  | { status: 200; body: T }
  | { status: 400; body: { error: 'validation_error'; message: string } }
  | { status: 403; body: { error: string; message: string } }
  | { status: 404; body: { error: 'not_found'; message: string } }
  | { status: 409; body: { error: string; message: string } };

// A resale listing is only valid while the position hasn't matured yet — once vencimento
// passes the receivable should have been paid out, not traded.
export function createResaleListing(user: UserRow, purchaseId: number, askingValorRaw: string): ResaleOutcome<{ listingId: number; market: ReturnType<typeof viewResaleMarket> }> {
  const purchase = getPurchaseById(purchaseId);
  if (!purchase || purchase.investor_id !== user.id || !purchase.active) {
    return { status: 404, body: { error: 'not_found', message: 'Posição não encontrada ou não pertence a você.' } };
  }
  const duplicata = getDuplicata(purchase.duplicata_id);
  if (!duplicata || parseFlexibleDate(duplicata.vencimento).getTime() < Date.now()) {
    return { status: 409, body: { error: 'expired', message: 'Esta duplicata já venceu e não pode mais ser revendida.' } };
  }
  if (getListingForPurchase(purchaseId)) {
    return { status: 409, body: { error: 'already_listed', message: 'Você já tem um anúncio ativo para esta posição.' } };
  }
  const askingValor = parseValor(askingValorRaw);
  if (askingValor <= 0) {
    return { status: 400, body: { error: 'validation_error', message: 'Informe um preço de venda válido.' } };
  }
  const listing = createListing(purchaseId, purchase.duplicata_id, user.id, askingValor);
  recordAuditEvent(user.id, user.company_name, 'resale.listado', { duplicataId: purchase.duplicata_id, askingValor });
  return { status: 200, body: { listingId: listing.id, market: viewResaleMarket() } };
}

export function cancelResaleListing(user: UserRow, listingId: number): ResaleOutcome<{ ok: true }> {
  const listing = getListing(listingId);
  if (!listing || listing.seller_id !== user.id || listing.status !== 'ativo') {
    return { status: 404, body: { error: 'not_found', message: 'Anúncio não encontrado.' } };
  }
  setListingStatus(listingId, 'cancelado');
  return { status: 200, body: { ok: true } };
}

// Shared by every way a resale position can change hands — buying at the asking price
// outright, a seller accepting a bid, or a block trade sweeping several listings at once.
// Closes out the seller's position (their original purchase row is deactivated, its
// economics stay in history) and opens a brand new active purchase for the buyer at the
// agreed price — same mechanism the primary marketplace buy uses.
// feeDiscountPct (0-1) is used by the institutional block trade flow (lib/blockTrade.ts) to
// apply a volume-based discount to the *platform's own fee* — never to the price a seller
// actually receives. A seller's asking price (or an accepted bid) is what they consented
// to be paid; a block trade sweeping their listing pays exactly that, same as any other
// buyer, so undercutting it without consent would be a real, not simulated, unfairness.
// Isso não significa que o desconto é neutro: como não há conta de ledger representando
// "a plataforma" (ver lib/settlement.ts's settleResale), uma taxa menor vira dinheiro
// extra creditado no próprio vendedor, nunca uma perda — mas também nunca um efeito zero.
export function executeResaleTrade(
  listing: { id: number; purchase_id: number; duplicata_id: string; seller_id: number },
  duplicata: { valor: number; sacado_nome: string; registradora: string | null },
  buyerId: number,
  valor: number,
  feeDiscountPct = 0
) {
  const desagioPct = duplicata.valor > 0 ? (((duplicata.valor - valor) / duplicata.valor) * 100).toFixed(1).replace('.', ',') + '%' : '0%';
  const originalPurchase = getPurchaseById(listing.purchase_id);
  const settlement = settleResale({ duplicataId: listing.duplicata_id, sacadoNome: duplicata.sacado_nome, buyerId, sellerId: listing.seller_id, valor, feeDiscountPct });
  // O ganho real do vendedor ao sair da posição antes do vencimento é o que ele efetivamente
  // recebeu na revenda (líquido da taxa de plataforma) menos o que ele pagou originalmente —
  // não o "retorno esperado se tivesse segurado até o vencimento" que a linha carregava desde
  // a compra. Sem atualizar isso aqui, Carteira & Histórico, Performance institucional, o
  // relatório PDF, o Informe de Rendimentos e o DARF continuariam mostrando um número que o
  // investidor nunca recebeu de verdade (ver db/resaleListings.ts's deactivatePurchase).
  //
  // O que o vendedor pagou não dá pra ler direto de originalPurchase.valor: essa coluna
  // guarda o valor de face pra uma compra primária (routes/market.ts e afins), mas o preço
  // efetivamente pago pra uma posição que já veio de uma revenda anterior — o mesmo campo
  // significa duas coisas diferentes dependendo da origem da linha. `duplicata.valor` (o
  // valor de face real, que não muda entre revendas) menos o retorno que a linha já carregava
  // recupera o custo de aquisição corretamente nos dois casos: pra uma compra primária,
  // retorno = faceValue − precoCompra, então faceValue − retorno = precoCompra; pra uma
  // posição já revendida, retorno = faceValue − precoPago, então faceValue − retorno =
  // precoPago igualmente.
  const oQueOVendedorPagou = duplicata.valor - (originalPurchase?.retorno ?? 0);
  deactivatePurchase(listing.purchase_id, Math.round(settlement.net - oQueOVendedorPagou));
  // Real, determinístico — o mesmo número usado pra desagioPct acima, em reais em vez de
  // percentual: o novo comprador paga `valor` (preço combinado) e recebe o valor de face
  // cheio no vencimento, então isso é o ganho real dele (pode ser negativo se comprou com
  // ágio acima do valor de face — honesto, não um número fabricado por Math.random()).
  createPurchase(listing.duplicata_id, buyerId, valor, desagioPct, Math.round(duplicata.valor - valor));
  setListingStatus(listing.id, 'vendido');
  // Res. BCB nº 540/2025 — ver comentário de informarNegociacao (lib/registradoras.ts).
  void informarNegociacao({ registradoraKey: duplicata.registradora as RegistradoraKey | null, duplicataId: listing.duplicata_id, evento: 'revenda', valor });
  return settlement;
}

// Buying a resale listing closes out the seller's position (their original purchase row is
// deactivated, its economics stay in history) and opens a brand new active purchase for the
// buyer at the agreed resale price — same mechanism the primary marketplace buy uses.
export function buyResaleListing(user: UserRow, listingId: number): ResaleOutcome<{ market: ReturnType<typeof viewResaleMarket> }> {
  if (user.role !== 'investidor') {
    return { status: 403, body: { error: 'forbidden', message: 'Apenas contas de investidor podem comprar no mercado secundário.' } };
  }
  if (user.kyb_status !== 'approved') {
    return { status: 403, body: { error: 'kyb_required', message: 'Seu credenciamento institucional ainda está em análise.' } };
  }
  const listing = getListing(listingId);
  if (!listing || listing.status !== 'ativo') {
    return { status: 404, body: { error: 'not_found', message: 'Anúncio não encontrado ou já vendido.' } };
  }
  if (listing.seller_id === user.id) {
    return { status: 409, body: { error: 'own_listing', message: 'Você não pode comprar seu próprio anúncio.' } };
  }
  const duplicata = getDuplicata(listing.duplicata_id);
  if (!duplicata || parseFlexibleDate(duplicata.vencimento).getTime() < Date.now()) {
    return { status: 409, body: { error: 'expired', message: 'Esta duplicata já venceu.' } };
  }
  const existingActive = getActivePurchaseByDuplicata(listing.duplicata_id);
  if (!existingActive || existingActive.id !== listing.purchase_id) {
    return { status: 409, body: { error: 'stale_listing', message: 'Esta posição já mudou de mãos — atualize a página.' } };
  }
  const { fee } = executeResaleTrade(listing, duplicata, user.id, listing.asking_valor);
  supersedeOtherActiveBids(listingId, null);
  addNotification(
    listing.seller_id,
    `Sua posição na duplicata ${listing.duplicata_id} foi vendida no mercado secundário por ${fmtBRL(listing.asking_valor)} (líquido de ${fmtBRL(fee)} de taxa de plataforma).`,
    COLORS.GREEN
  );
  recordAuditEvent(user.id, user.company_name, 'resale.comprado', { duplicataId: listing.duplicata_id, listingId, valor: listing.asking_valor });
  return { status: 200, body: { market: viewResaleMarket() } };
}

// A bid is an offer below/at/above the asking price — the seller decides whether to accept
// it, unlike buyResaleListing where the buyer unilaterally takes the listed price. Placing
// a new bid while one is already active on the same listing replaces it rather than
// stacking a second row, so "my current offer" stays unambiguous both to the bidder and to
// the seller reviewing their book.
export function placeBid(user: UserRow, listingId: number, valorRaw: string): ResaleOutcome<{ bidId: number; market: ReturnType<typeof viewResaleMarket> }> {
  if (user.role !== 'investidor') {
    return { status: 403, body: { error: 'forbidden', message: 'Apenas contas de investidor podem dar lances no mercado secundário.' } };
  }
  if (user.kyb_status !== 'approved') {
    return { status: 403, body: { error: 'kyb_required', message: 'Seu credenciamento institucional ainda está em análise.' } };
  }
  const listing = getListing(listingId);
  if (!listing || listing.status !== 'ativo') {
    return { status: 404, body: { error: 'not_found', message: 'Anúncio não encontrado ou já vendido.' } };
  }
  if (listing.seller_id === user.id) {
    return { status: 409, body: { error: 'own_listing', message: 'Você não pode dar lance no seu próprio anúncio.' } };
  }
  const valor = parseValor(valorRaw);
  if (valor <= 0) {
    return { status: 400, body: { error: 'validation_error', message: 'Informe um valor de lance válido.' } };
  }
  const existing = getActiveBidByBidder(listingId, user.id);
  if (existing) setBidStatus(existing.id, 'superado');
  const bid = createBid(listingId, user.id, valor);
  addNotification(listing.seller_id, `Novo lance de ${fmtBRL(valor)} na sua duplicata ${listing.duplicata_id} no mercado secundário.`, COLORS.BLUE);
  recordAuditEvent(user.id, user.company_name, 'resale.lance_dado', { duplicataId: listing.duplicata_id, listingId, valor });
  return { status: 200, body: { bidId: bid.id, market: viewResaleMarket() } };
}

export function cancelBid(user: UserRow, bidId: number): ResaleOutcome<{ ok: true }> {
  const bid = getBid(bidId);
  if (!bid || bid.bidder_id !== user.id || bid.status !== 'ativo') {
    return { status: 404, body: { error: 'not_found', message: 'Lance não encontrado.' } };
  }
  setBidStatus(bidId, 'cancelado');
  return { status: 200, body: { ok: true } };
}

export function rejectBid(user: UserRow, bidId: number): ResaleOutcome<{ ok: true }> {
  const bid = getBid(bidId);
  if (!bid || bid.status !== 'ativo') {
    return { status: 404, body: { error: 'not_found', message: 'Lance não encontrado.' } };
  }
  const listing = getListing(bid.listing_id);
  if (!listing || listing.seller_id !== user.id) {
    return { status: 404, body: { error: 'not_found', message: 'Lance não encontrado.' } };
  }
  setBidStatus(bidId, 'recusado');
  addNotification(bid.bidder_id, `Seu lance na duplicata ${listing.duplicata_id} foi recusado pelo vendedor.`, COLORS.AMBER);
  return { status: 200, body: { ok: true } };
}

// The seller accepts a specific bid — trades execute at the bid's value, not the listing's
// asking price, real price discovery instead of a fixed classified-ad price.
export function acceptBid(user: UserRow, bidId: number): ResaleOutcome<{ market: ReturnType<typeof viewResaleMarket> }> {
  const bid = getBid(bidId);
  if (!bid || bid.status !== 'ativo') {
    return { status: 404, body: { error: 'not_found', message: 'Lance não encontrado.' } };
  }
  const listing = getListing(bid.listing_id);
  if (!listing || listing.seller_id !== user.id || listing.status !== 'ativo') {
    return { status: 404, body: { error: 'not_found', message: 'Anúncio não encontrado ou já vendido.' } };
  }
  const duplicata = getDuplicata(listing.duplicata_id);
  if (!duplicata || parseFlexibleDate(duplicata.vencimento).getTime() < Date.now()) {
    return { status: 409, body: { error: 'expired', message: 'Esta duplicata já venceu.' } };
  }
  const existingActive = getActivePurchaseByDuplicata(listing.duplicata_id);
  if (!existingActive || existingActive.id !== listing.purchase_id) {
    return { status: 409, body: { error: 'stale_listing', message: 'Esta posição já mudou de mãos — atualize a página.' } };
  }
  const { fee } = executeResaleTrade(listing, duplicata, bid.bidder_id, bid.valor);
  setBidStatus(bidId, 'aceito');
  supersedeOtherActiveBids(listing.id, bidId);
  addNotification(
    bid.bidder_id,
    `Seu lance de ${fmtBRL(bid.valor)} na duplicata ${listing.duplicata_id} foi aceito pelo vendedor — a posição já está na sua carteira.`,
    COLORS.GREEN
  );
  addNotification(
    listing.seller_id,
    `Você aceitou um lance de ${fmtBRL(bid.valor)} na duplicata ${listing.duplicata_id} (líquido de ${fmtBRL(fee)} de taxa de plataforma).`,
    COLORS.GREEN
  );
  recordAuditEvent(user.id, user.company_name, 'resale.lance_aceito', { duplicataId: listing.duplicata_id, listingId: listing.id, bidId, valor: bid.valor });
  return { status: 200, body: { market: viewResaleMarket() } };
}
