import type Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, 'migrations');

export function runMigrations(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const applied = new Set((db.prepare('SELECT id FROM schema_migrations').all() as { id: string }[]).map((r) => r.id));
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    db.pragma('foreign_keys = OFF');
    db.exec(sql);
    db.pragma('foreign_keys = ON');
    db.prepare('INSERT INTO schema_migrations (id) VALUES (?)').run(file);
    console.log(`[db] applied migration ${file}`);
  }
}
