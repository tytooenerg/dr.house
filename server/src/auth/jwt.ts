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
    return jwt.verify(token, SECRET) as unknown as TokenPayload;
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
