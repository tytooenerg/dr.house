import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { INSURANCE_COMMISSION_PCT } from '../src/lib/settlement.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-ins-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function loginSeguradoraToo() {
  const res = await request(app).post('/api/auth/login').send({ email: 'seguradora@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

// Two seeded demo offers are pre-insured by 'too' — always pick a fresh, still-uninsured
// offer so tests don't collide with that seed data or with each other's mutations.
async function pickUninsuredOffer(token: string) {
  const market = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
  const offer = market.body.offers.find((o: { insurerInfo: unknown }) => !o.insurerInfo);
  if (!offer) throw new Error('no uninsured offer available for test');
  return offer as { id: string; valor: number };
}

function ledgerAmounts(extrato: { descricao: string; valorFmt: string; isPositive: boolean }[], substr: string) {
  return extrato.filter((e) => e.descricao.includes(substr));
}

describe('POST /api/market/:id/insure', () => {
  it('forbids a non-investidor role', async () => {
    const email = `ced-ins-${unique()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Cedente', email, password: 'senha123', companyName: 'C Ltda', role: 'cedente' });
    const token = reg.body.token as string;
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const offerId = market.body.offers[0].id;
    const res = await request(app).post(`/api/market/${offerId}/insure`).set('Authorization', `Bearer ${token}`).send({ key: 'too' });
    expect(res.status).toBe(403);
  });

  it('charges the investor the full premium and pays the seguradora net of commission', async () => {
    const { token } = await registerInvestidor();
    const offer = await pickUninsuredOffer(token);

    const res = await request(app).post(`/api/market/${offer.id}/insure`).set('Authorization', `Bearer ${token}`).send({ key: 'too' });
    expect(res.status).toBe(200);

    const premio = offer.valor * 0.0055; // Too Seguros: 0.55%
    const comissao = premio * INSURANCE_COMMISSION_PCT;
    const repasse = premio - comissao;

    const investorExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const debit = ledgerAmounts(investorExtrato.body.extrato, offer.id)[0];
    expect(debit).toBeTruthy();
    expect(debit.isPositive).toBe(false);
    expect(debit.valorFmt.replace(/\D/g, '')).toBe(String(Math.round(premio)));

    const seguradoraToken = await loginSeguradoraToo();
    const seguradoraExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${seguradoraToken}`);
    const credit = ledgerAmounts(seguradoraExtrato.body.extrato, offer.id)[0];
    expect(credit).toBeTruthy();
    expect(credit.isPositive).toBe(true);
    expect(credit.valorFmt.replace(/\D/g, '')).toBe(String(Math.round(repasse)));
  });

  it('does not re-charge when the same insurer key is resubmitted', async () => {
    const { token } = await registerInvestidor();
    const offer = await pickUninsuredOffer(token);

    await request(app).post(`/api/market/${offer.id}/insure`).set('Authorization', `Bearer ${token}`).send({ key: 'pottencial' });
    const before = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const countBefore = ledgerAmounts(before.body.extrato, offer.id).length;

    await request(app).post(`/api/market/${offer.id}/insure`).set('Authorization', `Bearer ${token}`).send({ key: 'pottencial' });
    const after = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const countAfter = ledgerAmounts(after.body.extrato, offer.id).length;

    expect(countAfter).toBe(countBefore);
  });

  it('charges again when switching to a different insurer', async () => {
    const { token } = await registerInvestidor();
    const offer = await pickUninsuredOffer(token);

    await request(app).post(`/api/market/${offer.id}/insure`).set('Authorization', `Bearer ${token}`).send({ key: 'too' });
    const before = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const countBefore = ledgerAmounts(before.body.extrato, offer.id).length;

    await request(app).post(`/api/market/${offer.id}/insure`).set('Authorization', `Bearer ${token}`).send({ key: 'junto' });
    const after = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const countAfter = ledgerAmounts(after.body.extrato, offer.id).length;

    expect(countAfter).toBe(countBefore + 1);
  });

  it('does not charge when removing insurance', async () => {
    const { token } = await registerInvestidor();
    const offer = await pickUninsuredOffer(token);

    await request(app).post(`/api/market/${offer.id}/insure`).set('Authorization', `Bearer ${token}`).send({ key: 'too' });
    const before = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const countBefore = ledgerAmounts(before.body.extrato, offer.id).length;

    await request(app).post(`/api/market/${offer.id}/insure`).set('Authorization', `Bearer ${token}`).send({ key: null });
    const after = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const countAfter = ledgerAmounts(after.body.extrato, offer.id).length;

    expect(countAfter).toBe(countBefore);
  });
});

describe('GET /api/revenue — real insurance commission', () => {
  it('reflects contracted policies', async () => {
    const { token } = await registerInvestidor();
    const offer = await pickUninsuredOffer(token);
    await request(app).post(`/api/market/${offer.id}/insure`).set('Authorization', `Bearer ${token}`).send({ key: 'too' });

    const revenue = await request(app).get('/api/revenue').set('Authorization', `Bearer ${token}`);
    expect(revenue.status).toBe(200);
    expect(revenue.body.realInsuranceCommission.totalApolices).toBeGreaterThan(0);
    expect(revenue.body.realInsuranceCommission.comissaoPctFmt).toBe('18%');
  });
});
