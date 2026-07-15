import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';
import { getSettings, updateSettings } from '../db/users.js';
import { AUDIT_LOG, CRONOGRAMA, CONTRACT_FLAGS, FINANCIADOR_REQS, FRAUD_FLAGS, TRUST_BRIDGE } from '../data/seed.js';
import { fmtBRL, parseBRLNumber } from '../lib/format.js';

export const complianceRouter = Router();
complianceRouter.use(requireAuth);

function fidcPayload(pl: string) {
  const num = parseBRLNumber(pl);
  return { fidcPL: pl, fidcOriginacaoFmt: fmtBRL(num * 2.2), fidcSpreadLabel: '1,8% a.m.' };
}

complianceRouter.get('/', (req, res) => {
  const settings = getSettings(req.user!);
  res.json({
    trustBridge: TRUST_BRIDGE,
    financiadorReqs: FINANCIADOR_REQS,
    cronograma: CRONOGRAMA,
    auditLog: AUDIT_LOG,
    fraudFlags: FRAUD_FLAGS,
    contractFlags: CONTRACT_FLAGS,
    interop: [
      { name: 'CERC', lastCheck: 40 },
      { name: 'B3', lastCheck: 12 },
      { name: 'Núclea', lastCheck: 3 },
    ],
    ...fidcPayload(settings.fidcPL),
  });
});

const fidcSchema = z.object({ value: z.string().trim() });

complianceRouter.post('/fidc', (req, res) => {
  const parsed = fidcSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  updateSettings(req.user!.id, { fidcPL: parsed.data.value });
  res.json(fidcPayload(parsed.data.value));
});

complianceRouter.post('/dup-check', (req, res) => {
  const query = typeof req.body.query === 'string' ? req.body.query : '';
  res.json({ dupQuery: query, dupChecked: true });
});
