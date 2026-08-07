import { Router } from 'express';
import { z } from 'zod';
import { apiKeyRateLimiter, requireApiKey, requireWriteScope } from '../auth/apiKey.js';
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

// Public, versioned, API-key-authenticated endpoints for external partners (ERPs, FIDCs,
// securitizadoras, sacados, seguradoras…) to integrate with directly — distinct from the
// internal /api/* used by the SPA, which is cookie/JWT-authenticated and not meant for
// third parties. See GET /api/v1/openapi.json for the full machine-readable reference.
export const v1Router = Router();
v1Router.use(apiKeyRateLimiter, requireApiKey);

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
// confirm/contest them programmatically, mirroring /api/aceites for the SPA.
v1Router.get('/aceites', (req, res) => {
  res.json({ aceites: listAceitesForUser(req.apiUser!) });
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
    const outcome = await withIdempotency(req.apiUser!.id, 'POST /v1/aceites/:id/status', idempotencyHeader(req), req.body, () =>
      decideAceite(req.apiUser!, Number(req.params.id), parsed.data.status)
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
