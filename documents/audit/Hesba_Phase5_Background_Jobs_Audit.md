# Hesba Phase 5 — Background Jobs, Async Processing & Failure Recovery Audit

| | |
|---|---|
| Date | 2026-10-08 |
| Code under review | branch `claude/ui-pos-merge-split` @ `8846bce` (same tree as Phases 1–4.5; the two modified UI files are unrelated to jobs) |
| Inputs | Phase 1, 2, 3, 4 and 4.5 reports in `documents/audit/`; the repository; installed libraries (`bullmq` 5.76.6, `ioredis` 5.10.1, `resend` 3.5.0, Prisma 5.22.0, Node `fetch`/undici) |
| Method | Full inventory by search (not by file name); code reading of every producer, worker and handler; library source reading for the behaviours that matter; **runtime experiments with the real application code** (job modules, `billing.service`, real `index.ts`) against throwaway PostgreSQL 16 and Redis 7 containers and a local mock Paymob/Resend |
| Safety | read-only on the repository; no production or production Redis access; every outbound `fetch` to a non-loopback host was blocked in the harness; every key from the repo `.env` was overridden with throwaway values |

**Finding IDs.** New Phase 5 findings are **BG-01 … BG-15**. Earlier IDs (DB-xx, FIN-xx, HSEC-xx, RC-xx) are reused when Phase 5 re-confirms them. Runtime scenarios are named **S-F, S-A … S-I, R1 … R5, X1 … X6** and listed in §43.

---

## 1. Executive Summary

**The question:** can an async failure or retry create duplicate, missing, stale or financially incorrect state?

**Yes. Phase 5 reproduced it at runtime, with the real job code and the real BullMQ worker, in eleven distinct ways.** Five of them take a customer's card twice for one billing period, or after they cancelled.

| # | What happens | Evidence | ID |
|---|---|---|---|
| 1 | A renewal or dunning charge succeeds at Paymob, then anything fails before the DB write (lost response, PostgreSQL error, crash, SIGTERM). BullMQ retries, or the next daily run starts, and **the same card is charged again**. Only one `payment_attempts` row exists. | S-F, X3, X5, X6: 2 gateway charges, 1 row, every time | **BG-01** (P1, confirms FIN-L1) |
| 2 | A worker crash or a SIGTERM during a cycle leaves the app's own Redis lock (`lock:<job>-cycle`, 10–25 min TTL) behind. BullMQ correctly recovers the stalled job, but the re-run sees the lock, logs "another instance holds the lock — skipping", and **completes having done nothing**. Remaining tenants are skipped until tomorrow, and the job record is deleted (`removeOnComplete: true`). | X5 (SIGKILL), X6 (real `index.ts` + SIGTERM) | **BG-02** (P2) |
| 3 | The billing jobs charge or overwrite from a list read once at the start of the cycle. Payments, cancellations and admin actions that land mid-cycle are ignored or overwritten. | S-A, S-B, S-D1, S-D2, S-D3, S-H | **BG-03** (P1; DB-19, DB-L03 and DB-08 confirmed end-to-end) |
| 4 | Outbound `fetch` has no app timeout; Node's default is about 300 s. One silent Paymob call holds the single-concurrency worker; the next day's job waits behind it. The 25 s shutdown budget is shorter than the hang, so a deploy then turns into item 2. | X4, X6 | **BG-04** (P2, confirms B-07) |
| 5 | `resend@3.5.0` never throws; it resolves `{ error }`. Every email failure in jobs is **silent**. The reminder job still writes its "sent" dedupe row (suppressing the retry for 24 h), and the trial job still bumps its counter. Every email `.catch(...)` handler in the code is dead. | R2: HTTP 500 → `sent: 4`, delivered 0, rerun `skippedRecentlyReminded: 4` | **BG-05** (P2) |
| 6 | Any tenant user with `installments:update` runs the **all-tenant** reminder cycle outside the job lock. Running it alongside the cron sends duplicates. | R1, R3: 8 emails for 4 reminders | HSEC-05 / DB-26 re-confirmed |
| 7 | ETA: no per-invoice dedupe, so two resubmits run concurrently. The worker never checks invoice status (a cancelled invoice is queued). A permanent schema error is retried as transient 5 times over about 1 h 13 m. | X7 | **BG-08** (P2; moot while DB-23 stands) |

**What is safe (verified at runtime):**
- The same webhook delivered twice, concurrently or sequentially (S-E), and the dunning charge's own webhook racing the job's own write (S-C): one row and one email, thanks to `UNIQUE(provider_transaction_id)` plus P2002 handling.
- A cycle retry never re-charges tenants already handled in the failed attempt, because the selection predicates exclude them (S-F: T2 and T3 untouched).
- Repeatable-job registration is idempotent across concurrent instances and restarts (X8).
- One tenant's broken schema does not stop the reminder cycle for other tenants (R1: `errors: 1`, the other tenants processed).
- A Redis outage at boot blocks but recovers on its own (X1).
- A Redis freeze mid-job causes a **re-execution** (true at-least-once, X2). The re-run is harmless only because the first run had already written the DB state.

**The answer to "is exactly-once assumed anywhere?": yes, in exactly the places that touch money.**
- `renewal.job.ts` and `dunning.job.ts` treat "the charge call returned" and "the DB write succeeded" as one step.
- `withLock` is treated as if it recorded progress. It doesn't: a crash leaves it held, and recovery is suppressed (BG-02).
- The webhook path is the only billing path designed for at-least-once delivery, and it is correct.

**Root cause.** Phase 5 adds no new root cause. Every new finding maps onto Phase 4.5's clusters:
- **RC-06** (no payment intent per period): BG-01, BG-03, BG-11
- **RC-01** (stale selection, then an unconditional write): BG-03, BG-06
- **RC-08** (unbounded waits): BG-04, BG-09
- **RC-07** (no durable step record): BG-02, BG-10, BG-12, BG-13
- **RC-05** (no idempotency): BG-01, BG-08
- **RC-02** (implicit state model): BG-07, BG-08
- **Independent**: BG-05 (library misuse), BG-14, BG-15

**The single most valuable change.** Introduce the durable per-period charge record that RC-06 already calls for (§14), written **before** Paymob is called and consulted **before** any retry. That one table closes BG-01, the double-charge halves of BG-03, and BG-02's next-day re-charge.

**Severity totals for new IDs:**

| Severity | Count | IDs |
|---|---|---|
| P1 | 2 | BG-01, BG-03 |
| P2 | 5 | BG-02, BG-04, BG-05, BG-08, BG-11 |
| P3 | 8 | BG-06, BG-07, BG-09, BG-10, BG-12, BG-13, BG-14, BG-15 |

No P0. Phase 5 also raises **DB-19 from P2 to P1** (it is the first half of BG-03 scenario S-A, which ends in a second charge) and moves **DB-L03 and FIN-L1 from LIKELY to CONFIRMED**.

---

## 2. Scope

| In scope | Detail |
|---|---|
| Queues and workers | `eta-submissions`, `dunning`, `installment-reminders`, `trial-expiry`, `renewal` (all in `apps/api/src/jobs/`) |
| Indirect / hidden async work | manual reminder trigger (`installment.routes.ts:216-224`), cancel-at-period-end sweep (inside trial-expiry), boot-time tenant migration sweep (`index.ts:484`), admin "run migrations" (`admin.routes.ts:891`), provisioning migrations (`tenant.service.ts:258`), Paymob webhook (`billing.routes.ts:28-60`), `reconcilePayments` placeholder (`dunning.job.ts:168`), POS offline replay queue (client, `POS.tsx`, DB-10) |
| HTTP paths that write job-owned entities | `/billing/checkout`, `/billing/cancel`, `/billing/resume`, Paymob webhook, admin extend-trial / cancel / reactivate (`admin.routes.ts:510-640`), installment payment, ETA resubmit |
| Libraries | BullMQ 5.76.6 (worker/queue/repeat source), ioredis 5.10.1, resend 3.5.0 (`fetchRequest`), undici fetch in Node |
| Not in scope | Paymob or ETA production behaviour (unknowable without their APIs; marked UNVERIFIED where it matters); frontend except the POS offline queue's interaction with jobs |

**Search method.** Repository-wide greps for `Queue|Worker|schedule[A-Z]|setInterval|setTimeout|SIGTERM|process.on|QueueEvents|.then(|void |queueMicrotask|setImmediate`, every `sendEmail`/`send*Email` caller, every `subscription.(update|create|…)` writer, and every `migrateAllTenants`/`runTenantMigrations` caller. There are no `setInterval` timers, no `QueueEvents`, no `FlowProducer`, no job schedulers (`upsertJobScheduler`) and no other queue technology.

---

## 3. Job Inventory

| Queue | Job name | Producer | Worker | Trigger | Schedule | Retry policy | Concurrency | DB effects | External effects |
|---|---|---|---|---|---|---|---|---|---|
| `trial-expiry` | `daily-trial-expiry` (repeat key from `jobId: 'trial-expiry-daily'`) | `scheduleTrialExpiry()` at boot (`index.ts:506`) | `startTrialExpiryWorker` → `withLock('trial-expiry-cycle', 10 min)` → `runTrialExpiry` | cron | `0 6 * * *`, `tz` unset → process TZ (container: UTC) | **attempts 1** (no `defaultJobOptions.attempts`) | 1 | `subscriptions.trial_reminders_sent`; `status = PAST_DUE, failed_attempts = 1, last_failed_at, last_failure_reason`; the sweep sets `status = CANCELLED, cancelled_at, cancel_at_period_end = false` | Resend `trial_ending_soon`, `trial_expired`; Redis `DEL sub:status:*`, `tenant:*` |
| `renewal` | `daily-renewal` | `scheduleRenewal()` (`index.ts:508`) | `startRenewalWorker` → `withLock('renewal-cycle', 25 min)` → `runRenewalCycle` | cron | `0 7 * * *` | attempts 3, exponential 60 s / 120 s; **the whole cycle** is retried | 1 | via `handleWebhookSuccess/Failure`: `payment_attempts` INSERT + `subscriptions` UPDATE (array tx) | **Paymob** auth → order → payment key → token charge (4 HTTP calls); Resend `payment_succeeded`/`payment_failed`/…; Redis cache DEL |
| `dunning` | `daily-dunning` | `scheduleDunning()` (`index.ts:502`) | `startDunningWorker` → `withLock('dunning-cycle', 25 min)` → `runDunningCycle` | cron | `0 8 * * *` | attempts 3, exponential 60 s; whole cycle | 1 | as renewal | as renewal |
| `installment-reminders` | `daily-reminders` | `scheduleReminders()` (`index.ts:504`) | `startReminderWorker` → `withLock('installment-reminders-cycle', 25 min)` → `runReminderCycle` | cron | `0 9 * * *` | attempts 1 | 1 | tenant `audit_logs` INSERT `reminder_sent` | Resend reminder email to **end customers of every tenant** |
| *(no queue)* | manual reminder cycle | `POST /installments/send-reminders` (`installment.routes.ts:216-224`), permission `installments:update` | runs `runReminderCycle()` **in the HTTP request, without `withLock`** | user | — | none | per request | as above, **all tenants** | as above, all tenants |
| `eta-submissions` | `submit` | `enqueueEtaSubmission` from `POST /admin/eta/resubmit/:invoiceId` only (`eta.routes.ts:31`); **no producer on invoice creation** (E-02) | `startEtaWorker` (no lock) | user | — | attempts 5, custom backoff 30 s, 2 m, 10 m, 1 h (cumulative about 1 h 13 m; the 6 h step is never reached) | **3** | `invoices.eta_status` (`submitted` before the call; `accepted`/`rejected`/`failed` after), `eta_uuid`, `eta_long_id`, `eta_qr_data`, `eta_error`; `eta_submissions` INSERT | **ETA** OAuth + document submission |
| *(sub-step of trial-expiry)* | cancel-at-period-end sweep | `runTrialExpiry` step 3 | `sweepScheduledCancellations` (`billing.service.ts:326`) | cron 06:00 | daily | none (errors logged) | — | `subscriptions` → CANCELLED | Redis cache DEL |
| *(no queue)* | Paymob webhook | Paymob | `billingWebhookRoutes` | HTTP | — | Paymob's own re-delivery | per request | as `handleWebhook*` | Resend |
| *(no queue)* | tenant migration sweep | boot (`index.ts:484`, fire-and-forget), admin button, provisioning | `migrateAllTenants` / `runTenantMigrations` (advisory lock per schema) | boot / admin | — | none (next boot) | serial | DDL per tenant; `tenants.schema_version` | — |
| *(placeholder)* | `reconcilePayments` | **no caller** | — | — | — | — | — | none | none; logs a line (`dunning.job.ts:168-173`) |
| *(client)* | POS offline replay | browser `localStorage` | `POS.tsx` replay loop | `online` event | — | until HTTP success | per tab | `POST /invoices` | — (Phase 4 DB-10; at-least-once without an idempotency key) |

**Payloads.** Every cron job has payload `{}`. The ETA job carries `{ invoiceId, tenantId, schemaName }`. No job carries an amount, status or other mutable business value. The billing jobs read `price_at_subscription` from the DB at charge time, so a price edit between enqueue and execution cannot be applied stale. That is the correct design.

---

## 4. Queue Architecture

```
            ┌───────────── one Node process (index.ts) ───────────────┐
 HTTP ─────►│ Fastify  ──► masterDb / tenant Prisma clients            │
 Paymob ───►│   webhook ─► billing.service ─► Resend                   │
            │                                                          │
            │ 5 BullMQ Workers (all share ONE ioredis client `redis`,  │
            │   maxRetriesPerRequest:null; BullMQ duplicates it for    │
            │   each worker's blocking connection)                     │
            │   trial-expiry 06:00 ─┐                                  │
            │   renewal      07:00 ─┼─► withLock(lock:<x>-cycle, TTL)  │
            │   dunning      08:00 ─┤     └─► masterDb ─► Paymob ─► DB │
            │   reminders    09:00 ─┘           (charge BEFORE record) │
            │   eta (concurrency 3, no lock) ─► tenant DB ─► ETA       │
            └──────────────────────────────────────────────────────────┘
                     │ same Redis: BullMQ keys, job locks, tenant cache,
                     ▼ sessions, rate limiter
                   Redis 7 (prod: requirepass, RDB volume, no AOF)
```

**Properties that matter for correctness:**
1. **Every replica is also a worker.** `index.ts:500-508` starts all five workers and registers all four schedules in every API process. There is no worker/API split (A-01).
   - BullMQ guarantees that one job runs on one worker at a time.
   - Cross-instance mutual exclusion of the *cycle* comes from `withLock`, a plain `SET NX PX` with an unconditional `DEL` (no owner token, DB-L07).
2. **One cycle job processes all tenants.** There is no per-tenant or per-subscription job. A cycle that fails half-way is retried as a whole (billing) or not at all (trial, reminders).
3. **Lock and progress are both in Redis.** The BullMQ job state and the `withLock` key live in Redis, but the work's progress lives only in PostgreSQL rows that the cycle *selects*. Nothing records "charge attempted for period P". This is the gap behind BG-01 and BG-02.
4. **Shared Redis client.** The same `ioredis` instance serves BullMQ and the request path, with `maxRetriesPerRequest: null` (DB-09). For workers that setting is the correct one; it is wrong for the request path.
5. **External calls run outside transactions** (positive, Phase 4 §30), but also **before** any durable record (negative, BG-01).

---

## 5. BullMQ Configuration

Values are the **effective** values for BullMQ 5.76.6. Defaults were read from `node_modules/bullmq/dist/cjs/classes/worker.js:34` and `repeat.js`, not assumed.

| Setting | Effective value | Where set | Affects correctness? |
|---|---|---|---|
| `attempts` | renewal 3, dunning 3, ETA 5, **trial-expiry 1, reminders 1** | `defaultJobOptions` | **Yes.** Billing retries re-run the whole cycle, and with a charge-before-record design a retry can re-charge (BG-01). Trial and reminders never retry: a failed run waits a day (BG-13) |
| `backoff` | billing: exponential, base 60 s → 60 s, 120 s. ETA: custom `[30 s, 2 m, 10 m, 1 h, 6 h]` indexed by `attemptsMade-1`, so with 5 attempts only the first four are used (about 1 h 13 m in total) | `defaultJobOptions`, `settings.backoffStrategy` | Yes for billing: the 60 s gap is the window in which a late Paymob webhook could rescue the state before the retry re-charges (S-F) |
| `delay` | ETA `delay: 0`; repeat jobs delayed to the next cron tick | `queue.add` | No |
| `removeOnComplete` | billing, trial, reminders: **`true`** (deleted immediately). ETA: 7 days | `defaultJobOptions` | **Evidence only.** A billing run that silently skipped (BG-02) leaves no job record (X5: state `unknown`) |
| `removeOnFail` | billing 100 most recent, trial 100, reminders 50, ETA **never** | `defaultJobOptions` | Evidence only. ETA failed jobs accumulate without bound (BG-15) |
| `concurrency` | 1 for the four cron workers; **3 for ETA** | Worker opts / default | Yes. A single hung call blocks the cron worker (BG-04). ETA's 3 lets duplicate jobs for one invoice run in parallel (BG-08) |
| `lockDuration` | 30 000 ms (default), renewed every 15 000 ms | default | Yes. A Redis freeze or event-loop stall over 30 s loses the lock, so the job is re-executed (X2) |
| `stalledInterval` | 30 000 ms (default) | default | Recovery latency after a crash: about 30–60 s |
| `maxStalledCount` | 1 (default) | default | A job that stalls twice is failed, not retried. Stall recovery does **not** consume an attempt (X5: `attemptsMade 0` on the re-run) |
| `limiter` | none | — | No rate limit toward Paymob or ETA. Dunning could burst-charge all eligible cards in seconds; acceptable at current scale |
| `priority` | none | — | No |
| Job `timeout` | **does not exist** in BullMQ 5; no app-level timeout either | — | **Yes.** Combined with no `fetch` timeout, a job can run for 300 s or more per external call (BG-04) |
| `QueueEvents` | not used | — | No (observability only) |
| Repeatable registration | `queue.add(name, {}, { repeat: { pattern }, jobId })`. The legacy repeat API: key = md5(`name:jobId:endDate:tz:pattern`); iteration jobId = `repeat:<key>:<millis>` | `schedule*()` | Idempotent across instances and restarts (X8). **Not** idempotent across *pattern edits*: the old key stays registered (P5-P01, POTENTIAL) |
| `tz` | unset → evaluated in the process TZ. The Dockerfile sets no `TZ`, so it is UTC: 06:00–09:00 UTC = 09:00–12:00 Cairo summer time, 08:00–11:00 winter | — | Low. Affects reminder date math (BG-14) |
| Connection | shared `IORedis(REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true })`; Queue objects reuse it; each Worker duplicates it for blocking reads | `config/redis.ts` | `null` is required for workers but makes request-path commands hang (DB-09). At boot it makes `start()` block until Redis answers (X1, BG-09) |
| `Queue` instances | a **new** `Queue` per `getXQueue()` call, never closed; `enqueueEtaSubmission` creates one per request | `jobs/*.ts` | Resource leak per ETA resubmit (LIKELY, L5-03) |
| `worker.on('failed')` | only the ETA worker listens. Billing, trial and reminder workers log only `'error'` | `jobs/*.ts` | Final billing-cycle failure after 3 attempts is not logged as such (BG-15) |
| Graceful close | `worker.close()` (non-force) waits for active jobs; `index.ts` caps the total at 25 s, then `process.exit(1)` | `index.ts:516-536` | **Yes** (BG-02, X6) |

---

## 6. Idempotency

**"If this exact job runs twice, what happens?"**

The cron jobs have deterministic BullMQ ids (`repeat:<key>:<millis>`), so one *tick* cannot be enqueued twice. But a tick can still be **executed** twice: by stall recovery (X2), by the cycle retry (billing), or by the manual reminder route. And the same *business operation* recurs every day by design. So the only protection that counts is protection keyed on the business entity.

| Job | Second execution of the same tick | Protection | Source of protection | Safe? |
|---|---|---|---|---|
| trial-expiry: reminders | counter `trial_reminders_sent` already at N+1 → skipped | state check | DB row (absolute SET, idempotent) | **Safe** for duplicates. **Unsafe** for loss: the counter is bumped even when the email silently failed (BG-05) |
| trial-expiry: hard expiry | row no longer `TRIALING` → not selected | selection predicate | DB state | Safe against re-execution. **Unsafe** against concurrent writers: the update is unconditional (BG-03 S-A, S-H) |
| trial-expiry: cancel sweep | row already `CANCELLED` → not selected | selection predicate | DB state | Safe |
| renewal | subscriptions charged successfully now have `current_period_end` in the future; declined ones have `failed_attempts = 1` → both excluded. **A charge whose DB write failed is still selected** | selection predicate | DB state, written **after** the charge | **Unsafe**: re-charge (BG-01, S-F) |
| dunning | succeeded → `failed_attempts = 0` → excluded; declined → `last_failed_at = now` → the 3-day gate excludes it; **a charge whose DB write failed is still selected** | selection predicate + 3-day gate | DB state, written after the charge | **Unsafe** (BG-01) |
| reminders (cron) | `audit_logs` row `reminder_sent` within 24 h → skipped | check-then-act | DB row, written **after** the send | Safe sequentially. **Unsafe** concurrently (R3) and on crash between send and insert |
| reminders (manual route) | same function, **no lock**, all tenants | as above | — | **Unsafe** (HSEC-05, DB-26) |
| ETA | `eta_status` is overwritten to `submitted`; no check for `accepted`; no BullMQ `jobId` per invoice | none (the route refuses only `accepted` at enqueue time) | — | **Unsafe**: two jobs for one invoice run concurrently (X7). Whether ETA itself dedupes is UNVERIFIED (§27) |
| Paymob webhook | `UNIQUE(provider_transaction_id)` → P2002 → return | DB unique constraint | DB | **Safe** (S-E, S-C) |
| `handleWebhookSuccess` called by a job for a *new* transaction id | new row, state reset to `ACTIVE`, period = now + cycle | none per **period** | — | **Unsafe**: two successes for one period = two charges, one period (S-B) |

**BullMQ `jobId` is not enough here.** Two reasons:
- The billing operations are keyed by *period*, not by tick. A new tick tomorrow is a legitimate new job, and it must still not charge a period that was already charged yesterday.
- The `merchant_order_id` sent to Paymob is `sub_<tenantId>_<Date.now()>` (`renewal.job.ts:101`, `dunning.job.ts:110`). It is new on every attempt, so Paymob cannot dedupe either.

**Duplicate classes, summarised:**

| Duplicate | Possible? | How |
|---|---|---|
| duplicate DB writes | yes, benign | re-runs re-select; absolute SETs |
| **duplicate payments** | **yes** | BG-01 (retry, crash, DB failure), BG-03 (stale selection) |
| duplicate invoices / stock changes | not from jobs | no job writes invoices or stock. HTTP-side duplicates are DB-10 |
| duplicate emails | yes | R3 (reminders); S-A (a "trial expired" email to a customer who just paid, followed by a second "payment succeeded") |
| duplicate reminders | yes | R3, HSEC-05 |
| duplicate ETA submissions | yes (2 jobs, concurrency 3) | X7 |
| duplicate subscription changes | yes | S-A, S-D1, S-H (overwrites); S-B (period reset twice) |

---

## 7. Retry Safety

The question for every retryable job: attempt 1 partially succeeds, the worker throws, BullMQ retries. What does attempt 2 do?

| Job | Attempt-1 partial success | What attempt 2 does | Duplicate external effect? | Evidence |
|---|---|---|---|---|
| renewal | Paymob charged; response lost (socket reset) → `fetch` throws → `transientFailures++` → cycle throws | after 60 s, re-selects the still-unrecorded subscription; new order and new merchant id; **charges again** | **Yes**: 2 gateway charges, 1 `payment_attempts` row | S-F |
| renewal | Paymob charged; PostgreSQL refuses connections → `handleWebhookSuccess` throws | same | **Yes** | X3 |
| renewal | Paymob returns HTTP 504 after charging (gateway timeout) | same | **Yes** (same code path as S-F; the mock mode exists, not separately run) | code |
| renewal | Paymob charged; email fails | email errors are swallowed (and never thrown by Resend anyway) | no | code |
| renewal | DB written; Redis `DEL` of the cache hangs (outage) | the job hangs instead of retrying; it resumes on reconnect | no | code + DB-09 |
| dunning | identical to renewal | identical | **Yes** | same code (`dunning.job.ts:104-159`) |
| dunning | charge declined, failure recorded, then a later sub throws | the declined sub now has `last_failed_at = now` → skipped by the 3-day gate | no | S-F (T3 analogue) |
| trial-expiry | n/a: attempts 1 | none; next run in 24 h | — | config |
| reminders | n/a: attempts 1 | none | — | config |
| ETA | `eta_status = 'submitted'` written; ETA accepted; response lost → `submitInvoiceToEta` records `failed` and the worker throws | after 30 s, **resubmits the same document** | **Likely yes**, unless ETA dedupes (UNVERIFIED) | code (`eta-submission.job.ts:169-199`, `eta.submit.ts:60-70`) |
| ETA | today, the first SELECT fails with 42703 (DB-23) | retries 4 more times (30 s, 2 m, 10 m, 1 h), then `eta_status = 'failed'` | no | X7 |

**Paymob's webhook is the only thing that can save a retry.** Paymob also POSTs a transaction callback for token charges, if the integration's dashboard callback URL is set; `chargeWithToken` does not pass `notification_url` (`paymob.client.ts:125-134`).
- **If that callback arrives inside the 60 s backoff:** `handleWebhookSuccess` records the first charge, the subscription leaves the selection, and the retry is harmless.
- **If it arrives late, or not at all:** double charge.
- Whether the dashboard callback is configured for the recurring integration is UNVERIFIED (U5-01).

---

## 8. At-Least-Once Execution

**Proven at runtime: BullMQ executes a job more than once in this deployment.**
- **X2:** Redis froze for 45 s mid-job. The worker could not renew its 30 s lock, so `moveToFinished` failed with "Missing lock for job 1". At 75 s the stalled checker re-queued the job and the **same tick ran a second time**.
- **X5, X6:** after a crash or SIGTERM, the stalled job was picked up again by the next process.

**Where exactly-once is (incorrectly) assumed:**

| Location | Assumption | Reality |
|---|---|---|
| `renewal.job.ts:103-158`, `dunning.job.ts:112-152` | "charge returned → record it" happens once and atomically | Two independent systems; no record of intent; a retry cannot tell whether the charge happened (BG-01) |
| `withLock` (`lock.ts:11-24`) used as the guard against a second run | a second run is a *concurrent* run, so skipping it is correct | After a crash the "second run" *is the recovery*. Skipping it loses the work (BG-02). The `DEL` has no owner check (DB-L07) |
| `installment-reminders.job.ts:117-155` | the audit row written after the send will exist before any other run looks | Concurrent runs both look first (R3). A crash between send and insert re-sends |
| `trial-expiry.job.ts:104-110` comment: "Using an explicit value … is safe even if the worker double-runs" | true for duplicates | It is not safe for the *concurrent payment* case (S-A), because the expiry update is unconditional |
| `eta-submission.job.ts:169-171` | `submitted` marks an in-flight submission | Nothing reads it. A retry or a second job resubmits anyway (X7) |

**Where at-least-once is handled correctly:**
- The webhook (P2002).
- The trial reminder counter (absolute SET).
- The cancel sweep and the renewal/dunning selection predicates, **for the work they have already recorded**.

---

## 9. Failure After Commit

**Test: DB transaction commits → worker crashes → job retries.**

| Job | What is committed | Crash right after | Retry / recovery result |
|---|---|---|---|
| renewal / dunning | `payment_attempts` + `subscriptions` (array tx) | before cache DEL and email | the sub is out of the selection → **safe**; caches stay stale ≤ 30 s / 300 s; the `payment_succeeded` email is lost (no outbox) |
| trial-expiry, expiry step | sub → `PAST_DUE` | before `redis.del` and email | the sub is out of the selection (no longer `TRIALING`) → **no** `trial_expired` email is ever sent; the cache stays stale ≤ 30 s. Benign |
| trial-expiry, reminder step | email sent, counter **not** yet bumped (the bump comes after the send) | — | next run re-sends the same reminder (duplicate email; benign) |
| reminders | email sent, audit row not yet written | — | next run within 24 h re-sends (duplicate) |
| ETA | `accepted` + uuid written | before the job completes | stall recovery re-runs it; the worker does not check `accepted` → **resubmits** an accepted invoice (BG-08). ETA-side outcome UNVERIFIED |
| webhook | attempt + subscription | before the 200 response | Paymob re-delivers → P2002 → no-op → **safe** |

**The dangerous "after commit" case is the external commit,** not the database commit: Paymob has committed the charge, and Hesba has not. That is §7 and BG-01.

---

## 10. Failure Before Commit

**Test: worker starts → reads → calculates → crashes before commit.**

| Job | Reads | Crash before commit | Retry sees |
|---|---|---|---|
| renewal / dunning, before the Paymob call | due list | — | clean state; the sub is re-selected and charged once → **safe** |
| renewal / dunning, **after** the Paymob call | — | — | the DB looks clean, but money was taken → **unsafe** (this is BG-01; "before commit" is only clean when nothing external happened) |
| trial-expiry | expired list | — | clean; re-selected next day (attempts 1) |
| reminders | payments + audit lookup | before the send | clean |
| ETA | invoice + settings | before `submitted` | clean |

**Transaction rollback is total** for every multi-statement write in the jobs. Phase 4 already proved Prisma array transactions roll back fully. The partial-state problem is never *inside* a DB transaction. It is always *between* a DB write and an external effect, or between two independent DB writes (§11).

---

## 11. Partial DB Failure

**Write sequences and their transaction boundaries:**

| Job | Sequence | Transaction boundary | Partial state if it fails mid-way | Retry behaviour |
|---|---|---|---|---|
| renewal / dunning (per sub) | A: Paymob order → B: payment key → C: charge → D: `payment_attempts` INSERT + `subscriptions` UPDATE → E: cache DEL → F: email | only **D** is a transaction (array tx) | **C done, D not**: money taken, nothing recorded (BG-01). D done, E not: stale cache. E done, F not: no email | whole-cycle retry; C repeats |
| renewal / dunning (cycle) | sub 1 … sub n, sequential | none across subs | some subs done, some not | the done subs are excluded by predicates; the failed ones are re-tried, with C repeating |
| trial-expiry | 1: reminders (per sub: email → counter) → 2: expiry (per sub: UPDATE → DEL → email) → 3: sweep (per sub: UPDATE → DEL) | none; every UPDATE is standalone | an exception in step 2 (DB blip on one UPDATE, Redis DEL hang) **aborts the remaining expiries and the whole sweep**. The worker throws, the job fails, attempts 1, nothing until tomorrow (BG-13) | next day |
| reminders | per tenant → per payment: lookup → send → INSERT | none | per-payment and per-tenant errors are caught and counted; the loop continues (R1 `errors: 1`) | none (attempts 1) |
| ETA | `submitted` UPDATE → external submit → `eta_submissions` INSERT → result UPDATE | none | `submitted` with no submission row; or the submission recorded but the invoice still `submitted` | retried up to 5× |
| `handleWebhookSuccess` | INSERT attempt + UPDATE sub (array tx) → `tenant.findUnique` → DEL × 2 → email | tx for the first two | consistent | — |
| `sweepScheduledCancellations` | per sub: UPDATE → DEL | none | some cancelled, some not | next day |

**Focus areas, as requested:**
- **Billing:** consistent inside D. Inconsistent across C→D (BG-01).
- **Dunning:** same, plus the absolute SET of `failed_attempts` from a stale read (DB-24).
- **Trial expiry:** no transaction. A failure aborts the rest of the run (BG-13), and the update is unconditional (BG-03).
- **ETA:** four independent writes around an external call. The `failed` handler (`eta-submission.job.ts:212-222`) overwrites whatever the last attempt wrote.
- **Installments:** no job writes installments. The reminder job writes only audit rows.

---

## 12. HTTP vs Job Races

**Entities written by both an HTTP request and a background job.** All rows were reproduced at runtime with the real job worker and the real service functions, except where noted.

| Entity | HTTP action | Job action | Race | Current protection | Final state observed | Expected |
|---|---|---|---|---|---|---|
| subscription | webhook `handleWebhookSuccess` (checkout) | trial-expiry hard expiry | the job selected the sub as `TRIALING`; the user paid; the job writes `PAST_DUE, failed_attempts 1` | none (UPDATE by id) | **`PAST_DUE`** with a `SUCCESS` attempt and a card on file → 3 days later **dunning charges again** → 2 successful charges, one period (S-A) | `ACTIVE`, untouched by the job |
| subscription | webhook (checkout) | dunning | the job selected a failed renewal; the user paid interactively; the job then charges the stored card | none | 2 `SUCCESS` attempts (9201 + 5001), period = now + 1 month (**one** period for two charges) (S-B) | the job sees the paid period and skips |
| subscription | admin `PATCH /subscriptions/:id/cancel` (immediate) | dunning | the job selected `PAST_DUE`; the admin cancelled; the job charges; the success handler sets `ACTIVE` | none | **`ACTIVE` with `cancelled_at` still set**, card charged (S-D1) | stays `CANCELLED`, no charge |
| subscription | `POST /billing/cancel` (at period end) | dunning | stale selection | none | charged; `cancel_at_period_end = true`; period extended (S-D2) | no charge after the cancel request |
| subscription | `POST /billing/cancel` | renewal | stale selection (DB-L03) | none | charged after the cancel request (S-D3) | no charge |
| subscription | admin extend-trial | trial-expiry | the job selected an expired trial; the admin extended it by 7 days; the job writes `PAST_DUE` | none | **`PAST_DUE`, `failed_attempts 1`, `trial_ends_at` = +7 d** (self-contradictory; the extension lost) (S-H) | `TRIALING` until the new end |
| subscription | admin reactivate | dunning | stale selection; reactivate sets `failed_attempts 0` | none | same shape as S-B: a charge for a sub the admin just reactivated out-of-band (code; not run) | no charge |
| subscription | `/billing/resume` | cancel sweep | the sweep selected the sub; the user resumed; the sweep cancels | none | CANCELLED despite the resume (code; same pattern as S-H) | stays active |
| subscription | three declined checkouts during a **valid** trial | (handler only) | not a race: the failure counter is shared with renewal | none | `PAST_DUE` with 10 trial days left (S-I; DB-37) | `TRIALING` |
| subscription | webhook for the **same** transaction | dunning's own write | job and callback both record tx N | `UNIQUE(provider_transaction_id)` | one row, one email (S-C) | ✓ **safe** |
| installment payment | record payment | reminders | the job read the list; the payment was recorded; the job emails | none | reminder sent for a **paid** installment (R4) | no reminder |
| installment payment / audit | manual `send-reminders` route | cron reminders | both look before either writes | 24 h audit lookup | **8 emails for 4 reminders** (R3) | 4 |
| invoice (ETA fields) | `POST /admin/eta/resubmit` ×2 | ETA worker | two jobs, concurrency 3 | none | two jobs active for one invoice (X7) | one |
| invoice (status vs ETA) | cancel invoice | ETA worker | the worker never reads `invoices.status` | none | a cancelled invoice was queued and processed (X7; stopped only by DB-23) | not submitted |
| tenant cache | admin suspend / plan change | jobs' `invalidateSubscriptionCaches` | cache-aside write-back (DB-L05) | TTL | ≤ 300 s stale | — |
| stock, invoice, customer credit | all sales flows | **no job writes them** | — | — | — | — |

**Pattern.** Every unsafe row is the same two-step pattern: select a set at the start of the cycle, then act on each element without re-reading the row and without a conditional write. Phase 4.5 called this RC-01; in the billing jobs it is compounded by RC-06.

The fix in each case has two parts:
- a conditional write (`updateMany` with a `WHERE` on the expected status / period / `cancel_at_period_end`), and
- for charges, a per-period intent row claimed **before** the Paymob call (§14).

---

## 13. Billing Jobs

### 13.1 The actual lifecycle (from code, not assumed)

`SubscriptionStatus` = `TRIALING | ACTIVE | PAST_DUE | SUSPENDED | CANCELLED` (`schema.prisma:119-125`). Two flags carry the rest of the state: `failed_attempts` and `cancel_at_period_end`.

The requested phases PAYMENT_DUE and PAYMENT_RETRY **do not exist as states**. They are encoded as `ACTIVE` + `current_period_end ≤ now` (payment due) and `ACTIVE|PAST_DUE|SUSPENDED` + `failed_attempts > 0` (retrying).

```
signup ──startTrial──► TRIALING (period_end = trial_end = now+14d)
TRIALING ──webhook success──────────────────────────────► ACTIVE (period = now..now+cycle, card stored)
TRIALING ──trial-expiry 06:00 (trial_end ≤ now)─────────► PAST_DUE, failed=1, no card
            └─ no job ever touches it again (dunning needs a card) → PAST_DUE forever, full access (FIN-16)
TRIALING ──3rd declined checkout──► PAST_DUE ──7th──► SUSPENDED ──14th──► CANCELLED   (DB-37, S-I)
ACTIVE (period_end ≤ now, card, failed=0, !cancel_at_period_end)
        ──renewal 07:00── success ─► ACTIVE (period reset to now..now+cycle)
                        └ decline ─► ACTIVE, failed=1, last_failed_at=now           ("PAYMENT_RETRY")
ACTIVE|PAST_DUE|SUSPENDED (failed>0, card, ≥3 d since last_failed_at)
        ──dunning 08:00── success ─► ACTIVE, failed=0
                        └ decline ─► failed+1: 3→PAST_DUE, 7→SUSPENDED(402), 14→CANCELLED(402)
                                     (renewal fails day 0 → PAST_DUE ≈ day 6, SUSPENDED ≈ day 18, CANCELLED ≈ day 39)
ACTIVE + cancel_at_period_end ──sweep 06:00 (period_end ≤ now)──► CANCELLED
ANY ──webhook success──► ACTIVE   (incl. CANCELLED: DB-25; incl. a just-admin-cancelled row: S-D1)
PAST_DUE|SUSPENDED ──admin reactivate──► ACTIVE (period reset)
TRIALING|PAST_DUE ──admin extend──► TRIALING
ANY≠CANCELLED ──admin cancel──► CANCELLED
```

**Enforcement** (`tenant.middleware.ts:103`) blocks only `SUSPENDED` and `CANCELLED`. `PAST_DUE` keeps full access.

### 13.2 Job responsibilities and overlaps

| Job | Selects | Excludes | Overlaps with |
|---|---|---|---|
| trial-expiry | `TRIALING ∧ trial_ends_at ≤ now` | — | webhook success (S-A); admin extend (S-H) |
| renewal | `ACTIVE ∧ period_end ≤ now ∧ card ∧ ¬cancel_at_period_end ∧ failed = 0` | cancel-scheduled; failing | webhook success (would cause a double charge); user cancel (S-D3) |
| dunning | `status ∈ {ACTIVE, PAST_DUE, SUSPENDED} ∧ failed > 0 ∧ card` and ≥ 3 d since the anchor | **nothing about the period or cancellation** | webhook success (S-B); user cancel (S-D2); admin cancel (S-D1); a paid sub with one interactive decline (DB-08) |
| cancel sweep | `cancel_at_period_end ∧ status ≠ CANCELLED ∧ period_end ≤ now` | — | `/billing/resume` |

**Renewal vs dunning on the same sub is safe.** Their selections are disjoint (`failed = 0` vs `failed > 0`), and a renewal failure sets `last_failed_at = now`, which the dunning gate excludes for 3 days. This stays true even if a hung renewal run overlaps the 08:00 dunning tick.

### 13.3 Payment race tests (requested Scenarios A–F)

All scenarios were run with the real job worker, `billing.service`, BullMQ and the throwaway DB/Redis. Paymob was a local mock. "Webhook" means a direct call to `handleWebhookSuccess` with the arguments the route builds after HMAC verification (`billing.routes.ts:43-49`).

| Scenario | Setup | Observed final state | Gateway charges | Correct? |
|---|---|---|---|---|
| **A** payment ∥ trial-expiry | 2 expired trials; the job is mid-loop (T1's email in flight); T2 pays | T2 `PAST_DUE`, `failed 1`, card on file, `SUCCESS:9001`. **+3 d dunning** → `SUCCESS:5000`. Emails: "payment succeeded", "trial expired", "payment succeeded" | **2** for one period | ✗ (BG-03, DB-19 → P1) |
| **A′** trial-expiry, then payment | sequential | `ACTIVE`, period +1 month | 1 | ✓ (the customer received a "trial expired" email first; acceptable) |
| **B** payment ∥ dunning (retry) | failed renewal 4 d ago; the user pays by checkout while dunning holds the list | `ACTIVE`, attempts `SUCCESS:9201`, `SUCCESS:5001`, period_end +1 month (not +2) | **2** (1 checkout + 1 token) | ✗ (BG-03, DB-08) |
| **C** webhook ∥ retry job, same tx | Paymob's callback for the dunning charge is processed before the job's own `handleWebhookSuccess` | 1 row `SUCCESS:5002`; the job's insert hits P2002 → no-op; 1 email | 1 | ✓ |
| **D1** payment ∥ admin immediate cancel | dunning selected; the admin cancels; the job charges | `ACTIVE`, `cancelled_at` set, `SUCCESS:5003` | 1 (after the cancel) | ✗ (BG-03; DB-25) |
| **D2/D3** payment ∥ user cancel | `/billing/cancel` lands mid-dunning (D2) / mid-renewal (D3) | `ACTIVE`, `cancel_at_period_end = true`, charged, period extended | 1 (after the cancel) | ✗ (BG-03; DB-08, DB-L03) |
| **E** the same webhook twice | 2 concurrent + 1 sequential | 1 row, `ACTIVE`, 1 email | — | ✓ |
| **F** Paymob succeeds → crash / lost response before the DB write → retry | real BullMQ retry (60 s) | 1 `SUCCESS` row; **2 charges at the gateway** | **2** | ✗ (BG-01) |
| F′ | the same, with PostgreSQL refusing connections after the charge (X3) | 1 row, 2 charges | **2** | ✗ |
| F″ | the same, with a worker SIGKILL (X5) or SIGTERM (X6), then the next day's run | 1 row, 2 charges | **2** | ✗ (BG-01 + BG-02) |

---

## 14. Payment Recording

**Phase 4.5 finding (RC-06): there is no durable payment record per subscription period.** `payment_attempts` is written only *after* an outcome is known, keyed only by Paymob's transaction id, and has no column for the period it pays for.

| Concern | Effect of the missing record | Evidence |
|---|---|---|
| **Retry** | A retry cannot know whether the previous attempt charged. It re-selects from `subscriptions`, which still says "unpaid" | S-F, X3, X5 |
| **Webhook** | The webhook cannot bind a transaction to an *expected* charge. It trusts `merchant_order_id` for the tenant (HSEC-21) and does not check amount or currency (FIN-17). Any success for the tenant, however late, resets the period to now + cycle (DB-25) | Phase 3/4; S-D1 |
| **Duplicate charging** | Nothing makes "one successful charge per period" an invariant. Two successes (checkout + token, or token + token) both apply, and the second **shortens** the paid time instead of extending it | S-A, S-B |
| **Reconciliation** | A charge that never reached the DB is invisible. There is no pending row to compare against Paymob, and `reconcilePayments` is a placeholder with no caller. Completed billing jobs are deleted. **Detection depends on the customer complaining** | BG-11 |
| **Cancellation** | A cancel cannot void an in-flight charge, because there is no in-flight object. The job's later success re-activates the subscription | S-D1, S-D2, S-D3 |
| **Trial expiration** | Expiry cannot ask "is a checkout in progress or completed for this trial?" It overwrites | S-A, S-H |
| **Refund / void** | Callbacks are no-ops (B-03); there is nothing to mark refunded | Phase 1 |

**The minimum durable record that would make the lifecycle safe** (requirements only; not a design to implement here). One row per *intended* charge, written **before** any Paymob call:

| Field | Why it is required |
|---|---|
| `id` (our UUID) and a **deterministic `merchant_order_id`** derived from it | Paymob can dedupe orders per merchant order id, and the webhook can find the intent directly instead of parsing the tenant out of a string |
| `subscription_id`, `tenant_id` | binding (closes HSEC-21 for the job path) |
| `period_start`, `period_end` (the period being paid for) | the unit of idempotency |
| `kind` (`checkout` / `renewal` / `dunning_retry`) and `attempt_no` | lets declines of a *checkout* stay apart from renewal escalation (closes DB-37) |
| `amount`, `currency` (expected) | the webhook compares; closes FIN-17 / FIN-L2 |
| `status`: `PENDING → SUBMITTED → SUCCEEDED / FAILED / UNKNOWN`, with `updated_at` | the retry rule: never charge while a row for the same period is `SUBMITTED` or `UNKNOWN`; resolve it by Paymob order/transaction inquiry first |
| `provider_order_id`, `provider_transaction_id` | link to Paymob; the existing `UNIQUE(provider_transaction_id)` stays |
| `last_error`, `created_at` | diagnosis |
| **Partial unique index** `(subscription_id, period_start) WHERE status IN ('PENDING','SUBMITTED','SUCCEEDED','UNKNOWN')` | the database-level guarantee of one live charge per period. This alone would have made S-A, S-B, S-F and X5 fail closed |

**State transitions on success.** These are what make the races in §12 resolve correctly:
- Extend from `max(now, current_period_end)` instead of resetting to now.
- Write `ACTIVE` only from an allowed source state (conditional `updateMany`). Not from `CANCELLED`.
- Not when `cancel_at_period_end` was set before the intent was created.

---

## 15. Dunning

| Question | Answer (code: `dunning.job.ts:61-165`) | Status |
|---|---|---|
| Who is eligible? | `status ∈ {ACTIVE, PAST_DUE, SUSPENDED}`, `failed_attempts > 0`, `provider_card_token IS NOT NULL`, and `floor((now − (last_failed_at ?? updated_at)) / 1 d) ≥ 3` | CC |
| When is eligibility calculated? | once, at cycle start (one `findMany`); never re-checked before the charge | CC; S-B, S-D1, S-D2 |
| Is payment status rechecked before charging? | **No.** No reload, no conditional claim, no period check | CR (S-B) |
| Are cancelled subscriptions excluded? | `CANCELLED` yes, at selection time only (an admin cancel after selection is not seen: S-D1). **Cancel-at-period-end: no** (DB-08 / B7, S-D2) | CR |
| Are already-paid periods excluded? | **No.** `current_period_end` is not in the predicate. A paid sub with one interactive decline is selected (DB-08 / B4) | CR (Phase 4) |
| Can concurrent dunning runs duplicate charges? | Two scheduled ticks: no (BullMQ one-job-one-worker + `withLock`). A cycle running > 25 min while another tick or a manual enqueue starts: the lock has expired, so two cycles run on the same list → each eligible sub is charged twice. A cycle runs > 25 min only with slow or hung Paymob calls (BG-04) | LK (L5-01) |
| Can a tenant be targeted incorrectly? | The tenant comes from the subscription row. `handleWebhook*` re-derives it by parsing the `merchant_order_id` the job itself built; consistent. The billing data sent to Paymob has empty email and phone (`dunning.job.ts:122-134`), unlike renewal (`ownerEmail`); whether Paymob accepts that is UNVERIFIED | CC |
| Can one tenant's job process another tenant's records? | Dunning is platform-wide by design and has no tenant trigger: no HTTP route runs it. **No cross-tenant exposure.** The Phase 2 cross-tenant concern (HSEC-05) is the *reminder* job (§17, §33) | CC |
| SUSPENDED tenants | still charged every 3 days while blocked by 402; success reactivates them. Consistent with the comment at `:70-73` (needed to reach the 14-failure milestone) | design |
| Escalation timing | 3 failures ≈ day 6, 7 ≈ day 18, 14 ≈ day 39 after the first renewal decline; service stays fully usable until day 18 | design (FIN-16-adjacent) |
| Lost increments | `failed_attempts` is an absolute SET from a stale read (DB-24) | CR (Phase 4) |

---

## 16. Trial Expiration

| Aspect | Finding |
|---|---|
| Eligibility | `status = 'TRIALING' AND trial_ends_at ≤ now` (`trial-expiry.job.ts:115-118`) |
| Timing | once a day at 06:00 process time (UTC in the container). A trial can run up to about 24 h past `trial_ends_at` (14 d after signup) before it expires. The pre-expiry reminders use `ceil(days remaining)` with thresholds 3 and 1 |
| Timezone | all `Date` arithmetic is in UTC milliseconds; cron is in process TZ; no tenant timezone exists. No correctness issue beyond the up-to-24 h lag |
| State transition | `TRIALING → PAST_DUE`, `failed_attempts = 1`, `last_failed_at = now`, `last_failure_reason = 'trial_expired_no_payment'` |
| Transaction boundary | none. Each sub is a standalone `update({ where: { id } })` followed by `redis.del` and an awaited email |
| Interaction with a successful payment | **payment at T, job at T + ε** (job selected earlier): the job overwrites the paid sub → `PAST_DUE` → dunning charges again (S-A, ✗). **Job at T, payment at T + ε:** `ACTIVE`, correct (A′, ✓) |
| Interaction with an active subscription | an `ACTIVE` sub is never selected; the race is only with a row that is `TRIALING` at selection time |
| Admin extension | overwritten if it lands after selection (S-H, ✗) |
| Retry behaviour | `attempts: 1`. An exception in the expiry loop (e.g. a DB blip on one UPDATE, or a Redis hang on `del`) aborts **all remaining expiries and the cancel sweep** until the next day (BG-13) |
| Duplicate execution | safe: the predicate excludes rows already moved |
| After expiry | the cardless `PAST_DUE` is never escalated (dunning requires a card) and never blocked (enforcement ignores `PAST_DUE`) → **the expired trial keeps full access indefinitely** (FIN-16, re-confirmed by code; Phase 5 adds no new path that would escalate it) |
| Email | `trial_expired` is sent after the state change. A Resend failure is silent (BG-05). A crash between the update and the email → the email is never sent |

---

## 17. Installment Reminders

| Aspect | Finding | Status |
|---|---|---|
| Recipient selection | `installment_payments.status ∈ {pending, overdue}`, `due_date < today + 3 d`, contract `status ∈ {active, overdue}`, customer has an email | CC |
| Tenant scope | **every tenant with `tenants.status = 'ACTIVE'`**, from the master DB. A tenant-scoped HTTP route runs it for all tenants (HSEC-05) | CR (R1: a call from "tenant A" emailed `cust_tenant_p5_rb@…`) |
| Subscription state | uses `tenants.status`, not the subscription. A tenant whose subscription is `CANCELLED` (its own users get 402) still has its customers emailed in its name | CR (R5) → **BG-07** |
| Eligibility date math | `today = new Date(); today.setHours(0,0,0,0)` (process-local midnight); Prisma serialises the `@db.Date` comparison as a UTC date. In UTC (the container) the window is today … today + 2 (3 days, as documented). In `Africa/Cairo` the third day is silently dropped | CR (R1 under Cairo TZ: 1 reminder per tenant; under UTC: 2) → **BG-14** |
| Duplicate reminders | cron + manual, or two manual triggers → duplicates | CR (R3: 8 sent, 4 distinct) — DB-26 |
| Job retries | `attempts: 1`; errors per payment or tenant are swallowed and counted | CC |
| Cancellation | a contract leaving `active/overdue` stops reminders at the next run | CC |
| Paid installment | excluded at selection. **Paid during the cycle** → still reminded, because the list is stale | CR (R4) → **BG-06** |
| Overdue installment | included (`due_date < today` → "overdue" wording). No job promotes `pending → overdue`; the `overdue` status is never set by any job (FIN-20) | CC |
| Concurrent payment | as "paid during the cycle" | CR |
| Email failure | Resend returns `{error}` and does not throw → counted as `sent`, audit row written, rerun skips it for 24 h | CR (R2) → **BG-05** |
| Amount in email | `amount_paid`, which for a pending row holds the scheduled amount (misleading column name, correct value) | CC |
| One tenant fails | caught per tenant; the others continue | CR (R1) ✓ |

**Can a reminder be sent after the installment is paid? Yes:**
- when the payment is recorded during the cycle (R4);
- through the manual route, whose response is the same cycle.

It cannot be sent for a payment already `paid` when the cycle starts.

---

## 18. ETA Jobs

| Aspect | Finding | Status |
|---|---|---|
| Queueing | only `POST /admin/eta/resubmit/:invoiceId` enqueues (E-02); invoice creation never does, so `eta_status` stays `not_required` by default | CC |
| Current runtime behaviour | the first SELECT fails: `column ts.eta_signing_cert_pem does not exist` (42703) → 5 attempts (0 s, +30 s, +2 m, …) → `eta_status = 'failed'` (DB-23) | CR (X7) |
| Retry | a permanent SQL or configuration error is retried as transient; no `UnrecoverableError`. `rejected` (business rejection) is correctly *not* retried | CR |
| Idempotency | no `jobId` per invoice → **two resubmits = two jobs**, run in parallel (concurrency 3). The route refuses only `accepted` at enqueue time; the worker never checks `accepted` or `submitted` | CR (X7: jobs 1 and 2 both active) |
| Submission status | `submitted` is written **before** the call and never read. After a lost response the row says `failed` while ETA may have accepted it | CC |
| Successful submission, then worker crash | stall recovery re-runs it → resubmits | CC; ETA-side dedupe UNVERIFIED |
| Credentials | read from `tenant_settings` at run time (not in the payload): good. Decrypted in-process. Not logged; `eta_submissions.request_payload` stores the signed document, not the credentials | CC |
| Tenant scope | `schemaName` comes from the payload; the producer sets it from `request.tenant.schemaName` (DB-sourced). The worker does not validate it against `tenantId` | CC (L5-02) |
| Environment | `eta_is_production` (non-existent column; DB-23) would choose prod vs preprod; the real column is `eta_environment` (`002_full_schema.sql:24`). After a naive column fix, every tenant would silently go to **preprod** unless mapped | CC (schema inconsistency carried from Phase 1/4) |
| Invoice state changes while pending | the worker never reads `invoices.status`. A **cancelled** invoice was queued and processed up to the schema error (X7). A return after acceptance is never reported to ETA (F-05) | CR |

---

## 19. Tenant Isolation

| Job | Tenant identity stored as | Context restored by | Prisma client | Validation | Can a malformed / stale job hit another tenant? | Can it run unscoped? |
|---|---|---|---|---|---|---|
| trial-expiry, renewal, dunning, sweep | none in the payload; each subscription row's `tenant_id` | rows read from `masterDb` | `masterDb` (platform tables only) | n/a | no tenant data touched; the platform jobs are scoped by row | by design platform-wide |
| billing handlers called from jobs | `merchant_order_id` string the job built: `sub_<tenantId>_<ts>` | `split('_')[1]` → `subscription.findFirst({ where: { tenantId } })` (no `orderBy`; other paths use `createdAt desc`) | `masterDb` | none beyond existence | only if two subscriptions exist for one tenant (no UNIQUE on `subscriptions.tenant_id`); today only `startTrial` creates them, once per tenant | — |
| reminders | `tenants.schema_name` from `masterDb` | `getTenantDb(t.schemaName)` per loop iteration | per-tenant LRU client | none (DB-sourced) | **yes, by trigger**: any tenant user can run it for all tenants (HSEC-05). The data path itself stays correctly per-tenant: tenant A's data was never mixed into tenant B's email | **yes**: there is no tenant scope at all |
| ETA | payload `{ invoiceId, tenantId, schemaName }` | `getTenantDb(job.data.schemaName)` | per-tenant client | **none**: `tenantId` is ignored; `schemaName` is trusted | only by someone who can write to Redis (`requirepass` in prod). The producer is safe | no |

**Conclusion.** There is no confused-deputy path from one tenant's *data* into another's. The single isolation defect is **authorization of the trigger** (HSEC-05), plus the absence of `schemaName` validation in the ETA worker (defence in depth, L5-02).

---

## 20. Job Payloads

| Job | Payload | Tenant id | Entity id | Schema | User id | Payment / invoice id | State | Mutable business values | DB authoritative? |
|---|---|---|---|---|---|---|---|---|---|
| trial-expiry / renewal / dunning / reminders | `{}` | — | — | — | — | — | — | — | **yes**: everything is read at run time |
| ETA | `{ invoiceId, tenantId, schemaName }` | yes (unused) | invoice | yes (trusted) | no | invoice | no | no | **yes**: totals, items and credentials are read at run time |

**Payload-vs-DB ("amount = 100 in the payload, 150 in the DB"):**
- **No job carries an amount.** Renewal and dunning charge `subscriptions.price_at_subscription` read at run time, so the DB wins.
- The one place a stale amount *is* trusted is outside the payload: the webhook trusts Paymob's `amount_cents` and never compares it to an expected amount (FIN-17).

---

## 21. Job Staleness

| Queued / selected | State then changes | Does the job revalidate? | Observed |
|---|---|---|---|
| reminder list read | installment paid | **no** | reminder sent (R4) |
| dunning list read | subscription cancelled (admin) | **no** | charged; reactivated (S-D1) |
| dunning list read | cancel scheduled (user) | **no** | charged (S-D2) |
| dunning list read | paid interactively | **no** | charged twice (S-B) |
| renewal list read | cancel scheduled | **no** | charged (S-D3) |
| trial-expiry list read | subscription paid | **no** | overwritten to `PAST_DUE` (S-A) |
| trial-expiry list read | trial extended by admin | **no** | overwritten (S-H) |
| sweep list read | user resumed | **no** | cancelled anyway (code) |
| ETA job queued | invoice cancelled | **no** | processed (X7) |
| ETA job queued | invoice already accepted (second job) | **no** | resubmitted (code) |

**Staleness window.** For the cron jobs it is the duration of the cycle loop: seconds per subscription, dominated by 4 sequential Paymob calls (up to about 300 s each when Paymob is silent, BG-04) or an awaited email. For ETA it is the queue delay plus up to about 1 h 13 m of retries. No job carries state in its payload, so staleness comes entirely from **selecting once and writing later**.

---

## 22. Scheduling

| Question | Answer | Evidence |
|---|---|---|
| How are schedules registered? | `queue.add(name, {}, { repeat: { pattern }, jobId })` in four `schedule*()` functions awaited in `start()` after `app.listen` (`index.ts:500-508`) | code |
| Is registration idempotent? | **yes**: the repeat key is a hash of name, jobId, tz and pattern; 3 concurrent registrations plus a restart → 1 repeatable, 1 delayed job | X8 |
| Does every instance register? | yes, every API process; harmless (idempotent) | X8 |
| Can duplicate schedules exist? | **yes, after a code edit of the cron string** (or of `name`/`jobId`/`tz`): the old key is never removed, so both fire. Git history shows no pattern edit so far | X8 (`['0 7 * * *', '0 5 * * *']`) → P5-P01 |
| After deployment | the same key is re-registered; the next tick is unchanged. A deploy **during** a cycle triggers BG-02 | X6 |
| After a worker restart | delayed repeat jobs persist in Redis. A stalled active job is recovered by the new process (but neutered by `withLock`, BG-02) | X5, X6 |
| After a Redis restart | with the prod RDB volume: restored from the last snapshot (the repeatables are written at boot, long before any snapshot is due, so they survive). **With data loss** (volume loss, `FLUSHALL`, eviction under a future `maxmemory`): **all four schedules disappear and nothing re-creates them until the next process boot**. Renewal, dunning, trial expiry and the sweep stop silently | X2 (wipe: repeatables 1 → 0) → **BG-12** |
| Multiple instances | one tick runs on one worker; `withLock` prevents overlapping cycles **as long as a cycle is shorter than its TTL** (10 / 25 min) | code + X2 |
| Timezone | none given → UTC in the container | X6 (`tz=null`) |

---

## 23. Worker Concurrency

| Worker | Concurrency | Shared resources | Transaction strategy | Locking | Idempotency | Can two instances process the same entity at once? | Safe? |
|---|---|---|---|---|---|---|---|
| trial-expiry | 1 per process | `masterDb` pool, `redis` | none (standalone UPDATEs) | `withLock` 10 min | predicate | not via the job. **Yes** with HTTP writers (webhook, admin) | ✗ vs HTTP (BG-03) |
| renewal | 1 | `masterDb`, Paymob, Resend | array tx per sub (after the charge) | `withLock` 25 min | predicate (after the charge) | via the job only if a cycle exceeds 25 min and another tick or enqueue starts (L5-01). Yes with the webhook | ✗ |
| dunning | 1 | same | same | same | same | same | ✗ |
| reminders (worker) | 1 | `masterDb`, every tenant client, Resend | none | `withLock` 25 min | 24 h audit lookup | **yes**: the manual route bypasses the lock | ✗ (R3) |
| ETA | **3** | tenant clients, ETA API | none | **none** | none | **yes**: two jobs for one invoice in one process (X7), or across instances | ✗ |

**Pool pressure.** The reminder cycle walks *every* tenant through `getTenantDb`, so a daily run touches up to N tenant clients. The LRU holds 50, so a cycle over more than 50 tenants evicts and disposes clients that HTTP requests may be using mid-transaction (DB-29). That is a job-induced trigger of a Phase 4 finding (LIKELY at more than 50 active tenants; L5-04).

---

## 24. Graceful Shutdown

**Code** (`index.ts:516-536`). On SIGTERM or SIGINT: `app.close()`, then `Promise.all(workers.map(w => w.close()))` (non-force: waits for active jobs), with a 25 s timer that calls `process.exit(1)`. `masterDb`, the tenant clients and `redis` are never explicitly disconnected; the process exit closes the sockets.

**Runtime (X6: the real `index.ts` booted as a child process).** A renewal job was active, with its Paymob charge recorded at the gateway and no response yet. SIGTERM was sent:

| Step | Observed |
|---|---|
| shutdown | `shutdown_timed_out — forcing exit` at **25.0 s**, exit code 1 |
| the BullMQ job | still `active`, holding a 30 s job lock that is no longer renewed |
| `lock:renewal-cycle` | still held: PTTL 1 474 757 ms (≈ 24.6 min); the `finally { DEL }` never ran |
| new process boots | the stalled checker recovers the job (≈ 30–60 s) → the processor runs → `withLock` returns `null` → "another instance holds the lock — skipping" → **job completed and deleted** |
| tenant T1 (the in-flight charge) | 1 gateway charge, **0 rows**; the next day's renewal charges it again (X5) |
| tenant T2 (not reached yet) | **never processed that day** |

**Safe retry vs duplicate side effect:**

| Interruption point | Classification |
|---|---|
| before any Paymob call for a sub | safe retry: but the retry is **suppressed** by the orphaned lock, so it is a *delayed* retry (next day) |
| after the charge, before the DB write | **duplicate side effect** next day (or on the BullMQ retry if the process survives) |
| after the DB write | safe |
| during a reminder send | duplicate email only if the audit row was not yet written |
| during an ETA submit | possible duplicate submission (stall recovery re-runs it) |

**Visibility timeout.** BullMQ's lock is 30 s, renewed every 15 s; the stalled check runs every 30 s; `maxStalledCount` 1. Recovery itself works; the app's own lock defeats it (BG-02).

**The 25 s budget vs the undici 300 s fetch timeout** (X9). Any deploy that lands while a Paymob or ETA call is slow ends in a forced exit mid-job.

---

## 25. Redis Failure

All runs used the throwaway Redis and the app's own connection options.

| Test | Result | Classification |
|---|---|---|
| **Redis unavailable at worker startup** (X1: the `index.ts` start order replicated) | Worker constructors return immediately. `await scheduleDunning()` **never settles while Redis is down**, because `maxRetriesPerRequest: null` queues the command. `start()` is blocked, so the reminder, trial and renewal workers are not started and the SIGTERM handler is not installed; HTTP is already listening, so `/health` looks fine. The workers log `connect ECONNREFUSED` ≈ 4 times a second each (80 lines in 10 s for 2 workers). When Redis returned at 10.4 s, everything resumed within 0.4 s and the repeatable was registered once | **hang → auto-recover** (BG-09) |
| **Redis freeze during a job** (X2: `docker pause` 45 s during a charge, 2 workers) | The processor kept running (Paymob and the DB do not need Redis). Lock renewal failed (`could not renew lock for job 1`); completion failed (`Missing lock for job 1. moveToFinished`); at 75 s the stalled checker **re-ran the same tick**. The re-run found `due=0`, because the first run had already recorded both charges. 1 charge per sub | **duplicate execution, safe only by state** (BG-10) |
| Redis disconnect during a job, with the DB write after it | the same as above, except a re-run that starts before the first run's DB write would be stopped only by `withLock` (still held). Protected as long as the cycle is under 25 min | LK |
| **Redis restart with data loss** (X2 tail: `docker restart`, no persistence) | repeatables 1 → **0**, delayed jobs → 0. Workers reconnect; nothing schedules anything again until the next boot | **lost jobs** (BG-12) |
| Redis unavailable during an HTTP request | every tenant request hangs (DB-09, Phase 4 runtime). The ETA resubmit route hangs **after** writing `eta_status = 'pending'` and before `queue.add` (§29) | hang |
| Reconnect | ioredis' default reconnect strategy; the offline queue flushes on reconnect. No stale BullMQ locks: locks expire by TTL. **Stale app locks do persist** (`lock:*-cycle`) if the holder died | — |

**Does the Phase 4 "Redis outage hangs every store request" (DB-09) also affect workers? Yes, and in four ways:**
1. Boot blocks on the first schedule registration (X1).
2. `withLock`'s `SET NX` hangs, so a cycle cannot start.
3. Inside a cycle, `redis.del(sub:status:…)` hangs after the DB write. The trial-expiry loop (`:135`) and `invalidateSubscriptionCaches` stall mid-cycle and resume on reconnect.
4. Lost job locks lead to re-execution (X2).

For workers, unlike the request path, `maxRetriesPerRequest: null` is the correct setting. The defect is sharing one client and having no boot-time timeout.

---

## 26. Database Failure

| Test | Result | Evidence |
|---|---|---|
| **DB unavailable before the job starts** | `findMany` throws → billing cycle: the job throws before any charge → BullMQ retries in 60 s → clean. Trial and reminders: attempts 1 → next day | code |
| **Connection dropped right after an external success** (X3: `ALLOW_CONNECTIONS false` + `pg_terminate_backend` right after the mock charged) | `handleWebhookSuccess` failed → `renewal_cycle_partial_failure:1` → DB back at 5 s → retry at 60 s **charged again**: 2 gateway charges, 1 row | **CR** |
| Connection drop **inside** the array tx | full rollback (Phase 4 P1-run); the retry then behaves as above (re-charge) | Phase 4 |
| Timeout during a write | Prisma raises → identical to the drop | code |
| **Worker crash after commit** | safe: the predicate excludes the sub; the email and cache invalidation are lost (§9) | code |
| Tenant DB unavailable for one tenant (reminders) | caught per tenant; the others continue | R1 (missing schema: `errors: 1`) |
| Pool exhaustion | the reminder job competes with HTTP for the 5-connection tenant pools and the LRU (DB-20, DB-29) | Phase 4 |

**Summary.** A DB failure is only dangerous when it comes **after an external side effect**, and in the billing jobs that is the normal order of operations.

---

## 27. External Service Failure

**Does the job know whether the external operation succeeded?**

| Service / call | SUCCESS | TIMEOUT | 5xx | 4xx | Connection reset | Knows the outcome? |
|---|---|---|---|---|---|---|
| **Paymob** token charge (`/acceptance/payments/pay`) | recorded via `handleWebhookSuccess` | no app timeout; undici rejects after **≈ 300 s** (X9) → treated as transient → retry → **re-charge if Paymob had charged** | `paymobFetch` throws on `!res.ok` → transient → retry → **re-charge if a 504 hid a success** | throws → transient → retried 3× (a decline is a 200 with `success: false`, handled as failure) | throws → retry → **re-charge** (S-F) | **No.** No inquiry by `merchant_order_id` or order id before retrying; the order id is new each attempt |
| Paymob auth / order / payment key | — | as above, but no money moved | retried | retried | retried | yes (no side effect) |
| Paymob `pending: true` response | `success: false` → `handleWebhookFailure` → counted as a **decline** (FIN-L3) | — | — | — | — | **wrong**: a pending charge may still settle → plus the next retry = a double charge (UNVERIFIED frequency) |
| **ETA** submit | `accepted` recorded | ≈ 300 s, then `failed` → retry → **resubmit** | `failed` → retry → resubmit | the same as 5xx (no 4xx/5xx distinction) | resubmit | **No.** `getDocumentStatus` exists (`eta.client.ts:73`) but is never used to resolve an unknown outcome |
| ETA OAuth | — | ≈ 300 s | throws → `failed` | throws (bad credentials) → retried 5× as transient | retry | yes (no side effect) |
| **Resend** | `{ data }` | the library catches every `fetch` error and resolves `{ error }` | resolves `{ error }` | resolves `{ error }` | resolves `{ error }` | **No, and the code believes it does.** `await resend.emails.send()` never rejects; the return value is ignored everywhere (`email.ts:142, 238, 304, 327`) → BG-05 |
| **R2** (S3) | presigned URLs are generated in HTTP routes only; no job touches R2 | — | — | — | — | n/a |
| ETA `getDocumentStatus`, Paymob inquiry | not called anywhere | — | — | — | — | — |

---

## 28. Email Duplication

| Email | Sent by | Can a retry or re-run duplicate it? | Prevented? | Harm |
|---|---|---|---|---|
| installment reminder (to end customers) | reminders job, manual route | **yes**: concurrent runs (R3), or a crash between send and audit row | 24 h audit lookup (check-then-act) | **harmful-ish**: duplicates go to the *store's customers*, in the store's name, triggered by *another* store (HSEC-05) |
| `trial_ending_soon` | trial-expiry | yes, a crash between send and counter bump | counter (bumped after the send) | tolerated |
| `trial_expired` | trial-expiry | no (the state change precedes it; a crash loses it rather than duplicating it) | predicate | tolerated. **Sent to a customer who just paid** (S-A) — misleading |
| `payment_succeeded` / `payment_failed` / `subscription_*` | `handleWebhook*` (webhook and jobs) | duplicate *webhook*: no (P2002 returns before the email, S-E). Duplicate *charge*: yes, a legitimately second email for a second charge (S-B) | P2002 | duplicate charges produce duplicate "payment succeeded" emails, which is at least honest |
| `subscription_cancellation_scheduled` | `/billing/cancel` (HTTP) | a user double-click → two emails | none | tolerated |
| invoice receipt | HTTP route | user retry | none | tolerated (and HSEC-06) |
| password reset | HTTP | per request, by design | rate limit | expected |

**The bigger email problem is loss, not duplication** (BG-05):
- R2 shows a Resend 500 producing `sent: 4`, zero deliveries, and four dedupe rows that suppress the next 24 h.
- The trial reminder counter behaves the same way: a failed `trial_ending_soon` is never retried.
- Every `catch` meant to log email failures (`billing.service.ts:191-196, 275-280`, `trial-expiry.job.ts:98-101`) is unreachable.

---

## 29. Queue Loss

**Is there any "DB commit, then enqueue" whose enqueue failure loses an operation?**

| Producer | Pattern | If Redis is down | If enqueue throws | Loss creates an incorrect state? |
|---|---|---|---|---|
| ETA resubmit (`eta.routes.ts:26-35`) | **B**: `UPDATE eta_status = 'pending'` (autocommit) → `queue.add` | the request **hangs** (`maxRetriesPerRequest: null`) and completes when Redis returns, so the job is not lost; the user sees a hung request | the invoice stays `pending` with no job; no sweeper re-enqueues it | **minor**: a display state "pending" forever; the user can resubmit. Not financial |
| Scheduled cycles | registered at boot; not tied to a DB transaction | see BG-09 / BG-12 | — | **Yes, operationally**: a wiped Redis stops billing until a restart (BG-12) |
| Billing webhook | no enqueue; does everything inline | — | — | — |
| Payment → confirmation email | inline after commit, not queued | — | — | the email is lost on failure (BG-05), not the payment |
| Invoice creation → ETA | **no enqueue exists** (E-02) | — | — | every invoice is "lost" to ETA by design today |

**Conclusion.** No financial operation depends on an enqueue succeeding after a DB commit, so an outbox is **not** justified by queue loss. The only queue-loss risk with real impact is the loss of the **repeatable schedules themselves** (BG-12). The cheap fix is to make the schedules self-healing (re-assert them periodically or on Redis `ready`), not an outbox.

---

## 30. Transaction / Queue Ordering

| Pattern | Where | Failure modes |
|---|---|---|
| **A**: `queue.add()` → DB commit | none | — |
| **B**: DB commit → `queue.add()` | ETA resubmit (`eta.routes.ts:26-35`) | commit succeeds, add hangs or fails → `pending` without a job (§29). Add succeeds, but the job runs before … (n/a: the commit precedes it) |
| **C**: `queue.add()` inside a DB transaction | none | — |
| **D**: outbox / event table | none | — |
| **Inverse B, external**: external side effect → DB commit | **renewal and dunning** (charge → `handleWebhookSuccess`) | the external commit succeeds, the DB fails → re-charge (BG-01). This is the ordering that matters in Hesba |
| DB commit → external side effect (no queue) | webhook / jobs → email; trial expiry → email | the email is lost on a crash or a silent Resend error; never duplicated by a retry |

**The pattern Hesba needs is an "intent-first" ordering for charges** (record a `PENDING` intent → call Paymob → record the outcome; resolve `PENDING`/`UNKNOWN` by inquiry). That is RC-06's payment intent, not a queue outbox.

---

## 31. Observability

| Job | job id in logs | tenant id | entity id | attempt number | error | duration | final outcome |
|---|---|---|---|---|---|---|---|
| trial-expiry | ✗ | ✓ (`tenantId` per expiry or reminder) | ✗ sub id | ✗ | ✓ (reminder send only; dead with Resend) | ✗ | ✓ count line |
| renewal | ✗ | ✗ (sub id only on error) | ✓ sub id on error | ✗ | ✓ | ✗ | ✓ `cycle complete: due/processed/succeeded/failed/transient`. **No log when the cycle finally fails after 3 attempts** (no `failed` listener) |
| dunning | ✗ | ✗ | ✓ sub id on error | ✗ | ✓ | ✗ | ✗ (no summary line at all) |
| reminders | ✗ | ✓ schema name | ✓ payment id on error | ✗ | ✓ (but Resend errors never reach it) | ✗ | ✓ summary (**wrong**: counts failed sends as `sent`, R2) |
| ETA | ✗ | ✗ | ✓ invoice id on the final failure | ✗ | ✓ | ✗ | ✓ `eta_submissions` rows (would be; DB-23) |
| `withLock` skip | ✗ | — | — | — | — | — | ✓ "another instance holds the lock — skipping" at `info`: **the only trace of BG-02** |

**Further observations:**
- **Noise:** every expected P2002 in the webhook path is printed by Prisma as `prisma:error … Unique constraint failed` (S-C, S-E), so the safe path looks like an error in the logs.
- **Missing signals:** there is no structured logger in jobs (`console.*`, while HTTP uses pino), no metrics, and no alert on "the renewal cycle did not complete today". Sentry is inactive (A-08).
- **Secrets:** no credentials are logged. The `[DEV]` email log prints recipient and template data only when `RESEND_API_KEY` is unset.

---

## 32. Job Retention

| Queue | Completed | Failed | Evidence of financial operations survives? |
|---|---|---|---|
| renewal, dunning | **deleted immediately** | last 100 | **No.** A run that skipped (BG-02) or completed leaves no job record. The only evidence is `payment_attempts`, which has no row for an unrecorded charge (BG-11) |
| trial-expiry | deleted immediately | last 100 | the subscription row only |
| reminders | deleted immediately | last 50 | `audit_logs` `reminder_sent` (written even for failed sends, BG-05) |
| ETA | 7 days | **forever** | `eta_submissions` + invoice columns; unbounded failed-job growth in Redis (BG-15) |

**Investigation impact.** To answer "was tenant X charged on 2026-10-08, and why twice?" one needs Paymob's dashboard, because Hesba keeps no attempt-level record of what it *asked* Paymob to do. That is BG-11.

---

## 33. Cross-Tenant Jobs

**Loops of the form "for each active tenant → process":**

| Loop | Location | Triggerable by one tenant? | Processes all tenants? | Authorization | Overlapping invocations | Tenant failure isolation |
|---|---|---|---|---|---|---|
| reminders | `installment-reminders.job.ts:83-167` | **yes**: `POST /api/installments/send-reminders` with `installments:update` (`installment.routes.ts:216-224`) | **yes** | `requirePermission('installments','update')` only, which a tenant role holds; no platform check; **no lock** | **yes** (R3: duplicates) | ✓ per-tenant try/catch |
| tenant migrations | `migrate-tenants.ts:120+` | no (platform admin route `admin.routes.ts:891`, boot) | yes | platform admin | per-schema advisory lock | ✓ per tenant |
| trial / renewal / dunning / sweep | master-DB subscriptions | no | yes (platform) | no route | `withLock` | per sub: renewal/dunning ✓ (try/catch); trial-expiry ✗ (BG-13) |

**HSEC-05 cross-check: CONFIRMED at runtime (R1), severity unchanged (P1).** A user of tenant A triggers emails from tenant B's store name to tenant B's customers. They can trigger it repeatedly: the 24 h dedupe limits real repeats but not the cost of every call, which walks all tenants synchronously inside one HTTP request. Run concurrently with the cron, it duplicates emails (R3).

Phase 5 adds two points:
- The route's response body returns the **platform-wide summary** (`tenants`, `sent`, …). That leaks the platform's tenant count and reminder volume to any tenant user.
- A long synchronous walk of every tenant inside an HTTP request is also an easy resource-exhaustion lever against the shared pools (DB-20).

---

## 34. Failure Matrix

| Job | Failure point | Retry? | Duplicate side effect? | Partial state? | Recovery |
|---|---|---|---|---|---|
| renewal / dunning | before any Paymob call | yes (3×, whole cycle) | no | no | automatic, clean |
| renewal / dunning | Paymob auth/order/key fails | yes | no | no | automatic |
| renewal / dunning | **charge succeeded, response lost / 5xx / 300 s timeout** | yes | **yes: second charge** (S-F) | money taken, no record | none (manual refund via Paymob) |
| renewal / dunning | **charge succeeded, DB write fails** | yes | **yes** (X3) | as above | none |
| renewal / dunning | **charge succeeded, process killed / SIGTERM** | stall recovery runs, but `withLock` skips it | **yes, next day** (X5, X6) | as above, plus the rest of the cycle skipped | next daily tick |
| renewal / dunning | DB written, cache DEL hangs (Redis down) | no (hangs) | no | stale cache | Redis reconnect |
| renewal / dunning | DB written, email fails | no | no | the customer is not notified | none (silent, BG-05) |
| renewal / dunning | Paymob silent (no response) | after ≈ 300 s per call | yes, if it had charged | worker blocked, later ticks queued (X4) | ≈ 5 min per hung call |
| trial-expiry | one UPDATE or DEL throws mid-loop | **no** (attempts 1) | no | remaining expiries **and the cancel sweep** skipped (BG-13) | next day |
| trial-expiry | crash between UPDATE and email | stall re-run skipped by `withLock` | no | `trial_expired` email never sent | none |
| trial-expiry | reminder sent, crash before the counter bump | next day | duplicate reminder | — | automatic |
| trial-expiry | Resend error | — (not detected) | no | the counter is bumped, so the reminder is **lost** | none |
| reminders | Resend error | — (not detected) | no | dedupe row written, so the reminder is **lost for 24 h** (R2) | the next day's run |
| reminders | crash between send and audit INSERT | next tick | duplicate email | — | automatic |
| reminders | one tenant schema broken | caught | no | that tenant skipped | next day |
| ETA | schema error (today) | 5× over ≈ 1 h 13 m | no | `eta_status = 'failed'` | manual resubmit (fails again) |
| ETA | accepted, response lost | yes | **likely resubmission** | `failed` while accepted at ETA | none (no status inquiry) |
| ETA | accepted, worker crash before the job completes | stall re-run | likely resubmission | — | none |
| any cron worker | Redis freeze > 30 s | stall re-run (X2) | the re-run of the cycle is harmless unless the work is unrecorded | — | automatic |
| any cron worker | Redis data loss | — | no | **schedules gone** (BG-12) | next process boot |
| boot | Redis down | — | no | `start()` blocked; later workers not started (BG-09) | Redis reconnect |
| ETA resubmit (HTTP) | Redis down after the UPDATE | — | no | `pending` and the request hangs | Redis reconnect |

---

## 35. Idempotency Matrix

| Job | Can execute twice? | Current protection | Safe? | Required protection |
|---|---|---|---|---|
| renewal (per sub) | yes (retry, stall, next day) | selection predicate written **after** the charge; `withLock` | **No** | a per-period charge intent claimed **before** the Paymob call (partial UNIQUE on subscription + period); a deterministic `merchant_order_id`; resolve UNKNOWN by inquiry before retrying |
| dunning (per sub) | yes | as above + the 3-day gate | **No** | as above; the selection must also require `period_end ≤ now` and `¬cancel_at_period_end`; a conditional claim |
| trial-expiry: expiry | yes | predicate (re-execution) | yes for re-execution; **no** vs concurrent HTTP | `updateMany({ where: { id, status: 'TRIALING', trial_ends_at: { lte: now } } })`; skip if count = 0 |
| trial-expiry: reminders | yes | absolute counter | yes for duplicates; **loses** on a silent email failure | check the Resend result; bump only on success |
| cancel sweep | yes | predicate | yes vs itself; no vs `/billing/resume` | a conditional `updateMany` on `cancel_at_period_end = true` |
| reminders | yes (cron + manual + crash) | 24 h audit lookup, after the send | **No** | INSERT a unique `(payment_id, reminder_date)` row **before** sending (`ON CONFLICT DO NOTHING`); send only if inserted; remove or lock the manual route |
| ETA | yes (two jobs, retry, stall) | none | **No** | `jobId = eta:<schema>:<invoiceId>` (or a DB claim `UPDATE … SET eta_status='submitting' WHERE eta_status IN ('pending','failed')`); skip if `accepted`; resolve unknowns with `getDocumentStatus` |
| webhook | yes (Paymob re-delivery) | `UNIQUE(provider_transaction_id)` | **Yes** | keep it. Add amount/currency check against the intent (FIN-17) |

---

## 36. Job/HTTP Race Matrix

| Entity | HTTP operation | Background job | Race | Current protection | Result (runtime unless noted) |
|---|---|---|---|---|---|
| subscription | webhook success (checkout) | trial-expiry | job selected → user paid → job overwrites | none | `PAST_DUE` + dunning **second charge** (S-A) |
| subscription | webhook success (checkout) | dunning | job selected → user paid → job charges | none | **two charges, one period** (S-B) |
| subscription | webhook success (checkout) | renewal | the same shape as S-B | none | double charge (code; identical mechanism) |
| subscription | webhook for the job's own tx | dunning / renewal | both record the same tx | UNIQUE + P2002 | **safe** (S-C) |
| subscription | admin cancel (immediate) | dunning / renewal | job selected → admin cancels → job charges | none | charged; **`CANCELLED` → `ACTIVE`** (S-D1) |
| subscription | `/billing/cancel` (scheduled) | dunning | stale list | none | charged after the cancel (S-D2) |
| subscription | `/billing/cancel` (scheduled) | renewal | stale list | none | charged after the cancel (S-D3) |
| subscription | admin extend-trial | trial-expiry | stale list | none | extension lost; `PAST_DUE` with a future trial end (S-H) |
| subscription | admin reactivate | dunning | stale list | none | a charge right after a manual reactivation (code) |
| subscription | `/billing/resume` | cancel sweep | stale list | none | cancelled despite the resume (code) |
| subscription | declined checkout (webhook) | (counter shared with dunning) | declines during a valid trial or paid period | none | `PAST_DUE` during the trial (S-I); dunning target while paid (DB-08) |
| installment payment | record payment | reminders | stale list | none | reminder for a paid installment (R4) |
| audit / reminders | `POST /installments/send-reminders` | reminders cron | concurrent cycles | 24 h audit check | duplicate emails (R3); cross-tenant (R1) |
| invoice (ETA) | resubmit ×2 | ETA worker | two jobs | none | concurrent jobs (X7) |
| invoice (ETA) | cancel / return invoice | ETA worker | job ignores status | none | cancelled invoice processed (X7) |
| tenant cache | admin actions | billing jobs' cache invalidation | cache-aside write-back | TTL | ≤ 300 s stale (DB-L05) |
| invoice / stock / credit / contract | sales, cancels, returns, approvals | — | **no job writes these** | — | — |

---

## 37. Confirmed Findings

### 37.1 Finding matrix

| ID | Sev. | Title | Status | Root cause | Merges / confirms |
|---|---|---|---|---|---|
| **BG-01** | **P1** | Renewal/dunning charge before any durable record; retry, crash or the next run charges again | CONFIRMED (runtime S-F, X3, X5, X6) | RC-06, RC-05 | **FIN-L1 → CONFIRMED** (also DB-L01, FIN-P3, HSEC-27 dup-charge part) |
| **BG-03** | **P1** | Billing jobs act on a stale list with unconditional writes; mid-cycle payments, cancels and admin actions are overwritten or double-charged | CONFIRMED (S-A, S-B, S-D1, S-D2, S-D3, S-H) | RC-01, RC-06, RC-02 | **DB-19 → P1**, **DB-L03 → CONFIRMED**, DB-08 extended, DB-25 extended |
| **BG-02** | P2 | An orphaned `withLock` key turns BullMQ's crash recovery into a silent no-op | CONFIRMED (X5, X6) | RC-07 | DB-L07 related |
| **BG-04** | P2 | No timeouts on job HTTP calls: a silent Paymob/ETA call blocks a worker ≈ 300 s per call; the shutdown budget is 25 s | CONFIRMED (X4, X6, X9) | RC-08 | **B-07 → runtime-confirmed** |
| **BG-05** | P2 | Resend never throws; email failures are silent; dedupe rows and counters are written for undelivered emails | CONFIRMED (R2; library source) | IND | — |
| **BG-08** | P2 | ETA jobs: no per-invoice dedupe, no state re-check, permanent errors retried, `submitted` never consulted | CONFIRMED (X7) | RC-05, RC-02 | DB-23 runtime-confirmed via BullMQ; P-09 (Phase 4) |
| **BG-11** | P2 | No reconciliation: an unrecorded charge is undetectable; job records deleted; `reconcilePayments` is a placeholder | CONFIRMED (code + X5 job `unknown`) | RC-06 | B-03, FIN-17 adjacent |
| **BG-06** | P3 | Reminder sent for an installment paid during the cycle | CONFIRMED (R4) | RC-01 | Phase 4 "LIKELY (benign)" → CONFIRMED |
| **BG-07** | P3 | Reminders sent for tenants whose subscription is CANCELLED/SUSPENDED | CONFIRMED (R5) | RC-02 | P-05 |
| **BG-09** | P3 | Redis unavailable at boot blocks `start()` indefinitely; later workers and SIGTERM handler not installed | CONFIRMED (X1) | RC-08 | DB-09 (worker side) |
| **BG-10** | P3 | A Redis stall > 30 s re-executes the job tick (at-least-once); correctness rests on predicates and `withLock` only | CONFIRMED (X2) | RC-07 | — |
| **BG-12** | P3 | Redis data loss removes all repeatable schedules; nothing re-registers them until the next boot | CONFIRMED (X2 tail) | RC-07 | — |
| **BG-13** | P3 | Trial-expiry has no per-row error isolation and no retries: one failure skips the remaining expiries and the cancel sweep for a day | CONFIRMED (code) | RC-07 | — |
| **BG-14** | P3 | The reminder window depends on the process TZ (`@db.Date` + local midnight) | CONFIRMED (R1 Cairo vs UTC) | IND | — |
| **BG-15** | P3 | Job observability and retention: no job/attempt ids, no `failed` listener on billing workers, P2002 logged as errors, ETA failed jobs kept forever | CONFIRMED (code + S-C/S-E logs) | IND | A-08 |

### 37.2 Details

#### BG-01 — Renewal and dunning charge the card before anything durable is written; a retry, crash or the next day's run charges again · **P1**

| Field | Detail |
|---|---|
| Severity | **P1**: a customer is charged twice for one period; reproducible with any transient failure after Paymob commits the charge. Not P0, because it needs a failure in a narrow window *and* a missing or late Paymob callback |
| File | `apps/api/src/jobs/renewal.job.ts`; `apps/api/src/jobs/dunning.job.ts`; `apps/api/src/modules/billing/billing.service.ts`; `apps/api/src/modules/billing/paymob.client.ts` |
| Function | `runRenewalCycle` (`:62-175`), `runDunningCycle` (`:61-165`), `handleWebhookSuccess` (`:117-198`), `paymobFetch` (`:25-37`) |
| Job / queue / trigger | `daily-renewal` / `renewal` / cron 07:00; `daily-dunning` / `dunning` / cron 08:00 |
| Failure scenario | charge accepted by Paymob → (response lost / HTTP 5xx / undici 300 s timeout / PostgreSQL error / process killed) → no `payment_attempts` row → BullMQ retry after 60 s (or stall recovery, or the next daily tick) re-selects the sub → new `merchant_order_id = sub_<tenant>_<Date.now()>` → new order → **second charge** |
| Root cause | RC-06: no payment intent per period. RC-05: no idempotency key toward Paymob. The external commit is ordered before the internal one |
| Current protection | the selection predicates (`period_end ≤ now`, `failed_attempts`), written only after a recorded outcome; a Paymob callback, if configured and delivered before the retry |
| Why protection fails | the predicates are derived from the very write that failed; the callback is optional (`chargeWithToken` sends no `notification_url`) and has a 60 s race against the retry |
| Evidence | S-F: `gatewayCharges: ['reset-after-charge','success']`, `paymentAttemptRows: ['SUCCESS:5003']`. X3 (DB refused after the charge): 2 charges, 1 row. X5/X6 (kill / SIGTERM, then next day): 2 charges, 1 row |
| Business impact | double charges discovered only by customer complaint (BG-11); manual refunds; chargebacks against the merchant account; trust. Also triggered by ordinary deploys during the 07:00 / 08:00 cycles (X6) |
| Remediation | (1) A `billing_charges` intent row (§14) inserted `PENDING` before `createOrder`, with a partial UNIQUE on (subscription, period). (2) Derive `merchant_order_id` from the intent id. (3) On retry or recovery, if an intent for the period is `SUBMITTED`/`UNKNOWN`, query Paymob (order/transaction inquiry by `merchant_order_id`) instead of charging. (4) Webhook: resolve the intent by `merchant_order_id` and verify the amount. (5) Explicit `fetch` timeouts (BG-04), so "unknown" is reached quickly and handled explicitly |
| Regression test | RT-BG01 (§42) |

#### BG-03 — Billing jobs act on a list read once, with unconditional writes; mid-cycle payments, cancellations and admin actions are overwritten or double-charged · **P1**

| Field | Detail |
|---|---|
| Severity | **P1**: S-A and S-B end in a second successful charge for one period; S-D1/D2/D3 charge a customer after they or an admin cancelled; S-D1 silently reactivates a cancelled tenant |
| File | `jobs/trial-expiry.job.ts`, `jobs/dunning.job.ts`, `jobs/renewal.job.ts`, `modules/billing/billing.service.ts` |
| Function | `runTrialExpiry` (`:115-149`), `runDunningCycle` (`:74-159`), `runRenewalCycle` (`:76-165`), `handleWebhookSuccess` (`:158-173`), `sweepScheduledCancellations` (`:326-347`) |
| Job / queue / trigger | `trial-expiry` 06:00, `renewal` 07:00, `dunning` 08:00 (cron) vs HTTP: Paymob webhook, `/billing/cancel`, `/billing/resume`, admin cancel / extend / reactivate |
| Failure scenario | the job reads the eligible set → an HTTP write changes one row → the job acts on its stale copy: an unconditional `update({ where: { id } })` (trial-expiry, sweep), or a charge followed by `handleWebhookSuccess`, which sets `ACTIVE` from any state and resets the period to now + cycle |
| Root cause | RC-01 (check-then-act across a transaction boundary); RC-06 (no per-period claim); RC-02 (the success handler accepts any source state, DB-25) |
| Current protection | none: no re-read, no `WHERE status = …` on the write, no lock shared with the HTTP writers |
| Why protection fails | the job's `withLock` excludes only other job instances, not HTTP writers |
| Evidence | S-A: T2 `PAST_DUE` with `SUCCESS:9001`, then `SUCCESS:5000` 3 days later. S-B: `SUCCESS:9201` + `SUCCESS:5001`, period +1 month. S-D1: `CANCELLED` → `ACTIVE`, `cancelled_at` still set. S-D2/S-D3: charged with `cancel_at_period_end = true`. S-H: `PAST_DUE`, `failed 1`, `trial_ends_at` +7 d |
| Business impact | double charges; charges after a cancellation (consumer-protection exposure); a paying customer shown as past-due and emailed "trial expired"; admin decisions silently undone |
| Remediation | every job write becomes conditional (`updateMany` with the expected `status`, `trial_ends_at`, `cancel_at_period_end`, `current_period_end`; act only if `count = 1`); dunning and renewal **claim** the period via the BG-01 intent row before charging and re-read the row inside the claim; `handleWebhookSuccess` applies only allowed transitions and extends from `max(now, current_period_end)`; split checkout-decline counting from renewal failures (DB-37) |
| Regression test | RT-BG03a … RT-BG03e (§42) |

#### BG-02 — An orphaned `withLock` key turns BullMQ's crash recovery into a silent no-op · **P2**

| Field | Detail |
|---|---|
| Severity | P2: a whole day's renewals, dunning or expiries skipped after any crash or forced shutdown during a cycle; it combines with BG-01 into a next-day double charge |
| File | `apps/api/src/shared/utils/lock.ts`; every cron worker in `jobs/` |
| Function | `withLock` (`:11-24`); the `start*Worker` processors |
| Job / queue / trigger | all four cron jobs; triggered by SIGKILL, OOM-kill, or SIGTERM with the 25 s budget exceeded (`index.ts:523-526`) |
| Failure scenario | the cycle holds `lock:<x>-cycle` (TTL 10 / 25 min) → the process dies (the `finally` does not run) → BullMQ marks the job stalled → the new process re-runs it → `SET NX` fails → `null` → "another instance holds the lock — skipping" → the job **completes** and is deleted |
| Root cause | RC-07: the app lock stands in for a progress record; BullMQ's per-job lock already provides exclusivity for a tick |
| Current protection | the TTL "auto-expires so the next scheduled tick can still run" (comment `lock.ts:4-9`); the next tick is 24 h later |
| Why protection fails | the TTL (≤ 25 min) is shorter than the tick interval (24 h) but longer than BullMQ's recovery (≈ 30–60 s), so the recovery always lands inside the TTL |
| Evidence | X5: `after SIGKILL … lock pttl 1498991` → `[Renewal] another instance holds the lock — skipping` → `completed` → job state `unknown`; T2 never processed. X6: the same with the real `index.ts` and SIGTERM (exit 1 at 25.0 s) |
| Business impact | missed renewals (service continues unpaid for a day), missed trial expiries, missed dunning; no trace except one `info` line |
| Remediation | rely on BullMQ's job lock for per-tick exclusivity. If cross-tick exclusion is still wanted, store the **job id** as the lock value, treat "held by my own job id" (i.e. a recovery of the same job) as acquired, renew it with the job, and release it by compare-and-delete (also fixes DB-L07). Alternatively make the cycle resumable per subscription (per-sub child jobs with deterministic ids) |
| Regression test | RT-BG02 |

#### BG-04 — Jobs make outbound HTTP calls with no timeout; one silent call blocks the worker for ≈ 300 s, and shutdown gives up after 25 s · **P2**

| Field | Detail |
|---|---|
| Severity | P2: availability of billing and ETA; it converts slow-provider incidents into BG-01 and BG-02 |
| File | `modules/billing/paymob.client.ts:25-37`; `modules/eta/eta.client.ts:31-70`; `index.ts:523-526` |
| Function | `paymobFetch`, `EtaClient.authenticate/submitDocuments`, `shutdown` |
| Job / queue / trigger | renewal, dunning (4 sequential Paymob calls per sub), ETA |
| Failure scenario | Paymob accepts the connection and never answers → undici's default `headersTimeout` fires after ≈ 300 s (X9: 301.0 s, `UND_ERR_HEADERS_TIMEOUT`) → meanwhile the concurrency-1 worker is busy; the next tick waits (X4: `day-1 job=active day-2 job=waiting`); a deploy sends SIGTERM → forced exit at 25 s (X6) |
| Root cause | RC-08 |
| Current protection | undici defaults only |
| Why protection fails | 300 s > the 25 s shutdown budget and > the BullMQ lock renewal tolerance for event-loop stalls; per-call, not per-cycle; and the timeout error is treated as "transient, retry the charge" (BG-01) |
| Evidence | X4, X6, X9 |
| Business impact | billing cycles stall for minutes per sub during provider incidents; deploys during cycles cause BG-02; a cycle can exceed the 25 min `withLock` TTL → overlapping cycles (L5-01) |
| Remediation | `AbortSignal.timeout()` on every Paymob/ETA call (≈ 10–20 s); classify a timeout on `/payments/pay` as **UNKNOWN** (resolve by inquiry), never as a plain transient; set the shutdown budget above the per-call timeout, or abort in-flight calls on SIGTERM and leave the intent `UNKNOWN` for reconciliation |
| Regression test | RT-BG04 |

#### BG-05 — `resend@3.5.0` never throws; email failures are silent, and the jobs record undelivered emails as sent · **P2**

| Field | Detail |
|---|---|
| Severity | P2: installment reminders and trial warnings are silently lost (and suppressed for 24 h / forever); billing notices (suspension, cancellation) are not delivered with no trace |
| File | `apps/api/src/shared/utils/email.ts:142-147, 238-243, 304-309, 327+`; callers `installment-reminders.job.ts:135-158`, `trial-expiry.job.ts:88-110, 137-146`, `billing.service.ts:186-197, 273-281` |
| Function | `sendEmail`, `sendInstallmentReminderEmail`, `sendInvoiceReceiptEmail`, `sendPasswordResetEmail` |
| Job / queue / trigger | reminders, trial-expiry, renewal/dunning (via the handlers); also the HTTP password reset and receipt flows |
| Failure scenario | Resend 4xx/5xx or a network error → `fetchRequest` resolves `{ data: null, error }` (`resend/dist/index.js:350-390`) → the `await` succeeds → the caller writes `reminder_sent` / bumps `trial_reminders_sent` / counts `sent++` |
| Root cause | library contract misread (independent); no check of the return value |
| Current protection | `try/catch` around every send, which is unreachable |
| Why protection fails | the library never rejects |
| Evidence | R2: Resend mocked to HTTP 500 → `sent: 4`, delivered 0, `reminder_sent` rows 2 + 2; the rerun after recovery: `skippedRecentlyReminded: 4`, delivered 0 |
| Business impact | customers miss installment reminders (collections), owners miss trial-ending and suspension notices (churn, disputes); operations believe emails were sent |
| Remediation | wrap the client: `const { error } = await resend.emails.send(...); if (error) throw …`; bump counters and write dedupe rows only after a confirmed send; optionally send an idempotency key derived from the dedupe key (resend@3.5.0 has no option for it; whether the account's Resend API honours an `Idempotency-Key` header is UNVERIFIED, U5-07) |
| Regression test | RT-BG05 |

#### BG-08 — ETA jobs have no per-invoice dedupe, never re-check invoice state, and retry permanent errors · **P2**

| Field | Detail |
|---|---|
| Severity | P2 (P1 once ETA is in launch scope); latent today behind DB-23 |
| File | `jobs/eta-submission.job.ts`; `modules/eta/eta.routes.ts:9-39`; `modules/eta/eta.submit.ts` |
| Function | `enqueueEtaSubmission` (`:29-31`), ETA worker processor (`:66-201`), `submitInvoiceToEta` |
| Job / queue / trigger | `submit` / `eta-submissions` / `POST /admin/eta/resubmit/:invoiceId` |
| Failure scenario | (a) two resubmits → two jobs, concurrency 3 → parallel submissions of one invoice; (b) the invoice is cancelled or returned after enqueue → still submitted; (c) accepted at ETA, response lost → recorded `failed` → retried → resubmitted; (d) SQL/config errors retried 5× as transient |
| Root cause | RC-05 (no idempotency key); RC-02 (`eta_status` written but not used as a state machine) |
| Current protection | the route refuses only `eta_status = 'accepted'` at enqueue time |
| Why protection fails | no `jobId`; the worker never reads `status` or `eta_status`; `submitted` is written but not consulted |
| Evidence | X7: `job ids 1 2`, both failing in lock-step; invoice `status: 'cancelled'` processed; `delayed: 2`, next delay 120 000 ms |
| Business impact | duplicate or contradictory tax documents; cancelled sales reported to the tax authority; misleading `failed` status for accepted documents |
| Remediation | `jobId: eta:<schema>:<invoiceId>`; claim with `UPDATE invoices SET eta_status='submitting' WHERE id=$1 AND eta_status IN ('pending','failed') AND status NOT IN ('cancelled', …) RETURNING …`; resolve unknown outcomes via `getDocumentStatus` before resubmitting; throw `UnrecoverableError` for 4xx and schema errors; fix DB-23 and the `eta_environment` mapping |
| Regression test | RT-BG08 |

#### BG-11 — No reconciliation: a charge that never reached the DB is undetectable, and the job records are deleted · **P2**

| Field | Detail |
|---|---|
| Severity | P2: it turns BG-01 from a recoverable incident into an invisible one |
| File | `jobs/dunning.job.ts:167-173` (`reconcilePayments`, no caller); `jobs/renewal.job.ts:17`, `jobs/dunning.job.ts:17` (`removeOnComplete: true`) |
| Function | `reconcilePayments`; the queue options |
| Job / queue / trigger | none (a missing job) |
| Failure scenario | any BG-01 path → the only record of the charge is at Paymob → nothing in Hesba compares |
| Root cause | RC-06 (no intent rows to reconcile against) |
| Current protection | a placeholder that logs one line |
| Why protection fails | not implemented; completed billing jobs vanish (X5: job state `unknown`) |
| Evidence | code; X5/X6 |
| Business impact | double charges and missing payments are found by customers, not by the platform |
| Remediation | with the intent table: a daily job that lists intents in `SUBMITTED`/`UNKNOWN` older than N minutes and queries Paymob by `merchant_order_id`; alert on mismatches; keep billing jobs (`removeOnComplete: { age: 30 d }`) |
| Regression test | RT-BG11 |

#### BG-06 — Reminder sent for an installment paid during the cycle · **P3**

| Field | Detail |
|---|---|
| File / function | `jobs/installment-reminders.job.ts` / `runReminderCycle` (`:95-158`) |
| Job / queue / trigger | `installment-reminders`, cron 09:00 and the manual route |
| Failure scenario | the list is read per tenant → a cashier records payment #2 → the loop reaches #2 and sends "due soon" |
| Root cause / protection | RC-01; none: no re-read before the send |
| Evidence | R4 (UTC): #2 `status: 'paid'`, `reminders: 1` |
| Impact | a confusing email to a customer who just paid; low |
| Remediation | re-check `status IN ('pending','overdue')` in the same statement that claims the reminder (the unique-row INSERT from §35 can be conditional: `INSERT … SELECT … WHERE EXISTS (… status='pending')`) |
| Regression test | RT-BG06 |

#### BG-07 — Reminders are sent on behalf of tenants whose subscription is cancelled or suspended · **P3**

| Field | Detail |
|---|---|
| File / function | `installment-reminders.job.ts:83-86` (`tenant.status = 'ACTIVE'` only) |
| Scenario | a tenant's subscription becomes `CANCELLED` (402 to its users) while `tenants.status` stays `ACTIVE` (two suspension mechanisms, P-05) → its customers keep receiving reminders in its name |
| Evidence | R5: tenant B `CANCELLED` → still emailed |
| Impact | a service delivered to a non-paying tenant; customer contact from a store that can no longer log in to record the payment |
| Remediation | join the subscription status (or unify the two mechanisms, P-05) |
| Regression test | RT-BG07 |

#### BG-09 — Redis unavailable at boot blocks `start()` indefinitely · **P3**

| Field | Detail |
|---|---|
| File / function | `index.ts:500-508`; `config/redis.ts:4-7` |
| Scenario | Redis down at boot → `await scheduleDunning()` waits forever (`maxRetriesPerRequest: null`) → the reminder, trial and renewal workers are not started, the SIGTERM handler is not installed, HTTP is up and healthy; ≈ 4 error lines per second per worker |
| Evidence | X1: unsettled at 10.2 s; resolved 0.4 s after Redis returned |
| Impact | silent: the orchestrator sees a healthy pod with no schedulers; log flood. Self-heals on reconnect |
| Remediation | give schedule registration a timeout and a retry loop that does not block the rest of start-up; register the SIGTERM handler first; a health or readiness signal for "workers running" |
| Regression test | RT-BG09 |

#### BG-10 — A Redis stall > 30 s re-executes the tick; correctness relies on predicates and `withLock` alone · **P3**

| Field | Detail |
|---|---|
| File / function | all cron workers; BullMQ defaults (`lockDuration` 30 s, `maxStalledCount` 1) |
| Scenario | a Redis freeze / partition / long event-loop block → job lock lost → `Missing lock … moveToFinished` → the stalled checker re-runs the tick |
| Evidence | X2: `w1 error Missing lock for job 1. moveToFinished` → `75s w1 stalled 1` → `active 1` → second `cycle complete: due=0` |
| Impact | none observed (the first run's writes made the re-run empty). It becomes BG-01 if the re-run starts while the first run's sub is between charge and record and `withLock` has expired (> 25 min cycle) |
| Remediation | fixed structurally by BG-01's intent claim; optionally a larger `lockDuration` for the billing workers |
| Regression test | RT-BG10 |

#### BG-12 — Redis data loss deletes every repeatable schedule until the next boot · **P3**

| Field | Detail |
|---|---|
| File / function | `schedule*()` in `jobs/*.ts`, called only from `start()` |
| Scenario | Redis restarted without its data (volume loss, `FLUSHALL`, future eviction policy) → `bull:<q>:repeat` keys gone → renewal, dunning, trial expiry and the cancel sweep stop; nothing logs it |
| Evidence | X2 tail: `repeatables before 1 … after restart 0` |
| Impact | billing stops silently until a deploy. Prod has an RDB volume (`docker-compose.prod.yml:20-26`), so the trigger is rare |
| Remediation | re-assert the schedules on every Redis `ready` event or periodically (it is idempotent, X8); alert on "no renewal cycle completed in 26 h" |
| Regression test | RT-BG12 |

#### BG-13 — Trial-expiry: one failing row skips the remaining expiries and the cancel sweep, and the job never retries · **P3**

| Field | Detail |
|---|---|
| File / function | `trial-expiry.job.ts:119-149` (no per-sub `try`); queue `attempts` default 1 (`:22-27`) |
| Scenario | one `subscription.update` or `redis.del` throws → the processor throws → steps 2 (rest) and 3 (sweep) are skipped → next day |
| Evidence | code (renewal and dunning wrap per sub; trial-expiry does not) |
| Impact | expiries and scheduled cancellations delayed by 24 h (cancelled customers keep access; cancel-scheduled subs remain chargeable by dunning for another day, DB-08) |
| Remediation | per-row `try/catch` as in renewal; run the sweep independently; `attempts: 3` |
| Regression test | RT-BG13 |

#### BG-14 — The reminder date window depends on the process timezone · **P3**

| Field | Detail |
|---|---|
| File / function | `installment-reminders.job.ts:70-73, 98` |
| Scenario | `today.setHours(0,0,0,0)` is process-local; `due_date` is `@db.Date`, which Prisma compares as a UTC date → in `Africa/Cairo` the horizon truncates to 2 days and installments due on day 3 get no "due soon" reminder |
| Evidence | R1 under Cairo TZ: 2 reminders in total; under `TZ=UTC`: 4 |
| Impact | none in the current UTC container; a latent change-of-environment bug |
| Remediation | compute dates in a fixed business TZ and pass date strings |
| Regression test | RT-BG14 |

#### BG-15 — Job observability and retention are insufficient for financial forensics · **P3**

| Field | Detail |
|---|---|
| File | `jobs/*.ts` (console logging, `removeOnComplete: true`, no `failed` listener except ETA, ETA `removeOnFail: false`) |
| Scenario | after an incident there is no job id, attempt number or duration in logs; completed billing jobs are deleted; expected P2002s appear as `prisma:error`; ETA failed jobs accumulate in Redis forever |
| Evidence | S-C/S-E logs; X5 `unknown` job state; the config table §5 |
| Impact | slower diagnosis; alert fatigue from false `prisma:error`s |
| Remediation | a structured job logger (job id, attempt, tenant/sub id, outcome, ms); `worker.on('failed')` on every worker; keep billing jobs 30 days; cap ETA failed jobs; disable Prisma error logging for the expected P2002 or catch it before Prisma logs it |
| Regression test | RT-BG15 (log-shape assertion) |

### 37.3 Prior findings re-confirmed or re-rated by Phase 5

| Prior ID | Phase 5 result | Change |
|---|---|---|
| **FIN-L1** (DB-L01, FIN-P3) | **CONFIRMED at runtime** (S-F, X3, X5, X6) | LIKELY → **CONFIRMED**, merged into BG-01 (P1 unchanged) |
| **DB-19** | confirmed with real workers; the chain continues into a **second charge** (S-A) | **P2 → P1** (part of BG-03) |
| **DB-L03** | confirmed (S-D3) | LIKELY → **CONFIRMED** (part of BG-03; P2) |
| **DB-08** | confirmed again; extended: an interactive payment during dunning also double-charges (S-B), and an admin cancel is reversed (S-D1) | P1 unchanged; scope wider |
| **DB-25** | new path: a dunning success re-activates an admin-cancelled sub mid-cycle (S-D1) | P3 → covered by BG-03 (P1) for the job path |
| **DB-26 / HSEC-05** | confirmed at runtime: cross-tenant (R1) and duplicate (R3) | unchanged (P1 / P3). New: the response leaks platform-wide counts |
| **DB-37** | confirmed at runtime (S-I: `PAST_DUE` with 10 trial days left) | unchanged |
| **B-07** | confirmed at runtime and quantified (300 s, X9) | P2 → BG-04 |
| **DB-23** | confirmed through BullMQ (X7) | unchanged |
| **DB-09** | extends to workers (§25, BG-09) | unchanged |
| **DB-L07** (lock DEL without owner) | still LIKELY as stated; Phase 5 found the more damaging property of the same helper (BG-02) | unchanged |
| **FIN-16** | re-confirmed by code: no job escalates a cardless `PAST_DUE`; enforcement ignores `PAST_DUE` | unchanged |
| **FIN-L3** (`pending` treated as a decline) | still LIKELY; adds a double-charge path if the pending charge later settles | unchanged |

### 37.4 Requested cross-checks

| ID | Phase 5 verdict |
|---|---|
| **DB-01** (pending installment invoices cancellable / returnable; approval revives cancelled invoices) | **Not job-related.** No job reads or writes invoices, contracts or stock (the only invoice-touching job is ETA, which writes ETA columns only). Unchanged P0; no new root cause |
| **DB-08** | Confirmed and widened (S-B, S-D1, S-D2). It is a **symptom** of RC-06 plus RC-01: the dunning selection has no period claim and no re-check. Fixing only the selection predicate (Phase 4's remedy) would still leave S-B and S-D1 open; the per-period intent closes all of them |
| **HSEC-05** | Confirmed at runtime (R1, R3). Severity P1 stands |
| **FIN-04** (return of a pending installment invoice) | Not job-related; unchanged |
| **FIN-07** (double execution of approve/cancel/return/receive) | HTTP-side; no job shares those entities. Unchanged. The *job-side analogue* is BG-03 |
| **FIN-08** (absolute SETs / lost updates) | In jobs: `failed_attempts` (DB-24) confirmed again by code; trial-expiry and sweep writes are absolute status SETs from stale reads (BG-03) |
| **FIN-09** (no idempotency) | HTTP side = DB-10; the job side = BG-01 (toward Paymob) and BG-08 (toward ETA). Same root cause, RC-05 |
| **FIN-16** | Re-confirmed (above) |
| Other billing findings from Phase 4.5 | FIN-17 (no payment record / amount check): the central enabler of BG-01, BG-03 and BG-11. FIN-L2 / HSEC-21: unchanged (webhook-side). B-03 (refund no-op): unchanged; with an intent table it becomes implementable. DB-24, DB-37, P-04, P-05: unchanged; P-05 now also explains BG-07. DB-P01 (FAILED then SUCCESS for one tx): unchanged |

**New root cause?** None. Phase 5 shows that the background-job defects are **RC-06 + RC-01 + RC-07 seen under at-least-once execution**. One refinement is worth recording against RC-07: the app uses a **Redis lock as a substitute for a progress record**. That is why crash recovery is suppressed (BG-02).

---

## 38. Likely Findings

| ID | Sev. | Finding | Basis |
|---|---|---|---|
| **L5-01** | P2 | **Overlapping billing cycles if a cycle exceeds the `withLock` TTL.** With BG-04 (≈ 300 s per silent call × 4 calls per sub), a renewal or dunning cycle over 25 min loses its lock. Any second trigger (stall recovery, manual enqueue, another tick) then runs a parallel cycle on the same stale list and charges each remaining sub twice. Not run (it needs 25 min of hung calls) | code + X4 + X9 |
| **L5-02** | P3 | The ETA worker trusts `job.data.schemaName` and ignores `tenantId`. Anyone with Redis write access can direct a job at any tenant schema. Redis has `requirepass` in prod; defence in depth only | code |
| **L5-03** | P3 | `getEtaQueue()` creates a new `Queue` on every `enqueueEtaSubmission` and never closes it: per-request object and listener growth on the shared connection | code (`eta-submission.job.ts:17-31`) |
| **L5-04** | P3 | The reminder cycle walks every tenant through the 50-entry LRU of Prisma clients. With more than 50 tenants it evicts clients and `$disconnect`s ones that HTTP requests may be using mid-transaction (DB-29), daily at 09:00 | code + Phase 4 DB-29 |
| **L5-05** | P3 | `/billing/resume` racing the 06:00 cancel sweep cancels a resumed subscription (same stale-list shape as S-H; not run) | code |
| **L5-06** | P3 | Admin reactivate racing dunning charges a just-reactivated subscription (same shape as S-B; not run) | code |
| **FIN-L3** (prior) | P2 | A Paymob `pending: true` token charge is recorded as a decline; if it later settles, the next dunning retry charges again | code (`renewal.job.ts:132`, `dunning.job.ts:137`) |

---

## 39. Potential Findings

| ID | Sev. | Finding |
|---|---|---|
| **P5-P01** | P3 | Editing a cron string, `name`, `jobId` or `tz` in a `schedule*()` function leaves the old repeatable registered, so both schedules fire (X8 demonstrates the mechanism). Git history shows no such edit yet |
| **P5-P02** | P3 | `handleWebhookSuccess/Failure` select `subscription.findFirst({ where: { tenantId } })` **without** `orderBy`, while cancel, resume, status and the middleware use `createdAt desc`. `subscriptions.tenant_id` has no UNIQUE. A second subscription row (a future plan-change flow) would make the payment land on an arbitrary row |
| **P5-P03** | P3 | `trial-expiry` writes `failed_attempts = 1` for an expired trial. If any future flow stores a card on a `TRIALING` sub, that sub immediately becomes a dunning target 3 days after expiry, without the customer ever having started a paid plan |
| **P5-P04** | P3 | Dunning sends `billing_data.email = ''` and `phone_number = ''`. If Paymob rejects that for token charges, every dunning retry fails with an API error → `transientFailures` → the whole cycle retried 3× daily, and no sub ever escalates (U5-04) |

---

## 40. Unverified Items

| ID | Item | Why it matters | How to verify |
|---|---|---|---|
| **U5-01** | Whether the Paymob recurring (token) integration has a transaction-processed callback URL configured in the dashboard | Decides whether BG-01's retry is sometimes rescued by a timely webhook | Paymob dashboard → integration settings (no access in this audit) |
| **U5-02** | Whether Paymob rejects a duplicate `merchant_order_id` | A deterministic order id would then give gateway-side dedupe for free | Paymob sandbox |
| **U5-03** | Whether ETA rejects or dedupes a re-submitted identical document (same `internalId`) | Decides whether BG-08(c) creates a duplicate or a false "rejected" | ETA preprod |
| **U5-04** | Whether Paymob accepts empty `email`/`phone_number` in token-charge billing data (dunning) | P5-P04 | Paymob sandbox |
| **U5-05** | Production topology: number of API replicas (every replica runs all workers), Redis `maxmemory` and policy, whether the RDB volume is backed up | Scales L5-01, BG-12 | infra access |
| **U5-06** | How often Paymob returns `pending: true` for token charges | FIN-L3 impact | Paymob support / data |
| **U5-07** | Whether the Resend API version used honours an `Idempotency-Key` header | BG-05 remediation option | Resend docs / sandbox |

---

## 41. Remediation Priority

Ordered by risk reduction per unit of work. **No fix was implemented** (read-only audit).

| # | Change | Closes | Effort |
|---|---|---|---|
| 1 | **Per-period charge intent** (§14): insert `PENDING` before `createOrder`, deterministic `merchant_order_id`, partial UNIQUE (subscription, period), `UNKNOWN` resolved by Paymob inquiry before any retry; webhook binds to the intent and checks the amount | BG-01, BG-03 (charge halves), BG-11 (enables reconciliation), FIN-17, FIN-L1, FIN-L2, HSEC-21 (job path), DB-08 core, DB-37 (with `kind`) | M (one table, two job loops, one handler) |
| 2 | **Conditional writes in every job** (`updateMany` with the expected state; skip on `count = 0`); `handleWebhookSuccess` allowed-source-states + `max(now, period_end)` extension | BG-03 (overwrite halves: S-A, S-D1, S-H), DB-19, DB-25, L5-05, L5-06 | S |
| 3 | **Timeouts**: `AbortSignal.timeout` on Paymob/ETA calls; a timeout on `/payments/pay` = `UNKNOWN`, not transient; shutdown budget > call timeout, or abort calls and leave the intent `UNKNOWN` | BG-04, L5-01, reduces BG-02 | S |
| 4 | **Fix `withLock` semantics**: lock value = job id, re-entrant for the same job, compare-and-delete, renewed with the job; or drop it and use per-sub child jobs with deterministic ids | BG-02, DB-L07, BG-10 | S |
| 5 | **Reminder route**: remove it from tenant scope (platform-admin only), or scope it to `request.tenant` and run under the lock; reminder claim row inserted **before** the send, conditional on `status='pending'` | HSEC-05, DB-26, BG-06 | S |
| 6 | **Email result checking** (throw on `{ error }`); counters and dedupe rows only after a confirmed send | BG-05 | XS |
| 7 | **ETA**: `jobId` per invoice; a DB claim with a status check; `UnrecoverableError` for permanent errors; status inquiry before resubmitting; with DB-23 | BG-08 | S (after DB-23) |
| 8 | **Self-healing schedules** (re-assert on Redis `ready`); non-blocking boot registration with timeout; alert when a daily billing cycle has not completed in 26 h | BG-09, BG-12, P5-P01 (plus remove stale repeat keys on boot) | S |
| 9 | **Trial-expiry robustness**: per-row try/catch, an independent sweep, `attempts: 3` | BG-13 | XS |
| 10 | **Reconciliation job** over the intent table + retention of billing jobs for 30 days + a structured job logger | BG-11, BG-15 | M |
| 11 | Reminders: subscription-aware tenant filter; fixed business TZ | BG-07, BG-14 | XS |

**Sequencing:**
- **1 and 2 together** remove every double-charge path observed in this phase (S-A, S-B, S-F, X3, X5, X6) and every charge-after-cancel path (S-D1, S-D2, S-D3).
- **3 and 4** remove the operational triggers that feed them.
- **5** is also Phase 4.5's top-5 item #5 (default-deny authorization).

---

## 42. Regression Tests

**Common harness.** This is what Phase 5 used; it is reproducible from §43.
- **Throwaway infrastructure:** PostgreSQL 16 and Redis 7 containers on loopback ports; the master schema from `prisma migrate deploy`; tenant schemas from `runTenantMigrations`.
- **Environment:** every key of the repo `.env` set explicitly to a throwaway value. `dotenv` never overrides an existing variable, so no real secret or URL can leak in.
- **Network guard:** `globalThis.fetch` is wrapped. Non-loopback hosts throw; `api.resend.com` is answered locally with a controllable 200/500 and delay.
- **Mock Paymob:** a local HTTP server implementing `/auth/tokens`, `/ecommerce/orders`, `/acceptance/payment_keys`, `/acceptance/payments/pay`. It records every charge and supports `success | decline | reset-after-charge | 500-after-charge | hang` and hooks `beforeAuth`, `beforePay`, `afterCharge`.
- **Jobs:** run through the **real** worker: `startXWorker()` + `getXQueue().add(name, {}, { attempts })`, then wait for `completed`/`failed`. The cycle functions are not exported, so tests that want the in-process cycle without BullMQ would need an export (a test-only change, deferred).

**Assertions are on durable outcomes only:** gateway charge count per card, `payment_attempts` rows, subscription columns, emails delivered by the mock.

### RT-BG01 — a retry after a post-charge failure must not charge again (P1)

```ts
// Arrange: ACTIVE sub, period ended, card 'card_A', failed_attempts 0.
paymob.beforePay = async () => { paymob.mode = firstCall ? 'reset-after-charge' : 'success'; firstCall = false }
// Act: real renewal worker, real BullMQ retry (attempts 3, 60 s exponential)
await renewalQueue.add('t', {})
await waitFor(() => jobCompletedOrFailed)
// Assert
expect(paymob.charges.filter(c => c.card === 'card_A' && c.outcome !== 'decline')).toHaveLength(1) // today: 2 → FAILS
expect(await paymentAttempts('card_A')).toHaveLength(1)
```

Variants, same assertion:
- (b) `afterCharge` blocks DB connections for 5 s (X3).
- (c) the worker process is SIGKILLed after the charge; a new worker process runs the next tick (X5).
- (d) the real `index.ts` receives SIGTERM while the charge hangs (X6).
- (e) the same for the dunning queue.

### RT-BG03a — payment during the trial-expiry loop (P1)

```ts
// two TRIALING subs expired; Resend mock delay 1500 ms
const run = trialQueue.add('t', {}, { attempts: 1 })
await sleep(700)                                    // T1's email in flight; T2 already selected
await handleWebhookSuccess({ transactionId: 9001, cardToken: 'card_T2', merchantOrderId: `sub_${t2}_1`, … })
await run.finished()
expect(sub(t2).status).toBe('ACTIVE')               // today: PAST_DUE → FAILS
// +3 days
await setLastFailedAt(t2, -3.1 days); await runDunning()
expect(charges('card_T2')).toHaveLength(0)          // today: 1 → FAILS
```

### RT-BG03b — interactive payment during dunning (P1)

```ts
// ACTIVE, failed_attempts 1, last_failed_at −4 d, card_B
paymob.beforeAuth = () => handleWebhookSuccess({ transactionId: 9201, cardToken: 'card_B', … })
await runDunning()
expect(successRows(subB)).toHaveLength(1)           // today: 2 → FAILS
expect(charges('card_B')).toHaveLength(0)
```

### RT-BG03c — admin cancel during dunning (P1)

```ts
paymob.beforeAuth = () => prisma.subscription.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
await runDunning()
expect(sub.status).toBe('CANCELLED')                // today: ACTIVE → FAILS
expect(charges('card_D1')).toHaveLength(0)
```

### RT-BG03d — user cancel during renewal and during dunning (P1)

```ts
paymob.beforeAuth = () => cancelSubscription(tenantId)   // cancel-at-period-end
await runRenewal()   // and, separately, runDunning()
expect(charges(card)).toHaveLength(0)               // today: 1 → FAILS
```

### RT-BG03e — admin extend-trial during trial expiry (P1)

```ts
// as RT-BG03a, but the mid-loop action is the admin extend update (+7 d)
expect(sub(t2)).toMatchObject({ status: 'TRIALING', failedAttempts: 0 }) // today: PAST_DUE / 1 → FAILS
```

### RT-HSEC05 — the reminder trigger is tenant-scoped and cannot double-send (P1, re-confirmed)

```ts
// two tenant schemas, each with one customer and two due installments; TZ=UTC
const res = await app.inject({ method: 'POST', url: '/api/installments/send-reminders',
                               headers: authAs(tenantA, 'installments:update') })
expect(delivered.map(e => e.to)).not.toContain(customerOf(tenantB))   // today: contains → FAILS
// concurrency: cron job + manual route at once
await Promise.all([reminderQueue.add('t', {}), app.inject(/* … */)])
expect(delivered.length).toBe(new Set(delivered.map(e => e.to + e.subject)).size) // today: 8 vs 4 → FAILS
```

### P2 / P3 tests (shorter)

| Test | Arrange / act | Assert (fails today) |
|---|---|---|
| RT-BG02 | SIGKILL a worker process mid-cycle (2 subs; the first charge hangs); start a new worker process | within 2 min **both** subs are processed (today: the lock skip; T2 untouched) |
| RT-BG04 | Paymob `hang` | the job fails or completes within the configured timeout (today: ≈ 300 s); the outcome is recorded `UNKNOWN`, not retried as a charge |
| RT-BG05 | Resend mock returns 500 | `summary.sent === 0`, no `reminder_sent` rows, `trial_reminders_sent` unchanged (today: sent 4, rows written) |
| RT-BG06 | mark the installment paid while the cycle's email for a previous row is delayed | no email for the paid row (today: sent) |
| RT-BG07 | tenant subscription `CANCELLED`, `tenants.status` `ACTIVE` | no emails for that tenant (today: sent) |
| RT-BG08 | two `enqueueEtaSubmission` for one invoice; a cancelled invoice | one job; the cancelled invoice not submitted; schema error → failed after 1 attempt (`UnrecoverableError`) |
| RT-BG09 | Redis stopped at boot | all five workers constructed and the SIGTERM handler installed within N s; a readiness signal is false until the schedules are registered |
| RT-BG10 | `docker pause` Redis 45 s mid-cycle | at most one charge per sub (passes today; keep as a guard after the refactors) |
| RT-BG11 | BG-01 variant (a) | the reconciliation job flags the orphan charge |
| RT-BG12 | `FLUSHALL` while running | the repeatables are restored within N s without a restart |
| RT-BG13 | inject a failure on the first expiry UPDATE | the other expiries and the sweep still applied |
| RT-BG14 | run the reminder cycle under `TZ=Africa/Cairo` and `TZ=UTC` | identical recipient sets |
| RT-BG15 | any failed billing cycle | a structured log line with `jobId`, `attempt`, `subscriptionId`, `outcome` |

All tests must point at throwaway containers. A guard should refuse to run if `DATABASE_MASTER_URL` or `REDIS_URL` is not loopback.

---

## 43. Evidence Ledger

**Infrastructure (throwaway, loopback only):**
- Docker containers `hesba-p5-pg` (postgres:16-alpine, 127.0.0.1:55433, DB `hesba_p5`) and `hesba-p5-redis` (redis:7-alpine, 127.0.0.1:56379, no persistence).
- Master schema via `prisma migrate deploy` (8 migrations).
- Tenant schemas `tenant_p5_ra` and `tenant_p5_rb` via the real `runTenantMigrations`.
- Mock Paymob on 127.0.0.1:58080. Resend answered in-process by the fetch guard.
- Both containers were deleted at the end of the audit.

**Harness location:** scratchpad `phase5/`, outside the repository (temporary). Every script imports the **real** application modules by absolute path.

| Ref | Script | What ran | Key output |
|---|---|---|---|
| **S-F** | `f_renewal_retry.ts` | real renewal worker + BullMQ retry; T1 charge reset after commit, T2 ok, T3 declined | `failed attempt=1 renewal_cycle_partial_failure:1` → `completed attemptsMade=2` (61 s). T1 `gatewayCharges: ['reset-after-charge','success']`, rows `['SUCCESS:5003']`; T2 1 charge; T3 1 decline, `failedAttempts 1` |
| **S-A … S-I** | `f_billing_races.ts` (log `billing_races.log`) | real trial-expiry, renewal and dunning workers; real `handleWebhookSuccess/Failure`, `cancelSubscription`; admin updates replicated verbatim from `admin.routes.ts:532-540, 579-582` | A: T2 `PAST_DUE` + `SUCCESS:9001`, then +3 d `SUCCESS:5000`; emails "payment succeeded", "trial expired", "payment succeeded". A′: `ACTIVE`. B: `SUCCESS:9201`, `SUCCESS:5001`, period_end 2026-11-08. C: 1 row, 1 email. D1: `ACTIVE`, `cancelledAt: set`, `SUCCESS:5003`. D2/D3: `cancelAtPeriodEnd: true`, charged. E: 1 row, 1 email. H: `PAST_DUE`, `trialEndsAt 2026-10-15`, `failedAttempts 1`. I: `PAST_DUE` with the trial ending 2026-10-18 |
| **R1–R5** | `f_reminders.ts` (logs `reminders.log` in `Africa/Cairo`, `reminders_utc.log` in UTC) | real `runReminderCycle`, real reminder worker, two real tenant schemas + one missing schema | R1 (UTC): `sent: 4`, recipients include both tenants' customers; missing schema → `errors: 1`, others processed. R2: Resend 500 → `sent: 4`, delivered 0, rows 2 + 2; rerun `skippedRecentlyReminded: 4`. R3: delivered 8, distinct 4. R4: paid #2 got `reminders: 1`. R5: CANCELLED-subscription tenant still emailed. Cairo vs UTC: 2 vs 4 reminders |
| **X1** | `f_redis_startup.ts` | `index.ts` start order with Redis stopped | `scheduleDunning` and `withLock` unsettled at 10.2 s; ≈ 80 error lines; both resolved at 10.8 s after Redis started at 10.4 s; 1 repeatable |
| **X2** | `f_redis_midjob.ts` | 2 renewal workers; `docker pause` 45 s during the first charge; then `docker restart` (wipe) | `could not renew lock for job 1`; `Missing lock for job 1. moveToFinished`; `75s w1 stalled 1` → re-run `due=0`; 1 charge per sub. Wipe: repeatables 1 → 0, delayed 1 → 0 |
| **X3** | `f_dbfail_hang.ts` (DB1) | `ALLOW_CONNECTIONS false` + `pg_terminate_backend` right after the mock charged | `failed attempt=1` → DB back at 5 s → `completed` at 60 s; `gatewayCharges: 2, rows: 1` |
| **X4** | `f_dbfail_hang.ts` (H1) | Paymob `hang`; the day-2 job enqueued after the lock was cleared | after 40 s: `day-1 job=active`, `day-2 job=waiting`, concurrency 1 |
| **X5** | `f_crash.ts` + `w_child.ts` | worker in a child process group; SIGKILL after the charge; new child; then a "next day" job | `lock:renewal-cycle pttl 1498991`; `[Renewal] another instance holds the lock — skipping` → `completed` → state `unknown`; T2 untouched; next day T1 `gatewayCharges: ['hang','success']`, 1 row |
| **X6** | `f_sigterm.ts` + `app_child.ts` | the **real** `apps/api/src/index.ts` (all workers + schedules) as a child; SIGTERM during a hung charge; second boot | `shutdown_timed_out — forcing exit`, exit code 1 at 25.0 s; job `active`, lock PTTL 1 474 757; APP2: `another instance holds the lock — skipping`; T1 1 charge / 0 rows, T2 0 charges; registered repeatable `daily-renewal 0 7 * * * tz=null` |
| **X7** | `f_eta.ts` | real ETA worker; two `enqueueEtaSubmission` for one **cancelled** invoice | `job ids 1 2`; both `failed attemptsMade=1 … 42703 column ts.eta_signing_cert_pem does not exist` at 0 s and again at 30.1 s; `delayed: 2`; next delay 120 000 ms |
| **X8** | `f_sched.ts` | 3 concurrent `scheduleRenewal()`, a restart, then an edited pattern | `['0 7 * * *']` → `['0 7 * * *']` → `['0 7 * * *', '0 5 * * *']` |
| **X9** | `fetch_timeout.cjs` | Node `fetch` against a server that never answers | `node v23.11.0: fetch rejected after 301.0 s: UND_ERR_HEADERS_TIMEOUT` (prod image is `node:20-alpine`; undici's default `headersTimeout` is the same 300 s) |
| L-1 | library source | `bullmq/dist/cjs/classes/worker.js:34` defaults; `repeat.js` key derivation; `queue.js:179-185` legacy repeat path; `worker.js:757-779` `close()` | §5 |
| L-2 | library source | `resend/dist/index.js:350-390`: `fetchRequest` returns `{ data, error }` and catches every exception | BG-05 |
| L-3 | code | `index.ts:484-536`; `jobs/*.ts`; `billing.service.ts`; `billing.routes.ts`; `admin.routes.ts:510-640`; `installment.routes.ts:216-224`; `eta.routes.ts`; `eta.submit.ts`; `paymob.client.ts`; `lock.ts`; `config/redis.ts`; `config/database.ts`; `tenant.middleware.ts:86-112` | throughout |
| L-4 | git | `git log -S"repeat: { pattern" -- apps/api/src/jobs`: patterns only ever added, never edited | P5-P01 |

**Harness corrections recorded for honesty:**
- The first SIGKILL run killed only the `npx` wrapper, and the worker survived. It was re-run with process-group kill (`detached` + `kill(-pid)`); only the corrected run is reported.
- The first `index.ts` child failed to start (top-level `await` under CJS) and was re-run.
- The first Redis-startup run removed the `--rm` container. It was recreated without `--rm`.
- The Cairo-TZ reminder run hid R4, so R1–R5 were re-run under `TZ=UTC`, the container default; the TZ difference became BG-14.

---

## Audit Declaration

| | |
|---|---|
| Source files modified | **NO** |
| Migrations modified | **NO** |
| Database modified | **NO** (only throwaway containers, now deleted) |
| Production accessed | **NO** |
| Redis production accessed | **NO** |
| Throwaway services used | Docker `postgres:16-alpine` (127.0.0.1:55433) and `redis:7-alpine` (127.0.0.1:56379), both deleted after the run; a local mock Paymob HTTP server (127.0.0.1:58080); Resend answered in-process; every non-loopback `fetch` blocked; every `.env` key overridden. Docker Desktop was started for this audit |
| Tests executed | 12 harness scripts / 30+ scenarios: S-F, S-A, S-A′, S-B, S-C, S-D1, S-D2, S-D3, S-E, S-H, S-I, R1–R5 (×2 TZs), X1–X9; no repository test suites were run (none cover jobs) |
| Temporary files | scratchpad `phase5/`: `h.ts`, `env.sh`, `f_*.ts`, `w_child.ts`, `app_child.ts`, `fetch_timeout.cjs`, `*.log` (outside the repository) |
| Report path | `documents/audit/Hesba_Phase5_Background_Jobs_Audit.md` |
