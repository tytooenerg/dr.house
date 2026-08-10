# Security self-review — August 2026

## Scope and honesty note

This is a manual, in-repo security self-review — not a third-party penetration
test, and not a substitute for one. Two things are worth being explicit about:

1. **A real third-party pentest can't be honestly delivered by an AI working alone
   inside this sandbox.** A genuine pentest needs an independent tester, real
   external network access to a running deployment, and a written engagement —
   none of which exist here. Anything claiming otherwise would be fabricated.
2. **The repo's automated `security-review` tooling (the kind that reviews a pull
   request's diff) couldn't run in its usual form either** — it diffs against
   `origin/HEAD`, and this sandbox has no fetchable remote history to diff
   against (this project has never been pushed to GitHub from here). So instead
   of a diff-scoped review of "what changed", this was a manual, full-codebase
   review of the areas below, done by reading the real code (`server/src`),
   grepping for known-risky patterns, and tracing specific request flows
   end-to-end.

This review is bounded by what a code read can find. It does **not** cover:
runtime/infrastructure hardening (container config, TLS termination, secrets
manager, network segmentation — none of which exist in this sandbox to review),
dependency supply-chain provenance beyond `npm audit`, or anything that only a
running, network-reachable deployment would surface (e.g. actual DNS behavior in
production, real load-balancer/WAF configuration). Treat it as one honest input
among several a real pre-launch security process would need — not a clean bill
of health.

## Areas reviewed

- Authentication: password hashing (`auth/password.ts`), JWT issuance/verification
  (`auth/jwt.ts`), 2FA (`lib/totp.ts`), refresh token rotation
  (`db/refreshTokens.ts`), Google OAuth and SAML SSO (`lib/googleOAuth.ts`,
  `lib/samlSso.ts`) — including their new routes in `routes/auth.ts`.
- Authorization: `auth/middleware.ts` (`requireAuth`, `requireRole`,
  `requirePlan`, the team-member read-only scope), spot-checked ownership
  enforcement on ID-based mutating routes (secondary market cancel/buy,
  disputes, aceites).
- Input validation: Zod schemas on every mutating route sampled.
- Injection: all SQL access goes through `better-sqlite3` parameterized
  `?`-placeholder queries (`db/*.ts`) — grepped for string-concatenated SQL and
  found none; the few template-literal `db.prepare()` calls interpolate only
  hardcoded SQL fragments (e.g. `datetime('now', '+N days')` with a
  compile-time constant `N`), never request input.
- Secrets/randomness: API keys, webhook secrets, refresh tokens and CSRF/signup
  JWT nonces all use `crypto.randomBytes`/`crypto.randomUUID` (`auth/apiKey.ts`,
  `routes/dev.ts`, `auth/jwt.ts`, `routes/account.ts`); grepped for `Math.random`
  and confirmed every hit is either a demo-seed script or an explicitly
  documented `simulado: true` code path, never an auth/security token.
  API keys and webhook secrets are stored hashed (SHA-256), shown to the user
  once at creation, never again.
- File uploads (`routes/uploads.ts`): MIME allowlist, 8MB size cap, filename
  sanitized against path traversal, no route ever serves the upload directory
  back out (write-only from the API's perspective — no read-side path-traversal
  surface exists).
- Outbound HTTP / SSRF: every external integration that takes a fully
  user-controlled URL (there's exactly one: partner webhooks,
  `routes/dev.ts`/`lib/webhookDelivery.ts`) — see finding SR-1.
- Rate limiting coverage: enumerated every route file's public,
  unauthenticated `POST` endpoints — see finding SR-2.
- CORS (`app.ts`): allowlist-based for `/api/*` except the deliberately-open
  `/api/v1/*` (partner API, key-authenticated) and `/api/public/*`.
- Security headers: `helmet()` is applied; `contentSecurityPolicy: false` is
  correct here since this process serves only JSON, not HTML (the SPA is a
  separate static build).
- JWT algorithm handling: `jwt.verify(token, SECRET)` is called without an
  explicit `algorithms` allowlist. Checked against the `jsonwebtoken` library's
  actual default behavior: when the key is a plain string (not a PEM
  certificate/public key, which none of these are), it restricts accepted
  algorithms to `HS256/HS384/HS512` and never accepts `alg: none` — so the
  classic "RS256→HS256 algorithm-confusion" attack does not apply here. Noted
  as an informational hardening item below anyway, since pinning
  `algorithms: ['HS256']` explicitly costs nothing and removes any dependence
  on that library-default behavior continuing to hold in a future version.
- Webhook delivery signing: outbound partner webhooks are HMAC-SHA256 signed
  over the raw body with a per-webhook secret (`lib/webhookDelivery.ts`), the
  same shape Stripe uses for its own webhooks.
- `npm audit` — 0 vulnerabilities on the server workspace as of this review.

## Findings

### SR-1 — SSRF via partner webhook URLs (fixed in this pass)

**Severity: Medium-High.** `POST /dev/webhooks` (`routes/dev.ts`) accepted any
syntactically valid URL (`z.string().url()`) as a partner's webhook target.
`lib/webhookDelivery.ts` then makes a real server-side `fetch()` to that URL
whenever a subscribed event fires. Nothing checked *where* the URL actually
pointed — an authenticated Empresarial-plan account could register a webhook
at an internal address (a database on the private network, a cloud instance's
metadata endpoint at `169.254.169.254`, a service on `localhost`) and use
Lastro's own server as an SSRF proxy against it.

**Fix:** `lib/ssrfGuard.ts` — resolves the URL's hostname for real via DNS and
rejects anything that isn't a public, routable address (blocks loopback,
RFC1918 private ranges, link-local/cloud-metadata, IPv6 equivalents, and
non-`http(s)` schemes). Checked in two places: once at registration
(`POST /dev/webhooks`, immediate feedback) and again on every delivery attempt
(`lib/webhookDelivery.ts`), since retries are spread out up to 30 minutes and a
DNS-rebinding attacker could otherwise register a domain that resolves
publicly at validation time and repoint it internally before delivery. Real
integration tests (`server/test/partner-api*.test.ts`) that deliberately point
webhooks at a same-process `127.0.0.1` test server needed loopback allowed
under `VITEST` specifically — every other private range stays blocked even in
tests. Unit-tested directly in `server/test/ssrf-guard.test.ts`.

### SR-2 — Public payment webhooks had no rate limiting (fixed in this pass)

**Severity: Low.** `POST /public/pix-webhook`, `/boleto-webhook` and
`/ted-webhook` are unauthenticated by design — their real anti-spoofing story
is meant to be mTLS/IP-allowlisting at the PSP/infrastructure level once a real
`PIX_PSP_*`/`BOLETO_PSP_*`/`TED_PSP_*` contract exists (already documented in
each route's comment), and the identifiers they act on
(`txid`/`nossoNumero`/`referencia`) are all `crypto.randomUUID()`-grade
unguessable, not sequential. So this was never a realistic path to forging a
deposit — but leaving an unauthenticated financial endpoint completely
unthrottled is still worth closing as cheap defense-in-depth against brute-force
probing or basic DoS. **Fix:** a shared 120 req/min rate limiter
(`paymentWebhookLimiter`, `routes/public.ts`), generous enough not to
false-positive a real PSP's legitimate retry burst.

## Reviewed and found solid (no action needed)

- **SQL injection** — no string-built queries anywhere; 100% parameterized.
- **IDOR on ownership-scoped resources** — spot-checked several ID-based
  mutating routes (`lib/resaleCore.ts`'s `cancelResaleListing`, disputes,
  aceites); every one re-derives the resource and checks it belongs to
  `req.user.id` before mutating, independent of what the route itself trusts.
- **Auth coverage** — every route file applies `requireAuth` (or
  `requireApiKey` for `/v1`) at the router level via `.use(...)`, not
  ad hoc per-route, so a new route added to an existing file can't
  accidentally ship unauthenticated.
- **Team-member account scope** (`auth/middleware.ts`) — enforced centrally in
  `requireAuth` itself via an explicit allowlist, not left to each route to
  remember.
- **File upload path traversal** — filename sanitized to `[a-zA-Z0-9._-]`
  before writing; no endpoint reads the upload directory back out at all.
- **Webhook/API key secret storage** — hashed at rest (SHA-256), never
  logged or re-displayed after creation.
- **CORS** — allowlist-scoped to `/api/*`, correctly excludes static asset
  requests from the strict check.
- **Stripe webhook** — raw-body + signature verification via Stripe's own SDK,
  registered before the global JSON body parser (required for signature
  verification to work at all).

## Informational / low-priority hardening notes (not changed in this pass)

- **bcrypt cost factor is 10** (`auth/password.ts`). Still a reasonable,
  widely-used default; bumping to 12 is a defensible future hardening step but
  not an active weakness today.
- **`jwt.verify()` calls don't pass an explicit `algorithms` allowlist.** As
  detailed above, this is not currently exploitable given how `jsonwebtoken`
  behaves with a plain string secret — but explicitly pinning
  `algorithms: ['HS256']` on every call site would remove the dependence on
  that library-default behavior entirely. Left as a follow-up since it touches
  ~7 call sites across `auth/jwt.ts` for a purely defense-in-depth benefit.
- **No WAF / DDoS-layer protection exists in this repo** — expected, since
  that's normally an edge/CDN concern (Cloudflare, AWS WAF, etc.), not
  something an application codebase implements itself. Worth stating
  explicitly as a real deployment's responsibility, not an oversight here.
