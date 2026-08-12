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

async function registerCedente() {
  const email = `ced-cashflow-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Cashflow', email, password: 'senha123', companyName: `Empresa Cashflow ${unique()}`, role: 'cedente' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

describe('AI CFO — cashflow forecast', () => {
  it('requires cedente role', async () => {
    const res = await request(app).post('/api/auth/register').send({
      nome: 'Investidor',
      email: `inv-cashflow-${unique()}@example.com`,
      password: 'senha123',
      companyName: `Fundo ${unique()}`,
      role: 'investidor',
    });
    const forecast = await request(app).get('/api/cashflow/forecast').set('Authorization', `Bearer ${res.body.token}`);
    expect(forecast.status).toBe(403);
  });

  it('returns zeroed scenarios for a cedente with no receivables or payables', async () => {
    const { token } = await registerCedente();
    const res = await request(app).get('/api/cashflow/forecast').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.disponivelParaAntecipacao).toBe(0);
    expect(res.body.scenarios).toHaveLength(3);
    for (const s of res.body.scenarios) {
      for (const p of s.points) expect(p.saldoProjetado).toBe(0);
    }
    expect(res.body.insights[0].tipo).toBe('ok');
  });

  it('counts an aprovada/no_mercado duplicata as available to antecipar, and includes it in the 30d horizon', async () => {
    const { token, userId } = await registerCedente();
    createDuplicata({
      cedenteId: userId,
      cedenteNome: 'Cedente Cashflow',
      sacadoNome: 'Sacado Cashflow',
      sacadoCnpj: '',
      valor: 40000,
      vencimento: isoDaysFromNow(20),
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });

    const res = await request(app).get('/api/cashflow/forecast').set('Authorization', `Bearer ${token}`);
    expect(res.body.disponivelParaAntecipacao).toBeGreaterThan(0);
    const base = res.body.scenarios.find((s: { scenario: string }) => s.scenario === 'base');
    const point30 = base.points.find((p: { days: number }) => p.days === 30);
    expect(point30.receitaEsperadaFmt).not.toBe('R$ 0,00');
  });

  it('projects a deficit when payables due soon exceed expected receivables, and recommends antecipação', async () => {
    const { token, userId } = await registerCedente();
    createDuplicata({
      cedenteId: userId,
      cedenteNome: 'Cedente Cashflow',
      sacadoNome: 'Sacado Cashflow Déficit',
      sacadoCnpj: '',
      valor: 40000,
      vencimento: isoDaysFromNow(20),
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
    await request(app)
      .post('/api/payables')
      .set('Authorization', `Bearer ${token}`)
      .send({ descricao: 'Folha grande', categoria: 'folha', valor: 200000, vencimento: isoDaysFromNow(5) });

    const res = await request(app).get('/api/cashflow/forecast').set('Authorization', `Bearer ${token}`);
    const base = res.body.scenarios.find((s: { scenario: string }) => s.scenario === 'base');
    const point7 = base.points.find((p: { days: number }) => p.days === 7);
    expect(point7.deficit).toBe(true);
    expect(res.body.insights.some((i: { tipo: string }) => i.tipo === 'deficit')).toBe(true);
    expect(res.body.insights.some((i: { tipo: string }) => i.tipo === 'antecipacao_recomendada')).toBe(true);
  });

  it('projects a worse (or equal) balance in the pessimista scenario than in the otimista scenario', async () => {
    const { token, userId } = await registerCedente();
    createDuplicata({
      cedenteId: userId,
      cedenteNome: 'Cedente Cashflow',
      sacadoNome: 'Sacado Cashflow Cenários',
      sacadoCnpj: '',
      valor: 60000,
      vencimento: isoDaysFromNow(10),
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });

    const res = await request(app).get('/api/cashflow/forecast').set('Authorization', `Bearer ${token}`);
    const pessimista = res.body.scenarios.find((s: { scenario: string }) => s.scenario === 'pessimista');
    const otimista = res.body.scenarios.find((s: { scenario: string }) => s.scenario === 'otimista');
    const p30Pess = pessimista.points.find((p: { days: number }) => p.days === 30).saldoProjetado;
    const p30Otim = otimista.points.find((p: { days: number }) => p.days === 30).saldoProjetado;
    expect(p30Pess).toBeLessThanOrEqual(p30Otim);
  });
});
