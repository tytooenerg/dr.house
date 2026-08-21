-- Admin-manageable feature flags. Every flag has a code-defined default (see
-- lib/featureFlags.ts's FEATURE_FLAG_DEFS) so the app behaves sensibly even before an
-- admin ever touches this table — a row here is only an *override* of that default.
-- rollout_pct supports a gradual rollout: at < 100 a user is deterministically bucketed
-- (hash of flag key + user id) so the same user always lands on the same side, instead of
-- flipping randomly on every request.
CREATE TABLE IF NOT EXISTS feature_flags (
  key TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  rollout_pct INTEGER NOT NULL DEFAULT 100,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT now()
);
