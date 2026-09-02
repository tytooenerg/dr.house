import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { recordAuditEvent } from '../db/audit.js';
import { buildFundoOverview, contribuirParaFundo, resgatarDoFundo } from '../lib/confirmingFundo.js';

export const confirmingFundoRouter = Router();
confirmingFundoRouter.use(requireAuth);

confirmingFundoRouter.get('/', (req, res) => {
  res.json(buildFundoOverview(req.user!.role === 'investidor' ? req.user!.id : null));
});

const amountSchema = z.object({ valor: z.number().positive() });

confirmingFundoRouter.post(
  '/contribuir',
  requireRole('investidor'),
  asyncHandler(async (req, res) => {
    const parsed = amountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    contribuirParaFundo(req.user!.id, parsed.data.valor);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'confirming_fundo.aporte', { valor: parsed.data.valor });
    res.json(buildFundoOverview(req.user!.id));
  })
);

confirmingFundoRouter.post(
  '/resgatar',
  requireRole('investidor'),
  asyncHandler(async (req, res) => {
    const parsed = amountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = resgatarDoFundo(req.user!.id, parsed.data.valor);
    if (outcome.status === 200) {
      recordAuditEvent(req.user!.id, req.user!.company_name, 'confirming_fundo.resgate', { valor: parsed.data.valor });
    }
    res.status(outcome.status).json(outcome.body);
  })
);
