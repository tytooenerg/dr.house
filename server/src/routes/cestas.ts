import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { CESTAS, investInBasket, investSchema, buildCestaRange } from '../lib/cestasCore.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const cestasRouter = Router();
cestasRouter.use(requireAuth, requireRole('investidor'));

cestasRouter.get('/', (_req, res) => {
  res.json({
    cestas: Object.entries(CESTAS).map(([key, c]) => ({ key, label: c.label, desc: c.desc, ratings: c.ratings, faixa: buildCestaRange([...c.ratings]) })),
  });
});

cestasRouter.post(
  '/investir',
  asyncHandler(async (req, res) => {
    const parsed = investSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = investInBasket(req.user!, parsed.data.cesta, parsed.data.valor);
    res.status(outcome.status).json(outcome.body);
  })
);
