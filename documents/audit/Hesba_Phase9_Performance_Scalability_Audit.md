# حِسبة (Hesba) — Phase 9: Performance, Capacity & Scalability Audit

| Item | Value |
|---|---|
| Date | 2026-10-12 |
| Repository state | branch `claude/ui-pos-merge-split`, HEAD `8846bce`; pre-existing uncommitted changes (`apps/web/src/components/layout/AppShell.tsx`, `apps/web/src/pages/pos/POS.tsx`, `documents/`) preserved |
| Mode | Audit only — no application code, test, migration, configuration, dependency or production-data changes |
| Runtime | Throwaway loopback PostgreSQL 16 and Redis 7 containers with synthetic data; the real API process; no production or shared environment |
| Finding IDs | PERF-01 … PERF-13 (this phase); earlier IDs referenced as-is (DB-, INFRA-, BG-, L5-, INT-, UX-, RC-) |

## 1. Executive summary

**What ran.** Eight bounded benchmark sets (B1–B8), `EXPLAIN (ANALYZE, BUFFERS)` on SQL captured from the real API, and a production `vite build`. The setup was one large synthetic tenant (100,000 invoices, 200,000 items, 20,000 products and customers, 301 MB) plus 30 small ones, against the real API on an Apple M3 Pro with stock PostgreSQL 16 settings. Every number below is labelled **Measured**, **Code-derived** or **Unknown** in the body. **No production capacity figure can be stated**, because production hardware, database settings, tenant counts and traffic are unknown, and no telemetry exists (INFRA-02).

**Headline.** At this data size the database is not the bottleneck: no query exceeded 200 ms outside a deliberate burst, and the sale path is fast and correct (13.5 ms p50; 317 req/s at c=10; exact stock deltas under a hot-SKU race). The limits are architectural: **one Node process and one connection budget shared by every tenant, with no isolation, timeouts or reclamation.**

| ID | Sev | Confidence | Finding | Key measurement |
|---|---|---|---|---|
| PERF-01 | **P1** | Confirmed | A burst across 31 tenants fills PostgreSQL's 100 connections and they **stay full** (idle pooled connections are never reclaimed). New signups then fail with 500, and operators cannot connect. | 541 P2037; 100/100 idle for ≥ 17 min; signup 500 |
| PERF-02 | **P1** | Confirmed | P&L, stock and sales reports and Excel exports build whole datasets in the shared process: seconds of latency, 1–2 GB of RSS, and stalls for **every** tenant. | P&L 2.1 s, RSS +1.2 GB; stock 2.0 s / 23.4 MB JSON; small-tenant p99 11 → 803 ms |
| PERF-03 | P2 | Confirmed | Sales report and Excel export silently contain only the latest 500 invoices. | summary 100,202 vs 500 rows |
| PERF-04 | P2 | Confirmed | bcryptjs (cost 12) runs on the event loop; 6 logins stall the whole API for ≈1 s. | 1.41 s per login; `/health` 998 ms |
| PERF-05 | P2 | Confirmed | The invoice list aggregates all items and sorts all invoices on every page view. | 82.6 ms → 0.27 ms with index + page-only count; 51.8 req/s ceiling |
| PERF-06 | P3 | Confirmed | Leading-wildcard search scans whole tables (a trigram index alone is not used); invoice search truncates at 200 matches. | 21–33 ms at 20k rows; barcode index 0.04 ms |
| PERF-07 | P3 | Confirmed (replica) | Password reset scans every session on the platform. | 5.0 s at 20k sessions |
| PERF-08 | P3 | Confirmed | No compression; SPA assets served by the API with `max-age=0`. | 23.4 MB uncompressed JSON |
| PERF-09 | P3 | Confirmed (code) | Stock table renders all rows; dashboards poll heavy endpoints. | 60,000 rows to one table |
| PERF-10 | P3 | Likely | Plan-limit `count(*)` on every create; not atomic. | 3.8 ms at 100k |
| PERF-11 | P2 | Potential | PgBouncer transaction pooling (recommended in a code comment) would let raw SQL hit another tenant's schema. | engine sets `search_path` per connection; 24 raw-SQL sites |
| PERF-12 | P3 | Potential | Cron and boot migrations walk all tenants serially through the request LRU. | code-derived |
| PERF-13 | Info | Confirmed (code) | Dashboard caches today's revenue for 120 s; acceptable as is. | saves ≈8 ms |

**Most important next steps (§15).** (1) Observability plus connection bounds and reclamation (PERF-01). (2) SQL-side aggregation, pagination and streaming for reports and exports, with per-tenant limits (PERF-02/03). (3) Move hashing off the event loop (PERF-04). (4) One index plus a page-only count for invoices (PERF-05). Do **not** introduce a transaction-mode pooler before raw SQL is schema-qualified (PERF-11). None of the recommendations caches financial values or weakens transaction isolation. Moving aggregation into SQL `numeric` makes report totals more exact, not less.

**Phase linkage.** PERF-01 confirms Phase 4's static DB-20 at runtime and shows it is worse than recorded (it persists). B7 upgrades Phase 5's L5-03 from Likely to measured. PERF-02/04 are the performance face of Phase 4.5's RC-08 (no capacity budget or isolation).
## 2. Scope and methodology

### 2.1 Scope

| In scope | Out of scope |
|---|---|
| API request paths (auth, tenant resolution, products, customers, invoices, reports, exports), PostgreSQL query plans, Prisma pool and tenant-client LRU, Redis usage, BullMQ queue patterns, the web bundle, the multi-tenant noisy-neighbour behaviour of the single API process | Production, staging, or any shared environment; real payment, e-mail or ETA traffic; browser rendering of very large tables (avoided to protect the host); long soak tests; changes to code, configuration, dependencies or data outside the throwaway stack |

### 2.2 How each conclusion is labelled

Every number in this report falls into exactly one of three classes. The class is stated next to the number.

| Label | Meaning |
|---|---|
| **Measured** | Produced by a benchmark in this phase on the harness in §2.3. Valid for that hardware and dataset only. |
| **Code-derived** | Read from source, configuration, or library defaults, or computed from measured numbers by stated arithmetic. Not observed under production load. |
| **Unknown** | Depends on facts this audit could not see: production hardware, PostgreSQL settings, tenant count, data volumes, traffic shape, network latency. Listed in §11.4. |

### 2.3 Harness (all benchmarks)

| Item | Value |
|---|---|
| Host | Apple M3 Pro, 11 CPU cores, 18 GiB RAM, macOS 26.4.1; Node v23.11.0 (benchmark client and API on the same host) |
| Container runtime | Docker 29.7.2; VM with 11 CPUs and 7.75 GiB RAM. The user's unrelated `moneyprinterturbo` containers were running throughout (background noise, untouched). The user's `hesba_postgres` / `hesba_redis` containers were not touched. |
| PostgreSQL | Throwaway `hesba-p9-pg`, `postgres:16-alpine` (16.13), loopback 127.0.0.1:55438, database `hesba_p9`. Image defaults: `max_connections` 100, `shared_buffers` 128MB, `work_mem` 4MB, `effective_cache_size` 4GB, `random_page_cost` 4. For SQL capture only, `log_min_duration_statement` was changed with `ALTER SYSTEM` + reload (0 → 200 → 20 → 200 ms) on this throwaway instance. No `pg_stat_statements` (not preloaded). |
| Redis | Throwaway `hesba-p9-redis` (Redis 7), loopback 127.0.0.1:56384, no persistence. |
| API | The real `apps/api/src/index.ts` run with `tsx` (the production image also runs through `tsx`, `Dockerfile:88`). `NODE_ENV=test`. Every `.env` key was overridden: database and Redis point to the throwaway services; Paymob, ETA and Resend are blank or point to dead loopback ports. A fetch guard in the child process allowed loopback only. Background workers were running (no cron fired during the runs). |
| Tenants | 31 tenants registered through the real `POST /api/tenants/register`: one large (`p9large`) and 30 small (`p9s01`–`p9s30`), all on the `enterprise` plan. |
| Large-tenant dataset | Generated with SQL `generate_series` into `tenant_p9large`: 3 branches; 20,000 products and variants; 60,000 stock rows; 20,000 customers; 100,000 completed invoices spread over 365 days; 200,000 invoice items with `cost_at_sale`; 5,000 installment contracts with 60,000 payments; 200,000 audit-log rows. `ANALYZE` was run afterwards. Schema size: **301 MB**. Small tenants contain only their provisioning seed. |
| Load client | Node 23 `fetch` (undici) scripts. Each scenario ran 0–2 warm-up requests, then a fixed number of requests (`n`) at fixed concurrency (`c`, a closed loop of `c` workers). The scripts recorded p50/p95/p99/max latency, throughput, response size, and peak API RSS (sampled every 100 ms with `ps`). |
| Bounds | Largest run: 1,240 requests (§5.3). Heavy reports ran at concurrency ≤ 2. No run lasted more than about 10 s, except the 8-minute passive connection watch. |

### 2.4 Benchmarks that ran

| ID | What | Concurrency × count | Section |
|---|---|---|---|
| B1 | Read paths: product search, customers, invoices list and search | c=1 (30–50 requests), c=10 (200 requests) | §4, §7 |
| B2 | Reports and Excel exports, dashboard cold and warm | c=1, 1–50 requests | §9 |
| B3 | Noisy neighbour: small-tenant latency while the large tenant runs heavy reports | 2 heavy requests ‖ 1 sequential probe, 8 s baseline + 8 s load | §10 |
| B4 | `POST /api/invoices`, distinct SKUs and one hot SKU pair, with a stock-integrity check | c=1 ×50, c=10 ×100, c=10 ×50 | §7 |
| B5 | Connection burst across 31 tenants, then an 8-minute recovery watch | 31 tenants × 8 concurrent × 5 rounds | §5 |
| B6 | Login (bcryptjs, cost 12) and its effect on the event loop | 2 sequential, then 6 concurrent | §7, §10 |
| B7 | BullMQ: new `Queue` per enqueue vs one reused `Queue` (replica on isolated queue names) | 3,000 adds each | §6 |
| B8 | Password-reset session sweep (replica of the SCAN loop) | 1k and 20k synthetic `refresh:*` keys | §6 |
| E | `EXPLAIN (ANALYZE, BUFFERS)` on SQL captured from the real API. Hypothetical indexes were created inside a transaction and rolled back. | single runs | §4 |
| F | `vite build` into the scratchpad (no config change), plus gzip sizes | 1 build | §8 |

**Not run (and why):** sustained soak tests (host safety); rendering the 60,000-row stock table in a browser (could freeze the host's browser pane); the real `/auth/reset-password` endpoint (PostgreSQL was saturated by B5 when this was due, so the loop was replicated against Redis instead); the reminders job (the synthetic customers have no e-mail, so the run would only exercise the skip path); any test against PgBouncer (none exists in the repo).

### 2.5 Safety constraints observed

No application code, test, migration, configuration, package file or production data was changed. Everything ran on throwaway loopback containers with synthetic data. `EXPLAIN ANALYZE` was used only on that data. Hypothetical indexes and the `pg_trgm` extension were created inside `BEGIN … ROLLBACK`. No secrets were printed: environment checks printed booleans only. The pre-existing uncommitted changes (`AppShell.tsx`, `POS.tsx`, `documents/`) were preserved. Cleanup is recorded in §18.

## 3. Architecture and workload model

### 3.1 Runtime topology (code-derived)

```
Caddy (on-demand TLS, no `encode`)  ──►  ONE Node process (tsx)                       [Caddyfile:1-21, Dockerfile:88]
                                         ├─ Fastify HTTP: API + static SPA (prod)     [index.ts:453-464]
                                         ├─ 5 BullMQ workers (eta c=3, others c=1)    [eta-submission.job.ts:204]
                                         ├─ masterDb Prisma pool (no connection_limit → num_cpus*2+1)   [config/database.ts:6-9]
                                         ├─ 2nd master client in @hesba/database      [packages/database/src/prisma.ts:5-9]
                                         └─ tenant LRU: ≤50 TenantPrismaClient × connection_limit 5     [config/database.ts:16-42]
                                              │
                    PostgreSQL 16 (one DB, schema per tenant, max_connections default 100)   [docker-compose.prod.yml:2-7]
                    Redis 7 (tenant/sub cache, dashboard cache, refresh tokens, BullMQ)      [docker-compose.prod.yml:24]
```

All tenants share one event loop, one memory heap, and one PostgreSQL `max_connections` budget. Phase 8 found no memory or CPU limits in the compose file and no second app replica. A single slow or memory-heavy request therefore affects every tenant.

### 3.2 Per-request work (code-derived)

| Step | Cost per request | Reference |
|---|---|---|
| Tenant resolution | Redis `GET tenant:<sub>` (5-minute cache); `masterDb.tenant.findUnique` on a miss | `shared/middleware/tenant.middleware.ts:63-73` |
| Tenant client | LRU `get`; on a miss, a new `TenantPrismaClient` with its own pool | `tenant.middleware.ts:85`, `config/database.ts:29-42` |
| Subscription gate | Redis `GET` of the cached status; `masterDb.subscription.findFirst` on a miss | `tenant.middleware.ts:91-100` |
| Auth | JWT verify (HS) — CPU-light | `shared/middleware/auth.middleware.ts` |
| Plan limit (sale, product, user, branch create) | `count(*)` on every create | `shared/middleware/limit.middleware.ts:23-70` |

### 3.3 Assumed workload shape (Unknown — no production telemetry exists; see INFRA-02)

The audit assumes an Egyptian retail and installment POS. Tenants are shops with 1–3 branches. Sales happen during shop hours, with peaks in the evening and at month end. Reports and exports are run by owners, typically at day close. Logins cluster at shift start. Daily cron work runs at 09:00 (`installment-reminders.job.ts:50`). None of these figures were measured. §11 shows how the capacity estimates change if the assumptions do.
## 4. PostgreSQL query analysis

SQL was captured from the real API with `log_min_duration_statement = 0` for single requests. The statements were then re-run with `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)` on the throwaway database (300 MB of synthetic data, all in `shared_buffers`/page cache — **warm-cache** numbers; cold-disk numbers are Unknown).

### 4.1 Index inventory relevant to hot paths (code-derived)

| Table | Indexes (`packages/database/migrations/tenant/002_full_schema.sql`) | Gap for observed queries |
|---|---|---|
| `invoices` | `(branch_id, created_at DESC)` :271, `(customer_id, created_at DESC)` :272, `(status)` :273, unique `invoice_number` | No index usable for an all-branch `ORDER BY created_at DESC` (the default invoice list, the dashboard's recent invoices, the sales report's 500-row list) or for a `created_at >= monthStart` count |
| `invoice_items` | `(invoice_id)` :289 | — (but see `_count` below) |
| `product_variants` | `(product_id)` :89, unique barcode :90, unique `(product_id, sku)` | Nothing supports `ILIKE '%term%'` |
| `products` | PK only | Nothing for `name ILIKE '%term%'` |
| `customers` | `(phone)` :191 | Nothing for `full_name ILIKE '%term%'` |
| `audit_logs` | `(entity, entity_id)` :547, `(actor_id, created_at DESC)` :548, `(created_at DESC)` :549 | — |
| `installment_payments` | `(contract_id)` :371 | No `(status, due_date)` index for the reminder and overdue scans |

No `pg_trgm` or GIN indexes exist anywhere in `packages/database/migrations` (the only `gin` text matches are inside the words "login" and "margins").

### 4.2 Plans (Measured, warm cache, `tenant_p9large`)

| Query (origin) | Plan essentials | Time |
|---|---|---|
| Invoice list page 1 (`invoice.service.ts:72-87`; Prisma `_count: { items }` at :81) | `LEFT JOIN (SELECT invoice_id, COUNT(*) FROM invoice_items GROUP BY invoice_id)` — aggregates **all 200,000 items**, hash-joins all 100,000 invoices, then a top-N heapsort; 2 parallel workers; shared hit 8,877 | **82.6 ms** |
| Same, `OFFSET 79980` (page 4,000) | Same plus an external merge sort, ≈7 MB spilled to disk per worker (3 processes) | **103.8 ms** |
| Same, rewritten: hypothetical `invoices(created_at DESC)` (rolled back) and a correlated count for the 20 returned rows | Index Scan, 20 rows; Index Only Scan on `idx_invoice_items`, 20 loops | **0.271 ms** |
| `SELECT … ORDER BY created_at DESC LIMIT 20` without `_count`, existing indexes | Parallel Seq Scan + top-N heapsort | 16.2 ms |
| `count(*)` all invoices (list `total`) | Index Only Scan, 100,000 rows | 7.3 ms |
| Product search `'%موديل 12%'` (`product.routes.ts:344-376`) | Seq Scan `product_variants` (20,000) + Seq Scan `products` (20,000); 18,889 rows removed by filter; 1,111 matches | **32.9 ms** |
| Product search with a full barcode through `/products/search` | Same plan; 19,999 rows removed | 21.9 ms |
| Same with hypothetical `pg_trgm` GIN indexes on `products.name`, `variants.sku`, `variants.barcode` (rolled back) | **Indexes not used** — the `OR` spans the join, so the planner still seq-scans both tables | 20.1 ms |
| Exact barcode `=` (what `/products/barcode/:code` does) | Index Scan `idx_variants_barcode` | 0.038 ms |
| Customer search `full_name ILIKE OR phone LIKE OR national_id LIKE` (`customer.routes.ts:18-55`) | Seq scans; `count` and `findMany` 18.3 ms each, run in parallel | 18.3 ms ×2 |
| Monthly invoice count in `requireUnderLimit` (`limit.middleware.ts:55`) | Index Only Scan over `idx_invoices_customer` (the whole index), 3,218 rows in the month | 3.8 ms |
| P&L sold items (`report.service.ts:423-426`) | Returns 200,000 rows to Prisma | 115.6 ms SQL of a **2,123 ms** request |
| Stock report (`report.service.ts:227-243`) | Returns 60,000 rows with joins and `ORDER BY branch, product name` | 118.1 ms SQL of a **2,215 ms** request |
| Sales report, all-time (`report.service.ts:144-180`) | aggregate 46.2 ms; groupBy 32.7 ms; unbounded `findMany(createdAt,totalAmount)` 59.2 ms; 500-row list with `_count` 83.1 ms | ≈221 ms SQL of a 452 ms request |

### 4.3 What the plans show

1. **The ORM shape costs more than the data.** Prisma's `_count` on a relation becomes a GROUP BY over the whole child table, which is not limited by the outer `LIMIT`. The invoice list therefore grows with total items, not page size. The same `_count` appears in the sales report's 500-row list (`report.service.ts:175`).
2. **The heavy reports are Node-bound, not SQL-bound.** For P&L and the stock report, SQL took roughly 5–7% of wall time. The remaining ≈2 s was spent turning 60–200k rows into JS objects (Prisma) and aggregating or serialising them on the event loop. An index alone will not fix these; aggregation has to move into SQL (§15).
3. **Leading-wildcard search scales linearly with catalog and customer size.** At 20k rows the cost is still tens of milliseconds. A trigram index helps only if the query is rewritten so that each predicate can use its own index (for example a `UNION` of per-column searches, or a denormalised search column).
4. During B2 and B4, no single statement exceeded 200 ms (the log stayed empty at that threshold). During the B5 burst (17:14:29 UTC), four executions of the large tenant's invoice-list query took 214–262 ms because of contention; nothing else crossed 200 ms. At this data size the database was not the bottleneck. The process and the connection budget were.
## 5. Connection-pool and tenant architecture analysis

### 5.1 Connection budget (code-derived)

| Consumer | Pool size | Reference |
|---|---|---|
| `masterDb` (API) | Prisma default `num_cpus × 2 + 1`; the URL has no `connection_limit` (`.env.example` checked as booleans: user is `postgres`, no `connection_limit`, no pooler host) | `apps/api/src/config/database.ts:6-9` |
| Second master client (`@hesba/database`: seeding, `migrateAllTenants` tenant lookup) | Prisma default | `packages/database/src/prisma.ts:5-9` |
| Tenant clients | LRU `max: 50` × `connection_limit=5`, `pool_timeout=20` → up to **250** | `apps/api/src/config/database.ts:16-17,20-27,29-42` |
| Boot tenant migrations | 1 dedicated connection per tenant, sequential | `packages/database/src/migrate-tenants.ts:28-35,64-76,125-142` |
| PostgreSQL | `max_connections` = image default 100 (compose sets no override) | `docker-compose.prod.yml:2-7` |

The code itself documents the limit: "Beyond ~15 concurrently-active tenants on a default instance, front Postgres with PgBouncer" (`config/database.ts:11-15`). Phase 4 recorded this statically as DB-20, and Phase 8 as INFRA-09.

### 5.2 Provisioning (Measured)

31 serial `POST /api/tenants/register` calls, all 201: min 0.54 s, median 0.59 s, max 0.69 s; the first (large) took 0.79 s. After 31 registrations, 34 backends were connected to `hesba_p9`, and 40 after the B1–B4 runs.

### 5.3 Burst across tenants (Measured — B5)

Load: 31 tenants × 8 concurrent `GET /api/invoices?page=1&limit=20` × 5 rounds = 1,240 requests (each request runs `count` and `findMany` in parallel, `invoice.service.ts:72-87`).

| Observation | Value |
|---|---|
| Backends before | 40 |
| API log | **541 × `P2037` "FATAL: sorry, too many clients already"** (stack: `invoice.service.ts:72` → `invoice.routes.ts:24`) |
| PostgreSQL log | 743 "too many clients" rejections in total (including the harness's own `psql` monitoring attempts) |
| Operator access | `docker exec … psql -U postgres` was **refused** throughout. The app connects as the superuser `postgres`, so `superuser_reserved_connections` gives no escape hatch. The harness's final `psql` call crashed the benchmark script, which is why the error counts come from the logs. |
| Backends afterwards (counted with `ps` inside the container) | **100, all `idle`**, at every 30-s sample from 17:15:22 to 17:23:24 UTC (burst at ≈17:14:29), and still **100 at 17:31:38** (≈17 min). A second signup then also returned 500 and `psql` was still refused. Only stopping the API process (17:32) released them: 0 backends afterwards. |
| Tenants that already had pooled connections | Kept working (e.g. `p9s05` invoice list 200 in 5 ms) |
| **New tenant signup** during saturation | `POST /api/tenants/register` → **500 `internal_error` in 61 ms** ("Too many database connections opened" from `$queryRaw`); again 500 in 59 ms at 17:31:38. Neither attempt left a `tenants` row or a `tenant_p9new*` schema (checked after the API stopped), so no orphan in the DB-22 sense. |
| `/health` | 200 throughout (INFRA-03: the health check doesn't touch the database) |

### 5.4 Why it doesn't recover (code-derived, consistent with 5.3)

- Prisma keeps idle pooled connections open. The 5.22 engine accepts `max_idle_connection_lifetime` and `max_connection_lifetime` URL parameters (both strings are present in `libquery_engine-darwin-arm64.dylib.node`), but the code sets neither: `config/database.ts:34-38` sets only `schema`, `connection_limit` and `pool_timeout`. In B5 none of the 100 idle backends closed within ≈17 minutes, so whatever the engine default is, it did not reclaim them in that window.
- The LRU has `ttl: 30 min` and `updateAgeOnGet`, but no `ttlAutopurge` (lru-cache 10.4.3). Stale entries are disposed only when touched or when evicted for size. A tenant that goes quiet keeps its client — and that client's idle connections — until another `get`, an eviction, or a process restart.
- So the effective limit is not "concurrently active tenants". It is **the number of tenants that burst since the last restart**, times their pool high-water marks. In B5, 31 tenants were enough to fill 100 slots.

### 5.5 Consequences

| Who | Effect while saturated |
|---|---|
| New tenants (signup), tenants evicted from the LRU, tenants never seen since the restart | Every request that needs a new connection fails (`P2037`) — immediate 500s, not queued |
| Tenants with an existing pool | Cannot grow beyond their current connection count; extra concurrency waits up to `pool_timeout` 20 s (then `P2024`) |
| Background jobs | Workers iterate all tenants (`installment-reminders.job.ts:83-90`, dunning, renewal) and need connections for tenants outside the LRU → per-tenant failures (Phase 5 BG findings) |
| Deploy / boot | `migrateAllTenants` opens one new connection per tenant (`migrate-tenants.ts:131-140`) → marked failed → `/health` 503 if any tenant fails (`index.ts:148-180`) |
| Operators | Cannot open `psql`/`pg_dump` as `postgres` → backups and diagnosis are blocked (INFRA-01) |

### 5.6 Correctness constraints for any fix

Transaction pooling (PgBouncer `pool_mode=transaction`) is the standard answer, but Phase 4.5 already noted that `migrate-tenants.ts:76` relies on a **session-level** advisory lock on a pinned connection. Migrations would need a direct (session) connection or a transaction-scoped lock (`pg_advisory_xact_lock`). Prisma also needs `pgbouncer=true`, which disables prepared statements. Interactive transactions (`$transaction(async tx => …)`, used for invoice and stock writes) are compatible with transaction mode, because one transaction stays on one server connection.

**Tenant-isolation hazard (code-derived, Unverified at runtime because no pooler exists in the repo):** Prisma model queries are fully schema-qualified (captured SQL: `"tenant_p9large"."invoices"`). Raw SQL is not. For example, `SELECT id FROM invoices WHERE invoice_number ILIKE $1` (`invoice.service.ts:41-48`) relies on the session `search_path`, and the query engine sets it once per physical connection with `SET search_path = "<schema>"` (the string is present in `libquery_engine-darwin-arm64.dylib.node`, Prisma 5.22.0). In PgBouncer **transaction** mode, server connections are shared between clients. A raw query from tenant A could then run on a connection whose `search_path` was set by tenant B — **a cross-tenant read or write**. `apps/api/src` has 24 `$queryRaw*`/`$executeRaw*` call sites. Before any transaction-mode pooler: schema-qualify every raw statement (or issue `SET LOCAL search_path` inside the same transaction), and add a test that interleaves two tenants on one pooled connection. Session-mode pooling avoids this hazard but does not reduce the connection count much.

## 6. Redis and BullMQ analysis

### 6.1 Redis roles (code-derived)

| Key family | Purpose | TTL | Reference |
|---|---|---|---|
| `tenant:<sub>`, subscription status | per-request tenant and subscription gate | 5 min (tenant), `SUB_CACHE_TTL_SECONDS` | `tenant.middleware.ts:63-100` |
| `dashboard:<tenantId>:<branch>` | dashboard KPIs | 120 s; **no invalidation on writes** | `report.service.ts:43-45,117` |
| `refresh:<token>` | refresh sessions (`{userId, tenantId, schemaName}`) | `REFRESH_TOKEN_TTL` | `auth.service.ts:68-75` |
| BullMQ `eta-submissions`, `dunning`, `renewal`, `trial-expiry`, `installment-reminders` | jobs | see 6.3 | `jobs/*.ts` |

All of this shares one ioredis client with `maxRetriesPerRequest: null` (Phase 4.5 RC-08): a Redis stall stalls every request at tenant resolution. Production Redis has no `maxmemory` (`docker-compose.prod.yml:24` passes only `--requirepass`), which is what BullMQ needs (`noeviction`). Memory growth is therefore bounded only by the TTLs and retention below.

### 6.2 Dashboard cache (Measured)

Cold (cache flushed before each request): 28.7 ms first, then 8.9–9.8 ms. Warm: p50 1.4 ms, 680 req/s at c=1. The cache saves about 8 ms per request at this data size, so its value is small. Its cost is correctness: "today's revenue" and counts can be up to 120 s stale after a sale. That is acceptable for an at-a-glance dashboard **only if** day-close and receipts never read it (they don't — `getDayClose` queries directly, `report.service.ts:580-665`). No change is recommended beyond labelling. Do not widen this cache to other financial reports without a written invalidation design (§15).

### 6.3 Queue retention (code-derived) and per-job cost (Measured — B7)

| Queue | removeOnComplete | removeOnFail | Reference |
|---|---|---|---|
| eta-submissions | `{ age: 7 days }` | **`false` (never)** | `eta-submission.job.ts:17-28` |
| dunning, renewal | `true` | `{ count: 100 }` | `dunning.job.ts:17-18`, `renewal.job.ts:17-18` |
| installment-reminders | `true` | `{ count: 50 }` | `installment-reminders.job.ts:25` |
| trial-expiry | `true` | `{ count: 100 }` | `trial-expiry.job.ts:25` |

B7 replicated `enqueueEtaSubmission` (`eta-submission.job.ts:29-31` builds a **new `Queue` on every call**; this is Phase 5's L5-03) against isolated queue names:

| Pattern (N = 3,000 adds) | ms/add | Retained heap per add | `error` listeners added to the shared client | Redis bytes per waiting job |
|---|---|---|---|---|
| New `Queue` per add (current code) | 0.78 | **+4.93 KB** | **+3,000** | ≈890 |
| One reused `Queue` | 0.373 | −0.02 KB | 0 | ≈830 |

The only caller today is the manual resubmit route (`modules/eta/eta.routes.ts:31`), which Phase 6 (INT-01) found fails before enqueueing. The leak is therefore latent now, but it becomes per-invoice once ETA submission is wired into checkout. Code-derived: at ≈0.85 KB per job and 7-day retention, ETA alone would hold ≈0.85 KB × (invoices per day × 7) — about 60 MB per 10k ETA invoices/day platform-wide — plus failed jobs that are never removed.

### 6.4 Password-reset session sweep (Measured replica — B8)

`resetPassword` drops the user's sessions by scanning **every tenant's** refresh keys: `SCAN refresh:* COUNT 200`, then one serial `GET` per key (`auth.service.ts:194-209`).

| Refresh keys in Redis (platform-wide) | Wall time (loopback) | SCAN calls | Serial GETs |
|---|---|---|---|
| 1,048 | 298 ms | 11 | 1,048 |
| 20,048 | **5,039 ms** | 201 | 20,048 |

The cost grows linearly with platform-wide sessions and with Redis round-trip time (Unknown in production; a remote Redis at ≈1 ms RTT would make this about 20 s). The reset response waits for the whole sweep. It is rate-limited, so this is a latency defect, not a DoS vector. A per-user index set (`user_sessions:<userId>`) makes it O(sessions of that user).
## 7. API performance analysis

### 7.1 Read paths (Measured — B1, large tenant, warm)

| Endpoint | c | n | p50 ms | p95 | p99 | max | req/s | Body KB |
|---|---|---|---|---|---|---|---|---|
| `GET /products/search` "موديل 12" (1,111 hits, limit 20) | 1 | 50 | 27.3 | 34.5 | 35.7 | 35.7 | 35.7 | 4.8 |
| same | 10 | 200 | 51.7 | 58.1 | 78.0 | 80.1 | 186.4 | 4.8 |
| `GET /products/search` exact barcode string | 1 | 50 | 23.9 | 32.6 | 34.7 | 34.7 | 40.2 | 0.3 |
| `GET /products/search` no hit | 1 | 50 | 20.9 | 32.9 | 35.7 | 35.7 | 45.3 | 0 |
| `GET /products/barcode/:code` (POS scan path) | 1 | 50 | 2.7 | 3.5 | 9.4 | 9.4 | 352.2 | 1.5 |
| `GET /products` page 1 | 1 | 50 | 4.0 | 8.1 | 16.8 | 16.8 | 215.3 | 11.6 |
| `GET /customers?search=محمد` | 1 | 50 | 10.6 | 15.9 | 24.0 | 24.0 | 88.8 | 5.7 |
| same | 10 | 200 | 33.5 | 39.8 | 42.2 | 43.8 | 291.6 | 5.7 |
| `GET /customers?search=<phone>` | 1 | 50 | 11.9 | 16.1 | 21.4 | 21.4 | 81.4 | 2.9 |
| `GET /customers?page=900` (offset 17,980) | 1 | 30 | 7.4 | 12.6 | 16.0 | 16.0 | 129.2 | 5.9 |
| `GET /invoices` page 1 | 1 | 50 | **51.3** | 55.9 | 66.6 | 66.6 | 19.3 | 24.6 |
| same | 10 | 200 | **188.4** | 234.4 | 248.6 | 282.6 | **51.8** | 24.6 |
| `GET /invoices?page=4000` | 1 | 30 | 80.4 | 83.9 | 88.6 | 88.6 | 12.4 | 24.3 |
| `GET /invoices?search=INV-00999` | 1 | 30 | 60.5 | 67.3 | 75.3 | 75.3 | 16.4 | 23.9 |
| `GET /invoices?search=سارة` (customer name) | 1 | 30 | 56.8 | 64.2 | 70.6 | 70.6 | 17.3 | 24.7 |

Reading the table:

- The invoice list is the slowest everyday screen. It is also the only one whose throughput collapsed at c=10: 51.8 req/s with p50 188 ms. Each request holds two of the tenant's five connections for ≈80 ms, and the query starts parallel workers. Its cost follows total invoice and item counts, not page size (§4.2). The dashboard polls it every 60 s while visible (`Dashboard.tsx:126-130`).
- Invoice search collects at most **200 matching IDs per raw query** (`invoice.service.ts:41-48`) and then paginates over that set. A customer with more than 200 invoices, or a number prefix matching more than 200, gets **silently truncated** results and a wrong `total`. This is a correctness defect caused by a performance cap (PERF-06).
- Offset pagination on customers is cheap at 20k rows. It is not a current problem.

### 7.2 Write path (Measured — B4, `POST /api/invoices`, 2 lines per invoice)

| Scenario | c | n | Status | p50 | p95 | p99 | max | req/s |
|---|---|---|---|---|---|---|---|---|
| distinct SKUs | 1 | 50 | 201×50 | 13.5 | 19.5 | 24.6 | 24.6 | 69.8 |
| distinct SKUs | 10 | 100 | 201×100 | 29.1 | 44.6 | 55.3 | 60.4 | 317.3 |
| one hot SKU pair (row-lock contention on 2 stock rows) | 10 | 50 | 201×50 | 41.5 | 58.1 | 62.5 | 62.5 | 212.3 |

Integrity check: stock for the hot pair went from 94/91 to 43/40, exactly −51 each (50 hot sales + 1 from the first distinct cycle). The invoice count rose from 100,001 to 100,202, which equals the requests sent. No negative stock, no lost update. At this scale the write path is not a capacity concern. Every sale also runs a monthly `count(*)` for the plan limit (`limit.middleware.ts:45-57`), even on the enterprise plan whose cap is 999,999. It cost 3.8 ms at 100k invoices and grows with monthly volume. The check is also not atomic with the insert, so concurrent sales can overshoot the cap (a correctness note; plan caps are commercial, not financial).

### 7.3 Login and the event loop (Measured — B6)

`password.ts:1-11` uses **bcryptjs** (pure JavaScript) with `COST = 12`.

| Scenario | Result |
|---|---|
| Sequential login | 281 ms, 242 ms |
| `bcryptjs.hashSync(cost 12)` in-process on the host | 227 ms |
| 6 concurrent logins | **each 1,402–1,410 ms**; a `/health` probe loop managed only 5 probes in 1.41 s (p50 130 ms, **max 998 ms**; baseline ≈0.5 ms) |

bcryptjs yields between rounds but does all its work on the main thread. Login throughput is therefore capped at roughly 1000/240 ≈ **4 logins/s per process** (code-derived from the measurement), and while logins run, every other tenant's request waits. The per-IP route limit (10/min, `auth.routes.ts:48-49`) does not protect the shared event loop. A shift change across many shops — or logins from many IPs — produces stalls of up to a second for everyone.

### 7.4 Transport and server settings (code-derived)

- No response compression: no `@fastify/compress` in `apps/api/package.json`, and the Caddyfile has no `encode` directive (`Caddyfile:1-21`). JSON goes out uncompressed; the stock report was 23.4 MB (§9).
- In production the SPA is served by the same Node process through `@fastify/static` with default options (`index.ts:453-464`), i.e. `Cache-Control: public, max-age=0`. Fingerprinted assets are revalidated on every load, and the event loop serves them.
- No Fastify `requestTimeout` or `connectionTimeout` is set (`index.ts`; Fastify 4 defaults are 0 = unlimited), and PostgreSQL has no `statement_timeout` (Phase 4 DB-31). A slow report holds its socket, connection and memory for as long as it takes.

## 8. Frontend performance analysis

### 8.1 Bundle (Measured — `vite build` into the scratchpad, 2.99 s, 72 assets)

| Chunk | Raw bytes | gzip -9 bytes | Loaded |
|---|---|---|---|
| `index` (entry) | 323,004 | **106,641** | first load |
| `Reports` (includes recharts) | 436,370 | 116,951 | lazily, on the Reports route |
| `xlsx` | 429,487 | 141,700 | dynamically, on client-side export (`apps/web/src/lib/export.ts:24`) |
| `types` | 85,744 | 23,588 | shared |
| `DateRangePicker` | 85,550 | 24,740 | shared |
| `POS` | 38,724 | 11,288 | POS route |

The entry chunk is ≈107 KB gzip, and the heavy libraries are lazily loaded. The bundle is not a material problem. The real frontend costs are the data volumes and polling below. Real-device timings (low-end Android tablets at the counter) are Unknown.

### 8.2 Rendering and polling (code-derived)

| Pattern | Evidence | Effect |
|---|---|---|
| Stock report table renders every row | `Reports.tsx:241` (`stockItems = stockData?.items`), `:360-376` → `components/ui/Table.tsx:96` (`data.map`, no paging or virtualisation) | 60,000 `<tr>` rows (360k cells) for the synthetic tenant, after a 23.4 MB download and `JSON.parse`. Not rendered here, to protect the host — the impact on real devices is Unknown but plausibly a multi-second freeze. |
| Dashboard polling while visible | `Dashboard.tsx:109-113` (dashboard, 120 s), `:115-124` (sales 7-day, 300 s), `:126-130` (invoices, 60 s), `:133-137` (top-products, 300 s) | Each visible dashboard costs ≈1 slow invoice-list call per minute plus a sales report (with its 500-row list) every 5 min. TanStack pauses interval refetches for hidden tabs (`refetchIntervalInBackground` defaults to false; query-core `queryObserver.js:215` checks `focusManager.isFocused()`), so the multiplier is back-office screens left visible all day, not open tabs. |
| POS end-of-day panel uses the full sales report | `POS.tsx:178-191` | Computes payment-method totals but also downloads the 500-invoice list. |
| POS search | product search debounced 250 ms, no `AbortController`, and results written by whichever response lands last (`POS.tsx:194-207`); customer search is a new query per keystroke once 2+ characters are typed (`POS.tsx:158-163`) | Possible out-of-order results and extra load. Each search costs 20–35 ms server time at 20k rows (§7.1). |
## 9. Reports, exports, and bulk operations

### 9.1 Measured (B2, large tenant, c=1)

"Peak RSS" is the API process's maximum resident memory during the scenario. RSS is not returned to the OS between scenarios, so later rows inherit the high-water mark of earlier ones. The jumps are what matter: **≈160 → 761 MB** at sales 365 d, and **→ 1,933 MB** at P&L all-time.

| Endpoint | n | p50 ms | max ms | Response | Peak RSS MB |
|---|---|---|---|---|---|
| `/reports/dashboard` cold | 5 | 9.5 (first 28.7) | 28.7 | 0.2 KB | 159 |
| `/reports/dashboard` warm | 50 | 1.4 | 3.3 | 0.2 KB | 159 |
| `/reports/sales` 30 d | 5 | 63.1 | 67.1 | 266 KB | 197 |
| `/reports/sales` 365 d | 5 | **411.9** | 431.2 | 287 KB | **761** |
| `/reports/sales` all-time | 5 | 407.2 | 412.3 | 287 KB | 734 |
| `/reports/profit-loss` 30 d | 5 | 188.5 | 194.1 | 0.3 KB | 744 |
| `/reports/profit-loss` all-time | 5 | **2,116.8** | 2,132 | 0.3 KB | **1,933** |
| `/reports/top-products` all-time | 5 | 69.0 | 78.5 | 2.1 KB | 1,750 |
| `/reports/stock` (JSON) | 5 | **2,037** | 2,090 | **22.9 MB** | 1,965 |
| `/reports/installments` | 5 | 36.1 | 42.2 | 313 KB | 1,893 |
| `/reports/returns` all-time | 5 | 2.9 | 4.8 | 0.2 KB | 1,805 |
| `/reports/day-close` | 5 | 6.8 | 7.7 | 0.3 KB | 1,802 |
| `/reports/sales?format=excel` all-time | 3 | 423.8 | 434.5 | 30.6 KB | 1,924 |
| `/reports/stock?format=excel` | 3 | **3,624** | 3,779 | 2.4 MB | **2,156** |
| `/reports/profit-loss?format=excel` all-time | 3 | 2,121.6 | 2,136.5 | 6.9 KB | 2,168 |

### 9.2 Why (code-derived, confirmed by the SQL timings in §4.2)

| Report | Unbounded step | Reference |
|---|---|---|
| Profit & loss | Loads **every** sold item in the period (200,000 rows) with a nested variant, then sums COGS in JS with `toDecimal(...).times(...).toNumber()` | `report.service.ts:423-431` |
| Stock | Loads **every** stock row (variants × branches = 60,000) with variant → product → category and branch includes, then builds `items` for all of them | `report.service.ts:227-270` |
| Sales | Loads every invoice in the range (`createdAt`, `totalAmount`) to group by period in JS, plus a 500-row list with `_count` | `report.service.ts:159-180,192-197` |
| Excel | `exceljs` builds the whole workbook in memory and calls `writeBuffer()` (no streaming) | `excel.ts:27-69,75-111,117-148`; routes `report.routes.ts:48,71,169` |

In each case the expensive work is in Prisma materialisation, JS reduction and serialisation on the shared event loop. SQL was 5–7% of the time. All four can be expressed as SQL aggregates (`SUM(quantity * COALESCE(cost_at_sale, cost_price))`, `GROUP BY date_trunc(...)`) or as streamed and paginated results. Doing the arithmetic in SQL `numeric` also removes the floating-point `+= …toNumber()` accumulation that Phase 3 recorded as presentation-level noise (`report.service.ts:195,250-253,428-431`; Phase 3 §calc). The optimisation does not trade away exactness — it improves it. The one condition: the SQL must keep the same COGS rule as today (`cost_at_sale`, falling back to the live `cost_price` only for pre-migration-017 rows) and the same `status = 'completed'` and branch/date predicates.

### 9.3 Sales Excel export silently truncated (Measured)

The all-time sales export from the large tenant (29,657 bytes) had:

- sheet 1, summary: `invoiceCount` = **100,202**, plus revenue totals for all of them;
- sheet 2, invoices: **501 rows = header + 500**.

`buildSalesExcel` writes `data.invoices`, the list capped by `take: 500` (`report.service.ts:178`), and nothing in the file says it is partial. Any reconciliation done from the export (accountant, tax filing) is missing all but the latest 500 invoices. The JSON report's table has the same cap.

### 9.4 Other bulk paths (code-derived, not benchmarked)

| Path | Observation | Reference |
|---|---|---|
| Returns report | `take: 2000` safety cap on the row list (aggregates use SQL) | `report.service.ts:503-507` |
| Installments report | `take: 200` on contracts; counts use SQL | `report.service.ts:295-303` |
| Product and customer CSV import | Row-by-row work inside the request; size limits not assessed in this phase | `product.routes.ts:462`, `customer.routes.ts:362` |
| Customer and supplier statement Excel | In-memory `exceljs`, the same pattern as above (Phase 4 DB-33 found the customer statement queries a missing column) | Phase 1 module map |

## 10. Multi-tenant noisy-neighbour risks

### 10.1 Measured (B3)

A small tenant (`p9s01`) ran sequential probes — `GET /api/customers` page 1, then `GET /health`, with a 20 ms gap — while the large tenant ran **two concurrent heavy requests**: P&L all-time ×3 in parallel with the stock report ×3.

| Window | Small-tenant requests | p50 | p99 | max | `/health` max |
|---|---|---|---|---|---|
| Baseline, 8 s | 267 | 7.0 ms | 11.1 ms | 22.7 ms | 2.0 ms |
| Load, 1-s windows (8.1 s total) | 35–40 per window | 2.8–3.5 ms | 7.3–802.9 ms | **802.9 / 728.7 / 722.9 ms** in 3 of 6 windows | 7.3 ms |

The heavy requests themselves took 2.6–2.8 s each (vs ≈2.1 s alone), and the API peaked at **2,520 MB RSS**. About once per heavy cycle, a cheap request from an unrelated tenant waited 720–800 ms. That is consistent with a synchronous block on the event loop: Prisma result materialisation and `JSON.stringify` of 23 MB. Because probes are sequential, whichever probe is in flight absorbs the stall, which is why `/health` showed only 7 ms.

B6 (§7.3) showed the same effect from logins: six concurrent logins stalled `/health` for up to 998 ms.

### 10.2 Shared resources and their isolation (code-derived + measured)

| Shared resource | Per-tenant bound? | Noisy-neighbour mechanism | Evidence |
|---|---|---|---|
| Event loop (one process) | None | Heavy reports, Excel, bcrypt, big `JSON.stringify` block all tenants | B3, B6 |
| Heap / RSS (no container limit) | None | Two heavy reports → 2.5 GB. Production memory size is Unknown; on a small VPS this ends in an OOM kill of the only process, taking down every tenant | B2, B3; Phase 8 (no `mem_limit`, no replica) |
| PostgreSQL connections | 5 per tenant, but not reclaimed | A burst across about 30 tenants fills `max_connections`; new and evicted tenants then fail | B5 |
| Tenant LRU (50) | — | More than 50 active tenants → eviction with `$disconnect` of a possibly busy client (Phase 4 DB-29); cron walks over all tenants touch the LRU too | `config/database.ts:20-27`, `installment-reminders.job.ts:88-90` |
| PostgreSQL CPU/IO | None (no `statement_timeout`, no per-tenant role limits) | One tenant's all-time report occupies parallel workers (2 per invoice-list query) | §4.2 |
| Redis (one client, `maxRetriesPerRequest: null`) | None | Any Redis stall stops tenant resolution for all (RC-08); the reset sweep scans all tenants' sessions | §6 |
| Cron workers (concurrency 1) | — | One slow tenant (no HTTP timeouts, BG-04) delays reminders and billing for all others | Phase 5 |

### 10.3 Who can trigger it

Anyone with `reports:read` can trigger the heavy endpoints. In practice that is the owner or manager of **any** tenant, including a trial tenant. There is no per-tenant concurrency limit, queue, or rate limit on reports or exports (`@fastify/rate-limit` is opt-in per route, `index.ts:96-97`; reports set none). One user who opens the Stock tab twice in a large shop recreates the B3 conditions.
## 11. Capacity model and assumptions

No production capacity figure can be stated from this audit. The model below separates what was **measured** on the §2.3 harness, what follows from it or from code by **stated arithmetic**, and what is **unknown**. Every extrapolation is linear and assumes production hardware comparable to an M3 Pro core. A small VPS core is probably slower, so treat these figures as optimistic.

### 11.1 Measured unit costs (harness only)

| Unit | Value | Source |
|---|---|---|
| Sale (`POST /invoices`, 2 lines) | 13.5 ms p50 at c=1; 317 req/s at c=10 for one tenant | B4 |
| Invoice list page (100k invoices / 200k items) | 51 ms at c=1; ceiling ≈52 req/s per tenant at c=10 | B1 |
| Login | ≈240 ms of main-thread CPU | B6 |
| P&L | ≈10.6 µs and ≈6 KB transient RSS per sold item in the period (2,117 ms; 744 → 1,933 MB for 200k items) | B2 (ratio is code-derived from measured values) |
| Stock report | ≈34 µs and ≈390 B of JSON per stock row (2,037 ms; 23.4 MB for 60k rows) | B2 |
| Password-reset sweep | ≈0.25 ms per platform-wide refresh session (loopback) | B8 |
| Tenant provisioning | ≈0.6 s per signup (serial) | §5.2 |
| Connections | 31 tenants with 8-way bursts filled 100 slots, which then stayed full ≥ 17 min (until the process stopped) | B5 |

### 11.2 Code-derived limits

| Limit | Formula | Result |
|---|---|---|
| Tenants that can hold a full pool | (`max_connections` − master pool − 2nd master pool − ops headroom) ÷ 5 | With 100, a 2-vCPU host (masters 5 + 5) and 5 spare: (100 − 15) ÷ 5 = **17 tenants**. Because idle connections are not reclaimed (§5.4), this counts tenants that **ever** burst since the last restart, not tenants busy right now. |
| Login throughput per process | 1 s ÷ 0.24 s | **≈4 logins/s**, during which other requests stall |
| P&L memory for a period with *k* sold items | ≈6 KB × *k* | 1M items → ≈6 GB → exceeds any plausible single-process heap (Node sizes its default heap from available memory — typically a few GB, and less in a memory-limited container) |
| Stock report payload | ≈390 B × (variants × branches) | 20k variants × 10 branches → ≈78 MB of JSON in one response |
| Sales export completeness | `take: 500` | Any period with more than 500 invoices is incomplete |
| Reset sweep latency | 0.25 ms × sessions (× RTT factor) | 100k sessions → ≈25 s on loopback |

### 11.3 Scenario sketch (code-derived; for planning, not a promise)

| Scenario | Expected limiting factor | Confidence |
|---|---|---|
| 100 small shops (≤ 5k invoices each), normal trading | Connection budget after bursts (PERF-01); everything else has ample headroom | Likely |
| One large shop (≥ 200k items/year) whose owner opens all-time P&L or Stock | Event-loop stall for every tenant, and a 1–2 GB RSS spike per request (PERF-02) | Confirmed at 200k |
| Shift change: 50 cashiers log in within 10 s | ≈12 s of serialised bcrypt; up to ≈1 s request stalls platform-wide (PERF-04) | Likely |
| Month end: owners export sales to Excel | Exports truncated to 500 invoices (PERF-03); memory per export grows with rows | Confirmed |
| > 50 active tenants | LRU eviction of busy clients (DB-29), plus PERF-01 | Likely |

### 11.4 Unknowns (must be measured before quoting capacity)

1. Production host: vCPU count and speed, RAM, disk type. Which platform is live (VPS compose or Railway) was also left open in Phase 8.
2. Production PostgreSQL settings (`max_connections`, `shared_buffers`, `work_mem`, `statement_timeout`) and Redis `maxmemory`.
3. The real number of tenants, data per tenant (invoices, items, variants × branches), and growth rate.
4. The traffic profile: peak concurrent users, requests/s by endpoint, login waves, report usage. No telemetry exists (INFRA-02).
5. Network RTT from the app to PostgreSQL and Redis (sets the cost of the serial loops in §6.4 and the reminder job).
6. Cold-cache behaviour: all plans here ran with the dataset in memory.
7. Client hardware for the POS and back office (render cost of large tables).
8. Node heap limit in the production container (`NODE_OPTIONS` is not set in `Dockerfile` or compose).

## 12. Cross-phase risk analysis

### 12.1 How Phase 9 relates to earlier findings

| Earlier finding | Phase 9 result |
|---|---|
| **DB-20** (Phase 4, P2, static): 50 × 5 tenant connections > `max_connections` 100 | **Runtime-confirmed and worse** → PERF-01. Saturation is reached with about 30 tenants and **does not clear on its own**; signup fails; operators are locked out. |
| **INFRA-09** (Phase 8, P3): two master pools, no pooler | Part of PERF-01's budget. The pooler fix carries a tenant-isolation precondition → PERF-11. |
| **DB-29** (Phase 4, P3): LRU eviction disconnects in-flight clients | Raised in likelihood. The LRU is the only reclamation path, and cron walks touch every tenant (PERF-12). |
| **DB-31** (Phase 4, P3): default transaction limits, 5-connection pool, no `statement_timeout` | Explains why PERF-02 queries and sockets have no upper bound. |
| **RC-08** (Phase 4.5): unbounded waits and shared resources, no capacity budget | PERF-01, PERF-02 and PERF-04 are its performance face: one process, one pool budget, one Redis client, no timeouts or limits. |
| **INFRA-01** (Phase 8, P1): no backups | Made worse by PERF-01: `pg_dump` and `psql` as `postgres` cannot connect while the pool is saturated. |
| **INFRA-02** (P1): no monitoring | Nothing would surface P2037 bursts, RSS spikes or event-loop lag. |
| **INFRA-03** (P2): `/health` ignores dependencies | `/health` stayed 200 throughout B5 (database saturated) and B3 (event-loop stalls of 0.8 s). |
| **BG-04** (Phase 5, P2): no HTTP timeouts in jobs | Interacts with the serial per-tenant cron walks (PERF-12). |
| **L5-03** (Phase 5, P3, Likely): `Queue` per ETA enqueue | **Measured** (B7): +4.93 KB heap and +1 `error` listener per call. Upgraded to Confirmed (replica); kept under L5-03, no new ID. |
| **BG-15** (Phase 5, P3): ETA failed jobs never removed | Redis cost measured at ≈0.83–0.89 KB per job (B7); still bounded only by volume. |
| **INT-01** (Phase 6, P2): ETA resubmit fails before enqueue | Keeps L5-03 latent today. |
| **UX-06** (Phase 7, P2): stale financial summaries | Separate root cause (client cache). The 120 s dashboard cache (PERF-13) adds up to 2 min of server-side staleness on top. |
| Phase 3 §calc: report aggregation in JS floats | Moving aggregation into SQL `numeric` (PERF-02 fix) also removes it. |
| Phase 1 S-09: low-stock filter after pagination (stock list) | Different endpoint. The stock **report** has no pagination at all (PERF-02/PERF-09). |

### 12.2 Compound scenarios

1. **Month-end at a large tenant + a new signup.** The owner runs P&L and the stock export. RSS climbs past 2 GB and every tenant sees 0.7–0.8 s stalls (PERF-02). Meanwhile earlier bursts have filled the connection budget, so a new shop's signup returns 500 (PERF-01). `/health` stays green (INFRA-03) and nothing alerts (INFRA-02).
2. **OOM restart as the only "recovery".** If the container has a memory cap, a heavy report kills the process. That also clears PERF-01, because the pools are dropped. The 25 s drain cannot complete within Docker's ≈3 s default stop (INFRA-04), and BullMQ jobs in flight are retried (Phase 5 BG-01: billing charges come before their record). A performance incident can therefore become a double-charge incident.
3. **Adopting PgBouncer naïvely.** Following the code comment (`config/database.ts:15`) with transaction pooling fixes PERF-01 but opens a cross-tenant path through unqualified raw SQL (PERF-11). It also breaks the migration lock (Phase 4.5).
## 13. Confirmed findings

Severity follows the series convention: P0 = financial or data integrity at risk now; P1 = platform-wide outage or severe degradation under normal load; P2 = significant degradation or a correctness defect in a common path; P3 = bounded or latent; Informational = no action required beyond awareness.

### PERF-01 — The PostgreSQL connection budget fills up after a burst across about 30 tenants and does not recover; new tenants then get 500s · **P1** · Confirmed

| Field | Detail |
|---|---|
| Affected | All tenants that need a new connection: new signups, tenants outside or evicted from the LRU, tenants whose pool must grow, boot migrations, cron walks, operators (`psql`/`pg_dump` as `postgres`) |
| Location | `apps/api/src/config/database.ts:6-9` (master pool, no limit), `:16-17` (50 × 5), `:20-27` (LRU: `ttl` without `ttlAutopurge`), `:34-38` (URL: no idle lifetime); `packages/database/src/prisma.ts:5-9`; `docker-compose.prod.yml:2-7` (`max_connections` default 100; app uses superuser `postgres` per `.env.example`) |
| Evidence and method | B5: 31 tenants × 8 concurrent invoice-list requests × 5 rounds on the throwaway stack (PG 16, `max_connections` 100). Backends counted with `ps` inside the container every 30 s for 8 minutes. Signup tried during saturation. |
| Measured result | API: **541 × P2037 "too many clients already"**. PostgreSQL: 743 rejections. Afterwards **100/100 backends idle at every sample from 17:15:22 to 17:23:24 UTC and again at 17:31:38** (≈17 min); released only when the API process stopped. New tenant signup **500** (61 ms; again 59 ms at 17:31:38). Superuser `psql` refused. Tenants with existing pools kept working. `/health` 200 throughout. |
| Bottleneck and impact | The tenant-pool model assumes connections return when tenants go quiet, but pooled idle connections are held indefinitely and the LRU disposes clients only lazily. After normal bursty trading by a few dozen shops, the platform cannot onboard customers, cannot serve tenants that reappear after eviction, cannot run boot migrations cleanly, and cannot be backed up or inspected — until the stale clients happen to be touched after their 30-min TTL, are evicted, or the process restarts (only the restart was observed to clear it). Nothing alerts (INFRA-02/03). |
| Remediation (not implemented) | (1) Immediately: set an explicit `connection_limit` and an idle lifetime (`max_idle_connection_lifetime`, accepted by the 5.22 engine — verify the effect with R-01) on every Prisma URL, including both master clients; enable `ttlAutopurge` (or a periodic sweep) so idle tenant clients are `$disconnect`ed; give the app a non-superuser role so `superuser_reserved_connections` keeps an operator path; set `max_connections` deliberately. (2) Structurally: a pooler — **only after** PERF-11's precondition (schema-qualified raw SQL) and the migration-lock change (Phase 4.5) — or a single shared pool that switches schema per transaction. (3) Alert on `numbackends / max_connections` and P2037/P2024 rates. |
| Related | DB-20, DB-29, DB-31, INFRA-09, INFRA-01, INFRA-02, INFRA-03, RC-08; PERF-11, PERF-12 |
| Regression test | R-01 (§16): a burst across N tenants must leave ≤ X backends after the idle window, and a new signup must still succeed; fails today. |

### PERF-02 — Reports and exports build entire datasets in the API process; one owner can stall every tenant for ≈0.8 s and add 1–2 GB of RSS per request · **P1** · Confirmed

| Field | Detail |
|---|---|
| Affected | `GET /api/reports/profit-loss`, `/reports/stock`, `/reports/sales` (JSON and `format=excel`); every tenant sharing the process |
| Location | `apps/api/src/modules/reports/report.service.ts:423-431` (P&L loads all sold items), `:227-270` (stock loads all variants × branches with nested includes), `:159` and `:192-197` (sales loads every invoice in range to group in JS); `excel.ts:27-69,75-111,117-148` (in-memory `writeBuffer`); `report.routes.ts:48,71,169`; no per-route limit (`index.ts:96-97`) |
| Evidence and method | B2: each endpoint c=1, n=3–5, on the 100k-invoice tenant, RSS sampled every 100 ms. SQL timed via `log_min_duration_statement=20`. B3: small-tenant probes while two heavy requests ran. |
| Measured result | P&L all-time **2,117 ms** (SQL ≈150 ms), RSS 744 → **1,933 MB**. Stock **2,037 ms**, **23.4 MB** JSON (SQL 118 ms). Stock Excel **3,624 ms**, RSS 2,156 MB. Sales 365 d 412 ms, RSS 160 → 761 MB. With two heavy requests in parallel: RSS **2,520 MB**, and a small tenant's p99 rose from **11 ms to 723–803 ms** in 3 of 6 one-second windows. |
| Bottleneck and impact | 93–95% of the time is Prisma materialisation plus JS reduction and serialisation on the single event loop. Cost and memory grow linearly with tenant history (≈6 KB RSS per sold item for P&L). A large shop's owner opening Reports degrades POS checkout for every other shop. With a container memory cap — or a larger tenant — the likely end state is an OOM kill of the only process (all tenants down; jobs in flight retried, see §12.2). |
| Remediation (not implemented) | Push aggregation into SQL: P&L COGS as `SUM(ii.quantity * COALESCE(ii.cost_at_sale, v.cost_price))` with the same predicates; sales buckets via `GROUP BY date_trunc(...)`; stock totals via SQL and a **paginated** item list. Stream Excel (`exceljs` streaming `WorkbookWriter`) from a cursor or keyset query, or generate it in a background job with a download link. Add per-tenant concurrency limits for reports and exports, a `statement_timeout` for report queries, and an in-process memory guard. Correctness constraint: the SQL must reproduce the current COGS fallback, status and date filters exactly (§9.2). Do not cache P&L or stock values to hide the cost. |
| Related | RC-08, DB-31, INFRA-02, INFRA-04, Phase 3 §calc (float accumulation); PERF-03, PERF-09 |
| Regression test | R-02 (latency/RSS budget at 200k items) and R-03 (noisy-neighbour p99 budget). |

### PERF-03 — The sales report and its Excel export are silently capped at the latest 500 invoices · **P2** · Confirmed

| Field | Detail |
|---|---|
| Affected | `GET /api/reports/sales` (the `invoices` list) and `?format=excel`; the Reports page table; any accounting or tax reconciliation done from the export |
| Location | `report.service.ts:160-179` (`take: 500`, at `:178`); `excel.ts:27-69` (writes `data.invoices`) |
| Evidence and method | Downloaded the all-time export from the 100k-invoice tenant and counted `<row>` elements in each sheet. |
| Measured result | Summary sheet `invoiceCount` = **100,202**; invoices sheet = **501 rows (header + 500)**. Nothing marks the file as partial. |
| Bottleneck and impact | A performance cap became a completeness defect. The export reads like a full ledger whose totals do not reconcile with its rows. For any period with more than 500 sales (a busy shop's week), the line-level export cannot be trusted. |
| Remediation (not implemented) | Make the export complete by streaming every matching invoice (keyset on `created_at, id`) under PERF-02's streaming design. In JSON, return a paginated list with `total` and a "partial" flag. Until then, show "latest 500 of N" in both the UI and the file. |
| Related | PERF-02; Phase 3 reporting integrity |
| Regression test | R-04: export row count must equal `summary.invoiceCount` for a 1,000-invoice fixture. |

### PERF-04 — Password hashing runs on the main thread: a handful of concurrent logins freezes the API for every tenant · **P2** · Confirmed

| Field | Detail |
|---|---|
| Affected | `POST /api/auth/login` (and every bcrypt call: signup, password change and reset, user creation); all tenants while logins run |
| Location | `apps/api/src/shared/utils/password.ts:1-11` (`bcryptjs`, `COST = 12`); per-IP route limit only, `auth.routes.ts:48-49` |
| Evidence and method | B6: 2 sequential logins, then 6 concurrent logins with a `/health` probe loop (10 ms gap); `hashSync` timed in-process. |
| Measured result | 242–281 ms per login alone. 6 concurrent: **1,402–1,410 ms each**; `/health` max **998 ms**, and only 5 probes completed in 1.41 s. |
| Bottleneck and impact | About 4 logins/s per process saturate the event loop. Shift start across many shops — or logins spread over many IPs — produces platform-wide stalls of up to a second, including checkout. |
| Remediation (not implemented) | Use native `bcrypt` (libuv thread pool) or `argon2`, or keep bcryptjs but run it in a `worker_threads` pool, so hashing leaves the event loop. Add a global (not just per-IP) concurrency cap on password verification. Keep cost 12, or re-tune it from a measured hash time on production hardware. Do not lower the cost for performance without a security review (Phase 2). |
| Related | RC-08; Phase 2 authentication findings |
| Regression test | R-05: `/health` p99 under 10 concurrent logins must stay < 50 ms. |

### PERF-05 — The invoice list aggregates every invoice item on every page view and sorts the whole table · **P2** · Confirmed

| Field | Detail |
|---|---|
| Affected | `GET /api/invoices` (Invoices page; dashboard "recent invoices", polled every 60 s while visible, `apps/web/src/pages/Dashboard.tsx:126-130`); the sales report's 500-row list uses the same `_count` (`report.service.ts:175`) |
| Location | `apps/api/src/modules/invoices/invoice.service.ts:72-87` (`_count: { select: { items: true } }` at `:81`, `orderBy createdAt desc` + `skip`); indexes `packages/database/migrations/tenant/002_full_schema.sql:271-273,289` |
| Evidence and method | B1 latency; SQL captured from the API; `EXPLAIN (ANALYZE, BUFFERS)`; hypothetical index inside `BEGIN … ROLLBACK`. |
| Measured result | Page 1: **82.6 ms** in SQL (GroupAggregate over 200k items + hash join over 100k invoices, 2 parallel workers); page 4,000: 103.8 ms with ≈7 MB disk spill per worker. API: 51 ms p50 at c=1; at c=10 **p50 188 ms and only 51.8 req/s**. Rewrite with an index on `created_at DESC` and a 20-row correlated count: **0.271 ms**. |
| Bottleneck and impact | Cost grows with total invoices and items, not page size, and each request occupies two of the tenant's five connections plus parallel workers. The busiest back-office screen is the first to degrade as a shop grows, and it amplifies PERF-01. |
| Remediation (not implemented) | Add `invoices(created_at DESC)` (and `(status, created_at DESC)` if the status filter is common). Compute `itemCount` only for the returned page (a separate `groupBy` with `invoiceId in [...]`, or a stored `item_count` column maintained inside the invoice transaction). Use keyset pagination for deep pages. Pure read-path change; no transaction semantics touched. |
| Related | PERF-01, PERF-06 |
| Regression test | R-06: plan assertion (no Seq Scan/GroupAggregate over `invoice_items` for page 1) and p95 < 20 ms at 100k invoices. |

### PERF-06 — Search uses leading-wildcard `ILIKE` across joins (always a full scan), and invoice search silently truncates to 200 matches · **P3** · Confirmed

| Field | Detail |
|---|---|
| Affected | `GET /api/products/search` (POS typing, purchase orders, installments, stock pages); `GET /api/customers?search=`; `GET /api/invoices?search=` |
| Location | `product.routes.ts:344-376`; `customer.routes.ts:18-55`; `invoice.service.ts:41-48` (raw `ILIKE` with `LIMIT 200` per query); callers `apps/web/src/pages/pos/POS.tsx:197`, `PurchaseOrders.tsx:235`, `Installments.tsx:297`, `stock/Stock.tsx:179` |
| Evidence and method | B1 latency; `EXPLAIN ANALYZE`; hypothetical `pg_trgm` GIN indexes (rolled back). |
| Measured result | Product search 20.9–27.3 ms p50 at 20k variants (Seq Scan on both tables; a full barcode typed into search 21.9 ms vs **0.038 ms** with the exact-barcode index). Customer search 10.6–11.9 ms p50 (two parallel 18 ms seq scans). **Trigram indexes were not used** (20.1 ms) because the `OR` spans a join. Invoice search returns at most 200 + 200 IDs, then paginates over them, so the result list and `total` are wrong when more rows match. |
| Bottleneck and impact | Linear in catalog and customer size. Fine at 20k rows, roughly 10× worse at 200k. POS barcode scanning is not affected (it uses `/products/barcode/:code`, `POS.tsx:218`). The 200-ID cap is a silent correctness defect for users searching common names. |
| Remediation (not implemented) | Rewrite as a `UNION` of per-column predicates (`sku`/`barcode` prefix or equality, `name` with a trigram index) so each branch can use its index; add `pg_trgm` GIN indexes in a tenant migration; replace the 200-ID pre-filter with a single query that joins and paginates. Abort stale requests client-side (`AbortController`). |
| Related | PERF-05; §8.2 (POS search without abort) |
| Regression test | R-07: plan assertion (Bitmap Index Scan) and p95 < 10 ms at 200k variants; a 300-invoice customer must return `total = 300`. |

### PERF-07 — Password reset scans every tenant's sessions with one Redis round trip per key · **P3** · Confirmed (replica)

| Field | Detail |
|---|---|
| Affected | `POST /api/auth/reset-password` (response latency); Redis load |
| Location | `apps/api/src/modules/auth/auth.service.ts:194-209`; session keys written at `:68-75` |
| Evidence and method | B8: the exact loop replicated with ioredis against the throwaway Redis, with 1k and 20k synthetic `refresh:*` keys (the real endpoint could not be exercised because PostgreSQL was saturated by B5 at the time). |
| Measured result | 1,048 keys → 298 ms; **20,048 keys → 5,039 ms** (201 SCANs, 20,048 serial GETs, loopback). |
| Bottleneck and impact | O(all sessions on the platform) per reset, multiplied by Redis RTT. It slows down as the platform grows, regardless of tenant. Rate limiting prevents abuse but not the latency. |
| Remediation (not implemented) | Keep a per-user set `user_sessions:<userId>` of refresh-token keys, maintained on issue, rotate and logout, and delete exactly those keys. Or `MGET`/pipeline the batch as an interim step. Session revocation must stay complete — test that every session of the user is gone. |
| Related | Phase 2 session handling; RC-08 |
| Regression test | R-08: reset with 50k unrelated sessions must finish < 200 ms and revoke all of the user's sessions. |

### PERF-08 — No response compression, and the SPA is served by the API process with `max-age=0` · **P3** · Confirmed

| Field | Detail |
|---|---|
| Affected | Every JSON response (largest: stock report, 23.4 MB) and every static asset |
| Location | `Caddyfile:1-21` (no `encode`); `apps/api/package.json` (no `@fastify/compress`); `apps/api/src/index.ts:453-464` (`fastifyStatic` with default `maxAge` 0) |
| Evidence and method | Configuration read; measured response sizes (B2); gzip of the built bundle (F). |
| Measured result | Stock JSON **23,464,659 B uncompressed**; entry JS 323,004 B raw vs 106,641 B gzip; static assets revalidated on every navigation (code-derived from library defaults). |
| Bottleneck and impact | Larger transfers on mobile and shop connections; static file serving competes with API work on the event loop. |
| Remediation (not implemented) | Add `encode zstd gzip` in Caddy (or `@fastify/compress`). Serve `/assets/*` with `Cache-Control: public, max-age=31536000, immutable` and `index.html` with `no-cache`, ideally straight from Caddy. Never compress responses whose content mixes secrets with user input (BREACH): the API sets auth through headers and cookies, not in bodies, so the risk is low but should be noted. |
| Related | INFRA-05 (build/deploy) |
| Regression test | R-09: `content-encoding` present on JSON > 1 KB; hashed assets carry `immutable`. |

### PERF-09 — The Reports page renders every stock row and visible dashboards poll heavy endpoints · **P3** · Confirmed (code); client impact Unverified

| Field | Detail |
|---|---|
| Affected | Reports → Stock tab; Dashboard; POS end-of-day panel |
| Location | `apps/web/src/pages/reports/Reports.tsx:194-198,241,360-376`; `apps/web/src/components/ui/Table.tsx:96`; `apps/web/src/pages/Dashboard.tsx:109-113,115-124,126-130,133-137`; `apps/web/src/pages/pos/POS.tsx:178-191` |
| Evidence and method | Code read; payload measured in B2; rendering not executed (host safety). |
| Measured result | The stock payload for the synthetic tenant is 60,000 items / 23.4 MB, all passed to a non-virtualised table. Each visible dashboard polls four endpoints (60–300 s), including the 500-row sales list. |
| Bottleneck and impact | Probable multi-second freezes on low-end devices (Unverified), plus server load that grows with visible dashboards rather than users' actions. |
| Remediation (not implemented) | Server-side pagination for the stock report (PERF-02) with a virtualised table; a dedicated lightweight "trend" endpoint for the dashboard instead of the full sales report; longer intervals (hidden tabs already pause: TanStack's `refetchIntervalInBackground` defaults to false). |
| Related | PERF-02, PERF-05; UX-06 |
| Regression test | R-10: the stock tab with 60k rows renders < 1 s on a throttled CPU profile (Playwright trace). |

## 14. Likely, potential, and unverified findings

### PERF-10 — Every create runs a plan-limit `count(*)`, even on uncapped plans, and the check is not atomic · **P3** · Likely

| Field | Detail |
|---|---|
| Affected | `POST /api/invoices`, product, user and branch creation |
| Location | `apps/api/src/shared/middleware/limit.middleware.ts:23-70` (invoice count at `:55`); `invoice.routes.ts:29` |
| Evidence and method | Code read; `EXPLAIN ANALYZE` of the monthly count; the plans table (`enterprise` caps = 999,999, so `limit <= 0` never short-circuits). |
| Measured result | 3.8 ms at 100k invoices (3,218 this month), a scan of the whole `idx_invoices_customer` index. Not significant today. |
| Bottleneck and impact | Grows with monthly volume. The count and the insert are separate, so N concurrent creates at `cap − 1` can all pass (commercial over-use, not financial). |
| Remediation (not implemented) | Treat a sentinel (e.g. ≥ 999,999 or null) as uncapped and skip the count; for real caps, use a counter row incremented in the same transaction as the insert, or `SELECT … FOR UPDATE` on a usage row. |
| Related | PERF-05 (same missing `created_at` index) |
| Regression test | R-11: 20 concurrent creates at `cap − 1` must yield exactly 1 success. |

### PERF-11 — Following the code's own advice (PgBouncer transaction pooling) would let raw SQL run in another tenant's schema · **P2** · Potential

| Field | Detail |
|---|---|
| Affected | Every raw-SQL call site (24 in `apps/api/src`), e.g. invoice search `invoice.service.ts:41-48`; the migration runner's advisory lock `packages/database/src/migrate-tenants.ts:64-76` |
| Location | Recommendation comment `apps/api/src/config/database.ts:11-15`; per-client schema via the URL `schema` parameter `:34` |
| Evidence and method | Captured SQL: Prisma model queries are schema-qualified, raw SQL is not. The 5.22 engine binary contains `SET search_path = "`, i.e. the schema is applied per physical connection. No pooler exists in the repo, so this was **not executed**. |
| Measured result | None (Potential). |
| Bottleneck and impact | In transaction pooling, server connections are shared across client pools. A tenant-A raw query could run with tenant B's `search_path`, giving cross-tenant reads and writes on the paths that use raw SQL (search, ETA, migrations). This would be a P0 isolation break if deployed. |
| Remediation (not implemented) | Before any transaction-mode pooler: schema-qualify all raw SQL (e.g. `Prisma.raw` with a validated schema identifier), or wrap each raw call in a transaction that issues `SET LOCAL search_path`; move migrations to a direct connection with `pg_advisory_xact_lock`; set `pgbouncer=true`. Prove it with a two-tenant interleaving test through the pooler. |
| Related | PERF-01, DB-20, INFRA-09, Phase 4.5 RC-08 risk note (migration lock), Phase 2 tenant-isolation findings |
| Regression test | R-12: through the pooler, alternate tenant A/B raw searches on one server connection 1,000 times; zero foreign rows. |

### PERF-12 — Cron jobs and boot migrations walk every tenant serially and churn the tenant-client LRU · **P3** · Potential

| Field | Detail |
|---|---|
| Affected | `installment-reminders` (daily 09:00), dunning, renewal, trial-expiry workers; `migrateAllTenants` at boot |
| Location | `apps/api/src/jobs/installment-reminders.job.ts:50,83-90,95-108,119-131` (unbounded per-tenant `findMany`; one audit `findFirst` plus a send plus an insert per payment, serial); `packages/database/src/migrate-tenants.ts:125-142` (one new client per tenant, serial); `apps/api/src/index.ts:148-180` |
| Evidence and method | Code read. Not executed: the synthetic customers have no e-mail, and running boot migrations under B5 saturation would only reproduce PERF-01. |
| Measured result | None. Code-derived: work = O(tenants + reminders × (1 DB round trip + 1 HTTP call + 1 insert)), serial; with BG-04 (no HTTP timeout) a single hung send blocks the whole walk. |
| Bottleneck and impact | With more than 50 tenants, each walk evicts the LRU clients of tenants trading at that moment (DB-29) and opens new pools (PERF-01). Boot time grows linearly with tenant count. |
| Remediation (not implemented) | Use a dedicated, bounded DB client for batch work (not the request LRU); paginate per-tenant scans; add a `(status, due_date)` index on `installment_payments`; fan out per tenant as separate BullMQ jobs with their own concurrency limit and timeouts; run tenant migrations as a deploy step, not at process start. |
| Related | DB-29, BG-04, BG-06, BG-14, INFRA-05 |
| Regression test | R-13: with 200 synthetic tenants, a reminder walk must not change the set of LRU-resident clients of tenants active during the run. |

### PERF-13 — The dashboard caches today's revenue for 120 s with no invalidation · **Informational** · Confirmed (code)

| Field | Detail |
|---|---|
| Location | `apps/api/src/modules/reports/report.service.ts:42-45,117` |
| Evidence | B2: cache saves ≈8 ms per request (cold 9.5 ms vs warm 1.4 ms) at 100k invoices. |
| Assessment | A small performance gain for a short staleness window on an at-a-glance screen. Day-close does not use it (`report.service.ts:580-665`). **No change recommended**, except a "last updated" label. Do not extend this cache to P&L, day-close, receipts or anything used for reconciliation without a written invalidation design (write-through on invoice and return commit). |
| Related | UX-06 |

### Unverified (stated so they are not mistaken for clean results)

| Topic | Why unverified |
|---|---|
| Cold-cache and production-disk query times | The whole dataset fitted in memory; production IO is Unknown. |
| Real-device rendering of the stock table and POS | Not executed, to protect the host. |
| Behaviour behind a real network (RTT to PostgreSQL and Redis) | Everything was loopback. |
| Long-run memory (leaks other than L5-03) | No soak test was run; peak RSS was observed, not steady-state. |
| Exact Prisma idle-connection default | The engine accepts `max_idle_connection_lifetime`; B5 only shows no reclamation within ≈17 min. |
| CSV import throughput and limits | Not benchmarked (§9.4). |

## 15. Prioritized recommendations

None of these were implemented. "Correctness guard" names what each change must not weaken.

| # | Action | Fixes | Effort | Correctness guard |
|---|---|---|---|---|
| 1 | Bound and reclaim connections: `connection_limit` + idle lifetime on **all** Prisma URLs; LRU `ttlAutopurge`/sweeper that `$disconnect`s idle clients; non-superuser app role; deliberate `max_connections`; alerts on backends/P2037/P2024 | PERF-01 | S | Only `$disconnect` clients with no in-flight transaction (DB-29). |
| 2 | Move report aggregation into SQL; paginate the stock report; stream exports (or background job + download); per-tenant report concurrency limit; `statement_timeout` for report queries | PERF-02, PERF-03, PERF-09 | M | Same COGS fallback, status and date predicates; reconcile old vs new totals on fixtures to the cent before switching. No caching of financial values. |
| 3 | Make exports complete (keyset stream) or visibly partial now | PERF-03 | S (label) / M (stream) | Row count = summary count. |
| 4 | Take hashing off the event loop (native bcrypt/argon2 or worker pool) plus a global concurrency cap | PERF-04 | S | Same cost factor; existing hashes stay verifiable. |
| 5 | `invoices(created_at DESC)` index; page-only item counts; keyset deep pages | PERF-05 | S | Read path only; the migration must be `CREATE INDEX CONCURRENTLY`-safe per tenant (DB-21 migration runner caveats). |
| 6 | Before any pooler: schema-qualify raw SQL, move the migration lock, two-tenant interleaving test | PERF-11 (enables a structural fix for PERF-01) | M | Tenant isolation must be proven, not assumed. |
| 7 | Search rewrite (`UNION` + `pg_trgm`), remove the 200-ID pre-filter, client `AbortController` | PERF-06 | M | Search results must be a superset of today's for the same term. |
| 8 | Per-user session index for reset | PERF-07 | S | Every session of the user must be revoked. |
| 9 | Compression and immutable asset caching in Caddy | PERF-08 | S | — |
| 10 | Batch jobs on a dedicated client, fanned out per tenant with limits and timeouts; migrations as a deploy step | PERF-12 | M | Phase 5 idempotency (BG-01) must be fixed first, or fan-out multiplies double-charge risk. |
| 11 | Skip limit counts for uncapped plans; atomic usage counter for capped plans | PERF-10 | S | — |
| 12 | Observability first: event-loop lag, RSS, PG backends, P2037/P2024, route p95 (INFRA-02) | all | S | — |

Order of work: 12 and 1 first (they make everything else visible and remove the persistent outage), then 2–5, then 6 before considering a pooler.

## 16. Performance regression test plan

### 16.1 Principles

- Run only on isolated, disposable infrastructure: CI containers or a dedicated perf environment. Never production or a shared environment.
- Use a fixed, versioned synthetic dataset (the §2.3 generator, committed as a fixture script) at two sizes: **S** (5k invoices) and **L** (100k invoices / 200k items / 20k variants × 3 branches). Seed 30+ small tenants as well.
- Record the hardware, PostgreSQL settings, dataset size, concurrency, duration and tool version with every result. Compare against a stored baseline from the **same** runner class; fail on a relative regression (e.g. +25% p95), not an absolute number from this report.
- Every performance test also asserts correctness: totals match a reference SQL computation to the cent, stock deltas match sales, and no cross-tenant rows appear.

### 16.2 Tests

| ID | Target | Method | Pass criteria (initial) | Today |
|---|---|---|---|---|
| R-01 | Connection reclamation (PERF-01) | Burst 31 tenants × 8 × 5 as in B5; wait the configured idle window; count `pg_stat_activity`; then register a tenant and query an evicted tenant | Zero P2037; backends ≤ budget after the window; signup 201 | **Fails** (541 P2037; 100/100 idle ≥ 17 min; signup 500) |
| R-02 | Report latency and memory (PERF-02) | P&L all-time, stock, sales 365 d on L; sample RSS and event-loop lag (`perf_hooks.monitorEventLoopDelay`) | p95 < 500 ms; RSS delta < 150 MB; loop-lag max < 100 ms | **Fails** (2.1 s, +1.2 GB) |
| R-03 | Noisy neighbour (PERF-02/04) | B3: small-tenant probes while 2 heavy reports run | small-tenant p99 < 50 ms | **Fails** (723–803 ms) |
| R-04 | Export completeness (PERF-03) | Export sales on a 1,000-invoice fixture; count rows | rows = `invoiceCount` | **Fails** (500 of 100,202) |
| R-05 | Login isolation (PERF-04) | 10 concurrent logins + `/health` loop | `/health` p99 < 50 ms | **Fails** (998 ms with 6 logins) |
| R-06 | Invoice list plan and latency (PERF-05) | `EXPLAIN (FORMAT JSON)` assertion + c=10 latency on L | No GroupAggregate over `invoice_items`; p95 < 20 ms at c=1 | **Fails** (82.6 ms SQL) |
| R-07 | Search plans and completeness (PERF-06) | Plan assertion on 200k variants; a customer with 300 invoices | Index scans; `total = 300` | **Fails** (seq scan; 200-ID cap) |
| R-08 | Reset sweep (PERF-07) | 50k unrelated sessions + 3 of the user's | < 200 ms; the user's 3 revoked, others intact | **Fails** (5.0 s at 20k) |
| R-09 | Transport (PERF-08) | `curl -H 'Accept-Encoding: gzip'` on JSON > 1 KB and on `/assets/*` | `content-encoding` set; assets `immutable` | **Fails** |
| R-10 | Client rendering (PERF-09) | Playwright on the stock tab with L data, 4× CPU throttle, trace long tasks | Total blocking time < 1 s | Not run |
| R-11 | Plan-limit atomicity (PERF-10) | 20 concurrent creates at `cap − 1` | Exactly 1 success | Not run |
| R-12 | Pooler isolation (PERF-11) | Through PgBouncer (transaction mode), 1,000 alternating raw searches for tenants A/B | Zero foreign rows | Not run (no pooler) |
| R-13 | Batch walks vs LRU (PERF-12) | 200 tenants; reminder walk during c=5 traffic from 10 tenants | Active tenants' clients not evicted; no P2037 | Not run |
| R-14 | Write path guard | B4 distinct and hot-SKU | p95 ≤ baseline +25%; stock deltas exact; invoice count exact | Passes (baseline: 19.5 / 44.6 / 58.1 ms p95) |
| R-15 | Bundle budget | `vite build`; gzip entry chunk | entry ≤ 120 KB gzip; `xlsx` stays dynamic | Passes (106.6 KB) |

### 16.3 Tooling note

All of the above ran here with plain Node `fetch` scripts and `psql`, adding no dependencies. A team may prefer k6 or autocannon in CI. Adding either is a dependency change that belongs to the remediation work, not to this audit.

## 17. Evidence ledger

All runtime evidence comes from the throwaway stack in §2.3, on 2026-10-12 between 17:00 and 17:35 UTC. Raw script outputs were transcribed verbatim from the console into the report draft as the runs finished.

| # | Evidence | Kind | Where used |
|---|---|---|---|
| E1 | Hardware and container facts (M3 Pro 11 cores / 18 GiB; Docker 29.7.2 VM 11 CPU / 7.75 GiB; PG 16.13 defaults) | Measured (`sysctl`, `docker info`, `SHOW`) | §2.3 |
| E2 | 31 tenant registrations, 201 ×31, 0.54/0.59/0.69 s; 34 backends | Measured | §5.2 |
| E3 | Synthetic dataset counts and 301 MB schema size | Measured (`count(*)`, `pg_total_relation_size`) | §2.3 |
| E4 | B1 latency table (14 scenarios) | Measured | §7.1 |
| E5 | Captured SQL for invoice list, product search, customer search (`log_min_duration_statement=0`), including Prisma's `_count` LEFT JOIN aggregate | Measured | §4.2 |
| E6 | `EXPLAIN (ANALYZE, BUFFERS)`: invoice list 82.6 ms / page 4,000 103.8 ms with external merge; rewrite with a rolled-back index 0.271 ms; `count(*)` 7.3 ms | Measured | §4.2, PERF-05 |
| E7 | `EXPLAIN ANALYZE` product search 32.9 / 21.9 ms; trigram GIN (rolled back) unused 20.1 ms; exact barcode 0.038 ms | Measured | §4.2, PERF-06 |
| E8 | B2 report and export table (16 scenarios) with peak RSS | Measured | §9.1, PERF-02 |
| E9 | SQL share of report time (`log_min_duration_statement=20`): P&L 35.9 + 115.6 ms of 2,123 ms; stock 118.1 ms of 2,215 ms (23,464,659 B); sales 32.7/46.2/59.2/83.1 ms of 452 ms | Measured | §4.2, §9.2 |
| E10 | PostgreSQL log: no statement > 200 ms except 4 invoice-list executions at 214–262 ms during the B5 burst (17:14:29) | Measured | §4.3 |
| E11 | B3 noisy-neighbour windows (baseline p99 11.1 ms; load maxima 802.9 / 728.7 / 722.9 ms; RSS 2,520 MB; heavy latencies 2.6–2.8 s) | Measured | §10.1 |
| E12 | B4 write path table and integrity (stock 94/91 → 43/40; invoices 100,001 → 100,202) | Measured | §7.2 |
| E13 | `requireUnderLimit` count plan 3.8 ms; plans `starter 300 / professional 3000 / enterprise 999999` | Measured | PERF-10 |
| E14 | B5: 541 × P2037 in the API log; 743 PostgreSQL rejections; superuser `psql` refused; 100 idle backends at 16 samples 17:15:22–17:23:24 UTC and at 17:31:38; signups 500 (61 ms, 59 ms); existing tenant 200 in 5 ms; 0 backends after the API stopped; no orphan tenant rows or schemas | Measured | §5.3, PERF-01 |
| E15 | Prisma 5.22 engine strings: `SET search_path = "`, `max_idle_connection_lifetime`, `max_connection_lifetime`; lru-cache 10.4.3 | Code-derived (binary strings, `package.json`) | §5.4, §5.6, PERF-11 |
| E16 | B6 login: 281/242 ms; 6 concurrent 1,402–1,410 ms; `/health` max 998.1 ms; `hashSync` 227 ms | Measured | §7.3, PERF-04 |
| E17 | B7 Queue replica: 0.78 vs 0.373 ms/add; +4.93 KB heap/add; +3,000 listeners; ≈890/830 B per job | Measured (replica) | §6.3 |
| E18 | B8 reset sweep replica: 298 ms @1,048 keys; 5,039 ms @20,048 keys | Measured (replica) | §6.4, PERF-07 |
| E19 | Sales export: 29,657 B; summary `invoiceCount` 100,202; invoices sheet 501 rows | Measured | §9.3, PERF-03 |
| E20 | `vite build` chunk sizes and gzip -9 sizes; 72 assets; 2.99 s | Measured | §8.1 |
| E21 | Environment checks printed as booleans only: `.env.example` user is `postgres`, no `connection_limit`, no pooler host; `.env.production` absent locally; no `NODE_OPTIONS`/`max_connections`/memory limits in compose or Dockerfile | Code-derived | §5.1, §11.4 |
| E22 | Configuration reads: `Caddyfile` (no `encode`), `index.ts:453-464` (static defaults), TanStack `queryObserver.js:215` (node_modules; background refetch gated by focus) | Code-derived | §7.4, §8.2 |

## 18. Audit declaration

| Statement | Status |
|---|---|
| Application code, tests, migrations, configuration, package files and dependencies modified | **No.** `vite build` wrote only to the scratchpad (`--outDir`). `git status` after the audit matches before: only the pre-existing `AppShell.tsx`, `POS.tsx` and `documents/` changes, plus this report. |
| Production or shared environments accessed | **No.** All runtime work used throwaway loopback containers (`hesba-p9-pg` on 127.0.0.1:55438, `hesba-p9-redis` on 127.0.0.1:56384) and synthetic tenants `p9large`, `p9s01`–`p9s30`. |
| Real payments, e-mails or tax submissions sent | **No.** All external endpoints were overridden to blank or dead loopback values, and a loopback-only fetch guard wrapped the API process. |
| Load tests against production or shared environments | **None.** Largest run: 1,240 requests in one burst on the throwaway stack. |
| `EXPLAIN ANALYZE` used only on safe local data | **Yes.** Hypothetical indexes and `pg_trgm` were created inside `BEGIN … ROLLBACK`. |
| Secrets printed or copied into the report | **No.** Environment checks printed booleans only. Synthetic test passwords and tokens existed only in the scratchpad and were deleted. |
| User's development containers | `hesba_postgres` and `hesba_redis` were not touched (still `Exited`). Docker Desktop was started for this phase at 16:59:57 UTC — its restart policy auto-started the user's `moneyprinterturbo` containers, which were left untouched — and was quit at the end, returning to its prior stopped state. |
| Cleanup | API process stopped (task and `pkill`); the throwaway containers were removed with `docker rm -f`; the scratchpad (scripts, logs, tokens, the synthetic Excel file, the build output) was deleted. |
| Benchmarks that ran | B1–B8, E (EXPLAIN), F (build) — §2.4. |
| Conclusions that are static (code-derived) | §3, §5.1, §5.4, §5.6, §6.1, §6.3 (retention), §7.4, §8.2, §9.2, §9.4, §11.2–11.3, PERF-09 (client impact), PERF-10 (atomicity), PERF-11, PERF-12. |
| Capacity limits that remain unknown | All production capacity figures — see §11.4 (hardware, PG/Redis settings, tenant count and sizes, traffic, network RTT, cold-cache IO, client devices, Node heap limit). |
| Verification of this report | Every `path:line` reference was checked against the working tree (the file exists and the line is within its length) by a script; see the validation note below. |

**Validation note.** A Node script extracted every `path:line[-line]` reference (100 unique) from this report, resolved each one against `git ls-files`, and confirmed the file exists and the cited lines are within its length: **99 resolved, 0 failures**. The one excluded reference is TanStack's `queryObserver.js:215`, which lives in `node_modules` (not tracked) and is labelled as such. The first cited line of every resolved reference was also printed and checked by eye against the claim. All 18 required sections are present (§1–§18).
