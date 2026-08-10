import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { createUser } from '../src/db/users.js';
import { hashPassword } from '../src/auth/password.js';
import { createAgentRun, createPendingAction, getPendingAction } from '../src/db/agents.js';
import { setAgentEnabled, setAgentDailyBudgetUsd, setDualApprovalThresholdBrl, getDualApprovalThresholdBrl } from '../src/lib/agentGovernance.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

// Public registration can't create an admin — build a second one directly, same as the
// seeded admin@lastro.demo, to prove dual-approval needs two *distinct* admins.
async function secondAdminToken() {
  const email = `admin2-${unique()}@lastro.demo`;
  createUser({ email, passwordHash: await hashPassword('demo1234'), nome: 'Segundo Admin', companyName: 'Lastro', role: 'admin' });
  const res = await request(app).post('/api/auth/login').send({ email, password: 'demo1234' });
  return res.body.token as string;
}

describe('agent governance — kill switch', () => {
  it('refuses to run a disabled agent, without spending anything', async () => {
    const tok = await adminToken();
    await request(app).put('/api/agents/governance/underwriting').set('Authorization', `Bearer ${tok}`).send({ enabled: false });

    const res = await request(app).post('/api/agents/underwriting/run').set('Authorization', `Bearer ${tok}`).send({ input: 'teste' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('desabilitado');

    // Re-enable so it doesn't leak into other tests/suites sharing this in-memory db.
    await request(app).put('/api/agents/governance/underwriting').set('Authorization', `Bearer ${tok}`).send({ enabled: true });
  });

  it('is admin-only', async () => {
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Cedente Teste', email: `u-${unique()}@example.com`, password: 'senha123', companyName: 'X Ltda', role: 'cedente' });
    const res = await request(app).put('/api/agents/governance/underwriting').set('Authorization', `Bearer ${reg.body.token}`).send({ enabled: false });
    expect(res.status).toBe(403);
  });
});

describe('agent governance — daily budget', () => {
  it('refuses to run once the configured daily budget is spent (0 counts as already exceeded)', async () => {
    const tok = await adminToken();
    await request(app).put('/api/agents/governance/regulatorio').set('Authorization', `Bearer ${tok}`).send({ dailyBudgetUsd: 0 });

    const res = await request(app).post('/api/agents/regulatorio/run').set('Authorization', `Bearer ${tok}`).send({ input: 'teste' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('orcamento_excedido');

    await request(app).put('/api/agents/governance/regulatorio').set('Authorization', `Bearer ${tok}`).send({ dailyBudgetUsd: null });
  });

  it('reports settings via GET /agents/governance', async () => {
    const tok = await adminToken();
    setAgentDailyBudgetUsd('pld', 5);
    const res = await request(app).get('/api/agents/governance').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    const pld = res.body.agents.find((a: { id: string }) => a.id === 'pld');
    expect(pld.dailyBudgetUsd).toBe(5);
    setAgentDailyBudgetUsd('pld', null);
  });
});

describe('agent governance — dual approval for high-value actions', () => {
  it('requires two distinct admins once the pending action is above the configured threshold', async () => {
    setDualApprovalThresholdBrl(50_000);
    const runId = createAgentRun({ agentId: 'autobid', userId: null, subjectType: null, subjectId: null, input: 'teste', mode: 'llm' });
    const pendingId = createPendingAction({
      runId,
      agentId: 'autobid',
      toolName: 'comprar_oferta',
      input: { userId: 1, duplicataId: 'dup_teste' },
      approvalsRequired: 2,
    });

    const admin1 = await adminToken();
    const first = await request(app).post(`/api/agents/pending/${pendingId}/approve`).set('Authorization', `Bearer ${admin1}`).send({});
    expect(first.status).toBe(200);
    expect(first.body.waitingForMoreApprovals).toBe(true);
    expect(first.body.approvalsSoFar).toBe(1);
    // Still pending — the real handler has not run yet.
    expect(getPendingAction(pendingId)!.status).toBe('pendente');

    // Same admin approving twice doesn't count twice.
    const repeat = await request(app).post(`/api/agents/pending/${pendingId}/approve`).set('Authorization', `Bearer ${admin1}`).send({});
    expect(repeat.status).toBe(409);
    expect(getPendingAction(pendingId)!.status).toBe('pendente');

    const admin2 = await secondAdminToken();
    const second = await request(app).post(`/api/agents/pending/${pendingId}/approve`).set('Authorization', `Bearer ${admin2}`).send({});
    // A duplicata that doesn't exist makes the underlying handler throw, but the important
    // assertion is that it actually tried — proving the second approval was the one that
    // triggered execution, not another silent no-op.
    expect([200, 500]).toContain(second.status);
    expect(getPendingAction(pendingId)!.status).toBe('aprovada');
  });

  it('single-approval tools (below threshold, or no monetary value) still execute on the first admin approval', async () => {
    setDualApprovalThresholdBrl(50_000);
    expect(getDualApprovalThresholdBrl()).toBe(50_000);
    const runId = createAgentRun({ agentId: 'regulatorio', userId: null, subjectType: null, subjectId: null, input: 'teste', mode: 'llm' });
    const pendingId = createPendingAction({
      runId,
      agentId: 'regulatorio',
      toolName: 'registrar_nota',
      input: { titulo: 't', texto: 'x', resumo: 'r' },
      approvalsRequired: 1,
    });
    const tok = await adminToken();
    const res = await request(app).post(`/api/agents/pending/${pendingId}/approve`).set('Authorization', `Bearer ${tok}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.waitingForMoreApprovals).toBeUndefined();
    expect(getPendingAction(pendingId)!.status).toBe('aprovada');
  });
});
