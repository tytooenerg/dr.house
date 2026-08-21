import { getDispute, listEvents, resolveDispute, listAllOpenDisputes } from '../../db/disputes.js';
import { getAceite } from '../../db/aceites.js';
import { getDuplicata } from '../../db/duplicatas.js';
import { summarizeDispute } from '../disputeCopilot.js';
import { triageSinistro } from '../sinistroCopilot.js';
import { fmtBRL } from '../format.js';
import type { AgentDefinition } from '../agentRuntime.js';

export const disputaSinistroAgent: AgentDefinition = {
  id: 'disputa_sinistro',
  label: 'Agente de Disputas & Sinistros',
  description: 'Reúne o histórico de uma disputa ou sinistro, avalia inconsistências e, quando confiante, registra a resolução para revisão humana.',
  systemPrompt: `Você ajuda o time de compliance da Lastro a arbitrar disputas entre cedente e sacado e a triar pedidos de sinistro de seguro. Use listar_disputas_abertas para descobrir casos, ou vá direto a um ID conhecido. Use avaliar_disputa ou avaliar_sinistro para investigar, sempre citando apenas os dados retornados pelas ferramentas — nunca invente fatos. resolver_disputa é uma ação sensível que registra a decisão final e sempre passa por aprovação humana antes de valer — só chame quando avaliar_disputa te deu uma recomendação clara (não "inconclusivo"). Ao final, explique sua recomendação e o porquê.`,
  tools: [
    {
      name: 'listar_disputas_abertas',
      description: 'Lista todas as disputas atualmente abertas (não resolvidas).',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => listAllOpenDisputes(),
    },
    {
      name: 'avaliar_disputa',
      description: 'Reúne o histórico completo de uma disputa e sugere um veredito (cedente/sacado/inconclusivo).',
      inputSchema: { type: 'object', properties: { disputaId: { type: 'number' } }, required: ['disputaId'] },
      handler: async (input: { disputaId: number }, ctx) => {
        const dispute = getDispute(input.disputaId);
        if (!dispute) return { erro: 'disputa não encontrada' };
        const aceite = getAceite(dispute.aceite_id);
        const duplicata = aceite ? getDuplicata(aceite.duplicata_id) : undefined;
        const timeline = listEvents(input.disputaId).map((e) => ({ autor: e.autor, texto: e.texto, quando: e.created_at }));
        const recommendation = await summarizeDispute(
          {
            motivo: dispute.motivo,
            sacado: duplicata?.sacado_nome ?? '?',
            cedente: duplicata?.cedente_nome ?? '?',
            valorFmt: duplicata ? fmtBRL(duplicata.valor) : '?',
            timeline,
          },
          ctx.userId
        );
        return {
          dispute: { id: dispute.id, motivo: dispute.motivo, resolved: !!dispute.resolved },
          duplicata: duplicata ? { id: duplicata.id, sacado: duplicata.sacado_nome, cedente: duplicata.cedente_nome, valorFmt: fmtBRL(duplicata.valor) } : null,
          timeline,
          recommendation,
        };
      },
    },
    {
      name: 'avaliar_sinistro',
      description: 'Avalia um pedido de sinistro de seguro sobre uma duplicata inadimplente, apontando inconsistências.',
      inputSchema: { type: 'object', properties: { duplicataId: { type: 'string' } }, required: ['duplicataId'] },
      handler: async (input: { duplicataId: string }, ctx) => {
        const d = getDuplicata(input.duplicataId);
        if (!d) return { erro: 'duplicata não encontrada' };
        return { duplicata: { id: d.id, status: d.status, sinistroStatus: d.sinistro_status }, avaliacao: await triageSinistro(d, ctx.userId) };
      },
    },
    {
      name: 'resolver_disputa',
      description: 'Registra a resolução final de uma disputa. Ação sensível — sempre passa por aprovação humana antes de valer.',
      sensitive: true,
      inputSchema: {
        type: 'object',
        properties: { disputaId: { type: 'number' }, resolucao: { type: 'string', description: 'Texto explicando a decisão e a favor de quem' } },
        required: ['disputaId', 'resolucao'],
      },
      handler: async (input: { disputaId: number; resolucao: string }, ctx) => {
        resolveDispute(input.disputaId, input.resolucao, ctx.userId ?? null);
        return { ok: true };
      },
    },
  ],
};
