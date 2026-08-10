import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb } from '../src/db/users.js';
import { computeInsurerQuotePct, listInsuranceQuotes } from '../src/lib/insuranceQuotes.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-quotes-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

describe('Insurance quotes — real per-insurer differentiation', () => {
  it("Too Seguros quotes tighter for a high-score sacado than a low-score one — it isn't a flat rate", () => {
    const highScore = computeInsurerQuotePct('too', { score: 90, valor: 50000, vencimento: '2026-12-31' });
    const lowScore = computeInsurerQuotePct('too', { score: 40, valor: 50000, vencimento: '2026-12-31' });
    expect(highScore).toBeLessThan(lowScore);
  });

  it('Pottencial surcharges a large ticket relative to a small one', () => {
    const small = computeInsurerQuotePct('pottencial', { score: 70, valor: 20000, vencimento: '2026-12-31' });
    const large = computeInsurerQuotePct('pottencial', { score: 70, valor: 200000, vencimento: '2026-12-31' });
    expect(large).toBeGreaterThan(small);
  });

  it('Junto discounts a near-term maturity relative to a far one', () => {
    const soon = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const far = new Date(Date.now() + 200 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const nearTerm = computeInsurerQuotePct('junto', { score: 70, valor: 50000, vencimento: soon });
    const longTerm = computeInsurerQuotePct('junto', { score: 70, valor: 50000, vencimento: far });
    expect(nearTerm).toBeLessThan(longTerm);
  });

  it('listInsuranceQuotes sorts cheapest first and flags exactly one as recommended', () => {
    const quotes = listInsuranceQuotes({ score: 84, valor: 84500, vencimento: '2026-12-31' });
    expect(quotes).toHaveLength(3);
    expect(quotes[0].premioPct).toBeLessThanOrEqual(quotes[1].premioPct);
    expect(quotes[1].premioPct).toBeLessThanOrEqual(quotes[2].premioPct);
    expect(quotes.filter((q) => q.recommended)).toHaveLength(1);
    expect(quotes[0].recommended).toBe(true);
  });

  it('the marketplace exposes live per-offer quotes, not one static catalog for every offer', async () => {
    const { token } = await registerInvestidor();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const offer = market.body.offers[0];
    expect(offer.insurerOptions).toHaveLength(3);
    expect(offer.insurerOptions.some((o: { recommended: boolean }) => o.recommended)).toBe(true);
    // Real formula-driven premium, not the old flat 0.55%/0.60%/0.68% for every offer.
    const expected = computeInsurerQuotePct('too', offer).toFixed(2).replace('.', ',') + '%';
    const tooQuote = offer.insurerOptions.find((o: { key: string }) => o.key === 'too');
    expect(tooQuote.premioFmt).toBe(expected);
  });

  it('insurerInfo keeps showing the premium actually charged, not a fresh recomputation, once insured', async () => {
    const { token } = await registerInvestidor();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const offer = market.body.offers.find((o: { insurerInfo: unknown }) => !o.insurerInfo);
    const chargedPct = computeInsurerQuotePct('too', offer);

    const insure = await request(app).post(`/api/market/${offer.id}/insure`).set('Authorization', `Bearer ${token}`).send({ key: 'too' });
    expect(insure.status).toBe(200);
    const insured = insure.body.offers.find((o: { id: string }) => o.id === offer.id);
    expect(insured.insurerInfo.premioFmt).toBe(chargedPct.toFixed(2).replace('.', ',') + '%');
  });
});
