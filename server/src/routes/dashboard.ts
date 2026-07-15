import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { db } from '../db/index.js';
import { COLORS, KPIS_RAW, MONTHS_RAW, RATING_LEGEND } from '../data/seed.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get('/', (_req, res) => {
  const activeDuplicatas = (db.prepare("SELECT COUNT(*) as n FROM duplicatas WHERE status IN ('no_mercado','aprovada')").get() as { n: number }).n;

  const kpis = KPIS_RAW.map((k, i) => ({
    ...k,
    cardBg: i === 0 ? COLORS.NAVY : '#fff',
    labelColor: i === 0 ? '#9FB3D6' : '#5B6472',
    valueColor: i === 0 ? '#fff' : COLORS.NAVY,
    valueSize: i === 0 ? 30 : 26,
  }));

  const maxV = Math.max(...MONTHS_RAW.map((m) => m.v));
  const monthlyBars = MONTHS_RAW.map((m) => ({
    label: m.label,
    valueLabel: m.v.toFixed(1) + 'M',
    heightPct: Math.round((m.v / maxV) * 100),
    color: m.label === 'Jul' ? COLORS.BLUE : '#C7D6FF',
  }));

  res.json({
    kpis,
    monthlyBars,
    ratingLegend: RATING_LEGEND,
    riskDonutStops: [
      { color: COLORS.GREEN, from: 0, to: 58 },
      { color: COLORS.AMBER, from: 58, to: 85 },
      { color: COLORS.RED, from: 85, to: 96 },
      { color: '#E4E8EE', from: 96, to: 100 },
    ],
    activeDuplicatas,
  });
});
