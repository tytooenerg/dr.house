import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { createDuplicata, createPurchase } from '../src/db/duplicatas.js';
import { upsertErpReceivables } from '../src/db/erpReceivables.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// AI CFO requires at least the Pro plan (feature "CFO fica atrás de Pro/Empresarial") —
// every test below exercises the forecast logic itself, not the plan gate, so it upgrades
// by default; the gate itself gets its own test below.
async function registerCedente(plan: 'basico' | 'pro' | 'empresarial' = 'pro') {
  const email = `ced-cashflow-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Cashflow', email, password: 'senha123', companyName: `Empresa Cashflow ${unique()}`, role: 'cedente' });
  const token = res.body.token as string;
  if (plan !== 'basico') await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan });
  return { token, userId: res.body.user.id as number };
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

  it('requires at least the Pro plan — a Básico cedente is blocked, a Pro cedente gets through', async () => {
    const { token: basicoToken } = await registerCedente('basico');
    const blocked = await request(app).get('/api/cashflow/forecast').set('Authorization', `Bearer ${basicoToken}`);
    expect(blocked.status).toBe(402);
    expect(blocked.body.requiredPlan).toBe('pro');

    const { token: proToken } = await registerCedente('pro');
    const allowed = await request(app).get('/api/cashflow/forecast').set('Authorization', `Bearer ${proToken}`);
    expect(allowed.status).toBe(200);
    // Empresarial-only fields stay null on Pro, with no upgrade-worthy data fabricated.
    expect(allowed.body.dre).toBeNull();
    expect(allowed.body.saldoBancarioReal).toBeNull();
    expect(allowed.body.benchmark).toBeNull();
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
    expect(point30.saldoProjetado).toBeGreaterThan(0);
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

  it('pessimista delays collection (slower-paying sacado), pushing a near-horizon receivable out of the 7d window', async () => {
    const { token, userId } = await registerCedente();
    createDuplicata({
      cedenteId: userId,
      cedenteNome: 'Cedente Cashflow',
      sacadoNome: 'Sacado Cashflow Atraso',
      sacadoCnpj: '',
      valor: 20000,
      vencimento: isoDaysFromNow(5), // inside the 7d horizon on time, outside it once delayed
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });

    const res = await request(app).get('/api/cashflow/forecast').set('Authorization', `Bearer ${token}`);
    const base = res.body.scenarios.find((s: { scenario: string }) => s.scenario === 'base');
    const pessimista = res.body.scenarios.find((s: { scenario: string }) => s.scenario === 'pessimista');
    const basePoint7 = base.points.find((p: { days: number }) => p.days === 7);
    const pessPoint7 = pessimista.points.find((p: { days: number }) => p.days === 7);
    // Base collects on time (day 5 <= 7); pessimista assumes the sacado pays 15 days late
    // (day 5 + 15 = 20 > 7), so the same receivable shouldn't count yet at the 7d horizon.
    // No payables in this test, so saldoProjetado === receita — comparing the raw number
    // sidesteps the non-breaking space Intl.NumberFormat puts in the formatted BRL string.
    expect(basePoint7.saldoProjetado).toBeGreaterThan(0);
    expect(pessPoint7.saldoProjetado).toBe(0);
  });

  it('pessimista adds an unplanned-expense shock (sized off real pending payables) from day 30 onward', async () => {
    const { token, userId } = await registerCedente();
    createDuplicata({
      cedenteId: userId,
      cedenteNome: 'Cedente Cashflow',
      sacadoNome: 'Sacado Cashflow Choque',
      sacadoCnpj: '',
      valor: 200000,
      vencimento: isoDaysFromNow(1),
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
    await request(app)
      .post('/api/payables')
      .set('Authorization', `Bearer ${token}`)
      .send({ descricao: 'Fornecedor recorrente', categoria: 'fornecedores', valor: 10000, vencimento: isoDaysFromNow(1) });

    const res = await request(app).get('/api/cashflow/forecast').set('Authorization', `Bearer ${token}`);
    const base = res.body.scenarios.find((s: { scenario: string }) => s.scenario === 'base');
    const pessimista = res.body.scenarios.find((s: { scenario: string }) => s.scenario === 'pessimista');
    const baseDespesa30 = base.points.find((p: { days: number }) => p.days === 30).despesaEsperadaFmt;
    const pessDespesa30 = pessimista.points.find((p: { days: number }) => p.days === 30).despesaEsperadaFmt;
    const baseDespesa7 = base.points.find((p: { days: number }) => p.days === 7).despesaEsperadaFmt;
    const pessDespesa7 = pessimista.points.find((p: { days: number }) => p.days === 7).despesaEsperadaFmt;
    // No shock yet before day 30 — both scenarios see the same real payable.
    expect(pessDespesa7).toBe(baseDespesa7);
    // From day 30 on, pessimista adds the shock on top of the same real payable.
    expect(pessDespesa30).not.toBe(baseDespesa30);
  });

  it('includes ERP-fed receivables (feature "AI CFO enxerga o ERP") with a haircut in pessimista/base, none in otimista', async () => {
    const { token, userId } = await registerCedente();
    upsertErpReceivables(userId, 'omie', [{ externalId: 'omie-1', cliente: 'Cliente Externo Ltda', valor: 10000, vencimento: isoDaysFromNow(20) }]);

    const res = await request(app).get('/api/cashflow/forecast').set('Authorization', `Bearer ${token}`);
    expect(res.body.recebiveisExternos).toBe(10000);

    const otimista = res.body.scenarios.find((s: { scenario: string }) => s.scenario === 'otimista');
    const base = res.body.scenarios.find((s: { scenario: string }) => s.scenario === 'base');
    const p30Otim = otimista.points.find((p: { days: number }) => p.days === 30).saldoProjetado;
    const p30Base = base.points.find((p: { days: number }) => p.days === 30).saldoProjetado;
    expect(p30Otim).toBe(10000); // 0% haircut
    expect(p30Base).toBe(9500); // 5% haircut
  });

  it('flags client concentration across Lastro duplicatas + ERP receivables combined', async () => {
    const { token, userId } = await registerCedente();
    // 3 sources, 80% concentrated in "Grande Cliente Ltda" — above the 50% threshold and
    // enough entries (>=3) to make the pattern meaningful.
    createDuplicata({
      cedenteId: userId, cedenteNome: 'Cedente Cashflow', sacadoNome: 'Grande Cliente Ltda', sacadoCnpj: '',
      valor: 80000, vencimento: isoDaysFromNow(20), emissao: '10/08/2026', status: 'aprovada', lastroPct: 100, seguro: false,
    });
    upsertErpReceivables(userId, 'omie', [
      { externalId: 'e1', cliente: 'Grande Cliente Ltda', valor: 40000, vencimento: isoDaysFromNow(20) },
      { externalId: 'e2', cliente: 'Cliente Pequeno Ltda', valor: 30000, vencimento: isoDaysFromNow(20) },
    ]);

    const res = await request(app).get('/api/cashflow/forecast').set('Authorization', `Bearer ${token}`);
    const concentracao = res.body.insights.find((i: { tipo: string }) => i.tipo === 'concentracao');
    expect(concentracao).toBeTruthy();
    expect(concentracao.mensagem).toMatch(/Grande Cliente Ltda/);
  });

  describe('recursos do plano Empresarial', () => {
    it('keeps dre/saldoBancarioReal/benchmark null on Básico and Pro, populated on Empresarial', async () => {
      const { token: basicoOwnerToken } = await registerCedente('pro'); // sanity: Pro already covered above
      expect(basicoOwnerToken).toBeTruthy();

      const { token, userId } = await registerCedente('empresarial');
      createDuplicata({
        cedenteId: userId, cedenteNome: 'Cedente Empresarial', sacadoNome: 'Sacado DRE', sacadoCnpj: '',
        valor: 15000, vencimento: isoDaysFromNow(-5), emissao: '10/08/2026', status: 'no_mercado', lastroPct: 100, seguro: false,
      });
      const res = await request(app).get('/api/cashflow/forecast').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.dre).not.toBeNull();
      expect(res.body.dre.periodoDias).toBe(90);
      expect(res.body.benchmark).not.toBeNull();
      expect(['AA', 'A', 'B', 'C']).toContain(res.body.benchmark.seuRatingMedio);
      // Sem OPEN_FINANCE_API_URL/KEY configurado neste ambiente de teste, o saldo real
      // honestamente vem null — nunca um valor fabricado (mesma disciplina de todo
      // lib/*.ts real-when-configured deste projeto).
      expect(res.body.saldoBancarioReal).toBeNull();
    });

    it('DRE simplificado soma receita liquidada (compra real) e despesa paga nos últimos 90 dias', async () => {
      const { token, userId } = await registerCedente('empresarial');
      const investidorRes = await request(app)
        .post('/api/auth/register')
        .send({ nome: 'Investidor DRE', email: `inv-dre-${unique()}@example.com`, password: 'senha123', companyName: `Fundo DRE ${unique()}`, role: 'investidor' });

      const dup = createDuplicata({
        cedenteId: userId, cedenteNome: 'Cedente DRE', sacadoNome: 'Sacado DRE Receita', sacadoCnpj: '',
        valor: 25000, vencimento: isoDaysFromNow(10), emissao: '10/08/2026', status: 'no_mercado', lastroPct: 100, seguro: false,
      });
      createPurchase(dup.id, investidorRes.body.user.id, 25000, '2,0', 0);

      const payableRes = await request(app)
        .post('/api/payables')
        .set('Authorization', `Bearer ${token}`)
        .send({ descricao: 'Despesa paga no período', categoria: 'fornecedores', valor: 6000, vencimento: isoDaysFromNow(1) });
      await request(app).post(`/api/payables/${payableRes.body.id}/pagar`).set('Authorization', `Bearer ${token}`);

      const res = await request(app).get('/api/cashflow/forecast').set('Authorization', `Bearer ${token}`);
      expect(res.body.dre.resultado).toBe(19000); // 25.000 receita - 6.000 despesa
    });
  });
});
