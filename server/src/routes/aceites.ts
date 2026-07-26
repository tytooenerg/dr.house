import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { aceiteStatusSchema, decideAceite, listAceitesForUser } from '../lib/aceiteCore.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const aceiteRouter = Router();
aceiteRouter.use(requireAuth);

aceiteRouter.get('/', (req, res) => {
  res.json({ aceites: listAceitesForUser(req.user!) });
});

aceiteRouter.post(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const parsed = aceiteStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = await decideAceite(req.user!, Number(req.params.id), parsed.data.status);
    res.status(outcome.status).json(outcome.body);
  })
);
