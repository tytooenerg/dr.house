# Official SDKs

Real, hand-written, dependency-free client libraries for the [Lastro Partner API](../server/src/data/openapi.ts) (`/api/v1`) — one method per real endpoint in `server/src/routes/v1.ts`, both tested end-to-end against the actual running server (not mocked HTTP).

- **[`node/`](./node)** — TypeScript/JavaScript, zero runtime dependencies (uses the platform's built-in `fetch`). `@lastro/sdk`.
- **[`python/`](./python)** — Python, zero third-party dependencies (uses only `urllib`). `lastro-sdk`.

Neither is published to a real package registry (npm/PyPI) from this repo — that requires a real organization account and credentials this sandbox can't honestly provide. What *is* real: the client code itself, and its test suite. Each SDK's tests start the actual Lastro server and drive every method against it over a real HTTP connection, so a request-shape drift between an SDK and `routes/v1.ts` fails a real test, not a maintained assumption about the server's behavior.

See each subdirectory's own README for install/usage instructions and its full endpoint-coverage table.
