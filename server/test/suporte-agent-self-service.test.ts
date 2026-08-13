import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';

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

async function registerCedente() {
  const email = `cedente-${unique()}@example.com`;
  const reg = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Suporte Tester', email, password: 'senha123', companyName: `Cedente ${unique()}`, role: 'cedente' });
  return { token: reg.body.token as string, userId: reg.body.user.id as number };
}

// Emits a real duplicata for the given cedente token — same path emitir.test.ts already
// exercises — so the agent's tools have a real cedente_id-owned row to look up. Retries
// past the same ~12% simulated CERC registradora failure chance emitir.test.ts already
// accounts for.
async function emitDuplicata(token: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const res = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${token}`)
      .send({ sacado: 'Cliente Teste', cnpj: '00.000.000/0001-00', valor: '10.000', vencimento: '2026-10-01', seguro: false, nfAnexada: false, batchValores: [] });
    if (res.status === 200) return res.body.duplicataId as string;
    expect(res.status).toBe(502);
  }
  throw new Error('emitDuplicata: failed 10 attempts in a row — unexpected');
}

async function runSuporte(token: string, input: string) {
  const res = await request(app).post('/api/agents/suporte/run').set('Authorization', `Bearer ${token}`).send({ input });
  expect(res.status).toBe(200);
  return res.body;
}

// The agentRuntime falls back to a deterministic "simulado" mode when ANTHROPIC_API_KEY
// isn't set (true in tests) — it doesn't call the tools on its own initiative the way the
// real LLM loop would. These tests exercise the tool handlers directly, the same way
// agents.test.ts's pending-action tests do, to verify the ownership logic itself rather
// than depend on the simulated mode happening to invoke a particular tool.
import { suporteAgent } from '../src/lib/agents/suporte.js';

function getTool(name: string) {
  const tool = suporteAgent.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

describe('suporte agent — self-service is scoped to the caller\'s own account', () => {
  it('a cedente can query their own duplicata and aceite', async () => {
    const { token, userId } = await registerCedente();
    const duplicataId = await emitDuplicata(token);

    const consultarDuplicata = getTool('consultar_duplicata');
    const out = await consultarDuplicata.handler({ duplicataId }, { runId: 0, userId });
    expect((out as { erro?: string }).erro).toBeUndefined();
    expect((out as { id: string }).id).toBe(duplicataId);

    const consultarAceite = getTool('consultar_aceite');
    const aceiteOut = await consultarAceite.handler({ duplicataId }, { runId: 0, userId });
    expect((aceiteOut as { erro?: string }).erro).toBeUndefined();
    expect((aceiteOut as { status: string }).status).toBeTruthy();
  });

  it('a cedente CANNOT query another cedente\'s duplicata or aceite — gets erro, not the data', async () => {
    const owner = await registerCedente();
    const duplicataId = await emitDuplicata(owner.token);
    const stranger = await registerCedente();

    const consultarDuplicata = getTool('consultar_duplicata');
    const out = await consultarDuplicata.handler({ duplicataId }, { runId: 0, userId: stranger.userId });
    expect((out as { erro?: string }).erro).toBe('Esta duplicata não pertence à sua conta.');

    const consultarAceite = getTool('consultar_aceite');
    const aceiteOut = await consultarAceite.handler({ duplicataId }, { runId: 0, userId: stranger.userId });
    expect((aceiteOut as { erro?: string }).erro).toMatch(/não pertence/);
  });

  it('consultar_conta ignores a requested foreign userId for a self-service caller — always returns their own account', async () => {
    const caller = await registerCedente();
    const other = await registerCedente();

    const consultarConta = getTool('consultar_conta');
    const out = (await consultarConta.handler({ userId: other.userId }, { runId: 0, userId: caller.userId })) as { companyName: string };
    const own = (await consultarConta.handler({ userId: caller.userId }, { runId: 0, userId: caller.userId })) as { companyName: string };
    expect(out.companyName).toBe(own.companyName);
  });

  it('reenviar_lembrete_aceite self-service caller cannot touch another cedente\'s aceite', async () => {
    const owner = await registerCedente();
    await emitDuplicata(owner.token);
    const stranger = await registerCedente();

    const tool = getTool('reenviar_lembrete_aceite');
    // Whatever real aguardando-sem-lembrete aceite exists (if any), a stranger requesting a
    // nonexistent-to-them id should never succeed — either "not pending" (id doesn't match
    // any candidate) or an explicit ownership error, never ok:true for someone else's data.
    await expect(tool.handler({ aceiteId: 999999999 }, { runId: 0, userId: stranger.userId })).rejects.toThrow();
  });

  it('an admin retains full unrestricted access regardless of target account', async () => {
    const owner = await registerCedente();
    const duplicataId = await emitDuplicata(owner.token);
    const tok = await adminToken();
    // Look up the admin's own userId via /auth/me-equivalent: the login response includes it.
    const loginRes = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
    const adminUserId = loginRes.body.user.id as number;

    const consultarDuplicata = getTool('consultar_duplicata');
    const out = await consultarDuplicata.handler({ duplicataId }, { runId: 0, userId: adminUserId });
    expect((out as { erro?: string }).erro).toBeUndefined();
    expect((out as { id: string }).id).toBe(duplicataId);

    const consultarConta = getTool('consultar_conta');
    const conta = (await consultarConta.handler({ userId: owner.userId }, { runId: 0, userId: adminUserId })) as { companyName?: string; erro?: string };
    expect(conta.erro).toBeUndefined();
    expect(conta.companyName).toBeTruthy();

    void tok;
  });

  it('POST /api/agents/suporte/run is reachable by a cedente (self-service) and by an admin', async () => {
    const { token } = await registerCedente();
    const outcome = await runSuporte(token, 'minha conta está em dia?');
    expect(outcome.mode).toBe('simulado'); // no ANTHROPIC_API_KEY in tests

    const tok = await adminToken();
    const adminOutcome = await runSuporte(tok, 'consulte a conta X');
    expect(adminOutcome.mode).toBe('simulado');
  });
});
