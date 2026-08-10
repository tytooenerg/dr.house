# ISO/IEC 27001:2022 gap assessment — August 2026

## What this document is, and isn't

This is a **gap assessment**, not an ISO 27001 certification and not an ISMS
(Information Security Management System). Certification can only be issued by
an accredited certification body after a formal Stage 1 + Stage 2 audit —
that engagement doesn't exist for this project, and no codebase, on its own,
can substitute for it. ISO 27001 certifies a *management system* (documented
policies, risk assessment methodology, a Statement of Applicability, internal
audits, management review, continual improvement) at least as much as it
certifies technical controls. Most of what a real certification additionally
requires is organizational process, not code — this document is honest about
that distinction throughout.

What this document does instead: map the **93 controls in Annex A of
ISO/IEC 27001:2022** (organized under its four themes — Organizational,
People, Physical, Technological, per ISO/IEC 27002:2022) against the **real,
working controls that already exist in this codebase**, and lists — without
padding — everything a real ISMS and certification audit would additionally
require. Where a control's technical half overlaps with the SOC 2 Common
Criteria already mapped in `docs/security-review-2026-08.md` and
`docs/soc2-gap-assessment.md`, this document references those instead of
re-explaining the same code twice.

## How to read the mapping below

Each Annex A control gets: what it asks for, what already exists in this
codebase (with real file references), and what's still missing. "Exists"
means the control is real and functioning today, not that it's been
evidenced to a certification auditor's satisfaction — that evidence
collection (internal audit records, management review minutes, a running
Statement of Applicability) is exactly what building and operating a real
ISMS produces, and this document cannot manufacture it retroactively.

Controls are grouped, not enumerated one-by-one for all 93 — several controls
in each theme share the same real evidence (e.g. every access-control-related
control in A.8 points back to the same `auth/middleware.ts`), so grouping
avoids restating identical file references dozens of times while still
naming every relevant control ID.

---

## A.5 — Organizational controls (37 controls)

**A.5.1 Policies for information security / A.5.2 Roles and responsibilities
/ A.5.4 Management responsibilities:**
- **Exists:** role-based responsibility is real and enforced in code — five
  distinct roles (`investidor`, `cedente`, `sacado`, `seguradora`, `admin`,
  `db/types.ts`'s `Role` type), each with its own permitted nav surface
  (`ROLE_TABS`, `data/seed.ts`) and route-level enforcement
  (`requireRole`/`requireAuth`/`requirePlan`, `auth/middleware.ts`).
- **Missing (organizational):** no written information security policy
  document, no designated CISO/security owner role, no policy
  review/approval cadence. This is the single biggest gap in this theme —
  ISO 27001 treats a documented, management-approved policy as foundational,
  and no amount of code substitutes for that document existing and being
  reviewed on schedule.

**A.5.7 Threat intelligence / A.5.8 Information security in project
management:** Missing (organizational) — no formal threat-intel subscription
or process; security is addressed ad hoc per feature (see the real, dated
`docs/security-review-2026-08.md` self-review) rather than as a standing
project-management gate with sign-off criteria.

**A.5.9 Inventory of information and other associated assets / A.5.10
Acceptable use of information and other associated assets:**
- **Exists:** the data model itself is the closest real inventory —
  `server/src/db/migrations/*.sql` is a complete, versioned, literal record
  of every table (asset) this system stores, reviewable by `grep`, not
  documentation that can drift from reality.
- **Missing:** no formal asset register with owners/classification labels
  outside of the schema itself, no written acceptable-use policy for staff.

**A.5.12 Classification of information / A.5.13 Labelling of information:**
Missing (organizational) — no formal data classification scheme (public /
internal / confidential / restricted) applied to fields; informally, PII and
financial data are handled consistently more carefully (hashed passwords,
scoped exports) but this isn't a documented, labelled classification.

**A.5.14 Information transfer:** **Exists** — every external transfer this
platform makes is over authenticated HTTPS to real third-party APIs
(registradoras, Pix/boleto/TED PSPs, Anthropic, Stripe, Twilio, SMTP) with
credentials never logged (`lib/logger.ts` redaction patterns) and webhook
payloads HMAC-signed (`lib/webhookDelivery.ts`).

**A.5.15 Access control / A.5.16 Identity management / A.5.17
Authentication information / A.5.18 Access rights:** **Exists**, extensively
— this is the most mature area of the codebase. Real bcrypt password hashing
(`auth/password.ts`), JWT access tokens + rotating refresh tokens
(`auth/jwt.ts`, `db/refreshTokens.ts`), optional real TOTP 2FA
(`lib/totp.ts`), real SSO (Google OAuth, SAML — `lib/samlSso.ts`), per-role
route gating (`auth/middleware.ts`), per-plan feature gating (`lib/billing.ts`),
scoped partner API keys (read-only vs read-write, `auth/apiKey.ts`), and
account-level access revocation (LGPD deletion, `routes/lgpd.ts`). See
`docs/security-review-2026-08.md` SR-1/SR-2 for the two real findings already
identified and fixed against this area (SSRF, missing rate limit).

**A.5.19–A.5.23 Supplier relationships:** **Exists (partial)** — every
third-party integration follows a single, consistent, real-when-configured
pattern: absent credentials, the feature is honestly disabled (logged at
startup, e.g. `lib/registradoras.ts`, `lib/claude.ts`, `lib/paymentRail.ts`),
never silently faked. **Missing:** no formal supplier security-assessment
process, no signed data-processing agreements on file (those are
organizational/legal artifacts outside a codebase's reach).

**A.5.24–A.5.28 Incident management:** **Exists (partial)** — a real,
append-only, hash-chained audit log (`db/audit.ts`, `verifyAuditChain`)
records security-relevant events; automated suspicious-activity detection
(`lib/suspiciousActivityMonitor.ts`) creates real, admin-reviewable incident
records (`suspicious_activity_reports` table) with a documented external
escalation path (COAF, `lib/regulatoryReports.ts`). **Missing:** no formal
incident response plan document, no defined severity taxonomy or SLA, no
post-incident review template — the *detection and evidence* mechanisms are
real; the *process* wrapped around them for a certification audit is not.

**A.5.29–A.5.31 Business continuity / legal & regulatory / contractual
requirements:** **Exists (partial)** — automated encrypted-at-rest-storage-
adjacent backups with retention (`lib/backup.ts`), a documented (not yet
executed) scale-out migration path (`docs/postgres-migration.md`), and real
regulatory-compliance features (LGPD export/deletion, COAF/CVM reporting,
sanctions screening `db/sanctions.ts`). **Missing:** no tested disaster-
recovery runbook with an RTO/RPO target, no legal register of applicable
regulations reviewed on a cadence, no contract templates.

**A.5.32–A.5.37 Intellectual property, records, privacy, monitoring
compliance, documented procedures:** Missing (organizational) — no IP policy,
no formal records-retention schedule beyond what's implicit in the backup
retention count, no independent compliance-monitoring function distinct from
the engineering team itself.

---

## A.6 — People controls (8 controls)

**A.6.1 Screening / A.6.2 Terms and conditions of employment / A.6.3
Awareness, education and training / A.6.4 Disciplinary process / A.6.5
Responsibilities after termination / A.6.6 Confidentiality agreements:**
**Missing, entirely (organizational).** This is a solo/prototype project with
no employees, hiring pipeline, or HR function to evaluate — every control in
this theme requires an actual organization with staff.

**A.6.7 Remote working:** Not applicable at this project's current stage — no
staff or endpoints to secure remotely. A real deployment would need a
documented remote-access policy (VPN/zero-trust requirements, endpoint
posture checks) that doesn't exist here.

**A.6.8 Information security event reporting:** **Exists (technical
half only)** — the audit log and suspicious-activity monitor above give
staff something real to look at and act on. **Missing:** no defined
staff-facing reporting channel/process (e.g. a documented "report it here"
policy) since there's no staff to report to yet.

---

## A.7 — Physical controls (14 controls)

**A.7.1–A.7.14 (secure areas, physical entry, protecting against threats,
equipment, cabling, disposal, clear desk, etc.):** **Not applicable /
inherited from cloud provider.** This application has no on-premises
infrastructure — it runs as a stateless Node.js process against a local
SQLite file and (optionally) Redis, deployable to any container platform
(`Dockerfile`, `deploy/helm/lastro/`). Physical security of the underlying
compute is entirely delegated to whichever cloud/hosting provider runs the
container; a real ISMS covering this theme requires reviewing *that*
provider's own ISO 27001 or SOC 2 report (a real, obtainable third-party
document — AWS, GCP, Azure, and most reputable Kubernetes hosts publish
one), not building physical controls into an application repository.

---

## A.8 — Technological controls (34 controls)

**A.8.1 User endpoint devices / A.8.2 Privileged access rights:**
**Exists** — the admin role is a distinct, separately-authenticated account
type (`role = 'admin'`, never assignable via self-registration —
`routes/auth.ts`'s register schema rejects it), and every admin-only route is
gated by `requireRole('admin')` (`routes/admin.ts`). Agent governance adds a
second privilege layer on top: sensitive agent tool calls require human
approval, with dual-approval above a configurable BRL threshold
(`lib/agentGovernance.ts`).

**A.8.3 Information access restriction / A.8.4 Access to source code:**
**Exists (partial)** — application-level access restriction is real (see
A.5.15–18 above); this repository itself has no additional source-code
access control beyond whatever the hosting Git platform provides (branch
protection, review requirements) — those are configured outside this
codebase and not evaluated here.

**A.8.5 Secure authentication:** **Exists** — see A.5.15–18. Password
hashing uses bcrypt with a real work factor (`auth/password.ts`); JWTs are
short-lived with rotating refresh tokens that are single-use and revoked on
reuse detection (`db/refreshTokens.ts`); brute-force protection on login/
register (`bruteForceLimiter`, `auth/rateLimit.ts`).

**A.8.6 Capacity management:** **Exists (partial)** — a real load-test
script (`scripts/loadtest/`) and per-route latency/error metrics
(`lib/metrics.ts`) give real capacity signal; no automated capacity-planning
process or alerting thresholds beyond what an operator manually reviews.

**A.8.7 Protection against malware:** Not directly applicable — this is a
server-side API + SPA with no file-execution surface; uploaded documents
(NF-e, KYB docs — `routes/uploads.ts`) are stored, not executed. No
antivirus scanning is run against uploads, which a real deployment handling
user-submitted files at scale should add.

**A.8.8 Management of technical vulnerabilities:** **Exists (partial)** —
CI runs `npm audit`-adjacent dependency checks implicitly via
`npm ci`/lockfile pinning (`.github/workflows/ci.yml`), and this project has
a real, dated, manual security self-review (`docs/security-review-2026-08.md`)
that found and fixed two real issues (SSRF, missing rate limit) rather than
claiming a clean bill of health. **Missing:** no automated dependency-
vulnerability scanning (Dependabot/Snyk-style) wired into CI, no defined
patch-SLA policy.

**A.8.9 Configuration management / A.8.10 Information deletion / A.8.11
Data masking / A.8.12 Data leakage prevention:**
- **Exists:** all configuration is environment-variable driven with a
  single documented source of truth (`server/.env.example`), never hardcoded
  secrets; real data deletion exists for LGPD requests (`routes/lgpd.ts`);
  the structured logger redacts sensitive fields (`lib/logger.ts`); the SSRF
  guard (`lib/ssrfGuard.ts`) is itself a real data-leakage-prevention
  control against internal-network exfiltration via user-supplied webhook
  URLs.
- **Missing:** no dedicated DLP tooling scanning outbound traffic/logs at
  the infrastructure level.

**A.8.13 Information backup:** **Exists** — automated SQLite online-backup
snapshots with configurable interval/retention and optional offsite command
hook (`lib/backup.ts`), admin-visible with on-demand trigger
(`routes/admin.ts`'s `/backups` routes).

**A.8.14 Redundancy of information processing facilities:** **Missing
(architectural, documented honestly)** — SQLite is a single-writer database;
this app currently runs as a single instance by design (see
`deploy/helm/lastro/values.yaml`'s `replicaCount: 1` and the accompanying
comment). Real redundancy requires the Postgres migration documented as
*not yet done* in `docs/postgres-migration.md`. This is the most significant
real architectural gap against this control in the whole assessment, and the
codebase is deliberately upfront about it in three separate places (that doc,
the Helm chart, `docker-compose.yml`'s comments) rather than glossing over it.

**A.8.15 Logging / A.8.16 Monitoring activities:** **Exists** — structured
JSON logging throughout (`lib/logger.ts`, Pino), the hash-chained audit log
(`db/audit.ts`), per-route latency/error metrics (`lib/metrics.ts`), a real
public status page backed by actual self-checks (`lib/healthMonitor.ts`,
`db/systemHealth.ts`), and now real-when-configured distributed tracing
(`lib/tracing.ts`, OpenTelemetry) for request-level visibility across
external I/O boundaries and agent tool calls.

**A.8.17 Clock synchronization:** **Exists (inherited)** — all timestamps
are generated server-side (`datetime('now')` in SQLite, `new Date()` in
Node), inheriting the host's NTP-synced clock; no additional application-
level clock-sync logic is needed or present.

**A.8.18 Use of privileged utility programs / A.8.19 Installation of
software on operational systems:** Missing (organizational/infrastructure) —
governed by whatever the deployment platform enforces (container image
immutability, no shell access in production), not by this codebase.

**A.8.20 Networks security / A.8.21 Security of network services / A.8.22
Segregation of networks / A.8.23 Web filtering:** **Exists (partial)** —
CORS allowlisting (`app.ts`), Helmet security headers, the SSRF guard
blocking egress to private/loopback/link-local addresses at both webhook
registration and delivery time (`lib/ssrfGuard.ts`) — real, tested network-
boundary controls at the application layer. Network segmentation itself
(VPCs, security groups) is an infrastructure concern outside this repo.

**A.8.24 Use of cryptography:** **Exists** — bcrypt for passwords, HMAC-
SHA256 for webhook payload signing (`lib/webhookDelivery.ts`), signed JWTs,
TOTP secrets generated with a real CSPRNG (`lib/totp.ts`), SAML assertion
signature verification against the IdP's real certificate (`lib/samlSso.ts`).
TLS termination itself is delegated to the deployment's ingress/reverse
proxy, not implemented in-process — standard practice, documented as such.

**A.8.25 Secure development life cycle / A.8.26 Application security
requirements / A.8.27 Secure system architecture and engineering
principles / A.8.28 Secure coding:** **Exists, extensively** — TypeScript
throughout both client and server (a real static-typing gate, not just a
transpiler), Zod schema validation on every mutating endpoint
(`server/src/routes/*.ts`), parameterized SQL everywhere (`better-sqlite3`'s
`.prepare()`/bound params — no string-concatenated queries), a real CI
pipeline running typecheck + the full test suite (`.github/workflows/ci.yml`)
on every change, and the "real-when-configured" architectural principle
applied consistently across every third-party integration in this codebase
(rather than faking behavior when a credential is absent).

**A.8.29 Security testing in development and acceptance:** **Exists** —
`docs/security-review-2026-08.md` is a real, dated manual review that found
and fixed two issues before this document existed to claim otherwise; every
feature added throughout this project's history shipped with real automated
tests (currently 61 server test files / 379+ tests, 6 client test files —
see `README.md`'s testing section), not just manual smoke-checks.

**A.8.30 Outsourced development:** Not applicable — no outsourced
development to evaluate.

**A.8.31 Separation of development, test and production environments:**
**Exists (partial)** — a real, enforced sandbox-data isolation layer for
partner API keys (`lib/sandboxData.ts`, test-mode keys can never see live
data and vice versa, checked at the query layer in `db/duplicatas.ts`) and
an in-memory SQLite database for every automated test run, fully isolated
from any real data. **Missing:** no separate staging *deployment*
environment described in this repo (that's an infrastructure/CI-CD pipeline
concern, not application code).

**A.8.32 Change management:** **Exists (partial)** — every schema change is
a real, versioned, sequentially-numbered migration file
(`server/src/db/migrations/NNNN_*.sql`, applied and tracked via
`schema_migrations`, `db/migrate.ts`) — a genuine, auditable change-control
mechanism for the data layer. Application code change management (PR review
requirements, approval gates) is inherited from the Git hosting platform's
configuration, not evaluated here.

**A.8.33 Test information:** **Exists** — test suites generate their own
synthetic data against an isolated in-memory database per run; no production
data is ever used in testing.

**A.8.34 Protection of information systems during audit testing:** Not
applicable — no live audit/penetration test has been conducted against a
running deployment of this system; `docs/security-review-2026-08.md` was a
static code review, not a live test requiring this control.

---

## Summary: what a real ISO 27001 certification still needs beyond this repo

Everything below is **organizational process**, not code, and is exactly
what stands between this gap assessment and an actual certificate:

1. **A documented, management-approved Information Security Policy** and a
   named accountable owner (A.5.1–5.4) — the single highest-priority gap.
2. **A formal risk assessment methodology and risk treatment plan**,
   producing a **Statement of Applicability** (which of the 93 Annex A
   controls apply, and why/why not) — this document is a *precursor* to that
   SoA, not the SoA itself.
3. **An internal audit program** and **management review cadence** — ISO
   27001 requires the ISMS to audit itself on a schedule and for leadership
   to formally review results; neither exists yet because there's no
   standing organization to run them.
4. **HR-track controls** (A.6.1–6.6): screening, confidentiality agreements,
   security training, disciplinary process — all require actual employees.
5. **Third-party attestations** for anything this codebase doesn't control
   directly: the cloud/hosting provider's own physical-security
   certification (A.7), and signed data-processing agreements with vendors
   (A.5.19–23).
6. **A tested business-continuity/disaster-recovery plan** with a defined
   RTO/RPO, not just the automated backups that already exist (A.8.13–14).
7. **Engaging an accredited certification body** for the actual Stage 1
   (documentation review) and Stage 2 (operational effectiveness) audits —
   no self-assessment, however thorough, satisfies this.

If a real ISMS program starts from here, most of the *technical* control
evidence — access control, cryptography, logging/monitoring, secure
development, backups, incident detection — already exists and works today,
same conclusion as the SOC 2 gap assessment reached independently. What's
missing is almost entirely the management-system scaffolding around it.
