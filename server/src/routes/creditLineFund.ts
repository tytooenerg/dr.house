import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { recordAuditEvent } from '../db/audit.js';
import { buildFundOverview, contributeToFund, redeemFromFund } from '../lib/creditLineFund.js';

export const creditLineFundRouter = Router();
creditLineFundRouter.use(requireAuth);

creditLineFundRouter.get('/', (req, res) => {
  res.json(buildFundOverview(req.user!.role === 'investidor' ? req.user!.id : null));
});

const amountSchema = z.object({ valor: z.number().positive() });

creditLineFundRouter.post(
  '/contribuir',
  requireRole('investidor'),
  asyncHandler(async (req, res) => {
    const parsed = amountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    contributeToFund(req.user!.id, parsed.data.valor);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'credit_line_fund.aporte', { valor: parsed.data.valor });
    res.json(buildFundOverview(req.user!.id));
  })
);

creditLineFundRouter.post(
  '/resgatar',
  requireRole('investidor'),
  asyncHandler(async (req, res) => {
    const parsed = amountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = redeemFromFund(req.user!.id, parsed.data.valor);
    if (outcome.status === 200) {
      recordAuditEvent(req.user!.id, req.user!.company_name, 'credit_line_fund.resgate', { valor: parsed.data.valor });
    }
    res.status(outcome.status).json(outcome.body);
  })
);
