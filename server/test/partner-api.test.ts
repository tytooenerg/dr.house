import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import crypto from 'node:crypto';
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
  const email = `ced-api-${unique()}@example.com`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente API', email, password: 'senha123', companyName: `Cedente API ${unique()}`, role: 'cedente' });
  const token = reg.body.token as string;
  // API key generation lives behind the Empresarial-only /api/dev router.
  await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
  return { token, userId: reg.body.user.id as number };
}

async function generateKey(token: string) {
  const res = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`);
  return res.body.rawKey as string;
}

async function registerAndUpgrade(role: 'sacado' | 'seguradora', companyName: string, extra: Record<string, unknown> = {}) {
  const email = `${role}-api-${unique()}@example.com`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ nome: `${role} API`, email, password: 'senha123', companyName, role, ...extra });
  const token = reg.body.token as string;
  await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
  return { token, userId: reg.body.user.id as number };
}

describe('partner API (api key auth)', () => {
  it('rejects requests with no key and with an invalid key', async () => {
    const noAuth = await request(app).get('/api/v1/marketplace');
    expect(noAuth.status).toBe(401);
    const badKey = await request(app).get('/api/v1/marketplace').set('Authorization', 'Bearer not-a-real-key');
    expect(badKey.status).toBe(401);
  });

  it('lists the marketplace and emits a duplicata for a cedente-owned key', async () => {
    const { token } = await registerEmpresarialCedente();
    const rawKey = await generateKey(token);

    const market = await request(app).get('/api/v1/marketplace').set('Authorization', `Bearer ${rawKey}`);
    expect(market.status).toBe(200);
    expect(market.body.offers.length).toBeGreaterThan(0);

    let lastStatus = 0;
    let duplicataId = '';
    for (let attempt = 0; attempt < 8 && lastStatus !== 200; attempt++) {
      const res = await request(app)
        .post('/api/v1/duplicatas')
        .set('Authorization', `Bearer ${rawKey}`)
        .send({ sacado: 'Grupo Atlas Varejo', cnpj: '', valor: '5.000', vencimento: '2026-12-31', seguro: false });
      lastStatus = res.status;
      if (res.status === 200) duplicataId = res.body.duplicataId;
      else expect(res.status).toBe(502);
    }
    expect(lastStatus).toBe(200);

    const consulta = await request(app).get(`/api/v1/duplicatas/${duplicataId}`).set('Authorization', `Bearer ${rawKey}`);
    expect(consulta.status).toBe(200);
    expect(consulta.body.sacado).toBe('Grupo Atlas Varejo');
  });

  it('forbids a non-cedente key from emitting duplicatas', async () => {
    const email = `inv-api-${unique()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Investidor API', email, password: 'senha123', companyName: 'Fundo API', role: 'investidor' });
    const token = reg.body.token as string;
    await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan: 'empresarial' });
    const rawKey = await generateKey(token);

    const res = await request(app)
      .post('/api/v1/duplicatas')
      .set('Authorization', `Bearer ${rawKey}`)
      .send({ sacado: 'Grupo Atlas Varejo', valor: '5.000', vencimento: '2026-12-31' });
    expect(res.status).toBe(403);
  });

  it('rejects a revoked key', async () => {
    const { token } = await registerEmpresarialCedente();
    const genRes = await request(app).post('/api/dev/keys/generate').set('Authorization', `Bearer ${token}`);
    const rawKey = genRes.body.rawKey as string;
    const keyId = genRes.body.apiKeys[0].id as number;

    await request(app).post(`/api/dev/keys/${keyId}/revoke`).set('Authorization', `Bearer ${token}`);
    const res = await request(app).get('/api/v1/marketplace').set('Authorization', `Bearer ${rawKey}`);
    expect(res.status).toBe(401);
  });
});

describe('real webhook delivery', () => {
  it('delivers a genuinely signed HTTP POST to a registered webhook URL when a duplicata is emitted', async () => {
    const { token } = await registerEmpresarialCedente();

    const received: { body: string; signature: string } = { body: '', signature: '' };
    let resolveReceived: () => void;
    const receivedPromise = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });

    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      req.on('end', () => {
        received.body = raw;
        received.signature = String(req.headers['x-lastro-signature'] ?? '');
        res.writeHead(200);
        res.end('ok');
        resolveReceived();
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const webhookRes = await request(app)
      .post('/api/dev/webhooks')
      .set('Authorization', `Bearer ${token}`)
      .send({ url: `http://127.0.0.1:${port}/hook`, event: 'duplicata.registrada' });
    expect(webhookRes.status).toBe(200);
    const secret = webhookRes.body.secret as string;

    let lastStatus = 0;
    for (let attempt = 0; attempt < 8 && lastStatus !== 200; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${token}`)
        .send({ sacado: 'Grupo Atlas Varejo', cnpj: '', valor: '5.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(200);

    await Promise.race([receivedPromise, new Promise((_, reject) => setTimeout(() => reject(new Error('webhook not received in time')), 5000))]);
    server.close();

    expect(received.body).toContain('duplicata.registrada');
    const expectedSignature = crypto.createHmac('sha256', secret).update(received.body).digest('hex');
    expect(received.signature).toBe(expectedSignature);
  });
});

describe('partner API — aceites', () => {
  it('lets a sacado key list and confirm a pending aceite', async () => {
    const sacadoNome = `Grupo Atlas Varejo`;
    const { token: cedenteToken } = await registerEmpresarialCedente();
    const { token: sacadoToken } = await registerAndUpgrade('sacado', sacadoNome);
    const sacadoKey = await generateKey(sacadoToken);

    let duplicataId = '';
    for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${cedenteToken}`)
        .send({ sacado: sacadoNome, cnpj: '', valor: '5.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      if (res.status === 200) duplicataId = res.body.duplicataId;
    }
    expect(duplicataId).not.toBe('');

    const list = await request(app).get('/api/v1/aceites').set('Authorization', `Bearer ${sacadoKey}`);
    expect(list.status).toBe(200);
    const aceite = list.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);
    expect(aceite).toBeTruthy();
    expect(aceite.isPending).toBe(true);

    const decide = await request(app)
      .post(`/api/v1/aceites/${aceite.id}/status`)
      .set('Authorization', `Bearer ${sacadoKey}`)
      .send({ status: 'aceita' });
    expect(decide.status).toBe(200);
    const updated = decide.body.aceites.find((a: { id: number }) => a.id === aceite.id);
    expect(updated.status).toBe('aceita');
  });

  it('forbids a sacado key from deciding an aceite that belongs to a different sacado', async () => {
    const { token: cedenteToken } = await registerEmpresarialCedente();
    const { token: sacadoToken } = await registerAndUpgrade('sacado', `Outro Sacado ${unique()}`);
    const sacadoKey = await generateKey(sacadoToken);

    let duplicataId = '';
    for (let attempt = 0; attempt < 8 && !duplicataId; attempt++) {
      const res = await request(app)
        .post('/api/emitir/submit')
        .set('Authorization', `Bearer ${cedenteToken}`)
        .send({ sacado: 'Distribuidora Bom Preço', cnpj: '', valor: '5.000', vencimento: '2026-12-31', seguro: false, nfAnexada: true });
      if (res.status === 200) duplicataId = res.body.duplicataId;
    }
    expect(duplicataId).not.toBe('');

    const internalAceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${cedenteToken}`);
    const target = internalAceites.body.aceites.find((a: { duplicataId: string }) => a.duplicataId === duplicataId);

    const decide = await request(app)
      .post(`/api/v1/aceites/${target.id}/status`)
      .set('Authorization', `Bearer ${sacadoKey}`)
      .send({ status: 'aceita' });
    expect(decide.status).toBe(403);
  });
});

describe('partner API — seguradora', () => {
  it('lets a seguradora key list apólices/sinistros and decide a claim', async () => {
    const { token } = await registerAndUpgrade('seguradora', `Seguros Parceiro ${unique()}`, { insurerKey: 'too' });
    const key = await generateKey(token);

    const dashboard = await request(app).get('/api/v1/seguradora').set('Authorization', `Bearer ${key}`);
    expect(dashboard.status).toBe(200);
    expect(dashboard.body.insurerName).toBe('Too Seguros');
    expect(dashboard.body.sinistros.length).toBeGreaterThan(0);

    const sinistro = dashboard.body.sinistros[0];
    const decide = await request(app)
      .post(`/api/v1/seguradora/sinistro/${sinistro.id}/decidir`)
      .set('Authorization', `Bearer ${key}`)
      .send({ decision: 'aprovado', note: 'Aprovado via API do parceiro.' });
    expect(decide.status).toBe(200);
    expect(decide.body.sinistros.some((s: { id: string }) => s.id === sinistro.id)).toBe(false);
  });

  it('forbids a non-seguradora key from accessing the seguradora endpoint', async () => {
    const { token } = await registerEmpresarialCedente();
    const key = await generateKey(token);
    const res = await request(app).get('/api/v1/seguradora').set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(403);
  });
});

describe('partner API — score by CNPJ', () => {
  it('returns the score for a known sacado CNPJ', async () => {
    const { token } = await registerEmpresarialCedente();
    const key = await generateKey(token);
    const res = await request(app).get('/api/v1/sacados/12.345.678%2F0001-90/score').set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Grupo Atlas Varejo');
    expect(res.body.rating).toBe('AA');

    // works with an unformatted (digits-only) CNPJ too
    const res2 = await request(app).get('/api/v1/sacados/12345678000190/score').set('Authorization', `Bearer ${key}`);
    expect(res2.status).toBe(200);
    expect(res2.body.name).toBe('Grupo Atlas Varejo');
  });

  it('404s for an unknown CNPJ', async () => {
    const { token } = await registerEmpresarialCedente();
    const key = await generateKey(token);
    const res = await request(app).get('/api/v1/sacados/00000000000000/score').set('Authorization', `Bearer ${key}`);
    expect(res.status).toBe(404);
  });
});
