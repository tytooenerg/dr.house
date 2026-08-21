-- Linha de crédito rotativa — antecipação de capital de giro contra o histórico real de
-- emissões do próprio cedente na plataforma (não um produto de terceiros, não um mock: o
-- limite é calculado em lib/creditLine.ts a partir do volume real emitido nos últimos 90
-- dias e do score médio real das duplicatas do cedente — sem histórico suficiente, sem
-- limite). Independente do fluxo de compra de duplicata por investidor: o saque aqui é
-- capital da própria Lastro (ou de quem fundear a linha), nunca confundido com uma compra.
CREATE TABLE IF NOT EXISTS credit_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cedente_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  limite REAL NOT NULL,
  utilizado REAL NOT NULL DEFAULT 0, -- saldo devedor total across all open draws, kept in sync
  taxa_am REAL NOT NULL, -- monthly interest rate (%), set from the cedente's rating band at open/refresh time
  status TEXT NOT NULL DEFAULT 'ativa' CHECK(status IN ('ativa', 'suspensa')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_line_draws (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  credit_line_id INTEGER NOT NULL REFERENCES credit_lines(id),
  valor_original REAL NOT NULL,
  saldo_devedor REAL NOT NULL, -- principal + accrued interest not yet repaid
  taxa_am REAL NOT NULL, -- rate locked in at draw time, unaffected by later re-scoring
  status TEXT NOT NULL DEFAULT 'aberto' CHECK(status IN ('aberto', 'quitado')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  quitado_at TEXT,
  last_accrual_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_credit_line_draws_line ON credit_line_draws(credit_line_id, status);
