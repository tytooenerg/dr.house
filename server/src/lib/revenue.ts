import { REVENUE_RAW, REV_COLORS } from '../data/seed.js';
import { db } from '../db/index.js';
import { platformFee, platformFeePct } from './settlement.js';
import { fmtBRL } from './format.js';

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
  return {
    streams,
    totalFmt: 'R$ ' + total.toFixed(1) + 'k/mês',
    realFees: getRealPlatformFees(),
  };
}

// Unlike the illustrative streams above (a static projected mix for the product's
// "how we make money" explainer), this is computed live from every settled purchase —
// the same tiered fee schedule shown in the Emitir preview and actually deducted in the
// ledger at liquidação (lib/settlement.ts).
function getRealPlatformFees() {
  const purchases = db.prepare('SELECT valor FROM purchases').all() as { valor: number }[];
  const totalFees = purchases.reduce((sum, p) => sum + platformFee(p.valor), 0);
  const totalVolume = purchases.reduce((sum, p) => sum + p.valor, 0);
  return {
    totalColetadoFmt: fmtBRL(totalFees),
    totalLiquidacoes: purchases.length,
    faixasFmt: [
      { ateFmt: 'até R$ 200 mil', pctFmt: (platformFeePct(1) * 100).toFixed(2).replace('.', ',') + '%' },
      { ateFmt: 'R$ 200 mil – R$ 1 milhão', pctFmt: (platformFeePct(300_000) * 100).toFixed(2).replace('.', ',') + '%' },
      { ateFmt: 'acima de R$ 1 milhão', pctFmt: (platformFeePct(1_500_000) * 100).toFixed(2).replace('.', ',') + '%' },
    ],
    mediaEfetivaPct: totalVolume > 0 ? +((totalFees / totalVolume) * 100).toFixed(3) : null,
  };
}
