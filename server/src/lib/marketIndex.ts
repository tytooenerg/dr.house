// Feature "Lastro Index" — an aggregated market-benchmark data product, sold to
// institutional investors/seguradoras/credit bureaus who want deságio and inadimplência
// benchmarks without needing their own transaction volume to compute them from. Unlike
// every other new standalone API this batch adds, this one wraps no external, real-when-
// configured integration — it's Lastro's own real (non-sandbox) transaction data,
// aggregated fresh on every call, same honesty discipline as lib/publicStatsCore.ts (the
// free/public transparency page): no fabricated benchmark numbers, real ones that start
// small and grow with real usage.
import { listAllDuplicatasForTraining } from '../db/duplicatas.js';
import { ratingFromScore } from './riscoCore.js';
import type { Rating } from '../data/seed.js';

export interface MarketIndexRatingBucket {
  rating: Rating;
  count: number;
  avgDesagioPct: number | null;
  taxaInadimplenciaPct: number | null;
}

export interface MarketIndexView {
  geradoEm: string;
  totalDuplicatas: number;
  avgDesagioGeralPct: number | null;
  taxaInadimplenciaGeralPct: number | null;
  porRating: MarketIndexRatingBucket[];
}

function parseDesagioPct(desagio: string | null): number | null {
  if (!desagio) return null;
  const n = parseFloat(desagio.replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return +(values.reduce((s, v) => s + v, 0) / values.length).toFixed(2);
}

export function buildMarketIndex(): MarketIndexView {
  const rows = listAllDuplicatasForTraining();
  const now = new Date();

  const desagios = rows.map((d) => parseDesagioPct(d.desagio)).filter((v): v is number => v !== null);

  const vencidas = rows.filter((d) => new Date(d.vencimento) < now);
  const inadimplentes = vencidas.filter((d) => d.status !== 'vendida');
  const taxaInadimplenciaGeralPct = vencidas.length > 0 ? +((inadimplentes.length / vencidas.length) * 100).toFixed(1) : null;

  const byRating = new Map<Rating, typeof rows>();
  for (const d of rows) {
    const rating = ratingFromScore(d.score ?? 60);
    const arr = byRating.get(rating) ?? [];
    arr.push(d);
    byRating.set(rating, arr);
  }

  const porRating: MarketIndexRatingBucket[] = (['AA', 'A', 'B', 'C'] as Rating[]).map((rating) => {
    const bucketRows = byRating.get(rating) ?? [];
    const bucketDesagios = bucketRows.map((d) => parseDesagioPct(d.desagio)).filter((v): v is number => v !== null);
    const bucketVencidas = bucketRows.filter((d) => new Date(d.vencimento) < now);
    const bucketInadimplentes = bucketVencidas.filter((d) => d.status !== 'vendida');
    return {
      rating,
      count: bucketRows.length,
      avgDesagioPct: average(bucketDesagios),
      taxaInadimplenciaPct: bucketVencidas.length > 0 ? +((bucketInadimplentes.length / bucketVencidas.length) * 100).toFixed(1) : null,
    };
  });

  return {
    geradoEm: now.toISOString(),
    totalDuplicatas: rows.length,
    avgDesagioGeralPct: average(desagios),
    taxaInadimplenciaGeralPct,
    porRating,
  };
}
