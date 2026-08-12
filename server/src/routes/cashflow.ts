import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { buildCashflowForecast } from '../lib/cashflowForecast.js';

export const cashflowRouter = Router();
cashflowRouter.use(requireAuth, requireRole('cedente'));

cashflowRouter.get('/forecast', (req, res) => {
  res.json(buildCashflowForecast(req.user!.id));
});
