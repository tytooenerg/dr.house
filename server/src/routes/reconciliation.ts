import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { recordAuditEvent } from '../db/audit.js';
import { listAllFlags, resolveFlag, runReconciliation } from '../lib/reconciliation.js';
import { reconcileBankStatement } from '../lib/bankStatementReconciliation.js';
import { OfxParseError } from '../lib/ofxParser.js';
import { getUserByEmail } from '../db/users.js';

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

// Real bank-statement reconciliation (lib/bankStatementReconciliation.ts) — an admin
// uploads an actual OFX export for one account and every transaction in it gets checked
// against that account's real ledger. The client reads the file as text and posts it here
// (same "no raw upload, just parsed/text content" discipline as the CSV lote imports).
const extratoSchema = z.object({ email: z.string().trim().email(), ofxText: z.string().min(1) });

reconciliationRouter.post(
  '/extrato',
  asyncHandler(async (req, res) => {
    const parsed = extratoSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const user = getUserByEmail(parsed.data.email);
    if (!user) {
      res.status(404).json({ error: 'not_found', message: 'Nenhuma conta encontrada com esse e-mail.' });
      return;
    }
    try {
      const result = reconcileBankStatement(user.id, parsed.data.ofxText);
      recordAuditEvent(req.user!.id, req.user!.company_name, 'reconciliation.extrato', { targetUserId: user.id, ...result });
      res.json(result);
    } catch (err) {
      if (err instanceof OfxParseError) {
        res.status(400).json({ error: 'ofx_parse_error', message: err.message });
        return;
      }
      throw err;
    }
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
