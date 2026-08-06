-- Generic key/value store for platform-wide settings an admin can tune at runtime,
-- starting with the Compliance AI Engine's suspend threshold (previously a hardcoded
-- constant — see lib/complianceEngine.ts). Deliberately not per-user: these are
-- operator-level controls, gated by requireRole('admin') on every route that writes here.
CREATE TABLE IF NOT EXISTS platform_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by INTEGER REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
