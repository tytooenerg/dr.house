-- Real enterprise SSO account linking (lib/samlSso.ts) — mirrors the users.google_sub
-- column added for Google OAuth. NULL for every account that never used SAML SSO.
ALTER TABLE users ADD COLUMN saml_subject_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_saml_subject_id ON users(saml_subject_id) WHERE saml_subject_id IS NOT NULL;
