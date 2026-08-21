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
    nome: 'Cedente Sandbox',
    email: `ced-sbx-${unique()}@example.com`,
    password: 'senha123',
    companyName: `Fornecedora Sandbox ${unique()} Ltda`,
    role: 'cedente',
  });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function generateKey(token: string, mode: 'live' | 'test') {
  const res = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send({ mode });
  return res.body.rawKey as string;
}

describe('Sandbox data isolation — test-mode keys get a real, separate dataset', () => {
  it('seeds a deterministic sandbox dataset when a test-mode key is generated', async () => {
    const { token } = await registerCedente();
    const testKey = await generateKey(token, 'test');

    const marketplace = await request(app).get('/api/v1/marketplace').set('Authorization', `Bearer ${testKey}`);
    expect(marketplace.status).toBe(200);
    expect(marketplace.body.offers.length).toBeGreaterThan(0);
    for (const o of marketplace.body.offers) {
      expect(o.sacado).toMatch(/Sandbox/);
    }
  });

  it('sandbox duplicatas never leak into the live app (Minhas Duplicatas / marketplace / plan limits)', async () => {
    const { token, userId } = await registerCedente();
    await generateKey(token, 'test'); // seeds 2 sandbox duplicatas for this cedente

    const minhas = await request(app).get('/api/minhas').set('Authorization', `Bearer ${token}`);
    expect(minhas.status).toBe(200);
    expect(minhas.body.duplicatas.length).toBe(0); // this cedente has zero real duplicatas, only sandbox ones
    const anySandboxLeaked = (minhas.body.duplicatas ?? []).some((d: { sacado?: string }) => d.sacado?.includes('Sandbox'));
    expect(anySandboxLeaked).toBe(false);

    const liveMarketplace = await request(app).get('/api/market').set('Authorization', `Bearer ${token}`);
    expect(liveMarketplace.status).toBe(200);
    const leaked = (liveMarketplace.body.offers ?? []).some((o: { sacado?: string }) => o.sacado?.includes('Sandbox'));
    expect(leaked).toBe(false);

    void userId;
  });

  it('a live key never sees sandbox duplicatas and a test key never sees live ones, at the /duplicatas/:id level', async () => {
    const { token } = await registerCedente();
    await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' }); // live keys require Empresarial
    const testKey = await generateKey(token, 'test');
    const liveKey = await generateKey(token, 'live');

    // Create a real (live) duplicata via the live key — retrying past the registradora's
    // 12% simulated instability chance (see lib/registradoras.ts), same as test/emitir.test.ts.
    let liveId = '';
    for (let attempt = 0; attempt < 10; attempt++) {
      const res = await request(app)
        .post('/api/v1/duplicatas')
        .set('Authorization', `Bearer ${liveKey}`)
        .send({ sacado: 'Comércio Real Ltda', cnpj: '11.222.333/0001-44', valor: '10000', vencimento: '2026-12-01' });
      if (res.status === 200) {
        liveId = res.body.duplicataId as string;
        break;
      }
      expect(res.status).toBe(502);
    }
    expect(liveId).not.toBe('');

    // Create a sandbox duplicata via the test key.
    const sandboxCreate = await request(app)
      .post('/api/v1/duplicatas')
      .set('Authorization', `Bearer ${testKey}`)
      .send({ sacado: 'Comércio Fake Ltda', cnpj: '99.888.777/0001-66', valor: '5000', vencimento: '2026-12-01' });
    expect(sandboxCreate.status).toBe(200);
    const sandboxId = sandboxCreate.body.duplicataId as string;
    expect(sandboxCreate.body.registro).toMatch(/^SANDBOX-/);

    // Cross-mode access is refused both ways.
    const testKeyReadsLive = await request(app).get(`/api/v1/duplicatas/${liveId}`).set('Authorization', `Bearer ${testKey}`);
    expect(testKeyReadsLive.status).toBe(404);
    const liveKeyReadsSandbox = await request(app).get(`/api/v1/duplicatas/${sandboxId}`).set('Authorization', `Bearer ${liveKey}`);
    expect(liveKeyReadsSandbox.status).toBe(404);

    // Same-mode access works.
    const testKeyReadsOwn = await request(app).get(`/api/v1/duplicatas/${sandboxId}`).set('Authorization', `Bearer ${testKey}`);
    expect(testKeyReadsOwn.status).toBe(200);
    const liveKeyReadsOwn = await request(app).get(`/api/v1/duplicatas/${liveId}`).set('Authorization', `Bearer ${liveKey}`);
    expect(liveKeyReadsOwn.status).toBe(200);
  });

  it('never registers sandbox emissions against a real registradora, regardless of configuration', async () => {
    const { token } = await registerCedente();
    const testKey = await generateKey(token, 'test');
    const res = await request(app)
      .post('/api/v1/duplicatas')
      .set('Authorization', `Bearer ${testKey}`)
      .send({ sacado: 'Comércio Sandbox Extra Ltda', cnpj: '22.333.444/0001-55', valor: '7000', vencimento: '2026-12-01' });
    expect(res.status).toBe(200);
    // registro clearly reads as fake sandbox data — no real registradora network call was
    // made (registradora here is just the smart-routing choice that *would* apply, never
    // actually contacted since opts.sandbox skips registrarNaRegistradora entirely).
    expect(res.body.registro).toMatch(/^SANDBOX-/);
  });
});
