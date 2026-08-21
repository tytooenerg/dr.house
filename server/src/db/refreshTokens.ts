import { db } from './index.js';

const REFRESH_TTL_DAYS = 30;

export function createRefreshToken(userId: number, tokenHash: string) {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)').run(userId, tokenHash, expiresAt);
}

export function findValidRefreshToken(tokenHash: string): { id: number; user_id: number } | undefined {
  return db
    .prepare(`SELECT id, user_id FROM refresh_tokens WHERE token_hash = ? AND revoked = 0 AND expires_at > datetime('now')`)
    .get(tokenHash) as { id: number; user_id: number } | undefined;
}

export function revokeRefreshToken(tokenHash: string) {
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ?').run(tokenHash);
}

export function revokeAllRefreshTokensForUser(userId: number) {
  db.prepare('UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?').run(userId);
}
