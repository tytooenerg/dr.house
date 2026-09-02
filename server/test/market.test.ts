import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';

beforeAll(async () => {
  await seedIfEmpty();
});

// KYB must be approved before an investidor can bid/buy — simulate the admin
// approval step directly so these tests aren't coupled to the back-office flow.
async function registerInvestidor() {
  const email = `inv-${Date.now()}-${Math.random().toString(16).slice(2)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Investidor', email, password: 'senha123', companyName: 'Fundo Teste', role: 'investidor' });
  approveKyb(res.body.user.id);
  return res.body.token as string;
}

describe('GET /api/market', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/market');
    expect(res.status).toBe(401);
  });

  it('lists the seeded marketplace offers for an authenticated user', async () => {
    const token = await registerInvestidor();
    const res = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.offers.length).toBeGreaterThan(0);
    const offer = res.body.offers[0];
    expect(offer).toHaveProperty('valorFmt');
    expect(offer).toHaveProperty('bids');
  });
});

describe('GET /api/market filters', () => {
  it('filters by setor, returning only offers with that sector', async () => {
    const token = await registerInvestidor();
    const all = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const withSetor = all.body.offers.find((o: { setor: string | null }) => o.setor);
    expect(withSetor).toBeTruthy();

    const res = await request(app).get(`/api/market?setor=${withSetor.setor}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.offers.length).toBeGreaterThan(0);
    for (const o of res.body.offers) expect(o.setor).toBe(withSetor.setor);

    const other = SETOR_KEYS.find((k) => k !== withSetor.setor)!;
    const excluded = await request(app).get(`/api/market?setor=${other}`).set('Authorization', `Bearer ${token}`);
    expect(excluded.body.offers.every((o: { setor: string | null }) => o.setor !== withSetor.setor)).toBe(true);
  });

  it('filters by rating', async () => {
    const token = await registerInvestidor();
    const all = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const rating = all.body.offers[0].rating as string;

    const res = await request(app).get(`/api/market?rating=${rating}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    for (const o of res.body.offers) expect(o.rating).toBe(rating);
  });

  it('filters by valor range (min,max)', async () => {
    const token = await registerInvestidor();
    const all = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const valores = all.body.offers.map((o: { valor: number }) => o.valor);
    const maxValor = Math.max(...valores);
    const half = Math.floor(maxValor / 2);

    const res = await request(app).get(`/api/market?valor=0,${half}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    for (const o of res.body.offers) expect(o.valor).toBeLessThanOrEqual(half);
  });

  it('filters by prazo range in days, excluding everything for an absurd range', async () => {
    const token = await registerInvestidor();
    const wide = await request(app).get('/api/market?prazo=0,100000').set('Authorization', `Bearer ${token}`);
    expect(wide.body.offers.length).toBeGreaterThan(0);

    const none = await request(app).get('/api/market?prazo=999999,9999999').set('Authorization', `Bearer ${token}`);
    expect(none.body.offers.length).toBe(0);
  });
});

const SETOR_KEYS = ['varejo', 'industria', 'construcao', 'servicos'];

describe('POST /api/market/:id/buy', () => {
  it('is forbidden for non-investidor roles', async () => {
    const cedenteEmail = `ced-${Date.now()}@example.com`;
    const reg = await request(app).post('/api/auth/register').send({ nome: 'Carlos Teste', email: cedenteEmail, password: 'senha123', companyName: 'C Ltda', role: 'cedente' });
    const token = reg.body.token as string;
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const offerId = market.body.offers[0].id;
    const res = await request(app).post(`/api/market/${offerId}/buy`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('allows an investidor to buy an unpurchased, non-contested offer, and blocks a second purchase', async () => {
    const token = await registerInvestidor();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const buyable = market.body.offers.find((o: { canBuy: boolean }) => o.canBuy);
    expect(buyable).toBeTruthy();

    const first = await request(app).post(`/api/market/${buyable.id}/buy`).set('Authorization', `Bearer ${token}`);
    expect(first.status).toBe(200);
    const boughtOffer = first.body.offers.find((o: { id: string }) => o.id === buyable.id);
    expect(boughtOffer.isBought).toBe(true);
    expect(boughtOffer.canBuy).toBe(false);

    const second = await request(app).post(`/api/market/${buyable.id}/buy`).set('Authorization', `Bearer ${token}`);
    expect(second.status).toBe(409);
  });

  it('shows up in Carteira & Histórico with real computed totals after a purchase', async () => {
    const token = await registerInvestidor();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const buyable = market.body.offers.find((o: { canBuy: boolean }) => o.canBuy);
    await request(app).post(`/api/market/${buyable.id}/buy`).set('Authorization', `Bearer ${token}`);

    const historico = await request(app).get('/api/historico').set('Authorization', `Bearer ${token}`);
    expect(historico.status).toBe(200);
    expect(historico.body.historico.length).toBeGreaterThan(0);
    expect(historico.body.totalInvestidoFmt).not.toBe('R$ 0');
  });
});

describe('POST /api/market/:id/insure', () => {
  it('rejects an unknown insurer key', async () => {
    const token = await registerInvestidor();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const offerId = market.body.offers[0].id;
    const res = await request(app).post(`/api/market/${offerId}/insure`).set('Authorization', `Bearer ${token}`).send({ key: 'not-a-real-insurer' });
    expect(res.status).toBe(400);
  });

  it('attaches a valid insurer to an offer', async () => {
    const token = await registerInvestidor();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const offerId = market.body.offers[0].id;
    const res = await request(app).post(`/api/market/${offerId}/insure`).set('Authorization', `Bearer ${token}`).send({ key: 'too' });
    expect(res.status).toBe(200);
    const offer = res.body.offers.find((o: { id: string }) => o.id === offerId);
    expect(offer.insurerInfo.key).toBe('too');
  });
});
