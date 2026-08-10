import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { createAgentRun, createPendingAction } from '../src/db/agents.js';

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

describe('KYB pre-triage (Onboarding agent)', () => {
  it('submitting KYB never blocks on the agent — no ANTHROPIC_API_KEY in tests, so no run is created and the endpoint still returns fast', async () => {
    const email = `inv-${unique()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Sem IA', email, password: 'senha123', companyName: 'Fundo Sem IA', role: 'investidor' });
    const kyb = await request(app)
      .post('/api/auth/kyb')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ cnpj: '22.333.444/0001-55', tipo: 'Fundo (FIDC)', pl: '5.000.000' });
    expect(kyb.status).toBe(200);

    const tok = await adminToken();
    const list = await request(app).get('/api/admin/kyb').set('Authorization', `Bearer ${tok}`);
    const entry = list.body.pending.find((p: { email: string }) => p.email === email);
    expect(entry).toBeTruthy();
    expect(entry.aiTriage).toBeNull();
  });

  it('surfaces an existing onboarding-agent run and lets the admin confirm its recommendation from the KYB queue', async () => {
    const email = `inv-${unique()}@example.com`;
    const reg = await request(app)
      .post('/api/auth/register')
      .send({ nome: 'Com IA', email, password: 'senha123', companyName: 'Fundo Com IA', role: 'investidor' });
    const userId = reg.body.user.id as number;
    await request(app)
      .post('/api/auth/kyb')
      .set('Authorization', `Bearer ${reg.body.token}`)
      .send({ cnpj: '22.333.444/0001-66', tipo: 'Fundo (FIDC)', pl: '5.000.000' });

    // Simulate what the fire-and-forget trigger would have produced had ANTHROPIC_API_KEY
    // been configured — same tables, same shape.
    const runId = createAgentRun({ agentId: 'onboarding', userId: null, subjectType: 'user', subjectId: String(userId), input: 'teste', mode: 'llm' });
    const pendingId = createPendingAction({ runId, agentId: 'onboarding', toolName: 'aprovar_kyb', input: { userId } });

    const tok = await adminToken();
    const list = await request(app).get('/api/admin/kyb').set('Authorization', `Bearer ${tok}`);
    const entry = list.body.pending.find((p: { email: string }) => p.email === email);
    expect(entry.aiTriage).toMatchObject({ runId, pendingActionId: pendingId, pendingActionTool: 'aprovar_kyb' });

    const confirm = await request(app).post(`/api/agents/pending/${pendingId}/approve`).set('Authorization', `Bearer ${tok}`).send({});
    expect(confirm.status).toBe(200);

    const login = await request(app).post('/api/auth/login').send({ email, password: 'senha123' });
    expect(login.body.user.kybStatus).toBe('approved');
  });
});
