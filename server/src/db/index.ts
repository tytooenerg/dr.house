import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'lastro.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

runMigrations(db);

export function resetDbForTests() {
  db.exec(`
    DELETE FROM audit_log;
    DELETE FROM refresh_tokens;
    DELETE FROM automation_activity;
    DELETE FROM api_logs;
    DELETE FROM uploads;
    DELETE FROM ledger;
    DELETE FROM team_members;
    DELETE FROM notifications;
    DELETE FROM dispute_events;
    DELETE FROM disputes;
    DELETE FROM aceites;
    DELETE FROM insurance_settlements;
    DELETE FROM sacado_network_signals;
    DELETE FROM resale_listings;
    DELETE FROM purchases;
    DELETE FROM legal_documents;
    DELETE FROM duplicatas;
    DELETE FROM webhook_deliveries;
    DELETE FROM idempotency_keys;
    DELETE FROM api_key_usage;
    DELETE FROM webhooks;
    DELETE FROM api_keys;
    DELETE FROM system_health_checks;
    DELETE FROM claude_usage;
    DELETE FROM regulatory_notes;
    DELETE FROM users;
  `);
}
