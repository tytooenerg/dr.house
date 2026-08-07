import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { addLedgerEntry } from '../src/db/misc.js';
import { detectFracionamento, detectEntradaSaidaRapida, setStructuringThreshold, getStructuringThreshold } from '../src/lib/suspiciousActivityMonitor.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente() {
  const companyName = `Fornecedora SAR ${unique()} Ltda`;
  const res = await request(app).post('/api/auth/register').send({
    nome: 'Cedente SAR',
    email: `ced-sar-${unique()}@example.com`,
    password: 'senha123',
    companyName,
    role: 'cedente',
  });
  return { token: res.body.token as string, userId: res.body.user.id as number, companyName };
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

describe('Suspicious activity detection — deterministic rules over the real ledger', () => {
  it('flags fracionamento: 3+ deposits under the threshold summing above it', async () => {
    const { userId } = await registerCedente();
    setStructuringThreshold(30000);
    addLedgerEntry(userId, '01/01/2026', 'Depósito 1', 12000);
    addLedgerEntry(userId, '01/01/2026', 'Depósito 2', 11000);
    addLedgerEntry(userId, '01/01/2026', 'Depósito 3', 10000);
    const flagged = detectFracionamento();
    expect(flagged).toBeGreaterThanOrEqual(1);

    const admin = await adminToken();
    const res = await request(app).get('/api/admin/pld/suspeitas?status=aberto').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.body.reports.some((r: { tipo: string }) => r.tipo === 'fracionamento')).toBe(true);
  });

  it('does not flag fewer than 3 deposits, or deposits that stay under the total threshold', async () => {
    const { userId, companyName } = await registerCedente();
    setStructuringThreshold(30000);
    addLedgerEntry(userId, '01/01/2026', 'Depósito único', 25000);
    addLedgerEntry(userId, '01/01/2026', 'Depósito dois', 4000);
    detectFracionamento();

    const admin = await adminToken();
    const res = await request(app).get('/api/admin/pld/suspeitas?status=aberto').set('Authorization', `Bearer ${admin}`);
    expect(res.body.reports.some((r: { empresa: string }) => r.empresa === companyName)).toBe(false);
  });

  it('flags entrada e saída rápida: a deposit followed by a similar-sized withdrawal within 48h', async () => {
    const { userId } = await registerCedente();
    addLedgerEntry(userId, '01/01/2026', 'Depósito', 20000);
    addLedgerEntry(userId, '01/01/2026', 'Saque', -19500);
    const flagged = detectEntradaSaidaRapida();
    expect(flagged).toBeGreaterThanOrEqual(1);

    const admin = await adminToken();
    const res = await request(app).get('/api/admin/pld/suspeitas?status=aberto').set('Authorization', `Bearer ${admin}`);
    expect(res.body.reports.some((r: { tipo: string; empresa: string }) => r.tipo === 'entrada_saida_rapida')).toBe(true);
  });

  it('does not flag a deposit with no matching withdrawal, or amounts too far apart', async () => {
    const { userId, companyName } = await registerCedente();
    addLedgerEntry(userId, '01/01/2026', 'Depósito', 20000);
    addLedgerEntry(userId, '01/01/2026', 'Saque bem menor', -500);
    detectEntradaSaidaRapida();

    const admin = await adminToken();
    const res = await request(app).get('/api/admin/pld/suspeitas?status=aberto').set('Authorization', `Bearer ${admin}`);
    expect(res.body.reports.some((r: { empresa: string }) => r.empresa === companyName)).toBe(false);
  });

  it('admin can dismiss a report, and cannot review it twice', async () => {
    const { userId, companyName } = await registerCedente();
    addLedgerEntry(userId, '01/01/2026', 'Depósito', 22000);
    addLedgerEntry(userId, '01/01/2026', 'Saque', -21800);
    detectEntradaSaidaRapida();

    const admin = await adminToken();
    const list = await request(app).get('/api/admin/pld/suspeitas?status=aberto').set('Authorization', `Bearer ${admin}`);
    const report = list.body.reports.find((r: { empresa: string }) => r.empresa === companyName);
    expect(report).toBeTruthy();

    const dismiss = await request(app).post(`/api/admin/pld/suspeitas/${report.id}/descartar`).set('Authorization', `Bearer ${admin}`);
    expect(dismiss.status).toBe(200);
    const again = await request(app).post(`/api/admin/pld/suspeitas/${report.id}/descartar`).set('Authorization', `Bearer ${admin}`);
    expect(again.status).toBe(409);
  });

  it('admin can mark a report as reported to COAF with an external reference', async () => {
    const { userId } = await registerCedente();
    addLedgerEntry(userId, '01/01/2026', 'Depósito', 30000);
    addLedgerEntry(userId, '01/01/2026', 'Saque', -29700);
    detectEntradaSaidaRapida();

    const admin = await adminToken();
    const list = await request(app).get('/api/admin/pld/suspeitas?status=aberto').set('Authorization', `Bearer ${admin}`);
    const report = list.body.reports[0];

    const missingRef = await request(app).post(`/api/admin/pld/suspeitas/${report.id}/reportar`).set('Authorization', `Bearer ${admin}`).send({});
    expect(missingRef.status).toBe(400);

    const ok = await request(app)
      .post(`/api/admin/pld/suspeitas/${report.id}/reportar`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ externalReference: 'COAF-2026-000123' });
    expect(ok.status).toBe(200);
  });

  it('threshold is admin-configurable and persists', async () => {
    const admin = await adminToken();
    const res = await request(app).put('/api/admin/pld/suspeitas/threshold').set('Authorization', `Bearer ${admin}`).send({ threshold: 75000 });
    expect(res.status).toBe(200);
    expect(res.body.threshold).toBe(75000);
    expect(getStructuringThreshold()).toBe(75000);
  });

  it('manual scan endpoint runs both rules and is audited', async () => {
    const admin = await adminToken();
    const res = await request(app).post('/api/admin/pld/suspeitas/scan').set('Authorization', `Bearer ${admin}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.fracionamento).toBe('number');
    expect(typeof res.body.entradaSaidaRapida).toBe('number');
  });

  it('non-admin cannot reach the PLD endpoints', async () => {
    const { token } = await registerCedente();
    const res = await request(app).get('/api/admin/pld/suspeitas').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
