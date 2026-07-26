import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import http from 'node:http';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerEmpresarialCedente() {
  const email = `ced-v2-${unique()}@example.com`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente V2', email, password: 'senha123', companyName: `Cedente V2 ${unique()}`, role: 'cedente' });
  const token = reg.body.token as string;
  await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
  return { token };
}

async function generateKey(token: string, body: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`).send(body);
  return res.body as { rawKey: string; apiKeys: { id: number; mode: string; scope: string; callsThisMonth: number }[] };
}

describe('OpenAPI spec', () => {
  it('is served publicly at /api/v1/openapi.json with no auth required', async () => {
    const res = await request(app).get('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.3');
    expect(res.body.paths['/duplicatas']).toBeTruthy();
    expect(res.body.paths['/aceites']).toBeTruthy();
    expect(res.body.paths['/seguradora']).toBeTruthy();
    expect(res.body.paths['/sacados/{cnpj}/score']).toBeTruthy();
  });
});

describe('sandbox (test-mode) API keys', () => {
  it('generates a lastro_test_ key and tags emit responses with mode: test', async () => {
    const { token } = await registerEmpresarialCedente();
    const gen = await generateKey(token, { mode: 'test' });
    expect(gen.rawKey.startsWith('lastro_test_')).toBe(true);
    expect(gen.apiKeys[0].mode).toBe('test');

    let res = { status: 0, body: {} as { mode?: string } };
    for (let attempt = 0; attempt < 8 && res.status !== 200; attempt++) {
      res = await request(app)
        .post('/api/v1/duplicatas')
        .set('Authorization', `Bearer ${gen.rawKey}`)
        .send({ sacado: 'Grupo Atlas Varejo', cnpj: '', valor: '5.000', vencimento: '2026-12-31', seguro: false });
    }
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('test');
  });

  it('defaults to a lastro_live_ key when no mode is given', async () => {
    const { token } = await registerEmpresarialCedente();
    const gen = await generateKey(token);
    expect(gen.rawKey.startsWith('lastro_live_')).toBe(true);
    expect(gen.apiKeys[0].mode).toBe('live');
  });
});

describe('API key scopes', () => {
  it('lets a read_only key call GET endpoints but forbids mutating ones', async () => {
    const { token } = await registerEmpresarialCedente();
    const gen = await generateKey(token, { scope: 'read_only' });
    expect(gen.apiKeys[0].scope).toBe('read_only');

    const market = await request(app).get('/api/v1/marketplace').set('Authorization', `Bearer ${gen.rawKey}`);
    expect(market.status).toBe(200);

    const emit = await request(app)
      .post('/api/v1/duplicatas')
      .set('Authorization', `Bearer ${gen.rawKey}`)
      .send({ sacado: 'Grupo Atlas Varejo', valor: '5.000', vencimento: '2026-12-31' });
    expect(emit.status).toBe(403);
    expect(emit.body.error).toBe('forbidden');
  });
});

describe('API usage metering', () => {
  it('counts calls made with a key and surfaces them in Desenvolvedores', async () => {
    const { token } = await registerEmpresarialCedente();
    const gen = await generateKey(token);

    await request(app).get('/api/v1/marketplace').set('Authorization', `Bearer ${gen.rawKey}`);
    await request(app).get('/api/v1/marketplace').set('Authorization', `Bearer ${gen.rawKey}`);
    await request(app).get('/api/v1/marketplace').set('Authorization', `Bearer ${gen.rawKey}`);

    const dev = await request(app).get('/api/dev').set('Authorization', `Bearer ${token}`);
    const key = dev.body.apiKeys.find((k: { id: number }) => k.id === gen.apiKeys[0].id);
    expect(key.callsThisMonth).toBeGreaterThanOrEqual(3);
  });
});

describe('Idempotency-Key on mutating v1 endpoints', () => {
  it('replays the same response for a repeated key + body, and 409s on a reused key with a different body', async () => {
    const { token } = await registerEmpresarialCedente();
    const gen = await generateKey(token);
    const idKey = `idem-${unique()}`;
    const body = { sacado: 'Grupo Atlas Varejo', cnpj: '', valor: '5.000', vencimento: '2026-12-31', seguro: false };

    let first = { status: 0, body: {} as { duplicataId?: string } };
    for (let attempt = 0; attempt < 8 && first.status !== 200; attempt++) {
      first = await request(app)
        .post('/api/v1/duplicatas')
        .set('Authorization', `Bearer ${gen.rawKey}`)
        .set('Idempotency-Key', idKey)
        .send(body);
    }
    expect(first.status).toBe(200);
    const duplicataId = first.body.duplicataId;

    // Same key + same body -> replays the exact same outcome (same duplicataId), not a new emission.
    const second = await request(app)
      .post('/api/v1/duplicatas')
      .set('Authorization', `Bearer ${gen.rawKey}`)
      .set('Idempotency-Key', idKey)
      .send(body);
    expect(second.status).toBe(200);
    expect(second.body.duplicataId).toBe(duplicataId);

    // Same key + different body -> conflict.
    const conflict = await request(app)
      .post('/api/v1/duplicatas')
      .set('Authorization', `Bearer ${gen.rawKey}`)
      .set('Idempotency-Key', idKey)
      .send({ ...body, valor: '9.999' });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error).toBe('idempotency_key_conflict');
  });

  it('runs the operation normally (twice) when no Idempotency-Key header is sent', async () => {
    const { token } = await registerEmpresarialCedente();
    const gen = await generateKey(token);
    const body = { sacado: 'Distribuidora Bom Preço', cnpj: '', valor: '5.000', vencimento: '2026-12-31', seguro: false };

    let first = { status: 0, body: {} as { duplicataId?: string } };
    for (let attempt = 0; attempt < 8 && first.status !== 200; attempt++) {
      first = await request(app).post('/api/v1/duplicatas').set('Authorization', `Bearer ${gen.rawKey}`).send(body);
    }
    let second = { status: 0, body: {} as { duplicataId?: string } };
    for (let attempt = 0; attempt < 8 && second.status !== 200; attempt++) {
      second = await request(app).post('/api/v1/duplicatas').set('Authorization', `Bearer ${gen.rawKey}`).send(body);
    }
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.duplicataId).not.toBe(first.body.duplicataId);
  });
});

describe('webhook delivery log + retry', () => {
  it('logs a successful delivery attempt', async () => {
    const { token } = await registerEmpresarialCedente();

    const server = http.createServer((req, res) => {
      req.on('data', () => {});
      req.on('end', () => {
        res.writeHead(200);
        res.end('ok');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const webhookRes = await request(app)
      .post('/api/dev/webhooks')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: `http://127.0.0.1:${port}/hook`, event: 'duplicata.registrada' });
    const webhookId = webhookRes.body.webhooks[0].id as number;

    let lastStatus = 0;
    for (let attempt = 0; attempt < 8 && lastStatus !== 200; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({ sacado: 'Grupo Atlas Varejo', cnpj: '', valor: '5.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(200);

    // give the fire-and-forget delivery a moment to complete
    let deliveries: { status: string; attempt: number; responseStatus: number | null }[] = [];
    for (let attempt = 0; attempt < 20; attempt++) {
      const res = await request(app).get(`/api/dev/webhooks/${webhookId}/deliveries`).set('Authorization', `Bearer ${token}`);
      deliveries = res.body.deliveries;
      if (deliveries.length > 0 && deliveries[0].status !== 'pending') break;
      await new Promise((r) => setTimeout(r, 50));
    }
    server.close();

    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries[0].status).toBe('success');
    expect(deliveries[0].responseStatus).toBe(200);
  });

  it('retries a failing delivery and eventually marks it failed, logging every attempt', async () => {
    const { token } = await registerEmpresarialCedente();

    const webhookRes = await request(app)
      .post('/api/dev/webhooks')
      // nothing listens on this port — every attempt fails fast with a connection error
      .set('Authorization', `Bearer ${token}`)
      .send({ url: 'http://127.0.0.1:1/hook', event: 'duplicata.registrada' });
    const webhookId = webhookRes.body.webhooks[0].id as number;

    let lastStatus = 0;
    for (let attempt = 0; attempt < 8 && lastStatus !== 200; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({ sacado: 'Metalúrgica Serrana S.A.', cnpj: '', valor: '5.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(200);

    let deliveries: { status: string; attempt: number }[] = [];
    for (let attempt = 0; attempt < 40; attempt++) {
      const res = await request(app).get(`/api/dev/webhooks/${webhookId}/deliveries`).set('Authorization', `Bearer ${token}`);
      deliveries = res.body.deliveries;
      if (deliveries.length > 0 && deliveries[0].status === 'failed' && deliveries[0].attempt >= 3) break;
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(deliveries.length).toBeGreaterThan(0);
    expect(deliveries[0].status).toBe('failed');
    expect(deliveries[0].attempt).toBeGreaterThanOrEqual(3);
  }, 15000);
});
