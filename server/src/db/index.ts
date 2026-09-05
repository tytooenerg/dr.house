import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

export const dbPath = process.env.DB_PATH || path.join(dataDir, 'lastro.db');
export const dataDirPath = dataDir;
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

runMigrations(db);

// Not currently called anywhere in this codebase — every test file gets its own fresh
// :memory: database (Vitest isolates module state per file, and test/setup.ts sets
// DB_PATH=':memory:' before this module is ever imported), so no test today needs a
// mid-file reset. Kept exported as a real, correct utility for a test that legitimately
// wants to reset state between cases within a single file, rather than removed outright —
// but it needs to actually stay correct to be trustworthy the day someone reaches for it.
// This list is generated from the live `sqlite_master` schema (not retyped from memory) and
// ordered so every table is cleared before anything it has a foreign key into — verified by
// running with `foreign_keys = ON` (see below), which makes an out-of-order DELETE a hard
// failure rather than a silent gap. `schema_migrations` is deliberately excluded: it's
// migration bookkeeping, not application data, and clearing it would make runMigrations()
// re-apply every migration on the same already-migrated database next time it runs.
export function resetDbForTests() {
  db.exec(`
    DELETE FROM auction_bids;
    DELETE FROM dispute_events;
    DELETE FROM disputes;
    DELETE FROM aceites;
    DELETE FROM addon_charges;
    DELETE FROM advertisements;
    DELETE FROM agent_pending_approvals;
    DELETE FROM agent_pending_actions;
    DELETE FROM agent_steps;
    DELETE FROM agent_runs;
    DELETE FROM api_key_usage;
    DELETE FROM api_keys;
    DELETE FROM api_logs;
    DELETE FROM audit_log;
    DELETE FROM auto_emit_imports;
    DELETE FROM automation_activity;
    DELETE FROM billing_events;
    DELETE FROM block_trade_items;
    DELETE FROM block_trades;
    DELETE FROM boletos;
    DELETE FROM claude_usage;
    DELETE FROM compliance_alerts;
    DELETE FROM compliance_engine_results;
    DELETE FROM confirming_fundo_ledger;
    DELETE FROM confirming_fundo_contributions;
    DELETE FROM confirming_fundo_quota_movements;
    DELETE FROM confirming_membros;
    DELETE FROM confirming_programas;
    DELETE FROM contract_analyses;
    DELETE FROM credit_line_fund_ledger;
    DELETE FROM credit_line_draws;
    DELETE FROM credit_line_fund_contributions;
    DELETE FROM credit_line_fund_quota_movements;
    DELETE FROM credit_lines;
    DELETE FROM erp_receivables;
    DELETE FROM fractional_holdings;
    DELETE FROM fractional_offerings;
    DELETE FROM insurance_settlements;
    DELETE FROM legal_collection_fees;
    DELETE FROM platform_fee_events;
    DELETE FROM legal_documents;
    DELETE FROM resale_bids;
    DELETE FROM resale_listings;
    DELETE FROM purchases;
    DELETE FROM duplicatas;
    DELETE FROM feature_flags;
    DELETE FROM foreign_investor_screenings;
    DELETE FROM idempotency_keys;
    DELETE FROM ledger;
    DELETE FROM notifications;
    DELETE FROM payables;
    DELETE FROM pix_charges;
    DELETE FROM pix_payouts;
    DELETE FROM platform_settings;
    DELETE FROM push_subscriptions;
    DELETE FROM reconciliation_flags;
    DELETE FROM refresh_tokens;
    DELETE FROM regulatory_notes;
    DELETE FROM sacado_network_signals;
    DELETE FROM sanctions_watchlist_demo;
    DELETE FROM stablecoin_deposits;
    DELETE FROM stablecoin_payouts;
    DELETE FROM suitability_assessments;
    DELETE FROM suspicious_activity_reports;
    DELETE FROM system_health_checks;
    DELETE FROM team_members;
    DELETE FROM ted_deposits;
    DELETE FROM ted_payouts;
    DELETE FROM totp_recovery_codes;
    DELETE FROM uploads;
    DELETE FROM webhook_deliveries;
    DELETE FROM webhooks;
    DELETE FROM users;
  `);
}
