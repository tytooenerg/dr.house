import { Router } from 'express';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { buildAuditorOverview } from '../lib/auditorOverview.js';

// The 'auditor' role's entire surface: one read-only endpoint, no write routes at all —
// deliberately narrower than admin's own /admin/audit, /admin/pld/suspeitas etc., which
// stay admin-only. An admin can also reach this same data (requireRole allows both), since
// an admin should never see *less* than an auditor.
export const auditorRouter = Router();
auditorRouter.use(requireAuth, requireRole('admin', 'auditor'));

auditorRouter.get('/overview', (_req, res) => {
  res.json(buildAuditorOverview());
});
