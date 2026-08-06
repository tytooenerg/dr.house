-- Unified Compliance AI Engine: combines the signals that already existed separately
-- (duplicidade check, PLD status, valor anômalo, score do sacado) into one deterministic
-- 0-100 score computed at emissão (see lib/complianceEngine.ts). The score itself is
-- always deterministic/auditable — Claude only explains it in natural language for the
-- human reviewer, never outputs the number itself, so the compliance-critical decision
-- stays reproducible even when ANTHROPIC_API_KEY isn't set.
--
-- A score at/above the threshold suspends the duplicata (status='suspensa_compliance' —
-- see lib/emitirCore.ts) instead of letting it reach 'aprovada'/the marketplace. This is
-- always a suspend-for-review, never an automatic permanent block: an admin must
-- liberar or rejeitar it from the new Fila de Compliance in the back-office.

ALTER TABLE duplicatas ADD COLUMN compliance_score INTEGER;

CREATE TABLE IF NOT EXISTS compliance_engine_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duplicata_id TEXT NOT NULL REFERENCES duplicatas(id),
  score INTEGER NOT NULL,
  breakdown_json TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('auto_aprovado', 'suspenso_para_revisao')),
  reviewed INTEGER NOT NULL DEFAULT 0,
  review_decision TEXT CHECK(review_decision IN ('liberado', 'rejeitado')),
  review_note TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_compliance_engine_duplicata ON compliance_engine_results(duplicata_id);
CREATE INDEX IF NOT EXISTS idx_compliance_engine_pending ON compliance_engine_results(reviewed) WHERE reviewed = 0;
