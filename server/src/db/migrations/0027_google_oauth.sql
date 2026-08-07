-- Real "Entrar com Google" (lib/googleOAuth.ts). google_sub is Google's own stable
-- account identifier — the correct thing to key off of, not email (which a user could
-- change on Google's side). A google-only account still gets a real, unusable random
-- password_hash (never derivable/guessable) rather than a nullable column, avoiding a
-- wider NOT NULL relaxation across every other password_hash read in the codebase.
ALTER TABLE users ADD COLUMN google_sub TEXT;
ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'password';
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;
