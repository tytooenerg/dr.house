import { checkDuplicidade } from '../dupCheck.js';
import { buildBlendedRiscoView } from '../riscoCore.js';
import { computeEmitirPreview, submitEmitir, emitirFormSchema } from '../emitirCore.js';
import { getUserById } from '../../db/users.js';
import type { AgentDefinition } from '../agentRuntime.js';

export const emissaoAgent: AgentDefinition = {
  id: 'emissao',
  label: 'Agente de Emissão',
  description: 'Investiga duplicidade e risco do sacado antes de decidir se uma duplicata pode ser emitida e registrada na registradora.',
  selfServiceRoles: ['cedente'],
  systemPrompt: `Você é o agente de emissão da Lastro, uma plataforma de duplicata escritural. Um cedente quer emitir uma duplicata. Antes de decidir, investigue: (1) se há duplicidade suspeita para o mesmo sacado/valor/vencimento, usando checar_duplicidade; (2) o risco de crédito do sacado, usando consultar_risco_sacado, quando houver CNPJ. Use calcular_preview_emissao para ver o checklist de completude. Só chame emitir_duplicata se a checagem de duplicidade não indicar duplicidade suspeita. Se indicar, explique o motivo de não emitir e pare — não chame emitir_duplicata nesse caso. Ao final, escreva um resumo objetivo em português explicando sua decisão e os dados que você usou para chegar nela — nunca invente dados que as ferramentas não retornaram.`,
  tools: [
    {
      name: 'checar_duplicidade',
      description: 'Verifica se já existe outra duplicata registrada para o mesmo CNPJ, ID ou chave de NF-e — sinal clássico de financiamento duplicado.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'CNPJ do sacado, ID da duplicata ou chave de NF-e (44 dígitos)' } },
        required: ['query'],
      },
      handler: async (input: { query: string }) => checkDuplicidade(input.query),
    },
    {
      name: 'consultar_risco_sacado',
      description: 'Consulta o score de risco combinado (interno + rede de parceiros + bureau + Open Finance, quando configurados) de uma empresa sacada pelo CNPJ.',
      inputSchema: { type: 'object', properties: { cnpj: { type: 'string' } }, required: ['cnpj'] },
      handler: async (input: { cnpj: string }, ctx) => (await buildBlendedRiscoView(input.cnpj, ctx.userId)) ?? { encontrado: false },
    },
    {
      name: 'calcular_preview_emissao',
      description: 'Calcula o checklist de completude e a prévia de taxa/prêmio de seguro para uma emissão, sem registrar nada.',
      inputSchema: {
        type: 'object',
        properties: {
          sacado: { type: 'string' },
          cnpj: { type: 'string' },
          valor: { type: 'string', description: 'Valor em formato brasileiro, ex: 12.500,00' },
          vencimento: { type: 'string' },
          seguro: { type: 'boolean' },
          nfAnexada: { type: 'boolean' },
        },
        required: ['sacado', 'valor', 'vencimento'],
      },
      handler: async (input: Record<string, unknown>) => computeEmitirPreview(emitirFormSchema.parse(input)),
    },
    {
      name: 'emitir_duplicata',
      description:
        'Registra de verdade a duplicata na registradora e a submete ao Compliance AI Engine. Ação sensível — sempre passa por aprovação antes de executar (o próprio cedente pode aprovar a sua, é o mesmo efeito de um envio manual do formulário).',
      sensitive: true,
      selfApprovable: true,
      inputSchema: {
        type: 'object',
        properties: {
          sacado: { type: 'string' },
          cnpj: { type: 'string' },
          valor: { type: 'string' },
          vencimento: { type: 'string' },
          seguro: { type: 'boolean' },
          nfAnexada: { type: 'boolean' },
          nfeChave: { type: 'string' },
        },
        required: ['sacado', 'valor', 'vencimento'],
      },
      handler: async (input: Record<string, unknown>, ctx) => {
        if (!ctx.userId) throw new Error('Emissão requer um cedente autenticado.');
        const user = getUserById(ctx.userId);
        if (!user) throw new Error('Cedente não encontrado.');
        const form = emitirFormSchema.parse(input);
        return submitEmitir(user, form);
      },
    },
  ],
};
