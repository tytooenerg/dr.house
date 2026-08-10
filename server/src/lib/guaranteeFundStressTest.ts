import { listActiveUninsuredPurchases } from '../db/duplicatas.js';
import { getFundBalance } from '../db/guaranteeFund.js';
import { estimateDefaultProbability } from './defaultProbability.js';
import { fmtBRL } from './format.js';
import { FUND_COVERAGE_PCT } from './guaranteeFund.js';
import type { Rating } from '../data/seed.js';

// Monte Carlo stress test for the guarantee fund — answers "what's the real probability
// the fund's current balance isn't enough to cover a bad quarter of defaults across today's
// actual uninsured book", not a static "coverage % vs balance" number. Simulates the whole
// current real exposure (lib/guaranteeFund.ts's fund only ever covers active uninsured
// positions — an insured one has its own seguradora claims path) thousands of times.
// Per-position default probability comes from lib/defaultProbability.ts — real ML when a
// model is trained, a documented assumed prior by rating otherwise (see that module for the
// honesty discipline; also used by lib/agents/underwriting.ts's ML tool).

// Real defaults cluster (shared macro conditions, sector concentration) — treating every
// position as an independent coin flip understates tail risk, a well-known modeling error.
// This uses a single-factor Gaussian copula (the same structural idea behind the Vasicek
// model underlying Basel's IRB capital formula, simplified): one shared macro shock plus an
// idiosyncratic shock per position, blended by a correlation assumption.
const DEFAULT_CORRELATION = 0.15;
const DEFAULT_SIMULATIONS = 10_000;

// Deterministic, seedable PRNG (mulberry32) — real Math.random() by default, but a fixed
// seed makes the simulation reproducible for tests instead of asserting on a moving target.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function standardNormal(rand: () => number): number {
  // Box-Muller transform from two real uniforms to one standard normal draw.
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Acklam's rational approximation of the inverse standard normal CDF (probit) — accurate to
// ~1e-9, no external stats library required.
function probit(p: number): number {
  const clamped = Math.min(Math.max(p, 1e-10), 1 - 1e-10);
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.75440866190742];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number;
  if (clamped < pLow) {
    q = Math.sqrt(-2 * Math.log(clamped));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (clamped <= pHigh) {
    q = clamped - 0.5;
    r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - clamped));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

interface ExposureItem {
  duplicataId: string;
  valor: number;
  pd: number;
  pdSource: 'ml' | 'assumed';
  rating: Rating;
}

export function buildExposure(): ExposureItem[] {
  return listActiveUninsuredPurchases().map((p) => {
    const { pd, source, rating } = estimateDefaultProbability(p.duplicata);
    return {
      duplicataId: p.duplicata_id,
      valor: p.valor,
      pd,
      pdSource: source,
      rating,
    };
  });
}

export interface StressTestOptions {
  simulations?: number;
  correlation?: number;
  seed?: number;
}

export interface StressTestResult {
  simulations: number;
  correlation: number;
  fundBalance: number;
  fundBalanceFmt: string;
  exposureCount: number;
  exposureTotal: number;
  exposureTotalFmt: string;
  usingMlModel: boolean;
  pDepletion: number; // fraction of simulated scenarios where covered losses exceed the real fund balance
  expectedLoss: number; // mean covered loss across all simulations
  expectedLossFmt: string;
  var95: number; // 95th-percentile covered loss (Value at Risk)
  var95Fmt: string;
  var99: number;
  var99Fmt: string;
  expectedShortfall: number; // average loss *beyond* the fund balance, across only the depleting scenarios (0 if none)
  expectedShortfallFmt: string;
}

const MAX_SIMULATIONS = 50_000;
const MIN_SIMULATIONS = 100;

export function runStressTest(options: StressTestOptions = {}): StressTestResult {
  const simulations = Math.min(MAX_SIMULATIONS, Math.max(MIN_SIMULATIONS, Math.round(options.simulations ?? DEFAULT_SIMULATIONS)));
  const correlation = Math.min(0.9, Math.max(0, options.correlation ?? DEFAULT_CORRELATION));
  const rand = options.seed != null ? mulberry32(options.seed) : Math.random;

  const exposure = buildExposure();
  const fundBalance = getFundBalance();
  const exposureTotal = exposure.reduce((s, e) => s + e.valor, 0);
  const sqrtRho = Math.sqrt(correlation);
  const sqrtOneMinusRho = Math.sqrt(1 - correlation);
  const thresholds = exposure.map((e) => probit(e.pd)); // per-position default threshold on the latent normal scale

  const losses: number[] = new Array(simulations);
  for (let s = 0; s < simulations; s++) {
    const macro = standardNormal(rand);
    let loss = 0;
    for (let i = 0; i < exposure.length; i++) {
      const latent = sqrtRho * macro + sqrtOneMinusRho * standardNormal(rand);
      if (latent < thresholds[i]) loss += exposure[i].valor * FUND_COVERAGE_PCT;
    }
    losses[s] = loss;
  }
  losses.sort((a, b) => a - b);

  const depletions = losses.filter((l) => l > fundBalance);
  const pDepletion = depletions.length / simulations;
  const expectedLoss = losses.reduce((s, l) => s + l, 0) / simulations;
  const percentile = (p: number) => losses[Math.min(simulations - 1, Math.floor(p * simulations))];
  const var95 = percentile(0.95);
  const var99 = percentile(0.99);
  const expectedShortfall = depletions.length > 0 ? depletions.reduce((s, l) => s + (l - fundBalance), 0) / depletions.length : 0;

  return {
    simulations,
    correlation,
    fundBalance,
    fundBalanceFmt: fmtBRL(fundBalance),
    exposureCount: exposure.length,
    exposureTotal,
    exposureTotalFmt: fmtBRL(exposureTotal),
    usingMlModel: exposure.some((e) => e.pdSource === 'ml'),
    pDepletion,
    expectedLoss,
    expectedLossFmt: fmtBRL(expectedLoss),
    var95,
    var95Fmt: fmtBRL(var95),
    var99,
    var99Fmt: fmtBRL(var99),
    expectedShortfall,
    expectedShortfallFmt: fmtBRL(expectedShortfall),
  };
}
