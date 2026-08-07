-- Foreign/non-resident investor (INR) onboarding — lib/foreignInvestorCompliance.ts.
-- Stores each generated eligibility memo (país de domicílio, jurisdição-de-tributação-
-- favorecida check per IN RFB 1.037/2010, classificação de investidor, resultado da
-- triagem PLD reforçada) as an audit record an admin can review during KYB approval —
-- same "generate once, persist, review" pattern as legal_documents, kept as its own
-- table since this memo is deterministic (no LLM involved) rather than an AI draft.
CREATE TABLE IF NOT EXISTS foreign_investor_screenings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  pais_domicilio TEXT NOT NULL,
  jurisdicao_favorecida INTEGER NOT NULL DEFAULT 0,
  classificacao_investidor TEXT NOT NULL CHECK(classificacao_investidor IN ('profissional', 'qualificado', 'nao_classificado')),
  representante_legal TEXT NOT NULL DEFAULT '',
  pld_status TEXT NOT NULL CHECK(pld_status IN ('clear', 'flagged')),
  pld_detail TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL,
  generated_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_foreign_investor_screenings_user ON foreign_investor_screenings(user_id);
