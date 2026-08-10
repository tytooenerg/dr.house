import { Router } from 'express';
import { z } from 'zod';
import { apiKeyAbuseBackstop, apiKeyRateLimiter, requireApiKey, requireWriteScope } from '../auth/apiKey.js';
import { emitirFormSchema, submitEmitir } from '../lib/emitirCore.js';
import { aceiteStatusSchema, decideAceite, listAceitesForUser } from '../lib/aceiteCore.js';
import { buildSeguradoraPayload, decideSinistro, sinistroDecisionSchema } from '../lib/seguradoraCore.js';
import { buildBlendedRiscoView } from '../lib/riscoCore.js';
import { addSignal } from '../db/networkSignals.js';
import { getRegistradora } from '../lib/registradoras.js';
import { withIdempotency } from '../lib/idempotency.js';
import { getDuplicata, listMarketplace } from '../db/duplicatas.js';
import { buildOfferView } from '../lib/marketCompute.js';
import { fmtBRL } from '../lib/format.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { chargePerCall } from '../lib/addOnBilling.js';
import { screenEntity } from '../db/sanctions.js';

// Public, versioned, API-key-authenticated endpoints for external partners (ERPs, FIDCs,
// securitizadoras, sacados, seguradoras…) to integrate with directly — distinct from the
// internal /api/* used by the SPA, which is cookie/JWT-authenticated and not meant for
// third parties. See GET /api/v1/openapi.json for the full machine-readable reference.
export const v1Router = Router();
// Order matters: the coarse IP backstop runs first (no identity resolved yet), then
// requireApiKey resolves req.apiKey/req.apiUser, then the real plan-aware limiter (which
// reads them) runs last — see auth/apiKey.ts for why each exists.
v1Router.use(apiKeyAbuseBackstop, requireApiKey, apiKeyRateLimiter);

// A narrow-product key (Score API / PLD screening API — features 2/3, sold standalone to
// companies that aren't full Lastro partners) can only ever reach the one endpoint it was
// sold for. 'platform' keys (every key issued before this feature, and every normal
// partner key today) are unaffected — this only restricts the two new product types.
v1Router.use((req, res, next) => {
  const product = req.apiKey!.product;
  if (product === 'platform') {
    next();
    return;
  }
  const isScoreRoute = product === 'score_api' && req.method === 'GET' && /^\/sacados\/[^/]+\/score$/.test(req.path);
  const isPldRoute = product === 'pld_screening_api' && req.method === 'POST' && req.path === '/pld/triagem';
  if (isScoreRoute || isPldRoute) {
    next();
    return;
  }
  res.status(403).json({ error: 'forbidden', message: 'Esta chave é válida apenas para o produto contratado (Score API ou PLD Screening API).' });
});

function idempotencyHeader(req: import('express').Request): string | undefined {
  const raw = req.header('Idempotency-Key');
  return raw && raw.trim() ? raw.trim() : undefined;
}

v1Router.post(
  '/duplicatas',
  requireWriteScope,
  asyncHandler(async (req, res) => {
    if (req.apiUser!.role !== 'cedente') {
      res.status(403).json({ error: 'forbidden', message: 'Apenas chaves de contas cedente podem emitir duplicatas.' });
      return;
    }
    const parsed = emitirFormSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const sandbox = req.apiKey!.mode === 'test';
    const outcome = await withIdempotency(req.apiUser!.id, 'POST /v1/duplicatas', idempotencyHeader(req), req.body, () =>
      submitEmitir(req.apiUser!, parsed.data, { sandbox })
    );
    res.status(outcome.status).json({ ...outcome.body, mode: req.apiKey!.mode });
  })
);

// A test-mode key can only ever see sandbox=1 rows, and a live key only sandbox=0 —
// enforced here (not just at listing time) so a partner can't probe for a real
// duplicata's ID via a test key, or vice versa. See db/duplicatas.ts / lib/sandboxData.ts.
v1Router.get('/duplicatas/:id', (req, res) => {
  const d = getDuplicata(req.params.id);
  if (!d || !!d.sandbox !== (req.apiKey!.mode === 'test')) {
    res.status(404).json({ error: 'not_found' });
    return;
  }
  res.json({
    id: d.id,
    status: d.status,
    sacado: d.sacado_nome,
    cedente: d.cedente_nome,
    valorFmt: fmtBRL(d.valor),
    vencimento: d.vencimento,
    registro: d.registro,
    registradora: getRegistradora(d.registradora)?.name ?? null,
    lastroPct: d.lastro_pct,
    seguro: !!d.seguro,
  });
});

// A test-mode key sees only the seeded sandbox marketplace (lib/sandboxData.ts) — never
// the real, live offers other partners' live keys operate on.
v1Router.get('/marketplace', (req, res) => {
  res.json({ offers: listMarketplace(req.apiKey!.mode === 'test').map(buildOfferView) });
});

// Sacado-facing aceite endpoints — a sacado's ERP can list pending aceites and
// confirm/contest them programmatically, mirroring /api/aceites for the SPA. A
// test-mode key only ever sees/acts on its own seeded sandbox aceites (lib/sandboxData.ts).
v1Router.get('/aceites', (req, res) => {
  res.json({ aceites: listAceitesForUser(req.apiUser!, req.apiKey!.mode === 'test') });
});

v1Router.post(
  '/aceites/:id/status',
  requireWriteScope,
  asyncHandler(async (req, res) => {
    const parsed = aceiteStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const sandbox = req.apiKey!.mode === 'test';
    const outcome = await withIdempotency(req.apiUser!.id, 'POST /v1/aceites/:id/status', idempotencyHeader(req), req.body, () =>
      decideAceite(req.apiUser!, Number(req.params.id), parsed.data.status, sandbox)
    );
    res.status(outcome.status).json(outcome.body);
  })
);

// Seguradora-facing endpoints — a partner insurer's own systems can pull apólices/sinistros
// and decide claims programmatically, mirroring /api/seguradora for the SPA.
v1Router.get('/seguradora', (req, res) => {
  if (req.apiUser!.role !== 'seguradora') {
    res.status(403).json({ error: 'forbidden', message: 'Apenas chaves de contas seguradora podem acessar este recurso.' });
    return;
  }
  res.json(buildSeguradoraPayload(req.apiUser!));
});

v1Router.post(
  '/seguradora/sinistro/:duplicataId/decidir',
  requireWriteScope,
  asyncHandler(async (req, res) => {
    if (req.apiUser!.role !== 'seguradora') {
      res.status(403).json({ error: 'forbidden', message: 'Apenas chaves de contas seguradora podem acessar este recurso.' });
      return;
    }
    const parsed = sinistroDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = await withIdempotency(
      req.apiUser!.id,
      'POST /v1/seguradora/sinistro/:duplicataId/decidir',
      idempotencyHeader(req),
      req.body,
      () => decideSinistro(req.apiUser!, req.params.duplicataId, parsed.data)
    );
    res.status(outcome.status).json(outcome.body);
  })
);

// Real-time credit score lookup by CNPJ — blends Lastro's own transaction history (if
// any) with signals reported by partners (see POST below), so even a CNPJ that never
// transacted directly on Lastro can get a real score from cross-platform reputation.
v1Router.get(
  '/sacados/:cnpj/score',
  asyncHandler(async (req, res) => {
    const view = await buildBlendedRiscoView(req.params.cnpj, req.apiUser!.id);
    if (!view) {
      res.status(404).json({ error: 'not_found', message: 'Nenhum histórico de score encontrado para este CNPJ.' });
      return;
    }
    // Only a standalone Score API key (feature 2) gets charged per call — a full
    // 'platform' key's score access is already covered by its subscription/overage
    // billing (lib/apiOverageBilling.ts), never double-billed.
    if (req.apiKey!.product === 'score_api') {
      await chargePerCall(req.apiUser!.id, 'score_api', `Consulta de score via Score API — CNPJ ${req.params.cnpj}`);
    }
    res.json(view);
  })
);

const sinalSchema = z.object({
  tipo: z.enum(['pagamento_pontual', 'atraso', 'protesto', 'contestacao']),
  nota: z.string().trim().max(500).optional(),
});

// Any partner integrating with the API can report a payment-behavior observation about
// a CNPJ — this is the shared risk-data network: a bank, FIDC or ERP that saw a sacado
// pay late (or on time) contributes that signal back into everyone's score, instead of
// each platform's risk data staying siloed. Read-only keys can't contribute (write scope).
v1Router.post(
  '/sacados/:cnpj/sinais',
  requireWriteScope,
  asyncHandler(async (req, res) => {
    const parsed = sinalSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    addSignal(req.params.cnpj, req.apiUser!.id, parsed.data.tipo, parsed.data.nota);
    const view = await buildBlendedRiscoView(req.params.cnpj, req.apiUser!.id);
    res.json(view);
  })
);

const pldTriagemSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome a ser triado.'),
  documento: z.string().trim().max(40).optional().default(''),
});

// Feature 3 — PLD/KYC screening as a standalone product: wraps the exact same real
// OFAC + UN Security Council Consolidated List + demo-watchlist screening every KYB
// submission already goes through (db/sanctions.ts), sold on its own to a company that
// wants compliance screening without building it — the same reuse-what's-already-real
// pattern as the Score API. A 'platform' key can call this too, bundled at no extra
// charge; only a dedicated pld_screening_api key gets billed per call.
v1Router.post(
  '/pld/triagem',
  asyncHandler(async (req, res) => {
    const parsed = pldTriagemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const match = await screenEntity(parsed.data.nome, parsed.data.documento, req.apiUser!.id);
    if (req.apiKey!.product === 'pld_screening_api') {
      await chargePerCall(req.apiUser!.id, 'pld_screening_api', `Triagem PLD via API — ${parsed.data.nome}`);
    }
    res.json({
      nome: parsed.data.nome,
      flagged: !!match,
      match: match ? { nome: match.nome, tipo: match.tipo, fonte: match.fonte } : null,
    });
  })
);
