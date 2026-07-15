import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { COLORS, SACADOS } from '../data/seed.js';
import { ratingColors, scoreColorFor } from '../lib/format.js';

export const riscoRouter = Router();
riscoRouter.use(requireAuth);

riscoRouter.get('/search', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  if (!q) {
    res.json({ suggestions: [] });
    return;
  }
  const suggestions = Object.keys(SACADOS).filter((n) => n.toLowerCase().includes(q)).slice(0, 5);
  res.json({ suggestions });
});

riscoRouter.get('/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const s = SACADOS[name];
  if (!s) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
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
  res.json({
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
  });
});
