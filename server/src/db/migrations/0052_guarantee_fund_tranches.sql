-- Abre o fundo de garantia (0036_guarantee_fund.sql) para aporte externo, em duas
-- classes de cota com prioridade de perda diferente — mesma mecânica de cota/NAV que
-- credit_line_fund_quota_movements (0042) já usa, agora com uma coluna `classe`. O capital
-- aportado por investidor entra de verdade em guarantee_fund_ledger (tipo 'contribuicao') —
-- essas tabelas aqui são só atribuição (quem "dono" de qual fatia do saldo real, pra saber
-- em que ordem absorve perda e resgata), não uma segunda fonte de caixa.
--
-- Waterfall de perdas num sinistro pago (lib/guaranteeFundTranches.ts's allocateClaimLoss):
-- 1) capital-base da própria Lastro (a contribuição automática de 10% da taxa, sem
--    atribuição de tranche — é o que sobra do saldo total menos as duas NAVs abaixo);
-- 2) tranche júnior;
-- 3) tranche sênior — só é atingida se a base E a júnior já tiverem zerado.
-- Sênior é, por isso, a classe mais protegida — o produto de yield conservador vendido a
-- capital institucional; júnior é o de maior risco/retorno.
CREATE TABLE IF NOT EXISTS guarantee_fund_tranche_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  classe TEXT NOT NULL CHECK(classe IN ('senior', 'junior')),
  tipo TEXT NOT NULL CHECK(tipo IN ('aporte', 'resgate', 'rendimento', 'perda_absorvida')),
  valor REAL NOT NULL, -- positivo = cresce a NAV da classe, negativo = reduz
  descricao TEXT NOT NULL,
  investor_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guarantee_fund_tranche_ledger_classe ON guarantee_fund_tranche_ledger(classe);
CREATE INDEX IF NOT EXISTS idx_guarantee_fund_tranche_ledger_investor ON guarantee_fund_tranche_ledger(investor_id);

CREATE TABLE IF NOT EXISTS guarantee_fund_tranche_quota_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_id INTEGER NOT NULL REFERENCES users(id),
  classe TEXT NOT NULL CHECK(classe IN ('senior', 'junior')),
  quotas REAL NOT NULL, -- positivo = cota comprada (aporte), negativo = cota vendida (resgate)
  cota_price REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guarantee_fund_tranche_quota_movements_investor ON guarantee_fund_tranche_quota_movements(investor_id, classe);
