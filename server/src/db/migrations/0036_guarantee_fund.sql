-- Fundo de garantia / camada de proteção do marketplace — a real pooled reserve funded by
-- a small slice of Lastro's own platform fee revenue (never an extra charge to cedente or
-- investidor), that can be drawn on to cover a default on an *uninsured* duplicata (an
-- insured one already has a real claims path via the seguradora — see lib/seguradoraCore.ts).
CREATE TABLE IF NOT EXISTS guarantee_fund_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL CHECK(tipo IN ('contribuicao', 'sinistro_pago', 'ajuste_admin')),
  valor REAL NOT NULL, -- positive = money into the fund, negative = money out
  descricao TEXT NOT NULL,
  duplicata_id TEXT REFERENCES duplicatas(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guarantee_fund_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duplicata_id TEXT NOT NULL REFERENCES duplicatas(id),
  investor_id INTEGER NOT NULL REFERENCES users(id),
  valor_solicitado REAL NOT NULL,
  valor_pago REAL,
  status TEXT NOT NULL DEFAULT 'aberto' CHECK(status IN ('aberto', 'aprovado', 'negado')),
  note TEXT,
  decided_by INTEGER REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
