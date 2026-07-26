import { db } from './index.js';
import type { ApiKeyRow } from './types.js';

export function createApiKey(userId: number, keyHash: string, keyPrefix: string, label: string): ApiKeyRow {
  const info = db
    .prepare('INSERT INTO api_keys (user_id, key_hash, key_prefix, label) VALUES (?, ?, ?, ?)')
    .run(userId, keyHash, keyPrefix, label);
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

export function touchApiKey(id: number) {
  db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(id);
}
