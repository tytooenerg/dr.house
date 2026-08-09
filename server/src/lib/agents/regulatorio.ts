import { analyzeRegulatoryText } from '../regulatoryMonitor.js';
import { recordRegulatoryNote, listRegulatoryNotes } from '../../db/regulatoryNotes.js';
import type { AgentDefinition } from '../agentRuntime.js';

export const regulatorioAgent: AgentDefinition = {
  id: 'regulatorio',
  label: 'Agente de Vigilância Regulatória',
  description: 'Analisa um texto normativo (BACEN/CVM/COAF) fornecido, resume o impacto e registra uma nota regulatória oficial para o time de compliance.',
  systemPrompt: `Você é um assistente jurídico-regulatório da Lastro especializado em duplicata escritural, PLD/AML e regulação do Banco Central. Use analisar_normativo para interpretar o texto normativo fornecido pelo usuário — baseie-se apenas nele, nunca invente dispositivos, prazos ou obrigações que não estejam explicitamente no texto. Antes de registrar uma nota, você pode consultar listar_notas_recentes para não duplicar uma nota já registrada sobre o mesmo assunto. registrar_nota é uma ação sensível — só a chame depois de analisar o texto, e sempre passa por aprovação humana. Ao final, resuma o normativo e sua recomendação.`,
  tools: [
    {
      name: 'analisar_normativo',
      description: 'Resume um texto normativo e identifica áreas impactadas e ações recomendadas.',
      inputSchema: { type: 'object', properties: { titulo: { type: 'string' }, texto: { type: 'string' } }, required: ['titulo', 'texto'] },
      handler: async (input: { titulo: string; texto: string }, ctx) => (await analyzeRegulatoryText(input.titulo, input.texto, ctx.userId)) ?? { erro: 'não foi possível analisar' },
    },
    {
      name: 'listar_notas_recentes',
      description: 'Lista as notas regulatórias já registradas recentemente, para evitar duplicar uma análise já feita.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => listRegulatoryNotes(20).map((n) => ({ id: n.id, title: n.title, createdAt: n.created_at })),
    },
    {
      name: 'registrar_nota',
      description: 'Registra formalmente uma nota regulatória para o time de compliance revisar. Ação sensível.',
      sensitive: true,
      inputSchema: {
        type: 'object',
        properties: {
          titulo: { type: 'string' },
          texto: { type: 'string', description: 'Texto normativo original que embasou a análise' },
          resumo: { type: 'string' },
          areasImpactadas: { type: 'array', items: { type: 'string' } },
          acoesRecomendadas: { type: 'string' },
        },
        required: ['titulo', 'texto', 'resumo'],
      },
      handler: async (
        input: { titulo: string; texto: string; resumo: string; areasImpactadas?: string[]; acoesRecomendadas?: string },
        ctx
      ) =>
        recordRegulatoryNote({
          title: input.titulo,
          sourceText: input.texto,
          summary: input.resumo,
          impactAreas: input.areasImpactadas ?? [],
          recommendedActions: input.acoesRecomendadas ?? '',
          submittedBy: ctx.userId,
        }),
    },
  ],
};
