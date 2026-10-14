-- Convite de aceite por link. Até aqui o sacado só ficava sabendo de uma duplicata se já
-- tivesse conta na Lastro com o nome da empresa escrito exatamente igual ao que o cedente
-- digitou (db/users.ts's getSacadoAccountByCompanyName) — sem conta, nenhum aviso, e a
-- empresa esperava os 15 dias do aceite tácito. O convite leva um link de uso único por
-- e-mail/WhatsApp: o sacado confere a duplicata e confirma ou contesta sem criar conta.
--
-- Só o hash do token é guardado (como refresh_tokens): quem lê o banco não consegue montar
-- o link. Os campos de resposta são a evidência de quem respondeu, de onde e quando.
CREATE TABLE IF NOT EXISTS aceite_convites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  aceite_id INTEGER NOT NULL REFERENCES aceites(id),
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT,
  telefone TEXT,
  criado_por INTEGER NOT NULL REFERENCES users(id),
  usado_em TEXT,
  decisao TEXT CHECK(decisao IN ('aceita','contestada')),
  respondido_por_nome TEXT,
  respondido_por_cargo TEXT,
  respondido_ip TEXT,
  respondido_user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_aceite_convites_aceite ON aceite_convites(aceite_id);
