import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';

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

async function registerCedente(companyName: string) {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente Teste',
    email: `ced-${unique()}@example.com`,
    password: 'senha123',
    companyName,
    role: 'cedente',
  });
  return res.body.token as string;
}

async function submitEmitir(token: string, overrides: Partial<{ sacado: string; cnpj: string; valor: string; vencimento: string }> = {}) {
  let lastStatus = 0;
  let body: Record<string, unknown> = {};
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({
        sacado: overrides.sacado ?? 'Grupo Atlas Varejo',
        cnpj: overrides.cnpj ?? '12.345.678/0001-90',
        valor: overrides.valor ?? '10.000',
        vencimento: overrides.vencimento ?? '2026-11-01',
        seguro: false,
        nfAnexada: true,
        batchValores: [],
      });
    lastStatus = res.status;
    body = res.body;
    if (res.status === 200) break;
    expect(res.status).toBe(502);
  }
  expect(lastStatus).toBe(200);
  return body as { duplicataId: string; complianceSuspensa: boolean };
}

describe('Compliance AI Engine — admin-configurable suspend threshold', () => {
  it('defaults to 80 and requires admin role to read/write', async () => {
    const admin = await adminToken();
    const res = await request(app).get('/api/admin/compliance-threshold').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.body.threshold).toBe(80);
    expect(res.body.default).toBe(80);

    const cedente = await registerCedente(`Sem Acesso ${unique()} Ltda`);
    const denied = await request(app).get('/api/admin/compliance-threshold').set('Authorization', `Bearer ${cedente}`);
    expect(denied.status).toBe(403);
    const deniedWrite = await request(app)
      .put('/api/admin/compliance-threshold')
      .set('Authorization', `Bearer ${cedente}`)
      .send({ threshold: 10 });
    expect(deniedWrite.status).toBe(403);
  });

  it('rejects an out-of-range threshold', async () => {
    const admin = await adminToken();
    const res = await request(app).put('/api/admin/compliance-threshold').set('Authorization', `Bearer ${admin}`).send({ threshold: 0 });
    expect(res.status).toBe(400);
    const res2 = await request(app).put('/api/admin/compliance-threshold').set('Authorization', `Bearer ${admin}`).send({ threshold: 101 });
    expect(res2.status).toBe(400);
  });

  it('a lowered threshold suspends an emission that would otherwise auto-approve', async () => {
    const admin = await adminToken();

    // Baseline: a clean, first-time emission does not suspend at the default threshold.
    const cedenteBaseline = await registerCedente(`Fornecedora Baseline ${unique()} Ltda`);
    const baseline = await submitEmitir(cedenteBaseline, { sacado: 'Grupo Atlas Varejo', cnpj: '12.345.678/0001-90', valor: '3.000', vencimento: '2026-12-05' });
    expect(baseline.complianceSuspensa).toBe(false);

    // Lower the threshold below what even a clean emission scores (score do sacado
    // "sem histórico" alone is +5 for an unrecognized CNPJ) to prove the admin's setting
    // is actually read live by the engine, not just stored.
    const update = await request(app).put('/api/admin/compliance-threshold').set('Authorization', `Bearer ${admin}`).send({ threshold: 1 });
    expect(update.status).toBe(200);
    expect(update.body.threshold).toBe(1);

    const getAfter = await request(app).get('/api/admin/compliance-threshold').set('Authorization', `Bearer ${admin}`);
    expect(getAfter.body.threshold).toBe(1);

    const cedenteLowered = await registerCedente(`Fornecedora Threshold Baixo ${unique()} Ltda`);
    const lowered = await submitEmitir(cedenteLowered, { sacado: 'Empresa Nunca Vista', cnpj: '11.222.333/0001-44', valor: '4.000', vencimento: '2026-12-06' });
    expect(lowered.complianceSuspensa).toBe(true);

    // Restore the default so it doesn't leak into any other assumption within this file.
    const restore = await request(app).put('/api/admin/compliance-threshold').set('Authorization', `Bearer ${admin}`).send({ threshold: 80 });
    expect(restore.status).toBe(200);
  });
});
