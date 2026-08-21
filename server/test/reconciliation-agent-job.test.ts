import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { createPixCharge, concludePixCharge } from '../src/db/pix.js';
import { runReconciliationScan } from '../src/lib/reconciliationAgentJob.js';
import { setFeatureFlag } from '../src/lib/featureFlags.js';
import { listAuditLog } from '../src/db/audit.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function registerCedente() {
  const email = `ced-reconjob-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente ReconJob', email, password: 'senha123', companyName: `Empresa ReconJob ${unique()}`, role: 'cedente' });
  return { userId: res.body.user.id as number };
}

describe('Reconciliation Agent — periodic scan (lib/reconciliationAgentJob.ts)', () => {
  it('runs the same deterministic check as the manual trigger and flags an unmatched Pix confirmation', async () => {
    const { userId } = await registerCedente();
    const txid = `pix-job-${unique()}`;
    createPixCharge({ txid, userId, valor: 4321, simulado: false, brcode: null });
    concludePixCharge(txid, null);

    const result = runReconciliationScan();
    expect(result.checked).toBeGreaterThan(0);
    expect(result.newlyFlagged).toBeGreaterThan(0);

    // Runs with a null actor (no human triggered it) and still lands in the tamper-evident
    // audit log, same discipline as every other automated job in this codebase.
    const entries = listAuditLog(20);
    const entry = entries.find((e) => e.action === 'reconciliation.run' && JSON.parse(e.payload).automatico === true);
    expect(entry).toBeTruthy();
    expect(entry!.actor_user_id).toBeNull();
  });

  it('is a documented no-op when the reconciliation_agent feature flag is disabled', async () => {
    const admin = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
    setFeatureFlag('reconciliation_agent', false, 100, admin.body.user.id);
    try {
      const result = runReconciliationScan();
      expect(result).toEqual({ checked: 0, matched: 0, newlyFlagged: 0 });
    } finally {
      setFeatureFlag('reconciliation_agent', true, 100, admin.body.user.id);
    }
  });
});
