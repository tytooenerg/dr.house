ALTER TABLE users ADD COLUMN whitelabel_custom_domain TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_whitelabel_domain ON users(whitelabel_custom_domain) WHERE whitelabel_custom_domain IS NOT NULL;
