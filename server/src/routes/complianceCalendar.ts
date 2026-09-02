import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { recordAuditEvent } from '../db/audit.js';
import { updateSettings } from '../db/users.js';
import { buildComplianceCalendarView, classifyCompliance } from '../lib/complianceCalendarCore.js';

export const complianceCalendarRouter = Router();
complianceCalendarRouter.use(requireAuth, requireRole('cedente', 'sacado'));

complianceCalendarRouter.get('/', (req, res) => {
  res.json(buildComplianceCalendarView(req.user!));
});

const faturamentoSchema = z.object({
  bracket: z.enum(['acima_300m', 'entre_90m_300m', 'entre_4_8m_90m', 'ate_4_8m']),
});

complianceCalendarRouter.post('/faturamento', (req, res) => {
  const parsed = faturamentoSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
    return;
  }
  const updated = updateSettings(req.user!.id, { faturamentoAnualBracket: parsed.data.bracket });
  recordAuditEvent(req.user!.id, req.user!.company_name, 'compliance_calendario.faturamento_informado', { bracket: parsed.data.bracket });
  res.json(classifyCompliance(updated.faturamentoAnualBracket));
});
