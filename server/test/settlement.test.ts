import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { platformFee, platformFeePct } from '../src/lib/settlement.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-settle-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

describe('platformFeePct / platformFee', () => {
  it('is tiered by volume, matching the Emitir preview', () => {
    expect(platformFeePct(50_000)).toBeCloseTo(0.0035);
    expect(platformFeePct(500_000)).toBeCloseTo(0.003);
    expect(platformFeePct(2_000_000)).toBeCloseTo(0.0025);
    expect(platformFee(100_000)).toBeCloseTo(350);
  });
});

describe('real settlement on a marketplace purchase', () => {
  it('debits the full purchase amount from the investor ledger', async () => {
    const investor = await registerInvestidor();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${investor.token}`);
    const buyable = market.body.offers.find((o: { canBuy: boolean }) => o.canBuy);
    expect(buyable).toBeTruthy();

    await request(app).post(`/api/market/${buyable.id}/buy`).set('Authorization', `Bearer ${investor.token}`);

    const investorExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${investor.token}`);
    const debit = investorExtrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes(buyable.id));
    expect(debit).toBeTruthy();
    expect(debit.isPositive).toBe(false);
  });

  it('deducts the fee from the emissor cedente when a fresh cedente-emitted duplicata is purchased', async () => {
    const cedenteEmail = `ced-settle-${unique()}@example.com`;
    const cedenteReg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Cedente', email: cedenteEmail, password: 'senha123', companyName: `Cedente ${unique()}`, role: 'cedente' });
    const cedenteToken = cedenteReg.body.token as string;

    let duplicataId = '';
    for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${cedenteToken}`)
        .send({ sacado: 'Grupo Atlas Varejo', cnpj: '', valor: '10.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      if (res.status === 200) duplicataId = res.body.duplicataId;
    }
    expect(duplicataId).not.toBe('');

    // The freshly-emitted duplicata isn't 'no_mercado' yet (needs the leilão disparado
    // via /api/minhas/:id/leilao) — dispatch it so the marketplace lists it for purchase.
    await request(app).post(`/api/minhas/${duplicataId}/leilao`).set('Authorization', `Bearer ${cedenteToken}`);

    const investor = await registerInvestidor();
    const buyRes = await request(app).post(`/api/market/${duplicataId}/buy`).set('Authorization', `Bearer ${investor.token}`);
    expect(buyRes.status).toBe(200);

    const fee = platformFee(10_000);
    const expectedNet = 10_000 - fee;

    const cedenteExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${cedenteToken}`);
    const credit = cedenteExtrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes(duplicataId));
    expect(credit).toBeTruthy();
    expect(credit.isPositive).toBe(true);
    expect(credit.descricao).toContain('taxa de plataforma');
    expect(credit.valorFmt.replace(/\D/g, '')).toBe(String(Math.round(expectedNet)));

    const investorExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${investor.token}`);
    const debit = investorExtrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes(duplicataId));
    expect(debit).toBeTruthy();
    expect(debit.isPositive).toBe(false);
    expect(debit.valorFmt.replace(/\D/g, '')).toBe('10000');
  });
});

describe('real settlement on a mercado secundário resale', () => {
  it('deducts the fee from the reselling investor, not the original cedente', async () => {
    const seller = await registerInvestidor();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${seller.token}`);
    const buyable = market.body.offers.find((o: { canBuy: boolean }) => o.canBuy);
    await request(app).post(`/api/market/${buyable.id}/buy`).set('Authorization', `Bearer ${seller.token}`);

    const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
    const position = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === buyable.id);
    const listRes = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ purchaseId: position.purchaseId, askingValor: '2.000' });
    const listing = listRes.body.market.find((l: { duplicataId: string }) => l.duplicataId === buyable.id);

    const buyer = await registerInvestidor();
    await request(app).post(`/api/secundario/${listing.id}/comprar`).set('Authorization', `Bearer ${buyer.token}`);

    const fee = platformFee(2000);
    const expectedNet = 2000 - fee;

    const sellerExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${seller.token}`);
    const credit = sellerExtrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes('mercado secundário') && e.isPositive);
    expect(credit).toBeTruthy();
    expect(credit.valorFmt.replace(/\D/g, '')).toBe(String(Math.round(expectedNet)));

    const buyerExtrato = await request(app).get('/api/account').set('Authorization', `Bearer ${buyer.token}`);
    const debit = buyerExtrato.body.extrato.find((e: { descricao: string }) => e.descricao.includes('mercado secundário') && !e.isPositive);
    expect(debit).toBeTruthy();
    expect(debit.valorFmt.replace(/\D/g, '')).toBe('2000');
  });
});
