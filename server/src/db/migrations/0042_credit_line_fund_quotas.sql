-- Real per-investor yield attribution for the credit-line fund. 0039_credit_line_fund.sql
-- deliberately left this unattributed — interest returned from repayments just grew the
-- shared pool balance, benefiting "whoever holds a position when it lands" rather than each
-- contributor proportionally to how much/how long they've actually had money in the pool.
--
-- This adds a real cota/NAV pricing model, the same mechanic a Brazilian FIDC uses: every
-- aporte buys quotas at the fund's current cota price (NAV / total quotas outstanding);
-- every resgate sells quotas back at the current price. Interest returned from repayments
-- never mints new quotas — it only grows NAV, so the cota price itself rises for whoever
-- already holds quotas at that moment. See lib/creditLineFund.ts for the full mechanic and
-- the "price per unit" convention (starts at R$1,00/cota, same bootstrap every real fund
-- uses at inception).
CREATE TABLE IF NOT EXISTS credit_line_fund_quota_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  investor_id INTEGER NOT NULL REFERENCES users(id),
  quotas REAL NOT NULL, -- positive = quotas bought (aporte), negative = quotas sold (resgate)
  cota_price REAL NOT NULL, -- price per quota at the moment of this movement, kept for audit/display
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_credit_line_fund_quota_movements_investor ON credit_line_fund_quota_movements(investor_id);
