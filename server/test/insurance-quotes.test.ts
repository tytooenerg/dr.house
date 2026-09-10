import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { computeInsurerQuotePct, listInsuranceQuotes } from '../src/lib/insuranceQuotes.js';
import { credenciarInvestidor } from './helpers/investidor.js';
import { garantirLeilao } from './helpers/auction.js';
import { vencimentoFuturo } from './helpers/datas.js';

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
  credenciarInvestidor(res.body.user.id);
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

/**
 * Uma oferta que ESTE teste criou e mais ninguém toca.
 *
 * Antes, os dois testes assíncronos daqui pegavam `offers[0]` e "a primeira oferta sem
 * seguro" do marketplace — que é compartilhado entre todos os arquivos de teste. Bastava
 * outro arquivo segurar aquela mesma duplicata no intervalo entre o GET e o POST pra este
 * teste falhar sem nenhum bug envolvido (aconteceu ~1 vez em 10 execuções). O problema nunca
 * foi o timing: era o teste afirmar coisas sobre um recurso que não era dele.
 */
async function ofertaPropria(valor = '84.500') {
  const ced = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente', email: `ced-quotes-${unique()}@example.com`, password: 'senha123', companyName: `Cedente Quotes ${unique()}`, role: 'cedente' });

  let duplicataId = '';
  for (let i = 0; i < 8 && !duplicataId; i++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${ced.body.token}`)
      .send({ sacado: `Sacado Quotes ${unique()}`, cnpj: '55.444.333/0001-22', valor, vencimento: vencimentoFuturo(), seguro: false, nfAnexada: true });
    if (res.status === 200) duplicataId = res.body.duplicataId;
  }
  expect(duplicataId).toBeTruthy();
  garantirLeilao(duplicataId);
  return duplicataId;
}

describe('Insurance quotes — real per-insurer differentiation', () => {
  it("Too Seguros quotes tighter for a high-score sacado than a low-score one — it isn't a flat rate", () => {
    const highScore = computeInsurerQuotePct('too', { score: 90, valor: 50000, vencimento: vencimentoFuturo() });
    const lowScore = computeInsurerQuotePct('too', { score: 40, valor: 50000, vencimento: vencimentoFuturo() });
    expect(highScore).toBeLessThan(lowScore);
  });

  it('Pottencial surcharges a large ticket relative to a small one', () => {
    const small = computeInsurerQuotePct('pottencial', { score: 70, valor: 20000, vencimento: vencimentoFuturo() });
    const large = computeInsurerQuotePct('pottencial', { score: 70, valor: 200000, vencimento: vencimentoFuturo() });
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
    const quotes = listInsuranceQuotes({ score: 84, valor: 84500, vencimento: vencimentoFuturo() });
    expect(quotes).toHaveLength(3);
    expect(quotes[0].premioPct).toBeLessThanOrEqual(quotes[1].premioPct);
    expect(quotes[1].premioPct).toBeLessThanOrEqual(quotes[2].premioPct);
    expect(quotes.filter((q) => q.recommended)).toHaveLength(1);
    expect(quotes[0].recommended).toBe(true);
  });

  it('the marketplace exposes live per-offer quotes, not one static catalog for every offer', async () => {
    const { token } = await registerInvestidor();
    const duplicataId = await ofertaPropria();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const offer = market.body.offers.find((o: { id: string }) => o.id === duplicataId);
    expect(offer).toBeTruthy();
    expect(offer.insurerOptions).toHaveLength(3);
    expect(offer.insurerOptions.some((o: { recommended: boolean }) => o.recommended)).toBe(true);
    // Real formula-driven premium, not the old flat 0.55%/0.60%/0.68% for every offer.
    const expected = computeInsurerQuotePct('too', offer).toFixed(2).replace('.', ',') + '%';
    const tooQuote = offer.insurerOptions.find((o: { key: string }) => o.key === 'too');
    expect(tooQuote.premioFmt).toBe(expected);
  });

  it('insurerInfo keeps showing the premium actually charged, not a fresh recomputation, once insured', async () => {
    const { token } = await registerInvestidor();
    const duplicataId = await ofertaPropria();
    const market = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    const offer = market.body.offers.find((o: { id: string }) => o.id === duplicataId);
    expect(offer.insurerInfo).toBeFalsy();
    const chargedPct = computeInsurerQuotePct('too', offer);

    const insure = await request(app).post(`/api/market/${offer.id}/insure`).set('Authorization', `Bearer ${token}`).send({ key: 'too' });
    expect(insure.status).toBe(200);
    const insured = insure.body.offers.find((o: { id: string }) => o.id === offer.id);
    expect(insured.insurerInfo.premioFmt).toBe(chargedPct.toFixed(2).replace('.', ',') + '%');
  });
});
