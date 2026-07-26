import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { findActiveKeyByHash, touchApiKey } from '../db/apiKeys.js';
import { getUserById } from '../db/users.js';
import type { UserRow } from '../db/types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiUser?: UserRow;
    }
  }
}

export function generateApiKey(): { rawKey: string; keyHash: string; keyPrefix: string } {
  const rawKey = `lastro_live_${crypto.randomBytes(24).toString('hex')}`;
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 20);
  return { rawKey, keyHash, keyPrefix };
}

export function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const rawKey = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!rawKey) {
    res.status(401).json({ error: 'unauthorized', message: 'Informe sua chave de API no header Authorization: Bearer <chave>.' });
    return;
  }
  const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const record = findActiveKeyByHash(keyHash);
  if (!record) {
    res.status(401).json({ error: 'unauthorized', message: 'Chave de API inválida ou revogada.' });
    return;
  }
  const user = getUserById(record.user_id);
  if (!user) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  touchApiKey(record.id);
  req.apiUser = user;
  next();
}

// Rate-limited by the raw key itself (not the caller's IP) — every partner integration
// gets its own budget. Configurable so tests can exercise the 429 path deterministically
// without waiting a real minute or spamming hundreds of requests.
export const apiKeyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: Number(process.env.API_RATE_LIMIT_PER_MIN) || 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const header = req.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice(7) : ipKeyGenerator(req.ip ?? 'anonymous');
  },
  message: { error: 'rate_limited', message: 'Limite de requisições da API excedido. Tente novamente em instantes.' },
});
