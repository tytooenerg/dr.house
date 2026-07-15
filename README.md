# Lastro — Plataforma de Duplicatas Escriturais

Marketplace/infraestrutura de duplicatas escriturais que conecta **Empresa Cedente** (emite e antecipa recebíveis), **Empresa Sacado** (confirma/contesta dívidas) e **Investidor/Financiador** (bancos, FIDCs, fundos), com registro escritural (CERC/B3/Núclea), score de risco por IA, seguro sobre o recebível e central de compliance com trilha de auditoria.

This repo is a full-stack recreation of the original high-fidelity HTML/JS design handoff (`design_handoff_lastro/`), rebuilt as a real React + TypeScript SPA backed by an Express API.

## Stack

- **client/** — React 18 + TypeScript + Vite + React Router + Tailwind CSS
- **server/** — Express + TypeScript, in-memory data store that mirrors the product's data model (duplicatas, sacados, ofertas/leilão, disputas, notificações, equipe, extrato de liquidação, etc.)

The client talks to the server exclusively over `/api/*` (proxied by Vite in dev). There is no client-only mocked state — every action (buy an offer, emit a duplicata, resolve a dispute, toggle automation…) is a real HTTP round-trip.

## Running locally

```bash
npm install
npm run dev
```

This starts the API on `http://localhost:4000` and the SPA on `http://localhost:5173` (Vite proxies `/api` to the server).

Other useful scripts:

```bash
npm run build       # typecheck + build both client and server
npm run typecheck   # typecheck both workspaces
```

## Structure

```
client/src/
  components/        design-system primitives (Button, Card, Badge, Modal, Gauge, Toggle…)
  layout/             app shell: Sidebar, NotificationBell, AiChat, AppShell
  pages/auth/         login/role picker, KYB modal, onboarding tour
  pages/app/          the 17 authenticated screens (role-gated)
  pages/public/       Developers, Preços, Legal, 404
  state/               session context (talks to /api/session)
  data/navConfig.ts   sidebar nav + role→tab mapping

server/src/
  data/seed.ts        seed data extracted from the design handoff
  store/               mutable in-memory app state + computed view builders + actions
  routes/              one Express router per feature area
```

## Roles

Login picks one of three roles, each with a distinct sidebar/tab set:

- **Investidor/Financiador** — Dashboard, Marketplace, Automação de Lances, Análise de Risco, Carteira & Histórico, Comparador de Taxas, Compliance, Conta & Liquidação, Modelo de Receita, Disputas, Perfil
- **Empresa (cedente)** — Dashboard, Integrações ERP, Emitir Duplicata, Minhas Duplicatas, Aceite do Sacado, Análise de Risco, Carteira & Histórico, Compliance, Desenvolvedores, Conta & Liquidação, Modelo de Receita, Disputas, Perfil
- **Empresa (sacado)** — Dashboard, Portal do Sacado, Carteira & Histórico, Conta & Liquidação, Disputas, Perfil

Picking "Investidor" routes through a 3-step KYB (institutional credentialing) modal before entering the platform.

## Design reference

The original design handoff (`.dc.html` files, not part of this app) lives in the uploaded bundle and documents the full design system (colors, typography, spacing) and behavior spec for all 21 in-app screens plus the public marketing pages. This app reimplements that spec 1:1 in React/Tailwind rather than porting the proprietary template markup.
