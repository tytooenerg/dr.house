-- Shared add-on revenue engine (lib/addOnBilling.ts) — real ledger charges for the 5 new
-- monetization products: API usage overage, the standalone Score API, the standalone PLD
-- screening API, the White-label Plus recurring fee, and Institutional Reporting. Same
-- "real accounting, simulated money movement" scope as the platform fee/insurance
-- commission/legal collection fee already in the codebase — every charge here is a real
-- ledger debit and a real logged row, never a fabricated number.
CREATE TABLE IF NOT EXISTS addon_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(kind IN ('api_overage', 'score_api', 'pld_screening_api', 'whitelabel_plus', 'institutional_reporting')),
  -- Set only for recurring monthly kinds (api_overage, whitelabel_plus,
  -- institutional_reporting) as 'YYYY-MM', enforcing at most one charge per user per kind
  -- per month via the UNIQUE constraint below. Per-call kinds (score_api,
  -- pld_screening_api) leave this NULL — SQLite treats each NULL as distinct, so every
  -- call gets its own row without conflicting.
  period TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL,
  amount REAL NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, kind, period)
);
CREATE INDEX IF NOT EXISTS idx_addon_charges_user ON addon_charges(user_id);
CREATE INDEX IF NOT EXISTS idx_addon_charges_kind ON addon_charges(kind);

-- A partner API key scoped to a single standalone data product (Score API / PLD
-- screening API) instead of the full platform — sellable to a company that isn't a
-- Lastro cedente/investidor/sacado at all, just wants the data. 'platform' (the default,
-- covering every existing key) keeps today's behavior exactly as-is.
ALTER TABLE api_keys ADD COLUMN product TEXT NOT NULL DEFAULT 'platform';

-- White-label Plus (lib/whitelabelBilling.ts) and Institutional Reporting
-- (lib/institutionalReporting.ts) are opt-in recurring add-ons, tracked per user
-- alongside the existing plan (Básico/Pro/Empresarial) rather than as new plan tiers —
-- a cedente/investidor can be Empresarial AND subscribe to either independently.
ALTER TABLE users ADD COLUMN whitelabel_plus_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN institutional_reporting_enabled INTEGER NOT NULL DEFAULT 0;
