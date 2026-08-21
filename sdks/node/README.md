# @lastro/sdk (Node.js / TypeScript)

Official Node.js/TypeScript client for the [Lastro Partner API](../../server/src/data/openapi.ts) (`/api/v1`) — a real, working HTTP client, not a stub. Zero runtime dependencies: it uses the platform's built-in `fetch` (Node 18+, browsers, Deno, Bun, Cloudflare Workers).

> This SDK lives inside the Lastro monorepo and is not published to npm from here — there's no real npm organization/registry credential this repo can honestly provide. The code itself is genuinely complete and tested end-to-end against the real server (see `test/client.test.ts`), so publishing it under a real `@lastro` npm scope is a packaging/credentials step, not an engineering one.

## Install (once published)

```bash
npm install @lastro/sdk
```

Until then, inside this monorepo: `npm install` at the repo root resolves it as workspace `sdks/node`.

## Usage

```ts
import { LastroClient, LastroApiError } from '@lastro/sdk';

const lastro = new LastroClient({
  apiKey: process.env.LASTRO_API_KEY!, // lastro_live_… or lastro_test_… (sandbox)
});

try {
  const result = await lastro.emitirDuplicata({
    sacado: 'Grupo Atlas Varejo',
    cnpj: '12.345.678/0001-90',
    valor: '84.500,00',
    vencimento: '2026-08-12',
    seguro: true,
  });
  console.log('Duplicata emitida:', result.duplicataId, result.registro);
} catch (err) {
  if (err instanceof LastroApiError) {
    console.error(`API error ${err.status} (${err.error}): ${err.message}`);
  } else {
    throw err;
  }
}
```

### Idempotent writes

`emitirDuplicata`, `decideAceite` and `decidirSinistro` accept a second `{ idempotencyKey }` argument — resending the same key with the same body replays the original result instead of repeating the side effect (see `lib/idempotency.ts` on the server):

```ts
await lastro.emitirDuplicata(input, { idempotencyKey: crypto.randomUUID() });
```

### Sandbox mode

A `lastro_test_…` key (generated for free from **Desenvolvedores** in the app, no plan upgrade required) hits the exact same endpoints against an isolated sandbox dataset — nothing it does ever touches real data or a real registradora. Point the same `LastroClient` at it; the SDK doesn't need to know which mode a key is in.

### Local development against this repo's own server

```ts
const lastro = new LastroClient({
  apiKey: 'lastro_test_…',
  baseUrl: 'http://localhost:4000/api/v1',
});
```

## Error handling

- `LastroApiError` — the API was reached and responded with a real non-2xx status. Carries `.status` (HTTP status), `.error` (machine-readable code, e.g. `"validation_error"`, `"forbidden"`, `"not_found"`), `.message` (human-readable) and `.issues` (Zod validation details, when applicable).
- `LastroNetworkError` — the request never reached the API (DNS/connection failure, timeout). Carries `.cause` with the underlying error.

## Coverage

Every endpoint in `server/src/routes/v1.ts` has a corresponding method:

| Method | Endpoint |
|---|---|
| `emitirDuplicata` | `POST /duplicatas` |
| `getDuplicata` | `GET /duplicatas/:id` |
| `listMarketplace` | `GET /marketplace` |
| `listAceites` | `GET /aceites` |
| `decideAceite` | `POST /aceites/:id/status` |
| `getSeguradoraPayload` | `GET /seguradora` |
| `decidirSinistro` | `POST /seguradora/sinistro/:id/decidir` |
| `getScore` | `GET /sacados/:cnpj/score` |
| `reportSignal` | `POST /sacados/:cnpj/sinais` |
| `screenPld` | `POST /pld/triagem` |

If the server adds a new endpoint, this SDK needs a matching method added by hand — it isn't generated from `GET /api/v1/openapi.json`, which stays the always-current source of truth if this file ever drifts.

## Testing

`npm run test -w sdks/node` runs a real end-to-end suite: it starts the actual Lastro Express app on an ephemeral local port, registers real accounts and sandbox API keys through it, and drives every SDK method against those live endpoints — not a hand-maintained mock of server behavior.
