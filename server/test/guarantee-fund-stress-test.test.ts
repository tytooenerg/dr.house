import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { createDuplicata, createPurchase } from '../src/db/duplicatas.js';
import { runStressTest, buildExposure } from '../src/lib/guaranteeFundStressTest.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function registerInvestidor() {
  const email = `inv-stress-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Stress ${unique()}`, role: 'investidor' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

function buyUninsuredActive(investorId: number, valor: number, sacadoNome = 'Sacado Stress Genérico') {
  const d = createDuplicata({
    cedenteId: null,
    cedenteNome: 'Cedente Stress',
    sacadoNome,
    sacadoCnpj: '',
    valor,
    vencimento: '2026-12-31',
    emissao: '10/08/2026',
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
  });
  createPurchase(d.id, investorId, valor, '2,0%');
  return d.id;
}

describe('Guarantee fund stress test — exposure and Monte Carlo output shape', () => {
  it('reports zero exposure/risk when there are no active uninsured positions', () => {
    // A fresh test-file db (per-file isolation) may still have zero real purchases seeded
    // for this scenario if nothing above ran yet — assert the shape holds regardless.
    const exposure = buildExposure();
    const result = runStressTest({ simulations: 200, seed: 1 });
    expect(result.exposureCount).toBe(exposure.length);
    if (exposure.length === 0) {
      expect(result.pDepletion).toBe(0);
      expect(result.expectedLoss).toBe(0);
    }
  });

  it('builds real exposure from active uninsured purchases and computes a coherent Monte Carlo result', async () => {
    const { userId } = await registerInvestidor();
    buyUninsuredActive(userId, 50000, 'Sacado Stress A');
    buyUninsuredActive(userId, 80000, 'Sacado Stress B');
    buyUninsuredActive(userId, 30000, 'Sacado Stress C');

    const exposure = buildExposure();
    expect(exposure.length).toBeGreaterThanOrEqual(3);
    // No trained ML model in this fresh test db — every position falls back to the
    // documented assumed prior, never a fabricated "real" number.
    expect(exposure.every((e) => e.pdSource === 'assumed')).toBe(true);

    const result = runStressTest({ simulations: 5000, seed: 42 });
    expect(result.usingMlModel).toBe(false);
    expect(result.exposureTotal).toBeGreaterThan(0);
    expect(result.pDepletion).toBeGreaterThanOrEqual(0);
    expect(result.pDepletion).toBeLessThanOrEqual(1);
    // Percentiles are sorted by construction regardless of the underlying loss distribution.
    expect(result.var99).toBeGreaterThanOrEqual(result.var95);
    expect(result.expectedShortfall).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic for a fixed seed', () => {
    const a = runStressTest({ simulations: 2000, seed: 7 });
    const b = runStressTest({ simulations: 2000, seed: 7 });
    expect(a.expectedLoss).toBe(b.expectedLoss);
    expect(a.pDepletion).toBe(b.pDepletion);
    expect(a.var99).toBe(b.var99);
  });

  it('clamps simulations to the documented bounds', () => {
    const tooFew = runStressTest({ simulations: 1, seed: 1 });
    expect(tooFew.simulations).toBe(100);
    const tooMany = runStressTest({ simulations: 10_000_000, seed: 1 });
    expect(tooMany.simulations).toBe(50_000);
  });
});

describe('Guarantee fund stress test — admin route', () => {
  it('returns a real stress-test result to an admin', async () => {
    const admin = await adminToken();
    const res = await request(app).get('/api/admin/guarantee-fund/stress-test?simulations=1000').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.body.simulations).toBe(1000);
    expect(res.body).toHaveProperty('pDepletion');
    expect(res.body).toHaveProperty('fundBalanceFmt');
    expect(res.body).toHaveProperty('exposureTotalFmt');
  });

  it('rejects a non-admin', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).get('/api/admin/guarantee-fund/stress-test').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
