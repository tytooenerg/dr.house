import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { createPixCharge, concludePixCharge } from '../src/db/pix.js';
import { createBoleto, concludeBoleto } from '../src/db/boletos.js';
import { addLedgerEntry } from '../src/db/misc.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente() {
  const email = `ced-reconcile-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente Reconcile', email, password: 'senha123', companyName: `Empresa Reconcile ${unique()}`, role: 'cedente' });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

describe('Reconciliation Agent', () => {
  it('requires admin role', async () => {
    const { token } = await registerCedente();
    const res = await request(app).get('/api/reconciliation/flags').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  it('flags a confirmed Pix payment with no matching ledger entry', async () => {
    const { userId } = await registerCedente();
    const txid = `pix-${unique()}`;
    const valor = 12345.67;
    createPixCharge({ txid, userId, valor, simulado: false, brcode: null });
    concludePixCharge(txid, `e2e-${unique()}`);

    const admin = await adminToken();
    const run = await request(app).post('/api/reconciliation/run').set('Authorization', `Bearer ${admin}`);
    expect(run.status).toBe(200);
    expect(run.body.checked).toBeGreaterThan(0);
    expect(run.body.newlyFlagged).toBeGreaterThan(0);

    const flags = await request(app).get('/api/reconciliation/flags').set('Authorization', `Bearer ${admin}`);
    const flag = flags.body.flags.find((f: { referencia: string }) => f.referencia === txid);
    expect(flag).toBeTruthy();
    expect(flag.tipo).toBe('pix');
    expect(flag.status).toBe('aberta');
  });

  it('does not flag a confirmed boleto that has a matching ledger entry', async () => {
    const { userId } = await registerCedente();
    const nossoNumero = `bol-${unique()}`;
    const valor = 999.5;
    createBoleto({ nossoNumero, userId, valor, simulado: false, linhaDigitavel: null, codigoBarras: null, pdfUrl: null });
    concludeBoleto(nossoNumero);
    addLedgerEntry(userId, new Date().toISOString().slice(0, 10), `Boleto recebido ${nossoNumero}`, valor);

    const admin = await adminToken();
    await request(app).post('/api/reconciliation/run').set('Authorization', `Bearer ${admin}`);

    const flags = await request(app).get('/api/reconciliation/flags').set('Authorization', `Bearer ${admin}`);
    const flag = flags.body.flags.find((f: { referencia: string }) => f.referencia === nossoNumero);
    expect(flag).toBeUndefined();
  });

  it('resolves an open flag and it no longer appears among open flags', async () => {
    const { userId } = await registerCedente();
    const txid = `pix-resolve-${unique()}`;
    createPixCharge({ txid, userId, valor: 555, simulado: false, brcode: null });
    concludePixCharge(txid, null);

    const admin = await adminToken();
    await request(app).post('/api/reconciliation/run').set('Authorization', `Bearer ${admin}`);
    const before = await request(app).get('/api/reconciliation/flags').set('Authorization', `Bearer ${admin}`);
    const flag = before.body.flags.find((f: { referencia: string }) => f.referencia === txid);
    expect(flag).toBeTruthy();

    const resolve = await request(app).post(`/api/reconciliation/flags/${flag.id}/resolver`).set('Authorization', `Bearer ${admin}`);
    expect(resolve.status).toBe(200);

    const after = await request(app).get('/api/reconciliation/flags').set('Authorization', `Bearer ${admin}`);
    const updated = after.body.flags.find((f: { id: number }) => f.id === flag.id);
    expect(updated.status).toBe('resolvida');
  });

  it('404s resolving a flag that does not exist', async () => {
    const admin = await adminToken();
    const res = await request(app).post('/api/reconciliation/flags/999999999/resolver').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(404);
  });
});
