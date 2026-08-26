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
    expect(res.body.paths['/payables']).toBeTruthy();
    expect(res.body.paths['/cashflow/forecast']).toBeTruthy();
    expect(res.body.paths['/aceites']).toBeTruthy();
    expect(res.body.paths['/seguradora']).toBeTruthy();
    expect(res.body.paths['/sacados/{cnpj}/score']).toBeTruthy();
    expect(res.body.paths['/pld/triagem']).toBeTruthy();
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

describe('GET /v1/payables and GET /v1/cashflow/forecast', () => {
  it('lists a cedente\'s own payables and returns them from the partner API', async () => {
    const { token } = await registerEmpresarialCedente();
    await request(app)
      .post('/api/payables')
      .set('Authorization', `Bearer ${token}`)
      .send({ descricao: 'Aluguel do escritório', fornecedor: 'Imobiliária Alfa', valor: 4500, vencimento: '2026-09-10' });

    const gen = await generateKey(token, { mode: 'test' });
    const res = await request(app).get('/api/v1/payables').set('Authorization', `Bearer ${gen.rawKey}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.payables)).toBe(true);
    const created = res.body.payables.find((p: { descricao: string }) => p.descricao === 'Aluguel do escritório');
    expect(created).toBeTruthy();
    expect(created.status).toBe('pendente');
    expect(typeof created.valorFmt).toBe('string');
  });

  it('returns a real cashflow forecast for a cedente key', async () => {
    const { token } = await registerEmpresarialCedente();
    const gen = await generateKey(token, { mode: 'test' });
    const res = await request(app).get('/api/v1/cashflow/forecast').set('Authorization', `Bearer ${gen.rawKey}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.scenarios)).toBe(true);
    expect(res.body.scenarios.map((s: { scenario: string }) => s.scenario).sort()).toEqual(['base', 'otimista', 'pessimista']);
    expect(Array.isArray(res.body.insights)).toBe(true);
    expect(typeof res.body.disponivelParaAntecipacaoFmt).toBe('string');
  });

  it('forbids a non-cedente key from reading payables or the cashflow forecast', async () => {
    const email = `inv-v1-${unique()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Investidor V1', email, password: 'senha123', companyName: `Investidor V1 ${unique()}`, role: 'investidor' });
    const gen = await generateKey(reg.body.token, { mode: 'test' });

    const payables = await request(app).get('/api/v1/payables').set('Authorization', `Bearer ${gen.rawKey}`);
    expect(payables.status).toBe(403);
    expect(payables.body.error).toBe('forbidden');

    const forecast = await request(app).get('/api/v1/cashflow/forecast').set('Authorization', `Bearer ${gen.rawKey}`);
    expect(forecast.status).toBe(403);
    expect(forecast.body.error).toBe('forbidden');
  });
});

describe('GET /v1/duplicatas', () => {
  it("lists the cedente's own duplicatas with numeric valor/emissao, for DSO/aging calculations", async () => {
    const { token } = await registerEmpresarialCedente();
    const gen = await generateKey(token, { mode: 'test' });

    let emit = { status: 0, body: {} as { duplicataId?: string } };
    for (let attempt = 0; attempt < 8 && emit.status !== 200; attempt++) {
      emit = await request(app)
        .post('/api/v1/duplicatas')
        .set('Authorization', `Bearer ${gen.rawKey}`)
        .send({ sacado: 'Grupo Atlas Varejo', cnpj: '12.345.678/0001-90', valor: '12.345,00', vencimento: '2026-12-31', seguro: false });
    }
    expect(emit.status).toBe(200);

    const res = await request(app).get('/api/v1/duplicatas').set('Authorization', `Bearer ${gen.rawKey}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.duplicatas)).toBe(true);
    const created = res.body.duplicatas.find((d: { id: string }) => d.id === emit.body.duplicataId);
    expect(created).toBeTruthy();
    expect(created.sacado).toBe('Grupo Atlas Varejo');
    expect(created.sacadoCnpj).toBe('12.345.678/0001-90');
    expect(created.valor).toBe(12345);
    expect(typeof created.valorFmt).toBe('string');
    expect(typeof created.emissao).toBe('string');
    expect(typeof created.vencimento).toBe('string');
  });

  it('forbids a non-cedente key', async () => {
    const email = `inv-dups-${unique()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Investidor Dups', email, password: 'senha123', companyName: `Investidor Dups ${unique()}`, role: 'investidor' });
    const gen = await generateKey(reg.body.token, { mode: 'test' });
    const res = await request(app).get('/api/v1/duplicatas').set('Authorization', `Bearer ${gen.rawKey}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
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
