import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { listMarketplace, getDuplicata, setInsurer, createPurchase, isPurchased } from '../db/duplicatas.js';
import { getAceiteByDuplicata } from '../db/aceites.js';
import { getSeguradoraByInsurerKey } from '../db/users.js';
import { buildOfferView, computePurchasePrice } from '../lib/marketCompute.js';
import { deliverWebhookEvent } from '../lib/webhookDelivery.js';
import { settlePurchase, settleInsurance } from '../lib/settlement.js';
import { computeInsurerQuotePct, diasAteVencimento } from '../lib/insuranceQuotes.js';
import { checkFractionalEligibility, buyFractionalTokens, buyTokensSchema, buildOfferingView, listMyFractionalHoldings } from '../lib/fractionalOfferings.js';
import { INSURERS } from '../data/seed.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { explainFundingOffer } from '../lib/fundingExplainability.js';

export const marketRouter = Router();
marketRouter.use(requireAuth);

// A numeric range filter query param comes in as "min,max" (either half optional, e.g.
// "50000," or ",90"); undefined/malformed input means "no bound" rather than excluding
// everything, matching how every other optional filter here degrades gracefully.
function parseRange(raw: unknown): { min: number | null; max: number | null } {
  if (typeof raw !== 'string' || !raw.includes(',')) return { min: null, max: null };
  const [minRaw, maxRaw] = raw.split(',', 2);
  const min = minRaw.trim() ? Number(minRaw) : null;
  const max = maxRaw.trim() ? Number(maxRaw) : null;
  return { min: min !== null && Number.isFinite(min) ? min : null, max: max !== null && Number.isFinite(max) ? max : null };
}

marketRouter.get('/', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().toLowerCase() : '';
  const sort = typeof req.query.sort === 'string' ? req.query.sort : 'taxa';
  const setor = typeof req.query.setor === 'string' && req.query.setor ? req.query.setor : null;
  const rating = typeof req.query.rating === 'string' && req.query.rating ? req.query.rating : null;
  const valorRange = parseRange(req.query.valor);
  const prazoRange = parseRange(req.query.prazo);
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 20));

  let offers = listMarketplace().map(buildOfferView);
  if (q) offers = offers.filter((o) => o.sacado.toLowerCase().includes(q) || o.cedente.toLowerCase().includes(q));
  if (setor) offers = offers.filter((o) => o.setor === setor);
  if (rating) offers = offers.filter((o) => o.rating === rating);
  if (valorRange.min !== null) offers = offers.filter((o) => o.valor >= valorRange.min!);
  if (valorRange.max !== null) offers = offers.filter((o) => o.valor <= valorRange.max!);
  if (prazoRange.min !== null) offers = offers.filter((o) => o.prazoDias >= prazoRange.min!);
  if (prazoRange.max !== null) offers = offers.filter((o) => o.prazoDias <= prazoRange.max!);

  if (sort === 'taxa') offers.sort((a, b) => parseFloat(a.desagio) - parseFloat(b.desagio));
  else if (sort === 'score') offers.sort((a, b) => b.score - a.score);
  else if (sort === 'valor') offers.sort((a, b) => b.valor - a.valor);
  else if (sort === 'prazo') offers.sort((a, b) => a.countdownSec - b.countdownSec);

  const total = offers.length;
  const paged = offers.slice((page - 1) * pageSize, page * pageSize);

  res.json({ offers: paged, page, pageSize, total });
});

marketRouter.post('/:id/buy', (req, res) => {
  if (req.user!.role !== 'investidor') {
    res.status(403).json({ error: 'forbidden', message: 'Apenas contas de investidor podem comprar duplicatas.' });
    return;
  }
  if (req.user!.kyb_status !== 'approved') {
    res.status(403).json({ error: 'kyb_required', message: 'Seu credenciamento institucional ainda está em análise — assim que for aprovado você poderá dar lances.' });
    return;
  }
  const d = getDuplicata(req.params.id);
  if (!d) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const aceite = getAceiteByDuplicata(d.id);
  if (aceite?.status === 'contestada') {
    res.status(409).json({ error: 'contested', message: 'Esta duplicata está contestada e não pode ser comprada.' });
    return;
  }
  if (isPurchased(d.id)) {
    res.status(409).json({ error: 'already_purchased', message: 'Esta duplicata já foi comprada.' });
    return;
  }
  const { precoCompra } = computePurchasePrice(d);
  createPurchase(d.id, req.user!.id, d.valor, d.desagio ?? '', Math.round(d.valor - precoCompra));
  settlePurchase({ duplicataId: d.id, sacadoNome: d.sacado_nome, investorId: req.user!.id, cedenteId: d.cedente_id, valor: d.valor, precoCompra });
  if (d.cedente_id) {
    void deliverWebhookEvent(d.cedente_id, 'pagamento.confirmado', { duplicataId: d.id, valor: d.valor, investorId: req.user!.id });
  }
  res.json({ offers: listMarketplace().map(buildOfferView) });
});

const insureSchema = z.object({ key: z.enum(['too', 'pottencial', 'junto']).nullable() });

// Only an investidor can contract insurance — it's protection on their own position, paid
// for out of their own ledger, same access rule as buying. Real money moves the moment a
// *new* insurer key is set (see settleInsurance): switching between two different insurers
// charges the new premium again; re-submitting the same key or removing insurance doesn't
// charge or refund — a deliberate simplification, not a real-world proration engine.
marketRouter.post('/:id/insure', (req, res) => {
  if (req.user!.role !== 'investidor') {
    res.status(403).json({ error: 'forbidden', message: 'Apenas contas de investidor podem contratar seguro sobre uma posição.' });
    return;
  }
  const parsed = insureSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const d = getDuplicata(req.params.id);
  if (!d) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  const newKey = parsed.data.key;
  const isNewContract = !!newKey && newKey !== d.insurer_key;
  // Underwriting only covers a risk that hasn't happened yet — a real seguradora never
  // sells a policy on a loss that's already known. Without this, anyone could "insure" a
  // duplicata the instant its vencimento passes unpaid and immediately file the resulting
  // sinistro (see lib/seguradoraCore.ts's decideSinistro, which now actually pays out).
  if (isNewContract && diasAteVencimento(d.vencimento) < 0) {
    res.status(409).json({
      error: 'already_overdue',
      message: 'Não é possível contratar seguro para uma duplicata cujo vencimento já passou — o risco já se realizou, isso não é mais uma apólice, é uma indenização garantida.',
    });
    return;
  }
  setInsurer(d.id, newKey);
  if (isNewContract) {
    const insurer = INSURERS.find((i) => i.key === newKey)!;
    // The premium charged is the live competing quote (lib/insuranceQuotes.ts) at the
    // moment of contracting — each insurer prices this specific duplicata's real risk
    // differently, not the same flat catalog rate every time.
    const premioPct = computeInsurerQuotePct(insurer.key, d);
    const premio = d.valor * (premioPct / 100);
    const seguradoraUser = getSeguradoraByInsurerKey(insurer.key);
    settleInsurance({ duplicataId: d.id, investorId: req.user!.id, insurerKey: insurer.key, insurerUserId: seguradoraUser?.id ?? null, premio });
  }
  res.json({ offers: listMarketplace().map(buildOfferView) });
});

// Tokenização/fracionamento (lib/fractionalOfferings.ts) — a real, purely additive
// alternative to whole purchase for large duplicatas: multiple investors can each buy a
// slice instead of one investor funding the whole thing.
marketRouter.get('/:id/fracionamento', (req, res) => {
  const eligibility = checkFractionalEligibility(req.params.id);
  const offering = buildOfferingView(req.params.id);
  res.json({ eligible: eligibility.eligible, reason: eligibility.eligible ? null : eligibility.reason, offering });
});

marketRouter.post(
  '/:id/fracionar',
  asyncHandler(async (req, res) => {
    const parsed = buyTokensSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = buyFractionalTokens(req.user!, req.params.id, parsed.data.tokens);
    res.status(outcome.status).json(outcome.body);
  })
);

marketRouter.get('/minhas-cotas', (req, res) => {
  res.json({ holdings: listMyFractionalHoldings(req.user!.id) });
});

// "Por que essa oferta?" — funding-matching explainability. Assembles the same real
// score/PD/liquidity/seguro signals already used to price the offer (see
// lib/fundingExplainability.ts) into a reasoning any cedente/investidor on the offer can read.
marketRouter.get(
  '/:id/explicacao',
  asyncHandler(async (req, res) => {
    const explanation = await explainFundingOffer(req.params.id, req.user!.id);
    if (!explanation) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(explanation);
  })
);
