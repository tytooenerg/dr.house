import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import type { Role } from '../db/types.js';
import { logger } from '../lib/logger.js';

const SECRET = process.env.JWT_SECRET || 'lastro-dev-secret-change-in-production';
if (!process.env.JWT_SECRET) {
  logger.warn('[auth] JWT_SECRET not set — using an insecure development default. Set JWT_SECRET in production.');
}

export interface TokenPayload {
  sub: number;
  role: Role;
}

// Short-lived — the client silently exchanges this for a new pair via /auth/refresh
// using the long-lived refresh token, so a stolen access token has a small blast radius.
export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '15m' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, SECRET) as Record<string, unknown>;
    // A 2FA challenge token (see below) is signed with the same secret but carries `typ`
    // and no `role` — reject it here so it can never be used as a real access token
    // (i.e. so knowing only the password, without the TOTP code, is never enough).
    if (decoded.typ) return null;
    return decoded as unknown as TokenPayload;
  } catch {
    return null;
  }
}

const CHALLENGE_TYPE = '2fa_challenge';

// Issued right after a correct email+password when the account has 2FA enabled — proves
// "this request already passed step 1" without granting any actual API access. Exchanged
// for real tokens by POST /auth/2fa/verify-login once the TOTP/recovery code checks out.
export function signChallengeToken(userId: number): string {
  return jwt.sign({ sub: userId, typ: CHALLENGE_TYPE }, SECRET, { expiresIn: '5m' });
}

export function verifyChallengeToken(token: string): number | null {
  try {
    const decoded = jwt.verify(token, SECRET) as Record<string, unknown>;
    if (decoded.typ !== CHALLENGE_TYPE || typeof decoded.sub !== 'number') return null;
    return decoded.sub;
  } catch {
    return null;
  }
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('hex');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
