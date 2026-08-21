# lastro-sdk (Python)

Official Python client for the [Lastro Partner API](../../server/src/data/openapi.ts) (`/api/v1`) — a real, working HTTP client, not a stub. Zero third-party dependencies: it uses only Python's standard library (`urllib`).

> This SDK lives inside the Lastro monorepo and is not published to PyPI from here — there's no real PyPI account/credential this repo can honestly provide. The code itself is genuinely complete and tested end-to-end against the real server (see `tests/test_client.py`, which spawns the actual Node/Express app as a subprocess), so publishing it to PyPI is a packaging/credentials step, not an engineering one.

## Install (once published)

```bash
pip install lastro-sdk
```

Until then, from this directory: `pip install -e .`

## Usage

```python
from lastro_sdk import LastroClient, LastroApiError

lastro = LastroClient(api_key=os.environ["LASTRO_API_KEY"])  # lastro_live_… or lastro_test_… (sandbox)

try:
    result = lastro.emitir_duplicata(
        sacado="Grupo Atlas Varejo",
        cnpj="12.345.678/0001-90",
        valor="84.500,00",
        vencimento="2026-08-12",
        seguro=True,
    )
    print("Duplicata emitida:", result["duplicataId"], result["registro"])
except LastroApiError as err:
    print(f"API error {err.status} ({err.error}): {err}")
```

### Idempotent writes

`emitir_duplicata`, `decide_aceite` and `decidir_sinistro` accept an `idempotency_key` keyword argument — resending the same key with the same body replays the original result instead of repeating the side effect (see `lib/idempotency.ts` on the server):

```python
import uuid
lastro.emitir_duplicata(..., idempotency_key=str(uuid.uuid4()))
```

### Sandbox mode

A `lastro_test_…` key (generated for free from **Desenvolvedores** in the app, no plan upgrade required) hits the exact same endpoints against an isolated sandbox dataset — nothing it does ever touches real data or a real registradora. Point the same `LastroClient` at it; the SDK doesn't need to know which mode a key is in.

### Local development against this repo's own server

```python
lastro = LastroClient(api_key="lastro_test_…", base_url="http://localhost:4000/api/v1")
```

## Error handling

- `LastroApiError` — the API was reached and responded with a real non-2xx status. Has `.status` (HTTP status), `.error` (machine-readable code, e.g. `"validation_error"`, `"forbidden"`, `"not_found"`), `str(err)` (human-readable message) and `.issues` (Zod validation details, when applicable).
- `LastroNetworkError` — the request never reached the API (DNS/connection failure, timeout). Has `.cause` with the underlying exception.

## Coverage

Every endpoint in `server/src/routes/v1.ts` has a corresponding method:

| Method | Endpoint |
|---|---|
| `emitir_duplicata` | `POST /duplicatas` |
| `get_duplicata` | `GET /duplicatas/:id` |
| `list_marketplace` | `GET /marketplace` |
| `list_aceites` | `GET /aceites` |
| `decide_aceite` | `POST /aceites/:id/status` |
| `get_seguradora_payload` | `GET /seguradora` |
| `decidir_sinistro` | `POST /seguradora/sinistro/:id/decidir` |
| `get_score` | `GET /sacados/:cnpj/score` |
| `report_signal` | `POST /sacados/:cnpj/sinais` |
| `screen_pld` | `POST /pld/triagem` |

If the server adds a new endpoint, this SDK needs a matching method added by hand — it isn't generated from `GET /api/v1/openapi.json`, which stays the always-current source of truth if this file ever drifts.

## Testing

```bash
pip install -e ".[dev]"
python -m pytest -v
```

`tests/conftest.py` spawns the actual Lastro server (`npx tsx src/index.ts`, the real TypeScript/Express app, same code that runs in production) as a subprocess on an ephemeral port with an in-memory database, waits for a real health check, then every test drives the SDK against those live endpoints — not a hand-maintained mock of server behavior. Requires Node.js + this repo's `npm install` to already have been run (for `tsx` to be resolvable).
