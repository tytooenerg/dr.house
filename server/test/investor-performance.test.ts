import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { createDuplicata, createPurchase } from '../src/db/duplicatas.js';
import { db } from '../src/db/index.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-perf-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

// Backdates created_at and forces a known retorno (createPurchase's own retorno is
// randomized within a real range, fine for settlement but not for a deterministic
// assertion here) so diasCarencia/annualization are stable across test runs — same
// pattern income-tax-statement.test.ts uses.
function buyPosition(investorId: number, sacadoNome: string, valor: number, retorno: number, appliedAt: string, vencimento: string) {
  const d = createDuplicata({
    cedenteId: null,
    cedenteNome: 'Cedente Teste',
    sacadoNome,
    sacadoCnpj: '',
    valor,
    vencimento,
    emissao: '10/08/2026',
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
  });
  createPurchase(d.id, investorId, valor, '2,0%');
  db.prepare('UPDATE purchases SET retorno = ?, created_at = ? WHERE duplicata_id = ?').run(retorno, appliedAt, d.id);
  return d.id;
}

describe('Investor performance dashboard — degenerate/empty portfolio', () => {
  it('returns zero/null metrics for an investor with no purchases', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).get('/api/historico/performance').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.positionsCount).toBe(0);
    expect(res.body.totalInvestido).toBe(0);
    expect(res.body.retornoMedioPonderadoPct).toBe(0);
    expect(res.body.volatilidadePct).toBe(0);
    expect(res.body.sharpeLike).toBeNull();
    expect(res.body.sacadosDistintos).toBe(0);
    expect(res.body.positions).toEqual([]);
  });
});

describe('Investor performance dashboard — real weighted math', () => {
  it('computes a real weighted annualized return and null Sharpe with a single position', async () => {
    const { token, userId } = await registerInvestidor();
    // 100000 invested, 2% retorno (2000), applied for exactly 365 days (2031-06-15 -> 2032-06-14)
    // so the annualization factor is ~1x and retornoAnualizadoPct ~= 2%.
    buyPosition(userId, 'Fixed Sacado A', 100000, 2000, '2031-06-15T12:00:00.000Z', '2032-06-14');

    const res = await request(app).get('/api/historico/performance').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.positionsCount).toBe(1);
    expect(res.body.totalInvestido).toBe(100000);
    expect(res.body.retornoMedioPonderadoPct).toBeGreaterThan(1.9);
    expect(res.body.retornoMedioPonderadoPct).toBeLessThan(2.1);
    // A single position has zero dispersion and <2 positions -> no Sharpe-like ratio.
    expect(res.body.sharpeLike).toBeNull();
    expect(res.body.maiorConcentracaoSacadoPct).toBe(100);
    expect(res.body.sacadosDistintos).toBe(1);
  });

  it('computes real dispersion and a Sharpe-like ratio across two positions with different annualized returns', async () => {
    const { token, userId } = await registerInvestidor();
    // Position A: short tenor (30 days) at 2% -> high annualized return.
    buyPosition(userId, 'Fixed Sacado B', 50000, 1000, '2031-01-01T12:00:00.000Z', '2031-01-31');
    // Position B: long tenor (365 days) at 2% -> ~1x annualized, much lower than A.
    buyPosition(userId, 'Fixed Sacado C', 50000, 1000, '2031-01-01T12:00:00.000Z', '2032-01-01');

    const res = await request(app).get('/api/historico/performance').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.positionsCount).toBe(2);
    expect(res.body.totalInvestido).toBe(100000);
    expect(res.body.volatilidadePct).toBeGreaterThan(0);
    expect(res.body.sharpeLike).not.toBeNull();
    expect(res.body.sacadosDistintos).toBe(2);
    expect(res.body.maiorConcentracaoSacadoPct).toBe(50);

    // Sorted descending by retornoAnualizadoPct — the short-tenor position should rank first.
    expect(res.body.positions[0].sacado).toBe('Fixed Sacado B');
    expect(res.body.positions[0].retornoAnualizadoPct).toBeGreaterThan(res.body.positions[1].retornoAnualizadoPct);
  });

  it('accepts a caller-supplied risk-free rate that shifts the Sharpe-like ratio', async () => {
    const { token, userId } = await registerInvestidor();
    buyPosition(userId, 'Fixed Sacado D', 30000, 600, '2031-03-01T12:00:00.000Z', '2031-03-31');
    buyPosition(userId, 'Fixed Sacado E', 30000, 600, '2031-03-01T12:00:00.000Z', '2032-02-29');

    const zeroRes = await request(app).get('/api/historico/performance?riskFree=0').set('Authorization', `Bearer ${token}`);
    const highRes = await request(app).get('/api/historico/performance?riskFree=30').set('Authorization', `Bearer ${token}`);
    expect(zeroRes.body.riskFreeRateAnnualPct).toBe(0);
    expect(highRes.body.riskFreeRateAnnualPct).toBe(30);
    expect(highRes.body.sharpeLike).toBeLessThan(zeroRes.body.sharpeLike);
  });

  it('filters by year when provided and ignores it when omitted', async () => {
    const { token, userId } = await registerInvestidor();
    buyPosition(userId, 'Fixed Sacado F', 10000, 200, '2024-05-01T12:00:00.000Z', '2024-05-31');

    const filtered = await request(app).get('/api/historico/performance?year=2024').set('Authorization', `Bearer ${token}`);
    expect(filtered.body.year).toBe(2024);
    expect(filtered.body.positionsCount).toBe(1);

    const otherYear = await request(app).get('/api/historico/performance?year=2020').set('Authorization', `Bearer ${token}`);
    expect(otherYear.body.positionsCount).toBe(0);

    const allTime = await request(app).get('/api/historico/performance').set('Authorization', `Bearer ${token}`);
    expect(allTime.body.year).toBeNull();
    expect(allTime.body.positionsCount).toBe(1);
  });
});
