import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { createDuplicata, setInsurer } from '../src/db/duplicatas.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerSeguradora() {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Seguradora Sandbox',
    email: `seg-sbx-${unique()}@example.com`,
    password: 'senha123',
    companyName: `Seguros Sandbox ${unique()}`,
    role: 'seguradora',
    insurerKey: 'too',
  });
  const token = res.body.token as string;
  await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
  return { token };
}

async function generateKey(token: string, mode: 'live' | 'test') {
  const res = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ mode });
  return res.body.rawKey as string;
}

// Directly seeds an overdue, insured sandbox duplicata — lib/sandboxData.ts only seeds a
// cedente's own starter dataset today (no insurer_key set), so a seguradora test-mode key
// has nothing of its own to claim against yet without this. Mirrors exactly what a real
// overdue insured position looks like: aprovada, vencimento in the past, never sold.
function seedSandboxSinistro(insurerKey: string) {
  const d = createDuplicata({
    cedenteId: null,
    cedenteNome: 'Cedente Sandbox Sinistro',
    sacadoNome: `Sacado Sandbox Sinistro ${unique()}`,
    sacadoCnpj: '',
    valor: 15000,
    vencimento: '2020-01-01', // long overdue
    emissao: '01/01/2020',
    status: 'aprovada',
    lastroPct: 100,
    seguro: true,
    sandbox: true,
  });
  setInsurer(d.id, insurerKey);
  return d.id;
}

describe('Sandbox isolation extended to sinistro (seguradora claims)', () => {
  it('a test-mode key only ever sees/decides its own sandbox sinistro, invisible to a live key on the same account', async () => {
    const { token } = await registerSeguradora();
    const testKey = await generateKey(token, 'test');
    const liveKey = await generateKey(token, 'live');

    const sandboxId = seedSandboxSinistro('too');

    const viaTestKey = await request(app).get('/api/v1/seguradora').set('Authorization', `Bearer ${testKey}`);
    expect(viaTestKey.status).toBe(200);
    expect(viaTestKey.body.sinistros.some((s: { id: string }) => s.id === sandboxId)).toBe(true);

    // The live key on the very same account never sees the sandbox sinistro.
    const viaLiveKey = await request(app).get('/api/v1/seguradora').set('Authorization', `Bearer ${liveKey}`);
    expect(viaLiveKey.status).toBe(200);
    expect(viaLiveKey.body.sinistros.some((s: { id: string }) => s.id === sandboxId)).toBe(false);

    // A live key can't even find the sandbox sinistro's real ID to act on it.
    const crossMode = await request(app)
      .post(`/api/v1/seguradora/sinistro/${sandboxId}/decidir`)
      .set('Authorization', `Bearer ${liveKey}`)
      .send({ decision: 'aprovado', note: 'Tentativa via chave live — não deve encontrar.' });
    expect(crossMode.status).toBe(404);

    // The matching test-mode key can decide it for real, scoped to its own data plane.
    const decide = await request(app)
      .post(`/api/v1/seguradora/sinistro/${sandboxId}/decidir`)
      .set('Authorization', `Bearer ${testKey}`)
      .send({ decision: 'aprovado', note: 'Aprovado via chave sandbox.' });
    expect(decide.status).toBe(200);
    expect(decide.body.sinistros.some((s: { id: string }) => s.id === sandboxId)).toBe(false);
  });

  it('a test-mode key can never decide a real (non-sandbox) sinistro even knowing its real id', async () => {
    const { token: liveOwnerToken } = await registerSeguradora();
    const liveKey = await generateKey(liveOwnerToken, 'live');

    // A real, non-sandbox sinistro from this same fresh account (no seed dependency).
    const d = createDuplicata({
      cedenteId: null,
      cedenteNome: 'Cedente Real Sinistro',
      sacadoNome: `Sacado Real Sinistro ${unique()}`,
      sacadoCnpj: '',
      valor: 20000,
      vencimento: '2020-01-01',
      emissao: '01/01/2020',
      status: 'aprovada',
      lastroPct: 100,
      seguro: true,
    });
    setInsurer(d.id, 'too');

    const viaLiveKey = await request(app).get('/api/v1/seguradora').set('Authorization', `Bearer ${liveKey}`);
    expect(viaLiveKey.body.sinistros.some((s: { id: string }) => s.id === d.id)).toBe(true);

    const { token: sandboxOwnerToken } = await registerSeguradora();
    const testKey = await generateKey(sandboxOwnerToken, 'test');
    const crossMode = await request(app)
      .post(`/api/v1/seguradora/sinistro/${d.id}/decidir`)
      .set('Authorization', `Bearer ${testKey}`)
      .send({ decision: 'negado', note: 'Tentativa via chave sandbox contra sinistro real — não deve encontrar.' });
    expect(crossMode.status).toBe(404);
  });

  it('the internal SPA route always operates on the live data plane, never seeing a sandbox sinistro', async () => {
    const { token } = await registerSeguradora();
    const sandboxId = seedSandboxSinistro('too');

    const viaSpa = await request(app).get('/api/seguradora').set('Authorization', `Bearer ${token}`);
    expect(viaSpa.status).toBe(200);
    expect(viaSpa.body.sinistros.some((s: { id: string }) => s.id === sandboxId)).toBe(false);
  });
});
