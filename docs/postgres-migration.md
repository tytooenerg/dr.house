# Caminho de migração SQLite → Postgres

Este documento é deliberadamente honesto sobre escopo: **a migração não está implementada
neste repositório** — o que existe é o caminho real para fazer, mapeado contra o código
atual, para que a decisão (quando e como migrar) seja informada em vez de adivinhada.
SQLite (`better-sqlite3`, ver `server/src/db/index.ts`) é uma escolha real e defensável até
um certo ponto de escala — é rápido, zero-config, e todo o resto deste projeto (WAL mode,
backups automáticos, migrations versionadas) já assume esse ponto de partida. Não é preciso
migrar antes de precisar.

## Quando migrar de verdade

Sinais concretos de que chegou a hora, não uma data no calendário:

- Mais de uma instância da API precisando escrever no mesmo banco (SQLite com WAL suporta
  múltiplos leitores + um escritor; múltiplos processos escrevendo concorrentemente é onde
  ele para de ser a ferramenta certa).
- Tamanho do arquivo `.db` ficando grande o bastante para que backup/restore (hoje via
  cópia de arquivo, `server/src/lib/backup.ts`) comece a demorar de forma perceptível.
- Necessidade real de réplica de leitura geograficamente distribuída.

Nenhum desses é hoje uma limitação real deste protótipo — são o motivo de isto ser um
documento, não uma migration já escrita.

## O que precisa mudar no código

1. **Driver**: trocar `better-sqlite3` (síncrono) por um driver assíncrono para Postgres
   (`pg` ou `postgres`). Isso é a mudança mais invasiva — todo `db/*.ts` neste repositório
   usa `db.prepare(...).get()/.all()/.run()` de forma síncrona; a versão Postgres exige
   `await` em cada chamada. Não há atalho: cada uma das ~30 arquivos em `server/src/db/`
   precisa ser revisitada.
2. **SQL não-portável**: alguns pontos usam sintaxe específica do SQLite —
   `INSERT ... ON CONFLICT DO UPDATE` (Postgres tem sintaxe quase idêntica, ok),
   `datetime('now', '-N hours')` (vira `now() - interval 'N hours'` em Postgres),
   `AUTOINCREMENT` (vira `SERIAL`/`GENERATED ALWAYS AS IDENTITY`). Buscar por essas três
   strings no diretório `server/src/db/migrations/` dá a lista exata de arquivos a revisar.
3. **Migrations**: o runner atual (`server/src/db/migrate.ts`) é simples o bastante (lê
   `.sql` do diretório, aplica em ordem, registra em `schema_migrations`) para continuar
   funcionando com syntax Postgres nos arquivos — o mecanismo de versionamento não precisa
   mudar, só o SQL dentro de cada migration.
4. **`:memory:` nos testes**: a suíte de testes (`server/test/setup.ts`) usa
   `DB_PATH=':memory:'` para isolar cada arquivo de teste com um banco limpo e rápido.
   Postgres não tem equivalente direto — a alternativa real é um schema Postgres novo (ou
   um container Postgres efêmero) por execução de teste, o que torna a suíte
   consideravelmente mais lenta a não ser que se invista em paralelização real.
5. **`journal_mode = WAL` e `foreign_keys = ON`**: esses dois `db.pragma(...)` em
   `db/index.ts` são específicos do SQLite — não têm equivalente 1:1 (Postgres já impõe FK
   por padrão; WAL não se aplica).

## O que **não** precisa mudar

- O modelo de dados em si (tabelas, colunas, relacionamentos) é portável quase 1:1 —
  nenhuma migration usa um recurso do SQLite sem equivalente direto em Postgres.
- Toda a lógica de negócio fora de `server/src/db/` (routes, lib) não sabe qual banco está
  por trás — ela só chama funções de `db/*.ts`. Migrar bem o driver e reescrever os
  arquivos de `db/` de forma síncrona→assíncrona propaga automaticamente para o resto do
  app, desde que cada `await` seja adicionado corretamente nas camadas acima (routes já são
  `async` na maioria dos casos, então o impacto ali é menor do que parece).
- `lib/cache.ts` (cache opcional Redis/memória) e o relay de WebSocket via Redis
  (`server/src/ws.ts`) já são independentes do banco — nada muda ali.

## Recomendação prática

Não migrar preventivamente. Quando um dos sinais de "quando migrar" acima aparecer de
verdade, o trabalho é: (1) escrever um adaptador `db/index.ts` alternativo atrás da mesma
interface síncrona hoje usada — ou aceitar o custo de tornar tudo assíncrono de uma vez —,
(2) portar as ~30 migrations SQL, (3) trocar o `:memory:` dos testes por um schema
descartável. Esforço real de dias, não de horas, mas bem contido pelo fato de a lógica de
negócio nunca ter acoplamento direto com SQLite fora da camada `db/`.
