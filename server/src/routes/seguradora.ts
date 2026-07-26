import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { buildSeguradoraPayload, decideSinistro, sinistroDecisionSchema } from '../lib/seguradoraCore.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const seguradoraRouter = Router();
seguradoraRouter.use(requireAuth, requireRole('seguradora'));

seguradoraRouter.get('/', (req, res) => res.json(buildSeguradoraPayload(req.user!)));

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
