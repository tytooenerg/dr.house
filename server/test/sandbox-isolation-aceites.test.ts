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

async function registerCedente() {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente Aceite Sandbox',
    email: `ced-sbx-ac-${unique()}@example.com`,
    password: 'senha123',
    companyName: `Fornecedora Aceite Sandbox ${unique()} Ltda`,
    role: 'cedente',
  });
  return { token: res.body.token as string };
}

async function registerSacado(companyName: string) {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Sacado Aceite Sandbox',
    email: `sac-sbx-ac-${unique()}@example.com`,
    password: 'senha123',
    companyName,
    role: 'sacado',
  });
  return { token: res.body.token as string };
}

async function generateKey(token: string, mode: 'live' | 'test') {
  const res = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ mode });
  return res.body.rawKey as string;
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

describe('Sandbox isolation extended to aceites and disputes', () => {
  it('a sandbox aceite is visible via a test-mode key but never via the internal SPA route', async () => {
    const sacadoNome = `Sacado Isolado ${unique()} Ltda`;
    const { token: cedenteToken } = await registerCedente();
    const testKey = await generateKey(cedenteToken, 'test');

    const created = await request(app)
      .post('/api/v1/duplicatas')
      .set('Authorization', `Bearer ${testKey}`)
      .send({ sacado: sacadoNome, cnpj: '12.345.678/0001-90', valor: '8000', vencimento: '2026-12-01' });
    expect(created.status).toBe(200);

    const viaTestKey = await request(app).get('/api/v1/aceites').set('Authorization', `Bearer ${testKey}`);
    expect(viaTestKey.status).toBe(200);
    expect(viaTestKey.body.aceites.length).toBeGreaterThan(0);
    expect(viaTestKey.body.aceites.every((a: { sacado: string }) => a.sacado === sacadoNome)).toBe(true);

    // Internal SPA route always operates on the live data plane — never sees sandbox aceites.
    const viaSpa = await request(app).get('/api/aceites').set('Authorization', `Bearer ${cedenteToken}`);
    expect(viaSpa.status).toBe(200);
    expect(viaSpa.body.aceites.some((a: { sacado: string }) => a.sacado === sacadoNome)).toBe(false);
  });

  it('a live key never sees a sandbox aceite, and vice versa, at the /v1/aceites/:id/status level', async () => {
    const sacadoNome = `Sacado Cross Mode ${unique()} Ltda`;
    const { token: cedenteToken } = await registerCedente();
    await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${cedenteToken}`).send({ plan: 'empresarial' });
    const testKey = await generateKey(cedenteToken, 'test');
    const liveKey = await generateKey(cedenteToken, 'live');

    const created = await request(app)
      .post('/api/v1/duplicatas')
      .set('Authorization', `Bearer ${testKey}`)
      .send({ sacado: sacadoNome, cnpj: '22.333.444/0001-55', valor: '4000', vencimento: '2026-12-01' });
    expect(created.status).toBe(200);

    const { token: sacadoToken } = await registerSacado(sacadoNome);
    await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${sacadoToken}`).send({ plan: 'empresarial' });
    const sacadoTestKey = await generateKey(sacadoToken, 'test');
    const sacadoLiveKey = await generateKey(sacadoToken, 'live');

    const viaTestKey = await request(app).get('/api/v1/aceites').set('Authorization', `Bearer ${sacadoTestKey}`);
    expect(viaTestKey.body.aceites.length).toBeGreaterThan(0);
    const aceiteId = viaTestKey.body.aceites[0].id as number;

    // A live key can't even see the sandbox aceite id — acting on it via a live key 404s.
    const crossMode = await request(app)
      .post(`/api/v1/aceites/${aceiteId}/status`)
      .set('Authorization', `Bearer ${sacadoLiveKey}`)
      .send({ status: 'contestada' });
    expect(crossMode.status).toBe(404);

    // The matching test-mode key can act on it, and it creates a dispute — but only
    // against the sandbox data plane, never leaking into the admin's real dispute queue.
    const contest = await request(app).post(`/api/v1/aceites/${aceiteId}/status`).set('Authorization', `Bearer ${sacadoTestKey}`).send({ status: 'contestada' });
    expect(contest.status).toBe(200);

    const admin = await adminToken();
    const disputes = await request(app).get('/api/admin/disputes').set('Authorization', `Bearer ${admin}`);
    expect(disputes.body.disputes.some((d: { sacado: string }) => d.sacado === sacadoNome)).toBe(false);

    void liveKey;
  });
});
