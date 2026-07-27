import { db } from './index.js';
import type { SystemHealthCheckRow } from './types.js';

export function recordHealthCheck(status: 'ok' | 'degraded', latencyMs: number) {
  db.prepare('INSERT INTO system_health_checks (status, latency_ms) VALUES (?, ?)').run(status, latencyMs);
}

export function listRecentHealthChecks(limit = 100): SystemHealthCheckRow[] {
  return db.prepare('SELECT * FROM system_health_checks ORDER BY id DESC LIMIT ?').all(limit) as SystemHealthCheckRow[];
}

export function computeUptimePct(sinceHours: number): number | null {
  const row = db
    .prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) as ok
       FROM system_health_checks WHERE created_at >= datetime('now', ?)`
    )
    .get(`-${sinceHours} hours`) as { total: number; ok: number | null };
  if (row.total === 0) return null;
  return +(((row.ok ?? 0) / row.total) * 100).toFixed(2);
}
