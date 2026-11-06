# Hesba Phase 8 — Infrastructure, Deployment & Recovery Audit

| | |
|---|---|
| Date | 2026-10-12 |
| Code under review | branch `claude/ui-pos-merge-split` @ `8846bce` (working tree; the two pre-existing uncommitted UI edits are irrelevant to infrastructure and untouched) |
| Inputs | Phase 1–7 and 4.5 reports; `Dockerfile`, `docker-compose.prod.yml`, `docker-compose.yml`, `Caddyfile`, `railway.json`, `.dockerignore`, `.gitignore`, `scripts/deploy.sh`, `.github/workflows/ci.yml`, `apps/web/.env.production`; API startup, health, config, Redis/DB clients, migration runner; project docs (`documents/Hesba_Implementation_Roadmap.md`, `documents/Markdown/Hesba_Technical_Architecture.md`) |
| Method | static reading of every deployment artifact; rendering the prod compose **without interpolation** (no secret values); isolated local simulations on throwaway Docker containers and a throwaway API instance (E1–E9, §17) |

**Finding IDs.** Confirmed findings are **INFRA-01 … INFRA-16**; likely, potential and unverified items are **INFRA-Lxx**, **INFRA-Pxx** and **INFRA-Uxx**. Evidence items are **E1 … E9**. Prior-phase IDs are cited and not re-counted.

---

## 1. Executive Summary

**The question:** if a dependency fails, a deploy happens, or data is lost, does Hesba stay correct and can it be recovered?

**Not with the configuration in this repository.**
- There is **no backup, restore or disaster-recovery mechanism** anywhere in the repo. The only references are *unchecked* roadmap items.
- The **only health signal says "ok" while PostgreSQL or Redis is down** (verified at runtime).
- **No monitoring or alerting** would notice the money-related failures Phases 5–7 confirmed.
- The deployment model rebuilds and recreates one fixed container on the server. The shutdown budget the app asks for (25 s) is longer than Docker's kill timeout (10 s documented; **3.1 s observed** on the local Docker 29.7.2).

| # | Finding | Evidence | ID | Sev. |
|---|---|---|---|---|
| 1 | No PostgreSQL backup, WAL archiving, off-site copy, restore procedure or restore test in the repo. Postgres lives on one Docker volume (`postgres_data`). The roadmap's "PG daily snapshots on Railway" and "PG backups verified (download + restore in staging)" are **unchecked**. **RPO / RTO: unknown** | static | **INFRA-01** | **P1** |
| 2 | No monitoring, alerting or error tracking is configured: Sentry is inactive (package absent), there are no metrics or alert rules, logs are stdout at `warn`. None of the confirmed Phase 5–7 failures would page anyone: double charges, skipped billing cycles, wiped schedules, ETA failures, silent email loss, 402 lock-outs | static | **INFRA-02** | **P1** |
| 3 | `/health` is a static liveness response. It returned **200 "ok" with PostgreSQL stopped** (tenant routes 500) and **with Redis stopped** (tenant routes hung > 8 s). It is Railway's deploy health check, so a broken release passes | **runtime** E5 | **INFRA-03** | **P2** |
| 4 | Shutdown deadline mismatch: the app drains for up to 25 s; compose sets no `stop_grace_period`, so Docker SIGKILLs first. That makes BG-01/BG-02 (charge without record, orphaned cycle lock) a normal deploy outcome | **runtime** E3; static | **INFRA-04** | **P2** |
| 5 | Release model: the server builds the working tree into one fixed-name container (no immutable artifact, no zero-downtime, no image rollback). Migrations run at every boot, followed by a plan seed that overwrites admin edits. Tenant migrations start **after** traffic is accepted. No down-migrations | static | **INFRA-05** | **P2** |
| 6 | One Redis holds sessions, queues, schedules, locks, caches and rate-limit state. It is **RDB-only** (`save 3600 1 300 100 60 10000`, `appendonly no`). After data loss all schedules are gone until the next boot and every user is logged out. The password sits in the container command line | **runtime** E2, E6 | **INFRA-06** | **P2** |
| 7 | Production boots with **no** Paymob, Resend, R2, encryption key or `APP_BASE_DOMAIN`; only two of them produce a warning. Without `APP_BASE_DOMAIN`, Caddy's on-demand TLS check rejects every tenant subdomain | **runtime** E7 | **INFRA-07** | **P2** |
| 8 | `.env.production`, the prod compose `env_file` that lives in the repo working tree on the server, is **not git-ignored** and not excluded by `.dockerignore` | static (`git check-ignore`) | **INFRA-08** | **P2** |

Supporting findings, all P3, cover:
- connection budget (INFRA-09)
- proxy trust and tenant TLS (INFRA-10)
- the boot-time owner re-activation (INFRA-11)
- build reproducibility and supply chain (INFRA-12)
- log retention (INFRA-13)
- Railway restart cap (INFRA-14)
- build-time environment coupling (INFRA-15)
- stale/unsafe auxiliary configs (INFRA-16)

**Verified positives:**
- Postgres and Redis are not published by the prod compose; only Caddy exposes 80/443.
- The container runs as an unprivileged user under `tini`.
- SIGTERM sent to the top process **does reach Node through `sh` → `env` → `tsx`** (E4).
- Missing DB URLs or short JWT secrets fail fast (E7).
- Prisma and ioredis reconnect by themselves after PostgreSQL or Redis restarts (E5).
- The dev-only route is excluded from production builds (`App.tsx:77`).

**Severity totals (new IDs):**

| Severity | Count | IDs |
|---|---|---|
| P0 | 0 | — |
| P1 | 2 | INFRA-01, INFRA-02 |
| P2 | 6 | INFRA-03 … INFRA-08 |
| P3 | 8 | INFRA-09 … INFRA-16 |

There is no P0: no confirmed infrastructure defect corrupts data by itself. The P1s mean that **when** the confirmed application defects happen, nobody is told, and lost data cannot be restored.

---

## 2. Scope, Methodology and Limitations

| Method | What it covered |
|---|---|
| Static | every deployment and CI artifact listed above; `apps/api/src/index.ts` startup/shutdown/health/proxy settings; `config/env.ts`, `config/redis.ts`, `config/database.ts`; `packages/database/src/prisma.ts`, `migrate-tenants.ts`, `seeds/master.seed.ts`; `admin.auth.service.ts` (owner seed); project docs for backup/monitoring intent |
| Rendered config | `docker compose -f docker-compose.prod.yml config --no-interpolate` (structure only, no secret values) |
| Runtime (local, throwaway) | Redis 7 defaults under the prod command (E2); Docker stop grace behaviour (E3); the signal path of the Dockerfile `CMD` (E4); the real API's `/health` and a tenant route under PostgreSQL and Redis outages and recovery (E5); Redis data loss vs repeatable schedules (E6); production env validation (E7); connection count (E8) |

**Not done, by design:**
- No access to the production host, Railway, DNS, Caddy's live state or certificates.
- No production data, backups or monitoring dashboards.
- The Docker image was **not built** (it would pull base images and packages from the internet).
- No Caddy binary run (its behaviour is taken from the configuration and Caddy's documented semantics).
- No load testing.

**Unknowns that limit conclusions:**
- **Which deployment is live** — VPS compose with Caddy, or Railway — is unknown. Phase 1 recorded the same unknown, and the two have different proxy chains, restart semantics and backup options.
- Whether the deployed configuration matches the repository is also unknown.
- **RPO and RTO cannot be stated:** no evidence of backups or restore tests exists.

---

## 3. Deployment Topology and Trust Boundaries

**Two parallel deployment definitions exist in the repo:**

| | VPS (`docker-compose.prod.yml` + `Caddyfile`) | Railway (`railway.json`) |
|---|---|---|
| Build | `build: context .` on the host, from the working tree (`docker-compose.prod.yml:35-38`) | Railway builds `Dockerfile` (`railway.json:3-6`) |
| App instances | one, `container_name: hesba_app` (`:39`): fixed name, so it can't scale or overlap | platform-managed (count unknown) |
| Edge | Caddy `:80/:443` (`:57-59`), automatic HTTPS, on-demand TLS for `*.hesbaapp.com` (`Caddyfile:1-20`) | Railway proxy / domains (unknown) |
| Health | Postgres `pg_isready`, Redis `redis-cli ping`; **none for `app`** (E1) | `/health`, 120 s timeout (`railway.json:8-9`) |
| Restart | `unless-stopped` everywhere | `ON_FAILURE`, max 3 retries (`railway.json:10-11`) |
| Postgres / Redis | in compose, `internal` network, **not published** | external (unknown) |
| Secrets | `env_file: .env.production` (`:46`) next to the compose file | platform variables (unknown) |

**Container dependencies (compose).**
- `app` waits for `postgres` and `redis` to be *healthy* (`:41-45`).
- `caddy` waits only for `app` to *start* (`:64-65`); there is no app health condition.
- At runtime nothing restarts `app` when it is unhealthy, because there is no app healthcheck and `/health` can't fail on dependency loss (INFRA-03).

**Exposure:**

| Endpoint | Public? | Notes |
|---|---|---|
| Caddy 80/443 | yes | all hosts `hesbaapp.com`, `www` (redirect), `*.hesbaapp.com` |
| app :3000 | no (`expose` only, `:47-48`) | but reachable through Caddy for every path incl. `/health` (discloses `env` and migration counts) and `/internal/check-tenant` (the on-demand TLS oracle) |
| Postgres 5432, Redis 6379 | no (prod compose) | **dev** compose publishes both on all interfaces, Postgres with the password `password`, Redis without auth (`docker-compose.yml:11-12, 24-25`) — INFRA-16 |

**Process model.** One Node process serves HTTP, the SPA (`NODE_ENV=production`, `index.ts:454-465`) and **five BullMQ workers plus four schedulers** (`index.ts:500-508`; A-01). Consequences:
- The frontend, API and workers cannot fail, scale or restart independently.
- Restarting the API also kills in-flight billing cycles (INFRA-04).

**Start-up order inside the container** (`Dockerfile:88`; `index.ts:466-536`):
1. `prisma migrate deploy` (master schema)
2. `tsx src/seeds/master.seed.ts` — upserts the three plans, overwriting admin edits (D-06)
3. `tsx apps/api/dist/index.js`, which then runs:
   - `seedOwnerFromEnv()` (INFRA-11)
   - `app.listen()` — **traffic accepted here**
   - `migrateAllTenants()`, fire-and-forget (DB-L02)
   - workers and schedules (blocks while Redis is unavailable, BG-09)
EOF
echo ok
---

## 4. Secrets and Environment Configuration

| Item | Finding | Evidence |
|---|---|---|
| Validation at boot | zod schema (`config/env.ts:7-58`): **required** `FRONTEND_URL`, `DATABASE_MASTER_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET` (≥ 32), `JWT_REFRESH_SECRET` (≥ 32, unused, Phase 1); **everything else optional**. Invalid → `process.exit(1)` (`:51-56`) | E7 ✓ fail-fast for mandatory |
| Production warnings | only `APP_ENCRYPTION_KEY` (length < 32 *characters*) and `PAYMOB_HMAC_SECRET` are warned about (`env.ts:70-77`). Paymob API key, integration ids, Resend, R2, `APP_BASE_DOMAIN`, `OWNER_*` are silent | E7 → INFRA-07 |
| Development fallbacks reachable in production | `RESEND_API_KEY` unset → reset links and reminder PII printed to stdout (`email.ts:136, 232, 267, 320`, HSEC-25); `APP_BASE_DOMAIN` unset → `check-tenant` 400 for all hosts (`index.ts:186-191`) → no tenant certificates; ETA base URLs default to the real ETA hosts (`env.ts:47-48`) | static + E7 |
| Secret files | prod compose loads `.env.production` from the compose directory (`docker-compose.prod.yml:46`). **`.gitignore` covers `.env`, `.env.local`, `.env.*.local` but not `.env.production`** (`.gitignore` lines 6-8; `git check-ignore .env.production` → not ignored). `.dockerignore` excludes `**/.env`, `**/.env.local` only (`.dockerignore:7-8`). The Dockerfile copies only `packages/` and `apps/` (`Dockerfile:19-20`), so a root `.env.production` is not baked into the image today | INFRA-08 |
| Secrets on command lines | `redis-server --requirepass ${REDIS_PASSWORD}` and `redis-cli -a ${REDIS_PASSWORD}` (`docker-compose.prod.yml:24, 28`) → visible in `docker inspect` (E2) and in compose renderings | E2 |
| Secrets in env for ever | `OWNER_PASSWORD` must stay in the environment; every boot re-hashes it if it changed and **forces `role: OWNER, isActive: true`** (`admin.auth.service.ts:87-113`) | INFRA-11 |
| Key rotation | `APP_ENCRYPTION_KEY` ciphertext has no key id (INT-09); JWT single secret, no `kid` (Phase 2) | unchanged |
| Committed config | `.env.example` holds empty placeholders (Phase 6); `apps/web/.env.production` holds only `VITE_BASE_DOMAIN` (committed, non-secret) | static |
| Environment separation | no staging definition anywhere; `VITE_BASE_DOMAIN` is baked from the committed `apps/web/.env.production` at build time (`Dockerfile:26`), so any non-production build redirects logins to the production domain (`Login.tsx:74-81`) | INFRA-15 |
| Build artifacts | the web bundle contains only `VITE_*` values; the API image contains no `.env` (`.dockerignore`) | static ✓ |

---

## 5. TLS, Proxy and Tenant-Domain Handling

| Topic | Configuration evidence | Assessment |
|---|---|---|
| Certificates | Caddy automatic HTTPS for `hesbaapp.com`, `www.hesbaapp.com`; **on-demand** TLS for `*.hesbaapp.com` gated by `ask http://app:3000/internal/check-tenant` (`Caddyfile:1-5, 15-20`). Certificates are stored on the `caddy_data` volume (`docker-compose.prod.yml:62`) | ✓ storage persists across restarts. **Renewal status, ACME account, DNS: unverified** |
| HTTP → HTTPS | Caddy redirects HTTP to HTTPS for all named sites by default; `www` → apex 301 (`Caddyfile:11-13`) | ✓ (Caddy documented default) |
| HSTS | from `@fastify/helmet` defaults (registered at `index.ts:81-96`); not set at the Caddy layer | ✓ (app-level) |
| On-demand issuance gate | `check-tenant` returns 200 for **any** `*.<APP_BASE_DOMAIN>` host without a tenant lookup (`index.ts:186-191`) — HSEC-20. With `APP_BASE_DOMAIN` unset, it returns 400 for every host → tenant subdomains get no certificate (INFRA-07) | unchanged / new failure mode |
| Proxy trust | Fastify is created **without `trustProxy`** (`index.ts:42-60`). Behind Caddy, `request.ip` is the Caddy container address, so per-IP rate limits become global and audit IPs record the proxy (HSEC-18). On Railway there is a different proxy chain, equally untrusted | HSEC-18 re-confirmed by config; INFRA-10 |
| Host / tenant resolution | Caddy's `reverse_proxy` forwards the original `Host`; the tenant middleware strips the port and takes the first label, or `X-Tenant-Subdomain` on the bare base domain / non-base hosts (`tenant.middleware.ts:20-44`). Hosts under a **different** domain resolve their first label as a tenant (e.g. `127.0.0.1` → tenant "127", observed in Phase 7) | correct for the intended topology; first-label fallback is a footgun on mis-routed hosts (INFRA-10) |
| Proxy timeouts / limits | Caddy defaults (no `reverse_proxy` timeouts, no request size or rate limits); Fastify `requestTimeout` 0 (Phase 4) | hung upstream requests are held open indefinitely (DB-09 amplifier) |

DNS records, the Cloudflare/hosting setup, and whether Railway or the VPS terminates TLS are **not visible** in the repository (INFRA-U01).

---

## 6. PostgreSQL and Migration Safety

| Topic | Finding | Evidence / prior |
|---|---|---|
| Master migrations | `prisma migrate deploy` at every container start, before the app (`Dockerfile:88`). Prisma serialises concurrent `migrate deploy` with an advisory lock (documented behaviour; not run). Master data-fix migrations hard-code one tenant (D-07); no `migration_lock.toml` (D-08) | static |
| Boot seed | `master.seed.ts` upserts the three plans with `update: plan` (`master.seed.ts:93-96`) on every start, **reverting admin plan edits** (D-06) | static |
| Tenant migrations | `migrateAllTenants()` runs **after** `listen` (`index.ts:472, 484`), tenant by tenant, per-schema advisory lock (`migrate-tenants.ts:66-80`). Each file is atomic, but the `schema_version` bump is outside it (D-05/DB-21). Files 001/002/016 aren't re-runnable (DB-21). Requests reach tenants whose schema is still behind the new code (DB-L02). Per-tenant failures make `/health` 503 only when **all** fail (`index.ts:166-175`; A-07) | static + Phase 4 |
| Master ↔ tenant interaction | a master migration and the tenant sweep are not coordinated: the master schema moves first (container start), tenant schemas later (post-listen, fire-and-forget). Code expecting both shapes runs in between | static |
| Schema drift | ETA raw SQL vs migrations (E-01/DB-23) and the `uuid = text` blocker (INT-01) are **unchanged** (no commits since). CI's parity test compares table names only (Phase 1) | Phase 6 |
| Provisioning atomicity | multi-commit signup with in-memory compensation (DB-22); a DB blip during signup leaves an orphan (Phase 4 M6). Unchanged; infrastructure adds no retry or cleanup job | Phase 4 |
| Rollback | no down migrations (Prisma) and no reverse tenant SQL. Rolling back the **image** after a schema change runs old code on the new schema. Nothing documents a rollback procedure | INFRA-05 |
| Connection limits / pools | compose runs Postgres with defaults (`max_connections 100`, E8). The API process has **two master Prisma clients**: `config/database.ts:6-9` and `packages/database/src/prisma.ts:5-9` (used by `migrate-tenants.ts` and `seedOwnerFromEnv`). Neither sets `connection_limit`, so each gets the Prisma default `num_cpus × 2 + 1`, plus up to 50 tenant clients × 5 (DB-20), plus a dedicated client per tenant migration. No PgBouncer | INFRA-09 |
| Timeouts | no `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout` in the compose or connection strings (DB-31) | Phase 4 |
| Data durability | a single named volume `postgres_data` (`docker-compose.prod.yml:10-11, 70`); no replication, WAL archiving or backup service | INFRA-01 |

---

## 7. Redis and Queue Recovery

| Topic | Finding | Evidence |
|---|---|---|
| Role | one Redis for BullMQ queues, repeatable schedules and job locks; app cycle locks (`lock:*`); tenant and subscription caches; **refresh-token sessions**; rate-limit counters | Phases 1/4/5 |
| Persistence | prod command adds only `--requirepass` (`docker-compose.prod.yml:24`); effective config **RDB-only**: `save 3600 1 300 100 60 10000`, `appendonly no` (E2). Under low write rates a crash can lose up to **one hour** of writes (sessions, job state, `lock:*` keys) | E2 |
| Eviction | `maxmemory 0`, `noeviction` (E2): correct for BullMQ; memory growth is unbounded (no limit, no alert) | E2 |
| Restart **with** data (RDB) | schedules survive. Locks survive too: a `lock:*` held by a killed process persists until its TTL (BG-02) | Phase 5 |
| Restart **without** data | repeatable schedules **0** afterwards; nothing re-registers them until the next app boot (E6, BG-12); all users logged out; rate limits reset | E6 |
| Outage | tenant requests hang (no `maxRetriesPerRequest` / offline-queue limits, DB-09); `/health` still 200 (E5); boot blocks on the first schedule registration (BG-09); recovery is automatic on reconnect (E5) | E5 |
| Connection settings | single shared ioredis client, `maxRetriesPerRequest: null`, `lazyConnect` (`config/redis.ts:4-7`); no `connectTimeout`/`commandTimeout` | static |
| Job/lock recovery after a process restart | BullMQ moves stalled jobs back to wait after ~30 s; the app's own cycle lock defeats that recovery (BG-02). Billing cycles interrupted by a deploy resume **the next day** | Phase 5 X5/X6 |
| What is lost or delayed | **process restart:** in-flight cycles skipped until the next tick; the in-flight Paymob charge has no record (BG-01). **Redis data loss:** all schedules until restart; queued ETA jobs; sessions; locks. **Prolonged outage:** all tenant traffic and all jobs stall; on recovery the offline queue flushes at once (DB-09) | combined |

---

## 8. Process Lifecycle and Deployment Overlap

| Step | Behaviour | Evidence |
|---|---|---|
| Signal delivery | `tini` (`Dockerfile:82`) → `sh -c` → `exec env` → `tsx` CLI → child Node. SIGTERM to the top process **reaches the app's handler** (tsx relays it) | E4 ✓ |
| Shutdown routine | `app.close()` (stops accepting, drains HTTP), then `worker.close()` for the five workers (waits for active jobs), with a **25 s** forced `process.exit(1)` (`index.ts:516-536`) | static; Phase 5 X6 (25.0 s forced exit) |
| Platform kill deadline | compose sets no `stop_grace_period` (E1), so Docker's default applies: **10 s documented; 3.1 s observed** on the local Docker 29.7.2 with no `StopTimeout` (E3). Railway's drain/overlap timing is not configured in `railway.json` | INFRA-04 |
| In-flight external calls | Paymob/ETA/Resend calls have no timeout (≈ 300 s undici default, BG-04), so any deploy that lands during a billing cycle kills it mid-call → unrecorded charge (BG-01) and an orphaned `lock:*-cycle` (BG-02) | Phases 5/6 |
| Readiness vs liveness | one endpoint, `/health`: no dependency checks; 200 while tenant migrations are `pending` or `partial`; 503 only when all fail (`index.ts:166-183`). Traffic reaches the app right after `listen`, **before** tenant migrations and **before** workers are registered (`index.ts:472-508`) | E5; INFRA-03 |
| Old/new overlap (compose) | `docker compose up -d --build` recreates `hesba_app` (fixed `container_name`): the old container stops, then the new one migrates and starts. **Downtime** for the whole boot (migrate + seed + listen), no overlap | static (INFRA-05) |
| Old/new overlap (Railway) | Railway starts the new deployment and switches traffic when `/health` returns 200; the old one keeps running until then. While both run, **both instances run all workers and register schedules** (cross-instance safety relies on `withLock`, BG-02/L5-01), and the old code runs against the master schema the new container just migrated | INFRA-L01 (platform behaviour unverified) |
| Migration compatibility | no expand/contract discipline is documented; migrations are applied by whichever container starts first | INFRA-05 |

---

## 9. Backup and Disaster Recovery Assessment

| Asset | Where it lives | Backup in repo / config | Restore procedure | Restore tested | Notes |
|---|---|---|---|---|---|
| Master DB (tenants, plans, **subscriptions, payment attempts**) | `postgres_data` volume (VPS) or the Railway DB | **none** | none | **no evidence** | payment history is the only local evidence of charges (BG-11) |
| Tenant schemas (all sales, stock, customers, installments, audit logs) | same database, one schema per tenant | **none**; the ADR's "independent backup per tenant" (`Hesba_Technical_Architecture.md:89`) is not implemented | none | no | a per-tenant restore requires schema-level dump/restore tooling that doesn't exist |
| Redis (sessions, queues, schedules, locks) | `redis_data` volume (RDB) | RDB snapshot only (E2) | implicit (load `dump.rdb`) | no | schedules self-heal only on app boot (E6) |
| Uploaded files | Cloudflare R2 (presigned, Phase 6) | provider-side only | none | no | not reachable from the UI today (INT-06) |
| Certificates | `caddy_data` volume | none | re-issuance (ACME) | no | on-demand issuance would retry per tenant host |
| Secrets | `.env.production` on the host / Railway variables | none documented | none | no | loss of `APP_ENCRYPTION_KEY` makes stored ETA credentials unrecoverable (INT-09) |
| Payment state | master DB + Paymob dashboard | — | reconciliation does not exist (BG-11) | — | after a DB restore, payments made since the snapshot exist only at Paymob |

**Documented intent vs evidence.** The roadmap's Step 14 lists:
- "Backup: PG daily snapshots configured on Railway" (`Hesba_Implementation_Roadmap.md:835`)
- "PG backups verified (download + restore in staging)" (`:844`)
- "backups working" (`:883`)

**All three are unchecked `- [ ]`**, and Sentry ("Sentry receiving events", `:843`) is unchecked too.

**Assessment:**
- No backup is evidenced.
- No restore has been tested.
- **RPO and RTO are unknown.**
- A loss of the Postgres volume or of the database service would lose every tenant's financial records and the platform's subscription state (INFRA-01).

---

## 10. Logging, Monitoring and Incident Response

| Signal | Configured? | Would it detect…? |
|---|---|---|
| Error tracking | Sentry plugin present but `@sentry/node` not installed (`sentry.plugin.ts:9-41`, A-08); the roadmap item "Sentry receiving events" is unchecked | — |
| Application logs | pino JSON to stdout; **level `warn` outside development** (`index.ts:44`), so no request logs; job logs via `console.*` | errors only; no correlation ids (BG-15) |
| Log retention | compose defines no `logging` (E1), so Docker's default `json-file` driver applies with no rotation configured → unbounded disk use on the VPS | INFRA-13 |
| Health | `/health` (static, INFRA-03); Railway uses it only at deploy time; no external uptime monitor configured in the repo | outages ✗ |
| DB / Redis / disk / pool | no exporters, no metrics, no alerts | pool exhaustion (DB-20/31) ✗, Redis memory ✗, disk ✗ |
| Queue lag / job failures | none (no `QueueEvents`, no failed-job alerting; billing jobs deleted on completion, BG-15) | skipped billing cycles (BG-02) ✗ |
| Payment reconciliation | `reconcilePayments` placeholder, no caller (BG-11) | double charges (BG-01) ✗ |
| Email delivery | failures are invisible (BG-05) | ✗ |
| ETA | `eta_status` columns only; no alert | INT-01/03 ✗ |
| Subscription anomalies | none | INT-04 "free forever" ✗; FIN-16 ✗ |

**Detection of confirmed Phase 5–7 failures:**

| Failure | Detected by today's configuration? | Who is alerted? |
|---|---|---|
| Duplicate Paymob charge (BG-01) | no (no record, no reconciliation) | customer complaint |
| Billing cycle skipped after a deploy/crash (BG-02) | only an `info` line, not emitted at `warn` level | nobody |
| Schedules wiped (BG-12) | no | nobody |
| Redis outage (DB-09) | `/health` stays 200 | nobody until users report |
| PostgreSQL outage | `/health` stays 200; errors logged at `error` level to stdout | nobody unless someone reads logs |
| Email failures (BG-05) | no | nobody |
| ETA pipeline dead (INT-01) | no | nobody |
| Cashier can't sell (UX-03) / suspended store sees empty app (UX-08) | no | store owner calls support |

**Incident response.** There are no runbooks, on-call definition or escalation path in the repository. One mechanism interferes with incident response: the owner seed re-activates and re-promotes the platform OWNER on every restart (INFRA-11).

**Configured vs verified.** Nothing is configured to alert, so nothing can have been verified to alert.

---

## 11. Build and Release Safety

| Topic | Finding | Evidence |
|---|---|---|
| Lockfile | `pnpm-lock.yaml` + `pnpm install --frozen-lockfile` in Docker and CI ✓ | `Dockerfile:13, 51`; `ci.yml:33` |
| Tool pinning | `corepack prepare pnpm@10` (floating minor) vs `packageManager: pnpm@10.33.2`; **`npm install -g prisma@5 tsx@4 … 2>/dev/null`** (floating, errors hidden) | `Dockerfile:2, 34, 39`; `package.json:5` |
| Base images | floating tags `node:20-alpine`, `postgres:16-alpine`, `redis:7-alpine`, `caddy:2-alpine`; no digests | `Dockerfile:1, 33`; compose |
| Runtime parity | CI type-checks and builds on **Node 22**; production runs **Node 20** (`ci.yml:9-15`) | static |
| CI coverage | type-check, lint, unit tests, `vite build` + `tsc` ✓. **No Docker image build**, no migration run against a database, no integration/E2E tests, no deploy job (`ci.yml:17-119`). The Dockerfile and the boot sequence are first exercised in production | INFRA-12 |
| Action pinning | `actions/checkout@v5`, `pnpm/action-setup@v4`, `actions/setup-node@v5`: tags, not SHAs | `ci.yml:22, 26, 28` |
| Artifact provenance | compose builds from the host's working tree (`docker-compose.prod.yml:36-38`), so uncommitted edits ship and there is no image registry or tag. Railway builds from git (commit-bound) | INFRA-05 |
| Migration ordering | master migrations and seed **before** the app; tenant migrations **after** traffic; no down-migrations | INFRA-05 |
| Rollback | no previous image to roll back to (compose); a schema rollback is impossible | INFRA-05 |
| Release health gate | Railway `/health` passes with broken dependencies or partial tenant migrations (E5; A-07) | INFRA-03 |
| Dev settings in prod | `/dev/components` excluded by `import.meta.env.DEV` (`App.tsx:16, 77-78`) ✓; no debug API routes found; `scripts/deploy.sh` (unused) would run TypeScript **source** via tsx (`scripts/deploy.sh:10`) | INFRA-16 |
| Runtime execution | compiled JS is started through `tsx` (`Dockerfile:88`) rather than `node`, adding a loader process (signal relay verified, E4) | static |

---

## 12. Cross-Phase Operational Risks

| Infrastructure condition | Triggers or amplifies | Distinct infra root cause |
|---|---|---|
| Deploy or restart during 07:00–08:25 (UTC) billing cycles | BG-01 duplicate charges (charge taken, process killed before the DB write; next-day re-charge) and BG-02 (orphaned cycle lock → the remaining tenants skipped) | INFRA-04 (kill deadline < drain), INFRA-05 (no deploy windows / drain), INFRA-02 (no alert) |
| Redis restart without data / volume loss | BG-12 (schedules gone → renewal, dunning, trial expiry, sweep stop), all sessions lost, locks lost | INFRA-06 (RDB-only, no schedule self-heal, no alert) |
| Redis outage | DB-09 (all tenant requests hang); orchestrator sees `/health` 200 and never restarts; on recovery a burst of queued requests → duplicate sales (DB-10) | INFRA-03 |
| PostgreSQL outage at boot | `prisma migrate deploy` fails → container exits; compose retries forever; **Railway stops after 3 retries** | INFRA-14 |
| PostgreSQL outage at runtime | 500s on all routes; `/health` 200; signup mid-provisioning leaves an orphan tenant (DB-22) | INFRA-03 |
| Connection exhaustion under load | DB-20/31 (`too many clients`): affects login, webhooks, jobs | INFRA-09 (two master pools, no pooler, default `max_connections`) |
| Missing production config | Paymob unset → billing jobs fail "transiently" every day (INT-09); Resend unset → reset links in logs (HSEC-25); `APP_BASE_DOMAIN` unset → tenant TLS fails | INFRA-07 |
| Rolling deploy with a schema change | old code vs new schema; tenant schemas behind (DB-L02); ETA columns already drift (DB-23/INT-01) | INFRA-05 |
| Silent failures (email, ETA, reminders) | BG-05, INT-01/03, HSEC-05 never surface | INFRA-02 |
| Stale frontend after deploy | the service worker keeps cached hashed assets; HTML is network-first (`sw.js:23-66`), so a new deploy reaches users on the next navigation ✓. Long-lived tabs keep running the old bundle against the new API (no version check) | INFRA-P02 |
| Container timezone UTC (no `TZ`) | cron at 06:00–09:00 UTC; UX-07 / DB-38 day boundaries | already reported (BG-14, UX-07) |

---

## 13. Confirmed Findings

### INFRA-01 — No backup, restore or disaster-recovery mechanism exists; recovery has never been tested · **P1**

| Field | Detail |
|---|---|
| Confidence | **Confirmed** for the repository; the existence of platform-side snapshots (Railway / VPS provider) is **unverified** |
| Environment / components | production PostgreSQL (master + every tenant schema), Redis, Caddy certificates, secrets |
| Files | `docker-compose.prod.yml:2-18, 69-73` (single `postgres_data` volume, no backup service); `documents/Hesba_Implementation_Roadmap.md:835, 843-844, 883-884` (backup and Sentry items unchecked); `documents/Markdown/Hesba_Technical_Architecture.md:89` (per-tenant backup promised by the ADR) |
| Evidence | repository-wide search for `pg_dump`, `backup`, `restore`, `WAL`, `snapshot`: no scripts, services, cron jobs or docs other than the unchecked roadmap lines |
| Failure mode / impact | volume corruption, host loss, accidental `docker compose down -v`, or a bad migration → **all tenants' invoices, stock, installments and customer credit, plus every subscription and payment record, are unrecoverable**. Per-tenant restores (one store's mistake) are impossible |
| Recovery behaviour | none defined. **RPO / RTO unknown**. Not verified (nothing to verify) |
| Remediation | automated physical backups with PITR (WAL archiving, e.g. pgBackRest/WAL-G, or the managed provider's PITR); encrypted off-site copies; documented per-tenant logical restore (`pg_dump -n tenant_x`); quarterly restore drills into an isolated environment with recorded RPO/RTO; back up `.env.production` / the secret store, including `APP_ENCRYPTION_KEY` |
| Related | DB-22 (orphans), BG-11 (no payment reconciliation after restore), INT-09 (key loss) |
| Test | restore drill: restore the latest backup into an isolated stack, run `migrate deploy`, verify row counts per tenant schema and the latest `payment_attempts` timestamp; record achieved RPO/RTO |

### INFRA-02 — No monitoring, alerting or error tracking; confirmed money-path failures would go unnoticed · **P1**

| Field | Detail |
|---|---|
| Confidence | **Confirmed** (configuration); monitoring outside the repository (e.g. an external uptime service) is unverified |
| Environment / components | API process, workers, Redis, PostgreSQL, host |
| Files | `apps/api/src/shared/plugins/sentry.plugin.ts:9-41` (package absent → inert); `apps/api/src/index.ts:44` (log level `warn` outside development); `docker-compose.prod.yml` (no exporters, no logging config, E1); `apps/api/src/jobs/dunning.job.ts:167-173` (reconciliation placeholder) |
| Evidence | §10 detection matrix; E1; Phase 5/6/7 failures with no signal path |
| Failure mode / impact | double charges, skipped billing days, wiped schedules, dead ETA, silent email loss and store lock-outs persist until customers complain. Mean time to detect is unbounded |
| Recovery behaviour | n/a: detection is the missing step |
| Remediation | error tracking (install Sentry or equivalent); a metrics endpoint (queue depth, failed jobs, cycle completion timestamps, DB pool waits, Redis memory); alerts on "billing cycle not completed in 26 h", failed jobs, 5xx rate, `/health` failure from an external probe, disk > 80 %; a daily reconciliation job comparing Paymob with `payment_attempts` (BG-11); runbooks |
| Related | A-08, BG-11, BG-15, INT-02/03, UX-08 |
| Test | game day: stop Redis for 2 minutes and kill the app during a renewal cycle in staging; alerts must fire within N minutes for both |

### INFRA-03 — `/health` reports "ok" while PostgreSQL or Redis is down; it is also the deploy gate · **P2**

| Field | Detail |
|---|---|
| Confidence | **Confirmed (runtime)** |
| Environment / components | API; Railway deploy health check; any external probe |
| Files | `apps/api/src/index.ts:166-183` (static response; 503 only when all tenant migrations failed); `railway.json:8-9` |
| Evidence | E5: with PostgreSQL stopped, `/health` 200 while a tenant route returned 500; with Redis stopped, `/health` 200 while a tenant route hung > 8 s |
| Safe reproduction | throwaway stack: start the API, `docker stop` the DB or Redis container, `curl /health` |
| Failure mode / impact | orchestrators keep routing to a broken instance and never restart it; a release whose dependencies are unreachable passes Railway's gate; requests are served before tenant migrations and workers are ready |
| Recovery behaviour | dependencies recover on their own (E5); nothing restarts a wedged process (e.g. blocked at boot, BG-09) |
| Remediation | split `/livez` (process alive) from `/readyz` (DB `SELECT 1` with timeout, Redis `PING` with timeout, tenant migrations finished, workers registered); use `/readyz` for deploy and traffic gating, with an app healthcheck in compose |
| Related | A-07, DB-09, BG-09, DB-L02 |
| Test | integration: with Redis stopped, `/readyz` → 503 within 2 s; during a pending tenant migration, `/readyz` → 503 |

### INFRA-04 — The platform kills the app before its 25 s graceful shutdown completes · **P2**

| Field | Detail |
|---|---|
| Confidence | **Confirmed**: the compose has no `stop_grace_period` (E1); Docker's kill timing was measured locally (E3); the app budget is in code |
| Environment / components | VPS compose (Docker); Railway (drain timing unconfigured, unverified) |
| Files | `docker-compose.prod.yml:35-51` (no `stop_grace_period`); `apps/api/src/index.ts:516-536` (25 s budget); `Dockerfile:82, 88` (tini → sh → tsx) |
| Evidence | E3: a 25 s SIGTERM handler was SIGKILLed after 3.1 s (Docker 29.7.2 default), 10.1 s (`--stop-timeout 10`), and finished at 26.0 s only with `-t 30`. E4: the signal does reach Node. Phase 5 X5/X6: a kill mid-cycle leaves an unrecorded charge and an orphaned cycle lock |
| Failure mode / impact | every deploy or restart during the 07:00–08:25 UTC billing windows can create duplicate charges the next day (BG-01) and skip the remaining tenants' renewals and dunning for a day (BG-02); in-flight HTTP requests are cut |
| Recovery behaviour | the next daily tick; nothing records the interruption |
| Remediation | `stop_grace_period` (and the Railway equivalent) ≥ the app budget plus margin; deploy windows outside billing cycles; per-call timeouts so draining actually completes (BG-04); BG-01/BG-02 application fixes remain the real cure |
| Related | BG-01, BG-02, BG-04, L5-01 |
| Test | staging: start a renewal cycle with a slow mock Paymob, `docker compose up -d` a new build, assert the old container exits with code 0 and no `lock:*-cycle` key remains |

### INFRA-05 — The release model has no immutable artifact, no zero-downtime path and no rollback; migrations are coupled to boot · **P2**

| Field | Detail |
|---|---|
| Confidence | **Confirmed** (static) |
| Environment / components | VPS compose; Railway |
| Files | `docker-compose.prod.yml:35-39` (`build: .`, fixed `container_name`); `Dockerfile:88` (migrate → seed → app on every start); `packages/database/src/seeds/master.seed.ts:93-96` (plan overwrite); `apps/api/src/index.ts:472, 484` (listen before tenant migrations); `packages/database/prisma/migrations/` (no down migrations) |
| Evidence | §8, §11 |
| Failure mode / impact | each deploy is a stop-then-start with downtime (compose); what ships is whatever is on the host's disk; admin plan edits are reverted on every restart (D-06); a failed master migration loops the container; tenant schemas lag the code (DB-L02); rolling back the image after a migration runs old code on a new schema; Railway overlaps two versions running all workers |
| Recovery behaviour | manual; no documented procedure; not verified |
| Remediation | build images in CI, tag by commit, push to a registry, deploy by tag; run migrations as a separate one-shot release step (expand/contract); finish tenant migrations before readiness; stop the boot-time plan overwrite (seed only on empty); a runbook for rollback |
| Related | D-05/06/07/08, DB-21, DB-L02, A-01 |
| Test | CI job: build the image, start it against a migrated database, hit `/readyz`; a migration test applying all master + tenant migrations to an empty and to a previous-version database |

### INFRA-06 — Redis is a single, RDB-only store for sessions, queues, schedules and locks · **P2**

| Field | Detail |
|---|---|
| Confidence | **Confirmed (runtime)** for defaults and schedule loss; the deployed Redis configuration is unverified |
| Environment / components | VPS Redis (`redis_data`); Railway Redis (unknown) |
| Files | `docker-compose.prod.yml:20-33`; `apps/api/src/config/redis.ts:4-7`; `jobs/*.ts` `schedule*()` (boot-only registration) |
| Evidence | E2 (`save 3600 1 300 100 60 10000`, `appendonly no`, `noeviction`, password in `docker inspect`); E6 (0 repeatables after a data-less restart; no re-registration); Phase 5 X2 |
| Failure mode / impact | a crash loses up to ~1 h of writes; a data-less restart stops billing until the next deploy and logs out every user; locks and sessions are lost |
| Recovery behaviour | schedules return only on app restart; sessions require re-login. Verified for schedules (E6) |
| Remediation | AOF `everysec` (or managed Redis with persistence); re-assert schedules on Redis `ready` (BG-12); separate request-path and BullMQ connections with timeouts (DB-09); pass the password via `REDISCLI_AUTH` / a config file, not argv; Redis memory and persistence alerts |
| Related | DB-09, BG-09, BG-12, HSEC-28 |
| Test | staging: `redis-cli SHUTDOWN NOSAVE` then start → within N minutes `bull:renewal:repeat` exists again and an alert fired |

### INFRA-07 — Production starts without critical integration configuration; only two settings are warned about · **P2**

| Field | Detail |
|---|---|
| Confidence | **Confirmed (runtime)** |
| Files | `apps/api/src/config/env.ts:7-58, 70-77`; `apps/api/src/index.ts:186-191` (`check-tenant` with no base domain → 400); `shared/utils/email.ts:136, 232, 267, 320` (stdout fallback) |
| Evidence | E7: `NODE_ENV=production` boots with Paymob, Resend, R2, encryption key and `APP_BASE_DOMAIN` all blank; the warning names only `APP_ENCRYPTION_KEY, PAYMOB_HMAC_SECRET` |
| Failure mode / impact | a mis-provisioned deploy looks healthy but cannot bill (every cycle fails "transiently"), cannot email (and leaks reset links to logs), and cannot issue tenant certificates |
| Recovery behaviour | manual, after someone notices (INFRA-02) |
| Remediation | in production, fail fast unless each enabled feature's full configuration is present (or explicitly disabled by a flag); log a startup configuration summary (names, not values) |
| Related | INT-09, HSEC-25, HSEC-20 |
| Test | unit: `NODE_ENV=production` with `RESEND_API_KEY` unset and no `EMAIL_DISABLED=true` → exit 1 |

### INFRA-08 — The production secrets file is not git-ignored · **P2**

| Field | Detail |
|---|---|
| Confidence | **Confirmed** (ignore rules); an actual leak is **not** observed (no `.env.production` exists in this checkout or in git history) |
| Files | `docker-compose.prod.yml:46` (`env_file: .env.production`, relative to the repo root); `.gitignore` lines 6-8 (`.env`, `.env.local`, `.env.*.local` only); `.dockerignore:7-8` |
| Evidence | `git check-ignore -v .env.production` → not ignored; `git log --all -- .env` empty (Phase 6) |
| Failure mode / impact | on the VPS the secrets file sits inside the git working tree as an untracked file, so one `git add -A` / `git commit -a` publishes database, Redis, JWT, Paymob, Resend, R2, encryption and owner credentials. A future `COPY . .` would bake it into images |
| Recovery behaviour | secret rotation across every provider; not verified |
| Remediation | add `.env.production` (and `.env.*`) to `.gitignore` and `.dockerignore`; keep secrets outside the repo directory or in a secret manager; add a pre-commit secret scanner |
| Related | Phase 6 §16 |
| Test | CI: `git check-ignore .env.production` must succeed; gitleaks in CI |

### INFRA-09 — Connection budget: two master pools, default `max_connections`, no pooler · **P3**

| Field | Detail |
|---|---|
| Confidence | **Confirmed** (static); peak usage not load-tested |
| Files | `apps/api/src/config/database.ts:6-9, 16-17, 29-41`; `packages/database/src/prisma.ts:5-9`; `packages/database/src/migrate-tenants.ts:28-35, 70`; `docker-compose.prod.yml:2-18` (no Postgres tuning) |
| Evidence | E8 (`max_connections 100`, 3 reserved; Prisma default pool `num_cpus × 2 + 1` per client without `connection_limit`) |
| Failure mode / impact | under concurrent tenants, `too many clients` hits login, webhooks and jobs together (DB-20). The second master client adds a full default pool. Migrations and provisioning open extra clients |
| Recovery | self-heals when load drops; not verified under load |
| Remediation | one master client; explicit `connection_limit` on every URL; PgBouncer (transaction mode) or a managed pooler; size `max_connections` and alert on pool waits |
| Related | DB-20, DB-29, DB-31 |
| Test | load test: 30 concurrent tenants × 3 requests → no `P2024`/`too many clients` errors |

### INFRA-10 — Proxy trust and tenant-host handling are not configured for either deployment path · **P3**

| Field | Detail |
|---|---|
| Confidence | **Confirmed** (static) |
| Files | `apps/api/src/index.ts:42-60` (no `trustProxy`), `:186-191` (`check-tenant`); `Caddyfile:1-20`; `apps/api/src/shared/middleware/tenant.middleware.ts:20-44` (first-label fallback) |
| Failure mode / impact | rate limits keyed to the proxy (HSEC-18); certificate issuance for any subdomain (HSEC-20); hosts outside the base domain resolve their first label as a tenant |
| Remediation | `trustProxy` set to the exact proxy hop(s) per platform; an `ask` endpoint that checks an ACTIVE tenant (cached); reject hosts outside `APP_BASE_DOMAIN` in production |
| Related | HSEC-18, HSEC-20, A-02 |
| Test | request through Caddy with `X-Forwarded-For` → the rate-limit key equals the client IP; `ask?domain=nonexistent.hesbaapp.com` → 400 |

### INFRA-11 — The boot-time owner seed re-activates and re-promotes the platform OWNER from environment variables · **P3**

| Field | Detail |
|---|---|
| Confidence | **Confirmed** (static; Phase 1 observation, rated here) |
| Files | `apps/api/src/modules/admin/admin.auth.service.ts:87-113`; `apps/api/src/index.ts:470` |
| Failure mode / impact | deactivating or demoting a compromised OWNER account is undone by the next restart (`isActive: true, role: 'OWNER'`); the password must live in the environment indefinitely |
| Remediation | seed only when no OWNER exists; never re-activate; rotate via a one-off command |
| Test | deactivate the owner, restart → still deactivated |

### INFRA-12 — Build reproducibility and supply-chain controls are weak, and the image is never built in CI · **P3**

| Field | Detail |
|---|---|
| Confidence | **Confirmed** (static) |
| Files | `Dockerfile:1-2, 33-34, 39`; `docker-compose.prod.yml:3, 21, 54`; `.github/workflows/ci.yml:9-15, 17-119`; `package.json:5` |
| Failure mode / impact | floating base images and global CLIs (errors suppressed by `2>/dev/null`) can change between builds; CI on Node 22 vs runtime Node 20; a broken Dockerfile or boot sequence is discovered in production |
| Remediation | pin images by digest; pin `prisma`/`tsx` versions to the lockfile's; a CI job that builds the image and boots it against Postgres + Redis; pin Actions by SHA |
| Test | CI image build and smoke boot |

### INFRA-13 — Log retention and shipping are not configured · **P3**

| Field | Detail |
|---|---|
| Confidence | **Confirmed** (static) |
| Files | `docker-compose.prod.yml` (no `logging`, E1); `apps/api/src/index.ts:42-60` |
| Failure mode / impact | Docker `json-file` logs grow without rotation and can fill the VPS disk (stopping Postgres and Redis with it); there is no central store for investigations; production level `warn` drops request context |
| Remediation | `logging: { driver: json-file, options: { max-size, max-file } }` or a shipping driver; structured request logs at `info` with redaction |

### INFRA-14 — Railway restart policy gives up after three failures · **P3**

| Field | Detail |
|---|---|
| Confidence | **Confirmed** (configuration); platform behaviour per Railway's documented semantics, not exercised |
| Files | `railway.json:10-11`; `Dockerfile:88` (a migrate failure exits the container) |
| Failure mode / impact | a database unavailable for longer than three restart attempts at boot leaves the service down until someone intervenes |
| Remediation | `ALWAYS` restarts with backoff, or a boot loop that waits for the DB; alert on deploy failure |

### INFRA-15 — The frontend's base domain is baked at build time from a committed production file · **P3**

| Field | Detail |
|---|---|
| Confidence | **Confirmed** (static) |
| Files | `apps/web/.env.production` (`VITE_BASE_DOMAIN`); `Dockerfile:26`; `apps/web/src/pages/auth/Login.tsx:74-81` |
| Failure mode / impact | any non-production deployment built from the repo sends logins to production tenant subdomains, so no safe staging environment can exist without code changes |
| Remediation | runtime config (served `/config.json`) or a per-environment build argument |

### INFRA-16 — Auxiliary configs are stale or unsafe if reused · **P3**

| Field | Detail |
|---|---|
| Confidence | **Confirmed** (static) |
| Files | `scripts/deploy.sh:1-10` (unreferenced; runs TS source with tsx); `docker-compose.yml:11-12, 24-25` (dev Postgres `password` and unauthenticated Redis published on all interfaces); `docker-compose.yml:1` (obsolete `version` key) |
| Failure mode / impact | running the dev compose on any shared network exposes an unauthenticated Redis and a default-password Postgres; `deploy.sh` would boot a different runtime than the image |
| Remediation | delete or document `deploy.sh`; bind dev ports to `127.0.0.1` |

---

## 14. Likely, Potential and Unverified Findings

| ID | Class | Sev. | Finding | Basis |
|---|---|---|---|---|
| **INFRA-L01** | Likely | P2 | Railway rolling deploys run old and new versions side by side: both run all workers and schedulers, and the old code runs against the freshly migrated master schema | `railway.json`; `index.ts:500-508`; Railway's deploy model (not exercised) |
| **INFRA-L02** | Likely | P2 | With RDB-only persistence, a Redis crash between snapshots loses refresh-token sessions and BullMQ state from the last ≤ 60 min (low-write periods) | E2 |
| **INFRA-L03** | Likely | P3 | `/health` publicly discloses `env` and tenant-migration counts through Caddy | `index.ts:166-183`; `Caddyfile:7-9` |
| **INFRA-P01** | Potential | P3 | Prisma CLI installed globally as `prisma@5` may drift from the lockfile's `@prisma/client` version | `Dockerfile:39`; `apps/api/package.json:25, 49` |
| **INFRA-P02** | Potential | P3 | Long-lived browser tabs keep an old bundle against a new API after deploys (no version handshake); the service worker serves cached hashed assets cache-first | `apps/web/public/sw.js:23-80` |
| **INFRA-P03** | Potential | P3 | Caddy on-demand issuance can be abused for certificate-rate-limit exhaustion (HSEC-20) | `Caddyfile:1-5` |
| **INFRA-U01** | Unverified | — | Which platform is live; whether the deployed config matches the repo; DNS and certificate status | no access |
| **INFRA-U02** | Unverified | — | Provider-side backups or snapshots (Railway or VPS) and whether a restore was ever performed | no access |
| **INFRA-U03** | Unverified | — | External monitoring (uptime pings, provider alerts) outside the repository | no access |
| **INFRA-U04** | Unverified | — | Host resources (disk, memory), container TZ, replica count, Redis `maxmemory` on the managed platform | no access |

---

## 15. Prioritized Remediation Plan

**Before relying on production for paying customers:**

| # | Change | Closes |
|---|---|---|
| 1 | Backups with PITR, encrypted off-site copies, a documented per-tenant restore, and a **completed restore drill** with recorded RPO/RTO | INFRA-01 |
| 2 | Error tracking, metrics and alerts: billing-cycle completion, failed jobs, 5xx rate, external `/readyz` probe, Redis memory, disk, DB pool waits; a daily Paymob reconciliation alert | INFRA-02 (and detection for BG-01/02/05/11/12, INT-01, UX-08) |
| 3 | Split liveness and readiness; readiness checks DB, Redis, tenant migrations and workers; use it for deploy gating and the compose healthcheck | INFRA-03 |
| 4 | `stop_grace_period` ≥ the shutdown budget; no deploys in billing windows; per-call timeouts (BG-04) | INFRA-04 |
| 5 | Ignore `.env.production` (and `.env.*`) in git and Docker; move secrets out of the repo directory; secret scanning | INFRA-08 |

**Next:**

| # | Change | Closes |
|---|---|---|
| 6 | CI-built, commit-tagged images; migrations as a separate release step; tenant migrations finished before readiness; no boot-time plan overwrite; rollback runbook | INFRA-05, D-06, DB-L02 |
| 7 | Redis AOF (or a managed persistent Redis), schedule self-healing, connection split with timeouts, password not on argv | INFRA-06, BG-12, DB-09 |
| 8 | Fail-fast production configuration per feature | INFRA-07 |
| 9 | One master client, explicit pool limits, a pooler | INFRA-09 |

**Then:** INFRA-10 (proxy trust, `ask` gate), INFRA-11 (owner seed), INFRA-12 (pinning, CI image build), INFRA-13 (log rotation/shipping), INFRA-14 (restart policy), INFRA-15 (runtime frontend config), INFRA-16 (dev compose / `deploy.sh` cleanup).

---

## 16. Operational Verification Checklist

Read-only checks for the operator to run on the **real** environment. None were run by this audit.

| # | Check | How (read-only) | Expected |
|---|---|---|---|
| 1 | Which platform serves `hesbaapp.com` | DNS lookup; response headers (`Server: Caddy` vs Railway edge) | documented answer |
| 2 | Deployed compose matches the repo | `docker compose config --no-interpolate` on the host vs repo; `docker inspect hesba_app --format '{{.Config.StopTimeout}}'` | identical; stop timeout ≥ 30 |
| 3 | Backups exist | provider console / `ls` of the backup target; latest backup timestamp | daily (or PITR) with off-site copy |
| 4 | Restore works | restore the latest backup into an isolated instance; count rows per tenant schema; record duration | RPO/RTO recorded |
| 5 | Redis persistence | `redis-cli CONFIG GET appendonly save maxmemory-policy` | `appendonly yes` (after remediation), `noeviction` |
| 6 | Schedules present | `redis-cli --scan --pattern 'bull:*:repeat*'` | four repeatables (renewal, dunning, trial-expiry, reminders) |
| 7 | No orphaned cycle locks | `redis-cli --scan --pattern 'lock:*'` outside cycle windows | none |
| 8 | Postgres capacity | `SHOW max_connections`; `SELECT count(*) FROM pg_stat_activity` at peak | headroom > 30 % |
| 9 | Disk and logs | `df -h`; `docker system df`; container log sizes | < 80 % used; rotation configured |
| 10 | Certificates | `caddy list-certificates` / provider console; expiry dates | > 30 days validity, auto-renew healthy |
| 11 | Secrets hygiene | `git status --ignored` in the deploy directory | `.env.production` ignored, never committed |
| 12 | Monitoring | trigger a test alert (stop a staging worker) | alert received by a named person |
| 13 | Billing health | last `payment_attempts.attempted_at` vs subscriptions due; Paymob dashboard vs DB for the last 30 days | no unmatched charges |
| 14 | Tenant migration status | `SELECT schema_version, count(*) FROM tenants GROUP BY 1` | all at the latest version |

---

## 17. Evidence Ledger

**Runtime evidence** (local, throwaway containers named `hesba-p8-*` and a throwaway API instance; all removed afterwards):

| # | Observation | Source |
|---|---|---|
| E1 | `docker compose -f docker-compose.prod.yml config --no-interpolate`: no `stop_grace_period`, no `logging`, no `healthcheck` for `app`, no resource limits; `restart: unless-stopped` on all four services | compose render (no values interpolated) |
| E2 | `redis:7-alpine` 7.4.8 with `redis-server --requirepass <dummy>`: `save 3600 1 300 100 60 10000`, `appendonly no`, `appendfsync everysec`, `maxmemory 0`, `maxmemory-policy noeviction`, `dir /data`; the password visible in `docker inspect .Config.Cmd` (not in `ps`) | throwaway container |
| E3 | 25 s SIGTERM handler: `docker stop` (no timeout) → **3.1 s, exit 137** (Docker 29.7.2, `StopTimeout` unset); `--stop-timeout 10` → 10.1 s, exit 137; `docker stop -t 30` → 26.0 s, exit 0 (`clean-exit`) | throwaway containers |
| E4 | `sh -c "exec env API_PORT=3000 tsx sig.js"`: SIGTERM to the top PID (tsx CLI) reached the child Node (`got SIGTERM`, `graceful exit`); the parent exited | local processes (tsx 4.21.0, Node 23.11.0) |
| E5 | real API on throwaway PG/Redis: `/health` 200 `status: ok` at baseline, with PG stopped (tenant `POST /api/auth/login` → 500 in 0.008 s) and with Redis stopped (tenant login → no response by 8.0 s); after restarts the tenant route → 401 in ~0.27 s without an app restart | curl probes |
| E6 | after a data-less Redis restart: `bull:*:repeat*` keys = 0; no re-registration by the running API | redis-cli |
| E7 | `config/env.ts` under `NODE_ENV=production`: optional secrets blank → boots, warning lists only `APP_ENCRYPTION_KEY, PAYMOB_HMAC_SECRET`; `DATABASE_MASTER_URL` blank → `Invalid url`, exit; `JWT_ACCESS_SECRET` 10 chars → min-32 error, exit | tsx import (booleans only, no values) |
| E8 | idle API: 2 PG connections; `max_connections 100`, `superuser_reserved_connections 3`; host 11 CPUs | `pg_stat_activity`, `SHOW` |
| E9 | cleanup: containers removed, API stopped, Docker Desktop quit | — |

**Static evidence:**
- **Deployment files:** `Dockerfile` (1-88), `docker-compose.prod.yml` (1-79), `docker-compose.yml` (1-36), `Caddyfile` (1-20), `railway.json` (1-13), `.dockerignore` (1-13), `scripts/deploy.sh` (1-10), `.github/workflows/ci.yml` (1-119), `apps/web/.env.production`.
- **Ignore rules:** `.gitignore` lines 6-8; `git check-ignore -v .env.production` → not ignored; `.env.production` absent from the checkout.
- **Application:**
  - `apps/api/src/index.ts`: logger 42-60, helmet 81-96, health 166-183, `check-tenant` 186-191, static 453-465, start 466-536.
  - `config/env.ts`: 7-58, 70-77.
  - `config/redis.ts`: 4-7.
  - `config/database.ts`: 6-41.
  - `packages/database/src/prisma.ts`: 5-12.
  - `migrate-tenants.ts`: 28-35, 56-147.
  - `seeds/master.seed.ts`: 93-96.
  - `admin.auth.service.ts`: 87-113.
  - `sentry.plugin.ts`: 9-41.
- **Documents:** `Hesba_Implementation_Roadmap.md:835, 843-844, 883-884`; `Hesba_Technical_Architecture.md:89`.
- **Repo search:** `pg_dump|backup|restore|WAL|snapshot` → no backup tooling.

---

## 18. Audit Declaration

| | |
|---|---|
| Source code, migrations, deployment configuration, secrets modified | **NO** |
| Production data or infrastructure accessed, deployed, restarted or reconfigured | **NO** |
| Secret values printed or recorded | **NO**: compose rendered with `--no-interpolate`; env checks printed booleans; a dummy Redis password was used |
| User's existing containers | **untouched** (`hesba_postgres`, `hesba_redis` and the others were neither started, stopped nor removed by this audit; Docker Desktop itself was started for the simulations and quit afterwards) |
| Throwaway services | `hesba-p8-redis`, `hesba-p8-grace*`/`p8g-*` (stop-timeout probes), `hesba-p8-pg`; a throwaway API on :3000 (loopback-only `fetch` guard, every `.env` key overridden) — **all removed/stopped** |
| Tested at runtime | E2–E8: Redis defaults under the prod command, Docker stop grace, signal relay through the `CMD` chain, `/health` and tenant routes under PG and Redis outages and recovery, schedule loss after Redis data loss, production env validation, connection counts |
| Inspected statically only | Caddy behaviour (no Caddy run), Railway semantics, Prisma migrate locking, image build (not built), CI pipeline, backups (none present), monitoring (none present), log rotation, proxy trust |
| Unknown | the live platform, the deployed config, DNS/certificates, provider backups, external monitoring, host resources, replica count — and therefore **RPO, RTO, actual exposure and alerting coverage** |
| Temporary files | session scratchpad `phase8/` (`env.sh`, `api_child.ts`, `envcheck.ts`, `sig.js`, `sig.log`, `api.log`) — removed at the end; nothing written in the repository except this report |
| Pre-existing working-tree changes | **preserved** |
| Report path | `documents/audit/Hesba_Phase8_Infrastructure_Deployment_Audit.md` |

*No fixes were implemented. A backup is not considered recoverable without a restore test, and none exists.*
