-- Programa Confirming / Risco Sacado — um sacado pré-aprova um programa de financiamento
-- pra sua cadeia de fornecedores, na taxa da própria classificação de risco (mesma banda
-- que já se aplicaria a ele no mercado aberto — lib/riscoCore.ts + lib/dynamicPricing.ts),
-- sem leilão por duplicata. Esta migração é só a fundação: cria o programa e a matrícula
-- de cedentes elegíveis (lib/confirmingCore.ts). O financiamento automático em si — pular
-- o leilão de fato — e o fundo de fomento que o capitaliza vêm em features seguintes,
-- depois que esta base (quem pode participar, a que taxa, com qual limite) existir.
CREATE TABLE IF NOT EXISTS confirming_programas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sacado_user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
  sacado_cnpj TEXT NOT NULL,
  rating TEXT NOT NULL CHECK(rating IN ('AA', 'A', 'B', 'C')),
  taxa_am REAL NOT NULL,
  limite REAL NOT NULL,
  utilizado REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo', 'pausado')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS confirming_membros (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  programa_id INTEGER NOT NULL REFERENCES confirming_programas(id),
  cedente_user_id INTEGER NOT NULL REFERENCES users(id),
  sublimite REAL,
  status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo', 'removido')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(programa_id, cedente_user_id)
);

CREATE INDEX IF NOT EXISTS idx_confirming_membros_cedente ON confirming_membros(cedente_user_id, status);
