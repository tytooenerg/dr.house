import { Router } from 'express';
import { apiKeyRateLimiter, requireApiKey } from '../auth/apiKey.js';
import { emitirFormSchema, submitEmitir } from '../lib/emitirCore.js';
import { getDuplicata, listMarketplace } from '../db/duplicatas.js';
import { buildOfferView } from '../lib/marketCompute.js';
import { fmtBRL } from '../lib/format.js';
import { asyncHandler } from '../lib/asyncHandler.js';

// Public, versioned, API-key-authenticated endpoints for external partners (ERPs, FIDCs,
// securitizadoras…) to integrate with directly — distinct from the internal /api/* used
// by the SPA, which is cookie/JWT-authenticated and not meant for third parties.
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
