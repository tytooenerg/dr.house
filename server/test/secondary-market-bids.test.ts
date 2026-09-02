import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { fmtBRL } from '../src/lib/format.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-bid-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

// DD/MM/YYYY -> Date, matching lib/format.ts's parseFlexibleDate for the same field.
function parseDataBr(value: string): Date {
  const [d, m, y] = value.split('/');
  return new Date(`${y}-${m}-${d}`);
}

// Buys one still-available primary offer and lists it on the secondary market, returning
// the listing id — the shared setup every bid test in this file starts from. Must still be
// unmatured (some seeded demo offers carry a vencimento already in the past relative to
// "today" in this sandbox's fixed system clock) — a matured position can be bought but,
// correctly, can never be listed for resale (lib/resaleCore.ts viewMyResalablePositions).
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

describe('secondary market — bids (order depth)', () => {
  it('shows the best active bid on the market view, and a new bid from the same bidder replaces the old one', async () => {
    const { listingId } = await sellerWithListing('10.000');
    const bidder = await registerInvestidor();

    const first = await request(app).post(`/api/secundario/${listingId}/lances`).set('Authorization', `Bearer ${bidder.token}`).send({ valor: '8.000' });
    expect(first.status).toBe(200);
    let listing = first.body.market.find((l: { id: number }) => l.id === listingId);
    expect(listing.melhorLanceFmt).toBe(fmtBRL(8000));

    const second = await request(app).post(`/api/secundario/${listingId}/lances`).set('Authorization', `Bearer ${bidder.token}`).send({ valor: '9.000' });
    expect(second.status).toBe(200);
    listing = second.body.market.find((l: { id: number }) => l.id === listingId);
    expect(listing.melhorLanceFmt).toBe(fmtBRL(9000));
  });

  it('lets a bidder cancel their own active bid', async () => {
    const { listingId } = await sellerWithListing('10.000');
    const bidder = await registerInvestidor();
    const bidRes = await request(app).post(`/api/secundario/${listingId}/lances`).set('Authorization', `Bearer ${bidder.token}`).send({ valor: '7.500' });
    const bidId = bidRes.body.meusLances[0].id;

    const cancel = await request(app).post(`/api/secundario/lances/${bidId}/cancelar`).set('Authorization', `Bearer ${bidder.token}`);
    expect(cancel.status).toBe(200);
    const listing = cancel.body.market.find((l: { id: number }) => l.id === listingId);
    expect(listing.melhorLanceFmt).toBeNull();
  });

  it('seller can accept a bid — the trade executes at the bid value, not the asking price', async () => {
    const { seller, duplicataId, listingId } = await sellerWithListing('10.000');
    const bidder = await registerInvestidor();
    await request(app).post(`/api/secundario/${listingId}/lances`).set('Authorization', `Bearer ${bidder.token}`).send({ valor: '6.500' });

    const sellerView = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
    const myListing = sellerView.body.meusAnuncios.find((a: { id: number }) => a.id === listingId);
    expect(myListing.lances).toHaveLength(1);
    expect(myListing.lances[0].valorFmt).toBe(fmtBRL(6500));

    const accept = await request(app).post(`/api/secundario/lances/${myListing.lances[0].id}/aceitar`).set('Authorization', `Bearer ${seller.token}`);
    expect(accept.status).toBe(200);
    expect(accept.body.market.some((l: { id: number }) => l.id === listingId)).toBe(false);

    const buyerView = await request(app).get('/api/secundario').set('Authorization', `Bearer ${bidder.token}`);
    const position = buyerView.body.minhasPosicoes.find((p: { duplicataId: string }) => p.duplicataId === duplicataId);
    expect(position.valorPagoFmt).toBe(fmtBRL(6500));
  });

  it('seller can reject a bid — the listing stays active and the bidder is notified', async () => {
    const { seller, listingId } = await sellerWithListing('10.000');
    const bidder = await registerInvestidor();
    await request(app).post(`/api/secundario/${listingId}/lances`).set('Authorization', `Bearer ${bidder.token}`).send({ valor: '5.000' });

    const sellerView = await request(app).get('/api/secundario').set('Authorization', `Bearer ${seller.token}`);
    const myListing = sellerView.body.meusAnuncios.find((a: { id: number }) => a.id === listingId);
    const bidId = myListing.lances[0].id;

    const reject = await request(app).post(`/api/secundario/lances/${bidId}/recusar`).set('Authorization', `Bearer ${seller.token}`);
    expect(reject.status).toBe(200);
    expect(reject.body.market.some((l: { id: number }) => l.id === listingId)).toBe(true);

    const buyerView = await request(app).get('/api/secundario').set('Authorization', `Bearer ${bidder.token}`);
    const myBid = buyerView.body.meusLances.find((b: { id: number }) => b.id === bidId);
    expect(myBid.status).toBe('recusado');
  });

  it('refuses to let anyone but the listing owner accept or reject a bid', async () => {
    const { listingId } = await sellerWithListing('10.000');
    const bidder = await registerInvestidor();
    const bidRes = await request(app).post(`/api/secundario/${listingId}/lances`).set('Authorization', `Bearer ${bidder.token}`).send({ valor: '4.000' });
    const bidId = bidRes.body.meusLances[0].id;

    const stranger = await registerInvestidor();
    const accept = await request(app).post(`/api/secundario/lances/${bidId}/aceitar`).set('Authorization', `Bearer ${stranger.token}`);
    expect(accept.status).toBe(404);
    const reject = await request(app).post(`/api/secundario/lances/${bidId}/recusar`).set('Authorization', `Bearer ${stranger.token}`);
    expect(reject.status).toBe(404);
  });
});

// Client-side sort/filter on the market list (SecundarioPage.tsx) relies on a raw numeric
// `valor` field on each listing view, not just the formatted `precoFmt` string — this
// covers the server side of that: the field exists and matches what was actually asked.
describe('secondary market — listing view carries a raw numeric valor', () => {
  it('exposes valor as the numeric asking price, not just precoFmt', async () => {
    const { listingId } = await sellerWithListing('12.345');
    const viewer = await registerInvestidor();
    const res = await request(app).get('/api/secundario').set('Authorization', `Bearer ${viewer.token}`);
    const listing = res.body.market.find((l: { id: number }) => l.id === listingId);
    expect(listing.valor).toBe(12345);
    expect(listing.precoFmt).toBe(fmtBRL(12345));
  });
});
