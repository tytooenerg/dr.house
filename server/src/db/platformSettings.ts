import { db } from './index.js';

export function getPlatformSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM platform_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setPlatformSetting(key: string, value: string, updatedBy?: number) {
  db.prepare(
    `INSERT INTO platform_settings (key, value, updated_by, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(key, value, updatedBy ?? null);
}

export function getIntSetting(key: string, fallback: number): number {
  const raw = getPlatformSetting(key);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}
