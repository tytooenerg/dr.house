import { Router } from 'express';
import { apiKeyRateLimiter, requireApiKey } from '../auth/apiKey.js';
import { emitirFormSchema, submitEmitir } from '../lib/emitirCore.js';
import { aceiteStatusSchema, decideAceite, listAceitesForUser } from '../lib/aceiteCore.js';
import { buildSeguradoraPayload, decideSinistro, sinistroDecisionSchema } from '../lib/seguradoraCore.js';
import { buildRiscoView, findSacadoByCnpj } from '../lib/riscoCore.js';
import { getDuplicata, listMarketplace } from '../db/duplicatas.js';
import { buildOfferView } from '../lib/marketCompute.js';
import { fmtBRL } from '../lib/format.js';
import { asyncHandler } from '../lib/asyncHandler.js';

// Public, versioned, API-key-authenticated endpoints for external partners (ERPs, FIDCs,
// securitizadoras, sacados, seguradoras…) to integrate with directly — distinct from the
// internal /api/* used by the SPA, which is cookie/JWT-authenticated and not meant for
// third parties.
export const v1Router = Router();
v1Router.use(apiKeyRateLimiter, requireApiKey);

v1Router.post(
  '/duplicatas',
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
    const outcome = await submitEmitir(req.apiUser!, parsed.data);
    res.status(outcome.status).json(outcome.body);
  })
);

v1Router.get('/duplicatas/:id', (req, res) => {
  const d = getDuplicata(req.params.id);
  if (!d) {
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
    lastroPct: d.lastro_pct,
    seguro: !!d.seguro,
  });
});

v1Router.get('/marketplace', (_req, res) => {
  res.json({ offers: listMarketplace().map(buildOfferView) });
});

// Sacado-facing aceite endpoints — a sacado's ERP can list pending aceites and
// confirm/contest them programmatically, mirroring /api/aceites for the SPA.
v1Router.get('/aceites', (req, res) => {
  res.json({ aceites: listAceitesForUser(req.apiUser!) });
});

v1Router.post(
  '/aceites/:id/status',
  asyncHandler(async (req, res) => {
    const parsed = aceiteStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = await decideAceite(req.apiUser!, Number(req.params.id), parsed.data.status);
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
    const outcome = decideSinistro(req.apiUser!, req.params.duplicataId, parsed.data);
    res.status(outcome.status).json(outcome.body);
  })
);

// Real-time credit score lookup by CNPJ — used by partners (FIDCs, securitizadoras,
// bancos) to decide whether to buy a receivable before it's even listed on the marketplace.
v1Router.get('/sacados/:cnpj/score', (req, res) => {
  const found = findSacadoByCnpj(req.params.cnpj);
  if (!found) {
    res.status(404).json({ error: 'not_found', message: 'Nenhum histórico de score encontrado para este CNPJ.' });
    return;
  }
  res.json(buildRiscoView(found.name, found.sacado));
});
