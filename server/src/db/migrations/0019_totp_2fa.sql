-- Real TOTP-based 2FA (RFC 6238) — no external dependency, see lib/totp.ts. A user's
-- secret is stored as soon as /auth/2fa/setup is called but totp_enabled only flips to 1
-- once they prove possession of the device via /auth/2fa/confirm, so an abandoned setup
-- never silently locks anyone out.
ALTER TABLE users ADD COLUMN totp_secret TEXT;
ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0;

-- One-time-use recovery codes generated alongside enabling 2FA, for when the user loses
-- access to their authenticator device. Only the hash is ever stored.
CREATE TABLE IF NOT EXISTS totp_recovery_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  code_hash TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_totp_recovery_user ON totp_recovery_codes(user_id);
