import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePlan } from '../auth/middleware.js';
import { getSettings, updateSettings } from '../db/users.js';
import { addAutomationActivity, listAutomationActivity } from '../db/misc.js';
import { fmtRelative, fmtBRL, parseBRLNumber } from '../lib/format.js';
import { listMarketplace, isPurchased, createPurchase, listPurchasesByInvestor } from '../db/duplicatas.js';
import { getAceiteByDuplicata } from '../db/aceites.js';
import { placeAuctionBid } from '../lib/auctionCore.js';
import { computePurchasePrice } from '../lib/marketCompute.js';
import { deliverWebhookEvent } from '../lib/webhookDelivery.js';
import { ratingFromScore, sectorFor } from '../lib/riscoCore.js';
import { currentFloor, nextStepAt, armLadder, getLadderBand } from '../lib/autoBidLadder.js';
import type { UserRow, UserSettings, LadderConfig } from '../db/types.js';
import type { Rating } from '../data/seed.js';

const RATINGS: Rating[] = ['AA', 'A', 'B', 'C'];

export const automationRouter = Router();
automationRouter.use(requireAuth, requirePlan('pro'));

const SCORE_ORDER: Record<string, number> = { AA: 4, A: 3, B: 2, C: 1 };

// Per-user, in-memory "already decided" set so a rejected offer isn't re-logged on every
// poll — cleared implicitly once the offer is bought/removed from listMarketplace, or the
// process restarts. This is a UI-pacing concern, not correctness: the real accept/reject
// decision is always recomputed fresh against the live rules below.
const decided = new Map<number, Set<string>>();
function decidedSet(userId: number): Set<string> {
  let s = decided.get(userId);
  if (!s) {
    s = new Set();
    decided.set(userId, s);
  }
  return s;
}

const tickCache = new Map<number, number>();

// Real automated bidding: evaluates the investor's configured rules against the actual
// open marketplace (not a static demo list) and, when an offer passes every rule, performs
// the exact same purchase (createPurchase + settlePurchase + webhook) a manual "Comprar"
// click would. This used to draw from a fixed AUTO_BID_OFFERS array and roll dice on
// whether to "apply" — a paid Pro-plan feature that never touched a real offer.
function maybeTick(user: UserRow, settings: ReturnType<typeof getSettings>) {
  if (!settings.autoBidEnabled) return;
  if (user.kyb_status !== 'approved') return; // same gate manual buying enforces
  const now = Date.now();
  const last = tickCache.get(user.id) ?? 0;
  if (now - last < 4000) return;
  tickCache.set(user.id, now);

  const seen = decidedSet(user.id);
  const candidates = listMarketplace().filter((d) => {
    if (d.status !== 'no_mercado') return false;
    if (isPurchased(d.id)) return false;
    // Achado corrigido: exige aceite confirmado (explícito ou tácito), não só
    // "diferente de contestada" — defesa em profundidade além do bloqueio em
    // dispararLeilao (routes/minhas.ts).
    if (getAceiteByDuplicata(d.id)?.status !== 'aceita') return false;
    return !seen.has(d.id);
  });
  if (candidates.length === 0) return;

  // One decision per tick — an automated engine working through a queue in order, not a
  // burst that could commit the whole configured exposure to a single poll.
  const offer = candidates[candidates.length - 1]; // oldest first (listMarketplace is DESC)
  seen.add(offer.id);

  const rating = ratingFromScore(offer.score ?? 60);
  const minOrder = SCORE_ORDER[settings.autoBidRules.scoreMin] || SCORE_ORDER.A;
  const passesScore = SCORE_ORDER[rating] >= minOrder;

  // Achado corrigido: "taxa máxima a oferecer" era, na prática, um teto de risco
  // (offerRate <= taxaMax) — o preço é sempre calculado pelo servidor, o investidor nunca
  // propunha nada de verdade. A escada por classe inverte isso pra um PISO que decai com o
  // tempo (offerRate >= piso atual): começa só aceitando o melhor deságio da classe, e
  // relaxa a exigência a cada intervaloHoras sem compra, até o piso configurado
  // (taxaAlvo) — ver lib/autoBidLadder.ts.
  const offerRate = parseFloat((offer.desagio ?? '0').replace('%', '').replace(',', '.')) || 0;
  const ladderCfg = settings.autoBidLadder[rating];
  const piso = currentFloor(ladderCfg, rating);
  const passesTaxa = offerRate >= piso;

  const classAlloc = (settings.diversification as Record<string, number>)[rating] || 0;
  const passesDiversificacao = classAlloc > 0;

  // sectorDiversification only tracks the 4 original classes (varejo/industria/construcao/
  // servicos) — a sacado classified into a newer sector this control doesn't manage yet
  // (e.g. atacado/comercio) is treated the same honest way as an unknown sector: don't
  // silently block the auto-bid on a cap that was never configured for it.
  const sector = sectorFor(offer.sacado_nome);
  const sectorAlloc = sector && sector in settings.sectorDiversification ? (settings.sectorDiversification as Record<string, number>)[sector] : null;
  const passesSetor = sectorAlloc === null || sectorAlloc > 0;

  const purchases = listPurchasesByInvestor(user.id).filter((p) => p.active);
  const exposicaoSacadoAtual = purchases.filter((p) => p.sacado_nome === offer.sacado_nome).reduce((sum, p) => sum + p.valor, 0);
  const limiteSacado = parseBRLNumber(settings.autoBidRules.exposicaoSacado) || Infinity;
  const passesExposicaoSacado = exposicaoSacadoAtual + offer.valor <= limiteSacado;

  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  const exposicaoMesAtual = purchases
    .filter((p) => new Date(p.created_at + 'Z') >= inicioMes)
    .reduce((sum, p) => sum + p.valor, 0);
  const limiteMensal = parseBRLNumber(settings.autoBidRules.exposicaoMensal) || Infinity;
  const passesExposicaoMensal = exposicaoMesAtual + offer.valor <= limiteMensal;

  const passes = passesScore && passesTaxa && passesDiversificacao && passesSetor && passesExposicaoSacado && passesExposicaoMensal;

  if (passes) {
    // Agora que o leilão é real, a automação DÁ UM LANCE em vez de comprar na hora. O piso
    // atual da escada (PR da escada por classe de rating) é exatamente o retorno mínimo que
    // este investidor aceita, então é a taxa que ele propõe: conforme a escada relaxa com o
    // tempo, o lance fica mais competitivo sozinho. Quem leva a duplicata é decidido no
    // fechamento (lib/auctionClose.ts), não por quem clicou primeiro.
    const piso = currentFloor(ladderCfg, rating);
    const outcome = placeAuctionBid(user, offer.id, piso);
    if (outcome.status !== 200) {
      addAutomationActivity(user.id, `Lance recusado em ${offer.sacado_nome}: ${(outcome.body as { message?: string }).message ?? 'leilão indisponível'}`, '#B8790A');
      return;
    }
    // Fechou um ciclo nesta classe — rearma a escada pra voltar a ser exigente na próxima.
    updateSettings(user.id, { autoBidLadder: { ...settings.autoBidLadder, [rating]: { ...ladderCfg, ...armLadder() } } });
    addAutomationActivity(
      user.id,
      `Automação aplicada — lance de ${fmtPct(piso)} a.m. em ${offer.sacado_nome} (${fmtBRL(offer.valor)}, rating ${rating}), dentro de todos os parâmetros configurados`,
      '#0A5C36'
    );
    return;
  }

  const reason = !passesScore
    ? `rating ${rating} abaixo do mínimo configurado (${settings.autoBidRules.scoreMin})`
    : !passesTaxa
      ? `deságio ${offer.desagio} ainda abaixo do piso atual da escada pro rating ${rating} (${piso.toFixed(2).replace('.', ',')}%)`
      : !passesDiversificacao
        ? `classe de rating ${rating} está zerada na diversificação da carteira`
        : !passesSetor
          ? `setor "${sector}" está zerado na diversificação setorial`
          : !passesExposicaoSacado
            ? `excederia o limite de exposição por sacado (${settings.autoBidRules.exposicaoSacado})`
            : `excederia o limite de exposição mensal (${settings.autoBidRules.exposicaoMensal})`;
  addAutomationActivity(user.id, `Oferta de ${offer.sacado_nome} (${fmtBRL(offer.valor)}) ignorada — ${reason}`, '#5B6472');
}

function fmtPct(n: number): string {
  return n.toFixed(2).replace('.', ',') + '%';
}

// View da escada por classe — sempre recalculada na hora (currentFloor/nextStepAt são
// funções puras de tempo decorrido, não dependem de nenhum job de fundo rodando).
function buildLadderView(settings: UserSettings) {
  const view = {} as Record<Rating, {
    taxaInicial: number; taxaAlvo: number; decrementoPorEtapa: number; intervaloHoras: number;
    pisoAtualFmt: string; proximaQuedaEm: string | null; bandaAoVivo: { minFmt: string; maxFmt: string };
  }>;
  for (const rating of RATINGS) {
    const cfg = settings.autoBidLadder[rating];
    const band = getLadderBand(rating);
    const proxima = nextStepAt(cfg, rating);
    view[rating] = {
      // Valores crus (não formatados) — editáveis direto num input numérico no client,
      // já resolvidos contra a banda ao vivo quando taxaInicial/taxaAlvo estão null.
      taxaInicial: cfg.taxaInicial ?? band.max,
      taxaAlvo: cfg.taxaAlvo ?? band.min,
      decrementoPorEtapa: cfg.decrementoPorEtapa,
      intervaloHoras: cfg.intervaloHoras,
      pisoAtualFmt: fmtPct(currentFloor(cfg, rating)),
      proximaQuedaEm: proxima ? proxima.toISOString() : null,
      bandaAoVivo: { minFmt: fmtPct(band.min), maxFmt: fmtPct(band.max) },
    };
  }
  return view;
}

// Every route below hands the client the exact same AutomationData shape the client's
// `AutomacaoPage.tsx` keeps as its whole page state (each mutation handler does
// `api.post(...).then(setData)` — replacing all of it, not merging a partial patch in). A
// handler that responded with just the field it changed would leave every other field
// `undefined` in the client's state, and the next render (e.g. `data.diversification.AA`)
// would throw and take down the whole page. Build the payload from the `settings` object
// each handler already has — never from `req.user!` again after an `updateSettings` call:
// `req.user` was loaded once at the top of the request by the auth middleware, so its
// `.settings` JSON is a snapshot from before the write and `getSettings(req.user!)` would
// silently hand back the pre-update values instead of what was just saved.
function buildAutomationPayload(userId: number, settings: UserSettings) {
  return {
    autoBidEnabled: settings.autoBidEnabled,
    autoBidRules: settings.autoBidRules,
    ladder: buildLadderView(settings),
    diversification: settings.diversification,
    sectorDiversification: settings.sectorDiversification,
    autoBidActivity: listAutomationActivity(userId).map((a) => ({ text: a.text, color: a.color, time: fmtRelative(a.created_at) })),
    marketMakerEnabled: settings.marketMakerEnabled,
    marketMakerMaxExposicao: settings.marketMakerMaxExposicao,
    marketMakerMinScore: settings.marketMakerMinScore,
  };
}

automationRouter.get('/', (req, res) => {
  const settings = getSettings(req.user!);
  maybeTick(req.user!, settings);
  // maybeTick pode ter rearmado a escada de uma classe (compra bem-sucedida) via
  // updateSettings — relê do banco em vez de devolver o `settings` já desatualizado.
  const latest = getSettings(req.user!);
  res.json(buildAutomationPayload(req.user!.id, latest));
});

automationRouter.post('/toggle', (req, res) => {
  const settings = getSettings(req.user!);
  const turningOn = !settings.autoBidEnabled;
  // Ligar a automação rearma toda classe em escopo (diversification > 0) — cada ciclo
  // novo começa exigente, não retomando de onde uma sessão anterior tinha relaxado.
  const ladder = turningOn
    ? RATINGS.reduce(
        (acc, r) => ({ ...acc, [r]: (settings.diversification as Record<string, number>)[r] > 0 ? { ...settings.autoBidLadder[r], ...armLadder() } : settings.autoBidLadder[r] }),
        settings.autoBidLadder
      )
    : settings.autoBidLadder;
  const updated = updateSettings(req.user!.id, { autoBidEnabled: turningOn, autoBidLadder: ladder });
  res.json(buildAutomationPayload(req.user!.id, updated));
});

const ruleSchema = z.object({ field: z.enum(['scoreMin', 'exposicaoSacado', 'exposicaoMensal']), value: z.string() });

automationRouter.post('/rule', (req, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { autoBidRules: { ...settings.autoBidRules, [parsed.data.field]: parsed.data.value } });
  res.json(buildAutomationPayload(req.user!.id, updated));
});

// value: null em taxaInicial/taxaAlvo volta a usar a banda ao vivo (estimateRateBand) como
// default — mesmo padrão de "campo nulo cai pro cálculo dinâmico" já usado por d.desagio.
const ladderSchema = z.object({
  rating: z.enum(['AA', 'A', 'B', 'C']),
  field: z.enum(['taxaInicial', 'taxaAlvo', 'decrementoPorEtapa', 'intervaloHoras']),
  value: z.number().nullable(),
});

automationRouter.post('/ladder', (req, res) => {
  const parsed = ladderSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const { rating, field, value } = parsed.data;
  if ((field === 'decrementoPorEtapa' || field === 'intervaloHoras') && (value === null || value <= 0)) {
    res.status(400).json({ error: 'validation_error', message: `${field} precisa ser um número maior que zero.` });
    return;
  }
  const settings = getSettings(req.user!);
  const cfg = settings.autoBidLadder[rating];
  // Rearma ao editar — mudou a régua, o relógio desta classe recomeça do degrau mais exigente.
  const updatedCfg: LadderConfig = { ...cfg, [field]: value, ...armLadder() };
  const band = getLadderBand(rating);
  const inicial = updatedCfg.taxaInicial ?? band.max;
  const alvo = updatedCfg.taxaAlvo ?? band.min;
  if (inicial < alvo) {
    res.status(400).json({ error: 'validation_error', message: 'A taxa inicial precisa ser maior ou igual à taxa alvo — a escada só desce.' });
    return;
  }
  const updated = updateSettings(req.user!.id, { autoBidLadder: { ...settings.autoBidLadder, [rating]: updatedCfg } });
  res.json(buildAutomationPayload(req.user!.id, updated));
});

const divSchema = z.object({ cls: z.enum(['AA', 'A', 'B', 'C']), value: z.number().min(0).max(100) });

automationRouter.post('/diversification', (req, res) => {
  const parsed = divSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { diversification: { ...settings.diversification, [parsed.data.cls]: parsed.data.value } });
  res.json(buildAutomationPayload(req.user!.id, updated));
});

const sectorSchema = z.object({ cls: z.enum(['varejo', 'industria', 'construcao', 'servicos']), value: z.number().min(0).max(100) });

automationRouter.post('/sector-diversification', (req, res) => {
  const parsed = sectorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { sectorDiversification: { ...settings.sectorDiversification, [parsed.data.cls]: parsed.data.value } });
  res.json(buildAutomationPayload(req.user!.id, updated));
});

// Opt-in for lib/agents/marketMaker.ts (11th agent) — same "toggle + rules" shape as
// autoBid above, but for the periodic liquidity-providing agent (lib/marketMakerAgentJob.ts)
// instead of the rule-based auction auto-bid engine.
automationRouter.post('/market-maker/toggle', (req, res) => {
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { marketMakerEnabled: !settings.marketMakerEnabled });
  res.json(buildAutomationPayload(req.user!.id, updated));
});

const marketMakerRuleSchema = z.object({ field: z.enum(['marketMakerMaxExposicao', 'marketMakerMinScore']), value: z.string() });

automationRouter.post('/market-maker/rule', (req, res) => {
  const parsed = marketMakerRuleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const updated = updateSettings(req.user!.id, { [parsed.data.field]: parsed.data.value });
  res.json(buildAutomationPayload(req.user!.id, updated));
});
