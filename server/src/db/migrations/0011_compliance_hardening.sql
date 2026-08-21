-- Compliance hardening pass, in response to a conformity/gap analysis against BACEN
-- rules and bank/PME pain points. Closes what's buildable in software without a real
-- commercial contract: NF-e chave capture to prevent duplicidade within Lastro's own
-- base, a legal SLA deadline on aceite, the cedente's "aquisição com regresso"
-- coobrigação (Res. BCB 540/2025), a real alerts feed to replace static fraud-detection
-- copy, and a labeled DEMONSTRATION sanctions/PEP watchlist for KYB screening. Real
-- registry APIs (CERC/B3/Núclea) and a live OFAC/COAF/CVM feed still require a licensed
-- commercial integration this environment can't provide — those stay simulated.

ALTER TABLE duplicatas ADD COLUMN nfe_chave TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_duplicatas_nfe_chave ON duplicatas(nfe_chave) WHERE nfe_chave IS NOT NULL;

-- Legal aceite window (sacado has up to 15 days to accept per the financiador
-- requirements already documented in the Compliance screen).
ALTER TABLE aceites ADD COLUMN prazo_limite TEXT;

-- Res. BCB 540/2025 formalizes "aquisição com regresso" as the default expectation for
-- a duplicata escritural purchase — the cedente stays coobrigado unless waived.
ALTER TABLE purchases ADD COLUMN com_regresso INTEGER NOT NULL DEFAULT 1;

ALTER TABLE users ADD COLUMN pld_status TEXT NOT NULL DEFAULT 'clear' CHECK(pld_status IN ('clear','flagged'));
ALTER TABLE users ADD COLUMN pld_match_note TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS compliance_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK(type IN ('nfe_duplicidade','valor_anomalo','pld_screening')),
  severity TEXT NOT NULL CHECK(severity IN ('info','atencao','critico')),
  message TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id),
  duplicata_id TEXT REFERENCES duplicatas(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_created ON compliance_alerts(created_at);

-- DEMONSTRATION-ONLY watchlist for automated PLD/FT screening at KYB submission time.
-- Fictitious entries, clearly labeled — a real deployment integrates a licensed
-- sanctions/PEP data vendor (there is no live OFAC/COAF/CVM feed behind this table).
CREATE TABLE IF NOT EXISTS sanctions_watchlist_demo (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  cnpj TEXT,
  tipo TEXT NOT NULL CHECK(tipo IN ('sancao','pep')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO sanctions_watchlist_demo (nome, cnpj, tipo) VALUES
  ('Comercial Exemplo Sancionada Ltda (registro fictício de demonstração)', '11111111000191', 'sancao'),
  ('Nome Fictício De Teste PEP (registro fictício de demonstração)', NULL, 'pep');
