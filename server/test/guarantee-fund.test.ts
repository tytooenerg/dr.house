import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { createDuplicata, createPurchase } from '../src/db/duplicatas.js';
import { getFundBalance } from '../src/db/guaranteeFund.js';
import { FUND_CONTRIBUTION_PCT, FUND_COVERAGE_PCT } from '../src/lib/guaranteeFund.js';
import { platformFee, settlePurchase } from '../src/lib/settlement.js';

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
  const email = `inv-fund-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

// Uses the real settlement path (settlePurchase), not just the raw db insert — the
// guarantee fund's contribution (lib/guaranteeFund.ts's contributeToFund) is wired into
// settlePurchase, not into createPurchase itself.
function buyUninsuredOverdue(investorId: number, valor: number) {
  const d = createDuplicata({
    cedenteId: null,
    cedenteNome: 'Cedente Teste',
    sacadoNome: 'Fund Test Sacado',
    sacadoCnpj: '',
    valor,
    vencimento: '2020-01-10', // real past date -> genuinely overdue
    emissao: '10/12/2019',
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
  });
  createPurchase(d.id, investorId, valor, '2,0%');
  settlePurchase({ duplicataId: d.id, sacadoNome: d.sacado_nome, investorId, cedenteId: d.cedente_id, valor });
  return d.id;
}

describe('Guarantee fund — real contribution from every primary purchase', () => {
  it('a purchase increases the fund balance by exactly 10% of the platform fee', async () => {
    const { userId } = await registerInvestidor();
    const before = getFundBalance();
    const valor = 40000;
    buyUninsuredOverdue(userId, valor);
    const after = getFundBalance();
    const expectedContribution = platformFee(valor) * FUND_CONTRIBUTION_PCT;
    expect(after - before).toBeCloseTo(expectedContribution, 2);
  });

  it('exposes the real balance via GET /guarantee-fund', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).get('/api/guarantee-fund').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('balanceFmt');
    expect(res.body.contributionPct).toBe(FUND_CONTRIBUTION_PCT * 100);
  });
});

describe('Guarantee fund — claim eligibility', () => {
  it('rejects a claim for a duplicata the investor does not own', async () => {
    const owner = await registerInvestidor();
    const stranger = await registerInvestidor();
    const duplicataId = buyUninsuredOverdue(owner.userId, 20000);

    const res = await request(app).post('/api/guarantee-fund/claims').set('Authorization', `Bearer ${stranger.token}`).send({ duplicataId });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_owner');
  });

  it('rejects a claim for a duplicata that is not yet overdue', async () => {
    const { token, userId } = await registerInvestidor();
    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: 'Cedente Teste',
      sacadoNome: 'Fund Test Sacado 2',
      sacadoCnpj: '',
      valor: 15000,
      vencimento: '2026-12-31',
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
    createPurchase(d.id, userId, 15000, '2,0%');

    const res = await request(app).post('/api/guarantee-fund/claims').set('Authorization', `Bearer ${token}`).send({ duplicataId: d.id });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_overdue');
  });

  it('accepts a claim for an uninsured, overdue, owned duplicata, and rejects a duplicate claim', async () => {
    const { token, userId } = await registerInvestidor();
    const duplicataId = buyUninsuredOverdue(userId, 25000);

    const res = await request(app).post('/api/guarantee-fund/claims').set('Authorization', `Bearer ${token}`).send({ duplicataId });
    expect(res.status).toBe(200);
    expect(res.body.claimId).toBeTruthy();

    const dup = await request(app).post('/api/guarantee-fund/claims').set('Authorization', `Bearer ${token}`).send({ duplicataId });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('already_claimed');
  });
});

describe('Guarantee fund — admin decision pays out capped by coverage % and real balance', () => {
  it('approves a claim, pays min(80% do valor solicitado, saldo do fundo), and debits the fund by exactly that amount', async () => {
    const { token, userId } = await registerInvestidor();
    const duplicataId = buyUninsuredOverdue(userId, 30000);
    const claim = await request(app).post('/api/guarantee-fund/claims').set('Authorization', `Bearer ${token}`).send({ duplicataId });
    expect(claim.status).toBe(200);

    const admin = await adminToken();
    const balanceBefore = getFundBalance();
    // The real cap is min(FUND_COVERAGE_PCT of the claim, whatever the fund actually has)
    // — contributions are a small fraction of a fraction of trade volume, so a single
    // request-scale test never seeds enough to exercise the "balance is the binding
    // constraint" branch, only the "coverage % is the binding constraint" one. Compute
    // the real expectation the same way the implementation does, rather than assuming
    // one branch always wins.
    const expectedPayout = Math.min(30000 * FUND_COVERAGE_PCT, balanceBefore);

    const decide = await request(app)
      .post(`/api/admin/guarantee-fund/claims/${claim.body.claimId}/decidir`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'aprovado', note: 'Documentação conferida — teste automatizado.' });
    expect(decide.status).toBe(200);
    expect(decide.body.valorPagoFmt).toBeTruthy();

    const balanceAfter = getFundBalance();
    expect(balanceBefore - balanceAfter).toBeCloseTo(expectedPayout, 6);

    // Investor's ledger reflects the real payout.
    const extrato = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const credit = extrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes(duplicataId));
    expect(credit).toBeTruthy();
    expect(credit.isPositive).toBe(true);
  });

  it('a denied claim pays nothing and does not touch the fund balance', async () => {
    const { token, userId } = await registerInvestidor();
    const duplicataId = buyUninsuredOverdue(userId, 12000);
    const claim = await request(app).post('/api/guarantee-fund/claims').set('Authorization', `Bearer ${token}`).send({ duplicataId });

    const admin = await adminToken();
    const balanceBefore = getFundBalance();
    const decide = await request(app)
      .post(`/api/admin/guarantee-fund/claims/${claim.body.claimId}/decidir`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'negado', note: 'Sem evidência suficiente de inadimplência real.' });
    expect(decide.status).toBe(200);
    expect(decide.body.valorPagoFmt).toBeNull();
    expect(getFundBalance()).toBe(balanceBefore);
  });

  it('404s a nonexistent claim and 409s a claim already decided', async () => {
    const { token, userId } = await registerInvestidor();
    const duplicataId = buyUninsuredOverdue(userId, 8000);
    const claim = await request(app).post('/api/guarantee-fund/claims').set('Authorization', `Bearer ${token}`).send({ duplicataId });
    const admin = await adminToken();

    const missing = await request(app)
      .post('/api/admin/guarantee-fund/claims/999999999/decidir')
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'negado', note: 'n/a' });
    expect(missing.status).toBe(404);

    await request(app)
      .post(`/api/admin/guarantee-fund/claims/${claim.body.claimId}/decidir`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'negado', note: 'primeira decisão' });
    const second = await request(app)
      .post(`/api/admin/guarantee-fund/claims/${claim.body.claimId}/decidir`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ decision: 'aprovado', note: 'segunda decisão' });
    expect(second.status).toBe(409);
  });
});

describe('Guarantee fund — insured duplicatas go through the seguradora instead', () => {
  it('rejects a claim for an insured duplicata', async () => {
    const { token, userId } = await registerInvestidor();
    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: 'Cedente Teste',
      sacadoNome: 'Fund Test Insured',
      sacadoCnpj: '',
      valor: 18000,
      vencimento: '2020-01-10',
      emissao: '10/12/2019',
      status: 'aprovada',
      lastroPct: 100,
      seguro: true,
    });
    createPurchase(d.id, userId, 18000, '2,0%');
    const { setInsurer } = await import('../src/db/duplicatas.js');
    setInsurer(d.id, 'too');

    const res = await request(app).post('/api/guarantee-fund/claims').set('Authorization', `Bearer ${token}`).send({ duplicataId: d.id });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('insured');
  });
});
