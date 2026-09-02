import { describe, expect, it, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../src/app.js';
import { seedIfEmpty } from '../src/db/seed.js';
import { createDuplicata } from '../src/db/duplicatas.js';
import { upsertErpReceivables } from '../src/db/erpReceivables.js';
import { listAuditLog } from '../src/db/audit.js';
import { cfoAgent } from '../src/lib/agents/cfo.js';
import { cfoConcentracaoAgent } from '../src/lib/agents/cfoConcentracao.js';
import { cfoAntecipacaoAgent } from '../src/lib/agents/cfoAntecipacao.js';

beforeAll(async () => {
  await seedIfEmpty();
});

function unique() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Same helper shape cashflow.test.ts already uses — the CFO agent is gated at Pro exactly
// like the deterministic forecast page, so most of these tests need a Pro+ account.
async function registerCedente(plan: 'basico' | 'pro' | 'empresarial' = 'pro') {
  const email = `ced-cfo-agent-${unique()}@example.com`;
  const res = await request(app)
    .post('/api/auth/register')
    .send({ nome: 'Cedente CFO Agent', email, password: 'senha123', companyName: `Empresa CFO Agent ${unique()}`, role: 'cedente' });
  const token = res.body.token as string;
  if (plan !== 'basico') await request(app).post('/api/billing/checkout').set('Authorization', `Bearer ${token}`).send({ plan });
  return { token, userId: res.body.user.id as number };
}

async function adminToken() {
  const res = await request(app).post('/api/auth/login').send({ email: 'admin@lastro.demo', password: 'demo1234' });
  return res.body.token as string;
}

function getTool(def: typeof cfoAgent, name: string) {
  const tool = def.tools.find((t) => t.name === name);
  if (!tool) throw new Error(`tool ${name} not found`);
  return tool;
}

describe('CFO Digital — agente orquestrador + sub-agentes', () => {
  describe('gate de plano (POST /api/agents/cfo/run)', () => {
    it('bloqueia um cedente Básico com 402 e libera um cedente Pro', async () => {
      const { token: basicoToken } = await registerCedente('basico');
      const blocked = await request(app).post('/api/agents/cfo/run').set('Authorization', `Bearer ${basicoToken}`).send({ input: 'devo antecipar?' });
      expect(blocked.status).toBe(402);
      expect(blocked.body.requiredPlan).toBe('pro');

      const { token: proToken } = await registerCedente('pro');
      const allowed = await request(app).post('/api/agents/cfo/run').set('Authorization', `Bearer ${proToken}`).send({ input: 'devo antecipar?' });
      expect(allowed.status).toBe(200);
      expect(allowed.body.mode).toBe('simulado'); // no ANTHROPIC_API_KEY in tests
    });

    it('um admin não precisa de plano nenhum para rodar o agente', async () => {
      const tok = await adminToken();
      const res = await request(app).post('/api/agents/cfo/run').set('Authorization', `Bearer ${tok}`).send({ input: 'teste admin' });
      expect(res.status).toBe(200);
    });
  });

  describe('ferramentas do orquestrador (cfo)', () => {
    it('ver_projecao_caixa retorna a projeção real do próprio cedente', async () => {
      const { userId } = await registerCedente('pro');
      createDuplicata({
        cedenteId: userId, cedenteNome: 'Cedente CFO Agent', sacadoNome: 'Sacado Projecao', sacadoCnpj: '',
        valor: 30000, vencimento: isoDaysFromNow(15), emissao: '10/08/2026', status: 'aprovada', lastroPct: 100, seguro: false,
      });

      const tool = getTool(cfoAgent, 'ver_projecao_caixa');
      const out = (await tool.handler({}, { runId: 0, userId })) as { disponivelParaAntecipacao: number; scenarios: unknown[] };
      expect(out.disponivelParaAntecipacao).toBe(30000);
      expect(out.scenarios).toHaveLength(3);
    });

    it('listar_recebiveis_pendentes lista só o que ainda não foi vendido/pago, para o próprio cedente', async () => {
      const { userId } = await registerCedente('pro');
      createDuplicata({
        cedenteId: userId, cedenteNome: 'Cedente CFO Agent', sacadoNome: 'Sacado Pendente', sacadoCnpj: '',
        valor: 12000, vencimento: isoDaysFromNow(30), emissao: '10/08/2026', status: 'pendente_analise', lastroPct: 100, seguro: false,
      });
      createDuplicata({
        cedenteId: userId, cedenteNome: 'Cedente CFO Agent', sacadoNome: 'Sacado Já Vendido', sacadoCnpj: '',
        valor: 9000, vencimento: isoDaysFromNow(30), emissao: '10/08/2026', status: 'vendida', lastroPct: 100, seguro: false,
      });

      const tool = getTool(cfoAgent, 'listar_recebiveis_pendentes');
      const out = (await tool.handler({}, { runId: 0, userId })) as { sacado: string }[];
      expect(out.some((r) => r.sacado === 'Sacado Pendente')).toBe(true);
      expect(out.some((r) => r.sacado === 'Sacado Já Vendido')).toBe(false);
    });

    it('listar_contas_a_pagar lista só as pendentes, para o próprio cedente', async () => {
      const { token, userId } = await registerCedente('pro');
      const payableRes = await request(app)
        .post('/api/payables')
        .set('Authorization', `Bearer ${token}`)
        .send({ descricao: 'Aluguel', categoria: 'aluguel', valor: 5000, vencimento: isoDaysFromNow(10) });
      const paidRes = await request(app)
        .post('/api/payables')
        .set('Authorization', `Bearer ${token}`)
        .send({ descricao: 'Já pago', categoria: 'fornecedores', valor: 2000, vencimento: isoDaysFromNow(1) });
      await request(app).post(`/api/payables/${paidRes.body.id}/pagar`).set('Authorization', `Bearer ${token}`);

      const tool = getTool(cfoAgent, 'listar_contas_a_pagar');
      const out = (await tool.handler({}, { runId: 0, userId })) as { descricao: string }[];
      expect(out.some((p) => p.descricao === 'Aluguel')).toBe(true);
      expect(out.some((p) => p.descricao === 'Já pago')).toBe(false);
      void payableRes;
    });
  });

  describe('sub-agentes só são acionáveis via handoff do cfo ou por um admin', () => {
    it('cfo_concentracao não é self-service — um cedente toma 403 ao chamar diretamente', async () => {
      const { token } = await registerCedente('pro');
      const res = await request(app).post('/api/agents/cfo_concentracao/run').set('Authorization', `Bearer ${token}`).send({ input: 'investigue' });
      expect(res.status).toBe(403);
    });

    it('cfo_antecipacao não é self-service — um cedente toma 403 ao chamar diretamente', async () => {
      const { token } = await registerCedente('pro');
      const res = await request(app).post('/api/agents/cfo_antecipacao/run').set('Authorization', `Bearer ${token}`).send({ input: 'recomende' });
      expect(res.status).toBe(403);
    });

    it('um admin pode rodar os dois sub-agentes diretamente', async () => {
      const tok = await adminToken();
      const concentracao = await request(app).post('/api/agents/cfo_concentracao/run').set('Authorization', `Bearer ${tok}`).send({ input: 'investigue' });
      expect(concentracao.status).toBe(200);
      const antecipacao = await request(app).post('/api/agents/cfo_antecipacao/run').set('Authorization', `Bearer ${tok}`).send({ input: 'recomende' });
      expect(antecipacao.status).toBe(200);
    });
  });

  describe('ferramentas do sub-agente cfo_concentracao', () => {
    it('ver_recebiveis_por_cliente agrega duplicatas na Lastro + recebíveis do ERP por cliente', async () => {
      const { userId } = await registerCedente('pro');
      createDuplicata({
        cedenteId: userId, cedenteNome: 'Cedente CFO Agent', sacadoNome: 'Cliente Grande', sacadoCnpj: '',
        valor: 80000, vencimento: isoDaysFromNow(20), emissao: '10/08/2026', status: 'aprovada', lastroPct: 100, seguro: false,
      });
      upsertErpReceivables(userId, 'omie', [{ externalId: 'e1', cliente: 'Cliente Grande', valor: 20000, vencimento: isoDaysFromNow(20) }]);

      const tool = getTool(cfoConcentracaoAgent, 'ver_recebiveis_por_cliente');
      const out = (await tool.handler({}, { runId: 0, userId })) as { clientes: { cliente: string; participacaoPct: number }[] };
      const clienteGrande = out.clientes.find((c) => c.cliente === 'Cliente Grande');
      expect(clienteGrande).toBeTruthy();
      expect(clienteGrande!.participacaoPct).toBe(100);
    });

    it('registrar_alerta_concentracao grava um evento de auditoria permanente', async () => {
      const { userId } = await registerCedente('pro');
      const tool = getTool(cfoConcentracaoAgent, 'registrar_alerta_concentracao');
      const out = await tool.handler(
        { clientePrincipal: 'Cliente Grande', participacaoPct: 80, recomendacao: 'Diversifique a carteira' },
        { runId: 0, userId }
      );
      expect((out as { ok: boolean }).ok).toBe(true);
      const found = listAuditLog(20).some((e) => e.action === 'cfo.alerta_concentracao' && e.actor_user_id === userId);
      expect(found).toBe(true);
    });
  });

  describe('ferramenta do sub-agente cfo_antecipacao', () => {
    it('listar_recebiveis_elegiveis retorna só aprovada/no_mercado, ordenado do menor pro maior risco', async () => {
      const { userId } = await registerCedente('pro');
      createDuplicata({
        cedenteId: userId, cedenteNome: 'Cedente CFO Agent', sacadoNome: 'Sacado Elegível', sacadoCnpj: '',
        valor: 15000, vencimento: isoDaysFromNow(20), emissao: '10/08/2026', status: 'no_mercado', lastroPct: 100, seguro: false,
      });
      createDuplicata({
        cedenteId: userId, cedenteNome: 'Cedente CFO Agent', sacadoNome: 'Sacado Não Elegível', sacadoCnpj: '',
        valor: 8000, vencimento: isoDaysFromNow(20), emissao: '10/08/2026', status: 'pendente_analise', lastroPct: 100, seguro: false,
      });

      const tool = getTool(cfoAntecipacaoAgent, 'listar_recebiveis_elegiveis');
      const out = (await tool.handler({}, { runId: 0, userId })) as { sacado: string; probabilidadeDefaultPct: number }[];
      expect(out.some((r) => r.sacado === 'Sacado Elegível')).toBe(true);
      expect(out.some((r) => r.sacado === 'Sacado Não Elegível')).toBe(false);
      for (let i = 1; i < out.length; i++) expect(out[i].probabilidadeDefaultPct).toBeGreaterThanOrEqual(out[i - 1].probabilidadeDefaultPct);
    });
  });
});
