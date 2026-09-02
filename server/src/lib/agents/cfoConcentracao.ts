import { getUserById } from '../../db/users.js';
import { listByCedente as listDuplicatasByCedente } from '../../db/duplicatas.js';
import { listErpReceivablesByCedente } from '../../db/erpReceivables.js';
import { recordAuditEvent } from '../../db/audit.js';
import { PENDING_STATUSES } from '../cashflowForecast.js';
import { fmtBRL } from '../format.js';
import type { AgentDefinition } from '../agentRuntime.js';

// Sub-agent reachable only via the CFO Digital orchestrator's acionar_agente handoff (see
// lib/agents/cfo.ts) or directly by an admin — no selfServiceRoles of its own, same pattern
// lib/agents/underwriting.ts already uses for a specialist that's never run standalone by a
// non-admin. Where lib/cashflowForecast.ts's buildConcentracaoInsight is a fixed threshold
// check (≥50% in one client), this reasons over the real per-client breakdown and can leave
// a durable, permanent record when the concentration genuinely warrants one.
export const cfoConcentracaoAgent: AgentDefinition = {
  id: 'cfo_concentracao',
  label: 'CFO Digital — Especialista em Concentração de Clientes',
  description: 'Investiga a fundo a concentração de clientes na carteira de recebíveis (Lastro + ERP conectado) de um cedente e pode registrar um alerta permanente na conta.',
  systemPrompt: `Você é um especialista em risco de concentração de carteira, acionado pelo CFO digital da Lastro para investigar um cedente específico. Use ver_recebiveis_por_cliente para ver o detalhamento real por cliente (duplicatas na Lastro + recebíveis do ERP conectado, quando houver). Analise se a carteira está concentrada demais em poucos clientes — nunca invente dados que a ferramenta não retornou. Se a concentração observada for genuinamente preocupante (por exemplo, um único cliente responder por uma fatia grande do total a receber), você pode registrar_alerta_concentracao — ação sensível que grava um alerta permanente na conta do cedente; só chame quando isso realmente for útil, não em toda investigação. Ao final, dê um parecer objetivo em português sobre o nível de concentração e uma recomendação prática.`,
  tools: [
    {
      name: 'ver_recebiveis_por_cliente',
      description: 'Agrega os recebíveis pendentes do cedente (duplicatas na Lastro + recebíveis do ERP conectado) por cliente/sacado, com valor e participação percentual no total.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      handler: async (_input, ctx) => {
        if (!ctx.userId) return { erro: 'requer um cedente autenticado' };
        const duplicatas = listDuplicatasByCedente(ctx.userId).filter((d) => PENDING_STATUSES.has(d.status));
        const erp = listErpReceivablesByCedente(ctx.userId);
        const porCliente = new Map<string, number>();
        for (const d of duplicatas) porCliente.set(d.sacado_nome, (porCliente.get(d.sacado_nome) ?? 0) + d.valor);
        for (const r of erp) porCliente.set(r.cliente, (porCliente.get(r.cliente) ?? 0) + r.valor);
        const total = [...porCliente.values()].reduce((sum, v) => sum + v, 0);
        if (total <= 0) return { totalFmt: fmtBRL(0), clientes: [] };
        return {
          totalFmt: fmtBRL(total),
          clientes: [...porCliente.entries()]
            .map(([cliente, valor]) => ({ cliente, valorFmt: fmtBRL(valor), participacaoPct: +((valor / total) * 100).toFixed(1) }))
            .sort((a, b) => b.participacaoPct - a.participacaoPct),
        };
      },
    },
    {
      name: 'registrar_alerta_concentracao',
      description: 'Registra um alerta permanente de concentração de clientes na conta do cedente. Ação sensível — o próprio cedente pode aprovar a sua, é o mesmo efeito de anotar isso na própria conta.',
      sensitive: true,
      selfApprovable: true,
      inputSchema: {
        type: 'object',
        properties: {
          clientePrincipal: { type: 'string' },
          participacaoPct: { type: 'number' },
          recomendacao: { type: 'string' },
        },
        required: ['clientePrincipal', 'participacaoPct', 'recomendacao'],
      },
      handler: async (input: { clientePrincipal: string; participacaoPct: number; recomendacao: string }, ctx) => {
        if (!ctx.userId) throw new Error('Requer um cedente autenticado.');
        const user = getUserById(ctx.userId);
        if (!user) throw new Error('Conta não encontrada.');
        recordAuditEvent(user.id, user.company_name, 'cfo.alerta_concentracao', input);
        return { ok: true };
      },
    },
  ],
};
