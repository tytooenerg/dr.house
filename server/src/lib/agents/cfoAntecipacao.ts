import { listByCedente as listDuplicatasByCedente } from '../../db/duplicatas.js';
import { estimateDefaultProbability } from '../defaultProbability.js';
import { ELIGIBLE_NOW_STATUSES } from '../cashflowForecast.js';
import { fmtBRL } from '../format.js';
import type { AgentDefinition } from '../agentRuntime.js';

// Sub-agent reachable only via the CFO Digital orchestrator's acionar_agente handoff (see
// lib/agents/cfo.ts) or directly by an admin — same "no selfServiceRoles, specialist-only"
// shape as lib/agents/cfoConcentracao.ts. Purely advisory: it never buys or lists anything
// itself (that's the marketplace/Emissão flow the cedente already has), it only ranks what's
// already real and eligible so the orchestrator's answer can point at specific duplicatas
// instead of a generic "antecipe algo" suggestion.
export const cfoAntecipacaoAgent: AgentDefinition = {
  id: 'cfo_antecipacao',
  label: 'CFO Digital — Especialista em Recomendação de Antecipação',
  description: 'Recomenda quais recebíveis já elegíveis um cedente deveria antecipar primeiro para cobrir um déficit de caixa projetado.',
  systemPrompt: `Você é um especialista em antecipação de recebíveis, acionado pelo CFO digital da Lastro. A instrução que você recebe normalmente descreve o déficit de caixa projetado (valor e prazo) que motivou o acionamento — use isso para dimensionar sua recomendação. Use listar_recebiveis_elegiveis para ver os recebíveis do cedente já elegíveis para antecipação hoje (aprovados ou no mercado), com valor, vencimento e probabilidade de default estimada. Nunca invente recebíveis que a ferramenta não retornou. Recomende quais antecipar primeiro — normalmente os de menor risco, e some valor suficiente para cobrir o déficit sem recomendar mais do que o necessário. Ao final, dê uma recomendação objetiva em português, citando os recebíveis específicos (id, sacado, valor) e o motivo da ordem escolhida.`,
  tools: [
    {
      name: 'listar_recebiveis_elegiveis',
      description: 'Lista os recebíveis do cedente já elegíveis para antecipação hoje (aprovados ou no mercado), com valor, vencimento e probabilidade de default estimada, ordenados do menor para o maior risco.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async (_input, ctx) => {
        if (!ctx.userId) return { erro: 'requer um cedente autenticado' };
        return listDuplicatasByCedente(ctx.userId)
          .filter((d) => ELIGIBLE_NOW_STATUSES.has(d.status))
          .map((d) => {
            const { pd, rating } = estimateDefaultProbability(d);
            return {
              id: d.id,
              sacado: d.sacado_nome,
              valorFmt: fmtBRL(d.valor),
              valor: d.valor,
              vencimento: d.vencimento,
              rating,
              probabilidadeDefaultPct: +(pd * 100).toFixed(1),
            };
          })
          .sort((a, b) => a.probabilidadeDefaultPct - b.probabilidadeDefaultPct);
      },
    },
  ],
};
