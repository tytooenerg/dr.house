import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePlan } from '../auth/middleware.js';
import { getSettings, updateSettings } from '../db/users.js';
import { addAutomationActivity, listAutomationActivity } from '../db/misc.js';
import { fmtRelative, fmtBRL, parseBRLNumber } from '../lib/format.js';
import { listMarketplace, isPurchased, createPurchase, listPurchasesByInvestor } from '../db/duplicatas.js';
import { getAceiteByDuplicata } from '../db/aceites.js';
import { settlePurchase } from '../lib/settlement.js';
import { deliverWebhookEvent } from '../lib/webhookDelivery.js';
import { ratingFromScore, sectorFor } from '../lib/riscoCore.js';
import type { UserRow, UserSettings } from '../db/types.js';

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
    if (getAceiteByDuplicata(d.id)?.status === 'contestada') return false;
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

  const offerRate = parseFloat((offer.desagio ?? '0').replace('%', '').replace(',', '.')) || 0;
  const taxaMax = parseFloat(settings.autoBidRules.taxaMax.replace(',', '.')) || Infinity;
  const passesTaxa = offerRate <= taxaMax;

  const classAlloc = (settings.diversification as Record<string, number>)[rating] || 0;
  const passesDiversificacao = classAlloc > 0;

  const sector = sectorFor(offer.sacado_nome);
  const sectorAlloc = sector ? (settings.sectorDiversification as Record<string, number>)[sector] ?? 0 : null;
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
    createPurchase(offer.id, user.id, offer.valor, offer.desagio ?? '');
    settlePurchase({ duplicataId: offer.id, sacadoNome: offer.sacado_nome, investorId: user.id, cedenteId: offer.cedente_id, valor: offer.valor });
    if (offer.cedente_id) {
      void deliverWebhookEvent(offer.cedente_id, 'pagamento.confirmado', { duplicataId: offer.id, valor: offer.valor, investorId: user.id });
    }
    addAutomationActivity(
      user.id,
      `Automação aplicada — compra de ${fmtBRL(offer.valor)} em ${offer.sacado_nome} a ${offer.desagio} (rating ${rating}), dentro de todos os parâmetros configurados`,
      '#0A5C36'
    );
    return;
  }

  const reason = !passesScore
    ? `rating ${rating} abaixo do mínimo configurado (${settings.autoBidRules.scoreMin})`
    : !passesTaxa
      ? `deságio ${offer.desagio} acima da taxa máxima configurada (${settings.autoBidRules.taxaMax}%)`
      : !passesDiversificacao
        ? `classe de rating ${rating} está zerada na diversificação da carteira`
        : !passesSetor
          ? `setor "${sector}" está zerado na diversificação setorial`
          : !passesExposicaoSacado
            ? `excederia o limite de exposição por sacado (${settings.autoBidRules.exposicaoSacado})`
            : `excederia o limite de exposição mensal (${settings.autoBidRules.exposicaoMensal})`;
  addAutomationActivity(user.id, `Oferta de ${offer.sacado_nome} (${fmtBRL(offer.valor)}) ignorada — ${reason}`, '#5B6472');
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
  res.json(buildAutomationPayload(req.user!.id, settings));
});

automationRouter.post('/toggle', (req, res) => {
  const settings = getSettings(req.user!);
  const updated = updateSettings(req.user!.id, { autoBidEnabled: !settings.autoBidEnabled });
  res.json(buildAutomationPayload(req.user!.id, updated));
});

const ruleSchema = z.object({ field: z.enum(['scoreMin', 'taxaMax', 'exposicaoSacado', 'exposicaoMensal']), value: z.string() });

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
