import crypto from 'node:crypto';
import { db } from './index.js';

const GENESIS_HASH = '0'.repeat(64);

interface AuditRow {
  id: number;
  prev_hash: string;
  hash: string;
  actor_user_id: number | null;
  actor_label: string;
  action: string;
  payload: string;
  created_at: string;
}

function computeHash(prevHash: string, actorLabel: string, action: string, payload: string, createdAt: string): string {
  return crypto.createHash('sha256').update(`${prevHash}|${actorLabel}|${action}|${payload}|${createdAt}`).digest('hex');
}

export function recordAuditEvent(actorUserId: number | null, actorLabel: string, action: string, payload: Record<string, unknown> = {}) {
  const last = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get() as { hash: string } | undefined;
  const prevHash = last?.hash ?? GENESIS_HASH;
  const createdAt = new Date().toISOString();
  const payloadJson = JSON.stringify(payload);
  const hash = computeHash(prevHash, actorLabel, action, payloadJson, createdAt);
  db.prepare(
    'INSERT INTO audit_log (prev_hash, hash, actor_user_id, actor_label, action, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(prevHash, hash, actorUserId, actorLabel, action, payloadJson, createdAt);
}

export function listAuditLog(limit = 100): AuditRow[] {
  return db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit) as AuditRow[];
}

// Recomputes the chain from the genesis hash and confirms every stored hash still matches —
// a single edited/deleted row breaks the chain from that point forward, proving tamper-evidence.
export function verifyAuditChain(): { valid: boolean; brokenAt: number | null } {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY id ASC').all() as AuditRow[];
  let prevHash = GENESIS_HASH;
  for (const row of rows) {
    if (row.prev_hash !== prevHash) return { valid: false, brokenAt: row.id };
    const expected = computeHash(row.prev_hash, row.actor_label, row.action, row.payload, row.created_at);
    if (expected !== row.hash) return { valid: false, brokenAt: row.id };
    prevHash = row.hash;
  }
  return { valid: true, brokenAt: null };
}
