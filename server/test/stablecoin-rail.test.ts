import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { stablecoinEnabled, lastroStaticWalletConfigured, emitirInstrucaoStablecoin, parseWebhookStablecoinRecebido } from '../src/lib/stablecoinRail.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente() {
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente Stablecoin',
    email: `ced-sc-${unique()}@example.com`,
    password: 'senha123',
    companyName: `Fornecedora Stablecoin ${unique()} Ltda`,
    role: 'cedente',
  });
  return res.body.token as string;
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

describe('Stablecoin rail — real-when-configured, honestly unconfigured in tests', () => {
  it('is disabled without STABLECOIN_PSP_*/LASTRO_STABLECOIN_WALLET_ADDRESS env vars', () => {
    expect(stablecoinEnabled).toBe(false);
    expect(lastroStaticWalletConfigured).toBe(false);
  });

  it('emitirInstrucaoStablecoin() falls back to clearly-labeled simulated wallet data', async () => {
    const instrucao = await emitirInstrucaoStablecoin({ referencia: 'SCTEST1', valor: 1000 });
    expect(instrucao.simulado).toBe(true);
    expect(instrucao.referencia).toBe('SCTEST1');
    expect(instrucao.asset).toBe('USDC');
  });

  it('parseWebhookStablecoinRecebido parses the expected shape and ignores garbage', () => {
    expect(parseWebhookStablecoinRecebido({ transfers: [{ referencia: 'REF1', valor: '500.00', txHash: '0xabc' }] })).toEqual([
      { referencia: 'REF1', valor: 500, txHash: '0xabc' },
    ]);
    expect(parseWebhookStablecoinRecebido({})).toEqual([]);
    expect(parseWebhookStablecoinRecebido(null)).toEqual([]);
  });
});

describe('Stablecoin deposit flow — no self-service confirmation', () => {
  it('creates a pending deposit instruction visible to the depositing user and to admin, with no user-facing confirm endpoint', async () => {
    const token = await registerCedente();
    const dep = await request(app).post('/api/account/deposit/stablecoin').set('Authorization', `Bearer ${token}`).send({ valor: 2000 });
    expect(dep.status).toBe(200);
    expect(dep.body.instrucao.simulado).toBe(true);
    const referencia = dep.body.instrucao.referencia as string;

    const acct = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    const found = acct.body.stablecoinDeposits.find((s: { referencia: string }) => s.referencia === referencia);
    expect(found).toBeTruthy();
    expect(found.status).toBe('ativo');

    const admin = await adminToken();
    const pendentes = await request(app).get('/api/admin/stablecoin/pendentes').set('Authorization', `Bearer ${admin}`);
    expect(pendentes.body.pendentes.some((p: { referencia: string }) => p.referencia === referencia)).toBe(true);
  });

  it('only an admin can confirm a stablecoin deposit, crediting the ledger exactly once', async () => {
    const token = await registerCedente();
    const dep = await request(app).post('/api/account/deposit/stablecoin').set('Authorization', `Bearer ${token}`).send({ valor: 3000 });
    const referencia = dep.body.instrucao.referencia as string;

    const admin = await adminToken();
    const before = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    expect(before.body.saldoDisponivelFmt).toMatch(/R\$\s*0$/);

    const confirm = await request(app).post(`/api/admin/stablecoin/${referencia}/confirmar`).set('Authorization', `Bearer ${admin}`).send({ txHash: '0xdeadbeef' });
    expect(confirm.status).toBe(200);

    const after = await request(app).get('/api/account').set('Authorization', `Bearer ${token}`);
    expect(after.body.saldoDisponivelFmt).toMatch(/3\.000/);

    const again = await request(app).post(`/api/admin/stablecoin/${referencia}/confirmar`).set('Authorization', `Bearer ${admin}`);
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('already_settled');
  });

  it('rejects confirming a non-existent reference', async () => {
    const admin = await adminToken();
    const res = await request(app).post('/api/admin/stablecoin/does-not-exist/confirmar').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(404);
  });
});

describe('Stablecoin withdrawal', () => {
  it('refuses to withdraw without a registered wallet address', async () => {
    const token = await registerCedente();
    const res = await request(app).post('/api/account/withdraw/stablecoin').set('Authorization', `Bearer ${token}`).send({ valor: 100 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('no_stablecoin_wallet');
  });

  it('registers a wallet address, then withdraws against available balance', async () => {
    const token = await registerCedente();
    const wallet = await request(app)
      .post('/api/account/kyc/wallet-stablecoin')
      .set('Authorization', `Bearer ${token}`)
      .send({ endereco: '0x1234567890abcdef1234567890abcdef12345678' });
    expect(wallet.status).toBe(200);
    expect(wallet.body.stablecoinWalletEndereco).toBe('0x1234567890abcdef1234567890abcdef12345678');

    // Fund the account first via a real code path (stablecoin deposit + admin confirm).
    const dep = await request(app).post('/api/account/deposit/stablecoin').set('Authorization', `Bearer ${token}`).send({ valor: 5000 });
    const admin = await adminToken();
    await request(app).post(`/api/admin/stablecoin/${dep.body.instrucao.referencia}/confirmar`).set('Authorization', `Bearer ${admin}`);

    const overdraw = await request(app).post('/api/account/withdraw/stablecoin').set('Authorization', `Bearer ${token}`).send({ valor: 999999 });
    expect(overdraw.status).toBe(409);
    expect(overdraw.body.error).toBe('insufficient_balance');

    const withdraw = await request(app).post('/api/account/withdraw/stablecoin').set('Authorization', `Bearer ${token}`).send({ valor: 1000 });
    expect(withdraw.status).toBe(200);
    expect(withdraw.body.saldoDisponivelFmt).toMatch(/4\.000/);
  });
});

describe('Stablecoin webhook', () => {
  it('accepts the webhook payload shape and returns 200', async () => {
    const res = await request(app).post('/api/public/stablecoin-webhook').send({ transfers: [{ referencia: 'nonexistent', valor: '100.00' }] });
    expect(res.status).toBe(200);
    expect(res.body.received).toBe(1);
  });
});
