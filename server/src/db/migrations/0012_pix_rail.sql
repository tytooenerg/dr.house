-- Real Pix payment rail (server/src/lib/paymentRail.ts), replacing the hardcoded fake
-- "Banco Itaú Unibanco · Ag 1234 · CC 00045-6" bank account string and the boolean-only
-- "conectar conta" toggle Conta & Liquidação showed before. Implements the real BACEN
-- API Pix contract (POST/PUT /cob, GET /cob, webhook "pix recebido") so a licensed PSP's
-- credentials (PIX_PSP_* env vars) light this up for real; without them, deposits/saques
-- run in a clearly-labeled simulated mode (same pattern STRIPE_SECRET_KEY already uses).

CREATE TABLE IF NOT EXISTS pix_charges (
  txid TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  valor REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'ativa' CHECK(status IN ('ativa','concluida','expirada')),
  simulado INTEGER NOT NULL DEFAULT 1,
  end_to_end_id TEXT,
  brcode TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  concluded_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pix_charges_user ON pix_charges(user_id);

CREATE TABLE IF NOT EXISTS pix_payouts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  valor REAL NOT NULL,
  chave_destino TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'concluido' CHECK(status IN ('concluido','falhou')),
  simulado INTEGER NOT NULL DEFAULT 1,
  end_to_end_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pix_payouts_user ON pix_payouts(user_id);
