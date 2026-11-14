# Hesba W1 — commit and PR plan

Date: 2026-10-21. Source: worktree `.claude/worktrees/w1-safety-net` (base `7317c97` = `main`). 350 files: 116 modified, 234 new.

**Status (2026-10-21): committed locally as planned, on the owner's go-ahead ("create the 15 stacked branches and commits in the worktree exactly as in the plan. Do not push or open PRs yet"). Nothing pushed; no PR opened.** Each commit was checked to contain exactly its planned files, and each parent is the previous PR; the worktree is now on `w1/15-pos` with a clean working tree.

| PR | Branch | Commit | Title |
|---|---|---|---|
| 01 | `w1/01-tooling` | `fb15808` | chore(ci): test harness, CI and ignore rules |
| 02 | `w1/02-database` | `8ce1911` | feat(db): tenant migrations 018–027, master migrations, safe migration runner |
| 03 | `w1/03-server-foundation` | `128cca3` | feat(api): server foundation — config, middleware, shared utilities |
| 04 | `w1/04-billing` | `cfbb7cc` | feat(billing): exactly-once subscription charges and signed webhooks |
| 05 | `w1/05-auth-tenants` | `fa997bc` | feat(auth): sessions, admin hardening, tenant provisioning |
| 06 | `w1/06-eta` | `9bddc9a` | feat(eta): feature-gated e-invoice outcome model and manual cancellation |
| 07 | `w1/07-catalogue-stock` | `6966239` | feat(stock): stock, purchasing and transfers integrity |
| 08 | `w1/08-sales` | `1d7710d` | feat(sales): server pricing, refunds, credit ledger and exactly-once sales |
| 09 | `w1/09-installments` | `0721769` | feat(installments): contract lifecycle, settlement and reminders |
| 10 | `w1/10-reports` | `ee4919c` | feat(reports): consistent snapshots, store time zone, bounded exports |
| 11 | `w1/11-app-ops` | `a5335ed` | feat(ops): app wiring, process roles, health, Docker/compose, backups, integration suite |
| 12 | `w1/12-web-foundation` | `183de7f` | feat(web): API client, stores, shared components and libraries |
| 13 | `w1/13-web-auth-billing` | `9404d3b` | feat(web): sign-in, session and billing screens |
| 14 | `w1/14-web-business` | `937ce7f` | feat(web): business screens and router |
| 15 | `w1/15-pos` | `c5747cc` | feat(pos): server quote, idempotent sale, offline policy |
| 16 | `w1/16-trial-fixes` | `80d020b` | fix: trial findings — fee base, return P&L reversal, installment invoice numbers, plan gate on reload |

PR 16 was added after the full-cycle trial (tracking report §5N.19–§5N.20). Local `main` is fast-forwarded to `80d020b`; nothing is pushed.

## How the split was made

- **File-granular.** Each file goes to exactly one PR, so no file has to be split into hunks. Several files carry fixes for many findings (e.g. `invoice.service.ts`), so PRs are themed layers, not one PR per finding.
- **Dependency-ordered.** Each file was given a theme, then moved later if it imports — or reads as text — a changed file from a later PR. Two signature changes travel with their callers (`config/r2.ts` with the product and customer routes; `lib/print.ts` with the invoice screens).
- **Proved step by step.** For k = 1…15, a scratch copy of `7317c97` plus PRs 1…k was type-checked (database, API, web) and unit-tested. Every intermediate state compiles and passes:

```text
(step 0 = base 7317c97; step k = base + PRs 01…k; API tests run up to step 11 and at 15, web tests from step 12)
base:       db ok | api ok | web ok | api tests: 61 passed (61)
after PR 1: db ok | api ok | web ok | api tests: 80 passed (80)
after PR 2: db ok | api ok | web ok | api tests: 91 passed (91)
after PR 3: db ok | api ok | web ok | api tests: 233 passed (233)
after PR 4: db ok | api ok | web ok | api tests: 276 passed (276)
after PR 5: db ok | api ok | web ok | api tests: 375 passed (375)
after PR 6: db ok | api ok | web ok | api tests: 407 passed (407)
after PR 7: db ok | api ok | web ok | api tests: 426 passed (426)
after PR 8: db ok | api ok | web ok | api tests: 602 passed (602)
after PR 9: db ok | api ok | web ok | api tests: 682 passed (682)
after PR 10: db ok | api ok | web ok | api tests: 750 passed (750)
after PR 11: db ok | api ok | web ok | api tests: 810 passed (810)
after PR 12: db ok | api ok | web ok | web tests: 94 passed (94)
after PR 13: db ok | api ok | web ok | web tests: 113 passed (113)
after PR 14: db ok | api ok | web ok | web tests: 233 passed (233)
after PR 15: db ok | api ok | web ok | api tests: 842 passed (842) | web tests: 265 passed (265)
```

- The real-database suite (18 files / 91 tests, PostgreSQL + Redis) passed on the final state (§5N.16 of the tracking report).

## Release rule

Merge the PRs **in order**, each on top of the previous (stacked). **Do not deploy part of the stack**: tenant migrations run automatically at boot, and e.g. migration 027 writes ledger opening balances that only stay correct once PR 08 writes ledger rows. Deploy once, after PR 15, and only after the Phase 11 §9.2 gates (backups, verified host, PV answers).

## The PRs

| # | Branch | Title | Files (new) | +/− lines | Findings | Release blockers |
|---|---|---|---|---|---|---|
| 01 | `w1/01-tooling` | chore(ci): test harness, CI and ignore rules | 11 (4) | +786 / −21 | 2 | — |
| 02 | `w1/02-database` | feat(db): tenant migrations 018–027, master migrations, safe migration runner | 25 (20) | +1217 / −423 | 5 | — |
| 03 | `w1/03-server-foundation` | feat(api): server foundation — config, middleware, shared utilities | 58 (40) | +3069 / −131 | 16 | CF-017, CF-023 |
| 04 | `w1/04-billing` | feat(billing): exactly-once subscription charges and signed webhooks | 12 (6) | +1247 / −452 | 13 | CF-006, CF-007, CF-008, CF-009, CF-010, CF-021 |
| 05 | `w1/05-auth-tenants` | feat(auth): sessions, admin hardening, tenant provisioning | 26 (18) | +2022 / −189 | 19 | CF-024 |
| 06 | `w1/06-eta` | feat(eta): feature-gated e-invoice outcome model and manual cancellation | 14 (8) | +1150 / −388 | 6 | — |
| 07 | `w1/07-catalogue-stock` | feat(stock): stock, purchasing and transfers integrity | 11 (5) | +591 / −125 | 6 | CF-015 |
| 08 | `w1/08-sales` | feat(sales): server pricing, refunds, credit ledger and exactly-once sales | 31 (21) | +3676 / −321 | 36 | CF-001, CF-003, CF-004, CF-011, CF-013, CF-014, CF-016, CF-019 |
| 09 | `w1/09-installments` | feat(installments): contract lifecycle, settlement and reminders | 18 (13) | +1735 / −173 | 10 | CF-012, CF-022 |
| 10 | `w1/10-reports` | feat(reports): consistent snapshots, store time zone, bounded exports | 8 (4) | +962 / −228 | 7 | CF-005, CF-020 |
| 11 | `w1/11-app-ops` | feat(ops): app wiring, process roles, health, Docker/compose, backups, integration suite | 35 (28) | +3147 / −286 | 19 | — |
| 12 | `w1/12-web-foundation` | feat(web): API client, stores, shared components and libraries | 31 (23) | +1130 / −13 | 2 | — |
| 13 | `w1/13-web-auth-billing` | feat(web): sign-in, session and billing screens | 15 (7) | +572 / −24 | 2 | — |
| 14 | `w1/14-web-business` | feat(web): business screens and router | 45 (29) | +3608 / −378 | 11 | CF-026, CF-027 |
| 15 | `w1/15-pos` | feat(pos): server quote, idempotent sale, offline policy | 10 (8) | +1124 / −206 | 8 | CF-002, CF-025 |

### PR 01 — chore(ci): test harness, CI and ignore rules

- **Contains:** Vitest configs and helpers, CI workflow (Actions pinned by SHA), `.gitignore` / `.dockerignore` / `.env.example`, `package.json` scripts, lockfile.
- **Review focus:** `.gitignore` really ignores `.env.production` and still tracks examples (test runs `git check-ignore`). No new runtime dependency.
- **Findings (main home):** CF-048, CF-150
- **Also touches:** CF-033, CF-045
- **Files:** 11 (4 new), +786 / −21; list in the appendix.

### PR 02 — feat(db): tenant migrations 018–027, master migrations, safe migration runner

- **Contains:** Prisma schemas, tenant migrations 018–027, three master migrations, the migration runner (lock, version re-read under the lock, atomic file + version, DO-block-aware splitter), constraint-report SQL.
- **Review focus:** **Migrations run automatically at boot.** Read 026 (constraints + guarded VALIDATE) and 027 (ledger opening rows) closely. Splitter parity test covers 001–025.
- **Findings (main home):** CF-102, CF-110, CF-112, CF-115, CF-148
- **Also touches:** CF-006, CF-008, CF-009, CF-011, CF-012, CF-015, CF-016, CF-017, CF-018, CF-019, CF-031, CF-037, CF-038, CF-039, CF-045, CF-049, CF-053, CF-057, CF-058, CF-064, CF-065, CF-069, CF-091, CF-092, CF-094, CF-114, CF-116, CF-121, CF-137, CF-149
- **Files:** 25 (20 new), +1217 / −423; list in the appendix.

### PR 03 — feat(api): server foundation — config, middleware, shared utilities

- **Contains:** `config/*` (env schema, production config check, pooler gate, trust proxy, DB connection budget, Redis), auth / tenant / quota middleware, guarded writes, operation keys, retries, locks, money helpers, e-mail, business time zone, health / readiness.
- **Review focus:** Largest shared-code PR. Behaviour changes for everyone: owner-safe locks, Redis-outage handling, tenant binding in `authenticate`, production refuses to boot when half-configured.
- **Findings (main home):** CF-017, CF-023, CF-028, CF-029, CF-040, CF-047, CF-051, CF-052, CF-093, CF-094, CF-098, CF-099, CF-103, CF-108, CF-123, CF-134
- **Also touches:** CF-003, CF-005, CF-006, CF-016, CF-018, CF-019, CF-020, CF-022, CF-025, CF-033, CF-036, CF-037, CF-041, CF-042, CF-043, CF-061, CF-064, CF-065, CF-076, CF-079, CF-082, CF-085, CF-091, CF-097, CF-111, CF-118, CF-120, CF-121, CF-122, CF-124, CF-135, CF-161, CF-162
- **Files:** 58 (40 new), +3069 / −131; list in the appendix.

### PR 04 — feat(billing): exactly-once subscription charges and signed webhooks

- **Contains:** Billing module, Paymob client and webhook binding, payment intents, dunning and renewal jobs.
- **Review focus:** Release blockers CF-006…CF-010, CF-021 (double charges, webhook trust). Charges are never retried without an intent.
- **Findings (main home):** CF-006, CF-007, CF-008, CF-009, CF-010, CF-021, CF-037, CF-038, CF-039, CF-087, CF-088, CF-089, CF-090
- **Also touches:** CF-041, CF-042, CF-054, CF-078, CF-094, CF-108
- **Files:** 12 (6 new), +1247 / −452; list in the appendix.

### PR 05 — feat(auth): sessions, admin hardening, tenant provisioning

- **Contains:** Auth (sessions, lockouts, reset flow), platform admin, tenant provisioning and rollback, trial-expiry job, permission matrix.
- **Review focus:** Login and admin behaviour; provisioning rollback; CF-024.
- **Findings (main home):** CF-024, CF-034, CF-035, CF-054, CF-077, CF-111, CF-116, CF-117, CF-118, CF-119, CF-122, CF-124, CF-126, CF-127, CF-128, CF-129, CF-130, CF-142, CF-143
- **Also touches:** CF-007, CF-010, CF-028, CF-033, CF-042, CF-043, CF-082, CF-084, CF-085, CF-087, CF-089, CF-108, CF-120, CF-132
- **Files:** 26 (18 new), +2022 / −189; list in the appendix.

### PR 06 — feat(eta): feature-gated e-invoice outcome model and manual cancellation

- **Contains:** ETA document builder, outcome model, poll, client timeouts, manual cancellation, submission job.
- **Review focus:** Nothing auto-submits (ETA_AUTO_SUBMIT off until PV-16). Production filing still needs a real signer (CF-057).
- **Findings (main home):** CF-041, CF-056, CF-057, CF-058, CF-059, CF-095
- **Also touches:** CF-055, CF-069, CF-094, CF-096
- **Files:** 14 (8 new), +1150 / −388; list in the appendix.

### PR 07 — feat(stock): stock, purchasing and transfers integrity

- **Contains:** Stock service and routes, purchase orders, suppliers, expenses, branches, CSV import bounds, weighted-average cost.
- **Review focus:** CF-015 (release blocker): stock transfers exactly once.
- **Findings (main home):** CF-015, CF-070, CF-071, CF-075, CF-140, CF-141
- **Also touches:** CF-082, CF-086, CF-122, CF-123, CF-136
- **Files:** 11 (5 new), +591 / −125; list in the appendix.

### PR 08 — feat(sales): server pricing, refunds, credit ledger and exactly-once sales

- **Contains:** Invoices (server price, quote, refunds, cancel, idempotency keys), customers (credit ledger, statements), coupons, payment methods, work orders, settings, product routes + R2 upload bounds.
- **Review focus:** Most release blockers live here (CF-001, 003, 004, 011, 013, 014, 016, 019). Core money path — review with the Phase 3 financial audit open.
- **Findings (main home):** CF-001, CF-003, CF-004, CF-011, CF-013, CF-014, CF-016, CF-018, CF-019, CF-042, CF-049, CF-055, CF-060, CF-061, CF-062, CF-063, CF-064, CF-065, CF-066, CF-069, CF-072, CF-073, CF-074, CF-076, CF-079, CF-086, CF-096, CF-097, CF-104, CF-105, CF-106, CF-107, CF-113, CF-136, CF-137, CF-147
- **Also touches:** CF-002, CF-005, CF-017, CF-020, CF-023, CF-025, CF-026, CF-027, CF-036, CF-056, CF-057, CF-058, CF-059, CF-068, CF-082, CF-095, CF-116, CF-120, CF-121, CF-122, CF-140
- **Files:** 31 (21 new), +3676 / −321; list in the appendix.

### PR 09 — feat(installments): contract lifecycle, settlement and reminders

- **Contains:** Installment contracts (pricing, approval, overdue, early settlement, balances), reminder job (claims, per-store lock).
- **Review focus:** CF-012 and CF-022 (release blockers). Reminder sends are claimed per payment per day; unknown outcomes are not retried.
- **Findings (main home):** CF-012, CF-022, CF-067, CF-078, CF-091, CF-092, CF-100, CF-101, CF-144, CF-145
- **Also touches:** CF-001, CF-002, CF-004, CF-007, CF-010, CF-019, CF-028, CF-042, CF-054, CF-061, CF-068, CF-069, CF-076, CF-082, CF-093, CF-094, CF-112, CF-120, CF-121, CF-147
- **Files:** 18 (13 new), +1735 / −173; list in the appendix.

### PR 10 — feat(reports): consistent snapshots, store time zone, bounded exports

- **Contains:** Reports service and routes.
- **Review focus:** CF-005, CF-020 (release blockers). All report queries read one snapshot.
- **Findings (main home):** CF-005, CF-020, CF-030, CF-050, CF-082, CF-109, CF-121
- **Also touches:** CF-018, CF-019, CF-021, CF-069, CF-120, CF-122, CF-123, CF-137, CF-139, CF-163
- **Files:** 8 (4 new), +962 / −228; list in the appendix.

### PR 11 — feat(ops): app wiring, process roles, health, Docker/compose, backups, integration suite

- **Contains:** `index.ts`, health routes, Dockerfile (digest-pinned, role-aware CMD), compose (Redis AOF, stop grace, optional worker), Caddy, deploy and backup/restore scripts, runbook, the real-database integration suite.
- **Review focus:** Nothing here deploys anything. Integration suite needs disposable PostgreSQL + Redis (`vitest.integration.config.ts`).
- **Findings (main home):** CF-031, CF-033, CF-036, CF-043, CF-044, CF-045, CF-046, CF-053, CF-068, CF-114, CF-132, CF-138, CF-149, CF-151, CF-152, CF-153, CF-154, CF-162, CF-165
- **Also touches:** CF-001, CF-002, CF-003, CF-004, CF-011, CF-012, CF-013, CF-014, CF-015, CF-016, CF-017, CF-018, CF-019, CF-022, CF-023, CF-025, CF-026, CF-027, CF-034, CF-035, CF-040, CF-042, CF-052, CF-054, CF-057, CF-058, CF-059, CF-060, CF-062, CF-063, CF-064, CF-065, CF-066, CF-067, CF-069, CF-070, CF-071, CF-072, CF-073, CF-074, CF-075, CF-079, CF-082, CF-091, CF-092, CF-101, CF-102, CF-110, CF-113, CF-115, CF-116, CF-118, CF-130, CF-137, CF-140, CF-141, CF-142, CF-148, CF-150
- **Files:** 35 (28 new), +3147 / −286; list in the appendix.

### PR 12 — feat(web): API client, stores, shared components and libraries

- **Contains:** API client and re-auth store, auth stores, money/print/date libraries, shared UI (QueryErrorState, Money, Modal), status maps.
- **Review focus:** Pure front-end plumbing; screens still use old code until PRs 13–15.
- **Findings (main home):** CF-125, CF-131
- **Also touches:** CF-023, CF-058, CF-080, CF-081, CF-082, CF-084, CF-085, CF-120, CF-126, CF-133, CF-135, CF-155, CF-156, CF-158, CF-160
- **Files:** 31 (23 new), +1130 / −13; list in the appendix.

### PR 13 — feat(web): sign-in, session and billing screens

- **Contains:** Login / register / reset password, guards, admin shell, subscription banner and inactive gate, re-auth dialog.
- **Review focus:** Deep-link and reset-token handling (CF-085, CF-135 channel).
- **Findings (main home):** CF-083, CF-158
- **Also touches:** CF-082, CF-084, CF-085, CF-120, CF-125, CF-135, CF-157, CF-160
- **Files:** 15 (7 new), +572 / −24; list in the appendix.

### PR 14 — feat(web): business screens and router

- **Contains:** Invoices, installments, customers, settings (ETA, permissions), reports, stock, products, services, suppliers, expenses, dashboard, `App.tsx`, `main.tsx`.
- **Review focus:** CF-026, CF-027 (release blockers). Uses the base POS page until PR 15.
- **Findings (main home):** CF-026, CF-027, CF-084, CF-085, CF-120, CF-135, CF-139, CF-155, CF-157, CF-161, CF-163
- **Also touches:** CF-002, CF-005, CF-020, CF-021, CF-023, CF-024, CF-050, CF-058, CF-065, CF-067, CF-069, CF-081, CF-082, CF-083, CF-106, CF-121, CF-125, CF-133, CF-156, CF-160
- **Files:** 45 (29 new), +3608 / −378; list in the appendix.

### PR 15 — feat(pos): server quote, idempotent sale, offline policy

- **Contains:** POS page and day close, POS draft / legacy offline queue, plus the API test that checks POS calls against cashier permissions.
- **Review focus:** **Conflicts with `claude/ui-pos-merge-split` (8846bce) and your uncommitted POS edits — you reconcile this one.** CF-002, CF-025 (release blockers).
- **Findings (main home):** CF-002, CF-025, CF-080, CF-081, CF-133, CF-156, CF-159, CF-160
- **Also touches:** CF-016, CF-063, CF-082, CF-137, CF-155, CF-157, CF-158
- **Files:** 10 (8 new), +1124 / −206; list in the appendix.

## Not in any PR

- CF-032 (needs a Sentry DSN) and CF-146 (needs a tax adviser): not started.
- `documents/` (audit reports, tracking report) and your uncommitted `POS.tsx` / `AppShell.tsx` edits in the main checkout: untouched, not part of the worktree.
- `.claude/w1-mission-ledger.md`: ignored by git; stays local.

## How it was created

1. In the worktree, for PR k: create branch `w1/NN-slug` from the previous PR branch (PR 01 from `main`), `git add` exactly that PR's file list, commit with the title above and a body listing its findings.
2. Re-run the step check on the real branches (type-check + unit tests per branch).
3. Push and open PRs only when you say so; each PR targets the previous PR's branch, PR 01 targets `main`.
4. PR 15: you merge in `8846bce` and your local POS edits, then the POS tests re-run.

## Appendix — files per PR

<details><summary>PR 01 — 11 files</summary>

- `.dockerignore`
- `.env.example`
- `.github/workflows/ci.yml`
- `.gitignore`
- `apps/api/package.json`
- `apps/api/src/__tests__/env-ignore-rules.test.ts`
- `apps/api/src/__tests__/helpers/fake-redis.ts`
- `apps/api/vitest.config.ts`
- `apps/api/vitest.integration.config.ts`
- `apps/api/vitest.integration.setup.ts`
- `pnpm-lock.yaml`

</details>

<details><summary>PR 02 — 25 files</summary>

- `apps/api/src/__tests__/migrate-tenants-atomic.test.ts`
- `apps/api/src/__tests__/migration-hygiene.test.ts`
- `apps/api/src/__tests__/migration-splitter.test.ts`
- `apps/api/src/__tests__/tenant-column-parity.test.ts`
- `packages/database/migrations/tenant/018_reminder_claims.sql`
- `packages/database/migrations/tenant/019_operation_keys.sql`
- `packages/database/migrations/tenant/020_payment_allocations.sql`
- `packages/database/migrations/tenant/021_list_indexes.sql`
- `packages/database/migrations/tenant/022_eta_item_codes.sql`
- `packages/database/migrations/tenant/023_fee_type_percentage.sql`
- `packages/database/migrations/tenant/024_search_trgm_indexes.sql`
- `packages/database/migrations/tenant/025_installment_due_index.sql`
- `packages/database/migrations/tenant/026_integrity_constraints.sql`
- `packages/database/migrations/tenant/027_customer_ledger.sql`
- `packages/database/prisma/migrations/20261016000000_subscription_payment_intents/migration.sql`
- `packages/database/prisma/migrations/20261019000000_platform_audit_restrict/migration.sql`
- `packages/database/prisma/migrations/20261020000000_pg_trgm/migration.sql`
- `packages/database/prisma/migrations/migration_lock.toml`
- `packages/database/prisma/schema.prisma`
- `packages/database/prisma/schema.tenant.prisma`
- `packages/database/src/index.ts`
- `packages/database/src/migrate-tenants.ts`
- `packages/database/src/seeds/master.seed.ts`
- `scripts/db/constraint-report.sql`
- `scripts/db/table-counts.sql`

</details>

<details><summary>PR 03 — 58 files</summary>

- `apps/api/src/config/__tests__/config-check.test.ts`
- `apps/api/src/config/__tests__/database-budget.test.ts`
- `apps/api/src/config/__tests__/process-role.test.ts`
- `apps/api/src/config/config-check.ts`
- `apps/api/src/config/database.ts`
- `apps/api/src/config/env.ts`
- `apps/api/src/config/process-role.ts`
- `apps/api/src/config/redis.ts`
- `apps/api/src/config/trust-proxy.ts`
- `apps/api/src/modules/auth/__tests__/authenticate.tenant-binding.test.ts`
- `apps/api/src/modules/health/__tests__/readiness-lazy-redis.test.ts`
- `apps/api/src/modules/health/health.routes.ts`
- `apps/api/src/modules/health/migration-state.ts`
- `apps/api/src/shared/auth/permission-catalogue.ts`
- `apps/api/src/shared/db/__tests__/guarded.test.ts`
- `apps/api/src/shared/db/__tests__/retry.test.ts`
- `apps/api/src/shared/db/guarded.ts`
- `apps/api/src/shared/db/operation-key.ts`
- `apps/api/src/shared/db/retry.ts`
- `apps/api/src/shared/middleware/__tests__/origin-binding.test.ts`
- `apps/api/src/shared/middleware/__tests__/quota-atomic.test.ts`
- `apps/api/src/shared/middleware/__tests__/require-any-permission.test.ts`
- `apps/api/src/shared/middleware/auth.middleware.ts`
- `apps/api/src/shared/middleware/feature.middleware.ts`
- `apps/api/src/shared/middleware/limit.middleware.ts`
- `apps/api/src/shared/middleware/tenant.middleware.ts`
- `apps/api/src/shared/utils/__tests__/business-time.test.ts`
- `apps/api/src/shared/utils/__tests__/csv.test.ts`
- `apps/api/src/shared/utils/__tests__/customer-ledger.test.ts`
- `apps/api/src/shared/utils/__tests__/email-delivery.test.ts`
- `apps/api/src/shared/utils/__tests__/email-escaping.test.ts`
- `apps/api/src/shared/utils/__tests__/encryption.test.ts`
- `apps/api/src/shared/utils/__tests__/fee.test.ts`
- `apps/api/src/shared/utils/__tests__/lock.test.ts`
- `apps/api/src/shared/utils/__tests__/loyalty.test.ts`
- `apps/api/src/shared/utils/__tests__/map-limit.test.ts`
- `apps/api/src/shared/utils/__tests__/password-worker.test.ts`
- `apps/api/src/shared/utils/__tests__/refund.test.ts`
- `apps/api/src/shared/utils/__tests__/reset-email-logging.test.ts`
- `apps/api/src/shared/utils/__tests__/tenant-cache.test.ts`
- `apps/api/src/shared/utils/allocations.ts`
- `apps/api/src/shared/utils/audit.ts`
- `apps/api/src/shared/utils/business-time.ts`
- `apps/api/src/shared/utils/csv-upload.ts`
- `apps/api/src/shared/utils/csv.ts`
- `apps/api/src/shared/utils/customer-ledger.ts`
- `apps/api/src/shared/utils/email.ts`
- `apps/api/src/shared/utils/encryption.ts`
- `apps/api/src/shared/utils/fee.ts`
- `apps/api/src/shared/utils/job-log.ts`
- `apps/api/src/shared/utils/lock.ts`
- `apps/api/src/shared/utils/loyalty.ts`
- `apps/api/src/shared/utils/map-limit.ts`
- `apps/api/src/shared/utils/password.ts`
- `apps/api/src/shared/utils/product-discount.ts`
- `apps/api/src/shared/utils/redact.ts`
- `apps/api/src/shared/utils/refund.ts`
- `apps/api/src/shared/utils/tenant-cache.ts`

</details>

<details><summary>PR 04 — 12 files</summary>

- `apps/api/src/jobs/dunning.job.ts`
- `apps/api/src/jobs/renewal.job.ts`
- `apps/api/src/modules/billing/__tests__/cancel-email-failure.test.ts`
- `apps/api/src/modules/billing/__tests__/payment-intent.test.ts`
- `apps/api/src/modules/billing/__tests__/portal-card-token.test.ts`
- `apps/api/src/modules/billing/__tests__/webhook-binding.test.ts`
- `apps/api/src/modules/billing/billing.routes.ts`
- `apps/api/src/modules/billing/billing.service.ts`
- `apps/api/src/modules/billing/lifecycle.ts`
- `apps/api/src/modules/billing/payment-intent.ts`
- `apps/api/src/modules/billing/paymob.client.ts`
- `apps/api/src/modules/billing/paymob.webhook.ts`

</details>

<details><summary>PR 05 — 26 files</summary>

- `apps/api/src/jobs/trial-expiry.job.ts`
- `apps/api/src/modules/admin/__tests__/admin-auth-hardening.test.ts`
- `apps/api/src/modules/admin/__tests__/admin-delete-keeps-history.test.ts`
- `apps/api/src/modules/admin/__tests__/owner-seed.test.ts`
- `apps/api/src/modules/admin/__tests__/plan-change-subscription.test.ts`
- `apps/api/src/modules/admin/__tests__/run-migrations.guard.test.ts`
- `apps/api/src/modules/admin/admin.auth.service.ts`
- `apps/api/src/modules/admin/admin.routes.ts`
- `apps/api/src/modules/auth/__tests__/auth-hardening.test.ts`
- `apps/api/src/modules/auth/__tests__/sessions.test.ts`
- `apps/api/src/modules/auth/__tests__/user-claims.test.ts`
- `apps/api/src/modules/auth/__tests__/user-lifecycle.test.ts`
- `apps/api/src/modules/auth/auth.routes.ts`
- `apps/api/src/modules/auth/auth.service.ts`
- `apps/api/src/modules/auth/sessions.ts`
- `apps/api/src/modules/tenants/__tests__/provision-orphans.test.ts`
- `apps/api/src/modules/tenants/__tests__/provision-rollback.test.ts`
- `apps/api/src/modules/tenants/__tests__/register-login-url.test.ts`
- `apps/api/src/modules/tenants/__tests__/signup-throttle.test.ts`
- `apps/api/src/modules/tenants/__tests__/tenant-email-normalisation.test.ts`
- `apps/api/src/modules/tenants/__tests__/tls-ask.test.ts`
- `apps/api/src/modules/tenants/signup-guard.ts`
- `apps/api/src/modules/tenants/tenant.routes.ts`
- `apps/api/src/modules/tenants/tenant.schema.ts`
- `apps/api/src/modules/tenants/tenant.service.ts`
- `apps/api/src/modules/tenants/tls-ask.routes.ts`

</details>

<details><summary>PR 06 — 14 files</summary>

- `apps/api/src/jobs/eta-submission.job.ts`
- `apps/api/src/modules/eta/__tests__/eta-cancel.test.ts`
- `apps/api/src/modules/eta/__tests__/eta-client-timeouts.test.ts`
- `apps/api/src/modules/eta/__tests__/eta-document.test.ts`
- `apps/api/src/modules/eta/__tests__/eta-outcomes.test.ts`
- `apps/api/src/modules/eta/__tests__/eta-routes.test.ts`
- `apps/api/src/modules/eta/eta.cancel.ts`
- `apps/api/src/modules/eta/eta.client.ts`
- `apps/api/src/modules/eta/eta.document.ts`
- `apps/api/src/modules/eta/eta.flags.ts`
- `apps/api/src/modules/eta/eta.payload.ts`
- `apps/api/src/modules/eta/eta.routes.ts`
- `apps/api/src/modules/eta/eta.signer.ts`
- `apps/api/src/modules/eta/eta.submit.ts`

</details>

<details><summary>PR 07 — 11 files</summary>

- `apps/api/src/modules/branches/__tests__/create-branch.test.ts`
- `apps/api/src/modules/branches/branch.service.ts`
- `apps/api/src/modules/expenses/expense.routes.ts`
- `apps/api/src/modules/products/product.schema.ts`
- `apps/api/src/modules/purchase-orders/__tests__/po.exactly-once.test.ts`
- `apps/api/src/modules/purchase-orders/po.routes.ts`
- `apps/api/src/modules/stock/__tests__/list-stock-low-filter.test.ts`
- `apps/api/src/modules/stock/__tests__/transfer.exactly-once.test.ts`
- `apps/api/src/modules/stock/stock.routes.ts`
- `apps/api/src/modules/stock/stock.service.ts`
- `apps/api/src/modules/suppliers/supplier.routes.ts`

</details>

<details><summary>PR 08 — 31 files</summary>

- `apps/api/src/config/__tests__/r2-upload-bounds.test.ts`
- `apps/api/src/config/r2.ts`
- `apps/api/src/jobs/__tests__/eta-worker.test.ts`
- `apps/api/src/modules/coupons/__tests__/coupon-delete.test.ts`
- `apps/api/src/modules/coupons/coupon.routes.ts`
- `apps/api/src/modules/customers/__tests__/credit-adjust.test.ts`
- `apps/api/src/modules/customers/__tests__/customer-statement.test.ts`
- `apps/api/src/modules/customers/customer.routes.ts`
- `apps/api/src/modules/customers/customer.schema.ts`
- `apps/api/src/modules/eta/__tests__/eta-settings.test.ts`
- `apps/api/src/modules/invoices/__tests__/cancel-fee-followup.test.ts`
- `apps/api/src/modules/invoices/__tests__/create-invoice.guards.test.ts`
- `apps/api/src/modules/invoices/__tests__/email-receipt.delivery.test.ts`
- `apps/api/src/modules/invoices/__tests__/email-receipt.recipient.test.ts`
- `apps/api/src/modules/invoices/__tests__/invoice-list-perf.test.ts`
- `apps/api/src/modules/invoices/__tests__/invoice-loyalty-reversal.test.ts`
- `apps/api/src/modules/invoices/__tests__/invoice-reversal.exactly-once.test.ts`
- `apps/api/src/modules/invoices/__tests__/quote-route.test.ts`
- `apps/api/src/modules/invoices/invoice.routes.ts`
- `apps/api/src/modules/invoices/invoice.schema.ts`
- `apps/api/src/modules/invoices/invoice.service.ts`
- `apps/api/src/modules/payment-methods/__tests__/pm.routes.authz.test.ts`
- `apps/api/src/modules/payment-methods/pm.routes.ts`
- `apps/api/src/modules/products/__tests__/csv-import.test.ts`
- `apps/api/src/modules/products/__tests__/product-discount-route.test.ts`
- `apps/api/src/modules/products/__tests__/product-search-union.test.ts`
- `apps/api/src/modules/products/product.routes.ts`
- `apps/api/src/modules/services/__tests__/work-order.exactly-once.test.ts`
- `apps/api/src/modules/services/workOrder.routes.ts`
- `apps/api/src/modules/settings/settings.routes.ts`
- `apps/api/src/shared/db/__tests__/operation-key.test.ts`

</details>

<details><summary>PR 09 — 18 files</summary>

- `apps/api/src/jobs/__tests__/email-delivery.jobs.test.ts`
- `apps/api/src/jobs/__tests__/installment-reminders.scope.test.ts`
- `apps/api/src/jobs/__tests__/job-observability.test.ts`
- `apps/api/src/jobs/__tests__/reminder-recheck-and-silent-email.test.ts`
- `apps/api/src/jobs/installment-reminders.job.ts`
- `apps/api/src/modules/installments/__tests__/create-contract.inactive-product.test.ts`
- `apps/api/src/modules/installments/__tests__/installment-settlement.test.ts`
- `apps/api/src/modules/installments/__tests__/installment-states.test.ts`
- `apps/api/src/modules/installments/__tests__/installment.exactly-once.test.ts`
- `apps/api/src/modules/installments/__tests__/installment.math.test.ts`
- `apps/api/src/modules/installments/__tests__/installment.schedule.service.test.ts`
- `apps/api/src/modules/installments/__tests__/send-reminders.scope.test.ts`
- `apps/api/src/modules/installments/installment.math.ts`
- `apps/api/src/modules/installments/installment.routes.ts`
- `apps/api/src/modules/installments/installment.schema.ts`
- `apps/api/src/modules/installments/installment.service.ts`
- `apps/api/src/shared/middleware/__tests__/redis-outage.test.ts`
- `apps/api/src/shared/utils/__tests__/product-discount.test.ts`

</details>

<details><summary>PR 10 — 8 files</summary>

- `apps/api/src/__tests__/authz-role-matrix.test.ts`
- `apps/api/src/modules/reports/__tests__/day-close-timezone.test.ts`
- `apps/api/src/modules/reports/__tests__/report-snapshot.test.ts`
- `apps/api/src/modules/reports/__tests__/sales-export-cap.test.ts`
- `apps/api/src/modules/reports/excel.ts`
- `apps/api/src/modules/reports/report.routes.ts`
- `apps/api/src/modules/reports/report.schema.ts`
- `apps/api/src/modules/reports/report.service.ts`

</details>

<details><summary>PR 11 — 35 files</summary>

- `Caddyfile`
- `Dockerfile`
- `apps/api/src/__integration__/acceptance.int.test.ts`
- `apps/api/src/__integration__/app.ts`
- `apps/api/src/__integration__/fixtures.ts`
- `apps/api/src/__integration__/guarded-primitives.int.test.ts`
- `apps/api/src/__integration__/health-readiness.int.test.ts`
- `apps/api/src/__integration__/invoice-races.int.test.ts`
- `apps/api/src/__integration__/real-schema.int.test.ts`
- `apps/api/src/__integration__/reminder-claims.int.test.ts`
- `apps/api/src/__integration__/reminders-and-locks.int.test.ts`
- `apps/api/src/__integration__/reminders-bullmq.int.test.ts`
- `apps/api/src/__integration__/resend-delivery.int.test.ts`
- `apps/api/src/__integration__/schema-drift.int.test.ts`
- `apps/api/src/__integration__/w10-provisioning-real-db.int.test.ts`
- `apps/api/src/__integration__/w11-eta-real-db.int.test.ts`
- `apps/api/src/__integration__/w12-real-db.int.test.ts`
- `apps/api/src/__integration__/w13-integrity-ledger.int.test.ts`
- `apps/api/src/__integration__/w4-w5-real-db.int.test.ts`
- `apps/api/src/__integration__/w5b-races.int.test.ts`
- `apps/api/src/__integration__/w6-intents-real-db.int.test.ts`
- `apps/api/src/__integration__/w7-reports-real-db.int.test.ts`
- `apps/api/src/__tests__/release-hygiene.test.ts`
- `apps/api/src/__tests__/route-guard-factories.test.ts`
- `apps/api/src/config/__tests__/trust-proxy.test.ts`
- `apps/api/src/index.ts`
- `apps/api/src/modules/health/__tests__/health.routes.test.ts`
- `apps/api/src/modules/health/__tests__/migration-state.test.ts`
- `docker-compose.prod.yml`
- `docker-compose.yml`
- `docs/operations/release-and-rollback.md`
- `railway.json`
- `scripts/db/backup.sh`
- `scripts/db/restore-check.sh`
- `scripts/deploy.sh`

</details>

<details><summary>PR 12 — 31 files</summary>

- `apps/web/package.json`
- `apps/web/src/components/ui/Modal.tsx`
- `apps/web/src/components/ui/Money.tsx`
- `apps/web/src/components/ui/QueryErrorState.tsx`
- `apps/web/src/components/ui/__tests__/Money.test.tsx`
- `apps/web/src/constants/status.ts`
- `apps/web/src/lib/__tests__/analytics-redaction.test.ts`
- `apps/web/src/lib/__tests__/api-error.test.ts`
- `apps/web/src/lib/__tests__/business-date.test.ts`
- `apps/web/src/lib/__tests__/receipt-recipient.test.ts`
- `apps/web/src/lib/__tests__/redirect.test.ts`
- `apps/web/src/lib/__tests__/session-handoff.test.ts`
- `apps/web/src/lib/analytics.ts`
- `apps/web/src/lib/api-error.ts`
- `apps/web/src/lib/billing-return.ts`
- `apps/web/src/lib/business-date.ts`
- `apps/web/src/lib/capabilities.ts`
- `apps/web/src/lib/print-template.ts`
- `apps/web/src/lib/query-invalidation.ts`
- `apps/web/src/lib/receipt-recipient.ts`
- `apps/web/src/lib/redirect.ts`
- `apps/web/src/lib/reset-token.ts`
- `apps/web/src/lib/session-handoff.ts`
- `apps/web/src/lib/settings-tabs.ts`
- `apps/web/src/lib/store-identity.ts`
- `apps/web/src/stores/__tests__/admin-auth-persistence.test.ts`
- `apps/web/src/stores/admin-auth.store.ts`
- `apps/web/src/stores/auth.store.ts`
- `apps/web/src/stores/reauth.store.ts`
- `apps/web/vitest.config.ts`
- `apps/web/vitest.setup.ts`

</details>

<details><summary>PR 13 — 15 files</summary>

- `apps/web/src/api/client.ts`
- `apps/web/src/components/SubscriptionBanner.tsx`
- `apps/web/src/components/SubscriptionInactiveGate.tsx`
- `apps/web/src/components/__tests__/subscription-banner.test.tsx`
- `apps/web/src/components/__tests__/subscription-gate.test.tsx`
- `apps/web/src/components/admin/AdminShell.tsx`
- `apps/web/src/components/auth/ReauthDialog.tsx`
- `apps/web/src/components/auth/__tests__/reauth-dialog.test.tsx`
- `apps/web/src/components/guards/AuthGuard.tsx`
- `apps/web/src/hooks/useMe.ts`
- `apps/web/src/lib/subscription-gate.ts`
- `apps/web/src/pages/auth/Login.tsx`
- `apps/web/src/pages/auth/Register.tsx`
- `apps/web/src/pages/auth/ResetPassword.tsx`
- `apps/web/src/pages/auth/__tests__/reset-password-recovery.test.tsx`

</details>

<details><summary>PR 14 — 45 files</summary>

- `apps/api/src/modules/invoices/__tests__/invoice-detail.dto.test.ts`
- `apps/api/src/shared/utils/__tests__/email-links.test.ts`
- `apps/web/src/App.tsx`
- `apps/web/src/lib/__tests__/billing-return.test.ts`
- `apps/web/src/lib/__tests__/print-invoice.test.ts`
- `apps/web/src/lib/__tests__/print-money-format.test.ts`
- `apps/web/src/lib/__tests__/query-invalidation.test.ts`
- `apps/web/src/lib/__tests__/reset-token.test.ts`
- `apps/web/src/lib/print-contract.ts`
- `apps/web/src/lib/print.ts`
- `apps/web/src/main.tsx`
- `apps/web/src/pages/Dashboard.tsx`
- `apps/web/src/pages/auth/__tests__/login-redirect.persisted-session.test.tsx`
- `apps/web/src/pages/auth/__tests__/login-redirect.production-router.test.tsx`
- `apps/web/src/pages/auth/__tests__/login-redirect.test.tsx`
- `apps/web/src/pages/auth/__tests__/reset-password-analytics.test.tsx`
- `apps/web/src/pages/customers/Customers.tsx`
- `apps/web/src/pages/customers/__tests__/customer-ledger.test.tsx`
- `apps/web/src/pages/expenses/Expenses.tsx`
- `apps/web/src/pages/installments/Installments.tsx`
- `apps/web/src/pages/installments/__tests__/contract-quote.test.tsx`
- `apps/web/src/pages/installments/__tests__/early-settlement.test.tsx`
- `apps/web/src/pages/invoices/Invoices.tsx`
- `apps/web/src/pages/invoices/__tests__/action-permissions.test.tsx`
- `apps/web/src/pages/invoices/__tests__/fixtures/invoice-detail.real-db.response.json`
- `apps/web/src/pages/invoices/__tests__/fixtures/invoice-detail.response.json`
- `apps/web/src/pages/invoices/__tests__/invoice-detail-error.test.tsx`
- `apps/web/src/pages/invoices/__tests__/invoice-detail.real-db.test.tsx`
- `apps/web/src/pages/invoices/__tests__/invoices-page.test.tsx`
- `apps/web/src/pages/invoices/__tests__/returnable-rows.test.ts`
- `apps/web/src/pages/products/Products.tsx`
- `apps/web/src/pages/purchase-orders/PurchaseOrders.tsx`
- `apps/web/src/pages/reports/Reports.tsx`
- `apps/web/src/pages/reports/__tests__/sales-export-cap.test.tsx`
- `apps/web/src/pages/services/Services.tsx`
- `apps/web/src/pages/services/WorkOrders.tsx`
- `apps/web/src/pages/settings/Settings.tsx`
- `apps/web/src/pages/settings/__tests__/billing-return-analytics.test.tsx`
- `apps/web/src/pages/settings/__tests__/billing-return-login.test.tsx`
- `apps/web/src/pages/settings/__tests__/eta-cancel-button.test.tsx`
- `apps/web/src/pages/settings/__tests__/settings-permissions.test.tsx`
- `apps/web/src/pages/settings/__tests__/settings-responsive.test.tsx`
- `apps/web/src/pages/settings/__tests__/users-settings.test.tsx`
- `apps/web/src/pages/stock/Stock.tsx`
- `apps/web/src/pages/suppliers/Suppliers.tsx`

</details>

<details><summary>PR 15 — 10 files</summary>

- `apps/api/src/__tests__/pos-sale-permissions.test.ts`
- `apps/web/src/__tests__/error-toasts.test.ts`
- `apps/web/src/components/admin/__tests__/a11y-labels.test.tsx`
- `apps/web/src/lib/__tests__/print-sinks.test.tsx`
- `apps/web/src/lib/pos-draft.ts`
- `apps/web/src/lib/pos-offline-legacy.ts`
- `apps/web/src/pages/pos/DayClose.tsx`
- `apps/web/src/pages/pos/POS.tsx`
- `apps/web/src/pages/pos/__tests__/pos-page.test.tsx`
- `apps/web/src/stores/__tests__/offline-queue-scope.test.ts`

</details>
