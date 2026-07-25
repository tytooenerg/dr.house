import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from './jwt.js';
import { getUserById } from '../db/users.js';
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
  req.user = user;
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
