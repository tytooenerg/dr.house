-- Adds the read-only 'auditor' role. SQLite has no ALTER TABLE ... ALTER COLUMN for CHECK
-- constraints, so widening the role CHECK means recreating the table — same pattern
-- 0006_partner_network.sql already used to add 'admin'/'seguradora'. Every column below is
-- copied verbatim from the current live schema (introspected via sqlite_master), not
-- retyped from memory, to avoid silently dropping a column added since 0006.
CREATE TABLE users_new_0045 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('investidor','cedente','sacado','admin','seguradora','auditor')),
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT,
  referral_code TEXT,
  referred_by_user_id INTEGER REFERENCES users(id),
  referral_bonus_emissions INTEGER NOT NULL DEFAULT 0,
  pld_status TEXT NOT NULL DEFAULT 'clear' CHECK(pld_status IN ('clear','flagged')),
  pld_match_note TEXT NOT NULL DEFAULT '',
  team_owner_id INTEGER REFERENCES users(id),
  totp_secret TEXT,
  totp_enabled INTEGER NOT NULL DEFAULT 0,
  google_sub TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'password',
  whitelabel_plus_enabled INTEGER NOT NULL DEFAULT 0,
  institutional_reporting_enabled INTEGER NOT NULL DEFAULT 0,
  saml_subject_id TEXT
);

INSERT INTO users_new_0045 (
  id, email, password_hash, nome, telefone, company_name, role, kyb_done, kyb_form, kyb_status, kyb_reject_reason,
  plan, stripe_customer_id, stripe_subscription_id, subscription_status, plan_current_period_end, insurer_key, settings, created_at,
  deleted_at, referral_code, referred_by_user_id, referral_bonus_emissions, pld_status, pld_match_note, team_owner_id,
  totp_secret, totp_enabled, google_sub, auth_provider, whitelabel_plus_enabled, institutional_reporting_enabled, saml_subject_id
)
SELECT
  id, email, password_hash, nome, telefone, company_name, role, kyb_done, kyb_form, kyb_status, kyb_reject_reason,
  plan, stripe_customer_id, stripe_subscription_id, subscription_status, plan_current_period_end, insurer_key, settings, created_at,
  deleted_at, referral_code, referred_by_user_id, referral_bonus_emissions, pld_status, pld_match_note, team_owner_id,
  totp_secret, totp_enabled, google_sub, auth_provider, whitelabel_plus_enabled, institutional_reporting_enabled, saml_subject_id
FROM users;

DROP TABLE users;
ALTER TABLE users_new_0045 RENAME TO users;
