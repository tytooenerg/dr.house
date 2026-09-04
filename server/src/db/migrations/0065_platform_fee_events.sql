-- Real platform-fee revenue log: every time settlePurchase or settleResale
-- (server/src/lib/settlement.ts) actually deducts a taxa de plataforma from a real
-- liquidação, this records the exact fee collected — already net of any institutional
-- block-trade discount (lib/blockTrade.ts's feeDiscountPct) — an auditable event log,
-- the same pattern insurance_settlements/legal_collection_fees already use, so revenue
-- can be summed exactly instead of recomputed from mutable current state
-- (lib/revenue.ts's getRealPlatformFees used to recompute platformFee(purchases.valor)
-- from scratch, which has no way to know a given resale's fee was discounted).
CREATE TABLE IF NOT EXISTS platform_fee_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duplicata_id TEXT NOT NULL REFERENCES duplicatas(id),
  valor REAL NOT NULL,
  fee_valor REAL NOT NULL,
  origem TEXT NOT NULL CHECK (origem IN ('compra', 'revenda')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_platform_fee_events_duplicata ON platform_fee_events(duplicata_id);
