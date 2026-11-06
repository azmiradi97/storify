# Hesba Phase 4 — Database, Transactions & Concurrency Audit

| | |
|---|---|
| Date | 2026-10-08 |
| Code under review | branch `claude/ui-pos-merge-split` @ `8846bce` (the two user-modified web files in the working tree were read, not changed) |
| Scope | `apps/api` (services, routes, jobs, middleware, config), `packages/database` (Prisma schemas, master + tenant migrations, migration runner), POS offline queue in `apps/web` |
| Method | Static review, then **runtime reproduction against a disposable PostgreSQL 18.3 cluster** created in the session scratchpad (127.0.0.1, random port, no Unix socket, password auth). The cluster was migrated by the repo's own `provisionTenant()` → `runTenantMigrations()`. Races were run through the **real** service functions and the **real** Fastify route plugins (`app.inject`, authentication stubbed in the harness). Production, the VPS, the repo's `.env` values and every external service were not used. One incidental Prisma CLI telemetry check is disclosed in the closing statement. |
| Builds on | Phase 1 discovery (`Hesba_Phase1_Discovery_Report.md`), Phase 2 security (`Hesba_Phase2_Security_Audit.md`), Phase 3 financial integrity (`Hesba_Phase3_Financial_Integrity_Audit.md`) |

**Severity** follows the P0–P3 scale in the brief, applied as follows:
- **P0** corrupts money, stock or state in normal single-user operation.
- **P1** does so under realistic concurrency, retries or a common outage, or takes customer money incorrectly.
- **P2** needs specific timing, scale or an operational failure.
- **P3** is latent, hygiene or low-impact.

**Classification:**
- **CONFIRMED** means reproduced at runtime, or unambiguous in code where runtime was impossible (marked "code").
- **LIKELY** means the mechanism is confirmed but the trigger depends on timing or environment.
- **POTENTIAL** means plausible but not demonstrated.
- **UNVERIFIED** means it needs access I did not use.

Scenario IDs (S…, B…, M…, P…) refer to the harness runs summarised in §39.

---

## 1. Executive Summary

**Atomicity holds; isolation does not.** Every multi-row business write that matters runs inside one interactive Prisma transaction. Fault injection never left a partial write:
- deadlocks (39 victims);
- 5-second transaction timeouts (8 sales);
- CHECK violations;
- a client disconnected mid-transaction;
- a failing migration file.

The weakness is concurrency. Everything runs at **READ COMMITTED**, with no `SELECT … FOR UPDATE`, no SERIALIZABLE and no advisory locks in application code. The code uses two patterns, and the runtime split between them is clean:

| Pattern | Where | Runtime result |
|---|---|---|
| Conditional atomic UPDATE (`… WHERE quantity >= n`, `used_count < max_uses`, `loyalty_points >= n`, `used_at IS NULL`) | sale stock, coupon, loyalty redemption, stock adjustment, password reset | **safe**: stock 5/5, coupon 5/5, loyalty 5/5 |
| Check-then-act (state read outside the transaction, then an unconditional write inside it) | every status transition and most balance edits | **unsafe in 13 of 13 operations tested** |

**Measured on the real code (throwaway DB):**

| Scenario | Result |
|---|---|
| Store credit 1,000, two concurrent sales each using 700 | balance **−400** in **20/20** trials |
| Two concurrent approvals of one installment contract | **6 schedule rows instead of 3**, stock decremented twice (5/5) |
| Two concurrent cancels of one invoice | stock **+4 instead of +2**, credit refunded twice, coupon usage under-counted (5/5) |
| Two concurrent full returns | **1,000 credit for a 500 sale**, stock +4 (5/5) |
| Two concurrent "receive all" on one PO | **20 of 10 received**, supplier liability ×2 (2/3) |
| Two concurrent PO payments of the full amount | **2,000 paid on 1,000** (3/3) |
| Work order: two concurrent "create invoice" | **2 invoices** (3/3) |
| Work order: two concurrent payments of 100 | paid **100** (3/3) |
| Two receipts of one variant at once | cost **250.0000 vs 233.3333** serial WAC (3/3) |
| Two 2-line sales with the same items in opposite order | **39/40 pairs**: one sale aborted by a deadlock, surfaced as a raw `ConnectorError` (HTTP 500) |

**FIN-03 and FIN-04 are confirmed at runtime** (P0). Cancelling a *pending* installment invoice restocks goods that never left. Returning it through the API also issues **1,000 store credit on an unpaid invoice**. Approving the contract afterwards **revives the cancelled invoice** as `completed`. The root cause is that invoice and contract have no shared state machine, and status checks are blacklists (`!== 'cancelled'`) rather than allowed transitions.

**SaaS billing takes money it shouldn't** (P1):
- **Dunning selects paid subscriptions.** Its selection (`ACTIVE|PAST_DUE|SUSPENDED`, `failedAttempts > 0`, card on file) ignores whether the period is paid and whether cancellation is scheduled. One declined checkout attempt on a fully paid subscription (25 days left) makes it a dunning target, and the stored card is charged 3 days later (B4, B7).
- **Trial expiry can overwrite a just-completed payment** with `PAST_DUE` and `failedAttempts = 1`, which also makes it a dunning target (B6).
- **No idempotency with Paymob.** Renewal and dunning send a fresh `merchant_order_id` per attempt. If the DB write fails after a successful charge, the BullMQ retry charges again (LIKELY).

**Platform-level failure modes, reproduced:**
- **A Redis outage hangs every tenant request indefinitely.** The single ioredis client is shared with BullMQ and uses `maxRetriesPerRequest: null`. A GET against an unreachable Redis was still pending after 4 s; with `maxRetriesPerRequest: 1` it fails in 54 ms.
- **Connection ceiling.** 50 cached tenant clients × 5 connections exceeds `max_connections` 100. With 22 busy tenants, **17 queries failed with "too many clients already"**.
- **LRU eviction disconnects a tenant client in the middle of its transaction.**

**Migrations and provisioning:**
- `schema_version` is bumped *after* each migration's transaction commits, and files 001/002/016 are not re-runnable. A crash in that window leaves a tenant failing every migration sweep (reproduced).
- A crash mid-provisioning (SIGKILL) leaves a `PROVISIONING` tenant at schema version 3 that no sweep repairs, and its **subdomain and email can never be registered again** (reproduced).
- Exceptions are compensated correctly (reproduced).

**Schema drift:**
- The ETA job's SELECT, its "accepted" UPDATE and all three `eta_submissions` INSERTs fail against the migrated schema (runtime EXPLAIN).
- `installment_payments.payment_method_id` exists in SQL but not in Prisma, so it is never written.
- The customer statement export queries a missing column.
- `prisma migrate diff` shows 722 lines of tenant-model drift (timestamp types, FK actions, indexes). Master has no material drift.

**Correction to Phase 3:** the claim that concurrent payment of the last two installments can leave a contract `active` with every row paid is **wrong**. The ordering pre-check rejects the second payment in 20/20 trials (§31).

| Classification | Count | P0 | P1 | P2 | P3 | INFO |
|---|---|---|---|---|---|---|
| CONFIRMED | 38 | 1 | 9 | 13 | 14 | 1 |
| LIKELY | 10 | — | — | 4 | 6 | — |
| POTENTIAL | 10 | — | — | 1 | 9 | — |
| UNVERIFIED | 7 | — | — | — | — | — |

**Fix themes** (detail in §37):
1. Make every status change a conditional UPDATE (`WHERE id = $1 AND status = $expected`, require count = 1), or lock the parent row first.
2. Bound every balance change in the UPDATE itself, and back it with CHECK constraints: credit ≥ 0, loyalty ≥ 0, received ≤ ordered, paid ≤ total.
3. Add natural unique keys (`installment_payments(contract_id, installment_number)`, one invoice per work order) and idempotency keys on creates.
4. Dunning and renewal must re-check that the period is unpaid and not cancel-scheduled, and use one idempotency key per billing period.
5. Give the request path its own fail-fast Redis connection, with DB fallback on cache errors.
6. Bump `schema_version` in the same transaction as the DDL, and make provisioning resumable with a sweeper.

---

## 2. Database Architecture

| Aspect | Implementation | Evidence |
|---|---|---|
| Engine | PostgreSQL 16 in production (`postgres:16-alpine`) with the image's default configuration: `max_connections` 100, no `statement_timeout`, no `lock_timeout`, no `idle_in_transaction_session_timeout`. Reproductions ran on 18.3; the behaviours relied on here (READ COMMITTED re-evaluation, deadlock detection, sequences, NOT VALID CHECKs) are unchanged since well before 16 | `docker-compose.prod.yml:2-18` |
| Layout | One database `hesba_master`. `public` holds 6 master tables (Prisma Migrate, 8 migrations). Each tenant gets schema `tenant_<subdomain>` with 46 tables, built by a custom runner over 17 SQL files | `schema.prisma`; `migrations/tenant/001…017` |
| Roles and isolation | One DB role for master and all tenants (`POSTGRES_USER postgres`, a superuser). No RLS. Tenant isolation is only the client's `?schema=` search_path | Phase 2 C-01..C-04 |
| Master clients | Two `PrismaClient` instances, one in `apps/api/src/config/database.ts:6-9` and one in `packages/database/src/prisma.ts:5-13` (used by the migration runner) | — |
| Tenant clients | LRU, max 50, 30-min idle TTL, `updateAgeOnGet`. URL is `DATABASE_MASTER_URL` plus `schema`, `connection_limit=5`, `pool_timeout=20`. Eviction calls `$disconnect()` | `config/database.ts:16-42` |
| Interactive transactions | Prisma 5.22 defaults: **`maxWait` 2000 ms, `timeout` 5000 ms, `isolationLevel` undefined**. None of the 22 application call sites override them; only the migration runner passes 120 s | `@prisma/client/runtime/library.js` (`maxWait:…??2e3,timeout:…??5e3`); §5 |
| Effective isolation | READ COMMITTED (`SHOW default_transaction_isolation` on the test cluster; nothing in the code sets another level) | grep of `apps/api`, `packages/database/src`: no `isolationLevel`, `FOR UPDATE`, `SERIALIZABLE`, advisory lock |
| Locks | Implicit row locks from UPDATE/INSERT only. One session advisory lock in the tenant migration runner. Redis `SET NX PX` locks around job cycles | `migrate-tenants.ts:72-81,113`; `shared/utils/lock.ts:11-24` |
| Types | Master: `TIMESTAMP(3)` without time zone, Postgres enums for statuses. Tenant: `TIMESTAMPTZ`, free-form `VARCHAR` statuses (no enum or CHECK), `INT` quantities, `NUMERIC(15,4)` money, UUID PKs from `gen_random_uuid()` | Phase 1 §7 |
| Sequences | `invoice_number_seq` per tenant (non-transactional) | `015_invoice_number_sequence.sql` |
| Redis | **One** IORedis client (`maxRetriesPerRequest: null`, `lazyConnect`, offline queue on), shared by the tenant/subscription cache, refresh sessions, the rate limiter's store, job locks, the dashboard cache and every BullMQ queue and worker | `config/redis.ts:4-7`; `index.ts:96-99` |
| Background jobs | In-process BullMQ: trial-expiry 06:00, renewal 07:00, dunning 08:00, reminders 09:00, ETA (concurrency 3, 5 attempts). Production runs **one** app container (`container_name: hesba_app`), so the realistic overlaps are cron vs manual trigger and job vs user request, not two workers | `index.ts:500-508`; `docker-compose.prod.yml:35-50` |
| Startup | `app.listen()` happens **before** the fire-and-forget tenant migration sweep; `/health` returns 503 only if *every* tenant fails | `index.ts:472,484-498,166-175` |

---

## 3. Prisma vs SQL Migration Integrity

**Method.**
1. Applied the 8 master migrations with `psql` (all OK on an empty database).
2. Provisioned tenant `p4shop` through the real `provisionTenant()`. Result: `schema_version` 17, 46 tables, 8 NOT VALID CHECKs, a `TRIALING` subscription, and seeded payment methods including `fee_type = 'percent'` (FIN-06 data confirmed).
3. Ran the read-only `prisma migrate diff --from-url <temp schema> --to-schema-datamodel <schema file> --script` for both schemas.
4. Ran `EXPLAIN` on every raw-SQL statement in the ETA path and the customer statement, against the migrated schema.

**Master:** no material drift. The only difference is `ON UPDATE CASCADE` on `platform_audit_logs.actor_id`. The environment-specific data-fix migrations (hard-coded tenant id) are no-ops on a fresh database.

**Tenant model vs SQL** (722-line diff):

| Drift | Count | Runtime effect today | Risk |
|---|---|---|---|
| SQL `TIMESTAMPTZ` vs un-annotated Prisma `DateTime` (`TIMESTAMP(3)`) | 37 tables (~60 columns) | none; Prisma writes UTC instants | any `prisma db push` or `migrate` against a tenant schema would rewrite them as `timestamp without time zone` |
| SQL `updated_at DEFAULT now()` vs `@updatedAt` (no DB default) | 10 tables | raw-SQL writes (coupon counter, ETA status) never bump `updated_at` | stale `updated_at` |
| FK actions differ (SQL CASCADE / SET NULL / NO ACTION vs Prisma's implied RESTRICT / SET NULL + `ON UPDATE CASCADE`) | 80 FKs | the database governs. Example: SQL `invoice_items → invoices` is **CASCADE**, the Prisma model implies **RESTRICT** | developers reason from the wrong delete semantics; tooling would rewrite FKs |
| Column present in SQL, absent in Prisma: `installment_payments.payment_method_id` (010) | 1 (and its FK) | `recordPayment` accepts `paymentMethodId` (`installment.schema.ts:30`) but cannot store it, so installment collections never record a payment method (DB-32) | day-close attribution (FIN-11) |
| SQL indexes not modelled | 28 (+2 named differently) | none | tooling would drop them |
| Uniques modelled differently (partial unique barcode vs plain index; partial unique `work_orders.invoice_id` vs `@unique`) | 2 | uniqueness still enforced by the database | — |

**Raw SQL vs the real schema** (EXPLAIN on the migrated tenant schema, runtime):

| Statement | Result |
|---|---|
| `eta-submission.job.ts:70-81` (job's first query) | **ERROR 42703**: `ts.eta_signing_cert_pem` does not exist (also `eta_is_production`) |
| `eta-submission.job.ts:186-190` (accepted) | **ERROR**: `eta_qr_data` does not exist (real column: `eta_qr_code`) |
| `eta-submission.job.ts:193-195` (failed/rejected) | OK |
| `eta.submit.ts:64-67` INSERT (failed attempt) | **ERROR**: `created_at` does not exist (real column: `submitted_at`); also omits `direction`, which is NOT NULL with no default |
| `eta.submit.ts:80-83` INSERT (accepted) | **ERROR**: `submission_id` does not exist |
| `eta.submit.ts:96-99` INSERT (rejected) | **ERROR**: `submission_id` does not exist |
| `customer.routes.ts:259-260` (statement export) | **ERROR**: `installment_contracts.remaining_amount` does not exist |

**Consequences:**
- Every ETA job fails at its first query, is retried 5 times, and the worker's `failed` handler then sets `eta_status = 'failed'`. Submission history is never written (DB-23).
- The statement export's `Promise.all` rejects, so the endpoint returns 500 (DB-33).

Phase 1 recorded E-01 and CU-03 statically; both are now **runtime-confirmed**. The repo's parity test compares table names only (`tenant-schema-parity.test.ts:13-14,51-75`), so none of this is caught in CI.

---

## 4. Database Constraints

**What the database enforces:**
- **Primary keys:** UUID everywhere.
- **Tenant UNIQUEs:**
  - `users.email`, `roles.slug`, `password_reset_tokens.token_hash`
  - `product_variants(product_id, sku)`, barcode (partial)
  - `stock(variant_id, branch_id)`, `currencies.code`, `coupons.code`
  - `invoices.invoice_number`, `invoices.eta_internal_id`
  - `installment_contracts.invoice_id`, `external_financing.invoice_id`
  - `expense_budgets(category_id, period)`
  - `work_orders.ticket_number`, `work_orders.invoice_id` (partial)
- **Master UNIQUEs:** `tenants.subdomain`, `tenants.schema_name`, `tenants.email`, `plans.name`, `plans.slug`, `payment_attempts.provider_transaction_id`, `platform_admins.email`.
- **CHECKs (016, `NOT VALID`):** `convalidated = false` on the test cluster, meaning existing rows are not checked, **but new writes are**. S12 hit `23514 chk_stock_quantity_nonneg`.
  - variant cost ≥ 0 and sell price ≥ 0
  - stock quantity ≥ 0 and min ≥ 0
  - coupon `used_count` ≥ 0
  - `installments_count` > 0
  - contract amounts ≥ 0
  - invoice subtotal, total and paid ≥ 0

**Missing constraints that the harness violated through application code alone.** The final tally on the throwaway database:
- 24 customers with negative credit;
- 1 with negative loyalty;
- 2 PO items with received quantity above ordered;
- 3 POs paid above total;
- 15 contracts with duplicated installment numbers;
- 3 work orders with two invoices.

### Constraint Matrix

| Invariant | DB constraint | Application check | Transaction | Risk |
|---|---|---|---|---|
| Stock ≥ 0 | CHECK (016, NOT VALID) | conditional decrement in sale, approve and adjust; **pre-check only** in transfers | inside tx | Low where 016 is applied; transfers rely on the CHECK (500 on violation); legacy rows unvalidated |
| Sale qty ≤ on-hand | conditional UPDATE | yes | yes | **Safe** (S3) |
| Coupon uses ≤ `max_uses` | none (only `used_count ≥ 0`) | conditional raw UPDATE | yes | Safe for redemption (S4); double cancel under-counts (S8) |
| `credit_balance ≥ 0` | **none** | pre-transaction cap | unconditional decrement in tx | **High** (DB-02) |
| `loyalty_points ≥ 0` | **none** | conditional redeem; **unconditional** reversal | tx | Medium (DB-17) |
| One schedule row per (contract, number) | **none** | pre-transaction status read | tx | **High** (DB-03) |
| Σ schedule + down payment = contract total | none | computed at approval | tx | OK serially; doubled by DB-03 |
| Returned ≤ sold per line | **none** | cumulative cap read **outside** the tx | no lock | **High** (DB-06) |
| Received ≤ ordered per PO line | **none** | outstanding computed outside the tx | no lock | **High** (DB-07) |
| PO paid ≤ total | **none** | remaining computed outside the tx | array tx | Medium (DB-16) |
| Work-order paid ≤ total | **none** | none | none | Medium (DB-14) |
| One invoice per work order | partial UNIQUE on `work_orders.invoice_id` (prevents two WOs sharing an invoice, **not** one WO creating two) | pre-check `invoiceId == null` | tx | Medium (DB-13) |
| Invoice / contract / transfer / PO / WO status transitions | none (free `VARCHAR`) | blacklist checks before the tx | none | **High** (DB-01, DB-03..07, DB-11) |
| Invoice ↔ contract status coupling | none | none | — | **High** (DB-01) |
| One live subscription per tenant | none (`tenant_id` not unique) | unordered `findFirst` in checkout and webhook | — | Low (P-02) |
| Payment transaction processed once | UNIQUE `provider_transaction_id` | P2002 → no-op | array tx | **Safe** (B1) |
| Invoice number unique | UNIQUE + sequence | — | tx | Safe (numbers can have gaps, DB-38) |
| Subdomain, schema and email unique | UNIQUE | pre-check | — | **Safe** (M5) |
| Migration applied exactly once | `schema_version`, **not** in the DDL transaction | version filter + advisory lock | per file | Medium (DB-21) |
| One `tenant_settings` row | none | `findFirst()` / `CROSS JOIN … LIMIT 1` | — | Low (P-04) |
| Invoice amounts ≥ 0, variant prices ≥ 0, contract count > 0 | CHECK (016) | partly (zod) | tx | Safe for new writes |
| One stock row per (variant, branch) | UNIQUE | upsert | tx | Safe (a racing upsert aborts with P2002) |

---

## 5. Transaction Map

**Interactive or array `$transaction` call sites (22, none with isolation or timeout options):**
- **Sales:** `invoice.service.ts:309` (sale), `:616` (return), `:712` (cancel).
- **Installments:** `installment.service.ts:228` (create contract), `:321` (approve), `:414` (reject), `:455` (record payment).
- **Stock:** `stock.service.ts:84` (adjust), `:251` (approve transfer).
- **Purchase orders:** `po.routes.ts:145` (edit draft), `:293` (receive), `:418` (payment, array).
- **Suppliers and products:** `supplier.routes.ts:194` (manual transaction, array), `product.routes.ts:545` (bulk import, per row).
- **Work orders:** `workOrder.routes.ts:125` (create), `:283` (status), `:340` (add line), `:373` (remove line), `:455` (invoice).
- **Auth:** `auth.service.ts:177` (password reset).
- **Billing:** `billing.service.ts:145` (webhook success, array), `:225` (webhook failure, array).

**Multi-write flows with no transaction:**
- provisioning;
- the migration version bump;
- manual customer credit and its audit row;
- the audit rows written after the PO payment and WO invoice transactions;
- work-order payment;
- trial expiry (update, then Redis, then email);
- reminders (send, then audit row);
- renewal and dunning (charge, then DB write);
- the ETA job (status, then external call, then status).

### Transaction Coverage Matrix

| Operation | Transaction? | Reads | Writes | External calls | Atomic? | Idempotent? | Concurrency safe? |
|---|---|---|---|---|---|---|---|
| Sale `createInvoice` | interactive `:309-550` | payment method, currency, coupon, variants, discounts, credit, points (**before** the tx); settings (in tx) | credit, points, invoice, items, stock, movements, coupon counter, fee expense, external financing, sequence, invoice number, audit/ledger | none | **Yes** (P1-run, S17) | No | stock, coupon, loyalty: **Yes**; credit: **No** (DB-02); deadlock-prone (DB-18) |
| Return `returnInvoice` | interactive `:616-679` | invoice + items, prior returns (before tx) | return + items, stock, movements, credit, audit | none | Yes | No | **No** (DB-06) |
| Cancel `cancelInvoice` | interactive `:712-869` | invoice + items, return count (before tx); customer audit history (in tx) | coupon counter, stock, movements, credit, points, status, audit | none | Yes | No | **No** (DB-05) |
| Create contract | interactive `installment.service.ts:228-302` | payment method, currency, customer, variants | invoice (`pending`), items, contract, audit | none | Yes | No | n/a (creates; duplicates on retry) |
| Approve contract | interactive `:321-400` | contract + invoice items (before tx) | contract, invoice, stock, movements, N schedule rows, audit | none | Yes | No | **No** (DB-03, DB-04) |
| Reject contract | interactive `:414-432` | contract (before tx) | contract, invoice, audit | none | Yes | No | **No** (DB-04) |
| Record installment payment | interactive `:455-489` | row, previous-unpaid count (before tx); pending count (in tx) | row, contract status, audit | none | Yes | No | ordering **Yes** (S5b); same row twice **No** (DB-27) |
| Stock adjustment | interactive `stock.service.ts:84-124` | — | stock (conditional), movement | none | Yes | No | **Yes** |
| Create transfer | single nested create `:198-213` | — | transfer + items | none | Yes | No | n/a |
| Approve transfer | interactive `:251-301` | transfer, availability (before tx) | stock ×2, movements ×2, status | none | Yes | No | **No** (DB-11) |
| Reject transfer | single update `:231-237` | transfer (before) | status | none | Yes | Yes | **No** against a concurrent approve |
| PO edit (draft) | interactive `po.routes.ts:145` | PO status (before) | delete and re-create items, PO | none | Yes | No | No against a concurrent approve (LIKELY, code) |
| PO receive | interactive `:293-392` | PO + items (before); on-hand aggregate and variant cost (in tx, **unlocked**) | stock upsert, cost, movement, received qty, receipt, supplier tx, balance, status, audit | none | Yes | No | **No** (DB-07, DB-12) |
| PO payment | array `:418-447`; audit after (`:449`) | PO (before) | payment, PO paid, supplier tx, balance | none | DB part yes, audit no | No | **No** (DB-16) |
| Supplier manual transaction | array `supplier.routes.ts:194-210` | supplier | transaction, balance (atomic ±) | none | Yes | No | **Yes** (unbounded by design) |
| Customer manual credit | **none** `customer.routes.ts:140-155` | customer | balance (**absolute**), audit | none | **No** | No | **No** (DB-15) |
| Work-order create / lines | interactive `:125`, `:340`, `:373` | WO | WO, lines, history | none | Yes | No | n/a |
| Work-order status | interactive `:283` | WO (before) | WO, history | none | Yes | Yes for the same target | last writer wins (LIKELY) |
| Work-order invoice | interactive `:455-513`; audit after (`:515`) | WO, payment method, currency, settings (before) | invoice, items, number, WO link | none | DB part yes | No | **No** (DB-13) |
| Work-order payment | **none** `:547-570` | WO, payment method | WO paid (**absolute**), audit | none | **No** | No | **No** (DB-14) |
| Settings PATCH | single update `index.ts:325` | settings | only the supplied fields | none | Yes | Yes | **Yes** (field-level) |
| Password reset | interactive `auth.service.ts:177-188` | token (before) | conditional claim + password | none | Yes | **Yes** | **Yes** |
| Refresh token rotation | Redis GET / DEL / SET | session | session | Redis | No | No | **No** (L-06) |
| Tenant provisioning | **none**; compensating catch `tenant.service.ts:192-286` | tenant, plan | tenant row, schema, 17 migration txs, 12 seed writes, status, subscription | none | **No** (M6) | No (not re-entrant) | duplicates: **Yes** (M5) |
| Tenant migration file | interactive per file `migrate-tenants.ts:95-102`; version bump separate `:104-107` | tenant | DDL; `schema_version` | none | file **yes**, version **no** | No for 001, 002, 016 (M1) | **Yes** (advisory lock, M3); TOCTOU POTENTIAL |
| Webhook success | array `billing.service.ts:145-174`, then Redis, then email | subscription (unordered `findFirst`) | payment attempt, subscription | Redis, email | DB part yes | **Yes** for the same txn id (B1) | not monotonic (DB-25) |
| Webhook failure | array `:225-251`, then Redis, then email | subscription | attempt, `failedAttempts` (**absolute**) | Redis, email | Yes | Yes for the same txn id | **No** (DB-24) |
| Cancel subscription | single update `:310-315` | latest subscription | subscription | Redis | Yes | Yes | dunning ignores it (DB-08) |
| Checkout | none | subscription (unordered) | **nothing persisted** | Paymob | n/a | No | n/a |
| Renewal cycle | none `renewal.job.ts:62-175` | due list (read once) | through the webhook handlers | Paymob ×2 per subscription | **No** (charge vs DB) | **No** | **No** (L-01, L-03) |
| Dunning cycle | none `dunning.job.ts:61-165` | selection | through the handlers | Paymob ×2 | **No** | **No** | **No** (DB-08) |
| Trial expiry | none `trial-expiry.job.ts:58-168` | trials (read once) | subscription; Redis; email | email | No | reminder counter yes | **No** (DB-19) |
| Installment reminders | none `installment-reminders.job.ts:69-170` | payments, audit | audit row after send | email | No | No | **No** (DB-26) |
| ETA job | none `eta-submission.job.ts:66-201` | invoice + settings (**fails**), items | `eta_*` columns, submissions | ETA API | No | No | n/a (broken, DB-23) |

---

## 6. Atomicity

**Verified at runtime: failed transactions roll back completely.**

| Fault | Scenario | Observed |
|---|---|---|
| 5 s interactive-tx timeout | P1-run: 8 concurrent sales against a row held by a 7 s lock | 5 × "Transaction already closed … expired transaction", 3 × "Unable to start a transaction in the given time". Stock 100 → **100**, invoices +**0** |
| Deadlock (`40P01`) | S17: 39 victims | stock decreased by **exactly** the number of committed sales |
| CHECK violation (`23514`) | S12 "exact": second transfer approval | first approval's state only (from 0, to 3, 2 movements) |
| Client disconnected mid-tx | P3-run: LRU eviction | stock unchanged; the tx aborted |
| Migration file failure | M2: 016 fails on re-run | nothing applied; `schema_version` stays 15 |
| Provisioning exception | M4: stray `roles` table makes 001 fail | tenant row deleted, schema dropped |

**Non-atomic sequences:**

| Flow | Sequence | What a crash between the steps leaves |
|---|---|---|
| Provisioning | tenant row → schema → 17 file txs + version bumps → 12 seed writes → ACTIVE → trial | orphan `PROVISIONING` tenant (M6) |
| Migration file | DDL commit → `schema_version` update (different client) | re-run of non-idempotent DDL, permanent failure (M2) |
| Manual credit | balance (absolute) → audit row | balance changed without an audit row |
| PO payment / WO invoice | DB tx → audit row | missing audit row |
| WO payment | update → audit row | missing audit row |
| Webhook | DB tx → Redis invalidation → email | stale cache ≤ 30 s / 300 s; if Redis is down the response hangs (DB-09) |
| Trial expiry | update → Redis DEL → email | stale `sub:status` ≤ 30 s |
| Reminders | send → audit row | duplicate send on the next run |
| Renewal / dunning | **charge** → DB write | money taken, not recorded; retry re-charges (L-01) |
| ETA | `submitted` → ETA call → status | moot while the job's SELECT fails (DB-23) |

No external call happens **inside** an interactive transaction. That is good: no locks are held across network I/O.

---

## 7. FIN-03 Root Cause

**Classification:** missing state validation, plus an incorrect cross-entity state machine. Not a concurrency bug.

**How it happens:**
1. **Contract creation** (`installment.service.ts:228-302`) creates the invoice with status `pending` and `paidAmount` 0, plus its items. **Stock is not touched.**
2. **`cancelInvoice`'s checks** (`invoice.service.ts:701-710`) reject only `cancelled`, `returned`, or an invoice that has returns. A `pending` invoice passes.
3. **The cancel transaction** restocks **every variant line unconditionally** (`:722-738`). The quantity comes from the invoice lines, not from the stock movements recorded for that invoice. It then sets `cancelled` (`:845-848`).
4. **`returnInvoice`** rejects only `cancelled` (`:569`). The restock (`:636-653`) and credit (`:656-661`) are computed from the lines, while `paid_amount` is 0.
5. **The UI** offers cancel for `pending` invoices (`Invoices.tsx:326`, Phase 3).

**Runtime:**
- **S11:** stock 5 → cancel → **6** → approve → 5. The goods left, so true stock is 4. The invoice goes `cancelled` → **`completed`** with paid 0.
- **S11b:** a return of the pending invoice moves stock 5 → **6** and gives the customer **1,000 credit**.

**Why the design allows it:**
- No field records "this invoice moved stock".
- Invoice and contract are mutated independently.
- Checks are blacklists of bad states instead of an allowed-transition table.
- Reversals reuse the forward quantities instead of reversing what was actually recorded.

**Fix direction:**
- Use a transition table per entity, enforced in the UPDATE's `WHERE`.
- Compute reversals from the `out` movements that reference the invoice.
- Make installment invoices cancellable or returnable only through the contract.

---

## 8. FIN-04 Root Cause

- **Approval checks the wrong entity.** `approveContract` validates only the contract's status (`installment.service.ts:319`). Inside the transaction it sets the invoice to `completed` with `paidAmount = downPayment` **without** `WHERE status = 'pending'` (`:329-332`).
- **Invoice changes never touch the contract.** `cancelInvoice` and `returnInvoice` never read or update `installment_contracts` (`invoice.service.ts:555-870`).
- **Reminders keep running.** The reminder job selects by contract status only (`installment-reminders.job.ts:95-108`).

**Runtime (S11):** cancel the invoice, then approve. Result: the invoice is revived to `completed`, the contract is `active`, the schedule is created, and stock is decremented. The cancellation is silently undone.

**Root cause:** two entities hold one business state with no owner and no coupling. Neither transaction checks the partner entity's current state.

---

## 9. FIN-07/08/09 Root Cause

**Numbering note.** The brief labels FIN-08 "duplicate stock moves" and FIN-09 "duplicate invoices/overpayments". In the Phase 3 report the IDs are:
- **FIN-07:** duplicated state transitions, including duplicate schedules and duplicate stock movements from double cancel, return, transfer or receipt.
- **FIN-08:** non-atomic or unbounded balance updates, including overpayments.
- **FIN-09:** missing idempotency, including duplicate invoices from retries and offline replay.

This section uses Phase 3's IDs and covers all three labels. Phase 3 is not in error here; only the labels differ.

**FIN-07: duplicated transitions (CONFIRMED at runtime: S6, S7, S8, S9, S10, S12, S13, S14)**
- **Mechanism.** The status is read with the base client *before* the transaction, and the transaction's first write is `update({ where: { id } })`.
  - Under READ COMMITTED, the second transaction blocks on the first one's row lock.
  - When the first commits, the second re-evaluates its WHERE clause (`id = …`), which still matches, so it proceeds and repeats every side effect.
  - With `WHERE id = … AND status = 'pending_approval'`, the re-evaluation would find no row (count 0) and the second transaction could abort cleanly.
- **Natural unique keys that would have blocked it are absent:** `installment_payments(contract_id, installment_number)`, and "one invoice per work order" enforced in the right direction.
- **Duplicate stock moves observed:**
  - S8: `cancellation` movements twice;
  - S9 and S10: `return` and `cancellation` both applied;
  - S12: 4 `transfer` movements instead of 2;
  - S13: `in` movements twice;
  - S6: `out` movements twice.

**FIN-08: balances (CONFIRMED at runtime: S1, S15, S16, S16b, B2).** Three distinct root causes:
1. **Unconditional decrement with no bound and no CHECK.** Sale credit (`invoice.service.ts:313-320`) produces −400.
2. **Absolute SET from a stale read.**
   - manual credit, `customer.routes.ts:134-143`: 1,050 instead of 350;
   - work-order payment, `workOrder.routes.ts:546-557`: 100 instead of 200;
   - `failedAttempts`, `billing.service.ts:213,241`: 3 instead of 4.
3. **Bound checked outside the transaction, then an unbounded atomic increment.** PO payment (`po.routes.ts:413-447`): 2,000 paid on 1,000.

**FIN-09: idempotency (CONFIRMED in code).**
- There is no client idempotency key on any create (`invoice.schema.ts:4-32` has none) and no natural unique key.
- Invoice numbers come from a sequence, so a duplicate submission always gets a fresh, valid number and is never detected.
- Triggers: POS retries, offline replays (`POS.tsx:122-145`), double-clicks, and requests released after a Redis outage (DB-09, L-04).
- The work-order double invoice (S14) is a FIN-07 transition race, not idempotency.
- Overpayments: S16b (PO), and work-order payments have no total check at all (DB-14).

---

## 10. Concurrency Audit

**Method.**
- Each race used fresh fixtures, created through the tenant Prisma client.
- Two or more calls to the real function or route were started in the same tick (`Promise.allSettled`).
- The outcome was checked against the serial-execution invariant.
- Each race ran for N trials. Where the window is narrow, a staggered delay sweep was used.
- Windows measured locally (DB on localhost, sub-millisecond round trips) are **lower bounds**; over a network they are wider.

### Required double-spend models

| Model | Code path | Runtime result | Verdict |
|---|---|---|---|
| Credit 1,000; two concurrent sales using 700 each | `createInvoice` credit (`:258-265` cap, `:313-320` decrement) | both succeed; balance **−400** in **20/20** | **UNSAFE** (DB-02) |
| Loyalty 1,000; two concurrent redemptions of 700 (earning off) | conditional `updateMany … loyaltyPoints ≥ 700` (`:326-334`) | one ok, one `insufficient_loyalty_points`; **300** left (5/5) | **SAFE** |
| Same, with earning on (1 point per currency unit) | same | both ok; final **2,200** = 1,000 − 1,400 + 2,600 earned. The first sale's earned points commit **before** the second redemption's conditional re-check, so the result equals a serial order | **SAFE** (serial-equivalent, not a double spend) |
| Stock 1; two concurrent sales of 1 | conditional stock decrement (`:364-375`) | one ok, one `insufficient_stock`; stock 0, one line sold (5/5) | **SAFE** |
| Coupon with 1 use left; two concurrent sales | conditional raw `UPDATE … used_count < max_uses` (`:409-417`) | one ok, one `coupon_exhausted`; `used_count` 1 (5/5) | **SAFE** |
| Installment 1,000; two payments of 700 | `recordPayment` pays **whole scheduled rows** and takes no amount | not expressible. Same row twice: **both accepted**, one paid row, two `record_payment` audit rows (5/5, DB-27). Last two rows at once: the second is rejected with `previous_installments_not_paid` (20/20) | not applicable / partially safe |

### Concurrency Matrix

| Operation | Shared resource | Race scenario | Current protection | Safe? |
|---|---|---|---|---|
| Sale: stock | `stock` row | two sales for the last unit | conditional UPDATE | **Yes** (S3) |
| Sale: coupon | `coupons` row | last use | conditional raw UPDATE | **Yes** (S4) |
| Sale: loyalty redemption | `customers` row | 2 × 700 on 1,000 | conditional `updateMany` | **Yes** (S2) |
| Sale: store credit | `customers` row | 2 × 700 on 1,000 | cap read before the tx | **No**: −400 (S1) |
| Multi-line sales | several `stock` rows | same items in opposite order | Postgres deadlock detector only | **No**: 39/40 aborted (S17) |
| Approve contract | contract row | double approve | status read before the tx | **No**: 6 rows, stock −2 (S6) |
| Approve vs reject | contract + invoice | simultaneous | status read before each tx | **No**: lost reject, or cancelled contract with goods out (S7) |
| Pay installment row | payment row | two cashiers, same row | `already_paid` read before the tx | **No**: duplicate collection accepted (S5) |
| Pay last two rows | payment rows | simultaneous | ordering pre-check + in-tx count | **Yes** (S5b) |
| Cancel invoice | invoice, stock, customer, coupon | double cancel | status read before the tx | **No** (S8) |
| Return | invoice, stock, customer | two full returns | cumulative cap read before the tx | **No** (S9) |
| Return vs cancel | invoice | simultaneous | each checks the other before its tx | **No** (S10) |
| Approve transfer | transfer, stock rows | double approve | status and availability read before the tx; CHECK ≥ 0 | **No** with ample stock (S12); the CHECK blocks it at exact stock (as an HTTP 500) |
| PO receive | PO items, stock, supplier | double receive | outstanding read before the tx | **No** (S13) |
| PO receive: WAC | `product_variants.cost_price` | two POs, same variant | none (plain reads in the tx) | **No** (S13b) |
| PO payment | PO paid, supplier balance | two full payments | remaining read before the tx | **No** (S16b) |
| Work-order invoice | WO row | double create | `invoiceId == null` read before the tx | **No** (S14) |
| Work-order payment | WO paid | two payments | none (absolute SET) | **No** (S15) |
| Manual credit vs sale | `customers.credit_balance` | simultaneous | none (absolute SET) | **No** (S16, timing-dependent) |
| Stock adjustment (negative) | `stock` row | simultaneous | conditional UPDATE | **Yes** (code) |
| Password reset token | token row | double use | conditional claim | **Yes** (code) |
| Webhook, same transaction | `payment_attempts` | duplicate delivery | UNIQUE `provider_transaction_id` | **Yes** (B1) |
| Webhook declines | `subscriptions.failed_attempts` | two different declines | none (absolute SET) | **No**: 3 instead of 4 (B2) |
| Trial expiry vs payment | subscription | checkout succeeds during the job loop | none (unconditional update) | **No** (B6) |
| Dunning vs paid or cancel-scheduled | subscription, card token | job runs after one decline | selection filters | **No** (B4, B7) |
| Reminder cycles | reminder audit rows | cron + manual trigger | audit lookup, then send | **No**: 2 sends (B8) |
| Migration runners | tenant schema | startup sweep + admin button | session advisory lock (try) | **Yes** (M3 4/4); TOCTOU POTENTIAL |
| Provisioning, same subdomain | `tenants` uniques | two signups | UNIQUE + P2002 mapping | **Yes** (M5) |
| Tenant cache | Redis `tenant:<sub>` | cache miss vs invalidation | none | **No**: stale write-back (LIKELY) |
| Job cycles | Redis `lock:<job>` | cron vs retry | `SET NX PX`, DEL without owner check | yes within the TTL; LIKELY otherwise |
| Refresh rotation | Redis `refresh:<tok>` | same token twice | none (GET, DEL, SET) | **No** (code, HSEC-10) |
| Tenant client LRU | client instance | 51st tenant becomes active during a tx | none | **No** (P3-run) |
| Plan limits | counts | concurrent creates at the limit | count, then act | **No** (LIKELY) |

---

## 11. Locking

**No explicit locks.** There is no `SELECT … FOR UPDATE`, `FOR SHARE` or advisory lock in `apps/api`. Row locks come only from the transaction's own UPDATEs.

**Lock order is not canonical.**

| Operation | Lock order |
|---|---|
| `createInvoice` | customer (credit) → stock rows in **client item order** → coupon → customer again (loyalty earn) |
| `returnInvoice` | stock rows in request order → customer |
| `cancelInvoice` | coupon → stock rows in invoice-line order → customer |
| `approveContract` | contract → invoice → stock rows |
| `approveTransfer` | source and destination stock rows, per item |

- **Opposite-order deadlock (CONFIRMED).** S17: two 2-line sales with opposite item order deadlocked in **39 of 40** pairs. Postgres aborted one with `40P01`. Prisma surfaced it as a raw `ConnectorError` with no `P2034` code, so the global error handler returns HTTP 500 and the cashier has to retry.
- **Inverse customer/stock order (LIKELY, L-09).** A sale with credit (customer → stock) racing a return for the same customer (stock → customer) is the same deadlock pattern.

**Hot rows:**
- stock rows of fast sellers;
- a popular coupon's row (every sale with that coupon serialises on it until commit);
- a regular customer's row.

`invoice_number_seq` does not block.

**Redis job lock** (`lock.ts:11-24`): `SET NX PX` with a 10–25 min TTL, released by DEL **without an owner check**.
- A cycle that outlives its TTL deletes the next holder's lock (LIKELY, only for long cycles).
- The manual reminders trigger bypasses the lock entirely (`installment.routes.ts:216-224`).

**Migration advisory lock:** `pg_try_advisory_lock(hashtext('hesba_migrate:'+schema))` on a pinned one-connection client.
- Correct: the second runner skipped in 4/4 trials (M3).
- **But** the pending list is computed from `schema_version` *before* the lock is taken (`migrate-tenants.ts:58-63` vs `:76`): a TOCTOU window (P-03, not observed).

**DDL locks under traffic.** The server listens before migrating (`index.ts:472` → `:484`). `ALTER TABLE` holds `ACCESS EXCLUSIVE` until the file's transaction commits, so a tenant's requests block during its migration and can hit the 5 s timeout (L-02).

---

## 12. Isolation Levels

**Effective level: READ COMMITTED everywhere.** Confirmed three ways:
- Prisma's `isolationLevel` is undefined;
- no `SET TRANSACTION` exists anywhere;
- `default_transaction_isolation = read committed`.

**What the correct code relies on.** Under READ COMMITTED, an UPDATE that waits on a row lock **re-evaluates its WHERE clause against the newly committed row** (EvalPlanQual). That makes the conditional UPDATEs correct for stock, coupon, loyalty, stock adjustment and password reset.

**What breaks.** Every *statement* gets a new snapshot, so reads inside a transaction are not stable and are not locked:
- the WAC aggregate and cost read (`po.routes.ts:299-308`, S13b);
- the PO status recompute (`:367-369`);
- the contract-completion count (`installment.service.ts:469-471`);
- the cancel audit lookup (`invoice.service.ts:747-753`);
- and, worse, the many checks made **before** the transaction with the base client.

**Where stronger guarantees are needed and how to get them:**

| Need | Mechanism |
|---|---|
| Status transitions | conditional UPDATE (count = 1) |
| Cumulative caps (returns, receipts, payments) | `SELECT … FOR UPDATE` on the parent row (invoice, PO, contract) at the start of the tx, then recompute inside it |
| WAC | `FOR UPDATE` on the variant row before aggregating, or a single-statement UPDATE |

SERIALIZABLE would also work, but it needs a retry loop on `40001`, which Prisma does not provide. Targeted locks are simpler here.

**Reports.** Reports issue several independent queries, each at its own snapshot, so totals can disagree with each other during concurrent writes (P-05; cosmetic).

---

## 13. Lost Updates

| Location | Pattern | Runtime | Status |
|---|---|---|---|
| `customer.routes.ts:128-143` manual credit | read → `Number(balance) + delta` → **absolute** SET | **1,050 vs 350** (1 of 14 trials in a 5–40 ms stagger sweep; window = time between read and write) | CONFIRMED (DB-15) |
| `workOrder.routes.ts:539-557` WO payment | read → `Decimal.add` → absolute SET | **100 vs 200** (3/3) | CONFIRMED (DB-14) |
| `billing.service.ts:210-251` `failedAttempts` | read → +1 → absolute SET | **3 vs 4** | CONFIRMED (DB-24) |
| `po.routes.ts:299-319` WAC `cost_price` | aggregate → compute → absolute SET | **250 vs 233.3333** (3/3) | CONFIRMED (DB-12) |
| `trial-expiry.job.ts:115-132` | list → unconditional update by id | overwrote `ACTIVE` with `PAST_DUE` (B6) | CONFIRMED (DB-19) |
| `PATCH /api/settings` (`index.ts:308-325`) | update of only the supplied fields | no cross-field loss; same field is last-writer-wins | SAFE by design |
| Supplier balance, PO `received_quantity`, PO `paid_amount`, coupon counter | atomic `increment` | no lost update (but unbounded) | SAFE as far as lost updates go |
| `tenant.middleware.ts:63-74` tenant cache | cache-aside: GET miss → DB read → SETEX | a write that lands after an invalidation keeps the old status for ≤ 300 s | LIKELY (L-05) |
| `auth.service.ts:101-120` refresh rotation | GET → DEL → SET | concurrent refresh forks the session | LIKELY (L-06, HSEC-10) |

---

## 14. Double Spending

| Asset | Double-spend path | Status |
|---|---|---|
| Store credit | two concurrent sales (S1); and a balance already driven negative feeds a negative `creditUsed` (P-10) | **CONFIRMED** |
| Store credit (refunds) | double return (S9), return + cancel (S10), double cancel refunds credit twice (S8) | **CONFIRMED** |
| Loyalty points | redemption race-safe (S2); cancelling the earning sale after its points were spent → **−1,000** (S20) | redemption SAFE; reversal **CONFIRMED** |
| Coupon uses | redemption race-safe (S4); double cancel releases the use twice (5 → 4, S8) | partial |
| Stock | sales and approvals race-safe; double transfer (S12), double receipt (S13), double cancel/return restock (S8–S10), phantom restock of pending invoices (S11) | **CONFIRMED** |
| Receivables (installments) | double approval doubles the schedule (S6) | **CONFIRMED** |
| Supplier payables | double receipt doubles the liability (S13); double PO payment pays twice (S16b) | **CONFIRMED** |
| Work-order revenue | two invoices for one order (S14) | **CONFIRMED** |
| SaaS subscription | dunning charges paid or cancel-scheduled subscriptions (B4, B7); trial-expiry race (B6); renewal retry after a failed write (L-01) | CONFIRMED / LIKELY |

---

## 15. Idempotency

| Operation | Natural key | Mechanism | Duplicate outcome |
|---|---|---|---|
| `POST /invoices` (sale) | none | none | second invoice: stock, revenue, credit and loyalty all repeated |
| POS offline replay (`POS.tsx:122-145`) | none (payload carries no client id) | entry removed only after HTTP success | lost response → replayed again; two tabs (shared `localStorage`) or repeated `online` events → concurrent replays (LIKELY, L-04) |
| POS online submit (`POS.tsx:307-336`) | none | queued only if `!navigator.onLine` (`:323`); axios has **no timeout** (`api/client.ts:5`) | user retry after a hang → duplicate once the first request completes |
| Contract create / approve / pay | contract per invoice (UNIQUE `invoice_id`) only | none for approve/pay | S6 / S5 |
| Return / cancel | none | none | S8–S10 |
| PO receive / payment | none | none | S13 / S16b |
| WO invoice / payment | `work_orders.invoice_id` (wrong direction) | pre-check | S14 / S15 |
| Transfer approve | none | none | S12 |
| Customer manual credit | none | none | repeated adjustment |
| Password reset | token | conditional claim | **safe** |
| Paymob webhook | `provider_transaction_id` UNIQUE | P2002 → no-op | **safe** (B1) |
| Renewal / dunning charge | none; `merchant_order_id = sub_<tenant>_<Date.now()>` is new on every attempt (`renewal.job.ts:101`, `dunning.job.ts:110`) | none toward Paymob; BullMQ retries the **whole cycle** up to 3 attempts (`renewal.job.ts:19-20,172-174`) | re-charge after a post-charge failure (LIKELY, L-01) |
| Provisioning | subdomain, email, schema name UNIQUE | P2002 → 409 | safe against concurrent duplicates (M5); **not re-entrant** after a crash (M6) |
| Tenant migration | `schema_version` | version filter + lock | files 001, 002, 016 fail on re-run (M1) |
| Reminder job | none | audit lookup within 24 h, then send | duplicate (B8) |

---

## 16. Webhook Idempotency

**Mechanism.** `payment_attempts.provider_transaction_id` is UNIQUE. The attempt INSERT and the subscription UPDATE run in one array transaction, and P2002 is treated as "already processed" (`billing.service.ts:144-181`, `:224-257`). Runtime B1: the same successful transaction delivered twice at once produced one attempt row, the subscription `ACTIVE`, and no error.

**Route dispatch** (`billing.routes.ts:42-57`):
- `success && !is_refunded && !is_voided` → success handler;
- `error_occured || (!success && !pending)` → failure handler;
- everything else → **200 no-op**.

| Ordering | Behaviour | Status |
|---|---|---|
| SUCCESS, then PENDING (reversed delivery) | PENDING is a no-op; the final state stays SUCCESS / ACTIVE | **SAFE** (code) |
| PENDING, then SUCCESS | success processed | SAFE |
| SUCCESS, then FAILURE for the **same** transaction | failure insert hits P2002 → no-op | SAFE (code) |
| FAILURE, then SUCCESS for the **same** transaction | success insert hits P2002 → **dropped**; subscription stays `PAST_DUE`, `failedAttempts` 4 (B5) | **POTENTIAL** (P-01; depends on whether Paymob ever re-reports one transaction id with a different outcome) |
| Refund or void callback | no-op; the subscription stays `ACTIVE` and nothing is reversed | CONFIRMED (code) |
| A success for a **different**, older transaction arriving late | `ACTIVE` from **any** state, period reset to now + cycle | non-monotonic (DB-25, B3) |
| Any decline for a different transaction while paid | `failedAttempts` +1 → becomes a dunning target | **CONFIRMED** (DB-08, B4) |

Amount and currency are still not compared (FIN-17), and the tenant is still bound through the unsigned `merchant_order_id` (HSEC-21). Both are unchanged and outside Phase 4's scope.

---

## 17. State Machines

None of the tenant status columns has a database-level domain (free `VARCHAR`, no CHECK or enum). Transitions are validated in application code, mostly by blacklist and mostly **before** the transaction. Only work orders have an explicit transition table (`ALLOWED_TRANSITIONS`, `workOrder.schema.ts:24-32`), and it too is checked before the transaction. In the matrix below, ✓ means a valid transition and ✗ means invalid; "✓ (rejected)" means the invalid request is correctly refused.

### State Machine Matrix

| Entity | Current state | Action | Next state | Valid? | Side effects |
|---|---|---|---|---|---|
| Invoice | (new) | POS sale | `completed` | ✓ | stock −, credit −, points ±, coupon +1 |
| Invoice | (new) | installment contract created | `pending` | ✓ | none (stock untouched) |
| Invoice | (new) | work-order invoice | `completed` | ✓ | WO linked; paid = total |
| Invoice | `pending` | contract approved | `completed` | ✓ | stock −, schedule |
| Invoice | `pending` | **cancel** (UI) | `cancelled` | ✗ | **stock + for goods never removed** (S11) |
| Invoice | `pending` | **return** (API) | `pending` + return row | ✗ | **stock +, credit 1,000** on paid 0 (S11b) |
| Invoice | `completed` | cancel | `cancelled` | ✓ once | stock +, credit/points/coupon reversed |
| Invoice | `completed` | cancel ∥ cancel | `cancelled` | ✗ | every reversal applied **twice** (S8) |
| Invoice | `completed` | return (within cap) | `completed` + return rows | ✓ | stock +, credit or refund |
| Invoice | `completed` | return ∥ return | `completed` | ✗ | over-return (S9) |
| Invoice | `completed` | return ∥ cancel | `cancelled` + return rows | ✗ | double restock and refund (S10) |
| Invoice | `cancelled` | **contract approved** | `completed` | ✗ | stock −, schedule (S11) |
| Invoice | `cancelled` | return / cancel | — | ✓ (rejected) | — |
| Contract | `pending_approval` | approve | `active` | ✓ | invoice `completed`, stock −, N rows |
| Contract | `pending_approval` | approve ∥ approve | `active` | ✗ | **2N rows**, stock −2× (S6) |
| Contract | `pending_approval` | reject | `cancelled` | ✓ | invoice `cancelled` |
| Contract | `cancelled` | approve (lost race) | `active` | ✗ | reject silently undone (S7) |
| Contract | `active` | reject (lost race) | `cancelled` | ✗ | schedule rows and stock-out remain (S7, +4–8 ms) |
| Contract | `active` | last row paid | `completed` | ✓ | — |
| Contract | `active` / `cancelled` | record payment | unchanged, or `completed` | ✗ for `cancelled` (contract status never checked) | payments on a cancelled contract (code) |
| Contract | `active` | cancel / early settlement | — | gap (no endpoint) | — |
| Contract | any | `overdue` | — | dead state (never written) | — |
| Installment row | `pending` | pay (in order) | `paid` | ✓ | audit |
| Installment row | `paid` | pay ∥ pay | `paid` | ✗ (accepted) | second collection; audit ×2 (S5) |
| Installment row | `pending` (row N) | pay before row N−1 | — | ✓ (rejected) | — |
| Transfer | `pending` | approve | `completed` | ✓ | stock moved |
| Transfer | `pending` | approve ∥ approve | `completed` | ✗ | moved **twice** (S12) |
| Transfer | `pending` | approve ∥ reject | `rejected` with stock moved, or `completed` | ✗ | (code; same pattern as S7) |
| PO | `draft` | edit | `draft` | ✓ | items replaced |
| PO | `draft` | edit ∥ approve | approved with the edited items | ✗ (LIKELY) | — |
| PO | `approved` / `partially_received` | receive | `partially_received` / `received` | ✓ | stock +, cost, supplier + |
| PO | `approved` | receive ∥ receive | `received` | ✗ | received **20 / 10**, liability ×2 (S13) |
| PO | any | pay ∥ pay | unchanged | ✗ | paid 2,000 / 1,000 (S16b) |
| Work order | per `ALLOWED_TRANSITIONS` | transition | next | ✓ serially | history row |
| Work order | X | two different transitions at once | last writer wins | ✗ (LIKELY) | two history rows |
| Work order | any, **including `cancelled`** | invoice | linked | ✗ for cancelled (DB-36, code) | invoice `completed` + paid |
| Work order | not invoiced | invoice ∥ invoice | linked to the second | ✗ | **two invoices** (S14) |
| Work order | any | payment | unchanged | ✓ but unbounded | paid **absolute** (S15) |
| Subscription | `TRIALING` | trial ends (job) | `PAST_DUE`, `failedAttempts` 1 | ✓ by design | never escalates without a card token (FIN-16) |
| Subscription | `TRIALING` | 3 / 7 / 14 declined checkouts | `PAST_DUE` / `SUSPENDED` / `CANCELLED` | ✗ (trial still valid) | 402 at 7 (DB-37) |
| Subscription | `TRIALING` | payment success | `ACTIVE` | ✓ | card token stored |
| Subscription | `ACTIVE` | renewal success | `ACTIVE`, period = now + cycle | ✓ | — |
| Subscription | `ACTIVE` (paid) | one decline (another transaction) | `ACTIVE`, `failedAttempts` 1 | ✗ | **becomes a dunning target** (B4) |
| Subscription | `ACTIVE` (just paid) | trial-expiry race | `PAST_DUE` | ✗ | dunning target (B6) |
| Subscription | `PAST_DUE` | success | `ACTIVE` | ✓ | — |
| Subscription | `PAST_DUE` → `SUSPENDED` → `CANCELLED` | 7 / 14 failures | as shown | ✓ | 402 |
| Subscription | `CANCELLED` | any success | `ACTIVE` (`cancelledAt` kept) | ? policy (DB-25) | reactivated silently |
| Subscription | any | cancel at period end | `cancelAtPeriodEnd = true` | ✓ | **dunning still charges** (B7) |
| Subscription | `PAST_DUE` / `SUSPENDED` | admin reactivate | `ACTIVE` | policy | no payment required |
| Tenant | (new) | signup | `PROVISIONING` → `ACTIVE` | ✓ | — |
| Tenant | `PROVISIONING` | process crash | `PROVISIONING` forever | ✗ | subdomain and email locked (M6) |
| Tenant | `ACTIVE` ↔ `SUSPENDED`; → `CANCELLED` | admin | as shown | ✓ | caches invalidated; `CANCELLED` drops out of the migration sweep |
| ETA status | `pending` | job | `failed` after 5 attempts | ✗ | the first query fails (DB-23) |
| Reset token | unused | reset | used | ✓ | conditional claim |

---

## 18. Invalid State Transitions

All reachable, in order of impact:

1. **Invoice `pending` → `cancelled` with restock, or → returned with credit.** S11 and S11b (DB-01).
2. **Invoice `cancelled` → `completed`** by approving its contract. S11 (DB-01).
3. **Contract `cancelled` → `active`.** The reject is overwritten by a concurrent approve. In 7/8 simultaneous trials the audit trail reads `create → reject → approve` and both callers received success (DB-04).
4. **Contract `active` → `cancelled` while its schedule rows and stock-out remain.** Reject delayed 4–8 ms after the approve (4/6 trials; DB-04).
5. **Contract `active` → `active` again**, duplicating the schedule. S6 (DB-03).
6. **Invoice `completed` → `cancelled` twice** (S8), or cancelled after it was returned (S10). DB-05, DB-06.
7. **Transfer `pending` → `completed` twice** (S12, DB-11). Approve ∥ reject follows the same pattern (code).
8. **PO beyond `received`:** received quantity above ordered. S13 (DB-07).
9. **Work order invoiced twice** (S14), or a **cancelled work order invoiced**: `workOrder.routes.ts:400-411` checks only `invoiceId` (DB-13, DB-36).
10. **Subscription states:**
    - `CANCELLED` → `ACTIVE` on any success (B3);
    - a paid `ACTIVE` subscription made dunning-eligible by one decline (B4);
    - `ACTIVE` → `PAST_DUE` through the trial-expiry race (B6);
    - `TRIALING` → `SUSPENDED` after 7 declined checkout attempts inside a valid trial (code, `billing.service.ts:213-222`).
11. **Tenant stuck in `PROVISIONING`** (M6, DB-22).
12. **Installment payment recorded on a `cancelled` contract.** `recordPayment` never reads the contract's status (`installment.service.ts:444-453`); when every row is paid it even writes `completed` over `cancelled` (`:473-478`). Code; reachable after the S7 lost-reject interleaving.

---

## 19. Monotonic State

| Value | Expected | Actual | Evidence |
|---|---|---|---|
| `coupons.used_count` | +1 per sale, −1 per cancelled sale | double cancel releases twice → under-count (5 → 4) | S8 |
| `purchase_order_items.received_quantity` | ≤ ordered, non-decreasing | grows past ordered | S13 |
| `subscriptions.current_period_end` | never moves backwards for paid time | every success sets **now + cycle**, so early payments and mid-period dunning charges discard the remaining paid days | `billing.service.ts:134-138,169-170`; B4 path |
| `subscriptions.failed_attempts` | counts renewal failures | also counts interactive checkout declines; reset to 0 on any success; lost increments | B2, B4; `:213-222` |
| `subscriptions.status` | terminal `CANCELLED` | revived by any success (`cancelledAt` left set) | B3 |
| `tenants.schema_version` | increases by one per applied file | can be left behind its DDL (M2); a TOCTOU re-run would set it lower, then higher (P-03) | `migrate-tenants.ts:104-107` |
| `invoices.invoice_number` | increasing (gaps acceptable?) | increasing with gaps: a rolled-back `nextval` is consumed (psql: 154 burned, next is 155) | DB-38 |
| `installment_payments.status` | `pending` → `paid` once | `paid` → `paid` accepted | S5 |
| `subscriptions.trial_reminders_sent` | non-decreasing | explicit-value write, so idempotent | ✓ (`trial-expiry.job.ts:104-110`) |

---

## 20. Referential Integrity

**The tenant FK graph** (80 FKs, `002_full_schema.sql` and later). Cascade chains:
- `products → product_variants → stock, stock_movements, product_discounts`;
- `invoices → invoice_items, payment_fee_expenses`;
- `returns → return_items`;
- `installment_contracts → installment_payments`;
- `purchase_orders → purchase_order_items`;
- `work_orders → work_order_services, work_order_status_history`;
- `customers → customer_documents`;
- `users → password_reset_tokens`.

`SET NULL` rules:
- `invoices.customer_id` and `invoices.coupon_id`;
- category and tax-rate references;
- `audit_logs.actor_id`;
- installment `received_by`.

**Every other FK is `NO ACTION`.** That includes `invoice_items.variant_id`, `returns.invoice_id`, `stock_transfer_items.variant_id` and all the user and branch references.

**Which deletes the API can reach** (every hard delete in the code, `grep .delete(`):

| Delete | Guard | FK consequence |
|---|---|---|
| Product discount | — | none |
| PO items (draft edit) | status `draft`, checked **before** the tx | none (but see the edit ∥ approve race) |
| Role | user count checked before; FK `users.role_id` NO ACTION | a concurrent assignment makes the delete fail on the FK (safe) |
| Expense budget / template | — | none |
| **Coupon** | **none** | `invoices.coupon_id` → **SET NULL**: history loses which coupon was used (DB-35) |
| Work-order service line | WO checks | none |
| Master plan | FK RESTRICT from tenants and subscriptions | safe |
| **Platform admin** | owner-only | `platform_audit_logs.actor_id` **ON DELETE CASCADE** (`20260517120000_add_platform_admin/migration.sql:31`): **the admin's audit trail is deleted** (DB-35) |
| Tenant | provisioning rollback only | subscriptions CASCADE; `payment_attempts` RESTRICT |

Products, suppliers, payment methods and services are **soft-deleted** (`is_active = false`). The dangerous chains (product → stock movements, invoice → items) are therefore unreachable from the API today. One support-script `DELETE FROM products` would still erase stock-movement history.

**References that are not FKs:**
- `stock_movements.reference` (text), `audit_logs.entity_id`, and `eta_submissions` linkage are written in the same transaction as their subject, so no orphans arise in practice.
- A return restock for a variant whose stock row no longer exists logs a movement while changing no quantity (P-06).

---

## 21. Soft Delete / Hard Delete

| Entity | Mechanism | Consequence |
|---|---|---|
| Products / variants | `is_active = false` (`product.service.ts:146`) | the sale path checks `variant.isActive` only; deactivated *products* stay sellable through the API (FIN-21) |
| Suppliers, payment methods, services | `is_active = false` | history kept |
| Coupons | **hard delete**, no guard (`coupon.routes.ts:89-92`) | `invoices.coupon_id` set to NULL; coupon history lost |
| Roles | hard delete, guarded + FK | safe |
| Platform admins | hard delete | **cascades their platform audit logs** |
| Customers, users, branches | no delete endpoint | (no deactivation either, HSEC-07) |
| Tenants | no delete endpoint; rollback uses `DROP SCHEMA … CASCADE` | the rollback also drops a **pre-existing** schema of the same name and its contents (M4 dropped a stray table it didn't create) |

---

## 22. Historical Data Integrity

**Snapshotted on the line:** `invoice_items` stores `unit_price`, `discount_amount`, `tax_amount`, `subtotal` and, since 017, `cost_at_sale`.
- Pre-017 rows have `cost_at_sale` NULL, so COGS for those sales falls back to the *current* cost (Phase 3).

**Not snapshotted:**
- Product names (reports and the ETA payload join current names).
- The tax rate. The ETA job joins **current** `tax_rates.rate` (`eta-submission.job.ts:120-128`) instead of the stored line tax.
- Service lines are dropped from the ETA payload entirely (inner join on `product_variants`).

**Wrong dates:**
- **Offline-replayed sales** carry no client timestamp (`POS.tsx:307-336`), so they are dated at replay time.
- **Invoice numbers** use the **UTC** date (`invoice.service.ts:448-449`), so sales between local midnight and 02:00/03:00 Cairo carry the previous day's date.

**Cost history:**
- `cost_price` is overwritten in place, with no cost-history table.
- Concurrent receipts compute it wrongly (S13b), and that wrong cost is then frozen into the `cost_at_sale` of every later sale.

**Ledger semantics:**
- The tenant `audit_logs` table is the *de facto* ledger for credit and loyalty: cancel reads it back (`invoice.service.ts:747-763`). No endpoint deletes it.
- Platform audit logs are deleted by the admin-delete cascade.
- Coupon deletion erases the coupon reference on old invoices.

**Subscription periods** reset to now + cycle on payment, so paid time can be lost.

---

## 23. Migrations

**Master (Prisma Migrate).** The 8 migrations apply cleanly from scratch (runtime). There is no `migration_lock.toml` (Phase 1).

**Tenant runner** (`packages/database/src/migrate-tenants.ts`):
- **One transaction per file** (`:95-102`, `timeout` and `maxWait` 120 s), so DDL is atomic. Good: M2's failure applied nothing.
- **`schema_version` is bumped afterwards, outside that transaction**, through a different client (`:104-107`). A crash in between leaves the DDL applied and the version stale.
- **Re-run idempotency matrix (M1),** each file executed and then rolled back on the already-migrated schema:

| File | Re-runnable? |
|---|---|
| 001 | **No**: `relation "branches" already exists` |
| 002 | **No**: `relation "tenant_settings" already exists` |
| 003–015, 017 | Yes (`IF NOT EXISTS` and similar; 006's backfill is semantically idempotent) |
| 016 | **No**: `constraint "chk_variant_cost_nonneg" … already exists` |

- **Lost version bump** (M2: version 17 forced back to 15). `runTenantMigrations` fails with 42710 and the version stays 15. `migrateAllTenants` reports `{ ok: 0, failed: 1 }`, and the same failure repeats on every boot. `/health` returns 503 only when *all* tenants fail (`index.ts:169`), so in a multi-tenant deployment it reports `partial` with a 200.
- **`splitStatements` is naive about `$$`** (`:42-55`). No current file needs `$$`, but it also prevents the obvious fix for idempotent constraint creation (`DO $$ … $$`).
- **Concurrency:** the per-schema advisory lock serialised two simultaneous runners in 4/4 trials (M3). The pending list is computed before the lock (P-03).
- **Sweep:**
  - It runs at boot, sequentially, over `ACTIVE` and `SUSPENDED` tenants, **after `app.listen`** (`index.ts:472,484`). New code serves old schemas until each tenant has been reached (L-02).
  - `PROVISIONING` tenants are never repaired (DB-22).
  - `CANCELLED` tenants are skipped, so an admin-reactivated cancelled tenant runs new code on an old schema until the next boot (L-10).
- **NOT VALID CHECKs (016)** are never validated, so production may hold rows that violate them (U-01).

---

## 24. Tenant Provisioning

`provisionTenant` (`tenant.service.ts:192-286`) is a sequence of independent commits with a compensating `catch` (`:274-279`).

| Step | Code | Committed as | If it throws | If the process dies |
|---|---|---|---|---|
| 1. Subdomain, email and plan pre-checks | `:196-217` | read | 409 / 400 | — |
| 2. Tenant row `PROVISIONING` | `:224-236` | own commit | P2002 → 409 `subdomain_taken` / `email_taken` | row stays `PROVISIONING` |
| 3. `CREATE SCHEMA IF NOT EXISTS` | `:255` | own commit | catch: delete row, `DROP SCHEMA … CASCADE` | row + empty schema |
| 4. 17 migration files | `:258` → `migrate-tenants.ts` | one tx per file, version bump after each | catch compensates (**M4**: row gone, schema gone) | row `PROVISIONING` at version k (**M6**: version 3, 39 tables) |
| 5. Seed: roles, branch, owner, currency, 2 tax rates, 6 expense categories, 6 payment methods, settings | `:261` → `:92-188` | 12 separate writes (5 role inserts + 7 more), **no tx** | catch compensates | partial seed |
| 6. Status `ACTIVE` | `:264-267` | own commit | catch compensates | `ACTIVE` with **no subscription**: the gate allows `NONE`, trial expiry never sees it, so access is free and unlimited |
| 7. `startTrial` | `:273` | own commit | catch deletes an **ACTIVE** tenant and drops its schema. Any Redis `tenant:<sub>` entry and LRU client created meanwhile survive (P-07) | — |

**Runtime results:**
- **M4:** an exception (a stray `roles` table in the target schema) was fully compensated. The tenant row was deleted, and the schema was dropped, *including the pre-existing stray table*.
- **M5:** two simultaneous signups for one subdomain gave one `ok` and one `subdomain_taken`. **Safe.**
- **M6 (SIGKILL** of the whole process group once 10 tables existed):
  - leftover: tenant `PROVISIONING`, `schema_version` 3, 39 tables;
  - the owner's retry fails with `subdomain_taken`, and the email is reserved too;
  - `migrateAllTenants` never selects it.

  Recovery needs manual SQL (DB-22).

**Fix direction:**
- Persist a provisioning step and resume idempotently.
- Run a sweeper that resumes or cleans up `PROVISIONING` tenants older than N minutes.
- Create the subscription and set `ACTIVE` in one master transaction.
- Drop only schemas that this run created.

---

## 25. Tenant Lifecycle

**Tenant status** (`tenants.status`):
- `PROVISIONING` → `ACTIVE` ↔ `SUSPENDED` (admin) → `CANCELLED` (admin).
- The middleware returns **404 for anything but `ACTIVE`**, including billing routes (`tenant.middleware.ts:77-82`). A suspended tenant therefore cannot reach checkout to pay.

**Subscription status:**
- `TRIALING` → `ACTIVE` / `PAST_DUE` → `SUSPENDED` (7 failures) → `CANCELLED` (14 failures), plus admin reactivate.
- The gate returns 402 only for `SUSPENDED` and `CANCELLED`, and not on `/api/auth/` or `/api/billing/` (`:87-113`).
- `PAST_DUE` keeps full access. Expired trials without a card never escalate, because dunning requires a token (FIN-16, still CONFIRMED).

**Coupling:**
- Tenant and subscription statuses are independent. The tenant stays `ACTIVE` while the subscription is `CANCELLED`, and the 402 gate is what enforces it.
- Admin plan changes update `tenants.plan_id` only, so limits follow the tenant's plan while charges follow `subscriptions.price_at_subscription` (Phase 1 P-04).
- The migration sweep includes `SUSPENDED` but skips `CANCELLED` and `PROVISIONING` (§23).
- Admin reactivation does not run pending migrations.

---

## 26. Cache Consistency

| Cache | Key / TTL | Invalidated by | Staleness and risk |
|---|---|---|---|
| Tenant row + plan JSON | `tenant:<sub>`, 300 s (`tenant.middleware.ts:60-75`) | admin suspend, plan change, plan edit, trial extend, cancel, reactivate (`admin.routes.ts:45-62`); billing handlers and cancel (`billing.service.ts:21-30`) | **Cache-aside race.** A reader that misses, reads the DB, and writes the old row back *after* an invalidation keeps a suspended tenant `ACTIVE` for ≤ 300 s (L-05). Plan limits are as fresh as the last invalidation. Provisioning rollback does not clear it (P-07) |
| Subscription status | `sub:status:<tenantId>`, 30 s | billing handlers, trial expiry (`trial-expiry.job.ts:135`, correct key), `/billing/resume`, cancel, admin | ≤ 30 s |
| Tenant Prisma clients | in-process LRU (50, 30-min idle) | eviction or TTL disposes the client | disposal **aborts in-flight transactions** (P3-run, DB-29) |
| Dashboard | `dashboard:<tenant>:<branch>`, 120 s | none | acceptable |
| JWT claims (role, permissions, branch) | token lifetime, ≤ 15 min | refresh | stale permissions (Phase 2) |
| All of the above | Redis | — | during a Redis outage, cache reads **hang** rather than fall back (DB-09) |

---

## 27. Background Jobs vs User Actions

| Job | Overlapping user action | Race | Result | Status |
|---|---|---|---|---|
| Trial expiry (06:00) | checkout succeeds while the loop runs (the loop awaits one email per subscription, widening the window) | list read once, then unconditional `update({ where: { id } })` (`:115-132`) | a paid subscription becomes `PAST_DUE`, `failedAttempts` 1, card on file, so **dunning charges it again** (B6) | CONFIRMED (replica of the job's two statements + the real handler) |
| Renewal (07:00) | user schedules a cancel or pays after the `due` list is read | stale list, sequential charges (`renewal.job.ts:76-165`) | charged despite the cancel | LIKELY (L-03) |
| Dunning (08:00) | an earlier interactive decline; user already paid; or cancel scheduled | selection ignores `current_period_end` and `cancel_at_period_end` (`dunning.job.ts:74-81`) | charges paid or cancel-scheduled subscriptions (B4, B7) | **CONFIRMED** |
| Cancel sweep (06:00) vs dunning (08:00) | user cancels between 06:00 and 08:00 | sweep already ran; dunning doesn't filter | charged after cancelling | CONFIRMED (B7 selection) |
| Reminders (09:00) | manual `POST /installments/send-reminders` (any tenant's user; HSEC-05) | audit lookup, then send; the manual path skips `withLock` | duplicate emails (B8) | **CONFIRMED** |
| Reminders | payment recorded during the cycle | list read first | reminder for a just-paid row | LIKELY (benign) |
| ETA worker | invoice cancelled | the job never reads `invoices.status` | would submit cancelled invoices | CONFIRMED (code; moot while DB-23 stands) |
| Startup migration sweep | live traffic | `ACCESS EXCLUSIVE` DDL locks; new code vs old schema | blocked requests, 5 s tx timeouts, missing-column errors | LIKELY (L-02) |

---

## 28. Database Failure

| Failure point | Behaviour | Evidence |
|---|---|---|
| Inside a transaction (drop, deadlock, timeout, CHECK) | full rollback | P1-run, S17, S12, P3-run |
| After the DB commit, before side effects | webhook: stale caches / hung response; the audit-after-commit flows lose audit rows | §6 |
| After an external charge, before the DB write | money taken, not recorded, then re-charged on retry | L-01 |
| Mid-provisioning | orphan `PROVISIONING` tenant | M6 |
| Between migration DDL and the version bump | tenant permanently failing | M2 |
| Tenant pool exhausted (5 connections) | `Unable to start a transaction in the given time` after 2 s; unrelated requests for the same tenant also wait | P1-run (3 of 8) |
| Instance connection ceiling | `too many clients already` for **all** tenants and the master client (login, tenant resolution, webhooks) | P4-run: 17 of 110 failed with 22 busy tenants |
| Master DB down | cache hit: tenant requests still need the tenant DB; cache miss: 500 | code |
| Postgres restart | in-flight requests fail (500); Prisma reconnects lazily; the POS retries, producing duplicates (no idempotency) | code + DB-10 |
| A stuck session | no `statement_timeout`, `lock_timeout` or `idle_in_transaction_session_timeout`. Prisma's own 5 s limit protects only its interactive transactions; migrations (120 s) and manual sessions can hold locks indefinitely | compose defaults |

---

## 29. Redis Failure

**Runtime experiment** (`scratchpad/phase4/redis-outage.cjs`, ioredis 5.10.1 against a closed local port):

| Client options | Result |
|---|---|
| App's options `{ maxRetriesPerRequest: null, lazyConnect: true }` | GET **still pending after 4,002 ms**; it never settles while Redis is down |
| ioredis default (20 retries) | still pending at 4 s (rejects only after 20 reconnect attempts) |
| `maxRetriesPerRequest: 1` | rejected `MaxRetriesPerRequestError` after **54 ms** |

**Effects** (`maxRetriesPerRequest: null` means commands wait in the offline queue forever; `ioredis/built/redis/event_handler.js:198-210`):
- Every tenant request awaits `redis.get(tenant:<sub>)` first (`tenant.middleware.ts:63`), so **the entire tenant API hangs**.
- Login and refresh (sessions live only in Redis) and the Redis-backed rate limiter (`skipOnError` defaults to false) hang.
- BullMQ stalls, and `withLock` hangs.
- The Paymob webhook commits its DB transaction and then hangs on `redis.del`. Paymob times out and may retry, which is harmless thanks to P2002.
- **On recovery** the offline queue flushes. Every hung request resumes at once alongside the users' retries, which produces duplicate sales (L-04).
- **On Redis data loss** (restart without persistence or eviction): every user is logged out, BullMQ repeatables are re-added at boot, and job locks are lost.

**Fix:**
- Use separate connections: BullMQ keeps `null` retries; the request path uses `maxRetriesPerRequest: 1`, `enableOfflineQueue: false` and a `commandTimeout`.
- Treat cache errors as misses (fall back to the DB).
- Set `skipOnError: true` on the rate limiter.

---

## 30. External Calls + Database Transactions

| Flow | External call | Position relative to the DB | Failure behaviour |
|---|---|---|---|
| Renewal / dunning | Paymob `createOrder` + `chargeWithToken` (plain `fetch`, **no timeout**: `paymob.client.ts:24-37`) | **before** the DB write (`handleWebhookSuccess` / `Failure`) | Any error after a successful charge (DB down, Redis hang, crash) → `transientFailures++` → the job throws → BullMQ retries the whole cycle and **charges again**, because `merchant_order_id` contains `Date.now()` and no pending-payment row exists. The webhook may record the first charge in time, but nothing guarantees it (L-01) |
| Checkout | Paymob session | nothing persisted | no expected-amount record, so reconciliation is impossible (`reconcilePayments` is a placeholder: `dunning.job.ts:167-173`) |
| Webhook | — | DB tx → Redis → email (email errors swallowed) | Redis outage hangs the response after commit |
| ETA | ETA API | `submitted` written **before** the call; result written after | a crash after acceptance means a retry resubmits (P-09); moot today |
| Reminders / trial notices | Resend | send, then audit row | crash → duplicate; no idempotency key |
| Customer documents (R2) | presigned URLs | the client uploads, then the DB stores the URL | not exercised |

**Positive:** no external call is made **inside** an interactive transaction (`createInvoice`, approve, cancel, return, receive were all checked), so no row locks are held across network I/O.

---

## 31. Root Cause Analysis of Previous Findings

| Previous finding | Root-cause class | Mechanism | Phase 4 evidence |
|---|---|---|---|
| FIN-03 phantom stock / credit | **missing state validation** | blacklist status checks; reversal computed from lines instead of movements | S11, S11b |
| FIN-04 contracts survive invoice cancel / return | **incorrect state machine** (cross-entity) | invoice and contract mutated independently; approval updates the invoice unconditionally | S11 |
| FIN-07 duplicated transitions | **missing lock / non-conditional transition** | pre-tx read + `update({ where: { id } })` under READ COMMITTED | S6, S7, S8, S9, S10, S12, S13, S14 |
| FIN-08 balance races, overpayments | **missing constraint + unbounded or absolute updates** | decrement with no bound; absolute SET from a stale read; bound checked outside the tx | S1, S15, S16, S16b, B2 |
| FIN-09 duplicates on retry | **missing idempotency key** | no client key, no natural unique key | code; S14 for the WO variant |
| FIN-12 loyalty defects | **application logic + missing constraint** | zero-point redemption (Phase 3 calc §5); unconditional reversal; no CHECK | S20 |
| FIN-16 unpaid trials keep access | **incorrect state machine** | `PAST_DUE` without a token never escalates; the gate ignores `PAST_DUE` | code; B6 |
| FIN-17 amount not verified | missing validation | amount and currency not compared | code (unchanged) |
| HSEC-05 reminders for all tenants | missing scope + **missing lock** | the manual trigger bypasses `withLock` | B8 |
| HSEC-10 refresh rotation | non-atomic Redis operations | GET / DEL / SET | code |
| HSEC-28 Redis stall (LIKELY in Phase 2) | infrastructure configuration | `null` retries on a shared connection | **now CONFIRMED** (§29) |
| Phase 1 E-01 / CU-03 (static) | raw SQL drift (not type-checked) | wrong column names | **now runtime-CONFIRMED** (§3) |
| Phase 1 C-03 "in-flight impact POTENTIAL" | resource lifecycle | LRU dispose disconnects a client in use | **now CONFIRMED** (P3-run) |
| Phase 2 U-09 pool behaviour | capacity | 50 × 5 > 100 | **now CONFIRMED** (P4-run) |

### CORRECTION TO PREVIOUS AUDIT

**What was claimed.** Phase 3 §9 (the brief's §14 scenario, cross-referenced in FIN-20) said: *"Concurrent payment of the last two rows can leave the contract `active` with every row paid, because each transaction excludes only its own row when counting."*

**This is wrong.**
- `recordPayment` first checks, with committed data, that no earlier row is unpaid (`installment.service.ts:450-453` → `previous_installments_not_paid`).
- So row N can be paid only after row N−1's payment has **committed**. When it has, the in-transaction count (`:469-471`) sees that row as paid and completes the contract.
- Runtime (S5b, 20/20 trials, two rows paid concurrently): `ok + previous_installments_not_paid`. One row was paid, the contract stayed `active` correctly, and the second payment simply had to be retried.
- **The "stuck active with every row paid" state is unreachable through this path.**
- Phase 3's other installment conclusions stand. Double approval (FIN-07) remains the real concurrency defect, and paying the same row twice remains accepted (DB-27), better described as "a second collection is silently accepted" than "benign".

**Clarifications** (Phase 3 is not wrong in these):
- Loyalty "double spend ✓ race-safe" is confirmed (S2). In the brief's 2 × 700 on 1,000 model, both redemptions *can* succeed when earning is on, because the first sale's earned points commit first. That is serial-equivalent and not a double spend.
- "Double stock transfers" (FIN-07) happen only when the source holds at least twice the quantity. Otherwise migration 016's CHECK aborts the second approval with a raw `23514`, which reaches the client as HTTP 500.

### Required cross-checks

| Check | Verdict | Evidence |
|---|---|---|
| Sales all-or-nothing | **Yes.** One interactive tx; timeouts, deadlocks and CHECK failures leave no partial rows; no post-commit writes in `createInvoice` | P1-run, S17, S3, S4 |
| No oversell | **Yes** for sales and approvals (conditional decrement + CHECK). Transfers rely on the CHECK (unconditional decrement): a tenant missing migration 016 could go negative | S3, S12 |
| Coupon concurrency-safe | **Redemption: yes.** Double cancel releases a use twice | S4, S8 |
| Loyalty redemption concurrency-safe | **Redemption: yes.** Reversal is unconditional and goes negative | S2, S20 |
| Webhook replay safe | **Same transaction id: yes.** Not monotonic across different transactions; FAILED-then-SUCCESS for one id drops the success | B1, B3, B5 |
| WAC correct | **Serially yes** (Phase 3 calc §8, zero-cost caveat FIN-23). **No under concurrent receipts** | S13b |
| Installment schedules sum | **Yes serially** (Phase 3 calc §7). Doubled by double approval | S6 |
| FIN-03 | **CONFIRMED** at runtime (cancel and return paths) | S11, S11b |
| FIN-04 | **CONFIRMED** at runtime (approval revives a cancelled invoice) | S11 |
| FIN-07 duplicate schedules | **CONFIRMED**: 6 rows instead of 3, stock −2 | S6 |
| FIN-08 / "duplicate stock moves" | **CONFIRMED** (in Phase 3 numbering these are FIN-07 movements; FIN-08 is balances, see §9) | S8, S9, S10, S12, S13 |
| FIN-09 / "duplicate invoices, overpayments" | **CONFIRMED**: no idempotency (code); WO double invoice (S14); PO overpayment (S16b); WO payment unbounded (code) | §15 |
| FIN-12 | **CONFIRMED**: negative balance after cancel (S20); zero-point redemption unchanged (Phase 3 calc §5) | S20 |
| FIN-16 | **CONFIRMED** (code): `PAST_DUE` without a token never escalates and is never blocked. New: the trial-expiry race can also downgrade *paid* subscriptions | `dunning.job.ts:74-81`; `tenant.middleware.ts:103`; B6 |

---

## 32. Correctness-Relevant Database Performance

| Issue | Measurement | Consequence |
|---|---|---|
| Cancel reads the customer's **entire** audit history inside the 5 s tx (`invoice.service.ts:747-753`; JSON filtered in JS) | 50k rows **0.37 s**; 200k **1.43 s**; 600k **5.10 s → P2028** ("5054 ms passed since the start of the transaction") | cancellation becomes **impossible** for heavy customers, and the cost grows forever (DB-30) |
| Pool of 5 + `maxWait` 2 s + `timeout` 5 s | one 7 s lock on a hot stock row → **8/8** concurrent sales failed (5 expired, 3 never started) | a single slow transaction stalls the tenant's whole pool (DB-31) |
| Aggregate connections | 22 busy tenants × 5 → **17/110** "too many clients" | instance-wide errors (DB-20) |
| Unordered multi-row locking | **39/40** reversed-order pairs deadlocked; each deadlock costs `deadlock_timeout` (1 s) before resolution | failed checkouts in multi-cashier stores (DB-18) |
| LRU eviction | a 2 s transaction aborted when 50 other tenants were touched | random failures above 50 active tenants (DB-29) |
| `approveContract` uses the base client inside its tx (`:396-399`) | each approval holds 2 connections; returns stale data (S19) | at 5 concurrent approvals per tenant the pool can self-deadlock until the tx timeout (P-08) |
| Migrations under live traffic | DDL holds `ACCESS EXCLUSIVE` until each file commits | sales on that tenant block or time out during deploys (L-02) |
| Sequential billing loops with no HTTP timeout | renewal/dunning can outlive their 25 min Redis lock | owner-less lock release (L-07) |

---

## 33. Confirmed Findings

### Finding Matrix

| ID | Severity | Root cause | Impact | Confidence | Evidence |
|---|---|---|---|---|---|
| DB-01 | **P0** | missing state validation + no cross-entity state machine | phantom stock, credit on unpaid invoices, cancelled invoices revived | CONFIRMED (runtime) | S11, S11b |
| DB-02 | **P1** | unconditional decrement, no CHECK | negative store credit (double spend) | CONFIRMED (runtime 20/20) | S1 |
| DB-03 | **P1** | non-conditional transition + no unique key | duplicate schedule, double stock-out | CONFIRMED (5/5) | S6 |
| DB-04 | **P1** | non-conditional transitions on two paths | lost reject, or cancelled contract with goods out | CONFIRMED | S7 |
| DB-05 | **P1** | non-conditional transition | double restock, credit and loyalty reversal; coupon under-count | CONFIRMED (5/5) | S8 |
| DB-06 | **P1** | cumulative cap outside the tx, no lock | over-refund, over-restock | CONFIRMED (5/5) | S9, S10 |
| DB-07 | **P1** | outstanding outside the tx, no lock, no bound | received > ordered; payables doubled | CONFIRMED (2/3) | S13 |
| DB-08 | **P1** | billing state machine (dunning selection) | customers charged for paid or cancelled periods | CONFIRMED (selection; charge path code) | B4, B7 |
| DB-09 | **P1** | shared Redis client, `maxRetriesPerRequest: null` | whole tenant API hangs during a Redis outage | CONFIRMED (experiment) | §29 |
| DB-10 | **P1** | no idempotency keys | duplicate sales and payments on retry or replay | CONFIRMED (code); triggers LIKELY | §15 |
| DB-11 | P2 | non-conditional transition | stock transferred twice | CONFIRMED | S12 |
| DB-12 | P2 | unlocked read-compute-write | wrong WAC / COGS | CONFIRMED (3/3) | S13b |
| DB-13 | P2 | link updated unconditionally | two invoices for one work order | CONFIRMED (3/3) | S14 |
| DB-14 | P2 | absolute SET, no bound | lost work-order payments, overpayment | CONFIRMED (3/3) | S15 |
| DB-15 | P2 | absolute SET from a stale read | credit created or erased | CONFIRMED | S16 |
| DB-16 | P2 | bound outside the tx | PO overpaid | CONFIRMED (3/3) | S16b |
| DB-17 | P2 | unconditional reversal, no CHECK | negative loyalty balance | CONFIRMED | S20 |
| DB-18 | P2 | non-canonical lock order, no retry | deadlocks abort sales (HTTP 500) | CONFIRMED (39/40) | S17 |
| DB-19 | P2 | unconditional job update | a paid subscription becomes `PAST_DUE` and is charged again | CONFIRMED (replica) | B6 |
| DB-20 | P2 | pool sizing vs `max_connections` | instance-wide connection errors | CONFIRMED | P4-run |
| DB-21 | P2 | version bump outside the DDL tx; non-idempotent DDL | tenant permanently failing migrations | CONFIRMED | M1, M2 |
| DB-22 | P2 | non-atomic, non-resumable provisioning | orphan tenant; subdomain and email locked | CONFIRMED | M6 |
| DB-23 | P2 | raw SQL drift | ETA submission impossible | CONFIRMED (EXPLAIN) | §3 |
| DB-24 | P3 | absolute SET | lost decline counts | CONFIRMED | B2 |
| DB-25 | P3 | billing state machine | `CANCELLED` revived; paid time shortened | CONFIRMED | B3; code |
| DB-26 | P3 | check-then-act dedupe; manual trigger skips the lock | duplicate reminder emails | CONFIRMED | B8 |
| DB-27 | P3 | non-conditional transition | second collection accepted silently | CONFIRMED (5/5) | S5 |
| DB-28 | P3 | base client used inside the tx | stale API response; extra connection | CONFIRMED | S19 |
| DB-29 | P3 | resource lifecycle | in-flight tx aborted on LRU eviction | CONFIRMED | P3-run |
| DB-30 | P3 | ledger kept in JSON audit rows | cancel times out for heavy customers | CONFIRMED | P2-run |
| DB-31 | P3 | default tx limits + small pool, no DB-side timeouts | one stall fails a whole tenant | CONFIRMED | P1-run |
| DB-32 | P3 | Prisma/SQL drift | installment payment method never stored | CONFIRMED | migrate diff |
| DB-33 | P3 | raw SQL drift | statement export fails | CONFIRMED (EXPLAIN) | §3 |
| DB-34 | P3 | Prisma model ≠ SQL | tooling hazard; wrong delete semantics | CONFIRMED | migrate diff |
| DB-35 | P3 | destructive FK actions / unguarded delete | coupon history and admin audit trail destroyed | CONFIRMED (schema + code) | §20 |
| DB-36 | P3 | missing state validation | cancelled work order can be invoiced | CONFIRMED (code) | §18 |
| DB-37 | P3 | failure thresholds applied to every decline | valid trials or paid periods suspended after 7 declines | CONFIRMED (code) | `billing.service.ts:213-222` |
| DB-38 | INFO | sequence semantics; UTC date | gaps; previous-day prefix around midnight | CONFIRMED | psql; code |
| L-01 | P2 | no idempotency toward Paymob | double charge after a post-charge failure | LIKELY | §30 |
| L-02 | P2 | listen before migrations | deploy-window errors; DDL blocking | LIKELY | `index.ts:472,484` |
| L-03 | P2 | stale job selection | charge after cancel or payment within the loop | LIKELY | `renewal.job.ts:76-165` |
| L-04 | P2 | no idempotency + client retry paths | duplicate sales from POS retry, replay, or Redis-recovery flush | LIKELY | `POS.tsx:122-145,307-336` |
| L-05 | P3 | cache-aside race | suspended tenant active ≤ 300 s | LIKELY | `tenant.middleware.ts:63-74` |
| L-06 | P3 | non-atomic Redis rotation | session fork (HSEC-10) | LIKELY | `auth.service.ts:101-120` |
| L-07 | P3 | owner-less lock release | overlapping cycles after a TTL overrun | LIKELY | `lock.ts:17-23` |
| L-08 | P3 | count-then-act limits | plan limits exceeded | LIKELY | `limit.middleware.ts:23-75` |
| L-09 | P3 | inverse lock order (customer ↔ stock) | sale vs return deadlocks | LIKELY | §11 |
| L-10 | P3 | sweep skips `CANCELLED` | reactivated tenant on an old schema | LIKELY | `migrate-tenants.ts:125-127` |
| P-01..P-10 | P2–P3 | see §35 | — | POTENTIAL | §35 |

Each confirmed finding below lists the 14 required fields.

### DB-01 — Pending installment invoices can be cancelled or returned; approval revives cancelled invoices (FIN-03 / FIN-04) · **P0**
| Field | Detail |
|---|---|
| ID / Severity | DB-01 / P0 (normal UI and API use; no concurrency needed) |
| Root cause | missing state validation; no state machine linking invoice and contract |
| File | `apps/api/src/modules/invoices/invoice.service.ts`; `apps/api/src/modules/installments/installment.service.ts`; UI `apps/web/src/pages/invoices/Invoices.tsx:326` |
| Function | `cancelInvoice` (`:692-870`), `returnInvoice` (`:555-680`), `approveContract` (`:307-401`) |
| Database operation | `UPDATE stock SET quantity = quantity + q` per line (`:724-727`, `:638-641`); `UPDATE customers SET credit_balance = credit_balance + amount` (`:657-660`); `UPDATE invoices SET status='completed', paid_amount = down_payment WHERE id = …` (`installment.service.ts:329-332`) |
| Transaction boundary | each operation is one interactive tx; the status checks run **before** it (`:701-710`, `:569`, `installment.service.ts:319`) |
| Concurrency scenario | none required |
| Current protection | blacklist checks: not `cancelled`, not `returned`, no return rows |
| Why protection fails | a `pending` installment invoice never moved stock but passes every check; reversals use invoice lines rather than recorded movements; approval never checks the invoice's state |
| Resulting invalid state | stock +qty for goods never removed (5 → 6); 1,000 credit on an invoice with 0 paid; `cancelled` → `completed` |
| Impact | inventory overstated; free store credit; revenue for a cancelled sale; an active contract behind a cancelled invoice |
| Remediation | transition whitelist enforced in the UPDATE (`updateMany({ where: { id, status: 'completed' } })`, require count 1); reverse what the `out` movements for the invoice recorded; refuse cancel or return for invoices with a contract (route through the contract); approve with `WHERE status = 'pending'` |
| Regression test | RT-D01, RT-D02, RT-D03 |

### DB-02 — Store credit can be spent twice; the balance goes negative · **P1**
| Field | Detail |
|---|---|
| ID / Severity | DB-02 / P1 |
| Root cause | unconditional atomic decrement; no CHECK on `customers.credit_balance` |
| File | `apps/api/src/modules/invoices/invoice.service.ts` |
| Function | `createInvoice` |
| Database operation | read `customer.creditBalance` (`:258-265`, before the tx), then `UPDATE customers SET credit_balance = credit_balance - $creditUsed WHERE id = $1` (`:313-320`) |
| Transaction boundary | read outside; decrement inside the sale tx |
| Concurrency scenario | two sales for the same customer, each using 700 of a 1,000 balance (two cashiers, double-click, retry) |
| Current protection | cap `min(requested, balance)` computed from the pre-transaction read |
| Why protection fails | under READ COMMITTED the second decrement waits for the first transaction's row lock and then applies to the new value; nothing bounds it |
| Resulting invalid state | `credit_balance = −400` (20/20) |
| Impact | credit spent that the customer doesn't have; with a negative balance, an API sale that sends `creditAmount` computes a negative `creditUsed` and a negative discount (P-10) |
| Remediation | `updateMany({ where: { id, creditBalance: { gte: creditUsed } }, data: { creditBalance: { decrement: creditUsed } } })`, count 0 → 409; `CHECK (credit_balance >= 0) NOT VALID`, then `VALIDATE` after cleanup |
| Regression test | RT-D04 |

### DB-03 — Double approval duplicates the installment schedule and decrements stock twice (FIN-07) · **P1**
| Field | Detail |
|---|---|
| ID / Severity | DB-03 / P1 |
| Root cause | non-conditional state transition; no `UNIQUE (contract_id, installment_number)` |
| File | `apps/api/src/modules/installments/installment.service.ts` |
| Function | `approveContract` |
| Database operation | `UPDATE installment_contracts SET status='active' WHERE id=$1` (`:323-326`); conditional stock decrement per line (`:337-344`); N × `INSERT installment_payments` (`:373-384`) |
| Transaction boundary | status read **before** the tx (`:312-319`); writes inside |
| Concurrency scenario | two managers, a double-click, or a client retry |
| Current protection | pre-tx status check; the stock condition only stops the second approval if stock is short |
| Why protection fails | the second transaction re-evaluates `WHERE id = $1`, which still matches; nothing makes schedule rows unique |
| Resulting invalid state | 6 schedule rows for a 3-month contract; stock −2 for a 1-unit sale; two `out` movements (5/5) |
| Impact | the customer is billed and reminded twice; inventory understated; receivables doubled |
| Remediation | `updateMany({ where: { id, status: 'pending_approval' }, data: { status: 'active', … } })`, require count 1, as the tx's first statement; `CREATE UNIQUE INDEX … ON installment_payments(contract_id, installment_number)` |
| Regression test | RT-D05 |

### DB-04 — Approve and reject race: the reject is lost, or the contract is cancelled with goods already out · **P1**
| Field | Detail |
|---|---|
| ID / Severity | DB-04 / P1 |
| Root cause | both transitions are unconditional (check before the tx, `update by id` inside it) |
| File | `apps/api/src/modules/installments/installment.service.ts` |
| Function | `approveContract` (`:307-401`), `rejectContract` (`:405-433`) |
| Database operation | approve: contract → `active`, invoice → `completed`, stock −, schedule; reject: contract → `cancelled`, invoice → `cancelled` (`:415-422`) |
| Transaction boundary | separate transactions; status read before each |
| Concurrency scenario | two managers act on one pending contract at the same moment |
| Current protection | `status !== 'pending_approval'` checks before the tx (`:319`, `:412`) |
| Why protection fails | both checks pass; whichever transaction commits last overwrites the other |
| Resulting invalid state | (a) reject first, then approve: `active` / `completed` while the rejecter got success (7 of 8 simultaneous trials; audit trail `create → reject → approve`); (b) approve first, then reject (reject +4–8 ms): contract and invoice `cancelled`, **2 schedule rows exist and stock was decremented** (4 of 6 trials) |
| Impact | goods released with no valid sale; a cancelled contract keeps a schedule (payments can still be recorded against it) |
| Remediation | conditional transitions in both paths (`WHERE status = 'pending_approval'`, require count 1) |
| Regression test | RT-D06 |

### DB-05 — Double cancel applies every reversal twice (FIN-07) · **P1**
| Field | Detail |
|---|---|
| ID / Severity | DB-05 / P1 |
| Root cause | non-conditional transition |
| File | `apps/api/src/modules/invoices/invoice.service.ts` |
| Function | `cancelInvoice` |
| Database operation | `UPDATE coupons SET used_count = GREATEST(used_count-1,0)` (`:716-719`); `stock += qty` per line (`:724-727`); `credit_balance += amount` (`:767-771`); `loyalty_points -= earned` (`:792-796`) and `+= redeemed` (`:819-823`); `status = 'cancelled'` (`:845-848`) |
| Transaction boundary | status and return checks before the tx (`:697-710`) |
| Concurrency scenario | double-click, two tabs, retry after a timeout |
| Current protection | `already_cancelled` / `invoice_returned` checks on a pre-tx read |
| Why protection fails | the second transaction proceeds after the first commits; the final status update is unconditional |
| Resulting invalid state | stock 12 instead of 10; credit 200 instead of 100; coupon `used_count` 4 instead of 5 (5/5) |
| Impact | inventory and store credit inflated; coupon limits bypassed; loyalty reversed twice (can go negative) |
| Remediation | first statement `updateMany({ where: { id, status: 'completed' }, data: { status: 'cancelled' } })`, abort if count ≠ 1 |
| Regression test | RT-D07 |

### DB-06 — Concurrent returns, or return plus cancel, over-refund and over-restock · **P1**
| Field | Detail |
|---|---|
| ID / Severity | DB-06 / P1 |
| Root cause | cumulative cap and cross-checks evaluated outside the tx; invoice row never locked |
| File | `apps/api/src/modules/invoices/invoice.service.ts` |
| Function | `returnInvoice` (`:555-680`); `cancelInvoice` (`:709-710` return-count check) |
| Database operation | `INSERT returns / return_items` (`:617-633`); `stock += q` (`:638-641`); `credit_balance += returnAmount` (`:657-660`) |
| Transaction boundary | prior returns read with the base client before the tx (`:579-602`) |
| Concurrency scenario | two cashiers return the same invoice; a manager cancels while a return is processed |
| Current protection | cumulative cap (ACC-02) and `returnCount > 0` checks, both on stale reads |
| Why protection fails | neither transaction sees the other's uncommitted return; nothing locks the invoice row |
| Resulting invalid state | S9: two full returns → stock 12 / 10 and credit 1,000 for a 500 invoice; S10: return + cancel → stock 12 / 10, credit 500, status `cancelled` (5/5 each) |
| Impact | money and stock out of thin air |
| Remediation | `SELECT … FROM invoices WHERE id = $1 FOR UPDATE` as the first statement of both transactions; recompute cumulative returns inside the tx; record `returned` / `partially_returned` with a conditional update |
| Regression test | RT-D08 |

### DB-07 — PO double receive: received above ordered, supplier liability doubled · **P1**
| Field | Detail |
|---|---|
| ID / Severity | DB-07 / P1 |
| Root cause | outstanding quantity computed outside the tx; increments unbounded; no lock |
| File | `apps/api/src/modules/purchase-orders/po.routes.ts` |
| Function | `POST /:id/receive` handler (`:227-396`) |
| Database operation | stock upsert `+q` (`:310-314`); `received_quantity += q` (`:333-336`); `suppliers.balance += batchCost` (`:360-363`); status recompute (`:367-374`) |
| Transaction boundary | PO and items read before the tx (`:238-285`) |
| Concurrency scenario | double-click "receive all", or two storekeepers |
| Current protection | status + outstanding checks on a pre-tx snapshot |
| Why protection fails | both transactions compute the same outstanding quantity; nothing caps the increment |
| Resulting invalid state | received 20 of 10; stock +20; supplier balance 4,000 instead of 2,000 (2 of 3 trials) |
| Impact | inventory and payables inflated; WAC skewed; supplier overpaid later |
| Remediation | lock the PO row (`FOR UPDATE`) and re-read items inside the tx, or a conditional raw `UPDATE … SET received_quantity = received_quantity + $q WHERE id = $1 AND received_quantity + $q <= quantity` (count must be 1); `CHECK (received_quantity <= quantity)` |
| Regression test | RT-D09 |

### DB-08 — Dunning charges subscriptions that are already paid or scheduled to cancel · **P1**
| Field | Detail |
|---|---|
| ID / Severity | DB-08 / P1 (charges customers' cards incorrectly) |
| Root cause | incorrect billing state machine: one `failedAttempts` counter shared by renewal failures and interactive declines; the dunning selection ignores the paid period and `cancelAtPeriodEnd` |
| File | `apps/api/src/jobs/dunning.job.ts`; `apps/api/src/modules/billing/billing.service.ts` |
| Function | `runDunningCycle` (`:61-165`); `handleWebhookFailure` (`:200-282`); `handleWebhookSuccess` (`:117-198`) |
| Database operation | `SELECT … FROM subscriptions WHERE status IN ('ACTIVE','PAST_DUE','SUSPENDED') AND failed_attempts > 0 AND provider_card_token IS NOT NULL` (`:74-81`); then the charge; then `UPDATE subscriptions SET current_period_start = now, current_period_end = now + cycle …` |
| Transaction boundary | selection, external charge and DB write are separate steps; no tx spans them |
| Concurrency scenario | (a) a paid `ACTIVE` subscription with 25 days left gets one declined checkout attempt (e.g. trying another card): `failedAttempts` becomes 1, and 3 days later dunning charges the stored card; (b) the user schedules cancellation while `failedAttempts > 0` |
| Current protection | `failedAttempts > 0` and the 3-day gap |
| Why protection fails | no `current_period_end <= now` condition; no `cancel_at_period_end = false` condition; interactive declines increment the renewal counter |
| Resulting invalid state | B4: `selectedAfter: true`, status `ACTIVE`, 25 days left. B7: `cancelAtPeriodEnd: true`, still selected |
| Impact | double charge for a paid period (and the remaining days are lost, because the period resets to now + cycle); a charge after the user cancelled |
| Remediation | dunning only for subscriptions whose period ended unpaid and that are not cancel-scheduled; separate counters for renewal failures and checkout declines; extend periods from `max(now, current_period_end)`; persist a pending payment per billing period and refuse a second charge for the same period |
| Regression test | RT-D10 |

### DB-09 — A Redis outage hangs every tenant request · **P1**
| Field | Detail |
|---|---|
| ID / Severity | DB-09 / P1 (availability; feeds DB-10 duplicates on recovery) |
| Root cause | one IORedis client for both BullMQ and the request path, with `maxRetriesPerRequest: null` (no command ever rejects) and no fallback |
| File | `apps/api/src/config/redis.ts:4-7`; `shared/middleware/tenant.middleware.ts:63,73,91,100`; `index.ts:96-99`; `modules/auth/auth.service.ts:70-123` |
| Function | `tenantMiddleware`; rate limiter; session functions |
| Database operation | Redis GET / SETEX before any SQL |
| Transaction boundary | before any DB work (webhook: after its DB commit) |
| Concurrency scenario | Redis restart, OOM, or network partition |
| Current protection | ioredis' reconnect loop |
| Why protection fails | queued commands wait indefinitely; there are no timeouts (Fastify request timeout 0, axios timeout 0) |
| Resulting invalid state | requests pending indefinitely (experiment: still pending at 4 s; with `maxRetriesPerRequest: 1` it rejects in 54 ms) |
| Impact | full tenant outage, including login; the webhook hangs after commit; queued work bursts on recovery, together with user retries |
| Remediation | separate connections (BullMQ: `null`; app: `maxRetriesPerRequest: 1`, `enableOfflineQueue: false`, `commandTimeout`); treat cache errors as misses; rate limiter `skipOnError: true`; consider a Fastify `requestTimeout` |
| Regression test | RT-D11 |

### DB-10 — No idempotency on sales and other creates; retries and replays duplicate them (FIN-09) · **P1**
| Field | Detail |
|---|---|
| ID / Severity | DB-10 / P1 (CONFIRMED that the server accepts duplicates; trigger frequency LIKELY) |
| Root cause | no client idempotency key and no natural unique business key |
| File | `apps/api/src/modules/invoices/invoice.routes.ts:29-53`; `invoice.schema.ts:4-32`; `apps/web/src/pages/pos/POS.tsx:122-145,307-336`; `apps/web/src/api/client.ts:5` |
| Function | `POST /api/invoices`; POS `submitSale`, `goOnline` |
| Database operation | full sale tx (`INSERT invoices`, items, stock, …) |
| Transaction boundary | each submission is an independent tx |
| Concurrency scenario | lost response then retry; offline replay after a lost response; two tabs replaying the same `localStorage` queue; repeated `online` events; Redis-hang recovery releasing the original request alongside the retry |
| Current protection | none (sequence-based invoice numbers are always unique) |
| Why protection fails | the server cannot tell a retry from a new sale |
| Resulting invalid state | two invoices for one checkout: stock −2×, revenue ×2, loyalty earned ×2, credit spent ×2 |
| Impact | FIN-09 |
| Remediation | an `Idempotency-Key` per cart (UUID from the POS), stored in a `request_keys(key UNIQUE, response)` table inside the sale tx and returning the stored response on repeat; same for payments, returns, receipts, approvals |
| Regression test | RT-D12 |

### DB-11 — Stock transfer approved twice moves stock twice · **P2**
| Field | Detail |
|---|---|
| ID / Severity | DB-11 / P2 (inter-branch only; total stock conserved) |
| Root cause | non-conditional transition; availability checked outside the tx; decrement unconditional |
| File | `apps/api/src/modules/stock/stock.service.ts` |
| Function | `approveTransfer` (`:218-307`) |
| Database operation | `UPDATE stock SET quantity = quantity - q` (`:254-259`); destination upsert `+q` (`:272-284`); status (`:297-300`) |
| Transaction boundary | status and availability read before the tx (`:224-249`) |
| Concurrency scenario | double approve; approve ∥ reject |
| Current protection | pre-checks; migration 016's CHECK (`stock ≥ 0`) |
| Why protection fails | only the CHECK stops it, and only when the source can't cover 2× |
| Resulting invalid state | "ample": source 4 instead of 7, destination 6 instead of 3, 4 movements instead of 2. "Exact": the second approval fails with a raw `23514` (HTTP 500) |
| Impact | branch stock wrong; approve ∥ reject can leave `rejected` with stock moved |
| Remediation | conditional status update first; conditional decrement (`WHERE quantity >= q`) |
| Regression test | RT-D13 |

### DB-12 — Concurrent receipts compute the weighted average cost from stale data · **P2**
| Field | Detail |
|---|---|
| ID / Severity | DB-12 / P2 |
| Root cause | unlocked read-compute-write under READ COMMITTED |
| File | `apps/api/src/modules/purchase-orders/po.routes.ts` |
| Function | receive handler, WAC block (`:299-319`) |
| Database operation | `SELECT sum(quantity) FROM stock WHERE variant_id`, `SELECT cost_price …`, then `UPDATE product_variants SET cost_price = $newCost` |
| Transaction boundary | inside the receive tx, without locks |
| Concurrency scenario | two POs of the same variant received at once (10 @ 100 on hand; +10 @ 200; +10 @ 400) |
| Current protection | none |
| Why protection fails | both transactions read the pre-state; the later commit overwrites the cost |
| Resulting invalid state | `cost_price` **250.0000** instead of serial **233.3333** (3/3) |
| Impact | COGS and margins wrong; the error is frozen into every later sale's `cost_at_sale` |
| Remediation | `SELECT cost_price FROM product_variants WHERE id = $1 FOR UPDATE` before aggregating, or compute WAC in one UPDATE statement |
| Regression test | RT-D14 |

### DB-13 — One work order can produce two invoices · **P2**
| Field | Detail |
|---|---|
| ID / Severity | DB-13 / P2 |
| Root cause | link written unconditionally; the unique index is in the wrong direction |
| File | `apps/api/src/modules/services/workOrder.routes.ts` |
| Function | `POST /:id/invoice` (`:389-526`) |
| Database operation | `INSERT invoices` (paid = total) + items; `UPDATE work_orders SET invoice_id = $new WHERE id = $1` (`:510`) |
| Transaction boundary | `wo.invoiceId` read before the tx (`:400-411`) |
| Concurrency scenario | double-click "create invoice" |
| Current protection | pre-check; partial UNIQUE on `work_orders.invoice_id` (013) |
| Why protection fails | the second update simply relinks; the unique index prevents two orders sharing one invoice, not one order creating two |
| Resulting invalid state | two `completed`, paid invoices for one work order; the first is orphaned (3/3) |
| Impact | revenue doubled; customer possibly charged twice |
| Remediation | inside the tx, `updateMany({ where: { id, invoiceId: null }, data: { invoiceId } })` and abort if count ≠ 1 |
| Regression test | RT-D15 |

### DB-14 — Work-order payments lose updates and have no upper bound · **P2**
| Field | Detail |
|---|---|
| ID / Severity | DB-14 / P2 |
| Root cause | absolute SET from a stale read; no bound against the total |
| File | `apps/api/src/modules/services/workOrder.routes.ts` |
| Function | `POST /:id/payment` (`:531-570`) |
| Database operation | `newPaid = wo.paidAmount + amount` (`:546`); `UPDATE work_orders SET paid_amount = $newPaid` (`:547-557`) |
| Transaction boundary | none (the audit row is written separately) |
| Concurrency scenario | two payments recorded together |
| Current protection | none |
| Why protection fails | both requests read the same `paid_amount` |
| Resulting invalid state | `paid_amount` 100 after 2 × 100 (3/3) |
| Impact | cash collected but not recorded; overpayment possible |
| Remediation | `paidAmount: { increment }` in a conditional update bounded by `final_total`, together with the audit row in one tx |
| Regression test | RT-D16 |

### DB-15 — Manual credit adjustment overwrites concurrent balance changes · **P2**
| Field | Detail |
|---|---|
| ID / Severity | DB-15 / P2 (narrow window; creates or erases money) |
| Root cause | absolute SET from a stale read, computed with JS `Number` |
| File | `apps/api/src/modules/customers/customer.routes.ts` |
| Function | `POST /:id/credit` (`:112-159`) |
| Database operation | read (`:128`); `UPDATE customers SET credit_balance = $newBalance` (`:140-143`); audit separately (`:145-155`) |
| Transaction boundary | none |
| Concurrency scenario | a manager adds 50 while a POS sale spends 700 |
| Current protection | `newBalance < 0` check on the stale value |
| Why protection fails | the sale's decrement lands between the read and the write; the absolute SET erases it |
| Resulting invalid state | **1,050** instead of 350 (1 of 14 trials across a 5–40 ms stagger sweep) |
| Impact | store credit created (or destroyed); the audit row shows wrong before and after values |
| Remediation | conditional `increment` / `decrement` with the audit row in one tx |
| Regression test | RT-D17 |

### DB-16 — Concurrent PO payments overpay the order · **P2**
| Field | Detail |
|---|---|
| ID / Severity | DB-16 / P2 |
| Root cause | bound checked outside the tx; increment unbounded |
| File | `apps/api/src/modules/purchase-orders/po.routes.ts` |
| Function | `POST /:id/payments` (`:399-451`) |
| Database operation | array tx: `INSERT purchase_payments`, `paid_amount += x`, `INSERT supplier_transactions`, `balance -= x` (`:418-447`) |
| Transaction boundary | remaining computed before (`:413-416`, using `toNumber()`); audit after (`:449`) |
| Concurrency scenario | two payments of the full remaining amount |
| Current protection | `amount > remaining` check on a stale read |
| Why protection fails | both requests see the full remaining amount |
| Resulting invalid state | `paid_amount` 2,000 on a 1,000 total (3/3) |
| Impact | supplier overpaid; payables understated |
| Remediation | conditional raw `UPDATE … WHERE paid_amount + $x <= total_amount` (count 1) + `CHECK (paid_amount <= total_amount)` |
| Regression test | RT-D18 |

### DB-17 — Cancelling a sale after its earned points were spent drives loyalty negative (FIN-12) · **P2**
| Field | Detail |
|---|---|
| ID / Severity | DB-17 / P2 |
| Root cause | unconditional reversal; no CHECK on `loyalty_points` |
| File | `apps/api/src/modules/invoices/invoice.service.ts` |
| Function | `cancelInvoice` (`:789-796`) |
| Database operation | `UPDATE customers SET loyalty_points = loyalty_points - $earned` |
| Transaction boundary | inside the cancel tx |
| Concurrency scenario | sequential (earn on A, redeem on B, cancel A), or a redemption concurrent with a cancel |
| Current protection | none |
| Why protection fails | the reversal doesn't check the balance |
| Resulting invalid state | **−1,000** points (S20) |
| Impact | a negative points liability silently consumes future earnings |
| Remediation | clamp, or conditional reversal with the shortfall recorded; `CHECK (loyalty_points >= 0)` |
| Regression test | RT-D19 |

### DB-18 — Multi-line sales deadlock because lock order follows the client's item order · **P2**
| Field | Detail |
|---|---|
| ID / Severity | DB-18 / P2 (no corruption; failed checkouts) |
| Root cause | non-canonical lock order; no retry on deadlock |
| File | `apps/api/src/modules/invoices/invoice.service.ts` (also cancel, return, approve, transfer) |
| Function | `createInvoice` stock loop (`:362-401`) |
| Database operation | `UPDATE stock … WHERE variant_id=$1 AND branch_id=$2 AND quantity >= $n` in request order |
| Transaction boundary | sale tx |
| Concurrency scenario | two cashiers sell overlapping items listed in different orders |
| Current protection | the Postgres deadlock detector (aborts one transaction after `deadlock_timeout`) |
| Why protection fails | no ordering, no retry; the error isn't mapped (raw `ConnectorError`, no `P2034`) |
| Resulting invalid state | none persisted. **39 of 40** pairs had one sale aborted with `40P01`; stock stayed consistent |
| Impact | HTTP 500 at checkout; the cashier has to retry (and with DB-10, may duplicate) |
| Remediation | sort lines by `variantId` before locking, in every multi-row path; bounded retry on `40P01` / `40001` / `P2034` |
| Regression test | RT-D20 |

### DB-19 — Trial expiry can overwrite a just-completed payment · **P2**
| Field | Detail |
|---|---|
| ID / Severity | DB-19 / P2 (daily window = the job's loop duration) |
| Root cause | unconditional update after a stale selection |
| File | `apps/api/src/jobs/trial-expiry.job.ts` |
| Function | `runTrialExpiry` (`:115-149`) |
| Database operation | `SELECT … WHERE status='TRIALING' AND trial_ends_at <= now`, then `UPDATE subscriptions SET status='PAST_DUE', failed_attempts=1, … WHERE id=$1` (`:121-132`) |
| Transaction boundary | none; one email is awaited per subscription inside the loop (`:137-146`) |
| Concurrency scenario | the user pays (webhook success → `ACTIVE`, card stored) after the selection, before the update |
| Current protection | none |
| Why protection fails | the update doesn't re-check `status = 'TRIALING'` |
| Resulting invalid state | B6: `PAST_DUE`, `failedAttempts` 1, `lastPaymentAt` set, dunning-eligible |
| Impact | a paying customer is shown as past due and charged again 3 days later (DB-08) |
| Remediation | `updateMany({ where: { id, status: 'TRIALING' }, … })` |
| Regression test | RT-D21 |

### DB-20 — Tenant client pools can exceed the PostgreSQL connection limit · **P2**
| Field | Detail |
|---|---|
| ID / Severity | DB-20 / P2 (depends on how many tenants are busy at once) |
| Root cause | 50 cached tenant clients × `connection_limit` 5 = 250 possible connections, plus 2 master pools, against the default `max_connections` 100; no pooler |
| File | `apps/api/src/config/database.ts:10-17,29-42`; `docker-compose.prod.yml:2-18` |
| Function | `getTenantDb` |
| Database operation | new backend connections opened on demand by each client's pool |
| Transaction boundary | n/a |
| Concurrency scenario | about 20 or more tenants busy at the same moment (dashboards fan out queries with `Promise.all`) |
| Current protection | per-client limit only; the code comment acknowledges the ceiling (`database.ts:10-15`) |
| Why protection fails | there is no global limit across the clients |
| Resulting invalid state | P4-run: 22 tenants × 5 concurrent queries → **17 of 110 failed** with `too many clients already` |
| Impact | errors for **every** tenant and for master queries (login, tenant resolution, webhooks) |
| Remediation | PgBouncer in transaction mode (`pgbouncer=true` in the Prisma URL) or lower per-tenant limits; alert on connection count; size `max_connections` deliberately |
| Regression test | RT-D22 |

### DB-21 — The migration version is bumped outside the DDL transaction, and three files can't be re-run · **P2**
| Field | Detail |
|---|---|
| ID / Severity | DB-21 / P2 (needs a crash in a narrow window; recovery is manual) |
| Root cause | `schema_version` is updated after the file's transaction commits, through another client; 001, 002 and 016 are not idempotent |
| File | `packages/database/src/migrate-tenants.ts`; `migrations/tenant/001_init.sql`, `002_full_schema.sql`, `016_check_constraints.sql` |
| Function | `runTenantMigrations` (`:57-118`) |
| Database operation | per-file `$transaction` of DDL (`:95-102`), then `UPDATE tenants SET schema_version = v` (`:104-107`) |
| Transaction boundary | DDL in one tx; version in a separate statement |
| Concurrency scenario | process killed (deploy restart, OOM, SIGKILL after the 25 s shutdown budget) between the two |
| Current protection | version filter; advisory lock |
| Why protection fails | the next run re-executes DDL that already committed |
| Resulting invalid state | M2: `42710 constraint … already exists`; `schema_version` stays 15; `migrateAllTenants` `{ ok: 0, failed: 1 }`, and this repeats on every boot |
| Impact | the tenant never receives later migrations; new code runs against an old schema; manual repair required |
| Remediation | update `public.tenants.schema_version` **inside the same transaction** (same database, so `tx.$executeRaw` can update the master table atomically); make DDL idempotent (`IF NOT EXISTS`, guarded constraint creation) |
| Regression test | RT-D23 |

### DB-22 — A crash mid-provisioning leaves an orphan tenant that blocks re-registration · **P2**
| Field | Detail |
|---|---|
| ID / Severity | DB-22 / P2 |
| Root cause | provisioning is many independent commits; compensation runs only for thrown errors; no resume and no sweeper |
| File | `apps/api/src/modules/tenants/tenant.service.ts` |
| Function | `provisionTenant` (`:192-286`) |
| Database operation | `INSERT tenants (PROVISIONING)`, `CREATE SCHEMA`, 17 migration transactions, 12 seed writes, `UPDATE tenants SET status='ACTIVE'`, `INSERT subscriptions` |
| Transaction boundary | none spanning the steps |
| Concurrency scenario | process death during signup |
| Current protection | try/catch compensation (`:274-279`) |
| Why protection fails | a killed process runs no catch block; nothing looks at `PROVISIONING` rows afterwards |
| Resulting invalid state | M6: tenant `PROVISIONING`, `schema_version` 3, 39 tables; retry → `subdomain_taken`; invisible to `migrateAllTenants` |
| Impact | the customer can't register with that subdomain **or** email; orphan schema; support intervention needed |
| Remediation | resumable, idempotent provisioning keyed by the tenant row; a sweeper for stale `PROVISIONING` rows; create the subscription and activate in one master transaction |
| Regression test | RT-D24 |

### DB-23 — ETA raw SQL fails against the real schema · **P2**
| Field | Detail |
|---|---|
| ID / Severity | DB-23 / P2 (P1 if ETA e-invoicing is in launch scope) |
| Root cause | raw SQL written against column names that no migration creates; raw SQL is not type-checked |
| File | `apps/api/src/jobs/eta-submission.job.ts`; `apps/api/src/modules/eta/eta.submit.ts` |
| Function | ETA worker (`:66-201`); `submitInvoiceToEta` (`:60-107`) |
| Database operation | SELECT `ts.eta_signing_cert_pem`, `ts.eta_is_production` (`:70-81`); UPDATE `eta_qr_data` (`:186-190`); INSERT `created_at` / `submission_id` and missing `direction` (`eta.submit.ts:64-99`) |
| Transaction boundary | none |
| Concurrency scenario | none |
| Current protection | none (the parity test compares table names only) |
| Why protection fails | n/a |
| Resulting invalid state | `42703` on the job's first query; after 5 attempts `eta_status = 'failed'`; no submission history |
| Impact | no invoice can reach ETA; compliance impossible |
| Remediation | rewrite with Prisma calls; add a column-level parity test and an EXPLAIN-every-raw-statement CI step against a migrated schema |
| Regression test | RT-D25 |

### DB-24 — Concurrent payment failures lose increments of `failedAttempts` · **P3**
| Field | Detail |
|---|---|
| ID / Severity | DB-24 / P3 |
| Root cause | absolute SET from a stale read |
| File | `apps/api/src/modules/billing/billing.service.ts` |
| Function | `handleWebhookFailure` (`:200-282`) |
| Database operation | read the subscription (`:210`), `newFailedAttempts = failedAttempts + 1` (`:213`), `UPDATE subscriptions SET failed_attempts = $n, status = $derived` (`:238-250`) |
| Transaction boundary | the read is outside the array tx |
| Concurrency scenario | two decline callbacks processed at once |
| Current protection | none |
| Why protection fails | both callbacks read the same count |
| Resulting invalid state | 3 instead of 4 (B2) |
| Impact | escalation (`PAST_DUE` / `SUSPENDED` / `CANCELLED`) delayed |
| Remediation | `failedAttempts: { increment: 1 }`, then derive the status from the returned row |
| Regression test | RT-D26 |

### DB-25 — Any successful payment reactivates a CANCELLED subscription and resets its period · **P3**
| Field | Detail |
|---|---|
| ID / Severity | DB-25 / P3 (policy question; paid time is lost) |
| Root cause | the success handler accepts any source state and sets the period from "now" |
| File | `apps/api/src/modules/billing/billing.service.ts` |
| Function | `handleWebhookSuccess` (`:117-198`) |
| Database operation | `UPDATE subscriptions SET status='ACTIVE', current_period_start=now, current_period_end=now+cycle, failed_attempts=0 …` (`:158-173`); `cancelled_at` untouched |
| Transaction boundary | array tx with the attempt insert |
| Concurrency scenario | a delayed or second payment, or an early payment |
| Current protection | idempotency per transaction id only |
| Why protection fails | no allowed-source-state check; no "extend from the current period end" |
| Resulting invalid state | B3: `ACTIVE` with `cancelled_at` still set; early payers lose the days remaining in their period |
| Impact | silent reactivation; customers pay for days they lose |
| Remediation | explicit transition rules; `period_end = max(now, current_period_end) + cycle`; clear `cancelled_at` deliberately |
| Regression test | RT-D27 |

### DB-26 — Overlapping reminder runs send duplicate emails · **P3**
| Field | Detail |
|---|---|
| ID / Severity | DB-26 / P3 |
| Root cause | check-then-act dedupe; the manual trigger bypasses `withLock` (HSEC-05) |
| File | `apps/api/src/jobs/installment-reminders.job.ts`; `apps/api/src/modules/installments/installment.routes.ts:216-224` |
| Function | `runReminderCycle` (`:69-170`) |
| Database operation | `SELECT audit_logs … action='reminder_sent' within 24 h` (`:119-131`), send, `INSERT audit_logs` (`:145-154`) |
| Transaction boundary | none |
| Concurrency scenario | cron and the manual trigger at the same time, or two manual triggers |
| Current protection | 24 h audit lookup |
| Why protection fails | both runs look before either one writes |
| Resulting invalid state | 2 `reminder_sent` rows, 2 emails (B8) |
| Impact | customer annoyance; HSEC-05 makes it cross-tenant |
| Remediation | insert a unique `(payment_id, reminder_date)` row **before** sending (`ON CONFLICT DO NOTHING`, send only if inserted); run the manual trigger under the lock and scoped to the caller's tenant |
| Regression test | RT-D28 |

### DB-27 — The same installment row can be "paid" twice · **P3**
| Field | Detail |
|---|---|
| ID / Severity | DB-27 / P3 |
| Root cause | non-conditional transition |
| File | `apps/api/src/modules/installments/installment.service.ts` |
| Function | `recordPayment` (`:437-492`) |
| Database operation | `UPDATE installment_payments SET status='paid' … WHERE id=$1` (`:458-466`) |
| Transaction boundary | `already_paid` read before the tx (`:444-448`) |
| Concurrency scenario | two cashiers collect the same installment |
| Current protection | pre-tx `already_paid` check |
| Why protection fails | both pass it |
| Resulting invalid state | both calls succeed: one paid row, two `record_payment` audit rows (5/5) |
| Impact | a second cash collection is accepted with no record of the extra money; drawer mismatch |
| Remediation | `updateMany({ where: { id, status: { not: 'paid' } } })`, require count 1 |
| Regression test | RT-D29 |

### DB-28 — `approveContract` reads its response through the base client inside the transaction · **P3**
| Field | Detail |
|---|---|
| ID / Severity | DB-28 / P3 |
| Root cause | `db` used instead of `tx` inside the transaction callback |
| File | `apps/api/src/modules/installments/installment.service.ts` |
| Function | `approveContract` (`:396-399`) |
| Database operation | `SELECT installment_contracts … include payments` on a second connection |
| Transaction boundary | runs while the approval tx is still open |
| Concurrency scenario | every approval; worse with a saturated pool |
| Current protection | none |
| Why protection fails | READ COMMITTED: the other connection can't see the uncommitted writes |
| Resulting invalid state | S19: the response says `pending_approval` with 0 payments; committed data is `active` with 4 |
| Impact | the UI shows a stale state; each approval holds 2 connections (P-08) |
| Remediation | use `tx` |
| Regression test | RT-D30 |

### DB-29 — LRU eviction disconnects a tenant client in the middle of its transaction · **P3**
| Field | Detail |
|---|---|
| ID / Severity | DB-29 / P3 (needs more than 50 tenants active within one transaction's lifetime) |
| Root cause | the `dispose` callback calls `$disconnect()` regardless of in-flight work |
| File | `apps/api/src/config/database.ts:20-27` |
| Function | LRU `dispose` |
| Database operation | the engine disconnects while an interactive tx is open |
| Transaction boundary | breaks an open tx |
| Concurrency scenario | the 51st distinct tenant is touched while the least-recently-used tenant has a request in flight |
| Current protection | `updateAgeOnGet` (only the least recently *accessed* client is evicted) |
| Why protection fails | a long request on an otherwise quiet tenant still makes it the least recently accessed |
| Resulting invalid state | P3-run: "Transaction not found … obtained before disconnecting"; rolled back |
| Impact | random 500s at scale |
| Remediation | delay disposal (idle grace or reference counting), or one shared client behind PgBouncer |
| Regression test | RT-D31 |

### DB-30 — Cancelling an invoice scans the customer's whole audit history inside the 5 s transaction · **P3**
| Field | Detail |
|---|---|
| ID / Severity | DB-30 / P3 (grows with each customer's history) |
| Root cause | the credit and loyalty "ledger" lives in JSON audit rows, filtered in JavaScript |
| File | `apps/api/src/modules/invoices/invoice.service.ts` |
| Function | `cancelInvoice` (`:746-763`) |
| Database operation | `SELECT * FROM audit_logs WHERE entity='customer' AND entity_id=$1 AND action IN (…)`: every matching row, then a JS `find` on `after.invoiceId` |
| Transaction boundary | inside the cancel tx (default 5 s) |
| Concurrency scenario | none; volume |
| Current protection | index on `(entity, entity_id)` |
| Why protection fails | the index narrows by customer, not by invoice |
| Resulting invalid state | P2-run: 50k rows 0.37 s; 200k 1.43 s; **600k 5.10 s → P2028**; the cancel is impossible |
| Impact | heavy customers' sales can't be cancelled; the cost keeps growing |
| Remediation | store `credit_used`, `loyalty_earned` and `loyalty_redeemed` on the invoice (or in a ledger table keyed by invoice); or filter in SQL (`after->>'invoiceId' = $2`) with an expression index |
| Regression test | RT-D32 |

### DB-31 — Default transaction limits plus a 5-connection pool: one stalled transaction fails the whole tenant · **P3**
| Field | Detail |
|---|---|
| ID / Severity | DB-31 / P3 (operational) |
| Root cause | Prisma defaults (`maxWait` 2 s, `timeout` 5 s) with `connection_limit` 5, and no `lock_timeout` or `statement_timeout` in the database |
| File | `apps/api/src/config/database.ts:17,36-40`; Prisma `runtime/library.js` defaults |
| Function | every interactive transaction |
| Database operation | row-lock waits inside transactions |
| Transaction boundary | each sale tx |
| Concurrency scenario | a slow transaction (DDL during a migration, a large receipt) holds a hot row |
| Current protection | Prisma rolls back timed-out transactions |
| Why protection fails | blocked transactions hold all 5 connections; new ones can't start |
| Resulting invalid state | none persisted. P1-run: 7 s lock → **8/8** sales failed (5 expired, 3 couldn't start) |
| Impact | a tenant-wide outage for the length of the stall |
| Remediation | role-level `lock_timeout` (e.g. 3 s) and `statement_timeout`; retry on lock timeout; keep DDL out of business hours or use `lock_timeout` in migrations |
| Regression test | RT-D38 |

### DB-32 — `installment_payments.payment_method_id` exists in SQL but not in Prisma, so it is never written · **P3**
| Field | Detail |
|---|---|
| ID / Severity | DB-32 / P3 |
| Root cause | Prisma model drift |
| File | `packages/database/migrations/tenant/010_installment_payment_method.sql`; `packages/database/prisma/schema.tenant.prisma:568-583`; `apps/api/src/modules/installments/installment.schema.ts:30`; `installment.service.ts:458-466` |
| Function | `recordPayment` |
| Database operation | the UPDATE omits the column |
| Transaction boundary | n/a |
| Concurrency scenario | none |
| Current protection | none (`migrate diff` reports `DROP COLUMN payment_method_id`) |
| Why protection fails | n/a |
| Resulting invalid state | every installment payment has `payment_method_id` NULL although the API accepted one |
| Impact | installment collections can't be attributed to a payment method (FIN-11 day close) |
| Remediation | add the field to the Prisma model and write it |
| Regression test | RT-D33 |

### DB-33 — The customer statement export queries a column that doesn't exist · **P3**
| Field | Detail |
|---|---|
| ID / Severity | DB-33 / P3 |
| Root cause | raw SQL drift |
| File | `apps/api/src/modules/customers/customer.routes.ts:259-260` |
| Function | customer statement (Excel export) |
| Database operation | `SELECT …, remaining_amount … FROM installment_contracts` |
| Transaction boundary | none (`Promise.all` of three queries) |
| Concurrency scenario | none |
| Current protection | none |
| Why protection fails | n/a |
| Resulting invalid state | `42703` at runtime; the whole `Promise.all` rejects |
| Impact | the export fails for every customer (HTTP 500) |
| Remediation | compute the remaining amount from `installment_payments`; add the EXPLAIN suite |
| Regression test | RT-D25 |

### DB-34 — The Prisma tenant model doesn't match the SQL schema (tooling hazard) · **P3**
| Field | Detail |
|---|---|
| ID / Severity | DB-34 / P3 |
| Root cause | the model was hand-maintained beside raw-SQL migrations |
| File | `packages/database/prisma/schema.tenant.prisma` vs `migrations/tenant/*.sql` |
| Function | — |
| Database operation | — |
| Transaction boundary | — |
| Concurrency scenario | none |
| Current protection | none |
| Why protection fails | n/a |
| Resulting invalid state | the `migrate diff` script (722 lines): 37 tables' timestamps, 10 `updated_at` defaults, 80 FK actions, 28 + 2 indexes, 1 column |
| Impact | none at runtime today; `prisma db push` / `migrate` on a tenant schema would drop indexes, convert `TIMESTAMPTZ` and rewrite FKs; developers misread delete semantics (CASCADE vs RESTRICT) |
| Remediation | regenerate the model from a migrated template schema (`prisma db pull`) or annotate it (`@db.Timestamptz`, `onDelete`, `@@index`); fail CI on a non-empty `migrate diff` |
| Regression test | RT-D34 |

### DB-35 — Deletes that destroy history: coupons, platform admins' audit trail, pre-existing schemas · **P3**
| Field | Detail |
|---|---|
| ID / Severity | DB-35 / P3 |
| Root cause | destructive FK actions and unguarded hard deletes |
| File | `apps/api/src/modules/coupons/coupon.routes.ts:89-92` + `002_full_schema.sql:244`; `apps/api/src/modules/admin/admin.routes.ts:838` + `prisma/migrations/20260517120000_add_platform_admin/migration.sql:31`; `tenant.service.ts:277` |
| Function | coupon DELETE; platform-admin DELETE; provisioning rollback |
| Database operation | `DELETE coupons` → `invoices.coupon_id SET NULL`; `DELETE platform_admins` → `platform_audit_logs CASCADE`; `DROP SCHEMA … CASCADE` |
| Transaction boundary | single statements |
| Concurrency scenario | none |
| Current protection | none (coupon); owner-only (admin) |
| Why protection fails | n/a |
| Resulting invalid state | invoices lose their coupon reference; an admin's audit history disappears with the admin; M4: rollback dropped a schema object it hadn't created |
| Impact | audit and reporting history lost |
| Remediation | soft-delete coupons (or RESTRICT when used); `ON DELETE SET NULL` / RESTRICT for audit actors; drop only schemas created in this run |
| Regression test | RT-D35 |

### DB-36 — A cancelled work order can still be invoiced · **P3**
| Field | Detail |
|---|---|
| ID / Severity | DB-36 / P3 |
| Root cause | missing state validation |
| File | `apps/api/src/modules/services/workOrder.routes.ts:400-411` |
| Function | `POST /:id/invoice` |
| Database operation | `INSERT invoices (status 'completed', paid = total)` |
| Transaction boundary | invoice tx |
| Concurrency scenario | none |
| Current protection | `invoiceId` check only |
| Why protection fails | the work order's status is never read |
| Resulting invalid state | a paid invoice for a cancelled job (code; not executed) |
| Impact | revenue for work never delivered |
| Remediation | allow invoicing only from `ready` / `delivered` |
| Regression test | RT-D36 |

### DB-37 — Decline thresholds apply to every failure, including declined checkouts during a valid trial · **P3**
| Field | Detail |
|---|---|
| ID / Severity | DB-37 / P3 |
| Root cause | the renewal-failure state machine is applied to interactive checkout declines |
| File | `apps/api/src/modules/billing/billing.service.ts:213-222` |
| Function | `handleWebhookFailure` |
| Database operation | `UPDATE subscriptions SET status = PAST_DUE / SUSPENDED / CANCELLED` at 3 / 7 / 14 failures |
| Transaction boundary | array tx |
| Concurrency scenario | none |
| Current protection | none |
| Why protection fails | no check of the current period or the attempt type |
| Resulting invalid state | a `TRIALING` (or paid `ACTIVE`) subscription becomes `SUSPENDED` after 7 declined card entries (code) |
| Impact | 402 lock-out during a paid period or trial (billing routes stay open) |
| Remediation | thresholds only for renewal and dunning failures; record checkout declines separately |
| Regression test | RT-D37 |

### DB-38 — Invoice numbers have gaps and use the UTC date · **INFO**
| Field | Detail |
|---|---|
| ID / Severity | DB-38 / INFO |
| Root cause | `nextval` is non-transactional; `toISOString()` gives the UTC date |
| File | `apps/api/src/modules/invoices/invoice.service.ts:448-455` |
| Function | `createInvoice` |
| Database operation | `SELECT nextval('invoice_number_seq')` |
| Transaction boundary | inside the sale tx, but sequences ignore rollback |
| Concurrency scenario | any rollback after `nextval` |
| Current protection | — |
| Why protection fails | — |
| Resulting invalid state | psql: a rolled-back tx consumed 154, the next value was 155; sales just after local midnight carry the previous UTC date |
| Impact | gaps (acceptable unless gap-free numbering is required); misleading date prefix |
| Remediation | document gaps as acceptable; build the date in the tenant's time zone |
| Regression test | — |

---

## 34. Likely Findings

For each item the mechanism is confirmed in code; the trigger depends on timing, environment or third-party behaviour.

| ID | Sev. | Finding | Mechanism (evidence) | Why not CONFIRMED |
|---|---|---|---|---|
| L-01 | P2 | **Renewal or dunning re-charges after a failure that follows a successful charge** | The charge happens before the DB write (`renewal.job.ts:103-157`, `dunning.job.ts:112-152`). Any later error counts as transient and the job rethrows (`renewal.job.ts:159-174`). BullMQ retries the whole cycle (attempts 3, backoff 60 s). The subscription is still "due" if the webhook hasn't recorded the first charge. `merchant_order_id` contains `Date.now()`, so Paymob sees a new order | needs a DB, Redis or network fault at that exact point, and depends on webhook timing; Paymob was not called |
| L-02 | P2 | **Deploy window: new code serves old schemas, and DDL blocks traffic** | `app.listen` (`index.ts:472`) runs before `migrateAllTenants()` (`:484`), which migrates tenants one at a time; `ALTER TABLE` holds `ACCESS EXCLUSIVE` until commit | not run against a live deploy |
| L-03 | P2 | **Renewal charges from a stale list** | `due` is read once (`renewal.job.ts:76-85`) and charged sequentially with network calls that have no timeout. A cancellation or payment during the loop is not re-checked | timing |
| L-04 | P2 | **Duplicate sales from client retries** | POS online submit has no idempotency and no axios timeout (`api/client.ts:5`); offline replay runs from `localStorage`, shared by tabs, on every `online` event (`POS.tsx:122-145`); Redis recovery releases hung requests next to their retries (DB-09) | client and network behaviour not exercised end to end |
| L-05 | P3 | **Tenant cache stale write-back** | GET miss → DB read → SETEX (`tenant.middleware.ts:63-74`), racing an admin suspend + DEL. The old `ACTIVE` row can be written back for 300 s | the window is the duration of one DB read |
| L-06 | P3 | **Refresh rotation race** (HSEC-10) | GET (`auth.service.ts:101-105`), then DEL + SET (`:107-120`): two refreshes with one token both succeed | Redis-level race, not exercised |
| L-07 | P3 | **Owner-less job-lock release** | DEL without a value check (`lock.ts:22`); a cycle that overruns its TTL deletes the next holder's lock | needs a > 25 min cycle |
| L-08 | P3 | **Plan limits exceeded under concurrency** | count, then create (`limit.middleware.ts:23-75`) | not exercised |
| L-09 | P3 | **Sale vs return deadlock for one customer** | sale locks customer → stock; return locks stock → customer (§11) | same mechanism as S17, not run for this pair |
| L-10 | P3 | **Reactivated `CANCELLED` tenants run on an old schema** | the sweep selects `ACTIVE` + `SUSPENDED` only (`migrate-tenants.ts:125-127`); admin reactivation doesn't migrate | needs a schema change while the tenant is cancelled |

---

## 35. Potential Findings

| ID | Sev. | Finding | Basis |
|---|---|---|---|
| P-01 | P2 | **FAILED then SUCCESS for the same transaction id drops the payment.** B5: the success hits P2002 and is ignored; the subscription stays `PAST_DUE` | DB behaviour confirmed; whether Paymob ever re-reports one id with a new outcome is UNVERIFIED (U-03) |
| P-02 | P3 | **Webhook and checkout update an arbitrary subscription** when a tenant has several (unordered `findFirst`, `billing.service.ts:96-99,131,210`; `tenant_id` not unique), while the gate reads the newest | only one subscription per tenant is created today |
| P-03 | P3 | **Migration TOCTOU**: pending files computed before the advisory lock (`migrate-tenants.ts:58-63` vs `:76`) | not observed (M3, 4 trials) |
| P-04 | P3 | **`tenant_settings` singleton not enforced** (`findFirst()`; ETA `CROSS JOIN … LIMIT 1`) | only reachable if a second row is ever inserted |
| P-05 | P3 | **Reports mix READ COMMITTED snapshots** (independent queries) | cosmetic, during concurrent writes |
| P-06 | P3 | **A return restock with no stock row** logs a movement that changes nothing (`invoice.service.ts:638-651`, `updateMany` count ignored) | needs a deleted or missing stock row |
| P-07 | P3 | **Provisioning rollback leaves the Redis tenant cache and the LRU client** for the dropped schema (≤ 300 s / 30 min) | needs a request between ACTIVE and the rollback |
| P-08 | P3 | **`approveContract` pool self-deadlock**: 5 concurrent approvals each hold one connection and wait for a second (base client, DB-28) until the 5 s timeout | needs 5 simultaneous approvals in one tenant |
| P-09 | P3 | **ETA double submission** after a crash between acceptance and the status update | moot until DB-23 is fixed; ETA's dedupe is UNVERIFIED |
| P-10 | P3 | **A negative credit balance becomes a negative discount**: `creditUsed = min(requested, negative balance)` (`invoice.service.ts:263`) → `totalAmount` *increases* and the balance stays negative | API-only (the POS sends credit only when positive); follows DB-02 |

---

## 36. Unverified Items

| ID | Item | Needed to verify |
|---|---|---|
| U-01 | Production schema state per tenant: `schema_version`, whether 016's constraints exist, existing rows violating the NOT VALID CHECKs, any out-of-band column changes | read-only queries on production (the detection queries in §38) |
| U-02 | **Existing damage** from the races above (negative balances, duplicate schedules, over-receipts, double cancellations, double charges) | the same read-only queries |
| U-03 | Paymob behaviour: callbacks for token charges, a transaction id changing outcome, TOKEN callbacks, retry policy, idempotency on `merchant_order_id` | Paymob documentation or sandbox |
| U-04 | Production Postgres and Redis configuration (`max_connections`, timeouts, Redis persistence and `maxmemory-policy`) and the number of concurrently active tenants | server access |
| U-05 | Whether the UI offers checkout to `ACTIVE` subscriptions (affects how often DB-08 triggers) | UI walkthrough |
| U-06 | PostgreSQL 16 (production) vs 18.3 (harness): READ COMMITTED re-evaluation, deadlock detection and NOT VALID CHECK enforcement are the same in both; timings will differ | a run on 16 |
| U-07 | Real network latency: windows measured on localhost (S7 ~10 ms, S16 ~5 ms) are lower bounds | a staging run |

---

## 37. Remediation Priority

Ordered by severity, then by how much one change fixes. No fix was applied in this phase.

| Priority | Items | Change |
|---|---|---|
| **P0: before the next release** | DB-01 | Whitelist invoice transitions in the UPDATE; reverse recorded movements, not invoice lines; block cancel and return for invoices that have a contract (route through the contract); approve only a `pending` invoice. First, run the §38 detection queries on production to size existing damage (U-02) |
| **P1: next sprint** | DB-03, DB-04, DB-05, DB-06, DB-07 (and DB-11, DB-13, DB-27 with the same change) | **One pattern everywhere:** the first statement of each transaction is a conditional transition (`updateMany({ where: { id, status: expected } })`, require count 1, else 409), or a `SELECT … FOR UPDATE` on the parent row followed by re-reading caps inside the tx. Add `UNIQUE (contract_id, installment_number)` |
| | DB-02 (and DB-15, DB-16, DB-17, DB-14) | Bound every balance change in its UPDATE (`WHERE credit_balance >= x`; `paid_amount + x <= total`); use `increment` / `decrement`, never an absolute SET; add `CHECK` constraints (`credit_balance >= 0`, `loyalty_points >= 0`, `received_quantity <= quantity`, `paid_amount <= total_amount`) as `NOT VALID`, clean up, then `VALIDATE` |
| | DB-08 (with DB-19, DB-25, DB-37, L-01, L-03) | Dunning only when `current_period_end <= now` and `cancel_at_period_end = false`; separate renewal-failure and checkout-decline counters; conditional trial-expiry update; extend periods from `max(now, current_period_end)`; write a pending payment row per billing period before charging and use its id as `merchant_order_id`; refuse a second charge for the same period |
| | DB-09 | Separate Redis connections (BullMQ `null` retries; app fail-fast with `commandTimeout`); cache errors become cache misses; rate limiter `skipOnError` |
| | DB-10 (with L-04) | `Idempotency-Key` on sale, payment, return, receipt and approval routes, stored in a unique table inside the same transaction; the POS generates one key per cart and replays with it |
| **P2: plan** | DB-18 | Sort locked rows by id in every multi-row path; bounded retry on `40P01` / `40001` / `P2034`; map these errors to a 409 or 503 instead of 500 |
| | DB-12 | `FOR UPDATE` on the variant before computing WAC |
| | DB-20, DB-31, DB-29 | PgBouncer (transaction mode) or lower pool limits; role-level `lock_timeout` and `statement_timeout`; graceful LRU disposal |
| | DB-21, L-02, L-10 | Version bump inside the DDL transaction; idempotent DDL; migrate before `listen` (or gate each tenant until migrated); include reactivated tenants |
| | DB-22 | Resumable provisioning plus a sweeper |
| | DB-23, DB-33, DB-34 | Replace raw SQL with Prisma calls where possible; add a CI job that migrates a scratch schema, runs `EXPLAIN` on every raw statement and fails on a non-empty `prisma migrate diff` |
| **P3: backlog** | DB-24, DB-26, DB-28, DB-30, DB-32, DB-35, DB-36, DB-38, L-05..L-09, P-01..P-10 | Each item's remediation field |

---

## 38. Required Regression Tests

**Harness template.** This audit's approach is suitable for CI:
- an ephemeral PostgreSQL (Testcontainers or `initdb` in CI) migrated with the repo's own runner;
- the real services called concurrently with `Promise.allSettled`;
- N trials for each race;
- invariants checked against the serial result;
- the invariant queries below run after every test.

| ID | Covers | Test | Pass condition |
|---|---|---|---|
| RT-D01 | DB-01 | cancel a pending installment invoice | 409; stock and movements unchanged |
| RT-D02 | DB-01 | return a pending installment invoice | 409; no credit issued |
| RT-D03 | DB-01 / FIN-04 | cancel the invoice, then approve its contract | approval rejected; invoice stays `cancelled` |
| RT-D04 | DB-02 | credit 1,000; 2 × 700 concurrently (20 trials) | exactly one succeeds; balance 300; never < 0 |
| RT-D05 | DB-03 | double approve (20 trials) | one success; exactly N rows; stock −qty once |
| RT-D06 | DB-04 | approve ∥ reject, simultaneous and staggered 0–20 ms | exactly one succeeds; final state consistent (`active` + rows + stock out, or `cancelled` + no rows + stock intact) |
| RT-D07 | DB-05 | double cancel | one success; stock, credit, points and coupon restored once |
| RT-D08 | DB-06 | return ∥ return; return ∥ cancel | Σ returned ≤ sold; refund ≤ paid; stock restored ≤ sold |
| RT-D09 | DB-07 | double "receive all" | received ≤ ordered; supplier liability added once |
| RT-D10 | DB-08 | paid `ACTIVE` subscription + one decline; cancel-scheduled `PAST_DUE` | the dunning selection returns neither; no charge request sent (fake Paymob) |
| RT-D11 | DB-09 | Redis unreachable | tenant request answers from the DB or fails in < 1 s; webhook responds |
| RT-D12 | DB-10 | same `Idempotency-Key` twice, sequential and concurrent | one invoice; the second call returns the first response |
| RT-D13 | DB-11 | double transfer approval; approve ∥ reject | stock moved once; final status consistent with stock |
| RT-D14 | DB-12 | concurrent receipts of one variant | `cost_price` equals the serial WAC |
| RT-D15 | DB-13 | double work-order invoice | one invoice |
| RT-D16 | DB-14 | concurrent WO payments; payment above total | sum preserved; above-total rejected |
| RT-D17 | DB-15 | manual credit ∥ sale (stagger sweep 0–40 ms) | final = initial + adjustment − spend |
| RT-D18 | DB-16 | two full PO payments | `paid_amount` ≤ total; one rejected |
| RT-D19 | DB-17 | earn, redeem, cancel the earning sale | `loyalty_points` ≥ 0; shortfall recorded |
| RT-D20 | DB-18 | 40 pairs of opposite-order multi-line sales | 0 deadlock errors |
| RT-D21 | DB-19 | trial-expiry selection → payment → trial-expiry update | stays `ACTIVE`, `failed_attempts` 0 |
| RT-D22 | DB-20 | load test: N busy tenants | no `too many clients`; graceful queueing |
| RT-D23 | DB-21 | kill between DDL and version bump, then re-run; re-run every file on a migrated schema | next run succeeds; every file idempotent or guarded |
| RT-D24 | DB-22 | SIGKILL during provisioning | retry succeeds or the sweeper cleans up; subdomain reusable |
| RT-D25 | DB-23, DB-33 | EXPLAIN every raw SQL statement against a migrated schema | no `42703` |
| RT-D26 | DB-24 | two declines concurrently | `failed_attempts` +2 |
| RT-D27 | DB-25 | success for a `CANCELLED` subscription; early renewal | follows the written policy; period extends from `max(now, end)` |
| RT-D28 | DB-26 | two reminder cycles at once | one reminder per payment per day |
| RT-D29 | DB-27 | same installment row paid twice | second rejected |
| RT-D30 | DB-28 | approve response | shows `active` and N payments |
| RT-D31 | DB-29 | evict a client during its transaction | the transaction completes |
| RT-D32 | DB-30 | cancel with 1M customer audit rows | < 1 s |
| RT-D33 | DB-32 | record an installment payment with a method | `payment_method_id` stored |
| RT-D34 | DB-34 | `prisma migrate diff` against a migrated template schema | empty diff |
| RT-D35 | DB-35 | delete a used coupon; delete an admin | blocked or soft-deleted; history kept |
| RT-D36 | DB-36 | invoice a cancelled work order | 409 |
| RT-D37 | DB-37 | 7 declined checkouts during a trial | no suspension |
| RT-D38 | DB-31 | a 7 s row lock during sales | clear lock-timeout errors after the configured limit; other tenants unaffected |
| RT-D39 | L-01 | fake Paymob: charge succeeds, then the DB write fails, then the job retries | exactly one charge request per billing period |
| RT-D40 | all | invariant queries below, after every concurrency test | all return 0 rows |

**Detection and invariant queries** (read-only; per tenant schema unless marked master). Run them on production to answer U-01 and U-02 before or alongside remediation:

```sql
-- balances
SELECT id, credit_balance FROM customers WHERE credit_balance < 0;
SELECT id, loyalty_points FROM customers WHERE loyalty_points < 0;
-- duplicate installment schedules (DB-03)
SELECT contract_id, installment_number, count(*) FROM installment_payments GROUP BY 1, 2 HAVING count(*) > 1;
-- cancelled contracts that still have schedule rows (DB-04)
SELECT c.id FROM installment_contracts c WHERE c.status = 'cancelled' AND EXISTS (SELECT 1 FROM installment_payments p WHERE p.contract_id = c.id);
-- over-receipt and overpayment (DB-07, DB-16)
SELECT id, order_id, quantity, received_quantity FROM purchase_order_items WHERE received_quantity > quantity;
SELECT id, total_amount, paid_amount FROM purchase_orders WHERE paid_amount > total_amount;
-- double cancellations (DB-05)
SELECT entity_id, count(*) FROM audit_logs WHERE entity = 'invoice' AND action = 'cancel' GROUP BY 1 HAVING count(*) > 1;
-- returns exceeding the sold quantity (DB-06)
SELECT r.invoice_id, ri.variant_id, sum(ri.quantity) AS returned,
       (SELECT sum(ii.quantity) FROM invoice_items ii WHERE ii.invoice_id = r.invoice_id AND ii.variant_id = ri.variant_id) AS sold
  FROM returns r JOIN return_items ri ON ri.return_id = r.id
 GROUP BY 1, 2 HAVING sum(ri.quantity) > (SELECT sum(ii.quantity) FROM invoice_items ii WHERE ii.invoice_id = r.invoice_id AND ii.variant_id = ri.variant_id);
-- pending installment invoices that were cancelled (DB-01 phantom restock)
SELECT i.id FROM invoices i JOIN installment_contracts c ON c.invoice_id = i.id
 WHERE EXISTS (SELECT 1 FROM stock_movements m WHERE m.reference = i.id::text AND m.type = 'cancellation');
-- transfers moved more than once (DB-11)
SELECT reference, count(*) FROM stock_movements WHERE type = 'transfer' GROUP BY reference
HAVING count(*) > 2 * (SELECT count(*) FROM stock_transfer_items t WHERE t.transfer_id::text = reference);
-- work orders invoiced more than once (DB-13; notes carry the ticket number)
SELECT notes, count(*) FROM invoices WHERE notes LIKE 'طلب عمل:%' GROUP BY notes HAVING count(*) > 1;
-- NOT VALID CHECK violations (016)
SELECT id FROM stock WHERE quantity < 0 OR min_quantity < 0;
SELECT conname, convalidated FROM pg_constraint WHERE contype = 'c' AND connamespace = current_schema()::regnamespace;

-- master: dunning would charge these paid or cancel-scheduled subscriptions (DB-08)
SELECT id, tenant_id, status, current_period_end, cancel_at_period_end FROM subscriptions
 WHERE status IN ('ACTIVE','PAST_DUE','SUSPENDED') AND failed_attempts > 0 AND provider_card_token IS NOT NULL
   AND (current_period_end > now() OR cancel_at_period_end);
-- master: more than one successful charge per subscription per month (possible double charges)
SELECT subscription_id, date_trunc('month', attempted_at) AS m, count(*) FROM payment_attempts
 WHERE status = 'SUCCESS' GROUP BY 1, 2 HAVING count(*) > 1;
-- master: orphan provisioning (DB-22)
SELECT id, subdomain, schema_version, created_at FROM tenants WHERE status = 'PROVISIONING' AND created_at < now() - interval '1 hour';
-- master: tenants behind the latest migration (DB-21, L-10)
SELECT subdomain, status, schema_version FROM tenants WHERE schema_version < 17;
```

These queries were run against the throwaway database after the harness. Every one parsed, and each flagged the damage the harness had produced through application code:

| Query | Rows flagged |
|---|---|
| Negative credit | 24 |
| Negative loyalty | 1 |
| Duplicate schedules | 15 |
| Cancelled contracts with schedule rows | 4 |
| Over-received PO lines | 2 |
| Overpaid POs | 3 |
| Double cancellations | 5 |
| Over-returns | 5 |
| Cancelled pending installment invoices | 1 |
| Transfers moved twice | 1 |
| Work orders invoiced twice | 3 |
| Negative stock | **0** (the CHECK held) |
| Dunning targets that are paid or cancel-scheduled | 3 |
| Orphan provisioning tenants | 1 |

They are therefore known to work, and are safe to run read-only in production.

---

## 39. Evidence Ledger

### 39.1 Runtime scenarios

All runs used the throwaway cluster, the repo's real code and fresh fixtures. Raw outputs are in the session scratchpad (`scratchpad/phase4/out-*.txt`). They are not part of the repository.

| ID | Code under test | What ran | Result | Output |
|---|---|---|---|---|
| S1 | `invoice.service.createInvoice` | credit 1,000, 2 × 700 concurrent, 5 + 20 trials | balance −400 in 4/5 and 20/20 | out-core-1, out-core-S1x20 |
| S2 | same | loyalty 1,000, 2 × 700; earning on, then off | on: both ok, 2,200 (serial-equivalent); off: 1 ok, 1 `insufficient_loyalty_points`, 300 (5/5) | out-core-1, out-core-2 |
| S3 | same | stock 1, two sales | 1 ok, 1 `insufficient_stock` (5/5) | out-core-1 |
| S4 | same | coupon with 1 use left | 1 ok, 1 `coupon_exhausted` (5/5) | out-core-1 |
| S5 | `installment.service.recordPayment` | same row twice | both ok; 2 audit rows (5/5) | out-core-3 |
| S5b | same | last two rows concurrently, 20 trials | `ok + previous_installments_not_paid` 20/20 | out-core-S5b |
| S6 | `approveContract` | double approve | 6 rows / 3; stock −2 (5/5) | out-core-3 |
| S7 | `approveContract` ∥ `rejectContract` | simultaneous; reject launched first; reject +4/8/12/16 ms | lost reject (both ok, `active`) in 7/8; `cancelled` with rows + stock out at +4–8 ms (4/6) | out-core-S7 |
| S8 | `cancelInvoice` | double cancel (credit + coupon) | stock 12/10, credit 200/100, coupon 4/5 (5/5) | out-core-3 |
| S9 | `returnInvoice` | two full returns | stock 12/10, credit 1,000/500, 2 returns (5/5) | out-core-3 |
| S10 | return ∥ cancel | simultaneous | stock 12/10, `cancelled` + credit 500 (5/5) | out-core-3 |
| S11 | cancel a pending installment invoice, then approve | sequential | stock 5 → 6 → 5; invoice `cancelled` → `completed`, paid 0 | out-core-3 |
| S11b | return a pending installment invoice | sequential | stock 5 → 6; credit 1,000 | out-core-4 |
| S12 | `stock.service.approveTransfer` | double approve, ample and exact stock | ample: 4 movements, source 4/7, destination 6/3; exact: second fails `23514` | out-core-3 |
| S13 | `po.routes` receive (real plugin via inject) | double "receive all" | received 20/10, balance 4,000/2,000 (2/3) | out-routes |
| S13b | same | two POs, same variant | cost 250.0000 vs 233.3333 (3/3) | out-routes |
| S14 | `workOrder.routes` invoice | double create | 2 invoices (3/3) | out-routes |
| S15 | `workOrder.routes` payment | 2 × 100 | paid 100 (3/3) | out-routes |
| S16 | `customer.routes` credit ∥ sale | stagger 0–40 ms | 1,050 vs 350 once (+5 ms) | out-routes, out-routes-S16 |
| S16b | `po.routes` payments | 2 × full amount | paid 2,000 / 1,000 (3/3) | out-routes |
| S17 | `createInvoice` | 40 pairs, opposite item order | 39 deadlock aborts (`40P01`); stock consistent | out-core-S17; `pg.log` |
| S19 | `approveContract` return value | single call | returned `pending_approval` / 0 payments vs committed `active` / 4 | out-core-3 |
| S20 | earn → redeem → cancel | sequential | loyalty −1,000 | out-core-4 |
| B1 | `billing.handleWebhookSuccess` | same txn id twice concurrently | 1 attempt; `ACTIVE` | out-billing |
| B2 | `handleWebhookFailure` | two declines concurrently | `failedAttempts` 3 / 4 | out-billing |
| B3 | success for a `CANCELLED` subscription | sequential | `ACTIVE`, `cancelledAt` kept | out-billing |
| B4 | paid `ACTIVE` subscription + one decline | dunning WHERE clause (verbatim replica) | selected (25 days left) | out-billing |
| B5 | same txn: FAILED then SUCCESS | sequential | success dropped; `PAST_DUE` | out-billing |
| B6 | trial-expiry statements (replica) around a real success | interleaved | `PAST_DUE`, `failedAttempts` 1, dunning target | out-billing |
| B7 | `cancelSubscription` on a `PAST_DUE` subscription with a card | then dunning WHERE | still selected | out-billing |
| B8 | `runReminderCycle` × 2 concurrently | real job function | 2 reminder rows | out-billing |
| M1 | each tenant migration file re-run in a rolled-back tx | 17 files | 001, 002, 016 fail; others OK | out-migrate-1 |
| M2 | `runTenantMigrations` after the version is forced 17 → 15 | real runner + `migrateAllTenants` | `42710`; version stays 15; `{ ok: 0, failed: 1 }` | out-migrate-1 |
| M3 | two runners concurrently, ×4 | real runner | lock serialised (skip + apply) 4/4 | out-migrate-1 |
| M4 | `provisionTenant` with a stray table in the target schema | real function | compensated: row and schema removed | out-migrate-2 |
| M5 | two concurrent signups, same subdomain | real function | 1 ok, 1 `subdomain_taken` | out-migrate-2 |
| M6 | SIGKILL of the provisioning process group | real function in a child process | `PROVISIONING` v3, 39 tables; retry `subdomain_taken`; not swept | out-migrate-3 |
| P1-run | 7 s row lock + 8 concurrent sales | app tenant client (limit 5) | 8/8 failed (5 expired, 3 not started); atomic | out-perf-1 |
| P2-run | cancel with 50k / 200k / 600k audit rows | `cancelInvoice` | 0.37 s / 1.43 s / 5.10 s → P2028 | out-perf-2 |
| P3-run | LRU eviction during a transaction | `getTenantDb` × 50 | "Transaction not found … before disconnecting"; rolled back | out-perf-3 |
| P4-run | 22 tenant clients × 5 queries | `getTenantDb` | 17/110 `too many clients already` | out-perf-1 |
| Redis | ioredis against a closed port | 3 option sets | app options pending > 4 s; `maxRetriesPerRequest: 1` rejects in 54 ms | `redis-outage.cjs` |
| Drift | `prisma migrate diff` (read-only) | master, tenant | master ≈ none; tenant 722 lines | drift-*.sql |
| SQL | `EXPLAIN` of ETA and statement SQL | migrated schema | 6 statements fail with `42703`, 1 OK | §3 |
| Seq | `nextval` in a rolled-back tx | psql | 154 consumed; next 155 | §19 |
| Detection | §38 queries | throwaway DB | all parse; counts in §38 | — |
| Unit tests | existing API suite (`vitest run`) | 10 files | **61 / 61 passed** | out-vitest |

### 39.2 Static evidence

| # | Claim | Location |
|---|---|---|
| E4-01 | Prisma interactive-tx defaults `maxWait` 2000 ms, `timeout` 5000 ms, isolation unset | `node_modules/.pnpm/@prisma+client@5.22.0…/runtime/library.js` (`maxWait:…??2e3,timeout:…??5e3,isolationLevel:…`) |
| E4-02 | No `FOR UPDATE`, isolation level or advisory lock in app code | grep over `apps/api/src`, `packages/database/src` |
| E4-03 | 22 `$transaction` sites, none with options | §5 list |
| E4-04 | Shared Redis client with `maxRetriesPerRequest: null` | `apps/api/src/config/redis.ts:4-7`; ioredis `event_handler.js:198-210` |
| E4-05 | Tenant client LRU 50 × 5, `$disconnect` on dispose | `apps/api/src/config/database.ts:16-42` |
| E4-06 | Listen before migrating; `/health` 503 only when all tenants fail | `apps/api/src/index.ts:472,484-498,166-175` |
| E4-07 | Version bump outside the per-file tx; pending computed before the lock | `packages/database/src/migrate-tenants.ts:58-63,76,95-107` |
| E4-08 | Provisioning steps and catch | `apps/api/src/modules/tenants/tenant.service.ts:192-286` (seed `:92-188`) |
| E4-09 | Credit pre-read and unconditional decrement | `invoice.service.ts:258-265,313-320` |
| E4-10 | Conditional loyalty, stock and coupon updates | `invoice.service.ts:326-334,364-375,409-417` |
| E4-11 | Return cap read outside the tx | `invoice.service.ts:579-602,616` |
| E4-12 | Cancel checks outside the tx; unconditional reversals; audit scan | `invoice.service.ts:697-712,716-848,747-753` |
| E4-13 | Approve / reject unconditional; base client in the tx | `installment.service.ts:319-332,396-399,412-422` |
| E4-14 | `recordPayment` ordering check; no contract-status check | `installment.service.ts:444-478` |
| E4-15 | Transfer availability outside the tx; unconditional decrement | `stock.service.ts:224-259` |
| E4-16 | PO receive outstanding outside the tx; WAC unlocked | `po.routes.ts:238-285,299-319` |
| E4-17 | PO payment remaining outside the tx | `po.routes.ts:410-449` |
| E4-18 | WO invoice pre-check / unconditional link; WO payment absolute SET | `workOrder.routes.ts:400-411,510,546-557` |
| E4-19 | Manual credit absolute SET | `customer.routes.ts:128-143` |
| E4-20 | Webhook idempotency; dispatch | `billing.service.ts:144-181,224-257`; `billing.routes.ts:42-57` |
| E4-21 | Failure thresholds; absolute `failedAttempts` | `billing.service.ts:210-251` |
| E4-22 | Success resets period / status | `billing.service.ts:134-138,158-173` |
| E4-23 | Dunning selection | `jobs/dunning.job.ts:74-81` |
| E4-24 | Renewal selection, `Date.now()` order ids, retry | `jobs/renewal.job.ts:19-20,76-85,101,159-174` |
| E4-25 | Trial expiry unconditional update | `jobs/trial-expiry.job.ts:115-135` |
| E4-26 | Reminder dedupe; manual trigger outside the lock | `jobs/installment-reminders.job.ts:119-154`; `installment.routes.ts:216-224` |
| E4-27 | Owner-less lock release | `shared/utils/lock.ts:17-23` |
| E4-28 | Cache-aside tenant cache and subscription gate | `shared/middleware/tenant.middleware.ts:60-113` |
| E4-29 | Refresh rotation GET / DEL / SET | `modules/auth/auth.service.ts:101-120` |
| E4-30 | POS queue / replay; no client id; axios without timeout | `apps/web/src/pages/pos/POS.tsx:116-145,307-336`; `apps/web/src/api/client.ts:5` |
| E4-31 | CHECKs NOT VALID; no CHECK on credit or loyalty | `migrations/tenant/016_check_constraints.sql:18-41`; `002_full_schema.sql:177-189` |
| E4-32 | No unique on `(contract_id, installment_number)` | `002_full_schema.sql:358-371` |
| E4-33 | Partial unique `work_orders.invoice_id` | `013_work_order_invoice.sql` |
| E4-34 | Coupon hard delete; `coupon_id` SET NULL | `coupon.routes.ts:89-92`; `002_full_schema.sql:244` |
| E4-35 | Platform audit cascade | `prisma/migrations/20260517120000_add_platform_admin/migration.sql:31` |
| E4-36 | Production Postgres defaults; single app container | `docker-compose.prod.yml` |
| E4-37 | Fastify created without request or connection timeouts | `apps/api/src/index.ts:42` |

---

## Closing statement

| Item | Answer |
|---|---|
| **Source files modified** | **NO.** `git status` is the same as at the start of the session: the two pre-existing user modifications (`AppShell.tsx`, `POS.tsx`, untouched) and untracked `documents/`. Only this report was added, under `documents/audit/`. |
| **Database modified** | **NO** for every project, local-Docker, VPS and production database. A **disposable PostgreSQL 18.3 cluster** was created by this audit inside the session scratchpad (127.0.0.1, random port, no Unix socket, generated password), used for the reproductions above, then **stopped and deleted** (`pgdata` removed; password file removed). |
| **Production accessed** | **NO.** No connection to hesbaapp.com, the VPS or its database; the repo's `.env` values were never loaded (every key was pre-set to local dummy values, and the harness refused to run unless connected to the scratchpad cluster). |
| **External services accessed** | **NO application service** (Paymob, Resend, ETA, R2 and Sentry were never called; their URLs pointed at a closed local port; Redis was a local in-memory fake). **Disclosure:** `prisma migrate diff` performed the Prisma CLI's default anonymous update check against `checkpoint.prisma.io` (its cache file `~/Library/Caches/checkpoint-nodejs/prisma-f37efbe3` was refreshed at 16:46). That payload contains CLI/OS/Node versions and hashed paths, no schema, data or credentials. |
| **Tests executed** | existing API suite (`vitest run`: 10 files, **61 / 61 passed**); ~45 harness scenarios (§39.1) against the throwaway cluster; `prisma migrate diff` (read-only introspection); `EXPLAIN` of raw SQL; the §38 detection queries; one isolated ioredis outage experiment. |
| **Temporary files created** | session scratchpad only (`/private/tmp/claude-502/…/scratchpad/phase4/`): harness scripts (`guard.ts`, `fixtures.ts`, `setup.ts`, `scen-core.ts`, `scen-routes.ts`, `scen-billing.ts`, `scen-migrate.ts`, `scen-perf.ts`, `fake-redis.cjs`, `redis-outage.cjs`), `env.sh` (password redacted), outputs (`out-*.txt`, `drift-*.sql`, `detection*.sql`, logs). Deleted: `pgdata/`, `pgpass.txt`. |
| **New report path** | `documents/audit/Hesba_Phase4_Database_Concurrency_Audit.md` |

*End of Phase 4. No code, migration or persistent data was changed; every reproduction ran against a disposable local database that no longer exists.*
