import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { createPendingAction, getPendingAction, createAgentRun } from '../src/db/agents.js';

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

async function registerInvestidor() {
  const email = `bulk-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Bulk Tester', email, password: 'senha123', companyName: `Fundo ${unique()}`, role: 'investidor' });
  return res.body.token as string;
}

// POST /agents/pending/approve-bulk — one human click firing N real approvals, not a new
// execution path around the "sensitive tool never auto-executes" rule (see the route's own
// comment in routes/agents.ts): each id still goes through the exact same
// executeApprovedTool() call and gets its own audit_log entry, this just removes the toil
// of clicking through an otherwise-obviously-clean queue one row at a time.
describe('POST /agents/pending/approve-bulk', () => {
  it('admin-only', async () => {
    const token = await registerInvestidor();
    const res = await request(app).post('/api/agents/pending/approve-bulk').set('Authorization', `Bearer ${token}`).send({ ids: [1] });
    expect(res.status).toBe(403);
  });

  it('rejects an empty list and a list over the 50-id cap', async () => {
    const tok = await adminToken();
    const empty = await request(app).post('/api/agents/pending/approve-bulk').set('Authorization', `Bearer ${tok}`).send({ ids: [] });
    expect(empty.status).toBe(400);
    const tooMany = await request(app)
      .post('/api/agents/pending/approve-bulk')
      .set('Authorization', `Bearer ${tok}`)
      .send({ ids: Array.from({ length: 51 }, (_, i) => i + 1) });
    expect(tooMany.status).toBe(400);
  });

  it('approves and really executes multiple pending actions in one call, each with its own real outcome', async () => {
    const tok = await adminToken();

    const reg1 = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Sinalizado 1', email: `bulk-pld-${unique()}@example.com`, password: 'senha123', companyName: 'Suspeita Bulk 1 Ltda', role: 'cedente' });
    const reg2 = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Sinalizado 2', email: `bulk-pld-${unique()}@example.com`, password: 'senha123', companyName: 'Suspeita Bulk 2 Ltda', role: 'cedente' });

    const runId1 = createAgentRun({ agentId: 'pld', userId: null, subjectType: 'user', subjectId: String(reg1.body.user.id), input: 'teste', mode: 'llm' });
    const runId2 = createAgentRun({ agentId: 'pld', userId: null, subjectType: 'user', subjectId: String(reg2.body.user.id), input: 'teste', mode: 'llm' });
    const pendingId1 = createPendingAction({ runId: runId1, agentId: 'pld', toolName: 'sinalizar_pld', input: { userId: reg1.body.user.id, descricao: 'Evidência 1' } });
    const pendingId2 = createPendingAction({ runId: runId2, agentId: 'pld', toolName: 'sinalizar_pld', input: { userId: reg2.body.user.id, descricao: 'Evidência 2' } });
    // A third id that doesn't exist — the batch must report it individually, not fail the
    // whole request.
    const bogusId = pendingId2 + 999999;

    const res = await request(app)
      .post('/api/agents/pending/approve-bulk')
      .set('Authorization', `Bearer ${tok}`)
      .send({ ids: [pendingId1, pendingId2, bogusId] });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(3);
    expect(res.body.sucesso).toBe(2);
    expect(res.body.resultados.find((r: { id: number }) => r.id === pendingId1).ok).toBe(true);
    expect(res.body.resultados.find((r: { id: number }) => r.id === pendingId2).ok).toBe(true);
    expect(res.body.resultados.find((r: { id: number }) => r.id === bogusId).ok).toBe(false);

    expect(getPendingAction(pendingId1)!.status).toBe('aprovada');
    expect(getPendingAction(pendingId2)!.status).toBe('aprovada');

    // The real handler ran for both, not just the pending-action bookkeeping.
    const login1 = await request(app).post('/api/auth/login').send({ email: reg1.body.user.email, password: 'senha123' });
    const login2 = await request(app).post('/api/auth/login').send({ email: reg2.body.user.email, password: 'senha123' });
    expect(login1.body.user.pldStatus).toBe('flagged');
    expect(login2.body.user.pldStatus).toBe('flagged');
  });

  it('skips an already-decided id in the batch without failing the others', async () => {
    const tok = await adminToken();
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Já Decidido', email: `bulk-decided-${unique()}@example.com`, password: 'senha123', companyName: 'Já Decidido Ltda', role: 'cedente' });
    const runId = createAgentRun({ agentId: 'pld', userId: null, subjectType: 'user', subjectId: String(reg.body.user.id), input: 'teste', mode: 'llm' });
    const pendingId = createPendingAction({ runId, agentId: 'pld', toolName: 'sinalizar_pld', input: { userId: reg.body.user.id, descricao: 'Evidência' } });

    await request(app).post(`/api/agents/pending/${pendingId}/reject`).set('Authorization', `Bearer ${tok}`).send({});

    const res = await request(app).post('/api/agents/pending/approve-bulk').set('Authorization', `Bearer ${tok}`).send({ ids: [pendingId] });
    expect(res.status).toBe(200);
    expect(res.body.sucesso).toBe(0);
    expect(res.body.resultados[0].ok).toBe(false);
    expect(res.body.resultados[0].error).toBe('already_decided');
  });
});
