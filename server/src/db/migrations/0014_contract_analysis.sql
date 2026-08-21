-- Real contract clause analysis (replaces the static CONTRACT_FLAGS demo copy on the
-- Compliance screen's "Leitura de contratos" card — see lib/contractAnalysis.ts). Stores
-- one row per analyzed contrato de cessão upload so the most recent real analysis can be
-- shown instead of always the same fictitious sample text.
CREATE TABLE IF NOT EXISTS contract_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  upload_id INTEGER REFERENCES uploads(id),
  filename TEXT NOT NULL,
  flags_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_contract_analyses_user ON contract_analyses(user_id, created_at DESC);
