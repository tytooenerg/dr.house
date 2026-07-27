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
  const email = `ced-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Teste', email, password: 'senha123', companyName: `Cedente ${unique()}`, role: 'cedente' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

describe('GET /api/billing', () => {
  it('starts every new account on the free básico plan, with billing simulated (no Stripe key in tests)', async () => {
    const { token } = await registerCedente();
    const res = await request(app).get('/api/billing').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.billingEnabled).toBe(false);
    expect(res.body.currentPlan).toBe('basico');
    expect(res.body.plans.map((p: { key: string }) => p.key)).toEqual(['basico', 'pro', 'empresarial']);
  });
});

describe('POST /api/billing/checkout (simulated mode)', () => {
  it('activates a paid plan immediately when Stripe is not configured', async () => {
    const { token } = await registerCedente();
    const res = await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'pro' });
    expect(res.status).toBe(200);
    expect(res.body.simulated).toBe(true);
    expect(res.body.url).toBeNull();

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.user.plan).toBe('pro');
  });

  it('downgrades back to básico', async () => {
    const { token } = await registerCedente();
    await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
    const res = await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'basico' });
    expect(res.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.body.user.plan).toBe('basico');
  });

  it('rejects an invalid plan', async () => {
    const { token } = await registerCedente();
    const res = await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'ultra' });
    expect(res.status).toBe(400);
  });
});

describe('plan gating', () => {
  it('blocks Comparador de Taxas on the básico plan and unblocks it after upgrading to Pro', async () => {
    const { token } = await registerCedente();
    const blocked = await request(app).post('/api/comparador/estimate').set('Authorization', `Bearer ${token}`).send({});
    expect(blocked.status).toBe(402);
    expect(blocked.body.error).toBe('plan_required');

    await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'pro' });
    const allowed = await request(app).post('/api/comparador/estimate').set('Authorization', `Bearer ${token}`).send({});
    expect(allowed.status).toBe(200);
  });

  it('lets any plan reach Desenvolvedores and generate a sandbox key, but blocks live keys and webhooks below Empresarial', async () => {
    const { token } = await registerCedente();
    await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'pro' });

    const dashboard = await request(app).get('/api/dev').set('Authorization', `Bearer ${token}`);
    expect(dashboard.status).toBe(200);

    const sandboxKey = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ mode: 'test' });
    expect(sandboxKey.status).toBe(200);
    expect(sandboxKey.body.rawKey.startsWith('lastro_test_')).toBe(true);

    const liveKeyBlocked = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ mode: 'live' });
    expect(liveKeyBlocked.status).toBe(402);

    const webhookBlocked = await request(app)
      .post('/api/dev/webhooks')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'https://example.com/hook', event: 'duplicata.registrada' });
    expect(webhookBlocked.status).toBe(402);

    await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
    const liveKeyAllowed = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ mode: 'live' });
    expect(liveKeyAllowed.status).toBe(200);
    expect(liveKeyAllowed.body.rawKey.startsWith('lastro_live_')).toBe(true);
  });

  it('caps a básico cedente at 5 duplicata emissions per month, and Pro removes the cap', async () => {
    const { token, userId } = await registerCedente();
    for (let i = 0; i < 5; i++) {
      createDuplicata({
        cedenteId: userId,
        cedenteNome: 'Cedente Teste',
        sacadoNome: 'Sacado X',
        sacadoCnpj: '',
        valor: 1000,
        vencimento: '2026-12-31',
        emissao: new Date().toLocaleDateString('pt-BR'),
        status: 'aprovada',
        lastroPct: 100,
        seguro: false,
        registro: 'ESC-TEST',
      });
    }

    const blocked = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado: 'Grupo Atlas Varejo', cnpj: '', valor: '1.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
    expect(blocked.status).toBe(402);
    expect(blocked.body.error).toBe('plan_required');

    await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'pro' });
    // The CERC step still randomly fails ~12% of the time — retry through it like the E2E test does.
    let lastStatus = 0;
    for (let attempt = 0; attempt < 8 && lastStatus !== 200; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({ sacado: 'Grupo Atlas Varejo', cnpj: '', valor: '1.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      lastStatus = res.status;
      expect(lastStatus === 200 || lastStatus === 502).toBe(true);
    }
    expect(lastStatus).toBe(200);
  });
});
