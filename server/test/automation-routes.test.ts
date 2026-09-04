import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb, updateSubscription } from '../src/db/users.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerProInvestidor() {
  const email = `inv-auto-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  updateSubscription(res.body.user.id, { plan: 'pro', subscriptionStatus: 'active' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

// AutomacaoPage.tsx keeps the full AutomationData shape as its whole page state and, on
// every mutation, does `api.post(...).then(setData)` — replacing all of it, never merging
// a partial response in. Every route below used to respond with only the field it had just
// changed (e.g. `{ autoBidRules: ... }`); the client would then hold a `data` object with
// every *other* field `undefined`, and the very next render (e.g. `data.diversification.AA`)
// threw and took the whole page down behind the ErrorBoundary — exactly what an investor
// hit typing a value into "Taxa máxima" or "Score mínimo aceito". Assert every mutation
// route returns the complete shape the GET route does, not just its own slice of it.
const FULL_SHAPE_KEYS = [
  'autoBidEnabled',
  'autoBidRules',
  'ladder',
  'diversification',
  'sectorDiversification',
  'autoBidActivity',
  'marketMakerEnabled',
  'marketMakerMaxExposicao',
  'marketMakerMinScore',
] as const;

describe('Automação de Lances routes respond with the full page shape, not a partial patch', () => {
  it('POST /automacao/toggle', async () => {
    const inv = await registerProInvestidor();
    const res = await request(app).post('/api/automacao/toggle').set('Authorization', `Bearer ${inv.token}`);
    expect(res.status).toBe(200);
    for (const key of FULL_SHAPE_KEYS) expect(res.body).toHaveProperty(key);
  });

  it('POST /automacao/rule', async () => {
    const inv = await registerProInvestidor();
    const res = await request(app)
      .post('/api/automacao/rule')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ field: 'scoreMin', value: 'B' });
    expect(res.status).toBe(200);
    expect(res.body.autoBidRules.scoreMin).toBe('B');
    for (const key of FULL_SHAPE_KEYS) expect(res.body).toHaveProperty(key);
  });

  // Achado corrigido: "taxa máxima a oferecer" era um teto de risco vestigial (o preço
  // sempre foi calculado pelo servidor, nunca proposto pelo investidor) — substituído pela
  // escada de lances por classe de rating (server/src/lib/autoBidLadder.ts).
  it('POST /automacao/rule recusa o campo taxaMax removido', async () => {
    const inv = await registerProInvestidor();
    const res = await request(app)
      .post('/api/automacao/rule')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ field: 'taxaMax', value: '3,5' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('POST /automacao/ladder', async () => {
    const inv = await registerProInvestidor();
    const res = await request(app)
      .post('/api/automacao/ladder')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ rating: 'AA', field: 'taxaInicial', value: 3 });
    expect(res.status).toBe(200);
    expect(res.body.ladder.AA.taxaInicial).toBe(3);
    for (const key of FULL_SHAPE_KEYS) expect(res.body).toHaveProperty(key);
  });

  it('POST /automacao/diversification', async () => {
    const inv = await registerProInvestidor();
    const res = await request(app)
      .post('/api/automacao/diversification')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ cls: 'AA', value: 40 });
    expect(res.status).toBe(200);
    expect(res.body.diversification.AA).toBe(40);
    for (const key of FULL_SHAPE_KEYS) expect(res.body).toHaveProperty(key);
  });

  it('POST /automacao/sector-diversification', async () => {
    const inv = await registerProInvestidor();
    const res = await request(app)
      .post('/api/automacao/sector-diversification')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ cls: 'varejo', value: 30 });
    expect(res.status).toBe(200);
    expect(res.body.sectorDiversification.varejo).toBe(30);
    for (const key of FULL_SHAPE_KEYS) expect(res.body).toHaveProperty(key);
  });

  it('POST /automacao/market-maker/toggle', async () => {
    const inv = await registerProInvestidor();
    const res = await request(app).post('/api/automacao/market-maker/toggle').set('Authorization', `Bearer ${inv.token}`);
    expect(res.status).toBe(200);
    for (const key of FULL_SHAPE_KEYS) expect(res.body).toHaveProperty(key);
  });

  it('POST /automacao/market-maker/rule', async () => {
    const inv = await registerProInvestidor();
    const res = await request(app)
      .post('/api/automacao/market-maker/rule')
      .set('Authorization', `Bearer ${inv.token}`)
      .send({ field: 'marketMakerMinScore', value: 'A' });
    expect(res.status).toBe(200);
    expect(res.body.marketMakerMinScore).toBe('A');
    for (const key of FULL_SHAPE_KEYS) expect(res.body).toHaveProperty(key);
  });
});
