import crypto from 'node:crypto';
import { db } from './index.js';

export function setTotpSecret(userId: number, secret: string) {
  db.prepare('UPDATE users SET totp_secret = ? WHERE id = ?').run(secret, userId);
}

export function enableTotp(userId: number) {
  db.prepare('UPDATE users SET totp_enabled = 1 WHERE id = ?').run(userId);
}

export function disableTotp(userId: number) {
  db.prepare('UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE id = ?').run(userId);
  db.prepare('DELETE FROM totp_recovery_codes WHERE user_id = ?').run(userId);
}

function hashCode(code: string): string {
  return crypto.createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

export function storeRecoveryCodes(userId: number, codes: string[]) {
  db.prepare('DELETE FROM totp_recovery_codes WHERE user_id = ?').run(userId);
  const insert = db.prepare('INSERT INTO totp_recovery_codes (user_id, code_hash) VALUES (?, ?)');
  for (const code of codes) insert.run(userId, hashCode(code));
}

// One-time use: the matched row is stamped used_at in the same lookup, so the same
// recovery code can never be replayed even if intercepted after use.
export function consumeRecoveryCode(userId: number, code: string): boolean {
  const hash = hashCode(code);
  const row = db.prepare('SELECT id FROM totp_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL').get(userId, hash) as
    | { id: number }
    | undefined;
  if (!row) return false;
  db.prepare("UPDATE totp_recovery_codes SET used_at = datetime('now') WHERE id = ?").run(row.id);
  return true;
}

export function countRemainingRecoveryCodes(userId: number): number {
  const row = db.prepare('SELECT COUNT(*) as n FROM totp_recovery_codes WHERE user_id = ? AND used_at IS NULL').get(userId) as { n: number };
  return row.n;
}
