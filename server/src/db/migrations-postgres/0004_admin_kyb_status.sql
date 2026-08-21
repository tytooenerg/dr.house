-- Native Postgres equivalent of the SQLite table-rebuild this migration performs (see
-- REBUILD_OVERRIDES in scripts/postgres/generate-schema.mjs for why the direct syntax
-- port doesn't work and what confirmed this replacement is correct).
ALTER TABLE users ADD COLUMN kyb_status TEXT NOT NULL DEFAULT 'none' CHECK (kyb_status IN ('none','pending','approved','rejected'));
ALTER TABLE users ADD COLUMN kyb_reject_reason TEXT NOT NULL DEFAULT '';

ALTER TABLE users DROP CONSTRAINT users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('investidor','cedente','sacado','admin'));

-- Same backfill the SQLite rebuild's INSERT...SELECT CASE performed for pre-existing rows.
UPDATE users SET kyb_status = CASE
  WHEN role = 'investidor' AND kyb_done = 1 THEN 'approved'
  WHEN role = 'investidor' AND kyb_done = 0 THEN 'none'
  ELSE 'approved'
END;

ALTER TABLE disputes ADD COLUMN resolution TEXT NOT NULL DEFAULT '';
ALTER TABLE disputes ADD COLUMN resolved_by INTEGER REFERENCES users(id);
ALTER TABLE disputes ADD COLUMN resolved_at TEXT;
