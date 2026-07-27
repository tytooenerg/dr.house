import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { listReferrals } from '../db/users.js';

export const referralRouter = Router();
referralRouter.use(requireAuth);

referralRouter.get('/', (req, res) => {
  const user = req.user!;
  res.json({
    code: user.referral_code,
    link: `/?ref=${user.referral_code}`,
    bonusEmissoesMensais: user.referral_bonus_emissions,
    indicados: listReferrals(user.id),
  });
});
