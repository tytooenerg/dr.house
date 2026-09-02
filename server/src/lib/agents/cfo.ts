import { getUserById, getSettings } from '../../db/users.js';
import { listByCedente as listDuplicatasByCedente } from '../../db/duplicatas.js';
import { listByCedente as listPayablesByCedente } from '../../db/payables.js';
import { buildCashflowForecast, PENDING_STATUSES } from '../cashflowForecast.js';
import { fmtBRL } from '../format.js';
import { createHandoffTool, type AgentDefinition } from '../agentRuntime.js';

// Orchestrator for the "CFO Digital" feature (Pro+, see routes/cashflow.ts's own
// requirePlan('pro') on the deterministic forecast page) — the agentic layer on top of
// lib/cashflowForecast.ts. Where the forecast page shows numbers, this agent reasons over
// them like a real CFO would and knows when a question needs more than a lookup: it can
// acionar_agente to hand off to two purpose-built specialists (cfo_concentracao,
// cfo_antecipacao) or to the existing underwriting agent for a sacado-specific credit
// opinion — the same handoff mechanism lib/agents/emissao.ts already uses for underwriting.
export const cfoAgent: AgentDefinition = {
  id: 'cfo',
  label: 'CFO Digital',
  description: 'Analisa a projeção de caixa real do cedente e responde perguntas de gestão financeira, acionando especialistas quando o caso exigir mais profundidade.',
  selfServiceRoles: ['cedente'],
  requiredPlan: 'pro',
  systemPrompt: `Você é o CFO digital da Lastro, atuando para uma empresa cedente. Seu trabalho é o de um CFO de verdade: entender a saúde financeira real da empresa a partir de dados reais (nunca invente números) e orientar decisões — quando antecipar recebíveis, se há risco de concentração de clientes, quando vale pedir um parecer de crédito mais aprofundado sobre um sacado específico.

Use ver_projecao_caixa para a visão geral (saldo projetado por cenário, recebíveis pendentes, contas a pagar, e — no plano Empresarial — DRE, saldo bancário real e benchmark de mercado). Use listar_recebiveis_pendentes e listar_contas_a_pagar para investigar o detalhe por trás dos números quando a pergunta pedir.

Você pode acionar_agente para delegar a um especialista quando o caso exigir: "cfo_concentracao" para uma investigação aprofundada de concentração de clientes (com possibilidade de registrar um alerta permanente na conta), "cfo_antecipacao" para uma recomendação de quais recebíveis antecipar primeiro pra cobrir um déficit projetado, ou "underwriting" para um parecer de risco de crédito sobre um sacado específico. Ao acionar um especialista, inclua na instrução todo o contexto numérico relevante que você já levantou (ex.: valor do déficit e prazo) — o especialista não vê esta conversa. Não acione um especialista à toa, só quando a pergunta realmente pedir aquela profundidade.

Ao final, responda a pergunta do cedente de forma direta e específica, em português, citando os números reais que você consultou (e o que os especialistas acionados retornaram, se for o caso).`,
  tools: [
    createHandoffTool(['cfo_concentracao', 'cfo_antecipacao', 'underwriting']),
    {
      name: 'ver_projecao_caixa',
      description: 'Vê a projeção de caixa real do cedente: disponível para antecipar hoje, total a receber/pagar pendente, recebíveis externos do ERP, saldo projetado por cenário (pessimista/base/otimista), insights automáticos e, no plano Empresarial, DRE simplificado/saldo bancário real/benchmark de mercado.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async (_input, ctx) => {
        if (!ctx.userId) return { erro: 'requer um cedente autenticado' };
        const user = getUserById(ctx.userId);
        if (!user) return { erro: 'conta não encontrada' };
        return buildCashflowForecast(user.id, user.plan, getSettings(user).companyCnpj);
      },
    },
    {
      name: 'listar_recebiveis_pendentes',
      description: 'Lista as duplicatas do cedente ainda pendentes de receber (em análise, aprovadas ou no mercado — nunca vendidas/pagas), com sacado, valor e vencimento.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async (_input, ctx) => {
        if (!ctx.userId) return { erro: 'requer um cedente autenticado' };
        return listDuplicatasByCedente(ctx.userId)
          .filter((d) => PENDING_STATUSES.has(d.status))
          .map((d) => ({ id: d.id, sacado: d.sacado_nome, valorFmt: fmtBRL(d.valor), vencimento: d.vencimento, status: d.status }));
      },
    },
    {
      name: 'listar_contas_a_pagar',
      description: 'Lista as contas a pagar pendentes do cedente, com descrição, valor e vencimento.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async (_input, ctx) => {
        if (!ctx.userId) return { erro: 'requer um cedente autenticado' };
        return listPayablesByCedente(ctx.userId)
          .filter((p) => p.status === 'pendente')
          .map((p) => ({ descricao: p.descricao, valorFmt: fmtBRL(p.valor), vencimento: p.vencimento }));
      },
    },
  ],
};
