import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { createDuplicata } from '../src/db/duplicatas.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerInvestidor() {
  const email = `inv-explain-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor Explicação', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  return { token: res.body.token as string };
}

describe('Funding explainability — "Por que essa oferta?"', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/market/does-not-exist/explicacao');
    expect(res.status).toBe(401);
  });

  it('404s for a nonexistent duplicata', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).get('/api/market/DUP-NOPE-9999/explicacao').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('explains a real offer with the same rating/score used to price it, plus liquidity and seguro factors', async () => {
    const { token } = await registerInvestidor();
    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: 'Cedente Explicação',
      sacadoNome: 'Grupo Atlas Varejo', // seeded score 84 → rating AA
      sacadoCnpj: '12.345.678/0001-90',
      valor: 30000,
      vencimento: '2026-12-31',
      emissao: '10/08/2026',
      status: 'no_mercado',
      lastroPct: 100,
      seguro: true,
      desagio: '1,8% a.m.',
    });

    const res = await request(app).get(`/api/market/${d.id}/explicacao`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.duplicataId).toBe(d.id);
    expect(res.body.rating).toBe('AA');
    expect(res.body.factors.length).toBeGreaterThanOrEqual(5);
    expect(res.body.factors.some((f: { label: string }) => f.label.includes('Score'))).toBe(true);
    expect(res.body.factors.some((f: { label: string }) => f.label.includes('mercado'))).toBe(true);
    expect(res.body.factors.some((f: { label: string }) => f.label === 'Seguro contratado' && f.valor.startsWith('sim'))).toBe(true);
    expect(typeof res.body.resumo).toBe('string');
    expect(res.body.resumo.length).toBeGreaterThan(10);
    // No ANTHROPIC_API_KEY in the test environment — narrativaIA must honestly fall back to null.
    expect(res.body.narrativaIA).toBeNull();
  });
});
