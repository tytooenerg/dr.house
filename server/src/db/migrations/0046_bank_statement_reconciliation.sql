-- Widens reconciliation_flags.tipo to cover flags raised from a real uploaded bank
-- statement (lib/bankStatementReconciliation.ts), not just the internal Pix/boleto/TED
-- rail tables. SQLite can't ALTER a CHECK constraint, so this recreates the table — the
-- same pattern 0045_auditor_role.sql just used for users.role.
CREATE TABLE reconciliation_flags_new_0046 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK(tipo IN ('pix', 'boleto', 'ted', 'extrato_bancario')),
  referencia TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  valor REAL NOT NULL,
  descricao TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'aberta' CHECK(status IN ('aberta', 'resolvida')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  resolved_by_admin_id INTEGER REFERENCES users(id),
  UNIQUE(tipo, referencia)
);

INSERT INTO reconciliation_flags_new_0046 (id, tipo, referencia, user_id, valor, descricao, status, created_at, resolved_at, resolved_by_admin_id)
SELECT id, tipo, referencia, user_id, valor, descricao, status, created_at, resolved_at, resolved_by_admin_id FROM reconciliation_flags;

DROP TABLE reconciliation_flags;
ALTER TABLE reconciliation_flags_new_0046 RENAME TO reconciliation_flags;

CREATE INDEX IF NOT EXISTS idx_reconciliation_flags_status ON reconciliation_flags(status);
