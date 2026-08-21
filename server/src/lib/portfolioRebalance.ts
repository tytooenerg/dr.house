import { listPurchasesByInvestor } from '../db/duplicatas.js';
import { getSuitability } from '../db/suitability.js';
import { ratingFromScore } from './riscoCore.js';
import { fmtBRL } from './format.js';
import type { Rating } from '../data/seed.js';
import type { SuitabilityProfile } from './suitability.js';

// Suggested portfolio rebalancing — deterministic, explainable target-allocation bands
// per suitability profile (lib/suitability.ts), same "every number traces to a rule, no
// black box" discipline as the rest of this codebase. Never executes anything: every
// suggestion is a read-only recommendation an investor acts on manually (e.g. listing an
// overweight position on the mercado secundário) — same human-in-the-loop principle as
// every AI-adjacent feature here, even though this one needs no LLM at all.
const TARGET_ALLOCATION: Record<SuitabilityProfile, Record<Rating, number>> = {
  conservador: { AA: 70, A: 30, B: 0, C: 0 },
  moderado: { AA: 35, A: 40, B: 20, C: 5 },
  arrojado: { AA: 15, A: 30, B: 30, C: 25 },
};

// Used whenever the investor hasn't completed (or has let expire) a suitability
// assessment — a neutral, moderate default rather than refusing to suggest anything.
const DEFAULT_PROFILE: SuitabilityProfile = 'moderado';

const MAX_SACADO_CONCENTRATION_PCT: Record<SuitabilityProfile, number> = {
  conservador: 15,
  moderado: 25,
  arrojado: 35,
};

// Below this drift, a suggestion would just be noise on rounding — real portfolios rarely
// land exactly on a target band.
const DRIFT_THRESHOLD_PCT = 10;

export interface RatingComparison {
  rating: Rating;
  actualPct: number;
  targetPct: number;
  valorFmt: string;
}
export interface SacadoConcentration {
  sacado: string;
  valorFmt: string;
  pct: number;
  limitPct: number;
  overLimit: boolean;
}
export interface RebalanceSuggestion {
  type: 'reduzir_rating' | 'aumentar_rating' | 'reduzir_concentracao_sacado';
  message: string;
  valorFmt: string;
}
export interface RebalanceView {
  totalInvestidoFmt: string;
  posicoesAtivas: number;
  profile: SuitabilityProfile;
  usingDefaultProfile: boolean;
  ratingComparison: RatingComparison[];
  sacadoConcentration: SacadoConcentration[];
  suggestions: RebalanceSuggestion[];
}

export function buildRebalanceView(userId: number): RebalanceView {
  const purchases = listPurchasesByInvestor(userId).filter((p) => p.active);
  const totalInvestido = purchases.reduce((sum, p) => sum + p.valor, 0);

  const suitability = getSuitability(userId);
  const suitabilityValid = !!suitability && new Date(suitability.expires_at).getTime() > Date.now();
  const profile: SuitabilityProfile = suitabilityValid ? suitability!.profile : DEFAULT_PROFILE;
  const targets = TARGET_ALLOCATION[profile];
  const maxConcentration = MAX_SACADO_CONCENTRATION_PCT[profile];

  const ratingTotals: Record<Rating, number> = { AA: 0, A: 0, B: 0, C: 0 };
  const sacadoTotals = new Map<string, number>();
  for (const p of purchases) {
    const rating = ratingFromScore(p.score ?? 50);
    ratingTotals[rating] += p.valor;
    sacadoTotals.set(p.sacado_nome, (sacadoTotals.get(p.sacado_nome) ?? 0) + p.valor);
  }

  const ratingComparison: RatingComparison[] = (Object.keys(ratingTotals) as Rating[]).map((rating) => ({
    rating,
    actualPct: totalInvestido > 0 ? Math.round((ratingTotals[rating] / totalInvestido) * 100) : 0,
    targetPct: targets[rating],
    valorFmt: fmtBRL(ratingTotals[rating]),
  }));

  const sacadoConcentration: SacadoConcentration[] = [...sacadoTotals.entries()]
    .map(([sacado, valor]) => {
      const pct = totalInvestido > 0 ? Math.round((valor / totalInvestido) * 100) : 0;
      return { sacado, valorFmt: fmtBRL(valor), pct, limitPct: maxConcentration, overLimit: pct > maxConcentration };
    })
    .sort((a, b) => b.pct - a.pct);

  const suggestions: RebalanceSuggestion[] = [];
  if (totalInvestido > 0) {
    for (const c of ratingComparison) {
      const diff = c.actualPct - c.targetPct;
      if (diff > DRIFT_THRESHOLD_PCT) {
        const valor = Math.round((diff / 100) * totalInvestido);
        suggestions.push({
          type: 'reduzir_rating',
          message: `Sua exposição a rating ${c.rating} está em ${c.actualPct}%, acima da faixa alvo do seu perfil (${c.targetPct}%). Considere reduzir cerca de ${fmtBRL(valor)} desta faixa, listando posições no mercado secundário.`,
          valorFmt: fmtBRL(valor),
        });
      } else if (diff < -DRIFT_THRESHOLD_PCT) {
        const valor = Math.round((-diff / 100) * totalInvestido);
        suggestions.push({
          type: 'aumentar_rating',
          message: `Sua exposição a rating ${c.rating} está em ${c.actualPct}%, abaixo da faixa alvo do seu perfil (${c.targetPct}%). Há espaço para alocar mais cerca de ${fmtBRL(valor)} nesta faixa.`,
          valorFmt: fmtBRL(valor),
        });
      }
    }
    for (const s of sacadoConcentration) {
      if (!s.overLimit) continue;
      const excessPct = s.pct - s.limitPct;
      const excessValor = Math.round((excessPct / 100) * totalInvestido);
      suggestions.push({
        type: 'reduzir_concentracao_sacado',
        message: `${s.pct}% da sua carteira está concentrada em "${s.sacado}", acima do limite recomendado de ${s.limitPct}% para seu perfil. Considere reduzir cerca de ${fmtBRL(excessValor)} desta exposição.`,
        valorFmt: fmtBRL(excessValor),
      });
    }
  }

  return {
    totalInvestidoFmt: fmtBRL(totalInvestido),
    posicoesAtivas: purchases.length,
    profile,
    usingDefaultProfile: !suitabilityValid,
    ratingComparison,
    sacadoConcentration,
    suggestions,
  };
}
