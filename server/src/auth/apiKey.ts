import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { findActiveKeyByHash, incrementApiKeyUsage, touchApiKey } from '../db/apiKeys.js';
import { getUserById } from '../db/users.js';
import type { ApiKeyMode, ApiKeyProduct, ApiKeyRow, Plan, UserRow } from '../db/types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      apiUser?: UserRow;
      apiKey?: ApiKeyRow;
    }
  }
}

export function generateApiKey(mode: ApiKeyMode = 'live'): { rawKey: string; keyHash: string; keyPrefix: string } {
  const rawKey = `lastro_${mode}_${crypto.randomBytes(24).toString('hex')}`;
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
  incrementApiKeyUsage(record.id);
  req.apiUser = user;
  req.apiKey = record;
  next();
}

// A read-only key can call every GET in /api/v1 but is blocked from the mutating
// endpoints — lets a partner hand a reporting/BI key to a team that should never be
// able to emit duplicatas or decide a sinistro.
export function requireWriteScope(req: Request, res: Response, next: NextFunction) {
  if (req.apiKey?.scope === 'read_only') {
    res.status(403).json({
      error: 'forbidden',
      message: 'Esta chave tem escopo somente leitura. Gere uma chave com escopo leitura e escrita para esta operação.',
    });
    return;
  }
  next();
}

// Coarse backstop against unauthenticated/garbage-key spam, by IP — runs before
// requireApiKey has had a chance to resolve who's actually calling, so it can't yet know
// a real plan/product to size the limit against. Generous on purpose: this exists only to
// bound the cost of hammering the auth lookup itself, not to be anyone's real budget — the
// real, plan-aware limit is apiKeyRateLimiter below, which runs after authentication.
export const apiKeyAbuseBackstop = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'anonymous'),
  message: { error: 'rate_limited', message: 'Muitas requisições. Tente novamente em instantes.' },
});

// Real per-plan tiers, not one number for every partner. A standalone data-product key
// (Score API / PLD Screening API) is billed per call regardless of the account's
// subscription plan (see lib/addOnBilling.ts) — it gets its own tier, independent of
// `plan`, since it isn't gated behind a subscription to begin with. A sandbox (test-mode)
// key always gets the same modest exploration budget, whatever the account's real plan is,
// since sandbox traffic never touches real data or costs the platform real money either way.
const PLAN_LIMITS_PER_MIN: Record<Plan, number> = { basico: 60, pro: 150, empresarial: 400 };
const PRODUCT_LIMITS_PER_MIN: Partial<Record<ApiKeyProduct, number>> = { score_api: 200, pld_screening_api: 200 };
const TEST_MODE_LIMIT_PER_MIN = 60;

export function computeApiKeyLimitPerMin(apiKey: ApiKeyRow, apiUser: UserRow): number {
  // Explicit operator override always wins — e.g. server/.env.example's documented use
  // for tuning in a real deployment, and how the test suite forces a small, deterministic
  // limit to exercise the 429 path without waiting on (or faking) real tiered traffic.
  const override = Number(process.env.API_RATE_LIMIT_PER_MIN);
  if (Number.isFinite(override) && override > 0) return override;
  if (apiKey.mode === 'test') return TEST_MODE_LIMIT_PER_MIN;
  if (apiKey.product !== 'platform') return PRODUCT_LIMITS_PER_MIN[apiKey.product] ?? TEST_MODE_LIMIT_PER_MIN;
  return PLAN_LIMITS_PER_MIN[apiUser.plan] ?? PLAN_LIMITS_PER_MIN.basico;
}

// Rate-limited by the raw key itself (not the caller's IP) — every partner integration
// gets its own budget, sized to what they actually pay for (computeApiKeyLimitPerMin
// above). Must run after requireApiKey, which is what resolves req.apiKey/req.apiUser in
// the first place.
export const apiKeyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: (req: Request) => (req.apiKey && req.apiUser ? computeApiKeyLimitPerMin(req.apiKey, req.apiUser) : TEST_MODE_LIMIT_PER_MIN),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const header = req.headers.authorization;
    return header?.startsWith('Bearer ') ? header.slice(7) : ipKeyGenerator(req.ip ?? 'anonymous');
  },
  message: { error: 'rate_limited', message: 'Limite de requisições da API excedido para o seu plano. Tente novamente em instantes.' },
});
