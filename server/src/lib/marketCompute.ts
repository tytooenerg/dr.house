import type { DuplicataRow } from '../db/types.js';
import { BID_TEMPLATES, COLORS, EXTRA_BIDDERS, INSURERS } from '../data/seed.js';
import { fmtBRL, scoreColorFor } from './format.js';
import { getAceiteByDuplicata } from '../db/aceites.js';
import { isPurchased } from '../db/duplicatas.js';
import { ratingFromScore } from './riscoCore.js';
import { estimateRateBand } from './dynamicPricing.js';

const ACEITE_BADGE = {
  aceita: { label: 'Aceite confirmado', bg: '#EAF3EE', color: COLORS.GREEN },
  aguardando: { label: 'Aguardando aceite', bg: '#FBF1E0', color: COLORS.AMBER },
  contestada: { label: 'Aceite contestado', bg: '#F7E9E7', color: COLORS.RED },
};

function getLiveExtraBids(startedAt: string | null, baseRate: number) {
  if (!startedAt) return [];
  const elapsed = (Date.now() - new Date(startedAt).getTime()) / 1000;
  const REVEAL_AT = [4, 30, 90, 240];
  const bids: { name: string; initials: string; tipo: string; avatarBg: string; rate: number }[] = [];
  EXTRA_BIDDERS.forEach((b, i) => {
    if (elapsed >= REVEAL_AT[i]) {
      const drop = (i + 1) * 0.15 + 0.05 + (i % 2 === 0 ? 0.08 : 0.14);
      bids.push({ ...b, rate: +(baseRate - drop).toFixed(2) });
    }
  });
  return bids;
}

export function buildOfferView(d: DuplicataRow) {
  const score = d.score ?? 60;
  const sc = scoreColorFor(score);
  // desagio is never actually populated at emission time — this was a flat '2,5%' for
  // every real duplicata regardless of rating or market conditions until now. Falls back
  // to a rating-based estimate adjusted by real 30-day supply/demand (lib/dynamicPricing.ts)
  // instead of one fixed number for the whole marketplace.
  const baseRate = d.desagio ? parseFloat(d.desagio.replace(',', '.')) : estimateRateBand(ratingFromScore(score)).mid;
  const desagio = baseRate.toFixed(2).replace('.', ',') + '%';
  const aceite = getAceiteByDuplicata(d.id);
  const aceiteStatus = aceite?.status ?? 'aguardando';
  const aceiteBadge = ACEITE_BADGE[aceiteStatus];
  const bought = isPurchased(d.id);

  const extra = getLiveExtraBids(d.leilao_started_at, baseRate);
  const bidsRaw = BID_TEMPLATES.map((b, i) => ({ ...b, rate: +(baseRate + i * 0.35).toFixed(2) }))
    .concat(extra)
    .sort((a, b) => a.rate - b.rate);
  const bids = bidsRaw.map((b, i) => ({
    name: b.name,
    initials: b.initials,
    tipo: b.tipo,
    avatarBg: b.avatarBg,
    taxa: b.rate.toFixed(2).replace('.', ',') + '%',
    rateColor: i === 0 ? COLORS.GREEN : COLORS.NAVY,
    borderColor: i === 0 ? COLORS.GREEN : '#E4E8EE',
    tag: i === 0 ? 'Melhor oferta' : 'Lance ativo',
    tagBg: i === 0 ? '#EAF3EE' : '#F0F2F5',
    tagColor: i === 0 ? COLORS.GREEN : '#5B6472',
  }));

  const closeAt = d.close_at ? new Date(d.close_at).getTime() : Date.now();
  const remainingSec = Math.max(0, Math.round((closeAt - Date.now()) / 1000));
  const countdown = `${Math.floor(remainingSec / 3600)}h ${String(Math.floor((remainingSec % 3600) / 60)).padStart(2, '0')}min`;

  const insurer = d.insurer_key ? INSURERS.find((ins) => ins.key === d.insurer_key) ?? null : null;

  return {
    id: d.id,
    sacado: d.sacado_nome,
    cedente: d.cedente_nome,
    valor: d.valor,
    valorFmt: fmtBRL(d.valor),
    desagio,
    vencimento: d.vencimento,
    score,
    scoreBg: sc === COLORS.GREEN ? '#EAF3EE' : sc === COLORS.AMBER ? '#FBF1E0' : '#F7E9E7',
    scoreColor: sc,
    isBought: bought,
    btnLabel: bought ? 'Comprada' : aceiteStatus === 'contestada' ? 'Bloqueada' : 'Comprar',
    canBuy: !bought && aceiteStatus !== 'contestada',
    bidCount: bids.length,
    bids,
    countdown,
    countdownSec: remainingSec,
    aceiteBadgeLabel: aceiteBadge.label,
    aceiteBadgeBg: aceiteBadge.bg,
    aceiteBadgeColor: aceiteBadge.color,
    insurerInfo: insurer,
    insurerOptions: INSURERS,
    aiMatch: score >= 76,
    aiMatchPct: score >= 84 ? '96%' : '89%',
    aiSuggestedRate: (baseRate - 0.3).toFixed(1).replace('.', ',') + '%',
  };
}
