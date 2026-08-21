-- Investor suitability assessment (CVM-style profile: conservador/moderado/arrojado).
-- One row per user — a resubmission overwrites the previous assessment, same "current
-- state, not history" shape as db/twoFactor.ts's totp_secrets. answers_json keeps the raw
-- responses for audit purposes even though only score/profile drive any real gate.
CREATE TABLE IF NOT EXISTS suitability_assessments (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  score INTEGER NOT NULL,
  profile TEXT NOT NULL CHECK(profile IN ('conservador', 'moderado', 'arrojado')),
  answers_json TEXT NOT NULL,
  completed_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
