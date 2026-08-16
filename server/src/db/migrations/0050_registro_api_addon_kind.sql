-- Widens addon_charges' CHECK to accept the new 'registro_api' kind (compliance-as-a-
-- service — see lib/registradoras.ts, routes/v1.ts POST /registro). Same table-
-- recreation pattern as 0045_auditor_role.sql/0049_api_partner_role.sql — every column
-- copied verbatim from 0029_addon_revenue.sql's schema (nothing added since).
CREATE TABLE addon_charges_new_0050 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('api_overage', 'score_api', 'pld_screening_api', 'registro_api', 'whitelabel_plus', 'institutional_reporting')),
  period TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL,
  amount REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, kind, period)
);

INSERT INTO addon_charges_new_0050 (id, user_id, kind, period, quantity, unit_price, amount, description, created_at)
SELECT id, user_id, kind, period, quantity, unit_price, amount, description, created_at
FROM addon_charges;

DROP TABLE addon_charges;
ALTER TABLE addon_charges_new_0050 RENAME TO addon_charges;
CREATE INDEX IF NOT EXISTS idx_addon_charges_user ON addon_charges(user_id);
CREATE INDEX IF NOT EXISTS idx_addon_charges_kind ON addon_charges(kind);
