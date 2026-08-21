import { getDuplicata, listOverdueDuplicatas } from '../../db/duplicatas.js';
import { checkCollectionEligibility, generateCollectionDraft, type CollectionDocType } from '../legalCollection.js';
import { recordLegalDocument } from '../../db/legalDocuments.js';
import { fmtBRL } from '../format.js';
import { createHandoffTool, type AgentDefinition } from '../agentRuntime.js';

export const cobrancaAgent: AgentDefinition = {
  id: 'cobranca',
  label: 'Agente de Cobrança',
  description: 'Acompanha duplicatas vencidas, verifica elegibilidade para cobrança jurídica e escala para notificação/protesto/execução quando apropriado.',
  systemPrompt: `Você é o agente de régua de cobrança da Lastro. Use listar_vencidas para ver duplicatas em atraso, ou vá direto a um ID conhecido. Para cada caso, primeiro chame checar_elegibilidade — cobrança jurídica exige a duplicata vencida, o aceite confirmado pelo sacado, e nenhuma disputa aberta. Se elegível, escolha a ação proporcional aos dias de atraso: poucos dias em atraso → notificacao_cobranca; atraso maior sem resposta → minuta_protesto; casos extremos e antigos → peticao_execucao. Se a checagem de elegibilidade indicar uma disputa em aberto, acione o agente de disputas (acionar_agente) para uma avaliação mais completa em vez de simplesmente marcar como não elegível. Chame escalar_cobranca só quando a elegibilidade for confirmada — essa ação é sensível, sempre passa por aprovação humana e revisão de um advogado antes de qualquer envio real. Ao final, explique sua decisão para cada caso analisado.`,
  tools: [
    createHandoffTool(['disputa_sinistro']),
    {
      name: 'listar_vencidas',
      description: 'Lista duplicatas atualmente vencidas (não pagas, prazo de vencimento já passado).',
      inputSchema: { type: 'object', properties: {} },
      handler: async () =>
        listOverdueDuplicatas()
          .slice(0, 25)
          .map((d) => ({ id: d.id, sacado: d.sacado_nome, valorFmt: fmtBRL(d.valor), vencimento: d.vencimento, status: d.status })),
    },
    {
      name: 'checar_elegibilidade',
      description: 'Verifica se uma duplicata pode ser escalada para cobrança jurídica.',
      inputSchema: { type: 'object', properties: { duplicataId: { type: 'string' } }, required: ['duplicataId'] },
      handler: async (input: { duplicataId: string }) => {
        const d = getDuplicata(input.duplicataId);
        if (!d) return { erro: 'duplicata não encontrada' };
        return {
          duplicata: { id: d.id, sacado: d.sacado_nome, valorFmt: fmtBRL(d.valor), vencimento: d.vencimento, status: d.status },
          elegibilidade: checkCollectionEligibility(d),
        };
      },
    },
    {
      name: 'escalar_cobranca',
      description:
        'Gera e registra formalmente um documento de cobrança jurídica (notificação, minuta de protesto ou petição de execução). Ação sensível — requer aprovação humana e revisão de advogado antes de qualquer envio real.',
      sensitive: true,
      inputSchema: {
        type: 'object',
        properties: {
          duplicataId: { type: 'string' },
          tipo: { type: 'string', enum: ['notificacao_cobranca', 'minuta_protesto', 'peticao_execucao'] },
        },
        required: ['duplicataId', 'tipo'],
      },
      handler: async (input: { duplicataId: string; tipo: CollectionDocType }, ctx) => {
        const d = getDuplicata(input.duplicataId);
        if (!d) throw new Error('Duplicata não encontrada.');
        const elig = checkCollectionEligibility(d);
        if (!elig.eligible) throw new Error(`Não elegível para cobrança jurídica: ${elig.reason}`);
        const draft = await generateCollectionDraft(d, input.tipo, ctx.userId);
        if (!draft) throw new Error('Não foi possível gerar o rascunho — ANTHROPIC_API_KEY pode não estar configurado.');
        const doc = recordLegalDocument({ type: input.tipo, duplicataId: input.duplicataId, content: draft, generatedBy: ctx.userId });
        return { documentoId: doc.id, tipo: input.tipo };
      },
    },
  ],
};
