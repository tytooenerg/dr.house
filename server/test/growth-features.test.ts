import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { createDuplicata } from '../src/db/duplicatas.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-growth-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function registerCedente(referralCode?: string) {
  const email = `ced-growth-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente', email, password: 'senha123', companyName: `Cedente ${unique()}`, role: 'cedente', referralCode });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

describe('secondary market', () => {
  it('lets an investor list a purchased position and another investor buy it', async () => {
    const seller = await registerInvestidor();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${seller.token}`);
    const buyable = market.body.offers.find((o: { canBuy: boolean }) => o.canBuy);
    expect(buyable).toBeTruthy();
    await request(app).post(`/api/market/${buyable.id}/buy`).set('Authorization', `Bearer ${seller.token}`);

    const sellerSecundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
    const position = sellerSecundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === buyable.id);
    expect(position).toBeTruthy();

    const listRes = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${seller.token}`)
      .send({ purchaseId: position.purchaseId, askingValor: '1.000' });
    expect(listRes.status).toBe(200);
    const listing = listRes.body.market.find((l: { duplicataId: string }) => l.duplicataId === buyable.id);
    expect(listing).toBeTruthy();

    const buyer = await registerInvestidor();
    const buyRes = await request(app).post(`/api/secundario/${listing.id}/comprar`).set('Authorization', `Bearer ${buyer.token}`);
    expect(buyRes.status).toBe(200);
    expect(buyRes.body.market.some((l: { id: number }) => l.id === listing.id)).toBe(false);

    const buyerSecundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${buyer.token}`);
    expect(buyerSecundario.body.minhasPosicoes.some((p: { duplicataId: string }) => p.duplicataId === buyable.id)).toBe(true);

    const sellerAfter = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
    const soldListing = sellerAfter.body.meusAnuncios.find((a: { id: number }) => a.id === listing.id);
    expect(soldListing.status).toBe('vendido');
  });

  it('forbids buying your own listing', async () => {
    const investor = await registerInvestidor();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${investor.token}`);
    const buyable = market.body.offers.find((o: { canBuy: boolean }) => o.canBuy);
    await request(app).post(`/api/market/${buyable.id}/buy`).set('Authorization', `Bearer ${investor.token}`);
    const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${investor.token}`);
    const position = secundario.body.minhasPosicoes[0];
    const listRes = await request(app)
      .post('/api/secundario/listar')
      .set('Authorization', `Bearer ${investor.token}`)
      .send({ purchaseId: position.purchaseId, askingValor: '1.000' });
    const listingId = listRes.body.market[0].id;

    const res = await request(app).post(`/api/secundario/${listingId}/comprar`).set('Authorization', `Bearer ${investor.token}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('own_listing');
  });
});

describe('cestas de investimento', () => {
  it('greedily allocates a large budget across offers matching the conservadora profile', async () => {
    const investor = await registerInvestidor();
    const res = await request(app)
      .post('/api/cestas/investir')
      .set('Authorization', `Bearer ${investor.token}`)
      .send({ cesta: 'conservadora', valor: '999.999.999' });
    expect(res.status).toBe(200);
    expect(res.body.comprados.length).toBeGreaterThan(0);
    for (const c of res.body.comprados) {
      expect(['AA', 'A']).toContain(c.rating);
    }
  });

  it('rejects a non-investidor role', async () => {
    const { token } = await registerCedente();
    const res = await request(app).post('/api/cestas/investir').set('Authorization', `Bearer ${token}`).send({ cesta: 'conservadora', valor: '1.000' });
    expect(res.status).toBe(403);
  });
});

describe('referral program', () => {
  it('tracks a referred signup and grants the referrer a bonus emission slot', async () => {
    const referrer = await registerCedente();
    const before = await request(app).get('/api/referral').set('Authorization', `Bearer ${referrer.token}`);
    expect(before.body.bonusEmissoesMensais).toBe(0);

    await registerCedente(before.body.code);

    const after = await request(app).get('/api/referral').set('Authorization', `Bearer ${referrer.token}`);
    expect(after.body.bonusEmissoesMensais).toBe(1);
    expect(after.body.indicados.length).toBe(1);

    for (let i = 0; i < 5; i++) {
      createDuplicata({
        cedenteId: referrer.userId,
        cedenteNome: 'Cedente',
        sacadoNome: 'Sacado X',
        sacadoCnpj: '',
        valor: 1000,
        vencimento: '2026-12-31',
        emissao: new Date().toLocaleDateString('pt-BR'),
        status: 'aprovada',
        lastroPct: 100,
        seguro: false,
        registro: 'ESC-TEST',
      });
    }
    let lastStatus = 0;
    for (let attempt = 0; attempt < 8 && lastStatus !== 200; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${referrer.token}`)
        .send({ sacado: 'Grupo Atlas Varejo', cnpj: '', valor: '1.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      lastStatus = res.status;
      expect(lastStatus === 200 || lastStatus === 502).toBe(true);
    }
    expect(lastStatus).toBe(200);
  });
});

describe('public endpoints', () => {
  it('serves live-computed transparency stats with no auth', async () => {
    const res = await request(app).get('/api/public/stats');
    expect(res.status).toBe(200);
    expect(typeof res.body.totalDuplicatas).toBe('number');
    expect(res.body.volumeEmitidoFmt).toContain('R$');
  });

  it('serves the status page with no auth (empty history outside the running server process)', async () => {
    const res = await request(app).get('/api/public/status');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.history)).toBe(true);
  });

  it('simulates a rate with no auth, reusing the real emitirCore rate model', async () => {
    const res = await request(app).post('/api/public/simular').send({ sacado: 'Grupo Atlas Varejo', valor: '50.000', vencimento: '2026-12-31' });
    expect(res.status).toBe(200);
    expect(res.body.taxaEstimadaFmt).toMatch(/%/);
    expect(res.body.sacadoRecognized).toBe(true);
  });
});
