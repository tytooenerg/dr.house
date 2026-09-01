import { predictDefaultProbability } from './mlScoring.js';
import { ratingFromScore } from './riscoCore.js';
import type { DuplicataRow } from '../db/types.js';
import type { Rating } from '../data/seed.js';

// Single source of truth for "what's the probability this duplicata's sacado defaults" —
// used by lib/agents/underwriting.ts's ML tool (which, before this existed, just reported
// "unavailable" whenever the model wasn't trained yet, instead of falling back to a
// documented assumed prior).
//
// Honesty about what's assumed vs measured, unchanged from before: this platform is too
// young to have enough real labeled defaults to fit a reliable per-position probability
// from data alone (same MIN_TRAINING_SAMPLES constraint lib/mlScoring.ts already applies).
// Where a trained ML model exists, its real predictDefaultProbability is used; where it
// doesn't (the common case today), a documented assumed prior calibrated to typical NPL
// ranges for Brazilian short-term trade receivables stands in — labeled 'assumed'
// everywhere it surfaces, never presented as measured history.
export const ASSUMED_PD_BY_RATING: Record<Rating, number> = { AA: 0.005, A: 0.015, B: 0.04, C: 0.09 };

export interface DefaultProbabilityEstimate {
  pd: number;
  source: 'ml' | 'assumed';
  rating: Rating;
}

export function estimateDefaultProbability(d: DuplicataRow): DefaultProbabilityEstimate {
  const ml = predictDefaultProbability(d);
  const rating = ratingFromScore(d.score ?? 60);
  return ml != null ? { pd: ml, source: 'ml', rating } : { pd: ASSUMED_PD_BY_RATING[rating], source: 'assumed', rating };
}
