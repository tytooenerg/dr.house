import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { getFundBalance } from '../src/db/creditLineFund.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-cl-fund-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor Fomento', email, password: 'senha123', companyName: `Fomento ${unique()}`, role: 'investidor' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function registerCedente() {
  const email = `ced-cl-fund-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Fomento', email, password: 'senha123', companyName: `Cedente Fomento ${unique()}`, role: 'cedente' });
  return { token: res.body.token as string };
}

describe('Credit line fund — contribution and pool balance', () => {
  it('a contribution increases the real pool balance and debits the investor own ledger', async () => {
    const { token } = await registerInvestidor();
    const before = getFundBalance();
    const res = await request(app).post('/api/credit-line-fund/contribuir').set('Authorization', `Bearer ${token}`).send({ valor: 40000 });
    expect(res.status).toBe(200);
    expect(getFundBalance() - before).toBeCloseTo(40000, 6);

    const extrato = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const entry = extrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes('Aporte no pool'));
    expect(entry).toBeTruthy();
    expect(entry.isPositive).toBe(false);
  });

  it("rejects a contribution from a non-investidor (cedente)", async () => {
    const { token } = await registerCedente();
    const res = await request(app).post('/api/credit-line-fund/contribuir').set('Authorization', `Bearer ${token}`).send({ valor: 1000 });
    expect(res.status).toBe(403);
  });

  it('exposes the real balance and the caller-specific position via GET /credit-line-fund', async () => {
    const { token } = await registerInvestidor();
    await request(app).post('/api/credit-line-fund/contribuir').set('Authorization', `Bearer ${token}`).send({ valor: 25000 });

    const res = await request(app).get('/api/credit-line-fund').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.yourPositionFmt).toBeTruthy();
    expect(res.body.yourAvailableToRedeemFmt).toBeTruthy();
  });
});

describe('Credit line fund — redemption', () => {
  it('redeems up to the available amount and rejects redeeming more than the real position/pool balance allows', async () => {
    const { token } = await registerInvestidor();
    await request(app).post('/api/credit-line-fund/contribuir').set('Authorization', `Bearer ${token}`).send({ valor: 30000 });

    const tooMuch = await request(app).post('/api/credit-line-fund/resgatar').set('Authorization', `Bearer ${token}`).send({ valor: 999999999 });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error).toBe('insufficient_available');

    const balanceBefore = getFundBalance();
    const ok = await request(app).post('/api/credit-line-fund/resgatar').set('Authorization', `Bearer ${token}`).send({ valor: 10000 });
    expect(ok.status).toBe(200);
    expect(getFundBalance()).toBeCloseTo(balanceBefore - 10000, 6);

    const extrato = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const entry = extrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes('Resgate do pool'));
    expect(entry).toBeTruthy();
    expect(entry.isPositive).toBe(true);
  });

  it('rejects a redemption of a non-positive amount', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).post('/api/credit-line-fund/resgatar').set('Authorization', `Bearer ${token}`).send({ valor: -5 });
    expect(res.status).toBe(400);
  });
});
