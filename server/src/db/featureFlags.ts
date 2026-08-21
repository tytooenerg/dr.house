import { db } from './index.js';

export interface FeatureFlagRow {
  key: string;
  enabled: number;
  rollout_pct: number;
  updated_by: number | null;
  updated_at: string;
}

export function getFeatureFlagOverride(key: string): FeatureFlagRow | undefined {
  return db.prepare('SELECT * FROM feature_flags WHERE key = ?').get(key) as FeatureFlagRow | undefined;
}

export function listFeatureFlagOverrides(): FeatureFlagRow[] {
  return db.prepare('SELECT * FROM feature_flags ORDER BY key ASC').all() as FeatureFlagRow[];
}

export function upsertFeatureFlag(key: string, enabled: boolean, rolloutPct: number, updatedBy: number): FeatureFlagRow {
  db.prepare(
    `INSERT INTO feature_flags (key, enabled, rollout_pct, updated_by, updated_at) VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET enabled = excluded.enabled, rollout_pct = excluded.rollout_pct, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
  ).run(key, enabled ? 1 : 0, rolloutPct, updatedBy);
  return getFeatureFlagOverride(key)!;
}
