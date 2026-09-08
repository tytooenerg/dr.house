-- Capacidade declarada pela seguradora. A Lastro distribui as apólices, então é a única
-- parte que enxerga o livro inteiro distribuído — e até aqui não enxergava nada: uma
-- seguradora acumulava exposição ilimitada num mesmo sacado e continuava sendo oferecida
-- como se tivesse capacidade infinita, o que nenhuma subscrição real faz.
--
-- Os dois limites são NULL por padrão, de propósito: "sem limite declarado" significa que a
-- plataforma NÃO impõe nenhum teto, em vez de inventar um número de capacidade que a
-- seguradora nunca informou. O enforcement só existe depois que ela declara — mesma
-- disciplina de "real quando configurado" do resto do sistema.
CREATE TABLE IF NOT EXISTS insurer_limits (
  insurer_key TEXT PRIMARY KEY,
  limite_total REAL,
  limite_por_sacado REAL,
  updated_at TEXT NOT NULL DEFAULT now()
);
