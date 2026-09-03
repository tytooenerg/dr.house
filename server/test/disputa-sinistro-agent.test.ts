import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { disputaSinistroAgent } from '../src/lib/agents/disputaSinistro.js';
import { getDispute } from '../src/db/disputes.js';

// Cobre a ligação do agente disputa_sinistro com a fila real de arbitragem do admin
// (DisputasPanel.tsx embute SelfServiceAgentCard com agentId="disputa_sinistro") — o
// agente em si (tools, prompts) já era coberto indiretamente por agents.test.ts, mas
// nada testava um admin de fato rodando este agente contra uma disputa real, nem que
// resolver_disputa resolve a mesma disputa que a arbitragem manual resolve.

beforeAll(async () => {
  await seedIfEmpty();
});

function unique(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function register(role: 'cedente' | 'sacado', companyName: string) {
  const email = `${unique(role)}@example.com`;
  const res = await request(app).post('/api/auth/register').send({ nome: 'Teste', email, password: 'senha123', companyName, role });
  return { token: res.body.token as string, userId: res.body.user.id as number };
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

function getTool(name: string) {
  const tool = disputaSinistroAgent.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

// Cria uma disputa real: cedente emite, sacado contesta o aceite (mesmo fluxo de
// aceites-disputas.test.ts).
async function criarDisputaAberta() {
  const sacadoCompany = unique('Sacado Disputa Agente');
  const { token: sacadoToken } = await register('sacado', sacadoCompany);
  const { token: cedenteToken } = await register('cedente', unique('Cedente Disputa Agente'));

  let emitStatus = 0;
  for (let attempt = 0; attempt < 5 && emitStatus !== 200; attempt++) {
    const emit = await request(app)
      .post('/api/emitir/submit')
      .set('Authorization', `Bearer ${cedenteToken}`)
      .send({ sacado: sacadoCompany, cnpj: '55.555.555/0001-55', valor: '12.000', vencimento: '2026-12-01', seguro: false, nfAnexada: false, batchValores: [] });
    emitStatus = emit.status;
  }
  expect(emitStatus).toBe(200);

  const sacadoAceites = await request(app).get('/api/aceites').set('Authorization', `Bearer ${sacadoToken}`);
  const pending = sacadoAceites.body.aceites.find((a: { status: string }) => a.status === 'aguardando');
  expect(pending).toBeTruthy();
  const contest = await request(app).post(`/api/aceites/${pending.id}/status`).set('Authorization', `Bearer ${sacadoToken}`).send({ status: 'contestada' });
  expect(contest.status).toBe(200);

  const disputes = await request(app).get('/api/disputas').set('Authorization', `Bearer ${cedenteToken}`);
  const dispute = disputes.body.disputes[0];
  expect(dispute).toBeDefined();
  return dispute.id as number;
}

describe('Agente disputa_sinistro — conectado à fila real do admin', () => {
  it('an admin can run the agent against the registry generic route (POST /api/agents/disputa_sinistro/run)', async () => {
    const tok = await adminToken();
    const res = await request(app).post('/api/agents/disputa_sinistro/run').set('Authorization', `Bearer ${tok}`).send({ input: 'liste as disputas abertas' });
    expect(res.status).toBe(200);
    // Sem ANTHROPIC_API_KEY no ambiente de teste, o agente cai no modo simulado — nenhuma
    // ferramenta é executada sozinha, o que é o comportamento esperado (real-when-configured).
    expect(res.body.mode).toBe('simulado');
  });

  it('listar_disputas_abertas and avaliar_disputa surface the real dispute a manual arbitration would see', async () => {
    const disputaId = await criarDisputaAberta();

    const abertas = (await getTool('listar_disputas_abertas').handler({}, { runId: 0 })) as { id: number }[];
    expect(abertas.some((d) => d.id === disputaId)).toBe(true);

    const avaliacao = (await getTool('avaliar_disputa').handler({ disputaId }, { runId: 0 })) as {
      dispute: { id: number; resolved: boolean };
      duplicata: { valorFmt: string } | null;
      recommendation: unknown;
    };
    expect(avaliacao.dispute.id).toBe(disputaId);
    expect(avaliacao.dispute.resolved).toBe(false);
    expect(avaliacao.duplicata?.valorFmt).toContain('12.000');
    // Sem ANTHROPIC_API_KEY, summarizeDispute (o mesmo copiloto que já existia) retorna
    // null em vez de fabricar uma recomendação.
    expect(avaliacao.recommendation).toBeNull();
  });

  it('resolver_disputa actually resolves the same dispute a manual admin arbitration would', async () => {
    const disputaId = await criarDisputaAberta();

    const result = (await getTool('resolver_disputa').handler({ disputaId, resolucao: 'cedente: prova de entrega anexada, procede' }, { runId: 0, userId: 1 })) as { ok: boolean };
    expect(result.ok).toBe(true);

    const dispute = getDispute(disputaId)!;
    expect(dispute.resolved).toBeTruthy();
    expect(dispute.resolution).toContain('cedente');
  });
});
