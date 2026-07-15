import { REVENUE_RAW, REV_COLORS } from '../data/seed.js';

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
