-- White-label com domínio próprio (feature "White-label mais agressivo"): até aqui,
-- whitelabelBrand (0029) só trocava nome/cor num único touchpoint (a tela de aceite do
-- sacado), sempre dentro do domínio da Lastro. Isso adiciona um domínio/subdomínio real
-- por conta Empresarial (routes/erp.ts POST /whitelabel/domain), resolvido no primeiro
-- request público (routes/public.ts GET /brand, por req.get('host')) — a marca aparece
-- inclusive na tela de login, antes de qualquer autenticação. Coluna própria (não dentro
-- do JSON settings) porque, diferente de pixChave/tedContaBancaria/stablecoinWalletEndereco,
-- este valor precisa ser consultado POR valor a cada request público, não só lido do dono.
ALTER TABLE users ADD COLUMN whitelabel_custom_domain TEXT;
-- Um domínio só pode apontar para uma conta — índice único parcial (SQLite trata cada
-- NULL como distinto, então múltiplas contas sem domínio configurado não colidem).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_whitelabel_domain ON users(whitelabel_custom_domain) WHERE whitelabel_custom_domain IS NOT NULL;
