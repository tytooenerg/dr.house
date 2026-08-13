import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { AGENTS } from '../src/lib/agents/index.js';
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

describe('agentic AI layer — registry', () => {
  it('registers exactly the 12 agents, each with at least one tool and a description', () => {
    const ids = Object.keys(AGENTS);
    expect(ids).toHaveLength(12);
    for (const id of ids) {
      const def = AGENTS[id];
      expect(def.label.length).toBeGreaterThan(0);
      expect(def.systemPrompt.length).toBeGreaterThan(0);
      expect(def.tools.length).toBeGreaterThan(0);
    }
  });

  it('marks every tool that writes real data as sensitive (human-approval gated)', () => {
    // Every write tool in this codebase's agents is deliberately gated — this is the one
    // hard rule the "onde implantar IA agentic" answer promised, so pin it in a test
    // rather than only in a code comment. Read-only investigation tools are the complement.
    const writeToolNames = new Set([
      'emitir_duplicata',
      'sinalizar_pld',
      'escalar_cobranca',
      'resolver_disputa',
      'registrar_nota',
      'aprovar_kyb',
      'rejeitar_kyb',
      'comprar_oferta',
      'reenviar_lembrete_aceite',
      'registrar_nota_comercial',
      'dar_lance_liquidez',
    ]);
    for (const def of Object.values(AGENTS)) {
      for (const tool of def.tools) {
        if (writeToolNames.has(tool.name)) expect(tool.sensitive, `${def.id}.${tool.name} should be sensitive`).toBe(true);
      }
    }
  });
});

describe('agentic AI layer — API authorization', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/agents');
    expect(res.status).toBe(401);
  });

  it('lists all 12 agents for an admin', async () => {
    const tok = await adminToken();
    const res = await request(app).get('/api/agents').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.agents).toHaveLength(12);
    expect(typeof res.body.llmEnabled).toBe('boolean');
  });
});

describe('agentic AI layer — self-service scoping (cedente/investidor)', () => {
  async function registerAndLogin(role: 'cedente' | 'investidor') {
    const email = `${role}-${unique()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Self Service', email, password: 'senha123', companyName: `${role} Ltda`, role });
    return { token: reg.body.token as string, userId: reg.body.user.id as number, email };
  }

  it('only exposes the agent(s) allowed for that role, never the full 12', async () => {
    const { token } = await registerAndLogin('cedente');
    const res = await request(app).get('/api/agents').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.agents.map((a: { id: string }) => a.id).sort()).toEqual(['emissao', 'suporte']);

    const inv = await registerAndLogin('investidor');
    const res2 = await request(app).get('/api/agents').set('Authorization', `Bearer ${inv.token}`);
    expect(res2.body.agents.map((a: { id: string }) => a.id)).toEqual(['autobid', 'market_maker']);
  });

  it('lets a cedente run the emissão agent on itself, but not the pld agent', async () => {
    const { token } = await registerAndLogin('cedente');
    const ok = await request(app).post('/api/agents/emissao/run').set('Authorization', `Bearer ${token}`).send({ input: 'emita uma duplicata teste' });
    expect(ok.status).toBe(200);
    expect(ok.body.mode).toBe('simulado'); // no ANTHROPIC_API_KEY in tests — still proves the route accepted the role

    const blocked = await request(app).post('/api/agents/pld/run').set('Authorization', `Bearer ${token}`).send({ input: 'investigue essa empresa' });
    expect(blocked.status).toBe(403);
  });

  it('ignores actingUserId from a non-admin caller — always forced onto their own account', async () => {
    const { token, userId } = await registerAndLogin('cedente');
    const other = await registerAndLogin('cedente');
    const res = await request(app)
      .post('/api/agents/emissao/run')
      .set('Authorization', `Bearer ${token}`)
      .send({ input: 'teste', actingUserId: other.userId });
    expect(res.status).toBe(200);
    // The run was recorded under the caller's own id, not the id they tried to impersonate.
    const runsRes = await request(app).get('/api/agents/runs').set('Authorization', `Bearer ${token}`);
    expect(runsRes.body.runs[0].user_id).toBe(userId);
    expect(runsRes.body.runs[0].user_id).not.toBe(other.userId);
  });

  it('lets the owning cedente approve their own selfApprovable pending action, but not another sensitive tool', async () => {
    const { token, userId } = await registerAndLogin('cedente');
    const runId = createAgentRun({ agentId: 'emissao', userId, subjectType: null, subjectId: null, input: 'teste', mode: 'llm' });
    const ownPending = createPendingAction({
      runId,
      agentId: 'emissao',
      toolName: 'emitir_duplicata',
      input: { sacado: 'Teste Ltda', valor: '1.000,00', vencimento: '2030-01-01' },
    });

    // Another cedente cannot touch it.
    const stranger = await registerAndLogin('cedente');
    const strangerAttempt = await request(app).post(`/api/agents/pending/${ownPending}/approve`).set('Authorization', `Bearer ${stranger.token}`).send({});
    expect(strangerAttempt.status).toBe(403);

    // The owner can — same effect a manual "Emitir" submit would have.
    const approved = await request(app).post(`/api/agents/pending/${ownPending}/approve`).set('Authorization', `Bearer ${token}`).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.ok).toBe(true);

    // A non-selfApprovable sensitive tool (even on the caller's own run) still requires admin.
    const pldRunId = createAgentRun({ agentId: 'pld', userId, subjectType: null, subjectId: null, input: 'teste', mode: 'llm' });
    const pldPending = createPendingAction({ runId: pldRunId, agentId: 'pld', toolName: 'sinalizar_pld', input: { userId, descricao: 'x' } });
    const selfApproveAttempt = await request(app).post(`/api/agents/pending/${pldPending}/approve`).set('Authorization', `Bearer ${token}`).send({});
    expect(selfApproveAttempt.status).toBe(403);
  });
});

describe('agentic AI layer — run without ANTHROPIC_API_KEY', () => {
  it('runs honestly in simulated mode instead of pretending to reason (no key configured in tests)', async () => {
    const tok = await adminToken();
    const res = await request(app)
      .post('/api/agents/underwriting/run')
      .set('Authorization', `Bearer ${tok}`)
      .send({ input: 'Avalie o risco do sacado CNPJ 11.222.333/0001-44' });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('simulado');
    expect(res.body.status).toBe('simulado');
    expect(res.body.pendingActions).toHaveLength(0);
    expect(res.body.summary).toMatch(/ANTHROPIC_API_KEY/);
  });

  it('404s for an unknown agent id', async () => {
    const tok = await adminToken();
    const res = await request(app).post('/api/agents/nao_existe/run').set('Authorization', `Bearer ${tok}`).send({ input: 'oi' });
    expect(res.status).toBe(404);
  });

  it('validates the run input', async () => {
    const tok = await adminToken();
    const res = await request(app).post('/api/agents/underwriting/run').set('Authorization', `Bearer ${tok}`).send({ input: '' });
    expect(res.status).toBe(400);
  });
});

describe('agentic AI layer — human approval gate', () => {
  it('never executes a sensitive tool until an admin approves it, and rejection never executes it', async () => {
    const tok = await adminToken();
    const runId = createAgentRun({ agentId: 'pld', userId: null, subjectType: null, subjectId: null, input: 'teste', mode: 'llm' });
    const pendingId = createPendingAction({ runId, agentId: 'pld', toolName: 'sinalizar_pld', input: { userId: 999999, descricao: 'teste' } });

    const list = await request(app).get('/api/agents/pending').set('Authorization', `Bearer ${tok}`);
    expect(list.body.pending.some((p: { id: number }) => p.id === pendingId)).toBe(true);

    // Reject: the account referenced doesn't exist, so approval would fail anyway — reject
    // path is what we're proving never calls the handler.
    const rejected = await request(app).post(`/api/agents/pending/${pendingId}/reject`).set('Authorization', `Bearer ${tok}`).send({ note: 'não procede' });
    expect(rejected.status).toBe(200);
    expect(getPendingAction(pendingId)!.status).toBe('rejeitada');

    // Approving an already-decided action is refused, not silently re-run.
    const again = await request(app).post(`/api/agents/pending/${pendingId}/approve`).set('Authorization', `Bearer ${tok}`).send({});
    expect(again.status).toBe(409);
  });

  it('executes the real handler only on approval, against a real account', async () => {
    const tok = await adminToken();
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Sinalizado', email: `pld-${unique()}@example.com`, password: 'senha123', companyName: 'Suspeita Ltda', role: 'cedente' });
    const targetUserId = reg.body.user.id as number;

    const runId = createAgentRun({ agentId: 'pld', userId: null, subjectType: 'user', subjectId: String(targetUserId), input: 'teste', mode: 'llm' });
    const pendingId = createPendingAction({
      runId,
      agentId: 'pld',
      toolName: 'sinalizar_pld',
      input: { userId: targetUserId, descricao: 'Evidência real levantada em teste automatizado' },
    });

    const approved = await request(app).post(`/api/agents/pending/${pendingId}/approve`).set('Authorization', `Bearer ${tok}`).send({});
    expect(approved.status).toBe(200);
    expect(approved.body.ok).toBe(true);
    expect(getPendingAction(pendingId)!.status).toBe('aprovada');

    // The real handler ran (not just the pending-action bookkeeping) — the account's
    // pld_status actually flipped to 'flagged', visible on the next login.
    const loginAsFlagged = await request(app).post('/api/auth/login').send({ email: reg.body.user.email, password: 'senha123' });
    expect(loginAsFlagged.body.user.pldStatus).toBe('flagged');
  });
});
