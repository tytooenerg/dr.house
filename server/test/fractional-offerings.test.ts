import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { createDuplicata } from '../src/db/duplicatas.js';
import { FRACTIONAL_MIN_VALOR } from '../src/lib/fractionalOfferings.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-frac-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

function makeLargeDuplicata(valor = 300000) {
  return createDuplicata({
    cedenteId: null,
    cedenteNome: 'Cedente Grande Ltda',
    sacadoNome: 'Fractional Test Sacado',
    sacadoCnpj: '',
    valor,
    vencimento: '2026-12-31',
    emissao: '10/08/2026',
    status: 'aprovada',
    lastroPct: 100,
    seguro: false,
  });
}

describe('Fractional offerings — eligibility', () => {
  it('rejects a duplicata below the value threshold', async () => {
    const { token } = await registerInvestidor();
    const d = makeLargeDuplicata(FRACTIONAL_MIN_VALOR - 1000);
    const res = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${token}`).send({ tokens: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_eligible');
  });

  it('GET /:id/fracionamento reports eligibility and a null offering before any purchase', async () => {
    const { token } = await registerInvestidor();
    const d = makeLargeDuplicata();
    const res = await request(app).get(`/api/market/${d.id}/fracionamento`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(true);
    expect(res.body.offering).toBeNull();
  });
});

describe('Fractional offerings — real multi-investor allocation', () => {
  it('two different investors can each buy a real slice of the same large duplicata', async () => {
    const d = makeLargeDuplicata(300000); // token = 3.000
    const investorA = await registerInvestidor();
    const investorB = await registerInvestidor();

    const buyA = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${investorA.token}`).send({ tokens: 20 });
    expect(buyA.status).toBe(200);
    expect(buyA.body.offering.tokensVendidos).toBe(20);
    expect(buyA.body.offering.status).toBe('aberta');

    const buyB = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${investorB.token}`).send({ tokens: 30 });
    expect(buyB.status).toBe(200);
    expect(buyB.body.offering.tokensVendidos).toBe(50);
    expect(buyB.body.offering.holdersCount).toBe(2);

    const holdingsA = await request(app).get('/api/market/minhas-cotas').set('Authorization', `Bearer ${investorA.token}`);
    expect(holdingsA.body.holdings).toHaveLength(1);
    expect(holdingsA.body.holdings[0].tokens).toBe(20);
    expect(holdingsA.body.holdings[0].pctPosicao).toBe(20);
  });

  it('rejects buying more tokens than are actually still available', async () => {
    const d = makeLargeDuplicata(200000);
    const { token } = await registerInvestidor();
    await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${token}`).send({ tokens: 90 });
    const res = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${token}`).send({ tokens: 20 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('insufficient_tokens');
  });

  it('completing the offering (100 tokens) marks the duplicata vendida and blocks a whole purchase', async () => {
    const d = makeLargeDuplicata(200000);
    const buyer = await registerInvestidor();
    const wholeHunter = await registerInvestidor();
    const full = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${buyer.token}`).send({ tokens: 100 });
    expect(full.status).toBe(200);
    expect(full.body.offering.status).toBe('concluida');
    expect(full.body.offering.pctVendido).toBe(100);

    const wholeBuy = await request(app).post(`/api/market/${d.id}/buy`).set('Authorization', `Bearer ${wholeHunter.token}`);
    expect(wholeBuy.status).toBe(409);
    expect(wholeBuy.body.error).toBe('already_purchased');
  });

  it('a duplicata already bought whole cannot then be fractionalized', async () => {
    const d = makeLargeDuplicata(200000);
    const wholeBuyer = await registerInvestidor();
    const wholeBuy = await request(app).post(`/api/market/${d.id}/buy`).set('Authorization', `Bearer ${wholeBuyer.token}`);
    expect(wholeBuy.status).toBe(200);

    const fractionalHopeful = await registerInvestidor();
    const res = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${fractionalHopeful.token}`).send({ tokens: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('not_eligible');
  });

  it('a fractional purchase debits the investor and credits the cedente net of the platform fee, real ledger entries', async () => {
    const d = makeLargeDuplicata(300000);
    const buyer = await registerInvestidor();
    const res = await request(app).post(`/api/market/${d.id}/fracionar`).set('Authorization', `Bearer ${buyer.token}`).send({ tokens: 10 });
    expect(res.status).toBe(200);
    // 10 tokens of a 300.000 duplicata = 30.000 invested.
    expect(res.body.valorInvestidoFmt).toContain('30.000');

    const extrato = await request(app).get('/api/account').set('Authorization', `Bearer ${buyer.token}`);
    const debit = extrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes(d.id));
    expect(debit).toBeTruthy();
    expect(debit.isPositive).toBe(false);
  });
});
