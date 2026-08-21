import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from './jwt.js';
import { getUserById } from '../db/users.js';
import { isTeamMembershipRevoked } from '../db/misc.js';
import { planAtLeast, PLANS } from '../lib/billing.js';
import type { Plan, Role, UserRow } from '../db/types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

// A team-member account (users.team_owner_id set — see routes/auth.ts
// POST /team-invite/accept) is meant to view the owner's Dashboard/Minhas
// Duplicatas/Histórico/Receita, never to act on the owner's behalf. Every GET outside
// this allowlist is refused, and every non-GET request is refused unless it's the small
// set of self-service actions (own profile, own notifications, logout, own 2FA) below —
// enforced centrally here since requireAuth is the one chokepoint every protected route
// already goes through.
const TEAM_MEMBER_READ_PREFIXES = [
  '/api/dashboard',
  '/api/minhas',
  '/api/historico',
  '/api/revenue',
  '/api/profile',
  '/api/notifications',
  '/api/auth/me',
  '/api/auth/2fa',
];
const TEAM_MEMBER_WRITE_PATHS = [
  '/api/profile/field',
  '/api/profile/notif-pref',
  '/api/profile/notify-whatsapp-toggle',
  '/api/notifications/read',
  '/api/auth/logout',
  '/api/auth/2fa/setup',
  '/api/auth/2fa/confirm',
  '/api/auth/2fa/disable',
];

function enforceTeamMemberScope(req: Request, res: Response): boolean {
  if (!req.user?.team_owner_id) return true; // not a team-member account — unrestricted
  const fullPath = req.baseUrl + req.path;
  const allowed = req.method === 'GET' ? TEAM_MEMBER_READ_PREFIXES.some((p) => fullPath.startsWith(p)) : TEAM_MEMBER_WRITE_PATHS.includes(fullPath);
  if (!allowed) {
    res.status(403).json({ error: 'forbidden', message: 'Contas de equipe têm acesso somente leitura a Dashboard, Minhas Duplicatas, Histórico e Receita.' });
    return false;
  }
  return true;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: 'unauthorized', message: 'Faça login para continuar.' });
    return;
  }
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'unauthorized', message: 'Sessão expirada — faça login novamente.' });
    return;
  }
  const user = getUserById(payload.sub);
  if (!user) {
    res.status(401).json({ error: 'unauthorized', message: 'Conta não encontrada.' });
    return;
  }
  if (user.team_owner_id && isTeamMembershipRevoked(user.id)) {
    res.status(401).json({ error: 'unauthorized', message: 'Seu acesso de equipe foi revogado.' });
    return;
  }
  req.user = user;
  if (!enforceTeamMemberScope(req, res)) return;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: 'forbidden', message: 'Você não tem permissão para acessar este recurso.' });
      return;
    }
    next();
  };
}

export function requirePlan(minPlan: Plan) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !planAtLeast(req.user.plan, minPlan)) {
      res.status(402).json({
        error: 'plan_required',
        requiredPlan: minPlan,
        message: `Este recurso requer o plano ${PLANS[minPlan].label} ou superior.`,
      });
      return;
    }
    next();
  };
}
