import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { tedEnabled, lastroStaticAccountConfigured, emitirInstrucaoTed, parseWebhookTedRecebido } from '../src/lib/tedRail.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente() {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente TED',
    email: `ced-ted-${unique()}@example.com`,
    password: 'senha123',
    companyName: `Fornecedora TED ${unique()} Ltda`,
    role: 'cedente',
  });
  return res.body.token as string;
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

describe('TED rail — real-when-configured, honestly unconfigured in tests', () => {
  it('is disabled without TED_PSP_*/LASTRO_TED_* env vars', () => {
    expect(tedEnabled).toBe(false);
    expect(lastroStaticAccountConfigured).toBe(false);
  });

  it('emitirInstrucaoTed() falls back to clearly-labeled simulated bank data', async () => {
    const instrucao = await emitirInstrucaoTed({ referencia: 'TEDTEST1', valor: 1000, pagadorNome: 'Empresa Teste' });
    expect(instrucao.simulado).toBe(true);
    expect(instrucao.referencia).toBe('TEDTEST1');
  });

  it('parseWebhookTedRecebido parses the expected shape and ignores garbage', () => {
    expect(parseWebhookTedRecebido({ teds: [{ referencia: 'REF1', valor: '500.00' }] })).toEqual([{ referencia: 'REF1', valor: 500 }]);
    expect(parseWebhookTedRecebido({})).toEqual([]);
    expect(parseWebhookTedRecebido(null)).toEqual([]);
  });
});

describe('TED deposit flow — no self-service confirmation', () => {
  it('creates a pending deposit instruction visible to the depositing user and to admin, with no user-facing confirm endpoint', async () => {
    const token = await registerCedente();
    const dep = await request(app).post('/api/account/deposit/ted').set('Authorization', `Bearer ${token}`).send({ valor: 2000 });
    expect(dep.status).toBe(200);
    expect(dep.body.instrucao.simulado).toBe(true);
    const referencia = dep.body.instrucao.referencia as string;

    const acct = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const found = acct.body.tedDeposits.find((t: { referencia: string }) => t.referencia === referencia);
    expect(found).toBeTruthy();
    expect(found.status).toBe('ativo');

    const admin = await adminToken();
    const pendentes = await request(app).get('/api/admin/ted/pendentes').set('Authorization', `Bearer ${admin}`);
    expect(pendentes.body.pendentes.some((p: { referencia: string }) => p.referencia === referencia)).toBe(true);
  });

  it('only an admin can confirm a TED deposit, crediting the ledger exactly once', async () => {
    const token = await registerCedente();
    const dep = await request(app).post('/api/account/deposit/ted').set('Authorization', `Bearer ${token}`).send({ valor: 3000 });
    const referencia = dep.body.instrucao.referencia as string;

    const admin = await adminToken();
    const before = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    expect(before.body.saldoDisponivelFmt).toMatch(/R\$\s*0$/);

    const confirm = await request(app).post(`/api/admin/ted/${referencia}/confirmar`).set('Authorization', `Bearer ${admin}`);
    expect(confirm.status).toBe(200);

    const after = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    expect(after.body.saldoDisponivelFmt).toMatch(/3\.000/);

    const again = await request(app).post(`/api/admin/ted/${referencia}/confirmar`).set('Authorization', `Bearer ${admin}`);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_settled');
  });

  it('rejects confirming a non-existent reference', async () => {
    const admin = await adminToken();
    const res = await request(app).post('/api/admin/ted/does-not-exist/confirmar').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(404);
  });
});

describe('TED withdrawal', () => {
  it('refuses to withdraw without a registered bank account', async () => {
    const token = await registerCedente();
    const res = await request(app).post('/api/account/withdraw/ted').set('Authorization', `Bearer ${token}`).send({ valor: 100 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('no_ted_account');
  });

  it('registers a bank account, then withdraws against available balance', async () => {
    const token = await registerCedente();
    const conta = await request(app)
      .post('/api/account/kyc/bank-ted')
      .set('Authorization', `Bearer ${token}`)
      .send({ banco: 'Banco Teste', agencia: '0001', conta: '12345-6', tipoConta: 'corrente', titularNome: 'Empresa Teste', titularCnpj: '12.345.678/0001-90' });
    expect(conta.status).toBe(200);
    expect(conta.body.tedContaBancaria.banco).toBe('Banco Teste');

    // Fund the account first via a real code path (TED deposit + admin confirm).
    const dep = await request(app).post('/api/account/deposit/ted').set('Authorization', `Bearer ${token}`).send({ valor: 5000 });
    const admin = await adminToken();
    await request(app).post(`/api/admin/ted/${dep.body.instrucao.referencia}/confirmar`).set('Authorization', `Bearer ${admin}`);

    const overdraw = await request(app).post('/api/account/withdraw/ted').set('Authorization', `Bearer ${token}`).send({ valor: 999999 });
    expect(overdraw.status).toBe(409);
    expect(overdraw.body.error).toBe('insufficient_balance');

    const withdraw = await request(app).post('/api/account/withdraw/ted').set('Authorization', `Bearer ${token}`).send({ valor: 1000 });
    expect(withdraw.status).toBe(200);
    expect(withdraw.body.saldoDisponivelFmt).toMatch(/4\.000/);
  });
});

describe('TED webhook', () => {
  it('accepts the webhook payload shape and returns 200', async () => {
    const res = await request(app).post('/api/public/ted-webhook').send({ teds: [{ referencia: 'nonexistent', valor: '100.00' }] });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(1);
  });
});
