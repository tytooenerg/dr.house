import { state } from './state.js';
import { fmtBRL, parseBRLNumber, ratingColors, scoreColorFor } from '../lib/format.js';
import {
  ACEITE_MAP, ACEITES_RAW, BID_TEMPLATES, COLORS, DISPUTE_MOTIVOS, DISPUTE_TIMELINES, EXTRA_BIDDERS,
  HISTORICO_RAW, INSURERS, KPIS_RAW, MINHAS_RAW, MONTHS_RAW, OFFERS_RAW, RATING_LEGEND, REVENUE_RAW, REV_COLORS, SACADOS,
} from '../data/seed.js';

const ACEITE_BADGE = {
  aceita: { label: 'Aceite confirmado', bg: '#EAF3EE', color: COLORS.GREEN },
  aguardando: { label: 'Aguardando aceite', bg: '#FBF1E0', color: COLORS.AMBER },
  contestada: { label: 'Aceite contestado', bg: '#F7E9E7', color: COLORS.RED },
};

const ACEITE_STATUS_META = {
  aguardando: { label: 'Aguardando manifestação', bg: '#FBF1E0', color: COLORS.AMBER },
  aceita: { label: 'Aceita pelo sacado', bg: '#EAF3EE', color: COLORS.GREEN },
  contestada: { label: 'Contestada', bg: '#F7E9E7', color: COLORS.RED },
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  'No mercado': { bg: '#E9EEFB', color: COLORS.BLUE },
  'Pendente análise': { bg: '#FBF1E0', color: COLORS.AMBER },
  Paga: { bg: '#EAF3EE', color: COLORS.GREEN },
  Aprovada: { bg: '#EAF3EE', color: COLORS.GREEN },
};

export function getKpis() {
  return KPIS_RAW.map((k, i) => ({
    ...k,
    cardBg: i === 0 ? COLORS.NAVY : '#fff',
    labelColor: i === 0 ? '#9FB3D6' : '#5B6472',
    valueColor: i === 0 ? '#fff' : COLORS.NAVY,
    valueSize: i === 0 ? 30 : 26,
  }));
}

export function getMonthlyBars() {
  const maxV = Math.max(...MONTHS_RAW.map((m) => m.v));
  return MONTHS_RAW.map((m) => ({
    label: m.label,
    valueLabel: m.v.toFixed(1) + 'M',
    heightPct: Math.round((m.v / maxV) * 100),
    color: m.label === 'Jul' ? COLORS.BLUE : '#C7D6FF',
  }));
}

export function getRatingLegend() {
  return RATING_LEGEND;
}

export function getRiskDonutStops() {
  return [
    { color: COLORS.GREEN, from: 0, to: 58 },
    { color: COLORS.AMBER, from: 58, to: 85 },
    { color: COLORS.RED, from: 85, to: 96 },
    { color: '#E4E8EE', from: 96, to: 100 },
  ];
}

function ensureAuctionSchedule(offerId: number) {
  if (!state.offerCloseAt[offerId]) {
    const raw = OFFERS_RAW.find((o) => o.id === offerId)!;
    state.offerCloseAt[offerId] = Date.now() + raw.countdownSec * 1000;
  }
  if (state.expandedOfferId === offerId && !state.offerExpandedAt[offerId]) {
    state.offerExpandedAt[offerId] = Date.now();
  }
}

function getLiveExtraBids(offerId: number, baseRate: number) {
  const expandedAt = state.offerExpandedAt[offerId];
  if (!expandedAt) return [];
  const elapsed = (Date.now() - expandedAt) / 1000;
  const REVEAL_AT = [4, 9, 15, 22];
  const bids: { name: string; initials: string; tipo: string; avatarBg: string; rate: number }[] = [];
  EXTRA_BIDDERS.forEach((b, i) => {
    if (elapsed >= REVEAL_AT[i]) {
      const drop = (i + 1) * 0.15 + 0.05 + (i % 2 === 0 ? 0.08 : 0.14);
      bids.push({ ...b, rate: +(baseRate - drop).toFixed(2) });
    }
  });
  return bids;
}

export function getOffers() {
  return OFFERS_RAW.map((o) => {
    ensureAuctionSchedule(o.id);
    const isBought = !!state.purchased[o.id];
    const isExpanded = state.expandedOfferId === o.id;
    const sc = scoreColorFor(o.score);
    const aceiteStatus = ACEITE_MAP[o.id] || 'aguardando';
    const aceiteBadge = ACEITE_BADGE[aceiteStatus];
    const baseRate = parseFloat(o.desagio.replace(',', '.'));

    const extra = getLiveExtraBids(o.id, baseRate);
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

    const closeAt = state.offerCloseAt[o.id];
    const remainingSec = Math.max(0, Math.round((closeAt - Date.now()) / 1000));
    const countdown = `${Math.floor(remainingSec / 3600)}h ${String(Math.floor((remainingSec % 3600) / 60)).padStart(2, '0')}min`;

    const insurerKey = state.insuredOffers[o.id];
    const insurer = insurerKey ? INSURERS.find((ins) => ins.key === insurerKey) ?? null : null;

    return {
      ...o,
      valorFmt: fmtBRL(o.valor),
      scoreLabel: o.score,
      scoreBg: sc === COLORS.GREEN ? '#EAF3EE' : sc === COLORS.AMBER ? '#FBF1E0' : '#F7E9E7',
      scoreColor: sc,
      isBought,
      btnLabel: isBought ? 'Comprada' : aceiteStatus === 'contestada' ? 'Bloqueada' : 'Comprar',
      canBuy: !isBought && aceiteStatus !== 'contestada',
      isExpanded,
      bidCount: bids.length,
      bids,
      countdown,
      countdownSec: remainingSec,
      aceiteBadgeLabel: aceiteBadge.label,
      aceiteBadgeBg: aceiteBadge.bg,
      aceiteBadgeColor: aceiteBadge.color,
      insurerInfo: insurer,
      insurerOptions: INSURERS,
      seguroPickerOpen: false,
      aiMatch: o.score >= 76,
      aiMatchPct: o.score >= 84 ? '96%' : '89%',
      aiSuggestedRate: (parseFloat(o.desagio.replace(',', '.')) - 0.3).toFixed(1).replace('.', ',') + '%',
    };
  });
}

export function getFilteredOffers() {
  const offers = getOffers();
  const mq = state.marketQuery.trim().toLowerCase();
  let filtered = mq ? offers.filter((o) => o.sacado.toLowerCase().includes(mq) || o.cedente.toLowerCase().includes(mq)) : offers.slice();
  const sortKey = state.marketSort;
  if (sortKey === 'taxa') filtered.sort((a, b) => parseFloat(a.desagio) - parseFloat(b.desagio));
  else if (sortKey === 'score') filtered.sort((a, b) => b.score - a.score);
  else if (sortKey === 'valor') filtered.sort((a, b) => b.valor - a.valor);
  else if (sortKey === 'prazo') filtered.sort((a, b) => a.countdownSec - b.countdownSec);
  return filtered;
}

export function getMinhasDuplicatas() {
  const all = [...MINHAS_RAW, ...state.emittedDuplicatas];
  return all.map((d) => {
    const disparado = !!state.leiloesDisparados[d.id];
    const effectiveStatus = disparado && d.status === 'Aprovada' ? 'No mercado' : d.status;
    const canDisparar = d.lastro === 100 && d.status === 'Aprovada' && !disparado;
    const meta = STATUS_COLORS[effectiveStatus] ?? { bg: '#F0F2F5', color: '#5B6472' };
    return {
      ...d,
      status: effectiveStatus,
      valorFmt: fmtBRL(d.valor),
      statusBg: meta.bg,
      statusColor: meta.color,
      lastroFmt: d.lastro + '%',
      lastroColor: d.lastro === 100 ? COLORS.GREEN : d.lastro >= 60 ? COLORS.AMBER : COLORS.RED,
      canDisparar,
    };
  });
}

export function getHistorico() {
  return HISTORICO_RAW.map((h) => ({ ...h, investidoFmt: fmtBRL(h.investido), retornoFmt: '+' + fmtBRL(h.retorno), status: 'Concluída' }));
}

export function getRiskSuggestions(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return Object.keys(SACADOS).filter((n) => n.toLowerCase().includes(q)).slice(0, 5);
}

export function getSelectedSacado() {
  const name = state.selectedSacadoName;
  if (!name || !SACADOS[name]) return null;
  const s = SACADOS[name];
  const sc = scoreColorFor(s.score);
  const rc = ratingColors(s.rating);
  const stage = s.score >= 75 ? 1 : s.score >= 55 ? 2 : 3;
  const stageMeta = {
    1: { label: 'Estágio 1', bg: '#EAF3EE', color: COLORS.GREEN, desc: 'Risco normal — provisão cobre apenas os próximos 12 meses.' },
    2: { label: 'Estágio 2', bg: '#FBF1E0', color: COLORS.AMBER, desc: 'Aumento relevante de risco — provisão pela vida útil do contrato (Lifetime ECL).' },
    3: { label: 'Estágio 3', bg: '#F7E9E7', color: COLORS.RED, desc: 'Inadimplência efetiva — exige provisão integral do valor exposto.' },
  }[stage];
  const AI_SIGNALS: Record<number, { text: string; color: string }[]> = {
    1: [
      { text: 'Notícias públicas: nenhuma menção negativa nos últimos 90 dias', color: COLORS.GREEN },
      { text: 'Tendência de pagamento: estável, sem aceleração de atrasos', color: COLORS.GREEN },
      { text: 'Exposição setorial: dentro da média do setor', color: COLORS.GREEN },
    ],
    2: [
      { text: 'Notícias públicas: menção a reestruturação de fornecedores', color: COLORS.AMBER },
      { text: 'Tendência de pagamento: leve aumento no prazo médio de quitação', color: COLORS.AMBER },
      { text: 'Exposição setorial: acima da média, setor sob pressão de custos', color: COLORS.AMBER },
    ],
    3: [
      { text: 'Notícias públicas: menção a disputa judicial em andamento', color: COLORS.RED },
      { text: 'Tendência de pagamento: aceleração de atrasos nos últimos 60 dias', color: COLORS.RED },
      { text: 'Exposição setorial: concentração de risco acima do limite recomendado', color: COLORS.RED },
    ],
  };
  return {
    name,
    score: s.score,
    rating: s.rating,
    factors: s.factors,
    scoreColor: sc,
    ratingBg: rc.bg,
    ratingColor: rc.color,
    gaugeScore: s.score,
    stageLabel: stageMeta.label,
    stageBg: stageMeta.bg,
    stageColor: stageMeta.color,
    stageDesc: stageMeta.desc,
    aiSignals: AI_SIGNALS[stage],
    trendIcon: s.trend === 'up' ? '▲' : s.trend === 'down' ? '▼' : '—',
    trendColor: s.trend === 'up' ? COLORS.GREEN : s.trend === 'down' ? COLORS.RED : '#5B6472',
    trendDelta: s.trendDelta,
    pd12m: s.pd12m,
    hasAlerta: !!s.alerta,
    alerta: s.alerta,
  };
}

export function getAceites() {
  return ACEITES_RAW.map((a) => {
    const status = state.aceites[a.id] || 'aguardando';
    const meta = ACEITE_STATUS_META[status];
    return {
      ...a,
      valorFmt: fmtBRL(a.valor),
      statusLabel: meta.label,
      statusBg: meta.bg,
      statusColor: meta.color,
      isPending: status === 'aguardando',
      isProcessing: state.pendingAceiteId === a.id,
      status,
    };
  });
}

export function getDisputes() {
  return getAceites()
    .filter((a) => a.status === 'contestada')
    .map((a) => {
      const ev = state.disputeEvidence[a.id];
      return {
        ...a,
        motivo: DISPUTE_MOTIVOS[a.id] || 'Sacado contestou os dados da duplicata — divergência a esclarecer com o cedente.',
        timeline: DISPUTE_TIMELINES[a.id] || [{ autor: a.sacado, texto: 'Contestou a duplicata.', quando: 'há 2 dias' }],
        isSending: ev === 'enviando',
        isSent: ev === 'enviada',
        canSend: !ev,
      };
    });
}

export function getEmitSummary() {
  const emitValorNum = parseBRLNumber(state.emitForm.valor);
  const emitPremio = state.emitForm.seguro ? emitValorNum * 0.006 : 0;
  const matchedSacado = SACADOS[state.emitForm.sacado];
  const emitRateBand = matchedSacado ? ({ AA: [1.2, 1.6], A: [1.5, 2.0], B: [2.2, 2.9], C: [3.2, 4.2] } as Record<string, number[]>)[matchedSacado.rating] || [1.5, 2.0] : [1.5, 2.0];
  const emitTaxaMid = (emitRateBand[0] + emitRateBand[1]) / 2;
  const batchTotal = state.batchRows.reduce((sum, r) => sum + parseBRLNumber(r.valor), 0);
  const emitTotalValor = emitValorNum + batchTotal;
  const platformFeePct = emitTotalValor > 1000000 ? 0.0025 : emitTotalValor > 200000 ? 0.003 : 0.0035;
  return {
    valorFmt: emitValorNum ? fmtBRL(emitValorNum) : '—',
    premioFmt: emitPremio ? fmtBRL(emitPremio) : state.emitForm.seguro ? 'R$ 0' : 'Não contratado',
    taxaEstimadaFmt: emitTaxaMid.toFixed(1).replace('.', ',') + '% a.m.',
    plataformaFeeFmt: emitTotalValor ? fmtBRL(emitTotalValor * platformFeePct) : '—',
    matchedSacado,
    emitTotalValor,
  };
}

export function getLastroChecklist() {
  const items = [
    { label: 'Dados do sacado e CNPJ', done: !!(state.emitForm.sacado && state.emitForm.cnpj) },
    { label: 'Valor e vencimento definidos', done: !!(state.emitForm.valor && state.emitForm.vencimento) },
    { label: 'NF-e anexada e vinculada', done: state.nfAnexada },
    { label: 'Comprovante de entrega ou aceite do serviço', done: state.nfAnexada },
    { label: 'Histórico de pagamento do sacado consultado', done: !!state.emitForm.sacado },
  ];
  const doneCount = items.filter((i) => i.done).length;
  const pct = Math.round((doneCount / items.length) * 100);
  const color = pct === 100 ? COLORS.GREEN : pct >= 40 ? COLORS.AMBER : COLORS.RED;
  return {
    items: items.map((i) => ({ label: i.label, done: i.done, color: i.done ? COLORS.GREEN : '#D6DCE5', textColor: i.done ? COLORS.NAVY : '#9AA5B5' })),
    pct,
    color,
    doneCount,
  };
}

export function getPreApprovedLimit() {
  const { doneCount } = getLastroChecklist();
  const matchedSacado = SACADOS[state.emitForm.sacado];
  return 40000 + doneCount * 25000 + (matchedSacado ? matchedSacado.score * 1500 : 0);
}

export function getSimulatedEstimate() {
  const valorNum = parseBRLNumber(state.comparadorInput.valor);
  const prazoNum = parseInt(state.comparadorInput.prazo, 10) || 30;
  const RATE_BANDS: Record<string, number[]> = { AA: [1.2, 1.6], A: [1.5, 2.0], B: [2.2, 2.9], C: [3.2, 4.2] };
  const band = RATE_BANDS[state.comparadorInput.score] || RATE_BANDS.A;
  const prazoFactor = prazoNum / 30;
  const lowRate = band[0] * prazoFactor;
  const highRate = band[1] * prazoFactor;
  const midRate = (lowRate + highRate) / 2;
  const desagioEstimado = valorNum * (midRate / 100);
  return {
    rangeLabel: lowRate.toFixed(1).replace('.', ',') + '% – ' + highRate.toFixed(1).replace('.', ',') + '% no período',
    desagioFmt: valorNum ? fmtBRL(desagioEstimado) : '—',
    liquidoFmt: valorNum ? fmtBRL(valorNum - desagioEstimado) : '—',
  };
}

export function getRevenueStreams() {
  const total = REVENUE_RAW.reduce((sum, r) => sum + r.valor, 0);
  let acc = 0;
  const streams = REVENUE_RAW.map((r, i) => {
    const pct = (r.valor / total) * 100;
    const item = {
      ...r,
      valorFmt: 'R$ ' + r.valor.toFixed(1) + 'k/mês',
      pctFmt: pct.toFixed(1) + '%',
      color: REV_COLORS[i % REV_COLORS.length],
      gradFrom: acc,
      gradTo: acc + pct,
    };
    acc += pct;
    return item;
  });
  return { streams, totalFmt: 'R$ ' + total.toFixed(1) + 'k/mês' };
}
