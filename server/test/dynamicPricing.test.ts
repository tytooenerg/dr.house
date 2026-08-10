import { describe, expect, it, beforeAll } from 'vitest';
import { seedIfEmpty } from '../src/db/seed.js';
import { createDuplicata, createPurchase } from '../src/db/duplicatas.js';
import { createUser } from '../src/db/users.js';
import { computeLiquiditySignal, estimateRateBand, BASE_RATE_BANDS } from '../src/lib/dynamicPricing.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

describe('dynamic pricing — liquidity signal', () => {
  it('reports a neutral multiplier and a real ratio, always within the clamp band', () => {
    const signal = computeLiquiditySignal();
    expect(signal.multiplier).toBeGreaterThanOrEqual(0.85);
    expect(signal.multiplier).toBeLessThanOrEqual(1.25);
    expect(signal.supply30dBRL).toBeGreaterThanOrEqual(0);
    expect(signal.demand30dBRL).toBeGreaterThanOrEqual(0);
  });

  it('heavy demand relative to supply compresses the multiplier below 1 (rates get better for the cedente)', () => {
    const cedente = createUser({ email: `dp-ced-${unique()}@example.com`, passwordHash: 'x', nome: 'T', companyName: 'DP Cedente', role: 'cedente' });
    const investidor = createUser({ email: `dp-inv-${unique()}@example.com`, passwordHash: 'x', nome: 'T', companyName: 'DP Investidor', role: 'investidor' });

    const before = computeLiquiditySignal();

    // A small new supply...
    const dupId = `DUP-DPTEST-${unique()}`;
    createDuplicata({
      cedenteId: cedente.id,
      cedenteNome: cedente.company_name,
      sacadoNome: 'Sacado DP',
      sacadoCnpj: '55.555.555/0001-55',
      valor: 10_000,
      vencimento: '2030-01-01',
      emissao: '01/01/2026',
      status: 'aprovada',
      lastroPct: 90,
      seguro: false,
      id: dupId,
    });
    // ...met with disproportionately large real demand.
    createPurchase(dupId, investidor.id, 200_000, '2,0');

    const after = computeLiquiditySignal();
    expect(after.demand30dBRL).toBeGreaterThan(before.demand30dBRL);
    expect(after.ratio).toBeGreaterThan(before.ratio);
  });
});

describe('dynamic pricing — rate band', () => {
  it('applies the liquidity multiplier around each rating band midpoint', () => {
    for (const rating of ['AA', 'A', 'B', 'C'] as const) {
      const { min, max, mid, signal } = estimateRateBand(rating);
      const [baseMin, baseMax] = BASE_RATE_BANDS[rating];
      expect(min).toBeCloseTo(baseMin * signal.multiplier, 5);
      expect(max).toBeCloseTo(baseMax * signal.multiplier, 5);
      expect(mid).toBeCloseTo((min + max) / 2, 5);
    }
  });

  it('falls back to the A band for an unknown rating shape', () => {
    // @ts-expect-error deliberately invalid rating to exercise the fallback
    const { mid } = estimateRateBand('Z');
    const [baseMin, baseMax] = BASE_RATE_BANDS.A;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(baseMax * 1.3);
    expect(mid).toBeGreaterThan(baseMin * 0.8);
  });
});
