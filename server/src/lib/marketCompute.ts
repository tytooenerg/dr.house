import type { DuplicataRow } from '../db/types.js';
import { COLORS, INSURERS } from '../data/seed.js';
import { listActiveAuctionBids } from '../db/auctionBids.js';
import { fmtBRL, scoreColorFor, parseFlexibleDate } from './format.js';
import { getAceiteByDuplicata } from '../db/aceites.js';
import { isPurchased } from '../db/duplicatas.js';
import { auctionIsOpen } from './auctionGate.js';
import { ratingFromScore, SETOR_LABELS } from './riscoCore.js';
import { estimateRateBand } from './dynamicPricing.js';
import { listInsuranceQuotes } from './insuranceQuotes.js';
import { getLatestInsuranceSettlement } from '../db/insuranceSettlements.js';

const ACEITE_BADGE = {
  aceita: { label: 'Aceite confirmado', bg: '#EAF3EE', color: COLORS.GREEN },
  aguardando: { label: 'Aguardando aceite', bg: '#FBF1E0', color: COLORS.AMBER },
  contestada: { label: 'Aceite contestado', bg: '#F7E9E7', color: COLORS.RED },
};


// Real monthly deságio rate for a specific duplicata — either the rate actually agreed
// when it entered the book (d.desagio) or, for an offer still open on the marketplace,
// the dynamic rating-based estimate
// (lib/dynamicPricing.ts's estimateRateBand) reflecting real 30-day supply/demand instead of
// one fixed number for the whole marketplace.
export function effectiveMonthlyRatePct(d: DuplicataRow): number {
  const score = d.score ?? 60;
  return d.desagio ? parseFloat(d.desagio.replace(',', '.')) : estimateRateBand(ratingFromScore(score)).mid;
}

// Never let a very long-dated or very high-rate duplicata price down to almost nothing —
// anticipating a receivable trades term for cash today, it isn't a fire sale.
const MAX_DESCONTO_PCT = 0.6;

// The real price an investor actually pays to finance a duplicata now and collect its full
// face value back at maturity (lib/settlement.ts's settleAtMaturity) — until this, every
// buy path (lib/settlement.ts's settlePurchase) charged the investor the full face value
// and paid the same face value back at maturity, so the deságio shown everywhere in the UI
// was never actually applied to any real money movement: the investor earned nothing for
// financing early, only Lastro's own platform fee moved. Same simple (non-compounding)
// proration by term that routes/comparador.ts's public preview calculator already uses for
// its own deságio estimate. rateOverridePct lets a caller with its own already-negotiated
// rate (Confirming's programa.taxa_am) use that instead of the generic marketplace rate.
export function computePurchasePrice(
  d: DuplicataRow,
  rateOverridePct?: number
): { precoCompra: number; descontoValor: number; descontoPct: number; taxaAmPct: number } {
  const taxaAmPct = rateOverridePct ?? effectiveMonthlyRatePct(d);
  const prazoDias = Math.max(0, Math.round((parseFlexibleDate(d.vencimento).getTime() - Date.now()) / 86_400_000));
  const descontoPct = Math.min((taxaAmPct * (prazoDias / 30)) / 100, MAX_DESCONTO_PCT);
  const descontoValor = d.valor * descontoPct;
  return { precoCompra: d.valor - descontoValor, descontoValor, descontoPct, taxaAmPct };
}

export function buildOfferView(d: DuplicataRow, viewerId: number | null = null) {
  const score = d.score ?? 60;
  const sc = scoreColorFor(score);
  const baseRate = effectiveMonthlyRatePct(d);
  const desagio = baseRate.toFixed(2).replace('.', ',') + '%';
  const { precoCompra, descontoValor } = computePurchasePrice(d, baseRate);
  const aceite = getAceiteByDuplicata(d.id);
  const aceiteStatus = aceite?.status ?? 'aguardando';
  const aceiteBadge = ACEITE_BADGE[aceiteStatus];
  const bought = isPurchased(d.id);

  // Lances REAIS. Antes daqui saíam concorrentes fabricados: BID_TEMPLATES/EXTRA_BIDDERS
  // (data/seed.ts) davam oito nomes inventados — incluindo instituições reais como "Itaú
  // BBA Recebíveis" e "BTG Pactual Crédito" — revelados num cronômetro, com taxas geradas
  // por fórmula, num leilão que nem sequer existia. Agora é o que está na tabela
  // auction_bids, e uma lista vazia é uma lista vazia.
  const bidRows = listActiveAuctionBids(d.id);
  const bids = bidRows.map((b, i) => ({
    id: b.id,
    name: b.bidder_company_name,
    initials: b.bidder_company_name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase(),
    tipo: b.bidder_id === viewerId ? 'Seu lance' : 'Investidor',
    avatarBg: b.bidder_id === viewerId ? COLORS.BLUE : COLORS.NAVY,
    taxa: b.taxa_am.toFixed(2).replace('.', ',') + '%',
    rateColor: i === 0 ? COLORS.GREEN : COLORS.NAVY,
    borderColor: i === 0 ? COLORS.GREEN : '#E4E8EE',
    tag: i === 0 ? 'Melhor lance' : 'Lance ativo',
    tagBg: i === 0 ? '#EAF3EE' : '#F0F2F5',
    tagColor: i === 0 ? COLORS.GREEN : '#5B6472',
    isMine: b.bidder_id === viewerId,
  }));

  const closeAt = d.close_at ? new Date(d.close_at).getTime() : Date.now();
  const remainingSec = Math.max(0, Math.round((closeAt - Date.now()) / 1000));
  const countdown = `${Math.floor(remainingSec / 3600)}h ${String(Math.floor((remainingSec % 3600) / 60)).padStart(2, '0')}min`;
  // O prazo agora decide de verdade quem leva a duplicata (lib/auctionClose.ts), então a
  // oferta precisa carregar o estado real do leilão — antes `canBuy` só olhava o aceite e
  // prometia "Comprar" em duplicata cujo leilão o backend já tinha encerrado.
  const gate = auctionIsOpen(d.id);
  const meuLanceRow = viewerId === null ? null : bidRows.find((b) => b.bidder_id === viewerId) ?? null;

  // insurerInfo shows the premium actually charged at insure-time (the recorded
  // settlement), never a freshly recomputed quote — a sacado's score moving afterward
  // must not retroactively change what the investor is shown as already having paid.
  // insurerOptions are today's live competing quotes (lib/insuranceQuotes.ts), cheapest
  // first and flagged — this is what changes every time score/valor/vencimento change.
  let insurer: { key: string; name: string; premioFmt: string; selo: string } | null = null;
  if (d.insurer_key) {
    const catalogEntry = INSURERS.find((ins) => ins.key === d.insurer_key);
    const settlement = getLatestInsuranceSettlement(d.id);
    const premioFmt = settlement && d.valor > 0 ? ((settlement.premio / d.valor) * 100).toFixed(2).replace('.', ',') + '%' : catalogEntry?.premioFmt ?? '—';
    insurer = catalogEntry ? { key: catalogEntry.key, name: catalogEntry.name, premioFmt, selo: catalogEntry.selo } : null;
  }
  const insurerOptions = listInsuranceQuotes(d);
  const rating = ratingFromScore(score);
  const prazoDias = Math.max(0, Math.round((parseFlexibleDate(d.vencimento).getTime() - Date.now()) / 86_400_000));

  return {
    id: d.id,
    sacado: d.sacado_nome,
    cedente: d.cedente_nome,
    valor: d.valor,
    valorFmt: fmtBRL(d.valor),
    desagio,
    // O que o investidor de fato paga agora (e recebe o valor de face — valorFmt acima — de
    // volta no vencimento) — ver computePurchasePrice acima pra por que isso não era assim
    // antes.
    precoCompra,
    precoCompraFmt: fmtBRL(precoCompra),
    descontoValorFmt: fmtBRL(descontoValor),
    vencimento: d.vencimento,
    prazoDias,
    setor: d.setor,
    setorLabel: d.setor ? SETOR_LABELS[d.setor as keyof typeof SETOR_LABELS] ?? d.setor : null,
    score,
    rating,
    scoreBg: sc === COLORS.GREEN ? '#EAF3EE' : sc === COLORS.AMBER ? '#FBF1E0' : '#F7E9E7',
    scoreColor: sc,
    isBought: bought,
    // Achado corrigido: uma duplicata só pode ser negociada depois que o sacado aceita
    // (explícito ou tácito) — canBuy/btnLabel refletiam só "não contestada". Na prática,
    // uma oferta com status 'no_mercado' hoje já implica aceite confirmado (dispararLeilao
    // exige isso antes de sair de 'aprovada'), então 'aguardando' aqui só apareceria por
    // dado legado/seed inconsistente — mantido como defesa em profundidade e pra não
    // prometer "Comprar" num estado que o backend recusaria.
    btnLabel: bought
      ? 'Comprada'
      : aceiteStatus === 'contestada'
        ? 'Bloqueada'
        : aceiteStatus !== 'aceita'
          ? 'Aguardando aceite'
          : gate.ok
            ? meuLanceRow
              ? 'Alterar lance'
              : 'Dar lance'
            : 'Leilão encerrado',
    // `canBuy` é o mesmo predicado que o backend aplica em placeAuctionBid (lib/auctionGate.ts),
    // não uma segunda opinião do client — nome mantido pra não quebrar quem já lê o campo.
    canBuy: gate.ok,
    leilaoAberto: gate.ok,
    leilaoMotivo: gate.ok ? null : gate.error,
    closeAtIso: d.close_at,
    leilaoFechadoEm: d.leilao_fechado_em,
    // Reserva: o pior deságio que o cedente aceita. Lance acima disso é recusado com 409.
    reservaTaxaAm: baseRate,
    reservaTaxaFmt: desagio,
    reservaPrecoFmt: fmtBRL(precoCompra),
    melhorTaxaFmt: bidRows.length ? bidRows[0].taxa_am.toFixed(2).replace('.', ',') + '%' : null,
    meuLance: meuLanceRow
      ? {
          id: meuLanceRow.id,
          taxaAm: meuLanceRow.taxa_am,
          taxaFmt: meuLanceRow.taxa_am.toFixed(2).replace('.', ',') + '%',
          precoFmt: fmtBRL(meuLanceRow.preco),
          liderando: bidRows[0]?.id === meuLanceRow.id,
        }
      : null,
    bidCount: bids.length,
    bids,
    countdown,
    countdownSec: remainingSec,
    aceiteBadgeLabel: aceiteBadge.label,
    aceiteBadgeBg: aceiteBadge.bg,
    aceiteBadgeColor: aceiteBadge.color,
    insurerInfo: insurer,
    insurerOptions,
    aiMatch: score >= 76,
    aiMatchPct: score >= 84 ? '96%' : '89%',
  };
}
