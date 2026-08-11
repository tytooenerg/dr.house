# Deploy em produção

Este é o passo a passo real para colocar o Lastro no ar em um servidor próprio (VPS), com
HTTPS automático e as proteções mínimas que uma aplicação financeira exposta à internet
precisa. Para rodar localmente/demo, use o [`README.md`](README.md) — este documento é
especificamente sobre o caminho de produção (`docker-compose.prod.yml` + `Caddyfile`), que é
separado do `docker-compose.yml` de desenvolvimento (esse continua funcionando como sempre,
sem HTTPS/hardening, para rodar rápido na sua máquina).

## 1. Pré-requisitos

- Um VPS com Docker e Docker Compose instalados (qualquer provedor — o importante é ter um
  IP público fixo). 2 vCPU / 2-4 GB RAM já é confortável para começar.
- Um domínio (ou subdomínio) real que você controla, ex. `app.suaempresa.com.br`.
- Portas **80** e **443** liberadas no firewall do servidor — o Caddy precisa delas para o
  desafio HTTPS automático (Let's Encrypt) e para servir tráfego.

## 2. DNS

Aponte um registro **A** (e **AAAA**, se o servidor tiver IPv6) do seu domínio para o IP
público do servidor:

```
app.suaempresa.com.br.   A   <IP do servidor>
```

Confirme que já propagou antes de continuar (`dig +short app.suaempresa.com.br` deve
devolver o IP do servidor) — o Caddy só consegue emitir o certificado HTTPS depois que o
DNS já resolve para ele.

## 3. Colocar o código no servidor

O jeito mais simples é clonar o repositório diretamente no servidor:

```bash
git clone <url-do-seu-repositório> lastro
cd lastro
git checkout <branch-de-produção>   # ou main/master, conforme o seu fluxo
```

(Alternativa sem git no servidor: `rsync` ou `scp` da sua máquina — qualquer forma de fazer
o conteúdo do repositório chegar lá funciona, o Docker builda a partir do que estiver na
pasta.)

## 4. Configurar o `.env`

Crie um arquivo `.env` na raiz do projeto (o mesmo diretório do `docker-compose.prod.yml`).
Ele **não** deve ir para o git — já está no `.gitignore`.

```bash
cp server/.env.example .env   # só como referência de quais chaves existem; edite os valores abaixo
```

Variáveis **obrigatórias** (o `docker-compose.prod.yml` recusa subir sem elas — sem
fallback inseguro em produção):

```bash
# Assina todo token de acesso/refresh/2FA/OAuth/SAML emitido pela API. Gere um valor real:
JWT_SECRET=$(openssl rand -hex 32)

# URL pública real da aplicação — a mesma que você apontou no DNS, com https://
APP_URL=https://app.suaempresa.com.br
CORS_ORIGINS=https://app.suaempresa.com.br

# Senha do Redis interno (cache + relay do WebSocket) — nunca published para a internet,
# mas ainda assim exige senha (ver docker-compose.prod.yml).
REDIS_PASSWORD=$(openssl rand -hex 24)
```

Rode os dois `openssl rand` acima de verdade e cole os valores gerados no `.env` — não
reuse os exemplos deste documento.

Tudo mais no `docker-compose.prod.yml` é **opcional** — a aplicação roda de verdade
(com fallbacks honestos e claramente simulados) sem nenhuma dessas integrações. Preencha
só as que você já contratou: `ANTHROPIC_API_KEY` (recursos de IA), `SENTRY_DSN` (erros),
`SMTP_*` (e-mails reais em vez de só logados), `STRIPE_*` (cobrança real), `VAPID_*`
(push web), `GOOGLE_OAUTH_*` (login com Google), `BACKUP_OFFSITE_CMD` (cópia do backup
diário para fora do servidor — veja `server/src/lib/backup.ts`). A lista completa, com o
que cada uma desbloqueia, está em `server/.env.example`.

## 5. Subir a stack

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Isso builda a imagem (client + server, ver `Dockerfile`) e sobe três serviços:

- `app` — a API + SPA, rodando como usuário não-root, sem porta exposta direto ao host;
- `redis` — cache/relay interno, protegido por senha, também sem porta exposta ao host;
- `caddy` — proxy reverso nas portas 80/443, obtendo e renovando o certificado HTTPS
  automaticamente via Let's Encrypt.

Acompanhe os logs até ver o servidor no ar:

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

Espere a linha `Lastro API listening on http://localhost:4000`. Depois confirme de fora do
servidor:

```bash
curl -s https://app.suaempresa.com.br/api/health
# {"ok":true,"service":"lastro-api"}
```

Se isso devolver o JSON acima com HTTPS válido, a stack está no ar.

## 6. Criar a primeira conta admin

Um banco de dados novo em produção **não** vem com as contas de demonstração
(`admin@lastro.demo` etc.) — isso é deliberado: essas contas têm senha pública
(`demo1234`, documentada no `README.md`) e criar uma conta admin com essa senha em um
servidor exposto à internet seria uma vulnerabilidade real, não um detalhe. Em vez disso,
crie sua própria conta admin com uma senha de verdade:

```bash
docker compose -f docker-compose.prod.yml exec \
  -e ADMIN_EMAIL=voce@suaempresa.com.br \
  -e ADMIN_PASSWORD='escolha-uma-senha-forte-de-verdade' \
  -e ADMIN_NOME='Sua Equipe' \
  app node server/dist/scripts/createAdmin.js
```

Isso cria a conta e imprime confirmação. Faça login normalmente em
`https://app.suaempresa.com.br/login` com esse e-mail/senha — a role `admin` te leva direto
para o back-office (fila de KYB, disputas, trilha de auditoria, governança de agentes IA,
etc.).

Esse é o único jeito de conseguir uma conta admin em produção: o autocadastro público
(`/auth/register`) nunca permite `role=admin` por design (ver `server/src/routes/auth.ts`).

### E as demais contas de demonstração?

Sacado, cedente, investidor e seguradora *são* auto-cadastráveis normalmente pela tela de
login — não precisam de bootstrap. Se você quiser popular o ambiente com dados de
demonstração realistas para uma demo comercial (e não para uso real), veja
`npm run seed:demo --workspace=server` no README — mas isso é para ambientes de demo, não
para o banco real de clientes.

Se você genuinamente quiser as contas de demo fixas (`*@lastro.demo` / `demo1234`) mesmo
com `NODE_ENV=production` — por exemplo, um ambiente de vendas público que roda a imagem de
produção mas nunca terá dados reais — defina `SEED_DEMO_DATA=true` no `.env` antes do
primeiro boot. Isso é opt-in explícito; sem essa variável, um banco novo em produção nunca
recebe essas contas automaticamente (ver `server/src/db/seed.ts`).

## 7. Backups

O job de backup automático (`server/src/lib/backup.ts`) já roda dentro do container e
grava snapshots do SQLite no volume `lastro-data`. Isso protege contra corrupção do banco,
mas **não** contra a perda do servidor inteiro (disco, VPS deletado, etc.) — para isso,
configure `BACKUP_OFFSITE_CMD` no `.env` com um comando real que copie o backup para fora
do servidor (ex. `aws s3 cp`, `rclone copy`, `rsync` para outra máquina). Sem isso
configurado, os backups existem mas ficam no mesmo disco que os dados originais.

## 8. Atualizando para uma nova versão

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

O Compose recria só o que mudou; `redis` e `caddy` normalmente nem reiniciam. Migrações de
banco (`server/src/db/migrations/`) rodam automaticamente no boot do `app` — não é preciso
nenhum passo manual.

## 9. Coisas que valem revisão antes de tráfego real de dinheiro

Isto não é uma lista de bugs — é honestidade sobre o que este ambiente de desenvolvimento
não consegue validar por conta própria, listado também em mais detalhe na seção "Known
gaps" do `README.md`:

- **`docker build`/`docker compose` não puderam ser executados neste sandbox** (containerização
  aninhada não é suportada aqui) — o `Dockerfile` e os `docker-compose*.yml` foram revisados
  linha por linha manualmente, mas o primeiro `docker compose -f docker-compose.prod.yml up
  -d --build` real, na sua máquina, é a validação de fato. Se algo não buildar, é o próximo
  passo a investigar.
- Integrações que dependem de contrapartes reais (registradora B3/CERC/Núclea/Grafeno,
  bureau de crédito, Pix/TED/boleto via PSP real, assinatura eletrônica, sanções via feed
  pago) rodam em modo simulado honesto até você configurar as credenciais reais — ver
  `server/.env.example` e a seção "Known gaps" do README para o que cada uma precisa.
- Revise `docs/security-review-2026-08.md` e `docs/soc2-gap-assessment.md` antes de
  processar dados financeiros reais de terceiros — cobrem exatamente esse gap entre "app
  funcional" e "pronto para produção regulada".
