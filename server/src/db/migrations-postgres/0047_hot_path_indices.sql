-- Indices on foreign-key columns that real query code (server/src/db/*.ts) actually filters
-- by — purchases.investor_id, duplicatas.cedente_id, notifications.user_id, etc. — but that
-- had no secondary index, so every such lookup was a full table scan. Harmless at this
-- project's current demo data volume; a real gap once real data volume shows up. Every
-- column here was confirmed to be actually queried (grep for `WHERE <col> = ?` across
-- db/*.ts), not indexed speculatively off the column name alone — several other *_id
-- columns exist in this schema that no current query filters by, and those were
-- deliberately left alone.
CREATE INDEX IF NOT EXISTS idx_purchases_investor ON purchases(investor_id);
CREATE INDEX IF NOT EXISTS idx_purchases_duplicata ON purchases(duplicata_id);
CREATE INDEX IF NOT EXISTS idx_duplicatas_cedente ON duplicatas(cedente_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON ledger(user_id);
CREATE INDEX IF NOT EXISTS idx_resale_listings_duplicata ON resale_listings(duplicata_id);
CREATE INDEX IF NOT EXISTS idx_resale_listings_seller ON resale_listings(seller_id);
CREATE INDEX IF NOT EXISTS idx_resale_listings_purchase ON resale_listings(purchase_id);
CREATE INDEX IF NOT EXISTS idx_fractional_holdings_investor ON fractional_holdings(investor_id);
CREATE INDEX IF NOT EXISTS idx_fractional_holdings_offering ON fractional_holdings(offering_id);
CREATE INDEX IF NOT EXISTS idx_fractional_offerings_duplicata ON fractional_offerings(duplicata_id);
CREATE INDEX IF NOT EXISTS idx_guarantee_fund_claims_duplicata ON guarantee_fund_claims(duplicata_id);
CREATE INDEX IF NOT EXISTS idx_guarantee_fund_claims_investor ON guarantee_fund_claims(investor_id);
CREATE INDEX IF NOT EXISTS idx_credit_lines_cedente ON credit_lines(cedente_id);
CREATE INDEX IF NOT EXISTS idx_team_members_owner ON team_members(owner_id);
CREATE INDEX IF NOT EXISTS idx_uploads_user ON uploads(user_id);
CREATE INDEX IF NOT EXISTS idx_api_logs_user ON api_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_claude_usage_user ON claude_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_automation_activity_user ON automation_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_aceites_duplicata ON aceites(duplicata_id);
CREATE INDEX IF NOT EXISTS idx_disputes_aceite ON disputes(aceite_id);
CREATE INDEX IF NOT EXISTS idx_dispute_events_dispute ON dispute_events(dispute_id);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_duplicata ON compliance_alerts(duplicata_id);
CREATE INDEX IF NOT EXISTS idx_compliance_alerts_user ON compliance_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_insurance_settlements_investor ON insurance_settlements(investor_id);
CREATE INDEX IF NOT EXISTS idx_auto_emit_imports_duplicata ON auto_emit_imports(duplicata_id);
CREATE INDEX IF NOT EXISTS idx_auto_emit_imports_user ON auto_emit_imports(user_id);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_user ON idempotency_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_reconciliation_flags_user ON reconciliation_flags(user_id);
-- suitability_assessments.user_id is already the table's PRIMARY KEY (auto-indexed) —
-- no secondary index needed there.
CREATE INDEX IF NOT EXISTS idx_block_trade_items_duplicata ON block_trade_items(duplicata_id);
CREATE INDEX IF NOT EXISTS idx_block_trade_items_listing ON block_trade_items(listing_id);
CREATE INDEX IF NOT EXISTS idx_block_trade_items_seller ON block_trade_items(seller_id);
CREATE INDEX IF NOT EXISTS idx_credit_line_fund_ledger_investor ON credit_line_fund_ledger(investor_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_user ON billing_events(user_id);
