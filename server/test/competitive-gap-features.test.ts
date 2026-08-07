import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { testSapConnection } from '../src/lib/erpConnectors/sap.js';
import { testTotvsConnection } from '../src/lib/erpConnectors/totvs.js';
import { consultarFluxoDeCaixa } from '../src/lib/openFinance.js';
import { verificarProvaDeVida } from '../src/lib/biometricKyc.js';
import { screenJudicialRecords } from '../src/lib/judicialRecords.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente(companyName: string) {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente Teste',
    email: `ced-gap-${unique()}@example.com`,
    password: 'senha123',
    companyName,
    role: 'cedente',
  });
  return res.body.token as string;
}

async function demoEmpresarialCedenteToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'cedente@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

describe('Real-when-configured adapters return null/unavailable when unconfigured', () => {
  it('Open Finance', async () => {
    expect(await consultarFluxoDeCaixa('12.345.678/0001-90')).toBeNull();
  });
  it('biometric KYC', async () => {
    expect(await verificarProvaDeVida(Buffer.from('fake'), 'image/jpeg')).toBeNull();
  });
  it('judicial records', async () => {
    expect(await screenJudicialRecords('12.345.678/0001-90')).toBeNull();
  });
  it('SAP/TOTVS connection tests fail gracefully against an unreachable host', async () => {
    const sap = await testSapConnection('http://127.0.0.1:1', 'SBODEMO', 'user', 'pass');
    expect(sap.ok).toBe(false);
    const totvs = await testTotvsConnection('http://127.0.0.1:1', 'client', 'secret');
    expect(totvs.ok).toBe(false);
  });
});

describe('Integrações ERP — SAP/TOTVS routes', () => {
  it('rejects invalid SAP/TOTVS connect payloads', async () => {
    const token = await registerCedente(`Fornecedora ERP ${unique()} Ltda`);
    const badSap = await request(app).post('/api/erp/sap/connect').set('Authorization', `Bearer ${token}`).send({ baseUrl: 'not-a-url', companyDb: '', username: '', password: '' });
    expect(badSap.status).toBe(400);
    const badTotvs = await request(app).post('/api/erp/totvs/connect').set('Authorization', `Bearer ${token}`).send({ baseUrl: 'not-a-url', clientId: '', clientSecret: '' });
    expect(badTotvs.status).toBe(400);
  });

  it('lists sap and totvs as real connectors', async () => {
    const token = await registerCedente(`Fornecedora ERP Real ${unique()} Ltda`);
    const res = await request(app).get('/api/erp').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const sap = res.body.connectors.find((c: { key: string }) => c.key === 'sap');
    const totvs = res.body.connectors.find((c: { key: string }) => c.key === 'totvs');
    expect(sap.real).toBe(true);
    expect(totvs.real).toBe(true);
  });
});

describe('Emissão automática — opt-in gating', () => {
  it('refuses to enable without a connected ERP', async () => {
    const token = await registerCedente(`Fornecedora AutoEmit ${unique()} Ltda`);
    const res = await request(app).post('/api/erp/auto-emit').set('Authorization', `Bearer ${token}`).send({ enabled: true });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('no_erp_connected');
  });

  it('can always be disabled', async () => {
    const token = await registerCedente(`Fornecedora AutoEmit Off ${unique()} Ltda`);
    const res = await request(app).post('/api/erp/auto-emit').set('Authorization', `Bearer ${token}`).send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.autoEmitEnabled).toBe(false);
  });
});

describe('White-label branding — plan gating', () => {
  it('requires the Empresarial plan', async () => {
    const token = await registerCedente(`Fornecedora Basico ${unique()} Ltda`);
    const res = await request(app)
      .post('/api/erp/whitelabel/brand')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Minha Marca', corPrimaria: '#1E5EFF', logoUrl: 'https://example.com/logo.png' });
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('plan_required');
  });

  it('succeeds on the Empresarial plan and can be removed', async () => {
    const token = await demoEmpresarialCedenteToken();
    const res = await request(app)
      .post('/api/erp/whitelabel/brand')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Minha Marca', corPrimaria: '#1E5EFF', logoUrl: 'https://example.com/logo.png' });
    expect(res.status).toBe(200);
    expect(res.body.whitelabelBrand.nome).toBe('Minha Marca');

    const removed = await request(app).post('/api/erp/whitelabel/brand/remove').set('Authorization', `Bearer ${token}`);
    expect(removed.status).toBe(200);
    expect(removed.body.whitelabelBrand).toBeNull();
  });

  it('rejects an invalid hex color', async () => {
    const token = await demoEmpresarialCedenteToken();
    const res = await request(app)
      .post('/api/erp/whitelabel/brand')
      .set('Authorization', `Bearer ${token}`)
      .send({ nome: 'Minha Marca', corPrimaria: 'blue', logoUrl: 'https://example.com/logo.png' });
    expect(res.status).toBe(400);
  });
});

describe('Boleto payment rail', () => {
  it('creates a simulated boleto deposit and confirms it, crediting the ledger', async () => {
    const token = await registerCedente(`Fornecedora Boleto ${unique()} Ltda`);
    const create = await request(app).post('/api/account/deposit/boleto').set('Authorization', `Bearer ${token}`).send({ valor: 1000 });
    expect(create.status).toBe(200);
    expect(create.body.simulado).toBe(true);
    const nossoNumero = create.body.nossoNumero as string;

    const before = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    expect(before.body.saldoDisponivelFmt).toMatch(/R\$\s*0$/);

    const confirm = await request(app).post(`/api/account/deposit/boleto/${nossoNumero}/confirm-simulado`).set('Authorization', `Bearer ${token}`);
    expect(confirm.status).toBe(200);
    expect(confirm.body.saldoDisponivelFmt).toMatch(/1\.000/);

    const again = await request(app).post(`/api/account/deposit/boleto/${nossoNumero}/confirm-simulado`).set('Authorization', `Bearer ${token}`);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_settled');
  });

  it("won't let one user confirm another user's boleto", async () => {
    const tokenA = await registerCedente(`Fornecedora Boleto A ${unique()} Ltda`);
    const tokenB = await registerCedente(`Fornecedora Boleto B ${unique()} Ltda`);
    const create = await request(app).post('/api/account/deposit/boleto').set('Authorization', `Bearer ${tokenA}`).send({ valor: 500 });
    const nossoNumero = create.body.nossoNumero as string;
    const res = await request(app).post(`/api/account/deposit/boleto/${nossoNumero}/confirm-simulado`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });
});

describe('Boleto webhook', () => {
  it('accepts the webhook payload shape and returns 200', async () => {
    const res = await request(app).post('/api/public/boleto-webhook').send({ boletos: [{ nossoNumero: 'nonexistent', valorPago: '100.00' }] });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(1);
  });
});
