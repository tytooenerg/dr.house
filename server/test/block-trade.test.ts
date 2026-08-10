import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb, updateKybForm } from '../src/db/users.js';
import { fmtBRL } from '../src/lib/format.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-block-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

// A block trade buyer needs a declared patrimônio líquido above the institutional
// threshold (lib/blockTrade.ts INSTITUTIONAL_PL_THRESHOLD) — same KYB field every
// investidor account already fills in, just at a size that clears the bar.
async function registerInstitutionalBuyer() {
  const buyer = await registerInvestidor();
  updateKybForm(buyer.userId, 'pl', '15.000.000');
  return buyer;
}

// DD/MM/YYYY -> Date, matching lib/format.ts's parseFlexibleDate for the same field.
function parseDataBr(value: string): Date {
  const [d, m, y] = value.split('/');
  return new Date(`${y}-${m}-${d}`);
}

// Some seeded demo offers carry a vencimento already in the past relative to "today" in
// this sandbox's fixed system clock — buyable, but (correctly) never resale-listable.
async function sellerWithListing(askingValor: string) {
  const seller = await registerInvestidor();
  const market = await request(app).get('/api/market').set('Authorization', `Bearer ${seller.token}`);
  const buyable = market.body.offers.find((o: { canBuy: boolean; vencimento: string }) => o.canBuy && parseDataBr(o.vencimento).getTime() > Date.now());
  await request(app).post(`/api/market/${buyable.id}/buy`).set('Authorization', `Bearer ${seller.token}`);
  const secundario = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
  const position = secundario.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === buyable.id);
  const listRes = await request(app)
    .post('/api/secundario/listar')
    .set('Authorization', `Bearer ${seller.token}`)
    .send({ purchaseId: position.purchaseId, askingValor });
  const listing = listRes.body.market.find((l: { duplicataId: string }) => l.duplicataId === buyable.id);
  return { seller, duplicataId: buyable.id as string, listingId: listing.id as number };
}

describe('institutional block trade', () => {
  it('refuses a regular (non-institutional-PL) investor account', async () => {
    const buyer = await registerInvestidor(); // default KYB pl ('5.000.000' in defaultSettings) is below the threshold
    const res = await request(app).post('/api/secundario/block-trade').set('Authorization', `Bearer ${buyer.token}`).send({ valorMaximo: '1.000.000' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_institutional');
  });

  it('refuses a budget below the minimum block trade size', async () => {
    const buyer = await registerInstitutionalBuyer();
    const res = await request(app).post('/api/secundario/block-trade').set('Authorization', `Bearer ${buyer.token}`).send({ valorMaximo: '10.000' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('reports no_match when the criteria filter out every candidate', async () => {
    const buyer = await registerInstitutionalBuyer();
    // No real duplicata clears score 100 — a deliberately unmatchable filter, independent
    // of whatever listings happen to be active from other tests in this file.
    const res = await request(app).post('/api/secundario/block-trade').set('Authorization', `Bearer ${buyer.token}`).send({ valorMaximo: '1.000.000', scoreMin: 100 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('no_match');
  });

  it('sweeps multiple active listings in one transaction, at each seller\'s exact posted price', async () => {
    const listingA = await sellerWithListing('180.000');
    const listingB = await sellerWithListing('150.000');
    const buyer = await registerInstitutionalBuyer();

    const res = await request(app).post('/api/secundario/block-trade').set('Authorization', `Bearer ${buyer.token}`).send({ valorMaximo: '2.000.000' });
    expect(res.status).toBe(200);
    expect(res.body.quantidade).toBeGreaterThanOrEqual(2);
    expect(res.body.itens.some((i: { duplicataId: string }) => i.duplicataId === listingA.duplicataId)).toBe(true);
    expect(res.body.itens.some((i: { duplicataId: string }) => i.duplicataId === listingB.duplicataId)).toBe(true);
    // Each seller receives exactly their posted asking price — the block trade discount
    // applies to the platform's own fee, never as a markdown on what a seller was owed.
    const itemA = res.body.itens.find((i: { duplicataId: string }) => i.duplicataId === listingA.duplicataId);
    const itemB = res.body.itens.find((i: { duplicataId: string }) => i.duplicataId === listingB.duplicataId);
    expect(itemA.valorFmt).toBe(fmtBRL(180000));
    expect(itemB.valorFmt).toBe(fmtBRL(150000));
    expect(res.body.descontoPct).toBeGreaterThan(0);

    // Both swept listings are gone from the market and each seller's own listing shows sold.
    expect(res.body.market.some((l: { id: number }) => l.id === listingA.listingId)).toBe(false);
    expect(res.body.market.some((l: { id: number }) => l.id === listingB.listingId)).toBe(false);
    const sellerAView = await request(app).get('/api/secundario').set('Authorization', `Bearer ${listingA.seller.token}`);
    expect(sellerAView.body.meusAnuncios.find((a: { id: number }) => a.id === listingA.listingId).status).toBe('vendido');

    // The buyer now holds both positions, and the block trade shows up in their history.
    const buyerView = await request(app).get('/api/secundario').set('Authorization', `Bearer ${buyer.token}`);
    expect(buyerView.body.minhasPosicoes.some((p: { duplicataId: string }) => p.duplicataId === listingA.duplicataId)).toBe(true);
    expect(buyerView.body.minhasPosicoes.some((p: { duplicataId: string }) => p.duplicataId === listingB.duplicataId)).toBe(true);
    expect(buyerView.body.meusBlockTrades).toHaveLength(1);
    expect(buyerView.body.meusBlockTrades[0].id).toBe(res.body.blockTradeId);
  });

  it('a block trade buyer cannot sweep their own listing', async () => {
    const { seller, duplicataId, listingId } = await sellerWithListing('180.000');
    updateKybForm(seller.userId, 'pl', '15.000.000');
    const res = await request(app).post('/api/secundario/block-trade').set('Authorization', `Bearer ${seller.token}`).send({ valorMaximo: '1.000.000' });
    // Own listing is excluded from candidates — either genuinely no other match exists at
    // all (409), or it succeeds while still never including their own listing.
    if (res.status === 200) {
      expect(res.body.itens.some((i: { duplicataId: string }) => i.duplicataId === duplicataId)).toBe(false);
      const sellerView = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
      expect(sellerView.body.meusAnuncios.find((a: { id: number }) => a.id === listingId).status).toBe('ativo');
    } else {
      expect(res.status).toBe(409);
    }
  });
});
