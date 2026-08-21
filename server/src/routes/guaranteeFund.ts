import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { asyncHandler } from '../lib/asyncHandler.js';
import { recordAuditEvent } from '../db/audit.js';
import { buildFundOverview, fileFundClaim, fundClaimSchema, listEligiblePositionsForFundClaim } from '../lib/guaranteeFund.js';
import { buildTrancheOverview, contributeToTranche, redeemFromTranche, trancheContribSchema } from '../lib/guaranteeFundTranches.js';
import { z } from 'zod';

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

// Investável em duas tranches (lib/guaranteeFundTranches.ts) — sênior (protegida, yield
// menor) e júnior (absorve perda primeiro, yield maior). Qualquer investidor autenticado
// pode ver as duas visões; só quem tem posição própria vê `minhaPosicaoFmt` preenchido.
guaranteeFundRouter.get('/tranches', requireRole('investidor'), (req, res) => {
  res.json({
    senior: buildTrancheOverview('senior', req.user!.id),
    junior: buildTrancheOverview('junior', req.user!.id),
  });
});

guaranteeFundRouter.post(
  '/tranches/aportar',
  requireRole('investidor'),
  asyncHandler(async (req, res) => {
    const parsed = trancheContribSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    contributeToTranche(req.user!, parsed.data.classe, parsed.data.valor);
    recordAuditEvent(req.user!.id, req.user!.company_name, 'guarantee_fund.tranche_aporte', { classe: parsed.data.classe, valor: parsed.data.valor });
    res.json({ senior: buildTrancheOverview('senior', req.user!.id), junior: buildTrancheOverview('junior', req.user!.id) });
  })
);

const trancheRedeemSchema = z.object({ classe: z.enum(['senior', 'junior']), valor: z.number().positive() });

guaranteeFundRouter.post(
  '/tranches/resgatar',
  requireRole('investidor'),
  asyncHandler(async (req, res) => {
    const parsed = trancheRedeemSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'validation_error', issues: parsed.error.issues });
      return;
    }
    const outcome = redeemFromTranche(req.user!, parsed.data.classe, parsed.data.valor);
    if (outcome.status !== 200) {
      res.status(outcome.status).json(outcome.body);
      return;
    }
    recordAuditEvent(req.user!.id, req.user!.company_name, 'guarantee_fund.tranche_resgate', { classe: parsed.data.classe, valor: parsed.data.valor });
    res.json({ ...outcome.body, senior: buildTrancheOverview('senior', req.user!.id), junior: buildTrancheOverview('junior', req.user!.id) });
  })
);
