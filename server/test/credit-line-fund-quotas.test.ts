import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { db } from '../src/db/index.js';
import { getInvestorQuotas, getTotalQuotas } from '../src/db/creditLineFund.js';
import { getCotaPrice } from '../src/lib/creditLineFund.js';
import { createDuplicata } from '../src/db/duplicatas.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-cl-quota-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor Cota', email, password: 'senha123', companyName: `Fomento Cota ${unique()}`, role: 'investidor' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function registerCedente() {
  const email = `ced-cl-quota-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Cota', email, password: 'senha123', companyName: `Cedente Cota ${unique()}`, role: 'cedente' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

function seedRecentDuplicatas(cedenteId: number, count: number, valorEach: number) {
  for (let i = 0; i < count; i++) {
    createDuplicata({
      cedenteId,
      cedenteNome: 'Cedente Cota',
      sacadoNome: 'Sacado Genérico Cota',
      sacadoCnpj: '',
      valor: valorEach,
      vencimento: '2026-12-31',
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
  }
}

// Backdates a draw's last_accrual_at so the next real accrual (lib/creditLine.ts's
// accrueDraw, run lazily whenever the draw is next looked at — a repay here) computes a
// real, substantial interest amount instead of the near-zero interest a same-millisecond
// test run would otherwise produce. This exercises the real interest formula, just with a
// realistic elapsed time instead of a live clock.
function backdateDraw(drawId: number, days: number) {
  const past = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  db.prepare('UPDATE credit_line_draws SET last_accrual_at = ? WHERE id = ?').run(past, drawId);
}

describe('Credit line fund — cota/NAV pricing distributes yield proportionally', () => {
  it('an early contributor earns real yield via a rising cota price; a later contributor at a higher price does not get a windfall', async () => {
    const investorA = await registerInvestidor();
    const aporteA = 100000;
    await request(app).post('/api/credit-line-fund/contribuir').set('Authorization', `Bearer ${investorA.token}`).send({ valor: aporteA });

    const quotasA = getInvestorQuotas(investorA.userId);
    // Bootstrap price is R$1,00/cota whenever this is the very first contribution ever made
    // to the fund across the whole test run — but other test files may have already
    // contributed real liquidity first (shared, real fund, not reset per test), in which
    // case the price could already be at/above 1,00. Either way, quotas bought must be a
    // real, positive number worth no more than the reais put in (price ≥ 1,00 baseline).
    expect(quotasA).toBeGreaterThan(0);
    expect(quotasA).toBeLessThanOrEqual(aporteA);

    const cedente = await registerCedente();
    seedRecentDuplicatas(cedente.userId, 4, 500000);
    const overview = await request(app).get('/api/credit-line').set('Authorization', `Bearer ${cedente.token}`);
    expect(overview.body.eligible).toBe(true);
    const drawValor = Math.min(50000, Math.floor((overview.body.limite as number) * 0.5));
    expect(drawValor).toBeGreaterThan(1000);

    const draw = await request(app).post('/api/credit-line/draw').set('Authorization', `Bearer ${cedente.token}`).send({ valor: drawValor });
    expect(draw.status).toBe(200);

    const afterDraw = await request(app).get('/api/credit-line').set('Authorization', `Bearer ${cedente.token}`);
    const drawId = afterDraw.body.draws[0].id as number;
    backdateDraw(drawId, 30); // pretend the draw has been outstanding for 30 real days

    const navBefore = getCotaPrice() * getTotalQuotas();
    const repay = await request(app)
      .post('/api/credit-line/repay')
      .set('Authorization', `Bearer ${cedente.token}`)
      .send({ valor: drawValor * 1.2 }); // comfortably covers principal + ~30 days of real interest
    expect(repay.status).toBe(200);

    const cotaPriceAfterYield = getCotaPrice();
    const navAfter = cotaPriceAfterYield * getTotalQuotas();
    // Real interest landed in the pool without minting any new quotas, so NAV grew — the
    // defining mechanic that makes the cota price itself rise for existing holders.
    expect(navAfter).toBeGreaterThan(navBefore);

    const equityA = quotasA * cotaPriceAfterYield;
    // Investor A held quotas through the whole draw→repay cycle, so their equity value grew
    // beyond their raw contributed principal — real proportional yield, not a flat split.
    expect(equityA).toBeGreaterThan(aporteA);

    // A second investor contributing the *same* reais now, after the price has already
    // risen, buys fewer quotas for it — no windfall from yield that accrued before they
    // put any money in.
    const investorB = await registerInvestidor();
    await request(app).post('/api/credit-line-fund/contribuir').set('Authorization', `Bearer ${investorB.token}`).send({ valor: aporteA });
    const quotasB = getInvestorQuotas(investorB.userId);
    expect(quotasB).toBeLessThan(quotasA);

    const overviewA = await request(app).get('/api/credit-line-fund').set('Authorization', `Bearer ${investorA.token}`);
    const overviewB = await request(app).get('/api/credit-line-fund').set('Authorization', `Bearer ${investorB.token}`);
    // Same reais contributed by both, but A's position (quotas bought cheaper, before the
    // yield landed) is worth strictly more than B's (bought at today's already-higher price).
    const parseBRL = (s: string) => Number(s.replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3},)/g, '').replace(',', '.'));
    expect(parseBRL(overviewA.body.yourPositionFmt)).toBeGreaterThan(parseBRL(overviewB.body.yourPositionFmt));
  });
});

describe('Credit line fund — cota price API surface', () => {
  it('exposes a real NAV and cota price alongside the cash balance', async () => {
    const investor = await registerInvestidor();
    const res = await request(app).get('/api/credit-line-fund').set('Authorization', `Bearer ${investor.token}`);
    expect(res.status).toBe(200);
    expect(res.body.balanceFmt).toBeTruthy();
    expect(res.body.navFmt).toBeTruthy();
    expect(res.body.cotaPriceFmt).toMatch(/^R\$ \d/);
  });
});
