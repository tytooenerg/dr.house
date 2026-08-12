import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { recordAuditEvent } from '../db/audit.js';
import { addPayable, buildPayablesOverview, cancel, createPayableSchema, markPaid, remove } from '../lib/payablesCore.js';

export const payablesRouter = Router();
payablesRouter.use(requireAuth, requireRole('cedente'));

payablesRouter.get('/', (req, res) => {
  res.json(buildPayablesOverview(req.user!.id));
});

payablesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = createPayableSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const view = addPayable(req.user!.id, parsed.data);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'payable.create', { id: view.id, valor: view.valor, vencimento: view.vencimento });
    res.status(201).json(view);
  })
);

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

payablesRouter.post(
  '/:id/pagar',
  asyncHandler(async (req, res) => {
    const parsedId = idParamSchema.safeParse(req.params);
    if (!parsedId.success) {
      res.status(400).json({ error: 'validation_error' });
      return;
    }
    const outcome = markPaid(parsedId.data.id, req.user!.id);
    if (outcome.status === 200) recordAuditEvent(req.user!.id, req.user!.company_name, 'payable.pay', { id: parsedId.data.id });
    res.status(outcome.status).json(outcome.body);
  })
);

payablesRouter.post(
  '/:id/cancelar',
  asyncHandler(async (req, res) => {
    const parsedId = idParamSchema.safeParse(req.params);
    if (!parsedId.success) {
      res.status(400).json({ error: 'validation_error' });
      return;
    }
    const outcome = cancel(parsedId.data.id, req.user!.id);
    if (outcome.status === 200) recordAuditEvent(req.user!.id, req.user!.company_name, 'payable.cancel', { id: parsedId.data.id });
    res.status(outcome.status).json(outcome.body);
  })
);

payablesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const parsedId = idParamSchema.safeParse(req.params);
    if (!parsedId.success) {
      res.status(400).json({ error: 'validation_error' });
      return;
    }
    const outcome = remove(parsedId.data.id, req.user!.id);
    if (outcome.status === 200) recordAuditEvent(req.user!.id, req.user!.company_name, 'payable.delete', { id: parsedId.data.id });
    res.status(outcome.status).json(outcome.body);
  })
);
