import { db } from '../db/index.js';
import type { Rating } from '../data/seed.js';

// Real supply/demand pricing instead of a fixed rate band. Before this, every real
// duplicata that reached the marketplace showed the exact same flat 2,5% deságio
// (marketCompute.ts's fallback when `desagio` — never actually populated at emission —
// is null) regardless of rating or how tight capital actually is right now. This computes
// a real multiplier from the last 30 real days of the platform's own book and purchase
// activity, and both the pre-emission preview (lib/emitirCore.ts) and the live
// marketplace base rate (lib/marketCompute.ts) apply it — a genuinely "auction" market
// instead of a static number with a leilão UI on top of it.

export const BASE_RATE_BANDS: Record<Rating, [number, number]> = {
  AA: [1.2, 1.6],
  A: [1.5, 2.0],
  B: [2.2, 2.9],
  C: [3.2, 4.2],
};

export interface LiquiditySignal {
  // >1 = more capital chasing offers than new supply entering the book (tight market,
  // rates compress in the cedente's favor); <1 = supply outpacing demand (rates widen to
  // attract capital). A 0 denominator (no new supply in the window) reports neutral (1.0)
  // rather than an undefined/infinite ratio.
  multiplier: number;
  supply30dBRL: number;
  demand30dBRL: number;
  ratio: number;
}

const MIN_MULTIPLIER = 0.85;
const MAX_MULTIPLIER = 1.25;

export function computeLiquiditySignal(): LiquiditySignal {
  const supply = db
    .prepare(`SELECT COALESCE(SUM(valor), 0) as v FROM duplicatas WHERE sandbox = 0 AND created_at >= datetime('now', '-30 days')`)
    .get() as { v: number };
  const demand = db.prepare(`SELECT COALESCE(SUM(valor), 0) as v FROM purchases WHERE created_at >= datetime('now', '-30 days')`).get() as { v: number };

  const supply30dBRL = supply.v;
  const demand30dBRL = demand.v;
  if (supply30dBRL <= 0) return { multiplier: 1, supply30dBRL, demand30dBRL, ratio: demand30dBRL > 0 ? Infinity : 1 };

  const ratio = demand30dBRL / supply30dBRL;
  // sqrt-dampened so a single large purchase/emission doesn't swing rates wildly —
  // clamped to a ±15-25% band around the base rate either direction.
  const raw = 1 / Math.sqrt(Math.max(ratio, 0.1));
  const multiplier = Math.max(MIN_MULTIPLIER, Math.min(MAX_MULTIPLIER, raw));
  return { multiplier, supply30dBRL, demand30dBRL, ratio };
}

export function estimateRateBand(rating: Rating): { min: number; max: number; mid: number; signal: LiquiditySignal } {
  const [bandMin, bandMax] = BASE_RATE_BANDS[rating] ?? BASE_RATE_BANDS.A;
  const signal = computeLiquiditySignal();
  const min = bandMin * signal.multiplier;
  const max = bandMax * signal.multiplier;
  return { min, max, mid: (min + max) / 2, signal };
}
