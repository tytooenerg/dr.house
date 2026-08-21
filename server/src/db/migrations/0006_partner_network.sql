CREATE TABLE users_new_0006 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('investidor','cedente','sacado','admin','seguradora')),
  kyb_done INTEGER NOT NULL DEFAULT 0,
  kyb_form TEXT NOT NULL DEFAULT '{}',
  kyb_status TEXT NOT NULL DEFAULT 'none' CHECK(kyb_status IN ('none','pending','approved','rejected')),
  kyb_reject_reason TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT 'basico',
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'none',
  plan_current_period_end TEXT,
  insurer_key TEXT,
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new_0006 (
  id, email, password_hash, nome, telefone, company_name, role, kyb_done, kyb_form, kyb_status, kyb_reject_reason,
  plan, stripe_customer_id, stripe_subscription_id, subscription_status, plan_current_period_end, settings, created_at
)
SELECT
  id, email, password_hash, nome, telefone, company_name, role, kyb_done, kyb_form, kyb_status, kyb_reject_reason,
  plan, stripe_customer_id, stripe_subscription_id, subscription_status, plan_current_period_end, settings, created_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new_0006 RENAME TO users;

ALTER TABLE duplicatas ADD COLUMN sinistro_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE duplicatas ADD COLUMN sinistro_note TEXT;

CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  key_hash TEXT NOT NULL UNIQUE,
  key_prefix TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT 'Chave de produção',
  revoked INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  url TEXT NOT NULL,
  event TEXT NOT NULL,
  secret TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_webhooks_user_event ON webhooks(user_id, event);
