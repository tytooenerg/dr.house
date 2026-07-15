import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '../../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = process.env.DB_PATH || path.join(dataDir, 'lastro.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('investidor','cedente','sacado')),
  kyb_done INTEGER NOT NULL DEFAULT 0,
  kyb_form TEXT NOT NULL DEFAULT '{}',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS duplicatas (
  id TEXT PRIMARY KEY,
  cedente_id INTEGER REFERENCES users(id),
  cedente_nome TEXT NOT NULL,
  sacado_nome TEXT NOT NULL,
  sacado_cnpj TEXT NOT NULL DEFAULT '',
  valor REAL NOT NULL,
  vencimento TEXT NOT NULL,
  emissao TEXT NOT NULL,
  status TEXT NOT NULL,
  lastro_pct INTEGER NOT NULL DEFAULT 100,
  seguro INTEGER NOT NULL DEFAULT 0,
  insurer_key TEXT,
  registro TEXT,
  desagio TEXT,
  score INTEGER,
  close_at TEXT,
  leilao_started_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duplicata_id TEXT NOT NULL REFERENCES duplicatas(id),
  investor_id INTEGER NOT NULL REFERENCES users(id),
  valor REAL NOT NULL,
  taxa TEXT,
  retorno REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS aceites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  duplicata_id TEXT NOT NULL UNIQUE REFERENCES duplicatas(id),
  status TEXT NOT NULL DEFAULT 'aguardando',
  prazo_label TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aceite_id INTEGER NOT NULL REFERENCES aceites(id),
  motivo TEXT NOT NULL,
  evidence_status TEXT,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dispute_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dispute_id INTEGER NOT NULL REFERENCES disputes(id),
  autor TEXT NOT NULL,
  texto TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  color TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL REFERENCES users(id),
  nome TEXT NOT NULL,
  email TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'Somente leitura',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  data TEXT NOT NULL,
  descricao TEXT NOT NULL,
  valor REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS api_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  color TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

export function resetDbForTests() {
  db.exec(`
    DELETE FROM automation_activity;
    DELETE FROM api_logs;
    DELETE FROM uploads;
    DELETE FROM ledger;
    DELETE FROM team_members;
    DELETE FROM notifications;
    DELETE FROM dispute_events;
    DELETE FROM disputes;
    DELETE FROM aceites;
    DELETE FROM purchases;
    DELETE FROM duplicatas;
    DELETE FROM users;
  `);
}
