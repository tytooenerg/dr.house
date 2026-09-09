# Teste de operação real

`run.mjs` roda **uma operação de duplicata inteira** — do cadastro ao vencimento, passando
pelos seis papéis — contra um servidor de produção rodando de verdade: HTTP pela rede,
arquivo SQLite em disco, e o job de fechamento de leilão do próprio processo adjudicando o
leilão. Sem dependência nova (usa o `fetch` do Node e o `better-sqlite3` que o server já tem).

## Por que ele existe, se a suíte já tem um teste dos seis papéis

`server/test/full-lifecycle-all-roles.test.ts` encadeia os mesmos seis papéis, mas:

| | a suíte | aqui |
|---|---|---|
| servidor | `app` importado in-process (supertest) | processo `node server/dist/index.js` |
| banco | `DB_PATH=':memory:'` | arquivo em disco, WAL, as 72 migrações do zero |
| fechamento do leilão | `fecharLeiloes()` — helper chamando `closeDueAuctions(agora + 365 dias)` | `startAuctionCloseJob()`, o `setInterval` de 30s |
| aceite | às vezes `UPDATE aceites SET status='aceita'` | sacado logado, `POST /api/aceites/:id/status` |

O ponto que mais importa: **os 19 arquivos que fecham leilão fecham pelo helper**. Se
`startAuctionCloseJob()` sumisse do `index.ts`, a suíte inteira continuaria verde e nenhum
leilão fecharia em produção. O mesmo vale pro banco em arquivo — server e e2e usam `:memory:`.

Não roda em CI: precisa de um servidor no ar e leva ~2 minutos, quase todos esperando o job.

## O que é real e o que não é

Real: cada cadastro, o depósito Pix (cobrança + confirmação, no modo simulado que a própria
plataforma rotula porque `PIX_PSP_*` não está configurado), o KYB e a aprovação pelo admin, a
emissão, o aceite do sacado, a apólice, os dois lances, a adjudicação, o balcão com
contraproposta, o pagamento no vencimento, e cada centavo em `ledger`.

Simulado: **só o relógio.** Um leilão dura 6h e uma duplicata vence em 90 dias; `avancarRelogio()`
recua `close_at` e `vencimento` no mesmo arquivo SQLite (WAL permite a escrita concorrente) e
nada mais. Quem transiciona a duplicata continua sendo o job ou o endpoint do sacado.

## Uso

```bash
npm run build

# terminal 1 — servidor de produção sobre um banco NOVO
DB_PATH=/tmp/operacao.db JWT_SECRET=troque-isso PORT=4100 \
  CORS_ORIGINS=http://localhost:4100 NODE_ENV=production node server/dist/index.js

# terminal 2 — o admin de bootstrap (não há seed de demo em produção)
DB_PATH=/tmp/operacao.db ADMIN_EMAIL=voce@empresa.com.br ADMIN_PASSWORD='...' \
  ADMIN_NOME='Back-office' npm run create-admin --workspace=server

npm run operacao:real -- --url http://localhost:4100 --db /tmp/operacao.db \
  --admin-email voce@empresa.com.br --admin-senha '...'
```

Banco novo a cada rodada: `settleInsurance` credita a primeira conta com aquela `insurerKey`,
então uma segunda seguradora "too" no mesmo banco não receberia o prêmio (o roteiro aborta
dizendo isso). O limitador de `/auth/*` também é real — 20 requisições por 15 minutos por IP,
e o roteiro gasta ~12; ele é em memória, então reiniciar o servidor zera o contador.

### Controle negativo

```bash
npm run operacao:real -- ... --sem-relogio
```

Não adianta o `close_at`. O leilão **tem** que continuar aberto e o roteiro para ali. Sem
rodar isto pelo menos uma vez, "esperei e o leilão fechou" passaria mesmo que algo diferente
do job estivesse fechando.

## Resultado real (rodado neste ambiente, 2026-09-09)

Duplicata de R$ 50.000, reserva 3,0% a.m., lances de 2,5% (A) e 1,9% (B):

- o job fechou o leilão sozinho em **9-24s** (intervalo de 30s); com `--sem-relogio`, seguia
  aberto depois de 75s;
- venceu o menor deságio: B, a 1,9% a.m., por **R$ 47.181,67**;
- balcão: proposta de R$ 47.000 → contraproposta de R$ 48.500 → aceita, 2 rodadas;
- no vencimento o face foi para **A**, o credor atual — não para B nem para o cedente.

Caixa, ao centavo:

| | |
|---|---|
| cedente | +R$ 47.006,67 |
| investidor B | +R$ 1.148,58 (R$ 48.330,25 recebidos − R$ 47.181,67 pagos) |
| investidor A | +R$ 1.240,00 (R$ 50.000 − R$ 48.500 − R$ 260 de prêmio) |
| seguradora | +R$ 213,20 |
| plataforma | +R$ 391,55 (R$ 175,00 primária + R$ 169,75 secundária + R$ 46,80 de comissão) |
| **soma** | **R$ 50.000,00** |

A taxa primária é 0,35% do **valor de face** e a secundária 0,35% do **preço negociado** —
deliberado e comentado em `lib/settlement.ts`: a taxa é sobre o tamanho do recebível
antecipado, não sobre o que o investidor pagou por ele.

## O que esta rodada achou

A fila de revisão de compliance enchia com duplicatas que o próprio motor tinha
**auto-aprovado**, e elas não saíam nunca — `listPendingComplianceReview` filtrava só por
`reviewed = 0`, e o único jeito de marcar revisado exige `status = 'suspensa_compliance'`. O
painel do auditor mostrava como "pendente de revisão" a duplicata desta operação, já paga.
Corrigido em `db/complianceEngine.ts`, com regressão em `test/compliance-fila-humana.test.ts`.
