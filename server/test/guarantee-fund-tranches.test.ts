import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { createDuplicata, createPurchase } from '../src/db/duplicatas.js';
import { getFundBalance } from '../src/db/guaranteeFund.js';
import { getTrancheNav } from '../src/db/guaranteeFundTranches.js';
import { getYieldApr } from '../src/lib/guaranteeFundTranches.js';
import { settlePurchase } from '../src/lib/settlement.js';

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
  const email = `inv-tranche-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Investidor Tranche ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

// Same real-settlement path guarantee-fund.test.ts uses — the only way to put real money
// into the fund's base (non-tranched) layer.
function buyUninsuredOverdue(investorId: number, valor: number) {
  const d = createDuplicata({
    cedenteId: null,
    cedenteNome: 'Cedente Teste',
    sacadoNome: 'Fund Tranche Sacado',
    sacadoCnpj: '',
    valor,
    vencimento: '2020-01-10',
    emissao: '10/12/2019',
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
  });
  createPurchase(d.id, investorId, valor, '2,0%');
  settlePurchase({ duplicataId: d.id, sacadoNome: d.sacado_nome, investorId, cedenteId: d.cedente_id, valor });
  return d.id;
}

describe('Guarantee fund tranches — contribution and redemption', () => {
  it('an aporte credits real fund cash and opens a position at the current cota price', async () => {
    const { token, userId } = await registerInvestidor();
    const fundBefore = getFundBalance();

    const res = await request(app).post('/api/guarantee-fund/tranches/aportar').set('Authorization', `Bearer ${token}`).send({ classe: 'junior', valor: 1000 });
    expect(res.status).toBe(200);
    expect(res.body.junior.minhaPosicaoFmt).toBeTruthy();

    expect(getFundBalance() - fundBefore).toBeCloseTo(1000, 6);

    const overview = await request(app).get('/api/guarantee-fund/tranches').set('Authorization', `Bearer ${token}`);
    expect(overview.status).toBe(200);
    expect(overview.body.junior.minhaPosicaoFmt).toBeTruthy();
    expect(overview.body.senior.minhaPosicaoFmt).toBeTruthy(); // present (R$ 0) even without a senior position

    // A non-investidor role can't reach the route at all.
    const denied = await request(app).post('/api/guarantee-fund/tranches/aportar').send({ classe: 'junior', valor: 100 });
    expect(denied.status).toBe(401);
  });

  it('rejects an invalid classe/valor and caps a resgate by the real available position', async () => {
    const { token } = await registerInvestidor();
    const invalid = await request(app).post('/api/guarantee-fund/tranches/aportar').set('Authorization', `Bearer ${token}`).send({ classe: 'mezanino', valor: 100 });
    expect(invalid.status).toBe(400);

    await request(app).post('/api/guarantee-fund/tranches/aportar').set('Authorization', `Bearer ${token}`).send({ classe: 'senior', valor: 500 });
    const overdraw = await request(app).post('/api/guarantee-fund/tranches/resgatar').set('Authorization', `Bearer ${token}`).send({ classe: 'senior', valor: 999999 });
    expect(overdraw.status).toBe(409);
    expect(overdraw.body.error).toBe('insufficient_available');

    const ok = await request(app).post('/api/guarantee-fund/tranches/resgatar').set('Authorization', `Bearer ${token}`).send({ classe: 'senior', valor: 200 });
    expect(ok.status).toBe(200);
  });
});

describe('Guarantee fund tranches — loss waterfall (base → júnior → sênior)', () => {
  it('a sinistro payout drains base capital first, then júnior, only reaching sênior once júnior is exhausted', async () => {
    const junior = await registerInvestidor();
    const senior = await registerInvestidor();
    await request(app).post('/api/guarantee-fund/tranches/aportar').set('Authorization', `Bearer ${junior.token}`).send({ classe: 'junior', valor: 1000 });
    await request(app).post('/api/guarantee-fund/tranches/aportar').set('Authorization', `Bearer ${senior.token}`).send({ classe: 'senior', valor: 5000 });

    const claimant = await registerInvestidor();
    // A large enough claim that its 80%-of-valor coverage cap, not the fund's real
    // balance, is the binding constraint — same technique guarantee-fund.test.ts uses.
    const duplicataId = buyUninsuredOverdue(claimant.userId, 2000);

    const juniorNavBefore = getTrancheNav('junior');
    const seniorNavBefore = getTrancheNav('senior');
    const totalBefore = getFundBalance();
    const baseBefore = totalBefore - juniorNavBefore - seniorNavBefore;

    const claim = await request(app).post('/api/guarantee-fund/claims').set('Authorization', `Bearer ${claimant.token}`).send({ duplicataId });
    expect(claim.status).toBe(200);
    const admin = await adminToken();
    const decide = await request(app)
      .post(`/api/admin/guarantee-fund/claims/${claim.body.claimId}/decidir`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'aprovado', note: 'teste automatizado — waterfall' });
    expect(decide.status).toBe(200);

    const valorPago = totalBefore - getFundBalance(); // exact real cash that left the fund
    expect(valorPago).toBeGreaterThan(0);

    const fromBase = Math.min(valorPago, Math.max(0, baseBefore));
    const remaining1 = valorPago - fromBase;
    const fromJunior = Math.min(remaining1, juniorNavBefore);
    const remaining2 = remaining1 - fromJunior;
    const fromSenior = Math.min(remaining2, seniorNavBefore);

    expect(getTrancheNav('junior')).toBeCloseTo(juniorNavBefore - fromJunior, 6);
    expect(getTrancheNav('senior')).toBeCloseTo(seniorNavBefore - fromSenior, 6);
    // With only R$2.000 solicitado (coverage cap R$1.600) against a much larger júnior
    // position, sênior should be untouched — the whole point of the ordering.
    expect(fromSenior).toBe(0);
    expect(fromJunior).toBeGreaterThan(0);
  });
});

describe('Guarantee fund tranches — yield distribution', () => {
  it('pays each classe (APR ÷ 12) × NAV, funded from base capital, unscaled when base is ample', async () => {
    const junior = await registerInvestidor();
    const senior = await registerInvestidor();
    await request(app).post('/api/guarantee-fund/tranches/aportar').set('Authorization', `Bearer ${junior.token}`).send({ classe: 'junior', valor: 5000 });
    await request(app).post('/api/guarantee-fund/tranches/aportar').set('Authorization', `Bearer ${senior.token}`).send({ classe: 'senior', valor: 5000 });

    // Seed a large base contribution so the payout isn't the scaled-down branch.
    const funder = await registerInvestidor();
    buyUninsuredOverdue(funder.userId, 4_000_000);

    // Earlier tests in this file may have left NAV in either classe (accumulating state
    // within a file is the same pattern guarantee-fund.test.ts already relies on) — read
    // the real pre-distribution NAV rather than assuming a clean/equal starting point.
    const juniorNavBefore = getTrancheNav('junior');
    const seniorNavBefore = getTrancheNav('senior');

    const admin = await adminToken();
    const run = await request(app).post('/api/admin/guarantee-fund/tranches/distribuir-rendimento').set('Authorization', `Bearer ${admin}`);
    expect(run.status).toBe(200);

    // Measure the real NAV delta, not the fmtBRL-rounded (maximumFractionDigits: 0)
    // response string — a whole-reais display has too little precision for this
    // assertion, and losing it isn't a sign of a calculation bug.
    const juniorPago = getTrancheNav('junior') - juniorNavBefore;
    const seniorPago = getTrancheNav('senior') - seniorNavBefore;
    expect(juniorPago).toBeCloseTo(juniorNavBefore * (getYieldApr('junior') / 12), 6);
    expect(seniorPago).toBeCloseTo(seniorNavBefore * (getYieldApr('senior') / 12), 6);
    expect(juniorPago).toBeGreaterThan(0);
    expect(seniorPago).toBeGreaterThan(0);
  });

  it('scales the payout down instead of overdrawing when base capital is insufficient', async () => {
    const junior = await registerInvestidor();
    await request(app).post('/api/guarantee-fund/tranches/aportar').set('Authorization', `Bearer ${junior.token}`).send({ classe: 'junior', valor: 100_000_000 });

    const totalBefore = getFundBalance();
    const admin = await adminToken();
    const run = await request(app).post('/api/admin/guarantee-fund/tranches/distribuir-rendimento').set('Authorization', `Bearer ${admin}`);
    expect(run.status).toBe(200);
    // Never pays out more than the fund's real base actually has, whatever the nominal
    // APR × NAV would otherwise demand.
    expect(getFundBalance()).toBeGreaterThanOrEqual(totalBefore - (totalBefore - getTrancheNav('junior') - getTrancheNav('senior')) - 0.01);
  });

  it('admin can change the yield APR per classe', async () => {
    const admin = await adminToken();
    const update = await request(app).put('/api/admin/guarantee-fund/tranches/yield-apr').set('Authorization', `Bearer ${admin}`).send({ classe: 'junior', apr: 0.2 });
    expect(update.status).toBe(200);
    expect(update.body.apr).toBe(0.2);

    const denied = await request(app).put('/api/admin/guarantee-fund/tranches/yield-apr').send({ classe: 'junior', apr: 0.2 });
    expect(denied.status).toBe(401);
  });
});
