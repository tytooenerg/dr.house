import { REVENUE_RAW, REV_COLORS } from '../data/seed.js';
import { platformFeePct, INSURANCE_COMMISSION_PCT } from './settlement.js';
import { sumInsuranceCommission } from '../db/insuranceSettlements.js';
import { sumLegalCollectionFees } from '../db/legalCollectionFees.js';
import { sumPlatformFeeEvents } from '../db/platformFeeEvents.js';
import { getSuccessFeePct } from './legalCollectionFee.js';
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
    realInsuranceCommission: getRealInsuranceCommission(),
    realLegalCollectionFees: getRealLegalCollectionFees(),
  };
}

// Unlike the illustrative streams above (a static projected mix for the product's
// "how we make money" explainer), this is computed from platform_fee_events — an exact
// log of every real fee actually deducted at liquidação (lib/settlement.ts's
// settlePurchase/settleResale), same pattern as getRealInsuranceCommission/
// getRealLegalCollectionFees below. Used to be recomputed live as platformFee(p.valor)
// over every row of `purchases`, which had no way to know a given resale's fee had
// already been discounted for an institutional block trade (lib/blockTrade.ts's
// feeDiscountPct) — that always overstated totalColetadoFmt/mediaEfetivaPct whenever a
// block trade happened, since it recomputed the full undiscounted fee instead of using
// what was actually collected.
function getRealPlatformFees() {
  const { totalFees, totalVolume, totalEventos } = sumPlatformFeeEvents();
  return {
    totalColetadoFmt: fmtBRL(totalFees),
    totalLiquidacoes: totalEventos,
    faixasFmt: [
      { ateFmt: 'até R$ 200 mil', pctFmt: (platformFeePct(1) * 100).toFixed(2).replace('.', ',') + '%' },
      { ateFmt: 'R$ 200 mil – R$ 1 milhão', pctFmt: (platformFeePct(300_000) * 100).toFixed(2).replace('.', ',') + '%' },
      { ateFmt: 'acima de R$ 1 milhão', pctFmt: (platformFeePct(1_500_000) * 100).toFixed(2).replace('.', ',') + '%' },
    ],
    mediaEfetivaPct: totalVolume > 0 ? +((totalFees / totalVolume) * 100).toFixed(3) : null,
  };
}

// A real distribution commission on the insurance premium — computed from
// insurance_settlements, an exact log of every real POST /api/market/:id/insure that
// actually moved money (see lib/settlement.ts), not recomputed from mutable current state.
function getRealInsuranceCommission() {
  const { totalPremios, totalComissao, totalApolices } = sumInsuranceCommission();
  return {
    totalComissaoFmt: fmtBRL(totalComissao),
    totalPremiosFmt: fmtBRL(totalPremios),
    totalApolices,
    comissaoPctFmt: Math.round(INSURANCE_COMMISSION_PCT * 100) + '%',
  };
}

// A real success fee charged only when a duplicata escalated to cobrança jurídica
// (lib/legalCollection.ts) is actually marked recovered by an admin — see
// lib/legalCollectionFee.ts. Computed from legal_collection_fees, an exact log of every
// real charge, not recomputed from mutable current state.
function getRealLegalCollectionFees() {
  const { totalFeeValor, totalRecoveredValor, count } = sumLegalCollectionFees();
  return {
    totalFeeFmt: fmtBRL(totalFeeValor),
    totalRecoveredFmt: fmtBRL(totalRecoveredValor),
    totalCasos: count,
    feePctFmt: getSuccessFeePct() + '%',
  };
}
