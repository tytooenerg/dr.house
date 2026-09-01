import { Router } from 'express';
import { requireAuth, requirePlan, requireRole } from '../auth/middleware.js';
import { buildCashflowForecast } from '../lib/cashflowForecast.js';
import { getSettings } from '../db/users.js';
import { asyncHandler } from '../lib/asyncHandler.js';

export const cashflowRouter = Router();
// Feature "AI CFO fica atrás de Pro/Empresarial" — até aqui era o único recurso de peso
// liberado de graça no plano Básico. Pro e Empresarial ganham a projeção real de caixa;
// só o Empresarial ganha o DRE simplificado/saldo bancário real/benchmark, gated dentro de
// buildCashflowForecast (por req.user!.plan), não aqui — a rota em si só decide "tem CFO
// ou não tem".
cashflowRouter.use(requireAuth, requireRole('cedente'), requirePlan('pro'));

cashflowRouter.get(
  '/forecast',
  asyncHandler(async (req, res) => {
    const settings = getSettings(req.user!);
    const forecast = await buildCashflowForecast(req.user!.id, req.user!.plan, settings.companyCnpj);
    res.json(forecast);
  })
);
