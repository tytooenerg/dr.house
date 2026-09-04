import { getDuplicata, isPurchased, createPurchase, listPurchasesByInvestor } from '../../db/duplicatas.js';
import { getAceiteByDuplicata } from '../../db/aceites.js';
import { aceiteConfirmado } from '../aceiteCore.js';
import { getUserById, getSettings } from '../../db/users.js';
import { settlePurchase } from '../settlement.js';
import { computePurchasePrice } from '../marketCompute.js';
import { deliverWebhookEvent } from '../webhookDelivery.js';
import { addAutomationActivity } from '../../db/misc.js';
import { ratingFromScore } from '../riscoCore.js';
import { fmtBRL } from '../format.js';
import type { AgentDefinition } from '../agentRuntime.js';

// The rule-based auto-bid engine (routes/automation.ts) always applies the same fixed
// checks in the same order to every offer. This agent version investigates a specific
// offer against the investor's real configured rules and real current exposure, the same
// way a human reviewing one candidate manually would, and only commits capital — the one
// sensitive tool here — once it has walked through the reasoning, not as a blind pass/fail.
export const autoBidAgent: AgentDefinition = {
  id: 'autobid',
  label: 'Agente de Auto-Bid do Investidor',
  description: 'Avalia uma oferta do marketplace contra as regras de risco/retorno configuradas por um investidor e, se aprovar, executa a compra.',
  selfServiceRoles: ['investidor'],
  systemPrompt: `Você é o agente de investimento automatizado de um investidor da Lastro. Dado um userId de investidor e um duplicataId de uma oferta no marketplace, use ver_regras_investidor para saber os limites configurados (score mínimo, taxa máxima, exposição por sacado, exposição mensal), ver_oferta para os dados da oferta, e ver_exposicao_atual para saber quanto o investidor já tem alocado. Compre (comprar_oferta) apenas se TODAS as regras forem respeitadas — explique cada regra que você conferiu. comprar_oferta é uma ação sensível que compromete capital real e sempre passa por aprovação humana. Ao final, explique sua decisão.`,
  tools: [
    {
      name: 'ver_oferta',
      description: 'Dados de uma oferta (duplicata) no marketplace.',
      inputSchema: { type: 'object', properties: { duplicataId: { type: 'string' } }, required: ['duplicataId'] },
      handler: async (input: { duplicataId: string }) => {
        const d = getDuplicata(input.duplicataId);
        if (!d) return { erro: 'oferta não encontrada' };
        const rating = ratingFromScore(d.score ?? 60);
        return {
          id: d.id,
          sacado: d.sacado_nome,
          cedenteId: d.cedente_id,
          valorFmt: fmtBRL(d.valor),
          valor: d.valor,
          desagio: d.desagio,
          score: d.score,
          rating,
          status: d.status,
          jaComprada: isPurchased(d.id),
          statusAceite: getAceiteByDuplicata(d.id)?.status ?? 'sem registro',
        };
      },
    },
    {
      name: 'ver_regras_investidor',
      description: 'Regras de auto-bid configuradas pelo investidor (score mínimo, taxa máxima, limites de exposição, diversificação).',
      inputSchema: { type: 'object', properties: { userId: { type: 'number' } }, required: ['userId'] },
      handler: async (input: { userId: number }) => {
        const u = getUserById(input.userId);
        if (!u) return { erro: 'investidor não encontrado' };
        const settings = getSettings(u);
        return { autoBidEnabled: settings.autoBidEnabled, regras: settings.autoBidRules, diversificacao: settings.diversification };
      },
    },
    {
      name: 'ver_exposicao_atual',
      description: 'Posições ativas do investidor, total e por sacado — para checar limites de concentração.',
      inputSchema: { type: 'object', properties: { userId: { type: 'number' }, sacadoNome: { type: 'string' } } , required: ['userId']},
      handler: async (input: { userId: number; sacadoNome?: string }) => {
        const purchases = listPurchasesByInvestor(input.userId).filter((p) => p.active);
        const total = purchases.reduce((sum, p) => sum + p.valor, 0);
        const porSacado = input.sacadoNome ? purchases.filter((p) => p.sacado_nome === input.sacadoNome).reduce((sum, p) => sum + p.valor, 0) : null;
        return { totalAlocadoFmt: fmtBRL(total), totalAlocado: total, exposicaoNesteSacado: porSacado, nPosicoes: purchases.length };
      },
    },
    {
      name: 'comprar_oferta',
      description:
        'Executa a compra da oferta (mesma operação de um clique manual em "Comprar") em nome do investidor. Ação sensível — compromete capital real (o próprio investidor pode aprovar a sua, é o mesmo efeito de comprar manualmente).',
      sensitive: true,
      selfApprovable: true,
      extractValueBRL: async (input: { duplicataId: string }) => getDuplicata(input.duplicataId)?.valor ?? null,
      inputSchema: { type: 'object', properties: { userId: { type: 'number' }, duplicataId: { type: 'string' } }, required: ['userId', 'duplicataId'] },
      handler: async (input: { userId: number; duplicataId: string }) => {
        const offer = getDuplicata(input.duplicataId);
        if (!offer) throw new Error('Oferta não encontrada.');
        if (isPurchased(offer.id)) throw new Error('Oferta já foi comprada.');
        // Achado corrigido: este handler nunca checava o aceite do sacado, nem sequer
        // 'contestada' — uma duplicata só pode ser negociada depois que o sacado aceita
        // (explícito ou tácito). Mesmo padrão de erro do fluxo manual (routes/market.ts).
        if (!aceiteConfirmado(offer.id)) throw new Error('Aguardando aceite do sacado (ou o prazo tácito vencer) antes de poder comprar esta duplicata.');
        const { precoCompra } = computePurchasePrice(offer);
        createPurchase(offer.id, input.userId, offer.valor, offer.desagio ?? '', Math.round(offer.valor - precoCompra));
        settlePurchase({ duplicataId: offer.id, sacadoNome: offer.sacado_nome, investorId: input.userId, cedenteId: offer.cedente_id, valor: offer.valor, precoCompra });
        if (offer.cedente_id) {
          void deliverWebhookEvent(offer.cedente_id, 'pagamento.confirmado', { duplicataId: offer.id, valor: offer.valor, investorId: input.userId });
        }
        addAutomationActivity(
          input.userId,
          `Agente de auto-bid (IA) comprou ${fmtBRL(offer.valor)} em ${offer.sacado_nome} a ${offer.desagio}, aprovado por humano.`,
          '#0A5C36'
        );
        return { ok: true, valorFmt: fmtBRL(offer.valor) };
      },
    },
  ],
};
