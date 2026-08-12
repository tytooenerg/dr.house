import { runReconciliation, listOpenFlags, resolveFlag } from '../reconciliation.js';
import { fmtBRL } from '../format.js';
import type { AgentDefinition } from '../agentRuntime.js';

// The 12th agent — admin-only (this compares money-movement records across every account,
// not one user's own data, so it doesn't fit the self-service model the other agents use
// for cedente/investidor). Runs the same lib/reconciliation.ts check any admin could
// trigger by hand from the back-office; the value here is an agent that can be scheduled
// and that explains what it found in plain language, not a different matching algorithm.
export const reconciliationAgent: AgentDefinition = {
  id: 'reconciliacao',
  label: 'Agente de Reconciliação',
  description: 'Compara confirmações de pagamento (Pix, boleto, TED) contra o extrato/ledger e sinaliza divergências para revisão humana.',
  systemPrompt: `Você é o agente de reconciliação financeira da Lastro. Use rodar_reconciliacao para escanear os pagamentos confirmados recentes contra o extrato de cada usuário. Depois, use listar_pendentes para ver o que ficou sinalizado. Resuma os achados de forma objetiva: quantos eventos foram checados, quantos bateram, quantos ficaram pendentes de revisão. Nunca resolva um alerta sozinho (marcar_resolvido é sensível e sempre passa por aprovação humana) — apenas recomende se um caso parece um erro pontual (ex: atraso de poucos segundos entre a confirmação do pagamento e o lançamento no extrato) ou algo que merece investigação mais séria.`,
  selfServiceRoles: [],
  tools: [
    {
      name: 'rodar_reconciliacao',
      description: 'Roda a checagem de reconciliação sobre os últimos N dias (padrão 7) de pagamentos confirmados.',
      inputSchema: { type: 'object', properties: { dias: { type: 'number' } } },
      handler: async (input: { dias?: number }) => {
        const result = runReconciliation(input.dias && input.dias > 0 ? input.dias : 7);
        return result;
      },
    },
    {
      name: 'listar_pendentes',
      description: 'Lista os alertas de reconciliação atualmente abertos, aguardando revisão.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () =>
        listOpenFlags()
          .slice(0, 30)
          .map((f) => ({ id: f.id, tipo: f.tipo, empresa: f.company_name, valorFmt: fmtBRL(f.valor), descricao: f.descricao, criadoEm: f.created_at })),
    },
    {
      name: 'marcar_resolvido',
      description: 'Marca um alerta de reconciliação como resolvido, após confirmação humana de que foi investigado.',
      sensitive: true,
      inputSchema: { type: 'object', properties: { flagId: { type: 'number' } }, required: ['flagId'] },
      handler: async (input: { flagId: number }, ctx) => {
        if (!ctx.userId) throw new Error('Resolução requer um admin associado à execução.');
        const outcome = resolveFlag(input.flagId, ctx.userId);
        if (outcome.status !== 200) throw new Error(outcome.body.error === 'not_found' ? 'Alerta não encontrado.' : 'Não foi possível resolver o alerta.');
        return { flagId: input.flagId, status: 'resolvida' };
      },
    },
  ],
};
