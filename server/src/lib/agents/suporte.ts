import { getDuplicata } from '../../db/duplicatas.js';
import { getAceiteByDuplicata, listAguardandoSemLembrete, markReminderSent, aceiteSlaStatus } from '../../db/aceites.js';
import { getUserById } from '../../db/users.js';
import { sendWhatsapp } from '../smsNotifier.js';
import { fmtBRL } from '../format.js';
import type { AgentDefinition, AgentRunContext } from '../agentRuntime.js';

// True for an admin-driven run (an admin looking something up on a support call, with no
// reason to be scoped to one account) and false for a self-service run (a cedente asking
// about their own account) — ctx.userId is always populated either way (routes/agents.ts
// forces it onto the caller's own id for self-service, or onto whichever account an admin
// chose, defaulting to the admin's own), so the caller's own role is what actually
// distinguishes "privileged, unrestricted lookup" from "must stay inside my own data".
function isPrivilegedCaller(ctx: AgentRunContext): boolean {
  if (!ctx.userId) return true;
  const u = getUserById(ctx.userId);
  return !u || u.role === 'admin';
}

// Support agent that can actually resolve the question, not just describe it — the
// difference the "onde implantar" answer called out for chat.ts (a single canned/LLM text
// reply). Read tools pull the user's real status; the one sensitive tool re-sends a real
// WhatsApp reminder through the same channel aceiteReminder.ts already uses.
//
// selfServiceRoles: ['cedente'] — a cedente can run this themselves instead of emailing
// support, same self-service pattern lib/agents/emissao.ts already established. Scoped to
// cedente only for now (not investidor/sacado): every ownership check below is "does this
// duplicata's cedente_id match the caller", the one relationship this agent's existing
// tools can verify without adding new lookups the rest of the codebase doesn't already do
// (an investidor/sacado self-service version would need its own ownership shape — real
// future work, not silently faked here). isPrivilegedCaller keeps every tool's behavior for
// an admin lookup exactly as unrestricted as it already was.
export const suporteAgent: AgentDefinition = {
  id: 'suporte',
  label: 'Agente de Suporte',
  selfServiceRoles: ['cedente'],
  description: 'Consulta o status real de uma duplicata/aceite/conta e pode reenviar um lembrete de aceite pendente.',
  systemPrompt: `Você é o agente de suporte da Lastro. Um usuário tem uma dúvida sobre uma duplicata, um aceite ou sua conta. Use as ferramentas de consulta para responder com dados reais — nunca invente status ou prazos. reenviar_lembrete_aceite é uma ação sensível (envia uma mensagem real via WhatsApp) e só deve ser chamada quando o aceite realmente estiver aguardando e o usuário pedir um novo lembrete. Ao final, responda a dúvida do usuário de forma direta e específica, citando os dados reais que você consultou.`,
  tools: [
    {
      name: 'consultar_duplicata',
      description: 'Consulta os dados e status de uma duplicata pelo ID.',
      inputSchema: { type: 'object', properties: { duplicataId: { type: 'string' } }, required: ['duplicataId'] },
      handler: async (input: { duplicataId: string }, ctx) => {
        const d = getDuplicata(input.duplicataId);
        if (!d) return { erro: 'duplicata não encontrada' };
        if (!isPrivilegedCaller(ctx) && d.cedente_id !== ctx.userId) return { erro: 'Esta duplicata não pertence à sua conta.' };
        return { id: d.id, sacado: d.sacado_nome, cedente: d.cedente_nome, valorFmt: fmtBRL(d.valor), vencimento: d.vencimento, status: d.status, registro: d.registro };
      },
    },
    {
      name: 'consultar_aceite',
      description: 'Consulta o status do aceite de uma duplicata (aguardando/aceita/contestada) e prazo restante.',
      inputSchema: { type: 'object', properties: { duplicataId: { type: 'string' } }, required: ['duplicataId'] },
      handler: async (input: { duplicataId: string }, ctx) => {
        const aceite = getAceiteByDuplicata(input.duplicataId);
        if (!aceite) return { erro: 'nenhum aceite registrado para esta duplicata' };
        if (!isPrivilegedCaller(ctx)) {
          const d = getDuplicata(input.duplicataId);
          if (!d || d.cedente_id !== ctx.userId) return { erro: 'Este aceite não pertence a uma duplicata da sua conta.' };
        }
        const sla = aceiteSlaStatus(aceite);
        return { id: aceite.id, status: aceite.status, prazoLabel: aceite.prazo_label, diasRestantes: sla.diasRestantes, vencido: sla.vencido };
      },
    },
    {
      name: 'consultar_conta',
      description: 'Consulta dados públicos de uma conta (empresa, plano, status de KYB) pelo userId. Uma chamada self-service sempre vê a própria conta, independente do userId pedido.',
      inputSchema: { type: 'object', properties: { userId: { type: 'number' } }, required: ['userId'] },
      handler: async (input: { userId: number }, ctx) => {
        const targetId = isPrivilegedCaller(ctx) ? input.userId : ctx.userId!;
        const u = getUserById(targetId);
        if (!u) return { erro: 'conta não encontrada' };
        return { companyName: u.company_name, role: u.role, plan: u.plan, kybStatus: u.kyb_status };
      },
    },
    {
      name: 'reenviar_lembrete_aceite',
      description:
        'Reenvia por WhatsApp o lembrete de prazo de aceite ao sacado. Ação sensível — envia uma mensagem real. Uma chamada self-service (cedente) só pode reenviar lembretes de aceites das próprias duplicatas.',
      sensitive: true,
      inputSchema: { type: 'object', properties: { aceiteId: { type: 'number' } }, required: ['aceiteId'] },
      handler: async (input: { aceiteId: number }, ctx) => {
        const candidate = listAguardandoSemLembrete().find((a) => a.id === input.aceiteId);
        if (!candidate) throw new Error('Este aceite não está com lembrete pendente de envio (já enviado, não aguardando, ou sem telefone registrado).');
        if (!isPrivilegedCaller(ctx) && candidate.cedente_id !== ctx.userId) throw new Error('Este aceite não pertence a uma duplicata da sua conta.');
        if (!candidate.sacado_telefone) throw new Error('Sacado não tem telefone cadastrado para receber o lembrete.');
        const { diasRestantes } = aceiteSlaStatus(candidate);
        const texto = `Lastro: você tem ${diasRestantes ?? '?'} dia(s) para confirmar ou contestar a duplicata de ${fmtBRL(candidate.valor)} (${candidate.sacado_nome}). Acesse o Portal do Sacado.`;
        await sendWhatsapp(candidate.sacado_telefone, texto);
        markReminderSent(candidate.id);
        return { ok: true };
      },
    },
  ],
};
