import jwt from 'jsonwebtoken';
import type { Role } from '../db/types.js';

const SECRET = process.env.JWT_SECRET || 'lastro-dev-secret-change-in-production';
if (!process.env.JWT_SECRET) {
  console.warn('[auth] JWT_SECRET not set — using an insecure development default. Set JWT_SECRET in production.');
}

export interface TokenPayload {
  sub: number;
  role: Role;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: '30d' });
}

export function verifyToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, SECRET) as unknown as TokenPayload;
  } catch {
    return null;
  }
}
