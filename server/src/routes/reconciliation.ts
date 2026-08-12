import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { recordAuditEvent } from '../db/audit.js';
import { listAllFlags, resolveFlag, runReconciliation } from '../lib/reconciliation.js';

export const reconciliationRouter = Router();
reconciliationRouter.use(requireAuth, requireRole('admin'));

reconciliationRouter.get('/flags', (_req, res) => {
  res.json({ flags: listAllFlags() });
});

reconciliationRouter.post(
  '/run',
  asyncHandler(async (req, res) => {
    const result = runReconciliation(7);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'reconciliation.run', { ...result });
    res.json(result);
  })
);

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

reconciliationRouter.post(
  '/flags/:id/resolver',
  asyncHandler(async (req, res) => {
    const parsedId = idParamSchema.safeParse(req.params);
    if (!parsedId.success) {
      res.status(400).json({ error: 'validation_error' });
      return;
    }
    const outcome = resolveFlag(parsedId.data.id, req.user!.id);
    if (outcome.status === 200) recordAuditEvent(req.user!.id, req.user!.company_name, 'reconciliation.resolve', { id: parsedId.data.id });
    res.status(outcome.status).json(outcome.body);
  })
);
