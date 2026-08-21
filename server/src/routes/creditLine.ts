import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { recordAuditEvent } from '../db/audit.js';
import { buildCreditLineOverview, drawCreditLine, repayCreditLine } from '../lib/creditLine.js';

export const creditLineRouter = Router();
creditLineRouter.use(requireAuth, requireRole('cedente'));

creditLineRouter.get('/', (req, res) => {
  res.json(buildCreditLineOverview(req.user!.id));
});

const amountSchema = z.object({ valor: z.number().positive() });

creditLineRouter.post(
  '/draw',
  asyncHandler(async (req, res) => {
    const parsed = amountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = drawCreditLine(req.user!.id, parsed.data.valor);
    if (outcome.status === 200) {
      recordAuditEvent(req.user!.id, req.user!.company_name, 'credit_line.draw', { valor: parsed.data.valor });
    }
    res.status(outcome.status).json(outcome.body);
  })
);

creditLineRouter.post(
  '/repay',
  asyncHandler(async (req, res) => {
    const parsed = amountSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = repayCreditLine(req.user!.id, parsed.data.valor);
    if (outcome.status === 200) {
      recordAuditEvent(req.user!.id, req.user!.company_name, 'credit_line.repay', { valor: parsed.data.valor });
    }
    res.status(outcome.status).json(outcome.body);
  })
);
