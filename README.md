# Lastro — Plataforma de Duplicatas Escriturais

Marketplace/infraestrutura de duplicatas escriturais que conecta **Empresa Cedente** (emite e antecipa recebíveis), **Empresa Sacado** (confirma/contesta dívidas) e **Investidor/Financiador** (bancos, FIDCs, fundos), com registro escritural (CERC/B3/Núclea), score de risco por IA, seguro sobre o recebível e central de compliance com trilha de auditoria.

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
- **Admin / back-office role** — a fourth role (`admin`) with its own screen: a KYB approval queue (approve/reject institutional investors, with a reason on rejection), and dispute arbitration (decide for cedente or sacado). Investors can't bid until their KYB is approved.
- **Live marketplace via WebSocket** — `/ws/market` pushes offer/bid/countdown updates every 2s. Optionally backed by Redis pub/sub (`REDIS_URL`) so the feed fans out correctly if you run more than one API process; a single process works fine without it.
- **Real file uploads** — NF-e attachment (with simulated field extraction) and KYB regulatory documents go through a real `multipart/form-data` endpoint (`multer`), stored on disk and tracked in the `uploads` table.
- **Real notification emails** — `nodemailer`-backed, respecting each user's notification preferences; logs the email instead of sending when `SMTP_HOST` isn't set, so it works out of the box.
- **CSV/PDF export** — `/api/historico/export.csv` and `.../export.pdf` (via `pdfkit`) for Carteira & Histórico.
- **Real subscription billing** — three plans (Básico/Pro/Empresarial) backed by Stripe Checkout, the Stripe customer portal, and signature-verified webhooks (`/api/billing/webhook`). Automação de Lances and Comparador de Taxas require Pro; Desenvolvedores requires Empresarial; a Básico cedente is capped at 5 emissões/mês. Without `STRIPE_SECRET_KEY` set, plan changes are simulated instantly (no real charge) so the whole paywall is demoable out of the box.
- **Validated API** — every mutating endpoint validates its body with Zod and returns structured 400s.
- **AI assistant** — `/api/chat/ask` calls the Anthropic API when `ANTHROPIC_API_KEY` is set, and falls back to canned answers otherwise so the app works out of the box without a key.
- **Structured logging + error tracking** — `pino`/`pino-http` request logging, optional Sentry (`SENTRY_DSN`) with a no-op fallback when unset.
- **Three-tier test suite + CI** — server unit/integration tests (Vitest + Supertest, including simulated-mode billing flows and a real Stripe webhook signature-verification test), client component tests (Vitest + React Testing Library), and Playwright E2E tests covering login, the marketplace buy flow, the full cedente→sacado emitir/aceite lifecycle, and the plan-gating→upgrade→unlock flow. `.github/workflows/ci.yml` runs all of it — typecheck, all three test tiers, and both builds — on every push and PR.
- **Accessibility** — modals trap focus and close on Escape, dropdowns are keyboard-dismissible, form fields use associated `<label>`s (with a correctness fix so an explicitly-`id`'d child still gets the right `htmlFor`), nav uses `aria-current`/`aria-expanded`.
- **Error boundaries + loading skeletons** on every authenticated page.
- **Docker** — a multi-stage `Dockerfile` + `docker-compose.yml` (app + optional Redis) that builds and serves the whole app — client and API — from one container.

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

The demo investidor starts on the **Pro** plan and the demo cedente on **Empresarial**, so every plan-gated feature (Automação de Lances, Comparador de Taxas, Desenvolvedores) is visible right away. A freshly self-registered account starts on **Básico** instead, so the paywall itself is demoable too — visit **Assinatura** in the sidebar to upgrade (instant/simulated without a Stripe key).

You can also register a brand-new account for any of the three self-service roles from the login screen. New investidor accounts start in KYB `pending`/`none` status and can't bid until an admin approves them from the back-office.

Other useful scripts:

```bash
npm run build       # typecheck + build both client and server
npm run typecheck   # typecheck both workspaces
npm run test         # server tests (Vitest + Supertest) + client tests (Vitest + RTL)
npm run test:e2e     # Playwright E2E tests against a production build (client + server)
```

Server-only env vars (all optional — see `server/.env.example`): `JWT_SECRET`, `PORT`, `DB_PATH`, `ANTHROPIC_API_KEY`, `CORS_ORIGINS`, `LOG_LEVEL`, `SENTRY_DSN`, `REDIS_URL`, `SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM`, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_PRO`/`STRIPE_PRICE_EMPRESARIAL`.

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
  pages/app/          the 19 authenticated screens (role-gated), including the admin back-office and Assinatura (billing)
  pages/public/       Developers, Preços, Legal, 404
  state/               session context (JWT-backed auth, refresh-aware)
  lib/                 API client (with token-refresh retry), WebSocket hook, misc utilities
  data/navConfig.ts   sidebar nav + role→tab mapping
client/test/          Vitest + jsdom setup (RTL auto-cleanup, jest-dom matchers)

server/src/
  data/seed.ts        static reference/copy data extracted from the design handoff (sacado risk profiles, compliance copy, revenue model, etc.)
  db/                  SQLite connection, versioned migrations + runner, and query helpers per domain (users, duplicatas, aceites, disputes, audit, refresh tokens, misc)
  auth/                password hashing, JWT sign/verify, requireAuth/requireRole/requirePlan middleware
  routes/              one Express router per feature area, all Zod-validated (including admin.ts and billing.ts)
  lib/                 logger (pino), Sentry, mailer, billing (Stripe + plan catalog), pure formatting/compute helpers
  ws.ts                WebSocket server broadcasting live marketplace state (+ optional Redis relay)
server/scripts/        build-time helpers (copies .sql migrations into dist/)
server/test/          Vitest + Supertest integration/unit tests

e2e/
  playwright.config.ts builds + boots the app in production mode and runs tests against it
  tests/                login, marketplace buy flow, cross-account emitir→aceite flow, plan-gating→upgrade→unlock flow
```

## Roles

Role is chosen once at registration (or via a demo account) and is fixed to that account/company:

- **Investidor/Financiador** — Dashboard, Marketplace, Automação de Lances (Pro+), Análise de Risco, Carteira & Histórico, Comparador de Taxas (Pro+), Compliance, Conta & Liquidação, Modelo de Receita, Assinatura, Disputas, Perfil
- **Empresa (cedente)** — Dashboard, Integrações ERP, Emitir Duplicata (5/mês no Básico), Minhas Duplicatas, Aceite do Sacado (read-only), Análise de Risco, Carteira & Histórico, Compliance, Desenvolvedores (Empresarial), Conta & Liquidação, Modelo de Receita, Assinatura, Disputas, Perfil
- **Empresa (sacado)** — Dashboard, Portal do Sacado (confirmar/contestar), Carteira & Histórico, Conta & Liquidação, Disputas, Perfil
- **Admin (back-office)** — fila de aprovação de KYB, arbitragem de disputas, trilha de auditoria; não é uma role auto-cadastrável (só existe via seed/criação direta).

A new investidor account is routed through a 3-step KYB (institutional credentialing) modal, including a real document upload, before entering the platform; submitting it puts the account in `pending` status (visible in the platform in read-only "modo consulta" per the design copy) until an admin approves or rejects it from the back-office. A sacado can only see and act on duplicatas whose `sacado_nome` matches their own company name — the cedente sees the same aceites read-only, since only the actual sacado can legally confirm or contest a debt.

## Design reference

The original design handoff (`.dc.html` files, not part of this app) documents the full design system (colors, typography, spacing) and behavior spec for all 21 in-app screens plus the public marketing pages. This app reimplements that spec in React/Tailwind rather than porting the proprietary template markup, and extends it with the real backend/auth/tests/CI/realtime/upload/AI layers described above, plus the security/infra/admin/observability layer added in this pass.

## Known gaps / things a real deployment would still need

These require external commercial contracts or infrastructure this environment can't provide, so they're deliberately left as clearly-marked simulations rather than half-built integrations:

- **Real CERC/B3/Núclea registry integration** — `emitir`'s registro number and the "duplicidade" check are simulated; a production deployment would call the real registries' APIs.
- **Real credit bureau score** — the risk score is a deterministic simulation based on seeded sacado profiles, not a live Serasa/Boa Vista query (that requires a commercial data-sharing agreement).
- **Real payment rails** — settlement (`conta`/liquidação) is simulated; real Pix/TED transfers would need a banking-as-a-service partner integration.
