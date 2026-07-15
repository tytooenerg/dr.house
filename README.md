# Lastro — Plataforma de Duplicatas Escriturais

Marketplace/infraestrutura de duplicatas escriturais que conecta **Empresa Cedente** (emite e antecipa recebíveis), **Empresa Sacado** (confirma/contesta dívidas) e **Investidor/Financiador** (bancos, FIDCs, fundos), com registro escritural (CERC/B3/Núclea), score de risco por IA, seguro sobre o recebível e central de compliance com trilha de auditoria.

This repo is a full-stack recreation of the original high-fidelity HTML/JS design handoff (`design_handoff_lastro/`), rebuilt as a real, multi-tenant React + TypeScript SPA backed by an Express + SQLite API.

## Stack

- **client/** — React 18 + TypeScript + Vite + React Router + Tailwind CSS
- **server/** — Express + TypeScript + SQLite (better-sqlite3), JWT auth, Zod validation, a WebSocket feed for live auction updates, and a Vitest/Supertest test suite

The client talks to the server exclusively over `/api/*` (proxied by Vite in dev) plus a `/ws/market` WebSocket for live marketplace updates. There is no client-only mocked state — every action (register, buy an offer, emit a duplicata, resolve a dispute, toggle automation…) is a real HTTP round-trip against a real database, scoped to the authenticated account.

### Highlights

- **Real multi-tenant auth** — bcrypt-hashed passwords, JWT sessions, self-service registration per role (investidor/cedente/sacado). Three demo accounts are seeded on first boot (see below).
- **SQLite persistence** — users, duplicatas, purchases, aceites, disputes (+ timeline), notifications, team members, ledger and uploads are real tables; data survives restarts.
- **Live marketplace via WebSocket** — `/ws/market` pushes offer/bid/countdown updates every 2s to all connected clients instead of client-side polling.
- **Real file uploads** — NF-e attachment (with simulated field extraction) and KYB regulatory documents go through a real `multipart/form-data` endpoint (`multer`), stored on disk and tracked in the `uploads` table.
- **Validated API** — every mutating endpoint validates its body with Zod and returns structured 400s.
- **AI assistant** — `/api/chat/ask` calls the Anthropic API when `ANTHROPIC_API_KEY` is set, and falls back to canned answers otherwise so the app works out of the box without a key.
- **Tests + CI** — `server/test/*` covers auth, validation, the emitir→aceite→disputa lifecycle, and marketplace purchase flow end-to-end via Supertest; `.github/workflows/ci.yml` runs typecheck/tests/build on every push and PR.
- **Accessibility** — modals trap focus and close on Escape, dropdowns are keyboard-dismissible, form fields use associated `<label>`s, nav uses `aria-current`/`aria-expanded`.
- **Error boundaries + loading skeletons** on every authenticated page.

## Running locally

```bash
npm install
npm run dev
```

This starts the API on `http://localhost:4000` and the SPA on `http://localhost:5173` (Vite proxies `/api` and `/ws` to the server).

On first boot the server seeds three demo accounts (password `demo1234` for all):

| Role | Email | Company |
|---|---|---|
| Investidor | `investidor@lastro.demo` | Kayrós Capital |
| Cedente | `cedente@lastro.demo` | Fornecedor Lima Ltda |
| Sacado | `sacado@lastro.demo` | Grupo Atlas Varejo |

You can also register a brand-new account for any role from the login screen.

Other useful scripts:

```bash
npm run build       # typecheck + build both client and server
npm run typecheck   # typecheck both workspaces
npm run test         # run the server test suite (Vitest + Supertest)
```

Server-only env vars (all optional in dev — see `server/.env.example`): `JWT_SECRET`, `PORT`, `DB_PATH`, `ANTHROPIC_API_KEY`.

## Structure

```
client/src/
  components/        design-system primitives (Button, Card, Badge, Modal, Gauge, Toggle, Skeleton, ErrorBoundary…)
  layout/             app shell: Sidebar, NotificationBell, AiChat, AppShell
  pages/auth/         login/register, KYB modal, onboarding tour
  pages/app/          the 17 authenticated screens (role-gated)
  pages/public/       Developers, Preços, Legal, 404
  state/               session context (JWT-backed auth)
  lib/                 API client, WebSocket hook, misc utilities
  data/navConfig.ts   sidebar nav + role→tab mapping

server/src/
  data/seed.ts        static reference/copy data extracted from the design handoff (sacado risk profiles, compliance copy, revenue model, etc.)
  db/                  SQLite schema, seed script, and query helpers per domain (users, duplicatas, aceites, disputes, misc)
  auth/                password hashing, JWT sign/verify, requireAuth middleware
  routes/              one Express router per feature area, all Zod-validated
  lib/                 pure formatting/compute helpers shared across routes
  ws.ts                WebSocket server broadcasting live marketplace state
server/test/          Vitest + Supertest integration/unit tests
```

## Roles

Role is chosen once at registration (or via a demo account) and is fixed to that account/company:

- **Investidor/Financiador** — Dashboard, Marketplace, Automação de Lances, Análise de Risco, Carteira & Histórico, Comparador de Taxas, Compliance, Conta & Liquidação, Modelo de Receita, Disputas, Perfil
- **Empresa (cedente)** — Dashboard, Integrações ERP, Emitir Duplicata, Minhas Duplicatas, Aceite do Sacado (read-only), Análise de Risco, Carteira & Histórico, Compliance, Desenvolvedores, Conta & Liquidação, Modelo de Receita, Disputas, Perfil
- **Empresa (sacado)** — Dashboard, Portal do Sacado (confirmar/contestar), Carteira & Histórico, Conta & Liquidação, Disputas, Perfil

A new investidor account is routed through a 3-step KYB (institutional credentialing) modal, including a real document upload, before entering the platform. A sacado can only see and act on duplicatas whose `sacado_nome` matches their own company name — the cedente sees the same aceites read-only, since only the actual sacado can legally confirm or contest a debt.

## Design reference

The original design handoff (`.dc.html` files, not part of this app) documents the full design system (colors, typography, spacing) and behavior spec for all 21 in-app screens plus the public marketing pages. This app reimplements that spec in React/Tailwind rather than porting the proprietary template markup, and extends it with the real backend/auth/tests/CI/realtime/upload/AI layers described above.
