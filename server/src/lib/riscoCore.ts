import { COLORS, SACADOS, type Sacado } from '../data/seed.js';
import { ratingColors, scoreColorFor } from './format.js';

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

// Shared by the internal /api/risco/:name route (used by the SPA) and the public
// /api/v1 partner score endpoint — same scoring model either way.
export function buildRiscoView(name: string, s: Sacado) {
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
  };
}

export function findSacadoByName(name: string): { name: string; sacado: Sacado } | null {
  const s = SACADOS[name];
  return s ? { name, sacado: s } : null;
}

function normalizeCnpj(value: string): string {
  return value.replace(/\D/g, '');
}

export function findSacadoByCnpj(cnpj: string): { name: string; sacado: Sacado } | null {
  const target = normalizeCnpj(cnpj);
  if (!target) return null;
  const entry = Object.entries(SACADOS).find(([, s]) => normalizeCnpj(s.cnpj) === target);
  return entry ? { name: entry[0], sacado: entry[1] } : null;
}
