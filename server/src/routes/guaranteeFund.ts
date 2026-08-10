import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { recordAuditEvent } from '../db/audit.js';
import { buildFundOverview, fileFundClaim, fundClaimSchema, listEligiblePositionsForFundClaim } from '../lib/guaranteeFund.js';

export const guaranteeFundRouter = Router();
guaranteeFundRouter.use(requireAuth);

guaranteeFundRouter.get('/', (_req, res) => {
  res.json(buildFundOverview());
});

guaranteeFundRouter.get('/eligible', requireRole('investidor'), (req, res) => {
  res.json({ eligible: listEligiblePositionsForFundClaim(req.user!.id) });
});

guaranteeFundRouter.post(
  '/claims',
  requireRole('investidor'),
  asyncHandler(async (req, res) => {
    const parsed = fundClaimSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = fileFundClaim(req.user!, parsed.data.duplicataId);
    if (outcome.status === 200) {
      recordAuditEvent(req.user!.id, req.user!.company_name, 'guarantee_fund.claim_aberto', { duplicataId: parsed.data.duplicataId, claimId: outcome.body.claimId });
    }
    res.status(outcome.status).json(outcome.body);
  })
);
