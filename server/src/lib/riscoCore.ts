import { COLORS, SACADOS, type Rating, type Sacado, type SacadoFactor } from '../data/seed.js';
import { normalizeCnpj, ratingColors, scoreColorFor } from './format.js';
import { summarizeSignals, type SignalSummary } from '../db/networkSignals.js';

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

const PD12M_BY_RATING: Record<Rating, string> = { AA: '0,8%', A: '1,4%', B: '4,1%', C: '9,7%' };

export function ratingFromScore(score: number): Rating {
  if (score >= 80) return 'AA';
  if (score >= 65) return 'A';
  if (score >= 45) return 'B';
  return 'C';
}

export interface SinaisDeRedeView {
  total: number;
  pontual: number;
  atraso: number;
  protesto: number;
  contestacao: number;
  confianca: 'baixa' | 'média' | 'alta';
  scoreDeRede: number;
}

export interface RiscoView {
  name: string;
  cnpj: string;
  score: number;
  rating: Rating;
  factors: SacadoFactor[];
  scoreColor: string;
  ratingBg: string;
  ratingColor: string;
  gaugeScore: number;
  stageLabel: string;
  stageBg: string;
  stageColor: string;
  stageDesc: string;
  aiSignals: { text: string; color: string }[];
  trendIcon: string;
  trendColor: string;
  trendDelta: string;
  pd12m: string;
  hasAlerta: boolean;
  alerta: string | null;
  fonte: 'interno' | 'rede' | 'combinado';
  sinaisDeRede: SinaisDeRedeView | null;
}

// Shared by the internal /api/risco/:name route (used by the SPA) and the public
// /api/v1 partner score endpoint — same scoring model either way.
export function buildRiscoView(name: string, s: Sacado): RiscoView {
  const sc = scoreColorFor(s.score);
  const rc = ratingColors(s.rating);
  const stage = s.score >= 75 ? 1 : s.score >= 55 ? 2 : 3;
  const stageMeta = {
    1: { label: 'Estágio 1', bg: '#EAF3EE', color: COLORS.GREEN, desc: 'Risco normal — provisão cobre apenas os próximos 12 meses.' },
    2: { label: 'Estágio 2', bg: '#FBF1E0', color: COLORS.AMBER, desc: 'Aumento relevante de risco — provisão pela vida útil do contrato (Lifetime ECL).' },
    3: { label: 'Estágio 3', bg: '#F7E9E7', color: COLORS.RED, desc: 'Inadimplência efetiva — exige provisão integral do valor exposto.' },
  }[stage];

  return {
    name,
    cnpj: s.cnpj,
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
    fonte: 'interno',
    sinaisDeRede: null,
  };
}

export function findSacadoByName(name: string): { name: string; sacado: Sacado } | null {
  const s = SACADOS[name];
  return s ? { name, sacado: s } : null;
}

export function findSacadoByCnpj(cnpj: string): { name: string; sacado: Sacado } | null {
  const target = normalizeCnpj(cnpj);
  if (!target) return null;
  const entry = Object.entries(SACADOS).find(([, s]) => normalizeCnpj(s.cnpj) === target);
  return entry ? { name: entry[0], sacado: entry[1] } : null;
}

function confidenceFor(total: number): 'baixa' | 'média' | 'alta' {
  if (total < 3) return 'baixa';
  if (total < 10) return 'média';
  return 'alta';
}

const CONFIDENCE_WEIGHT: Record<'baixa' | 'média' | 'alta', number> = { baixa: 0.1, média: 0.2, alta: 0.35 };

// The score a CNPJ would get purely from what partners (via the public API) and Lastro's
// own real aceite outcomes have reported about it — independent of whether it has ever
// been SACADOS-matched internally. This is what lets a CNPJ that never transacted
// directly on Lastro still get a real, if low-confidence, score.
function networkView(summary: SignalSummary): SinaisDeRedeView | null {
  if (summary.total === 0) return null;
  const raw = 70 - summary.protesto * 15 - summary.atraso * 5 - summary.contestacao * 8 + summary.pontual * 3;
  const scoreDeRede = Math.max(5, Math.min(98, Math.round(raw)));
  return {
    total: summary.total,
    pontual: summary.pontual,
    atraso: summary.atraso,
    protesto: summary.protesto,
    contestacao: summary.contestacao,
    confianca: confidenceFor(summary.total),
    scoreDeRede,
  };
}

// The real "fragmentation fix" entry point: blends Lastro's own SACADOS profile (if the
// CNPJ matches one) with cross-platform network signals reported by API partners. A CNPJ
// with only network signals (never transacted on Lastro) still gets a real score; a CNPJ
// with both gets the internal score nudged by the network's confidence-weighted evidence.
export function buildBlendedRiscoView(cnpj: string): RiscoView | null {
  const internal = findSacadoByCnpj(cnpj);
  const rede = networkView(summarizeSignals(cnpj));

  if (!internal && !rede) return null;

  if (internal && !rede) {
    return buildRiscoView(internal.name, internal.sacado);
  }

  if (!internal && rede) {
    const rating = ratingFromScore(rede.scoreDeRede);
    const alerta =
      rede.protesto > 0
        ? `${rede.protesto} protesto(s) reportado(s) por parceiros da rede.`
        : rede.contestacao > 0
          ? `${rede.contestacao} contestação(ões) reportada(s) por parceiros da rede.`
          : null;
    return {
      name: normalizeCnpj(cnpj),
      cnpj,
      score: rede.scoreDeRede,
      rating,
      factors: [
        { label: 'Sinais de rede — pagamentos pontuais', value: `${rede.pontual}`, barPct: '60%', barColor: COLORS.GREEN },
        { label: 'Sinais de rede — atrasos', value: `${rede.atraso}`, barPct: '40%', barColor: COLORS.AMBER },
        { label: 'Sinais de rede — protestos/contestações', value: `${rede.protesto + rede.contestacao}`, barPct: '20%', barColor: COLORS.RED },
      ],
      scoreColor: scoreColorFor(rede.scoreDeRede),
      ratingBg: ratingColors(rating).bg,
      ratingColor: ratingColors(rating).color,
      gaugeScore: rede.scoreDeRede,
      stageLabel: rede.scoreDeRede >= 75 ? 'Estágio 1' : rede.scoreDeRede >= 55 ? 'Estágio 2' : 'Estágio 3',
      stageBg: rede.scoreDeRede >= 75 ? '#EAF3EE' : rede.scoreDeRede >= 55 ? '#FBF1E0' : '#F7E9E7',
      stageColor: rede.scoreDeRede >= 75 ? COLORS.GREEN : rede.scoreDeRede >= 55 ? COLORS.AMBER : COLORS.RED,
      stageDesc: 'Score calculado exclusivamente a partir de sinais reportados por parceiros da rede — este CNPJ não tem histórico direto na Lastro.',
      aiSignals: [],
      trendIcon: '—',
      trendColor: '#5B6472',
      trendDelta: `confiança ${rede.confianca} (${rede.total} sinal(is))`,
      pd12m: PD12M_BY_RATING[rating],
      hasAlerta: !!alerta,
      alerta,
      fonte: 'rede',
      sinaisDeRede: rede,
    };
  }

  // both internal and network data exist — blend, weighted by network confidence.
  const base = buildRiscoView(internal!.name, internal!.sacado);
  const weight = CONFIDENCE_WEIGHT[rede!.confianca];
  const blendedScore = Math.round(base.score * (1 - weight) + rede!.scoreDeRede * weight);
  const rating = ratingFromScore(blendedScore);
  return {
    ...base,
    score: blendedScore,
    rating,
    scoreColor: scoreColorFor(blendedScore),
    ratingBg: ratingColors(rating).bg,
    ratingColor: ratingColors(rating).color,
    gaugeScore: blendedScore,
    pd12m: PD12M_BY_RATING[rating],
    factors: [
      ...base.factors,
      {
        label: 'Sinais de rede (parceiros)',
        value: `${rede!.total} sinal(is), confiança ${rede!.confianca}`,
        barPct: `${Math.round(weight * 100)}%`,
        barColor: rede!.protesto + rede!.contestacao > rede!.pontual ? COLORS.AMBER : COLORS.GREEN,
      },
    ],
    fonte: 'combinado',
    sinaisDeRede: rede,
  };
}
