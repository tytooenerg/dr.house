-- Secondary market: track which purchase is the current active owner of a duplicata,
-- and the resale listings investors create to sell a position before vencimento.
ALTER TABLE purchases ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS resale_listings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  duplicata_id TEXT NOT NULL REFERENCES duplicatas(id),
  seller_id INTEGER NOT NULL REFERENCES users(id),
  asking_valor REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','vendido','cancelado')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_resale_listings_status ON resale_listings(status);

-- Referral program
ALTER TABLE users ADD COLUMN referral_code TEXT;
ALTER TABLE users ADD COLUMN referred_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE users ADD COLUMN referral_bonus_emissions INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_referral_code ON users(referral_code);

-- Public status page: a real periodic self-check, logged so /status has actual history.
CREATE TABLE IF NOT EXISTS system_health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK(status IN ('ok','degraded')),
  latency_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
