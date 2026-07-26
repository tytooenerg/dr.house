import { db } from './index.js';
import type { ApiKeyMode, ApiKeyRow, ApiKeyScope } from './types.js';

export function createApiKey(userId: number, keyHash: string, keyPrefix: string, label: string, mode: ApiKeyMode = 'live', scope: ApiKeyScope = 'read_write'): ApiKeyRow {
  const info = db
    .prepare('INSERT INTO api_keys (user_id, key_hash, key_prefix, label, mode, scope) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, keyHash, keyPrefix, label, mode, scope);
  return db.prepare('SELECT * FROM api_keys WHERE id = ?').get(Number(info.lastInsertRowid)) as ApiKeyRow;
}

export function findActiveKeyByHash(keyHash: string): ApiKeyRow | undefined {
  return db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0').get(keyHash) as ApiKeyRow | undefined;
}

export function listApiKeys(userId: number): ApiKeyRow[] {
  return db.prepare('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC').all(userId) as ApiKeyRow[];
}

export function revokeApiKey(userId: number, keyId: number) {
  db.prepare('UPDATE api_keys SET revoked = 1 WHERE id = ? AND user_id = ?').run(keyId, userId);
}

export function revokeAllApiKeysForUser(userId: number) {
  db.prepare('UPDATE api_keys SET revoked = 1 WHERE user_id = ?').run(userId);
}

export function touchApiKey(id: number) {
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(id);
}

function currentMonthKey(): string {
  return new Date().toISOString().slice(0, 7); // 'YYYY-MM'
}

export function incrementApiKeyUsage(apiKeyId: number) {
  const monthKey = currentMonthKey();
  db.prepare(
    `INSERT INTO api_key_usage (api_key_id, month_key, calls) VALUES (?, ?, 1)
     ON CONFLICT(api_key_id, month_key) DO UPDATE SET calls = calls + 1`
  ).run(apiKeyId, monthKey);
}

export function getApiKeyUsageThisMonth(apiKeyId: number): number {
  const row = db.prepare('SELECT calls FROM api_key_usage WHERE api_key_id = ? AND month_key = ?').get(apiKeyId, currentMonthKey()) as
    | { calls: number }
    | undefined;
  return row?.calls ?? 0;
}
