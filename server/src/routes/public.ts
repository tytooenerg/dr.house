import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { buildPublicStats } from '../lib/publicStatsCore.js';
import { computeUptimePct, listRecentHealthChecks } from '../db/systemHealth.js';
import { computeEmitirPreview } from '../lib/emitirCore.js';
import { fmtRelative, fmtBRL } from '../lib/format.js';
import { parseWebhookPixRecebido } from '../lib/paymentRail.js';
import { getPixCharge, concludePixCharge } from '../db/pix.js';
import { parseWebhookBoletoPago } from '../lib/boletoRail.js';
import { getBoleto, concludeBoleto } from '../db/boletos.js';
import { parseWebhookTedRecebido } from '../lib/tedRail.js';
import { getTedDeposit, concludeTedDeposit } from '../db/ted.js';
import { parseWebhookStablecoinRecebido } from '../lib/stablecoinRail.js';
import { getStablecoinDeposit, concludeStablecoinDeposit } from '../db/stablecoin.js';
import { getUserByWhitelabelDomain } from '../db/users.js';
import { addLedgerEntry } from '../db/misc.js';
import { cached } from '../lib/cache.js';
import { logger } from '../lib/logger.js';
import { isFeatureEnabled } from '../lib/featureFlags.js';
import { listActiveApprovedAdvertisements } from '../db/advertisements.js';

// Fully public, unauthenticated endpoints: the transparency page, the status page, and
// the embeddable rate simulator widget — all meant to be called from outside the app
// (a partner's own site, an anonymous visitor) so none of them require login.
export const publicRouter = Router();

// White-label com domínio próprio (erp.ts's POST /whitelabel/domain) — the SPA calls this
// once at boot, before any login, so a visitor arriving at a whitelabeled bank's own
// domain sees that bank's nome/corPrimaria/logoUrl on the login screen itself instead of
// "Lastro". req.get('host') is the same pattern already used for the Google OAuth/SAML
// redirect URL (routes/auth.ts) — the real Host header the browser sent, port included if
// non-standard. { brand: null } (not an error) is the correct, expected response for
// every visitor on the default Lastro domain — this is not a lookup failure.
publicRouter.get('/brand', (req, res) => {
  const host = (req.get('host') || '').toLowerCase().split(':')[0];
  const owner = host ? getUserByWhitelabelDomain(host) : undefined;
  if (!owner || !owner.whitelabel_plus_enabled) {
    res.json({ brand: null });
    return;
  }
  let brand: { nome: string; corPrimaria: string; logoUrl: string } | null = null;
  try {
    brand = JSON.parse(owner.settings || '{}').whitelabelBrand ?? null;
  } catch {
    brand = null;
  }
  res.json({ brand });
});

// Rate limiter shared by the four payment-rail webhook targets below. Their real
// anti-spoofing story is mTLS/IP-allowlisting at the PSP/infra level (see each route's own
// comment) plus the fact that txid/nossoNumero/referencia are all crypto.randomUUID()-grade
// unguessable — but neither of those is a reason to leave an unauthenticated POST endpoint
// completely unthrottled. Limit is generous (a real PSP can legitimately burst retries)
// purely as brute-force/DoS defense-in-depth, found in the security self-review
// (docs/security-review-2026-08.md, finding SR-2).
const paymentWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited' },
});

// Real PSP webhook target for "pix recebido" notifications (BACEN standard shape,
// see lib/paymentRail.ts). Anti-spoofing for a real deployment is mTLS on the registered
// webhook URL, not a header signature — configure that at the PSP/infra level once a real
// PIX_PSP_* contract exists. Always 200s so a legitimately-signed retry isn't triggered by
// an unrelated/already-processed txid.
publicRouter.post('/pix-webhook', paymentWebhookLimiter, (req, res) => {
  const recebidos = parseWebhookPixRecebido(req.body);
  for (const r of recebidos) {
    const charge = getPixCharge(r.txid);
    if (!charge || charge.status !== 'ativa') continue;
    concludePixCharge(charge.txid, r.endToEndId);
    addLedgerEntry(charge.user_id, new Date().toLocaleDateString('pt-BR'), `Depósito via Pix confirmado — ${fmtBRL(charge.valor)}`, charge.valor);
    logger.info({ txid: charge.txid, userId: charge.user_id }, '[pix] depósito confirmado via webhook');
  }
  res.status(200).json({ received: recebidos.length });
});

// Real banking-partner webhook target for "boleto pago" notifications (lib/boletoRail.ts).
// Same anti-spoofing caveat as the Pix webhook above: real verification is mTLS/IP
// allowlist at the banking partner's infra level.
publicRouter.post('/boleto-webhook', paymentWebhookLimiter, (req, res) => {
  const pagos = parseWebhookBoletoPago(req.body);
  for (const p of pagos) {
    const boleto = getBoleto(p.nossoNumero);
    if (!boleto || boleto.status !== 'ativo') continue;
    concludeBoleto(boleto.nosso_numero);
    addLedgerEntry(boleto.user_id, new Date().toLocaleDateString('pt-BR'), `Depósito via boleto confirmado — ${fmtBRL(boleto.valor)}`, boleto.valor);
    logger.info({ nossoNumero: boleto.nosso_numero, userId: boleto.user_id }, '[boleto] depósito confirmado via webhook');
  }
  res.status(200).json({ received: pagos.length });
});

// Real BaaS webhook target for "TED recebido" notifications, only ever called by a
// TED_PSP_*-configured provider (lib/tedRail.ts) — the static-account path is always
// confirmed by an admin instead (POST /admin/ted/:referencia/confirmar), never here.
publicRouter.post('/ted-webhook', paymentWebhookLimiter, (req, res) => {
  const recebidos = parseWebhookTedRecebido(req.body);
  for (const r of recebidos) {
    const deposito = getTedDeposit(r.referencia);
    if (!deposito || deposito.status !== 'ativo') continue;
    concludeTedDeposit(deposito.referencia, null);
    addLedgerEntry(deposito.user_id, new Date().toLocaleDateString('pt-BR'), `Depósito via TED confirmado — ${fmtBRL(deposito.valor)}`, deposito.valor);
    logger.info({ referencia: deposito.referencia, userId: deposito.user_id }, '[ted] depósito confirmado via webhook');
  }
  res.status(200).json({ received: recebidos.length });
});

// Real custodial/VASP webhook target for "stablecoin recebido" notifications, only ever
// called by a STABLECOIN_PSP_*-configured provider (lib/stablecoinRail.ts) — the static-
// wallet path is always confirmed by an admin instead (POST
// /admin/stablecoin/:referencia/confirmar), never here.
publicRouter.post('/stablecoin-webhook', paymentWebhookLimiter, (req, res) => {
  const recebidos = parseWebhookStablecoinRecebido(req.body);
  for (const r of recebidos) {
    const deposito = getStablecoinDeposit(r.referencia);
    if (!deposito || deposito.status !== 'ativo') continue;
    concludeStablecoinDeposit(deposito.referencia, null, r.txHash);
    addLedgerEntry(deposito.user_id, new Date().toLocaleDateString('pt-BR'), `Depósito via ${deposito.asset} confirmado — ${fmtBRL(deposito.valor)}`, deposito.valor);
    logger.info({ referencia: deposito.referencia, userId: deposito.user_id }, '[stablecoin] depósito confirmado via webhook');
  }
  res.status(200).json({ received: recebidos.length });
});

// Fully public, no auth, so it's the platform's highest-traffic real read (the
// transparency page + anyone embedding it) — cached for a short 30s TTL (lib/cache.ts,
// real Redis when REDIS_URL is set, an in-memory TTL map otherwise) instead of
// recomputing the full aggregate on every request. 30s of staleness on public transparency
// numbers is a real trade-off worth stating, not one worth hiding.
publicRouter.get('/stats', async (_req, res) => {
  res.json(await cached('public:stats', 30, () => buildPublicStats()));
});

// Fully public feed for the landing page's ad carousel (feature "Carrossel de
// publicidade") — só anúncios aprovados por um admin (routes/admin.ts) e que a própria
// conta anunciante ainda mantém ativos (routes/advertisements.ts). Um admin também pode
// desligar o carrossel inteiro sem redeploy via lib/featureFlags.ts, mesma válvula de
// segurança que o widget embutido já usa — útil se um anúncio aprovado se revelar
// problemático depois do fato.
publicRouter.get('/advertisements', async (_req, res) => {
  if (!isFeatureEnabled('ad_carousel')) {
    res.json({ ads: [] });
    return;
  }
  res.json({ ads: await cached('public:advertisements', 30, () => listActiveApprovedAdvertisements()) });
});

publicRouter.get('/status', (_req, res) => {
  const history = listRecentHealthChecks(50);
  res.json({
    current: history[0] ? { status: history[0].status, latencyMs: history[0].latency_ms, checkedAt: fmtRelative(history[0].created_at) } : null,
    uptimePct24h: computeUptimePct(24),
    uptimePct7d: computeUptimePct(24 * 7),
    history: history.map((h) => ({ status: h.status, latencyMs: h.latency_ms, checkedAt: fmtRelative(h.created_at) })),
  });
});

const simulateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: 'Muitas simulações — tente novamente em instantes.' },
});

const simulateSchema = z.object({
  sacado: z.string().trim().optional().default(''),
  valor: z.string().trim(),
  vencimento: z.string().trim().optional().default(''),
});

// Powers the embeddable "simule sua antecipação" widget — reuses the exact same rate
// model as the real Emitir Duplicata flow (lib/emitirCore.ts), just without persisting
// anything, so the number a visitor sees is never fictional.
publicRouter.post('/simular', simulateLimiter, (req, res) => {
  // See lib/featureFlags.ts — an admin can kill the widget endpoint alone (e.g. a
  // specific embedding domain is abusing it) without touching the public rate limiter
  // used everywhere else, and without redeploying.
  if (!isFeatureEnabled('embeddable_widget')) {
    res.status(503).json({ error: 'feature_disabled', message: 'O widget de simulação está temporariamente indisponível.' });
    return;
  }
  const parsed = simulateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const preview = computeEmitirPreview({
    sacado: parsed.data.sacado,
    cnpj: '',
    valor: parsed.data.valor,
    vencimento: parsed.data.vencimento,
    seguro: false,
    nfAnexada: false,
    nfeChave: '',
    batchValores: [],
  });
  res.json({
    valorFmt: preview.emitSummary.valorFmt,
    taxaEstimadaFmt: preview.emitSummary.taxaEstimadaFmt,
    plataformaFeeFmt: preview.emitSummary.plataformaFeeFmt,
    sacadoRecognized: preview.sacadoRecognized,
    sacadoRecognizedText: preview.sacadoRecognizedText,
  });
});
