-- Reconciliation — flags raised when a confirmed payment-rail event (Pix charge concluded,
-- boleto paid, TED deposit received) has no matching ledger entry for the same user/valor
-- around the same time. Catches the real ops failure mode of "money rail confirmed it, the
-- ledger never recorded it" — see lib/reconciliation.ts for the matching logic.
CREATE TABLE IF NOT EXISTS reconciliation_flags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK(tipo IN ('pix', 'boleto', 'ted')),
  referencia TEXT NOT NULL, -- txid | nosso_numero | ted referencia
  user_id INTEGER NOT NULL REFERENCES users(id),
  valor REAL NOT NULL,
  descricao TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK(status IN ('aberta', 'resolvida')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by_admin_id INTEGER REFERENCES users(id),
  UNIQUE(tipo, referencia)
);

CREATE INDEX IF NOT EXISTS idx_reconciliation_flags_status ON reconciliation_flags(status);
