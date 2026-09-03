import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { approveKyb, updateKybForm } from '../src/db/users.js';
import { createDuplicata, createPurchase } from '../src/db/duplicatas.js';
import { createSuspiciousActivityReport } from '../src/db/suspiciousActivity.js';
import { buildCvmPeriodStats } from '../src/lib/regulatoryReports.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

async function registerInvestidor() {
  const email = `inv-reg-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Investidor', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  approveKyb(res.body.user.id);
  updateKybForm(res.body.user.id, 'cnpj', '11.222.333/0001-44');
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

function currentPeriod() {
  return new Date().toISOString().slice(0, 7);
}

describe('CVM period report — real aggregates from real data', () => {
  it('counts a freshly-created duplicata and purchase in the current period', async () => {
    const before = buildCvmPeriodStats(currentPeriod());
    const { userId } = await registerInvestidor();

    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: 'Cedente Teste',
      sacadoNome: 'CVM Test Sacado',
      sacadoCnpj: '',
      valor: 50000,
      vencimento: '2026-12-31',
      emissao: '10/08/2026',
      status: 'aprovada',
      lastroPct: 100,
      seguro: false,
    });
    createPurchase(d.id, userId, 50000, '2,0%', 0);

    const after = buildCvmPeriodStats(currentPeriod());
    expect(after.totalEmitidoCount).toBe(before.totalEmitidoCount + 1);
    expect(after.totalMercadoPrimarioCount).toBe(before.totalMercadoPrimarioCount + 1);
    expect(after.investidoresAtivosDesdeSempre).toBeGreaterThanOrEqual(before.investidoresAtivosDesdeSempre);
  });

  it('exposes the same stats via GET /admin/regulatorio/cvm-informe and defaults to the current month', async () => {
    const token = await adminToken();
    const res = await request(app).get('/api/admin/regulatorio/cvm-informe').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.period).toBe(currentPeriod());
    expect(res.body).toHaveProperty('totalEmitidoFmt');
  });

  it('rejects a malformed period and falls back to the current month rather than erroring', async () => {
    const token = await adminToken();
    const res = await request(app).get('/api/admin/regulatorio/cvm-informe?period=not-a-period').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.period).toBe(currentPeriod());
  });

  it('streams a real PDF for the CVM monthly report', async () => {
    const token = await adminToken();
    const res = await request(app).get('/api/admin/regulatorio/cvm-informe.pdf').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('rejects a non-admin caller', async () => {
    const { token } = await registerInvestidor();
    const res = await request(app).get('/api/admin/regulatorio/cvm-informe').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('COAF SAR PDF report — real per-report document', () => {
  it('streams a real PDF for an existing SAR, 404s for one that does not exist', async () => {
    const { userId } = await registerInvestidor();
    const report = createSuspiciousActivityReport({
      userId,
      tipo: 'fracionamento',
      severidade: 'atencao',
      descricao: 'Teste automatizado de geração de relatório COAF.',
      evidencia: { entries: [{ valor: 10000 }, { valor: 12000 }, { valor: 15000 }], total: 37000 },
    });

    const token = await adminToken();
    const res = await request(app).get(`/api/admin/pld/suspeitas/${report.id}/relatorio-coaf.pdf`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');

    const missing = await request(app).get('/api/admin/pld/suspeitas/999999999/relatorio-coaf.pdf').set('Authorization', `Bearer ${token}`);
    expect(missing.status).toBe(404);
  });
});
