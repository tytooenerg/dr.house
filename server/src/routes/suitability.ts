import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { recordAuditEvent } from '../db/audit.js';
import { SUITABILITY_QUESTIONS, getSuitabilityView, submitSuitability, suitabilitySubmitSchema } from '../lib/suitability.js';

export const suitabilityRouter = Router();
suitabilityRouter.use(requireAuth, requireRole('investidor'));

suitabilityRouter.get('/', (req, res) => {
  res.json({ questions: SUITABILITY_QUESTIONS, current: getSuitabilityView(req.user!.id) });
});

suitabilityRouter.post(
  '/submit',
  asyncHandler(async (req, res) => {
    const parsed = suitabilitySubmitSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = submitSuitability(req.user!.id, parsed.data.answers);
    if (outcome.status === 200) {
      recordAuditEvent(req.user!.id, req.user!.company_name, 'suitability.respondido', { profile: outcome.body.profile, score: outcome.body.score });
    }
    res.status(outcome.status).json(outcome.body);
  })
);
