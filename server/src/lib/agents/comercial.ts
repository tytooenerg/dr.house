import { getUserById, listReferrals } from '../../db/users.js';
import { recordAuditEvent } from '../../db/audit.js';
import type { AgentDefinition } from '../agentRuntime.js';

// Lead-qualification agent: there's no CRM/leads table in this codebase, so this scopes to
// what's real and already here — reading a signed-up account's own onboarding/referral
// data (the same signals a human BD rep would open first) and, when asked, leaving a
// durable note on that account via the existing audit log rather than inventing a new
// "CRM notes" table this product doesn't have yet.
export const comercialAgent: AgentDefinition = {
  id: 'comercial',
  label: 'Agente Comercial',
  description: 'Qualifica uma conta (cedente/investidor) recém-cadastrada a partir do perfil real dela e registra uma nota comercial para o time de vendas.',
  systemPrompt: `Você é um analista comercial da Lastro qualificando contas recém-cadastradas para o time de vendas priorizar contato. Use ver_perfil e ver_indicacoes para entender a conta — plano contratado, status de KYB, quantas indicações ela já trouxe. Nunca invente informações que as ferramentas não retornaram. registrar_nota_comercial é uma ação sensível que grava uma nota permanente para o time de vendas — só chame depois de reunir dados suficientes. Ao final, dê uma recomendação objetiva de prioridade de contato (alta/média/baixa) e por quê.`,
  tools: [
    {
      name: 'ver_perfil',
      description: 'Vê o perfil de uma conta: empresa, papel, plano, status de KYB, data de cadastro.',
      inputSchema: { type: 'object', properties: { userId: { type: 'number' } }, required: ['userId'] },
      handler: async (input: { userId: number }) => {
        const u = getUserById(input.userId);
        if (!u) return { erro: 'conta não encontrada' };
        return { companyName: u.company_name, role: u.role, plan: u.plan, kybStatus: u.kyb_status, createdAt: u.created_at };
      },
    },
    {
      name: 'ver_indicacoes',
      description: 'Lista quem essa conta já indicou para a Lastro (programa de indicação).',
      inputSchema: { type: 'object', properties: { userId: { type: 'number' } }, required: ['userId'] },
      handler: async (input: { userId: number }) => listReferrals(input.userId),
    },
    {
      name: 'registrar_nota_comercial',
      description: 'Registra uma nota comercial permanente sobre a conta para o time de vendas. Ação sensível.',
      sensitive: true,
      inputSchema: {
        type: 'object',
        properties: { userId: { type: 'number' }, prioridade: { type: 'string', enum: ['alta', 'media', 'baixa'] }, nota: { type: 'string' } },
        required: ['userId', 'prioridade', 'nota'],
      },
      handler: async (input: { userId: number; prioridade: string; nota: string }) => {
        const u = getUserById(input.userId);
        if (!u) throw new Error('Conta não encontrada.');
        recordAuditEvent(input.userId, u.company_name, 'comercial.nota_agente_ia', { prioridade: input.prioridade, nota: input.nota });
        return { ok: true };
      },
    },
  ],
};
