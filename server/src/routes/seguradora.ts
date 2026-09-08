import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { buildSeguradoraPayload, decideSinistro, sinistroDecisionSchema } from '../lib/seguradoraCore.js';
import { setInsurerLimits } from '../db/insurerLimits.js';
import { recordAuditEvent } from '../db/audit.js';
import { z } from 'zod';
import { triageSinistro } from '../lib/sinistroCopilot.js';
import { getDuplicata } from '../db/duplicatas.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { aiFeatureLimiter } from '../lib/aiRateLimit.js';

export const seguradoraRouter = Router();
seguradoraRouter.use(requireAuth, requireRole('seguradora'));

seguradoraRouter.get('/', (req, res) => res.json(buildSeguradoraPayload(req.user!)));

// Capacidade que a seguradora declara. Quem informa é ela — a Lastro não arbitra o quanto
// de risco uma seguradora comporta, só passa a respeitar o teto depois de informado.
// `null` em qualquer um dos dois remove aquele teto (volta a não haver enforcement ali),
// que é diferente de declarar zero.
const limitesSchema = z.object({
  limiteTotal: z.number().positive().nullable(),
  limitePorSacado: z.number().positive().nullable(),
});

seguradoraRouter.put('/limites', (req, res) => {
  if (!req.user!.insurer_key) {
    res.status(409).json({ error: 'no_insurer', message: 'Esta conta não está vinculada a nenhuma seguradora.' });
    return;
  }
  const parsed = limitesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  setInsurerLimits(req.user!.insurer_key, parsed.data.limiteTotal, parsed.data.limitePorSacado);
  recordAuditEvent(req.user!.id, req.user!.company_name, 'seguradora.capacidade_declarada', {
    insurerKey: req.user!.insurer_key,
    limiteTotal: parsed.data.limiteTotal,
    limitePorSacado: parsed.data.limitePorSacado,
  });
  res.json(buildSeguradoraPayload(req.user!));
});

// Copilot: flags inconsistencies for the seguradora to review before approving/denying —
// never decides automatically. Returns null (not a fabricated assessment) when
// ANTHROPIC_API_KEY isn't set.
seguradoraRouter.get(
  '/sinistro/:duplicataId/ai-triagem',
  aiFeatureLimiter,
  asyncHandler(async (req, res) => {
    const duplicata = getDuplicata(req.params.duplicataId);
    if (!duplicata || duplicata.insurer_key !== req.user!.insurer_key) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const assessment = await triageSinistro(duplicata, req.user!.id);
    res.json({ assessment });
  })
);

seguradoraRouter.post(
  '/sinistro/:duplicataId/decidir',
  asyncHandler(async (req, res) => {
    const parsed = sinistroDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = decideSinistro(req.user!, req.params.duplicataId, parsed.data);
    res.status(outcome.status).json(outcome.body);
  })
);
