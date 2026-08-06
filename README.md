# Lastro — Plataforma de Duplicatas Escriturais

Marketplace/infraestrutura de duplicatas escriturais que conecta **Empresa Cedente** (emite e antecipa recebíveis), **Empresa Sacado** (confirma/contesta dívidas), **Investidor/Financiador** (bancos, FIDCs, fundos, securitizadoras, factorings) e **Seguradora parceira** (apólices e sinistros) numa única infraestrutura — com registro escritural (CERC/B3/Núclea), score de risco por IA, seguro sobre o recebível, central de compliance com trilha de auditoria, e uma API pública versionada (`/api/v1`) para integrações de parceiros.

This repo is a full-stack recreation of the original high-fidelity HTML/JS design handoff (`design_handoff_lastro/`), rebuilt as a real, multi-tenant React + TypeScript SPA backed by an Express + SQLite API — with production-grade security, observability, an admin back-office, and a three-tier test suite (unit, component, E2E).

## Stack

- **client/** — React 18 + TypeScript + Vite + React Router + Tailwind CSS
- **server/** — Express + TypeScript + SQLite (better-sqlite3), JWT auth with refresh-token rotation, Zod validation, a WebSocket feed for live auction updates, and a Vitest/Supertest test suite
- **e2e/** — Playwright end-to-end tests running against a production build of the whole app

The client talks to the server exclusively over `/api/*` (proxied by Vite in dev, same-origin in production) plus a `/ws/market` WebSocket for live marketplace updates. There is no client-only mocked state — every action (register, buy an offer, emit a duplicata, resolve a dispute, toggle automation…) is a real HTTP round-trip against a real database, scoped to the authenticated account.

### Highlights

- **Real multi-tenant auth** — bcrypt-hashed passwords, short-lived (15min) JWT access tokens with rotating, single-use refresh tokens (`/api/auth/refresh`), self-service registration per role (investidor/cedente/sacado). Four demo accounts are seeded on first boot (see below).
- **SQLite persistence with versioned migrations** — `server/src/db/migrations/*.sql` + a `schema_migrations` table applied on boot (`npm run db:migrate` also runs them standalone); no more ad-hoc `CREATE TABLE IF NOT EXISTS`.
- **Security hardening** — `helmet`, a CORS allowlist scoped to `/api` (`CORS_ORIGINS`), rate limiting on login/register, and a tamper-evident **audit log** (`audit_log` table, SHA-256 hash chain — each event's hash covers the previous one, so any edited/deleted row breaks the chain from that point forward; verified via `/api/admin/audit`).
- **Admin / back-office role** — a fourth role (`admin`) with its own screen: a KYB approval queue (approve/reject institutional investors, with a reason on rejection), dispute arbitration (decide for cedente or sacado), and a Fila de Compliance (duplicatas the Compliance AI Engine suspended for review — see "Claude-assisted features" below). Investors can't bid until their KYB is approved.
- **Live marketplace via WebSocket** — `/ws/market` pushes offer/bid/countdown updates every 2s. Optionally backed by Redis pub/sub (`REDIS_URL`) so the feed fans out correctly if you run more than one API process; a single process works fine without it.
- **Real file uploads** — NF-e attachment (with real Claude-based field extraction — see "Claude-assisted features" below), contract analysis, and KYB regulatory documents go through a real `multipart/form-data` endpoint (`multer`), stored on disk and tracked in the `uploads` table.
- **Real notification emails** — `nodemailer`-backed, respecting each user's notification preferences; logs the email instead of sending when `SMTP_HOST` isn't set, so it works out of the box.
- **CSV/PDF export** — `/api/historico/export.csv` and `.../export.pdf` (via `pdfkit`) for Carteira & Histórico.
- **Real transactional platform fee** (`lib/settlement.ts`) — the tiered take rate shown in the Emitir preview (0,35% up to R$200k, 0,30% up to R$1M, 0,25% above that) is the *same function* actually applied at liquidação: every marketplace/cesta purchase debits the investor's ledger for the full amount and credits the cedente's ledger net of the fee; every mercado secundário resale does the same between the two investors. Real revenue collected to date is shown live in Modelo de Receita (`/app/receita`), computed from every settled purchase — distinct from the illustrative 12-stream revenue mix chart on the same page, which is still a static projected roadmap.
- **Real insurance commission** — contracting insurance on a position (`POST /api/market/:id/insure`, investidor-only) now actually charges the insurer's real premium (INSURERS.premioPct — 0,55%/0,60%/0,68% depending on the seguradora) to the investor's ledger, and pays the registered seguradora account net of Lastro's 18% distribution commission (`INSURANCE_COMMISSION_PCT` in `lib/settlement.ts`). Every settlement is logged to `insurance_settlements` for exact, auditable revenue reporting on Modelo de Receita — switching to a different insurer charges again, but resubmitting the same one or removing insurance doesn't charge or refund (a deliberate simplification, not a proration engine).
- **Real subscription billing** — three plans (Básico/Pro/Empresarial) backed by Stripe Checkout, the Stripe customer portal, and signature-verified webhooks (`/api/billing/webhook`). Automação de Lances and Comparador de Taxas require Pro; live API keys and webhooks require Empresarial (sandbox keys are free on any plan — see Partner API maturity below); a Básico cedente is capped at 5 emissões/mês (+1 per successful referral — see Growth below). Without `STRIPE_SECRET_KEY` set, plan changes are simulated instantly (no real charge) so the whole paywall is demoable out of the box.
- **Seguradora role** — a fifth account type for insurance partners (linked to one of the three seeded insurers). Its dashboard lists every duplicata it's underwritten (with premium totals) and surfaces **sinistros**: duplicatas that went overdue unsold, which the seguradora approves (indenizes the cedente) or denies, all logged to the audit trail.
- **Public partner API (`/api/v1`)** — a versioned, API-key-authenticated surface distinct from the internal SPA API, covering every role that needs to integrate programmatically:
  - Cedente: `POST /duplicatas` (emitir), `GET /duplicatas/:id`.
  - Marketplace: `GET /marketplace`.
  - Sacado: `GET /aceites`, `POST /aceites/:id/status` (confirmar/contestar) — same ownership rules as the SPA's Portal do Sacado.
  - Seguradora: `GET /seguradora` (apólices + sinistros), `POST /seguradora/sinistro/:duplicataId/decidir` — same claims workflow as the Painel da Seguradora.
  - Score: `GET /sacados/:cnpj/score` — real-time credit score/rating lookup by CNPJ, for partners deciding whether to buy a receivable before it's listed.

  Each of these shares its business logic (validation, side effects, notifications, audit logging) with the corresponding internal SPA route via a `lib/*Core.ts` module, so the public API and the app are never allowed to drift out of sync. Keys are generated/revoked from the Desenvolvedores screen (shown once, stored only as a SHA-256 hash), rate-limited per key (`API_RATE_LIMIT_PER_MIN`, default 60/min), and CORS-open (unlike the SPA's strict origin allowlist) since partners call it from their own domains.
- **Partner API maturity** — the kind of things a real integration actually needs, not just the endpoints:
  - **OpenAPI spec** — `GET /api/v1/openapi.json` (public, unauthenticated) documents every partner endpoint; linked from the Desenvolvedores screen so partners can point Swagger/Postman/codegen at it directly.
  - **Sandbox key mode** — keys are generated as `lastro_live_…` or `lastro_test_…` (chosen at generation time); emissions made with a test-mode key are tagged `"mode": "test"` in the response so a partner's integration tests can assert they're not touching production.
  - **Key scopes** — `read_only` vs `read_write` at generation time; a `read_only` key can call every `GET` but is 403'd on every mutating endpoint (`requireWriteScope`), so a partner can hand out a reporting-only key without risking a stray write.
  - **Idempotency-Key** — any mutating `/api/v1` endpoint (`POST /duplicatas`, `POST /aceites/:id/status`, `POST /seguradora/sinistro/:id/decidir`) accepts an `Idempotency-Key` header; replaying the same key + body returns the original response instead of double-emitting/double-deciding, and replaying it with a different body is a `409`. Same contract Stripe uses.
  - **Usage metering** — every authenticated call increments a per-key monthly counter (`api_key_usage`), surfaced per key in Desenvolvedores — the foundation for usage-based billing down the line.
- **Real webhook delivery with retry + delivery log** — partners register a URL + event (`duplicata.registrada`, `pagamento.confirmado`, …) from Desenvolvedores; the server does a genuine signed HTTP POST (HMAC-SHA256 over the body, `X-Lastro-Signature` header) when the event fires — same signing pattern Stripe uses for its own webhooks. Every attempt is logged to `webhook_deliveries` (visible per-webhook in Desenvolvedores as "Ver entregas"); a failed attempt is retried with backoff (immediate / 30s / 5min / 30min in production) before being marked permanently failed.
- **LGPD data rights** — Perfil has an "Exportar meus dados" button (`GET /api/account/export`, a full JSON dump: profile, settings, duplicatas/aceites the account is a party to, notifications, ledger, API key/webhook metadata) and an "Excluir minha conta" flow (`POST /api/account/delete`, password-confirmed) that scrubs personal identifiers, revokes every refresh token/API key/webhook, and anonymizes the account row — financial/audit records tied to it stay intact (anonymized) rather than being deleted outright, since removing them would corrupt other parties' records.
- **Growth** — liquidity and distribution features, not just the core marketplace:
  - **Mercado Secundário** (`/app/secundario`, investidor-only) — resell a purchased duplicata before vencimento; another investor buys it at the agreed price, closing out the seller's position (kept in history) and opening a fresh one for the buyer. `POST /api/secundario/listar`, `GET /api/secundario`, `POST /api/secundario/:id/comprar`.
  - **Cestas de Investimento** (`/app/cestas`) — one-shot "invest R$X" flow: pick Conservadora (AA/A), Diversificada (all ratings) or Agressiva (B/C), and the platform greedily buys whole matching offers (best score first) until the budget runs out. `POST /api/cestas/investir`.
  - **Programa de indicação** — every account gets a unique referral code/link (Perfil); a referred signup grants the referrer +1 monthly emissão on the Básico plan, immediately. `GET /api/referral`.
  - **Página de transparência** (`/transparencia`, public) — live-computed platform stats (volume emitido/financiado, taxa de inadimplência, tempo médio até liquidação) straight from the database, not marketing copy. `GET /api/public/stats`.
  - **Status page** (`/status`, public) — a real background self-check (`src/lib/healthMonitor.ts`) pings the database every ~60s and logs the result to `system_health_checks`, so uptime/history are genuine, not a static badge. `GET /api/public/status`.
  - **Embeddable widget** — a chrome-less `/embed/simulador` page (iframe-able on a partner's own site) computing a real antecipação rate estimate via the same model as Emitir Duplicata, no auth or API key required. Snippet shown in Desenvolvedores. `POST /api/public/simular`.
- **Fighting market fragmentation** — the Brazilian duplicata-escritural market has 4 BACEN-authorized registradoras and every platform's risk data lives siloed to itself. Two features attack that directly:
  - **Multi-registradora smart routing** (`lib/registradoras.ts`) — a real router picks the cheapest registradora (B3/CERC/Núclea/Grafeno) for each emission, falling back to a more reliable-but-pricier one above R$200k where a failed/slow registration is costlier to redo. The chosen registradora is stored per duplicata and surfaced in the emit confirmation, `GET /api/v1/duplicatas/:id`, and a breakdown on the transparency page — instead of every integration hardcoding a single registry.
  - **Shared network risk-score** (`lib/riscoCore.ts` + `sacado_network_signals` table) — the real fragmentation fix for credit data: `GET /api/v1/sacados/:cnpj/score` blends Lastro's own SACADOS history with signals partners report via `POST /api/v1/sacados/:cnpj/sinais` (pagamento pontual / atraso / protesto / contestação), weighted by how much network evidence exists. A CNPJ that has *never* transacted on Lastro directly can still get a real (if low-confidence) score purely from what partners have reported about it. Real aceite outcomes on Lastro itself auto-seed the same pool, so the network isn't only as good as external contributions — it starts warm from Lastro's own activity. The internal Análise de Risco screen benefits from the same blend, not just the public API.
- **Validated API** — every mutating endpoint validates its body with Zod and returns structured 400s.
- **AI assistant** — `/api/chat/ask` calls the Anthropic API when `ANTHROPIC_API_KEY` is set, and falls back to canned answers otherwise so the app works out of the box without a key.
- **Structured logging + error tracking** — `pino`/`pino-http` request logging, optional Sentry (`SENTRY_DSN`) with a no-op fallback when unset.
- **Three-tier test suite + CI** — server unit/integration tests (Vitest + Supertest, including simulated-mode billing flows and a real Stripe webhook signature-verification test), client component tests (Vitest + React Testing Library), and Playwright E2E tests covering login, the marketplace buy flow, the full cedente→sacado emitir/aceite lifecycle, and the plan-gating→upgrade→unlock flow. `.github/workflows/ci.yml` runs all of it — typecheck, all three test tiers, and both builds — on every push and PR.
- **Accessibility** — modals trap focus and close on Escape, dropdowns are keyboard-dismissible, form fields use associated `<label>`s (with a correctness fix so an explicitly-`id`'d child still gets the right `htmlFor`), nav uses `aria-current`/`aria-expanded`.
- **Error boundaries + loading skeletons** on every authenticated page.
- **Docker** — a multi-stage `Dockerfile` + `docker-compose.yml` (app + optional Redis) that builds and serves the whole app — client and API — from one container.

### Real-when-configured integrations (revenue/growth pass)

A follow-up pass closed the gap between "demo" and "real business" wherever that's actually buildable in software, following the same pattern already established for Stripe/SMTP/Anthropic: real HTTP calls to the real provider when credentials are configured, a clearly-logged simulated fallback when not — never a silent no-op pretending to be real. See `server/.env.example` for every variable.

- **Automação de Lances is now real** — it used to draw from a static demo array and roll dice on whether to "apply." It now evaluates the investor's actual configured rules (score mínimo, taxa máxima, exposição por sacado, exposição mensal, diversificação por rating/setor) against the real open marketplace and, when an offer passes, performs the exact same purchase a manual "Comprar" click would (`lib/settlement.ts`). This was the single most urgent fix: it's a paid Pro-plan feature that previously did nothing real.
- **Real Pix payment rail** (`lib/paymentRail.ts`, `PIX_PSP_*`) — implements the actual BACEN "API Pix" contract (cobrança imediata, webhook confirmation) plus a payout call. Conta & Liquidação's deposit/withdraw flow replaces the old hardcoded fake bank-account string with a real Pix key on file, a real cobrança/QR code, and a real webhook (`POST /api/public/pix-webhook`) that credits the ledger on payment. Without a PSP configured, deposits need a manual "Confirmar (simulado)" click instead of a webhook — same idea as Stripe's simulated plan changes.
- **Real registradora integration** (`lib/registradoras.ts`, `REGISTRADORA_<CERC|B3|NUCLEA|GRAFENO>_API_URL/KEY`) — registration and duplicidade-check calls hit the actual configured registradora instead of only generating a local registro number. Unlike Pix (a public BACEN standard), each registradora's real API is a private commercial contract, so this is a reasonable generic REST shape meant to be adjusted once you have real API docs from them — not a verified copy of any one registradora's contract.
- **Real PLD/sanctions screening** (`lib/sanctionsFeed.ts`) — two additions ahead of the fictitious demo watchlist: `SANCTIONS_LIVE_FEED=true` screens KYB submissions against OFAC's real, free, public SDN list (no commercial account needed, off by default only to keep local dev/CI fast); `PLD_PROVIDER_API_URL/KEY` plugs in a licensed commercial PLD/KYC provider (Serasa Compliance, Quod, etc.) ahead of both, for real production compliance.
- **Real credit bureau blend** (`lib/creditBureau.ts`, `BUREAU_API_URL/KEY`) — Análise de Risco and the public score endpoint blend in a real external bureau score (Serasa/Boa Vista/Quod) on top of the existing internal + network-signal score, when configured.
- **Real Omie ERP connector** (`lib/erpConnectors/omie.ts`) — unlike the other adapters above, this doesn't need a Lastro-side commercial contract: any cedente with their own Omie account can enter their real `app_key`/`app_secret` in Integrações ERP, which validates against Omie's actual API and can then pull real contas a receber to prefill Emitir Duplicata. SAP/TOTVS stay as clearly-labeled "em breve" placeholders (no equivalent free self-serve API for either).
- **Real WhatsApp/SMS via Twilio** (`lib/smsNotifier.ts`, `TWILIO_*`) — an opt-in channel (Perfil) alongside email for every existing notification event, plus a new background job (`lib/aceiteReminder.ts`) that sends one urgent WhatsApp reminder when a sacado is down to 2 days left on the 15-day aceite window — the single biggest legal/UX risk in the flow, and a window email alone is a weak channel for.

### Claude-assisted features (beyond the chat widget)

Before this pass, Claude (`ANTHROPIC_API_KEY`) only powered the chat widget (`routes/chat.ts`) — everywhere else the product "looked like AI" it was static copy. `lib/claude.ts` is now a shared client every feature below reuses (text + vision/document calls); every one of them recommends or assists rather than deciding autonomously wherever the decision has real financial/legal weight — the human (cedente, admin, seguradora) still makes the actual call, same as the admin already did for KYB/disputes before this pass.

- **Compliance AI Engine** (`lib/complianceEngine.ts`) — the signals below (duplicidade, PLD, valor anômalo, score do sacado) used to live on separate screens with no unified decision. Now every emission gets a single 0–100 compliance score, computed by a **deterministic, auditable formula** over those same real signals — never an LLM free-floating number, precisely so the score stays reproducible with or without an API key. Claude's only role is generating the human-readable `reasoning` a reviewer sees (`compliance_engine_results.reasoning`); it never changes the score or the decision. A score ≥ `SUSPEND_THRESHOLD` (80) sets the duplicata to `status='suspensa_compliance'` — held out of `aprovada`/the marketplace — and routes it to a new **Fila de Compliance** in the back-office (`GET/POST /admin/compliance-queue`) where an admin liberates or rejeita it. This is always a suspend-for-review, **never an automatic permanent block** — same human-in-the-loop principle as every feature below, just with a real routing/blocking mechanism behind it instead of only a recommendation.
- **Real NF-e field extraction** (`lib/nfeExtraction.ts`) — replaces the old hardcoded fake extraction (`kind: 'nfe'` uploads always returned the same sample sacado/CNPJ/valor regardless of the file) with a real read of the uploaded NF-e: Claude vision for PDF/PNG/JPEG, direct XML parsing for XML (more reliable than vision for structured markup). Returns `null` — not a fabricated guess — when extraction fails, so Emitir Duplicata falls back to manual entry exactly like before.
- **Real contract clause analysis** (`lib/contractAnalysis.ts`) — Compliance's "Leitura de contratos" card (previously always the same 3 fixed demo lines, labeled "Simulado" in the UI) now analyzes a real uploaded contrato de cessão (`kind: 'contrato_cessao'` upload) for clauses incompatible with a duplicata escritural sale — vedação à cessão, exclusividade, confidencialidade que impeça registro. Persisted per user (`contract_analyses` table) so the real analysis reappears on reload; the "Simulado" badge only shows before the first real upload.
- **Real AI risk narrative** (`riscoCore.ts`'s `applyAiNarrative`) — the "sinais de IA" card in Análise de Risco (previously 3 fixed lines per stage 1/2/3, identical for every sacado at that stage) is now a real Claude synthesis of *that specific sacado's* actual score, rating, factors, network signals and bureau data. Falls back to the original canned text — not a fabricated narrative — when unavailable.
- **Dispute arbitration copilot** (`lib/disputeCopilot.ts`, `GET /admin/disputes/:id/ai-summary`) — on-demand (button click, not eager) summary + suggested verdict (cedente/sacado/inconclusivo) with reasoning, computed from the dispute's actual motivo + message timeline. The admin still calls `POST /admin/disputes/:id/resolve` themselves — this never decides on its own.
- **Sinistro triage copilot** (`lib/sinistroCopilot.ts`, `GET /seguradora/sinistro/:duplicataId/ai-triagem`) — flags real inconsistencies (aceite still pending, an unresolved dispute, days-overdue) for the seguradora to review before approving/denying a claim — same on-demand, human-decides pattern.
- **PLD second opinion on ambiguous matches** (`lib/pldSecondOpinion.ts`) — every PLD source that matches by plain substring (OFAC live feed, the demo watchlist) risks false positives (a shared surname, a generic word). Before such a match becomes an actual KYB flag, Claude judges whether the queried name and the matched entry plausibly refer to the same real entity. Only ever narrows a match to "not flagged" — never widens or invents one — and defaults to keeping the original match standing when Claude is unavailable or errors, so nothing about PLD screening gets weaker without a key configured. A paid PLD provider's own match (not a substring match Lastro computed) is never second-guessed this way — that's already an authoritative external decision.

## Running locally

```bash
npm install
npm run dev
```

This starts the API on `http://localhost:4000` and the SPA on `http://localhost:5173` (Vite proxies `/api` and `/ws` to the server).

On first boot the server seeds four demo accounts (password `demo1234` for all):

| Role | Email | Company |
|---|---|---|
| Investidor | `investidor@lastro.demo` | Kayrós Capital |
| Cedente | `cedente@lastro.demo` | Fornecedor Lima Ltda |
| Sacado | `sacado@lastro.demo` | Grupo Atlas Varejo |
| Admin (back-office) | `admin@lastro.demo` | Lastro (plataforma) |
| Seguradora | `seguradora@lastro.demo` | Too Seguros |

The demo investidor starts on the **Pro** plan and the demo cedente on **Empresarial**, so every plan-gated feature (Automação de Lances, Comparador de Taxas, Desenvolvedores) is visible right away. A freshly self-registered account starts on **Básico** instead, so the paywall itself is demoable too — visit **Assinatura** in the sidebar to upgrade (instant/simulated without a Stripe key).

You can also register a brand-new account for any of the four self-service roles (investidor/cedente/sacado/seguradora) from the login screen — seguradora registration also asks which of the three seeded insurers the account represents. New investidor accounts start in KYB `pending`/`none` status and can't bid until an admin approves them from the back-office.

### Investor-demo data (optional)

The base seed above is intentionally minimal (a handful of accounts and offers) so it stays fast and predictable for tests. For live demos or an investor walkthrough, where an empty-looking Transparência/Receita/Dashboard undersells the platform, run:

```bash
npm run seed:demo --workspace=server
```

This populates several months of realistic, backdated history — dozens of cedente/investidor accounts, ~60 duplicatas moving through the full lifecycle (registro em registradora real, leilão, aceite/contestação, compra, seguro, revenda no mercado secundário), network risk-signals on CNPJs that never transacted directly, and Desenvolvedores activity (API keys, usage, webhooks, logs) — all computed through the same settlement/fee/commission logic real activity uses, so every number that shows up in the UI (volume emitido, taxas, comissão de seguro) is genuine, not hardcoded. It never runs automatically (only `npm run dev`'s base seed does) and is safe to re-run — it no-ops if it already seeded once against the current `DB_PATH`. New accounts use password `demo1234`, same as the base seed.

Other useful scripts:

```bash
npm run build       # typecheck + build both client and server
npm run typecheck   # typecheck both workspaces
npm run test         # server tests (Vitest + Supertest) + client tests (Vitest + RTL)
npm run test:e2e     # Playwright E2E tests against a production build (client + server)
```

Server-only env vars (all optional — see `server/.env.example`): `JWT_SECRET`, `PORT`, `DB_PATH`, `ANTHROPIC_API_KEY`, `CORS_ORIGINS`, `LOG_LEVEL`, `SENTRY_DSN`, `REDIS_URL`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_PRO`/`STRIPE_PRICE_EMPRESARIAL`, `API_RATE_LIMIT_PER_MIN`.

## Running with Docker

```bash
docker compose up --build
```

Builds the client and server, then serves everything (API + static SPA + SPA fallback routing) from a single container on `http://localhost:4000`. Data and uploads persist in named volumes across restarts. Redis is included for the optional WebSocket relay but isn't required for a single instance.

## Structure

```
client/src/
  components/        design-system primitives (Button, Card, Badge, Modal, Gauge, Toggle, Skeleton, ErrorBoundary…) + their component tests
  layout/             app shell: Sidebar, NotificationBell, AiChat, AppShell
  pages/auth/         login/register, KYB modal, onboarding tour
  pages/app/          the 20+ authenticated screens (role-gated), including the admin back-office, Assinatura (billing), the Seguradora dashboard, Mercado Secundário and Cestas de Investimento
  pages/public/       Developers, Preços, Legal, Transparência, Status, the embeddable /embed/simulador widget, 404
  state/               session context (JWT-backed auth, refresh-aware)
  lib/                 API client (with token-refresh retry), WebSocket hook, misc utilities
  data/navConfig.ts   sidebar nav + role→tab mapping
client/test/          Vitest + jsdom setup (RTL auto-cleanup, jest-dom matchers)

server/src/
  data/seed.ts        static reference/copy data extracted from the design handoff (sacado risk profiles, compliance copy, revenue model, etc.)
  db/                  SQLite connection, versioned migrations + runner, and query helpers per domain (users, duplicatas, aceites, disputes, audit, refresh tokens, api keys, webhooks, misc)
  auth/                password hashing, JWT sign/verify, requireAuth/requireRole/requirePlan middleware, requireApiKey + per-key rate limiter
  routes/              one Express router per feature area, all Zod-validated (including admin.ts, billing.ts, seguradora.ts, and v1.ts — the public partner API)
  lib/                 logger (pino), Sentry, mailer, billing (Stripe + plan catalog), webhookDelivery, idempotency, healthMonitor, publicStatsCore, cestasCore, resaleCore, pure formatting/compute helpers, and the shared *Core modules (emitirCore, aceiteCore, seguradoraCore, riscoCore) reused by both the SPA routes and the public partner API
  ws.ts                WebSocket server broadcasting live marketplace state (+ optional Redis relay)
server/scripts/        build-time helpers (copies .sql migrations into dist/)
server/test/          Vitest + Supertest integration/unit tests

e2e/
  playwright.config.ts builds + boots the app in production mode and runs tests against it
  tests/                login, marketplace buy flow, cross-account emitir→aceite flow, plan-gating→upgrade→unlock flow, seguradora sinistro flow
```

## Roles

Role is chosen once at registration (or via a demo account) and is fixed to that account/company:

- **Investidor/Financiador** — Dashboard, Marketplace, Automação de Lances (Pro+), Análise de Risco, Carteira & Histórico, Comparador de Taxas (Pro+), Compliance, Conta & Liquidação, Modelo de Receita, Assinatura, Disputas, Perfil
- **Empresa (cedente)** — Dashboard, Integrações ERP, Emitir Duplicata (5/mês no Básico), Minhas Duplicatas, Aceite do Sacado (read-only), Análise de Risco, Carteira & Histórico, Compliance, Desenvolvedores (Empresarial), Conta & Liquidação, Modelo de Receita, Assinatura, Disputas, Perfil
- **Empresa (sacado)** — Dashboard, Portal do Sacado (confirmar/contestar), Carteira & Histórico, Conta & Liquidação, Disputas, Perfil
- **Admin (back-office)** — fila de aprovação de KYB, arbitragem de disputas, trilha de auditoria; não é uma role auto-cadastrável (só existe via seed/criação direta).
- **Seguradora parceira** — Painel da Seguradora (apólices e sinistros), Perfil. Auto-cadastrável, escolhendo qual das três seguradoras parceiras a conta representa.

A new investidor account is routed through a 3-step KYB (institutional credentialing) modal, including a real document upload, before entering the platform; submitting it puts the account in `pending` status (visible in the platform in read-only "modo consulta" per the design copy) until an admin approves or rejects it from the back-office. A sacado can only see and act on duplicatas whose `sacado_nome` matches their own company name — the cedente sees the same aceites read-only, since only the actual sacado can legally confirm or contest a debt.

## Design reference

The original design handoff (`.dc.html` files, not part of this app) documents the full design system (colors, typography, spacing) and behavior spec for all 21 in-app screens plus the public marketing pages. This app reimplements that spec in React/Tailwind rather than porting the proprietary template markup, and extends it with the real backend/auth/tests/CI/realtime/upload/AI layers described above, plus the security/infra/admin/observability layer added in this pass.

## Known gaps / things a real deployment would still need

These require external commercial contracts or infrastructure this environment can't provide, so they're deliberately left as clearly-marked simulations rather than half-built integrations:

- **CERC/B3/Núclea/Grafeno registry integration is real-when-configured, not verified against their actual contracts** — `lib/registradoras.ts` makes a real HTTP call per the shape described above when `REGISTRADORA_*_API_URL/KEY` is set (falling back to a locally-generated registro number otherwise), and `POST /compliance/dup-check` additionally queries the configured registradora's own duplicidade-check endpoint per match. What's still missing is a *verified* copy of any one registradora's real private API contract — get that from an actual integration agreement and this adapter is the place to adjust it.
- **Real credit bureau score is real-when-configured** — `lib/creditBureau.ts` blends in a live Serasa/Boa Vista/Quod score when `BUREAU_API_URL/KEY` is set; without it, the risk score stays internal + network-signal only (no bureau data blended in).
- **Real payment rails are real-when-configured** — `lib/paymentRail.ts` implements BACEN's actual Pix API contract; you still need a real PSP contract (`PIX_PSP_*`) for money to actually move. TED and boleto rails aren't implemented (Pix is the dominant instant-transfer rail in Brazil and was prioritized).
- **PLD/FT (AML) screening is real-when-configured, and only partially covers Brazilian compliance sources even then** — `SANCTIONS_LIVE_FEED=true` checks the real, free OFAC SDN list; `PLD_PROVIDER_API_URL/KEY` plugs in a paid provider ahead of it. Neither is a live COAF/CVM feed specifically, and the fictitious `sanctions_watchlist_demo` table is still the final fallback when neither is configured. There's also no automated suspicious-transaction monitoring beyond the emission-time value-anomaly and NF-e-reuse alerts already computed in `lib/fraudDetection.ts`, and no COAF reporting channel.
- **ERP integration is real for Omie only** — `lib/erpConnectors/omie.ts` is a genuine, immediately-usable integration (any cedente's own Omie account works, no Lastro-side contract needed) that validates credentials and pulls real contas a receber. SAP and TOTVS are still toggle-only placeholders, clearly labeled "em breve" — neither has an equivalent free self-serve API to build the same way against.
- **WhatsApp/SMS is real-when-configured** — `lib/smsNotifier.ts` sends via Twilio's real API when `TWILIO_*` is set (opt-in per user in Perfil); unconfigured, messages are logged instead of sent, same as email without `SMTP_HOST`.
- **Contract-reading AI is now real, when `ANTHROPIC_API_KEY` is set** — see "Claude-assisted features" above (`lib/contractAnalysis.ts`). Unconfigured, it still falls back to the original static sample copy, clearly marked "Simulado" in the UI.
- **Registradoras (CERC/B3/Núclea) are not a login role** — that's a deliberate design choice, not a gap: registries are infrastructure Lastro integrates *with*, not accounts that log into Lastro. Banks/FIDCs/securitizadoras/factorings are represented as sub-types of the `investidor` role (the `tipo de instituição` field on KYB) rather than as separate roles, since they all use the exact same buy/fund workflow — only seguradora warranted its own role, because its dashboard and actions (apólices, sinistros) are genuinely different from every other role's.
- **Sandbox (`lastro_test_…`) keys don't have a fully isolated data plane** — a test-mode key still reads/writes the same account data as a live key (it's the partner's own sandbox data either way), it's just clearly labeled and tagged in emit responses. A production-grade sandbox would give test-mode keys their own seeded, isolated dataset.
- **No 2FA, no multi-seat accounts, and SQLite as the datastore** — one login per company/account (no team seats with separate logins yet — Perfil's "Equipe" invites are read-only display, not real logins), no second factor even for institutional accounts, and SQLite works well for this scale but would need a move to Postgres for real multi-instance horizontal scaling. These are larger architectural changes intentionally scoped out of this pass rather than bolted on partially.
- **No enterprise SSO/SAML** — deliberately not built. Unlike everything else in this list, it can't be honestly built in simulated form: SAML requires a real identity provider (Okta, Azure AD…) to exchange metadata and certificates with, and there's no such provider available here to integrate against or test. A consumer-style "Sign in with Google" OAuth flow would be feasible following the same optional-env-var-with-simulated-fallback pattern used for Stripe/Anthropic elsewhere in this codebase, but full enterprise SAML is a different, larger scope than the rest of this pass.
