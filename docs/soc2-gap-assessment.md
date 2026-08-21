# SOC 2 gap assessment — August 2026

## What this document is, and isn't

This is a **gap assessment**, not a SOC 2 report and not a certification.
SOC 2 (Type I or Type II) can only be issued by an independent, licensed CPA
firm after a formal audit against the AICPA's Trust Services Criteria (TSC) —
that engagement doesn't exist for this project, and nothing in this repository
can substitute for it. What this document does instead: map the Trust Services
Criteria's *Common Criteria* (the security section every SOC 2 report covers,
regardless of which optional categories — Availability, Confidentiality,
Processing Integrity, Privacy — are also in scope) against the **real, working
controls that already exist in this codebase**, and lists — honestly, without
padding — everything a real audit would additionally require that no codebase
can provide on its own.

If a real SOC 2 process starts from here, this document should save real time:
most of the *technical* control evidence a Type II audit asks for already
exists and works today. What's missing is almost entirely organizational —
policies, people, and a sustained observation period — not code.

## How to read the mapping below

Each Common Criteria (CC) family gets: what SOC 2 asks for, what already
exists in this codebase (with real file references), and what's still missing.
"Exists" means the control is real and functioning, not that it's been proven
to an auditor's satisfaction over an observation period — that proof is
exactly what a Type II engagement produces and this document cannot.

## CC1 — Control Environment

**Asks for:** organizational commitment to integrity/ethics, a defined
structure, board oversight, HR policies (hiring, termination, background
checks), documented job responsibilities.

- **Exists:** role-based access is real and enforced in code (`Role` type in
  `db/types.ts`; `requireRole`/`requireAuth`/`requirePlan` in
  `auth/middleware.ts`); the admin role is a distinct, gated account type
  (`routes/admin.ts`).
- **Missing (organizational, not technical):** this is a solo/prototype
  project with no company structure, board, HR function, or documented hiring
  process to evaluate. A real deployment needs a written organizational chart,
  a code of conduct, background-check policy for anyone with production
  access, and documented onboarding/offboarding procedures (including
  timely access revocation — see CC6 below for the technical half of that).

## CC2 — Communication and Information

**Asks for:** internal communication of security policies, an external
channel for reporting security issues, documented system descriptions.

- **Exists:** this repo's own `README.md` documents the system honestly,
  including a "Known gaps" section — arguably more forthright about
  limitations than most vendor security pages.
- **Missing:** no published security.txt/responsible-disclosure policy, no
  formal internal security-awareness training program, no customer-facing
  status/incident communication process beyond the real `/status` page
  (`routes/public.ts`, `db/systemHealth.ts`) already built.

## CC3 — Risk Assessment

**Asks for:** a documented process to identify and assess risks to the
entity's objectives, including fraud risk, on a recurring cadence.

- **Exists:** real, automated fraud/AML risk assessment logic runs
  continuously in production code — `lib/fraudDetection.ts`,
  `lib/fraudAnomalyDetection.ts` (network-anomaly detection),
  `lib/suspiciousActivity.ts` (COAF-style monitoring), the unified Compliance
  AI Engine (`lib/complianceEngine.ts`), and the automated PLD/fraud agent
  cron job (`lib/pldAgentJob.ts`). This is real operational risk assessment of
  the *business* (transaction fraud, sanctions exposure), which SOC 2 does
  care about, but is a different thing from...
- **Missing:** a documented *entity-level* risk assessment process — an annual
  (at minimum) written exercise identifying risks to the company itself
  (vendor concentration, key-person risk, infrastructure risk) with
  documented mitigation owners and follow-through. `docs/security-review-2026-08.md`
  in this repo is a real, one-time technical risk assessment of the codebase —
  a genuine start, not a substitute for the recurring, broader process a real
  audit expects.

## CC4 — Monitoring Activities

**Asks for:** ongoing evaluation of whether controls are present and
functioning, with deficiencies communicated and remediated.

- **Exists:** real, working operational monitoring — `lib/metrics.ts`
  (per-route latency/error rate), `/status` self-checks (`db/systemHealth.ts`),
  structured logging throughout (`lib/logger.ts`, pino), the audit log hash
  chain (`db/audit.ts` — see CC7 below), automated backup verification
  (`lib/backup.ts`).
- **Missing:** no independent internal-audit function reviewing whether these
  controls stay correctly configured over time; no documented deficiency
  tracking/remediation process (a ticket in a real issue tracker, closed with
  evidence, per finding) — this gap assessment's own SR-1/SR-2 findings being
  fixed in the same pass they were found is a fine outcome for a prototype,
  but a real audit wants to see that process work repeatedly over time, by
  people other than whoever wrote the original code.

## CC5 — Control Activities

**Asks for:** controls that address risk, segregation of duties, and
technology general controls.

- **Exists:** real segregation-of-duties patterns already built where the
  business logic calls for them — dual approval above a configurable
  threshold for agentic-AI actions (`lib/agentGovernance.ts`), admin-only
  compliance-queue review before a flagged account is approved
  (`routes/admin.ts` KYB approval flow), the team-member read-only account
  scope (`auth/middleware.ts`) that structurally prevents a delegated account
  from acting on the owner's behalf.
- **Missing:** segregation of duties *within engineering/operations itself*
  (who can deploy vs. who can review code vs. who can access production data)
  isn't something a single-repository prototype has anyone to segregate
  between yet — that's a staffing and process gap, not a code gap.

## CC6 — Logical and Physical Access Controls

**Asks for:** access provisioning/deprovisioning, authentication strength,
encryption, physical/environmental protection of infrastructure.

- **Exists — this is the strongest section, real technical controls
  throughout:**
  - Password hashing via bcrypt (`auth/password.ts`); real TOTP-based 2FA with
    recovery codes (`lib/totp.ts`, `db/twoFactor.ts`); real SSO via Google
    OAuth and SAML 2.0 (`lib/googleOAuth.ts`, `lib/samlSso.ts`) — genuine
    third-party identity verification, not simulated.
  - Short-lived access tokens (15 min) with rotating, hashable refresh tokens
    (`auth/jwt.ts`, `db/refreshTokens.ts`) — a stolen access token has a
    minutes-wide blast radius, and refresh-token reuse after rotation is
    detectable.
  - Deprovisioning is real: team-invite revocation (`db/misc.ts`
    `isTeamMembershipRevoked`), API key revocation (`db/apiKeys.ts`), account
    anonymization on deletion request (`db/users.ts` `anonymizeUser` — see
    CC9/Privacy below).
  - Rate limiting on brute-forceable endpoints (`routes/auth.ts`
    `bruteForceLimiter`), and now the payment-webhook endpoints too (SR-2,
    this pass).
  - The SSRF fix in this same pass (SR-1) is itself a logical-access control —
    preventing the application from being used to reach infrastructure it
    shouldn't be able to reach.
  - Every secret at rest is hashed (API keys, webhook secrets) or, for JWT
    signing, expected to come from a real secret manager in production
    (`JWT_SECRET` env var, with an explicit startup warning when it's
    missing — `auth/jwt.ts`).
- **Missing:**
  - **Encryption at rest for the database file itself.** SQLite
    (`server/data/lastro.db`) is not encrypted at rest in this repo; a real
    deployment needs full-disk encryption at the infrastructure layer (EBS
    encryption, LUKS, etc.) or a move to an encrypted-at-rest managed
    Postgres instance (see `docs/postgres-migration.md`, already scoped).
  - **Physical/environmental security** — doesn't apply to a sandboxed repo at
    all; entirely inherited from whatever cloud provider a real deployment
    picks (AWS/GCP/Azure all carry their own SOC 2 reports covering this,
    which a real audit would reference rather than re-prove).
  - **Formal access-review cadence** (quarterly access recertification,
    documented and signed off) — no process exists to *periodically* confirm
    who still has access to what; today access is correct at the moment it's
    granted/revoked, but nothing re-verifies it later.
  - **Secrets manager** — env vars are the mechanism throughout
    (`server/.env.example`); a real production deployment should move secret
    material (JWT_SECRET, PSP/bureau/Twilio/Stripe/SAML credentials) into a
    real secrets manager (AWS Secrets Manager, Vault, etc.) rather than
    process env vars, for rotation and audit-trail reasons.

## CC7 — System Operations

**Asks for:** detecting and responding to security events, incident
response, vulnerability management, backup/recovery.

- **Exists:**
  - **Tamper-evident audit log** — `db/audit.ts` implements a real hash chain
    (each entry's hash includes the previous entry's hash), so a database
    compromise that tries to rewrite history is detectable, not just logged.
  - **Automated backups** with retention (`lib/backup.ts`) and an optional
    offsite-shipping hook.
  - **`npm audit`-clean dependency tree** (0 vulnerabilities as of this
    review) — but see "Missing" below on making that continuous.
  - **Structured logging + optional Sentry** (`lib/logger.ts`,
    `lib/sentry.ts`) for real error visibility.
  - **This gap assessment and its companion security review
    (`docs/security-review-2026-08.md`)** are themselves a real, if one-time,
    vulnerability-identification exercise, with the findings fixed in the same
    pass (SR-1 SSRF fix, SR-2 rate limiting).
- **Missing:**
  - **A documented, tested incident-response plan** — who gets paged, what the
    communication tree is, breach-notification timelines/obligations (LGPD in
    Brazil has its own 72-hour-class notification expectations, separate from
    SOC 2). Nothing like this exists as a document today.
  - **Continuous dependency scanning in CI**, not just a manual `npm audit` run
    during this review — the GitHub Actions CI (`.github/workflows/`) doesn't
    currently run `npm audit`/Dependabot/Snyk on every PR; that's a cheap,
    real gap to close.
  - **A tested disaster-recovery runbook** — backups exist and work, but
    "restore from backup" has not been rehearsed end-to-end as a documented
    drill.
  - **A real, recurring penetration test** by an independent third party —
    explicitly out of reach for this project today (see the note at the top
    of `docs/security-review-2026-08.md`); SOC 2 doesn't strictly require an
    annual pentest, but most auditors expect to see one as supporting
    evidence.

## CC8 — Change Management

**Asks for:** a documented process for authorizing, testing, and deploying
changes.

- **Exists:** real, working technical scaffolding for this — CI
  (`.github/workflows/`) runs typecheck + the full automated test suite
  (server unit/integration + client component tests + Playwright e2e) on
  every change; the SQLite migration system (`server/src/db/migrate.ts`) makes
  schema changes sequential, numbered, and tracked
  (`schema_migrations` table) rather than ad hoc.
- **Missing:** a documented change-approval policy (who can approve a merge to
  the deploy branch, whether a second reviewer is required, a rollback
  procedure) — process/governance, not tooling; the tooling to *support* such
  a policy already exists (branch protection rules, required CI checks) but
  hasn't been configured as an enforced organizational policy here.

## CC9 — Risk Mitigation (vendor/business-partner risk)

**Asks for:** identification and management of risk from vendors and
business partners.

- **Exists:** every third-party integration in this codebase is explicitly,
  individually documented as to what it needs and what happens without it
  (`README.md`'s "Real-when-configured integrations" sections,
  `server/.env.example`'s inline comments) — Stripe, the credit bureau, each
  registradora, the PLD provider, Twilio, each payment rail, Open Finance,
  biometric KYC, and now the SAML IdP. That's real, usable vendor-dependency
  documentation, not a formal vendor-risk-management program, but a genuinely
  useful input to one.
- **Missing:** a formal vendor risk-assessment process (security
  questionnaires, reviewing each vendor's own SOC 2/ISO 27001 report before
  signing a contract, a vendor inventory with risk tiers and renewal/review
  dates). None of the vendors referenced in this codebase have actually been
  contracted yet — that whole process starts only once real commercial
  relationships exist.

## Additional Trust Services Categories (optional, beyond the Common Criteria)

If a real SOC 2 report also covers these (common for a fintech):

- **Availability** — partially evidenced today: `/status` self-checks
  (`db/systemHealth.ts`), the real load-test baseline
  (`scripts/loadtest/`, ~998 req/s / 0 errors on this sandbox's single
  process), automated backups. Missing: a documented uptime SLA/SLO, a real
  multi-instance/multi-region deployment (today is explicitly
  single-process/SQLite — see `docs/postgres-migration.md`), and a tested
  failover procedure.
- **Confidentiality** — partially evidenced: role-based data access, hashed
  secrets, `sandbox=1` data isolation for test-mode API keys
  (`lib/sandboxData.ts`). Missing: data classification policy, encryption at
  rest (see CC6), and a documented data-retention/destruction schedule beyond
  the LGPD erasure flow that already exists (`db/users.ts`
  `anonymizeUser`).
- **Processing Integrity** — the accounting-style ledger, audit hash chain,
  and Zod validation on every mutating endpoint are real evidence here; a real
  audit would still want documented reconciliation procedures (who checks the
  ledger balances against real bank statements, and how often) once real
  money is actually moving through a contracted PSP.
- **Privacy** — Brazil's LGPD (not US-centric SOC 2 Privacy criteria, but
  covers the same ground and then some) is already meaningfully addressed:
  real data export (`routes/account.ts` LGPD export endpoint) and the
  erasure/anonymization flow above. Missing: a published privacy policy
  document, a documented lawful-basis analysis per data category, and a
  registered DPO (encarregado) if required at the company's real operating
  scale.

## Bottom line / recommended next steps

The **technical** SOC 2 control surface is in unusually good shape for a
prototype — most Common Criteria families have real, working code evidence
already, not just a written policy promising future controls. What's
genuinely missing to go from "gap assessment" to an actual SOC 2 report is,
almost entirely, organizational and procedural:

1. Stand up the missing **written policies** (incident response, access
   review cadence, vendor risk, change management approval) — these are
   documents, not code, and are the fastest wins here.
2. Wire dependency scanning into CI (cheap, immediate, closes a real gap
   in CC7).
3. Once a real legal entity/hosting environment exists: engage a licensed CPA
   firm for a **Type I** report first (a point-in-time design assessment —
   faster and cheaper), then run the required **observation period** (6–12
   months of the Type I controls actually operating) before a **Type II**
   report, which is what most enterprise customers actually ask for in
   procurement.
4. Commission the real third-party penetration test this document and
   `docs/security-review-2026-08.md` both flag as out of reach for a sandbox
   self-review — most auditors expect to see one, even though SOC 2 doesn't
   strictly mandate it.

None of the above can be completed inside this repository — they require a
real company, real infrastructure, and a real independent auditor. This
document's job was narrower and achievable: make sure that when that process
starts, it isn't starting from zero.
