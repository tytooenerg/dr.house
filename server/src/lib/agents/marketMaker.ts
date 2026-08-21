import { getUserById, getSettings } from '../../db/users.js';
import { listActiveListings } from '../../db/resaleListings.js';
import { bestActiveBidsByListing, listMyBids } from '../../db/resaleBids.js';
import { getDuplicata } from '../../db/duplicatas.js';
import { placeBid, parseValor } from '../resaleCore.js';
import { ratingFromScore } from '../riscoCore.js';
import { estimateRateBand } from '../dynamicPricing.js';
import { fmtBRL } from '../format.js';
import type { AgentDefinition } from '../agentRuntime.js';

// The immediacy premium a liquidity provider earns for being the counterparty willing to
// buy right now, instead of waiting for the natural next buyer — the entire economic
// reason a market maker exists rather than sellers just waiting longer for a better bid.
const MAKER_SPREAD_PCT = 0.015;

// Every tool below is deliberately scoped to ctx.userId, never to a userId supplied in the
// LLM's own tool-call input — unlike lib/agents/autoBid.ts's comprar_oferta (which takes
// userId as an explicit parameter, trusting the prompt to keep it consistent with the
// caller), this agent's sole sensitive tool (dar_lance_liquidez) doesn't expose a userId
// field at all. There's no real reason for it to: a market maker only ever acts on its own
// book, so removing the parameter removes an entire class of "what if the prompt said a
// different id" question rather than just relying on the prompt saying the right thing.
export const marketMakerAgent: AgentDefinition = {
  id: 'market_maker',
  label: 'Agente Market Maker (liquidez automatizada)',
  description:
    'Fornece liquidez ao mercado secundário dando lances em anúncios ativos sem lance algum, dentro do limite de exposição e score mínimo configurados pelo investidor.',
  selfServiceRoles: ['investidor'],
  systemPrompt: `Você é o agente Market Maker da Lastro, atuando em nome de um investidor institucional específico (userId fornecido no contexto da tarefa) que optou por fornecer liquidez ao mercado secundário. Seu objetivo: identificar anúncios ativos de outros investidores que ainda não têm nenhum lance (baixa liquidez) e, para os que atendem ao score mínimo configurado, propor um lance de valor justo — nunca acima do que o próprio anúncio pede, e sempre com uma margem para o investidor. Use ver_minhas_regras_de_liquidez para saber o score mínimo e o limite de exposição configurados. Use listar_anuncios_sem_lance para ver os candidatos. Use calcular_lance_justo para cada candidato antes de decidir. Use ver_minha_capacidade_disponivel para nunca propor lances que somados ultrapassem o limite de exposição. dar_lance_liquidez é a única ação que realmente compromete capital — é sensível e sempre passa por aprovação (o próprio investidor pode aprovar a sua, é o mesmo efeito de dar um lance manualmente). Não dê lance em anúncios abaixo do score mínimo, nem acima da capacidade disponível. Ao final, resuma quantos lances você propôs e por quê.`,
  tools: [
    {
      name: 'ver_minhas_regras_de_liquidez',
      description: 'Regras de market making configuradas pelo investidor: habilitado, score mínimo, limite de exposição total.',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_input: unknown, ctx) => {
        const u = ctx.userId ? getUserById(ctx.userId) : undefined;
        if (!u) return { erro: 'investidor não encontrado' };
        const settings = getSettings(u);
        return {
          marketMakerEnabled: settings.marketMakerEnabled,
          scoreMinimo: Number(settings.marketMakerMinScore) || 0,
          exposicaoMaximaFmt: fmtBRL(parseValor(settings.marketMakerMaxExposicao)),
          exposicaoMaxima: parseValor(settings.marketMakerMaxExposicao),
        };
      },
    },
    {
      name: 'listar_anuncios_sem_lance',
      description: 'Lista anúncios ativos de OUTROS investidores no mercado secundário que ainda não têm nenhum lance ativo — candidatos a receber liquidez.',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_input: unknown, ctx) => {
        const bestBids = bestActiveBidsByListing();
        return listActiveListings()
          .filter((l) => l.seller_id !== ctx.userId && !bestBids.has(l.id))
          .map((l) => ({
            listingId: l.id,
            duplicataId: l.duplicata_id,
            sacado: l.sacado_nome,
            score: l.score,
            askingValorFmt: fmtBRL(l.asking_valor),
            askingValor: l.asking_valor,
            valorOriginalFmt: fmtBRL(l.original_valor),
          }));
      },
    },
    {
      name: 'calcular_lance_justo',
      description:
        'Calcula um lance justo para um anúncio: usa a faixa de taxa real do rating da duplicata (mesma lógica do preço dinâmico do leilão primário) e nunca sugere acima do preço pedido.',
      inputSchema: { type: 'object', properties: { listingId: { type: 'number' } }, required: ['listingId'] },
      handler: async (input: { listingId: number }) => {
        const listing = listActiveListings().find((l) => l.id === input.listingId);
        if (!listing) return { erro: 'anúncio não encontrado' };
        const duplicata = getDuplicata(listing.duplicata_id);
        if (!duplicata) return { erro: 'duplicata não encontrada' };
        const rating = ratingFromScore(listing.score ?? 60);
        const fairDesagioPct = estimateRateBand(rating).mid;
        const fairValue = listing.original_valor * (1 - fairDesagioPct / 100);
        const sugestao = Math.round(Math.min(listing.asking_valor, fairValue) * (1 - MAKER_SPREAD_PCT));
        return {
          listingId: listing.id,
          rating,
          fairDesagioPct: +fairDesagioPct.toFixed(2),
          askingValorFmt: fmtBRL(listing.asking_valor),
          lanceSugeridoFmt: fmtBRL(sugestao),
          lanceSugerido: sugestao,
        };
      },
    },
    {
      name: 'ver_minha_capacidade_disponivel',
      description: 'Quanto capital o investidor já comprometeu em lances de liquidez ativos, e quanto ainda resta dentro do limite configurado.',
      inputSchema: { type: 'object', properties: {} },
      handler: async (_input: unknown, ctx) => {
        if (!ctx.userId) return { erro: 'sem investidor no contexto' };
        const u = getUserById(ctx.userId);
        if (!u) return { erro: 'investidor não encontrado' };
        const settings = getSettings(u);
        const maxExposicao = parseValor(settings.marketMakerMaxExposicao);
        const comprometido = listMyBids(ctx.userId)
          .filter((b) => b.status === 'ativo')
          .reduce((sum, b) => sum + b.valor, 0);
        return {
          maxExposicaoFmt: fmtBRL(maxExposicao),
          comprometidoFmt: fmtBRL(comprometido),
          disponivelFmt: fmtBRL(Math.max(0, maxExposicao - comprometido)),
          disponivel: Math.max(0, maxExposicao - comprometido),
        };
      },
    },
    {
      name: 'dar_lance_liquidez',
      description:
        'Dá um lance de liquidez em um anúncio ativo, em nome do próprio investidor (nunca de outra conta — o valor sempre opera sobre o userId do contexto da execução, não é um parâmetro que o modelo escolhe). Ação sensível — compromete capital real.',
      sensitive: true,
      selfApprovable: true,
      extractValueBRL: async (input: { valor: number }) => input.valor ?? null,
      inputSchema: {
        type: 'object',
        properties: {
          listingId: { type: 'number' },
          valor: { type: 'number', description: 'Valor do lance em reais, sem formatação (ex: 8500).' },
        },
        required: ['listingId', 'valor'],
      },
      handler: async (input: { listingId: number; valor: number }, ctx) => {
        if (!ctx.userId) throw new Error('Execução sem investidor associado.');
        const user = getUserById(ctx.userId);
        if (!user) throw new Error('Investidor não encontrado.');
        const outcome = placeBid(user, input.listingId, String(input.valor));
        if (outcome.status !== 200) throw new Error(outcome.body.message);
        return { ok: true, valorFmt: fmtBRL(input.valor) };
      },
    },
  ],
};
