CREATE TABLE users_new_0004 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  nome TEXT NOT NULL,
  telefone TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('investidor','cedente','sacado','admin')),
  kyb_done INTEGER NOT NULL DEFAULT 0,
  kyb_form TEXT NOT NULL DEFAULT '{}',
  kyb_status TEXT NOT NULL DEFAULT 'none' CHECK(kyb_status IN ('none','pending','approved','rejected')),
  kyb_reject_reason TEXT NOT NULL DEFAULT '',
  settings TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new_0004 (id, email, password_hash, nome, telefone, company_name, role, kyb_done, kyb_form, kyb_status, settings, created_at)
SELECT id, email, password_hash, nome, telefone, company_name, role, kyb_done, kyb_form,
  CASE WHEN role = 'investidor' AND kyb_done = 1 THEN 'approved'
       WHEN role = 'investidor' AND kyb_done = 0 THEN 'none'
       ELSE 'approved' END,
  settings, created_at
FROM users;

-- Dropping (rather than renaming) the old table, then renaming the replacement into place,
-- avoids SQLite's automatic FK-reference rewrite: a plain RENAME of `users` would silently
-- repoint every other table's "REFERENCES users(id)" at the old table's new name instead.
DROP TABLE users;
ALTER TABLE users_new_0004 RENAME TO users;

ALTER TABLE disputes ADD COLUMN resolution TEXT NOT NULL DEFAULT '';
ALTER TABLE disputes ADD COLUMN resolved_by INTEGER REFERENCES users(id);
ALTER TABLE disputes ADD COLUMN resolved_at TEXT;
