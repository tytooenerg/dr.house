import { listPendingKyb, getUserById, approveKyb, rejectKyb } from '../../db/users.js';
import { screenEntity } from '../../db/sanctions.js';
import { screenJudicialRecords } from '../judicialRecords.js';
import type { AgentDefinition } from '../agentRuntime.js';

function safeKybForm(kybFormJson: string): Record<string, unknown> {
  try {
    return JSON.parse(kybFormJson || '{}');
  } catch {
    return {};
  }
}

export const onboardingAgent: AgentDefinition = {
  id: 'onboarding',
  label: 'Agente de Onboarding/KYB',
  description: 'Investiga uma empresa em análise de KYB (sanções, PEP, histórico judicial) e recomenda aprovar ou rejeitar o cadastro.',
  systemPrompt: `Você é um analista de onboarding (KYB — Know Your Business) da Lastro. Use listar_pendentes para ver empresas aguardando análise, ou vá direto a um userId conhecido com ver_cadastro. Investigue com consultar_sancoes e consultar_historico_judicial antes de decidir. aprovar_kyb e rejeitar_kyb são ações sensíveis — só chame uma delas depois de ter investigado o suficiente para justificar a decisão com dados concretos, e ambas sempre passam por aprovação humana antes de valer. Nunca invente informações que as ferramentas não retornaram. Ao final, explique sua recomendação.`,
  tools: [
    {
      name: 'listar_pendentes',
      description: 'Lista empresas com KYB pendente de análise.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => listPendingKyb().map((u) => ({ userId: u.id, companyName: u.company_name, role: u.role, pldStatus: u.pld_status })),
    },
    {
      name: 'ver_cadastro',
      description: 'Vê os dados de cadastro/KYB de uma empresa pelo userId.',
      inputSchema: { type: 'object', properties: { userId: { type: 'number' } }, required: ['userId'] },
      handler: async (input: { userId: number }) => {
        const u = getUserById(input.userId);
        if (!u) return { erro: 'usuário não encontrado' };
        return { companyName: u.company_name, role: u.role, kybStatus: u.kyb_status, pldStatus: u.pld_status, form: safeKybForm(u.kyb_form) };
      },
    },
    {
      name: 'consultar_sancoes',
      description: 'Triagem contra listas de sanções e PEP.',
      inputSchema: { type: 'object', properties: { nome: { type: 'string' }, cnpj: { type: 'string' } }, required: ['nome', 'cnpj'] },
      handler: async (input: { nome: string; cnpj: string }, ctx) => (await screenEntity(input.nome, input.cnpj, ctx.userId)) ?? { match: false },
    },
    {
      name: 'consultar_historico_judicial',
      description: 'Processos judiciais (execução/falência/recuperação) contra o CNPJ da empresa.',
      inputSchema: { type: 'object', properties: { cnpj: { type: 'string' } }, required: ['cnpj'] },
      handler: async (input: { cnpj: string }) => (await screenJudicialRecords(input.cnpj)) ?? { disponivel: false },
    },
    {
      name: 'aprovar_kyb',
      description: 'Aprova o cadastro/KYB da empresa. Ação sensível.',
      sensitive: true,
      inputSchema: { type: 'object', properties: { userId: { type: 'number' } }, required: ['userId'] },
      handler: async (input: { userId: number }) => {
        approveKyb(input.userId);
        return { ok: true };
      },
    },
    {
      name: 'rejeitar_kyb',
      description: 'Rejeita o cadastro/KYB da empresa, com motivo. Ação sensível.',
      sensitive: true,
      inputSchema: { type: 'object', properties: { userId: { type: 'number' }, motivo: { type: 'string' } }, required: ['userId', 'motivo'] },
      handler: async (input: { userId: number; motivo: string }) => {
        rejectKyb(input.userId, input.motivo);
        return { ok: true };
      },
    },
  ],
};
