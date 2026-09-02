-- Widens addon_charges' CHECK to accept 'publicidade_carrossel' — a flat monthly recurring
-- fee (lib/addOnBilling.ts) for a slot no carrossel de publicidade da landing page, mesmo
-- formato de whitelabel_plus/institutional_reporting (cobrado por
-- lib/advertisementBilling.ts's runAdvertisementBilling, mesmo padrão de
-- lib/whitelabelBilling.ts). Same table-recreation pattern as
-- 0045/0049/0050/0053 — colunas copiadas verbatim do schema real (sqlite_master).
CREATE TABLE addon_charges_new_0059 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('api_overage', 'score_api', 'pld_screening_api', 'registro_api', 'whitelabel_plus', 'institutional_reporting', 'judicial_records_api', 'fraud_screening_api', 'document_intelligence_api', 'reconciliation_api', 'suitability_api', 'market_index_api', 'publicidade_carrossel')),
  period TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL,
  amount REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, kind, period)
);

INSERT INTO addon_charges_new_0059 (id, user_id, kind, period, quantity, unit_price, amount, description, created_at)
SELECT id, user_id, kind, period, quantity, unit_price, amount, description, created_at
FROM addon_charges;

DROP TABLE addon_charges;
ALTER TABLE addon_charges_new_0059 RENAME TO addon_charges;
CREATE INDEX IF NOT EXISTS idx_addon_charges_user ON addon_charges(user_id);
CREATE INDEX IF NOT EXISTS idx_addon_charges_kind ON addon_charges(kind);
