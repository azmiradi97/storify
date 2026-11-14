# Hesba — Phase 1 Discovery Report

> **Phase:** Discovery only. No source file was modified, nothing was fixed, and nothing here is declared a vulnerability. Items that look risky are recorded as *observations* for Phase 2.
> **Evidence rule:** every claim cites code (`path:line`). Status labels: **CONFIRMED** (verified in code, or reproduced), **LIKELY** (strong inference, not executed), **POTENTIAL** (plausible, needs testing), **UNVERIFIED** (evidence missing — reason given).
> **Snapshot:** branch `claude/ui-pos-merge-split` @ `8846bce` (no `apps/api` / `packages` diff vs `main`). Working tree: uncommitted edits in `apps/web/src/components/layout/AppShell.tsx` and `apps/web/src/pages/pos/POS.tsx`; untracked `documents/Hesba_Project_Overview.md`. Date 2026-10-08.
> **Observation IDs** (e.g. `E-01`) are referenced across sections and in §22–§23.

---

## 1. Repository Overview

| Item | Finding | Evidence |
|---|---|---|
| Layout | pnpm workspace monorepo (`apps/*`, `packages/*`), `packageManager: pnpm@10.33.2`, `engines.node >=20` | `pnpm-workspace.yaml`, `package.json` |
| Size | 784 tracked files; ≈38.7k lines across apps/packages/infra; ≈180 TS/TSX source files. Most tracked `.md` files are agent-skill content under `.agents/` and `.trae/`, not application code | `git ls-files` |
| Backend | `apps/api` (`@hesba/api`) — Fastify **4.29.1**, TypeScript, Zod, Prisma 5, BullMQ 5, ioredis, decimal.js, exceljs, AWS SDK v3 (R2), Resend | `apps/api/package.json` |
| Frontend | `apps/web` (`@hesba/web`) — React 18, Vite 5, React Router 6, TanStack Query 5, Zustand 5, axios, react-hook-form + zod, Tailwind 3, xlsx | `apps/web/package.json` |
| Database package | `packages/database` (`@hesba/database`) — master Prisma schema, hand-maintained tenant Prisma schema, raw-SQL tenant migrations, tenant migration runner, plan seed | `packages/database/*` |
| Shared package | `packages/shared` exports nothing (`export {}`; empty `constants/ types/ utils/` dirs) and is not imported anywhere | `packages/shared/src/index.ts` |
| Generated code | Prisma clients in `packages/database/src/generated/{client,tenant}` (gitignored). Present locally, generated 2026-09-13; differ from source schemas only by Prisma formatting | `diff` of `schema*.prisma` vs `generated/*/schema.prisma` |
| Infra files | `Dockerfile`, `docker-compose.yml` (dev Postgres+Redis), `docker-compose.prod.yml`, `Caddyfile`, `railway.json`, `scripts/deploy.sh`, `.github/workflows/ci.yml`, `.env.example`. `infrastructure/` contains only an empty `docker/` directory | — |
| Docs | `documents/` (business, ERD, logic-flow, architecture, design, roadmap — May 2026) + untracked `documents/Hesba_Project_Overview.md` (2026-10-08). No README | — |
| Tests | 10 Vitest unit-test files in `apps/api` (61 tests). No web tests | §16 |
| Entry points | API `apps/api/src/index.ts` → `start()` (`:466-543`); prod container CMD `Dockerfile:88`; web `apps/web/src/main.tsx` → `App.tsx`; tenant migrations `packages/database/src/migrate-tenants.ts`; plan seed `packages/database/src/seeds/master.seed.ts` | — |
| External integrations | Paymob (Accept legacy API), Egyptian Tax Authority e-invoicing API (ETA), Cloudflare R2 (S3 API), Resend (email), Google Analytics 4 (web, optional), Sentry (optional, see A-08) | §17 |

**What was inspected.** Read in full: all API source (config, plugins, middleware, every module's routes/services/schemas, all 5 jobs, all utils), both Prisma schemas, all 17 tenant SQL migrations and 8 master migrations, the migration runner and seed, all infra/CI files, the API tests. Frontend: `main.tsx`, `App.tsx`, both API clients, both stores, guards, hooks, Login/Register, `lib/print.ts`, `sw.js`, plus targeted reads of POS, Settings, Installments, DayClose, Products, Customers. A full frontend→backend endpoint cross-check was done mechanically. What was *not* fully read is listed in §21 and §23.

**What was executed** (read-only; nothing in the repo changed — `git status` identical before/after): API + web type-check, API + web lint, API test suite, a production web build into the session scratchpad, and an isolated Fastify reproduction script (§16).

---

## 2. System Architecture

```
Browser (React SPA, RTL)
   │  HTTPS
   ▼
Caddy 2 ── hesbaapp.com, www→apex redirect, *.hesbaapp.com with on-demand TLS
   │        (on_demand ask → http://app:3000/internal/check-tenant)          [Caddyfile:1-20]
   ▼
Node 20 container "app" — ONE process                                         [Dockerfile:88, index.ts]
   ├─ Fastify 4: /health, /internal/check-tenant, /api/* (REST), static apps/web/dist (prod only)
   └─ BullMQ workers ×5: eta-submissions, dunning, installment-reminders, trial-expiry, renewal
   │
   ├──► PostgreSQL 16 — one database `hesba_master`
   │       public schema       = master/platform tables (6)
   │       tenant_<subdomain>  = one schema per tenant (46 tables)
   ├──► Redis 7 — tenant cache, subscription-status cache, refresh sessions, rate-limit counters,
   │              job locks, dashboard cache, BullMQ queues
   └──► External: Paymob · ETA (preprod/prod) · Cloudflare R2 · Resend
```

| Layer | Implementation | Key files |
|---|---|---|
| HTTP / API | Fastify instance with nested encapsulation contexts: root → `apiContext` (CORS) → `tenantScoped` (tenant middleware) | `apps/api/src/index.ts:42-451` |
| Hooks / middleware | `tenantMiddleware` (onRequest), `authenticate`, `requirePermission`, `requireFeature`, `requireUnderLimit`, `authenticatePlatformAdmin`, `requireOwner` | `apps/api/src/shared/middleware/*` |
| Service / use-case | Mixed: services exist for auth, tenants, invoices, installments, products, stock, billing, reports, eta; purchase-orders, suppliers, customers, expenses, work-orders, coupons, settings and branches put business logic directly in route handlers | `apps/api/src/modules/**` |
| Persistence | Prisma: two master clients (`apps/api/src/config/database.ts:6-9` and `packages/database/src/prisma.ts:5-13`), per-tenant `TenantPrismaClient` via LRU; 24 raw-SQL call sites | §7 |
| Cache / queue | One shared IORedis connection (`lazyConnect`, `maxRetriesPerRequest: null`) used by cache, rate limiter and BullMQ | `apps/api/src/config/redis.ts:4-7` |
| Storage | R2 via `@aws-sdk/client-s3` + presigner | `apps/api/src/config/r2.ts` |
| Auth | `@fastify/jwt` (one secret for tenant and platform tokens) + opaque refresh tokens in Redis + `@fastify/cookie` | `shared/plugins/jwt.plugin.ts:7-10` |
| Security headers | `@fastify/helmet` with CSP (defaults + GA script/connect + `img-src https:`) | `index.ts:81-95` |
| Rate limiting | `@fastify/rate-limit`, `global:false`, Redis store, opt-in per route | `index.ts:96-99` |
| Observability | Pino (level `warn` outside development; redacts `authorization`, `cookie`, `set-cookie`); `/health` exposes tenant-migration state; Sentry plugin only activates if `@sentry/node` is installed — it is **not** a dependency (**A-08, CONFIRMED**) | `index.ts:42-60,166-183`; `shared/plugins/sentry.plugin.ts:10-19` |

There is no separate worker deployment, no event bus, no WebSocket server, and no domain layer distinct from the services.

---

## 3. Application / Module Map

| Module | Mounted at | Responsibility | Owns / writes | External | Guarding |
|---|---|---|---|---|---|
| tenants | `/api/tenants` | public signup + provisioning | master `tenants`, `subscriptions` (trial); creates tenant schema and seeds it | — | none |
| auth | `/api/auth` | login, refresh, logout, forgot/reset, `/me`, `/me/usage`, users list/create, roles CRUD, change password, tenant audit-log viewer | `users`, `roles`, `password_reset_tokens`, `audit_logs`; Redis `refresh:*` | Resend | mixed (§5) |
| admin | `/api/admin` | platform-owner panel | `platform_admins`, `platform_audit_logs`, `plans`; writes `tenants`, `subscriptions`; Redis `platform_refresh:*` | — | platform JWT |
| billing | `/api/billing/*` | SaaS checkout, webhook, status, portal, cancel/resume | `subscriptions`, `payment_attempts` | Paymob, Resend | authenticate (+`billing:create` on checkout); webhook = HMAC |
| products | `/api/products` | products, variants, categories, tax rates, product discounts, upload URL, CSV import, search/barcode | `products`, `product_variants`, `categories`, `tax_rates`, `product_discounts`, initial `stock` rows | R2 | `products:*` |
| stock | `/api/stock` | stock list, adjust, min qty, movements, transfers | `stock`, `stock_movements`, `stock_transfers(+items)` | — | `stock:*` |
| payment-methods | `/api/payment-methods` | tenant payment methods + fee config | `payment_methods` | — | `settings:read/update` |
| customers | `/api/customers` | CRUD, credit adjust, documents, Excel statement, credit ledger, CSV import | `customers`, `customer_documents` | R2 | `customers:*` |
| invoices | `/api/invoices` | POS sale, list/get, return, cancel, email receipt, returns list | `invoices`, `invoice_items`, `returns(+items)`, `payment_fee_expenses`, `external_financing`; mutates `stock`, `coupons`, `customers` | Resend | `invoices:*` |
| installments | `/api/installments` | contracts, approval, schedule, payments, manual reminder trigger | `installment_contracts`, `installment_payments`; creates invoices | Resend (via job) | `installments:*` |
| suppliers | `/api/suppliers` | CRUD, manual transactions, Excel statement | `suppliers`, `supplier_transactions` | — | `suppliers:*` + feature `suppliers` |
| purchase-orders | `/api/purchase-orders` | PO lifecycle, receive, pay | `purchase_orders(+items)`, `purchase_receipts`, `purchase_payments`; mutates `stock`, `product_variants.cost_price`, `suppliers` | — | `purchase_orders:*` + feature `suppliers` |
| expenses | `/api/expenses` | expenses, categories, budgets, templates | `expenses`, `expense_categories`, `expense_budgets`, `expense_templates` | — | `expenses:*` + feature `expenses` |
| services / work-orders | `/api/services`, `/api/work-orders` | service catalog; work orders, status machine, payments, invoice generation | `services`, `service_categories`, `work_orders(+services,+status_history)`; creates invoices | — | `services:*` / `work_orders:*` + feature `services` |
| coupons | `/api/coupons` | coupon CRUD + validate | `coupons` | — | `invoices:*` |
| reports | `/api/reports` | dashboard, sales, stock, installments, fees, top products, P&L, returns, day close; Excel | read-only (+ Redis dashboard cache) | — | `reports:read` (some `invoices:read` / `installments:read`) |
| eta | `/api/admin/eta/resubmit/:invoiceId`, `/api/invoices/:invoiceId/eta-submissions` | ETA submission + history | `eta_submissions`, `invoices.eta_*` | ETA | `eta:manage` / `invoices:read` |
| inline in `index.ts` | `/api/settings`, `/api/settings/eta/credentials`, `/api/settings/eta/test`, `/api/currencies`, `/api/branches` | settings, ETA credentials + connection test, currencies, branches | `tenant_settings`, `currencies`, `branches` | ETA (test) | `authenticate` only (**A-04**) |
| jobs | — | cron + queue workers (§12) | master + tenant tables | Paymob, ETA, Resend | n/a |
| shared | — | middleware, plugins, utils (`audit`, `cost`, `decimal`, `email`, `encryption`, `fee`, `lock`, `loyalty`, `password`, `permissions`, `content-disposition`), `validation.ts` | — | — | — |

**180** route registrations in total (mechanical count of `app|sub|api|scoped.<method>(` in `apps/api/src`).

---

## 4. Authentication Flow

### 4.1 Tenant login (CONFIRMED)

| # | Step | Evidence |
|---|---|---|
| 1 | SPA posts `{email,password}` to `/api/auth/login` with header `X-Tenant-Subdomain` = the subdomain typed by the user | `apps/web/src/pages/auth/Login.tsx:60-69` |
| 2 | `apiContext` CORS → `tenantScoped` onRequest `tenantMiddleware` resolves the tenant (§6). `/api/auth/*` is exempt from the subscription gate | `index.ts:195-207,239`; `tenant.middleware.ts:11,88` |
| 3 | Route rate limit 10/min (default key = `request.ip`). Fastify is created **without `trustProxy`** (no occurrence in `apps/api/src`), so behind Caddy `request.ip` is LIKELY the proxy's address for every client (runtime UNVERIFIED) — this also affects every audit-log `ip` value | `auth.routes.ts:48-50`; `index.ts:42` |
| 4 | Zod: `email` + `password.min(1)` | `auth.routes.ts:22-25` |
| 5 | `loginUser`: `users.findUnique` by trimmed/lowercased email; reject if missing or `!isActive`; `bcryptjs.compare` (hashes use cost 12); update `lastLogin` | `auth.service.ts:28-56`; `shared/utils/password.ts:3-11` |
| 6 | Access token = `reply.jwtSign({scope:'tenant', userId, tenantId, schemaName, roleSlug, branchId, permissions})`, secret `JWT_ACCESS_SECRET`, `expiresIn = JWT_ACCESS_EXPIRES_IN` (default `15m`). Algorithm not configured (library default for a string secret — HS256, LIKELY). No `iss`/`aud`/`jti` | `auth.service.ts:58-66`; `auth.routes.ts:69`; `jwt.plugin.ts:7-10` |
| 7 | Refresh token = 32 random bytes (hex), stored `refresh:<token>` → `{userId, tenantId, schemaName}`, TTL hard-coded 7 days (`JWT_REFRESH_EXPIRES_IN` and `JWT_REFRESH_SECRET` are validated by env but used nowhere — CONFIRMED by grep) | `auth.service.ts:9,68-75` |
| 8 | Cookie `refreshToken`: `httpOnly`, `secure` in production, `SameSite=Lax`, `path=/`, 7 d, `domain=.${APP_BASE_DOMAIN}` when set (shared by all tenant subdomains) | `auth.routes.ts:34-44,71` |
| 9 | Response `{accessToken, user{…permissions}}`. SPA stores user + token; when `window.location.hostname === VITE_BASE_DOMAIN` it redirects to `https://<sub>.<base>/#s=<base64({accessToken,user,subdomain})>` | `Login.tsx:70-87`; `apps/web/.env.production:1` |
| 10 | On the subdomain, `main.tsx` decodes `#s=` **before React renders** and calls `setAuth` — no signature or server verification of the fragment | `apps/web/src/main.tsx:15-43` |

### 4.2 Protected request (CONFIRMED)
- axios request interceptor attaches `Authorization: Bearer` and `X-Tenant-Subdomain`, and refreshes first if the in-memory token is missing/within 30 s of expiry (`apps/web/src/api/client.ts:14-67`).
- `authenticate` = `request.jwtVerify()` (Authorization header only; no cookie option configured) + **tenant binding**: `user.tenantId === request.tenant.id && user.schemaName === request.tenant.schemaName`, else `403 tenant_mismatch`; platform tokens fail this check (`shared/middleware/auth.middleware.ts:17-45`). There is **no per-request DB reload** of the user, its `isActive`, role or permissions — they come from the JWT (valid up to 15 min).

### 4.3 Refresh (CONFIRMED) — `POST /api/auth/refresh`, 30/min (`auth.routes.ts:92-163`)
cookie → Redis lookup → latest subscription **of `request.tenant`** checked (SUSPENDED/CANCELLED → token deleted, 402) → user re-read **from `request.tenantDb`** (host/header-resolved tenant) by `data.userId` → `isActive` → new JWT built from `data.tenantId/schemaName` → rotation = `DEL old` + `SET new` (no reuse detection / token family) → new cookie. There is no explicit `data.tenantId === request.tenant.id` comparison (AU-02); a cookie from another tenant fails only because the user id is not found in the resolved schema.

### 4.4 Logout (CONFIRMED)
`POST /api/auth/logout` deletes the Redis key and calls `clearCookie(name, {path:'/'})` — **without the `domain` used when setting it** (`auth.routes.ts:169` vs `:42`; same at `:105,125,140`). Whether browsers clear the domain cookie this way is UNVERIFIED. The access JWT remains valid until expiry. Frontend: `Sidebar.tsx:85` calls the endpoint; `auth.store.logout()` only clears local state and hard-redirects to `/login` (`stores/auth.store.ts:35-38`).

### 4.5 Password reset (CONFIRMED)
- `POST /api/auth/forgot-password` (tenant-scoped, unauthenticated): 20/min per IP + Redis counter `rate:forgot:<email>` 5/hour (keyed by email only, shared across tenants) (`auth.routes.ts:177-203`; `auth.service.ts:215-220`). Fire-and-forget `requestPasswordReset`: 32-byte token, **sha256** stored in tenant `password_reset_tokens` with 1 h expiry and IP (`auth.service.ts:128-151`).
- Email link = `https://<sub>.<APP_BASE_DOMAIN>/reset?token=…` (fallback `FRONTEND_URL`) (`shared/utils/email.ts:312-316`). If `RESEND_API_KEY` is unset, the link is written to stdout regardless of `NODE_ENV` (`email.ts:318-321`).
- **Route mismatch:** the SPA route is `/reset-password` (`App.tsx:73`, reads `token` at `ResetPassword.tsx:31`); unknown paths redirect to `/` (`App.tsx:114`). The emailed `/reset` path matches no route (**AU-11, CONFIRMED static**).
- `POST /api/auth/reset-password`: 5 per 5 min; `passwordSchema` (≥12 chars, ≥1 letter, ≥1 digit — `shared/validation.ts:8-12`); atomic single-use claim inside a transaction; then a Redis `SCAN` over **all** `refresh:*` keys deleting those whose `userId` matches (`auth.service.ts:153-211`).

### 4.6 Other flows
- **Change password** `PATCH /api/auth/me/password`: verifies current password, writes new hash, **does not revoke** existing refresh tokens (`auth.routes.ts:577-599`).
- **Email verification:** none (no endpoint, token, or column).
- **Account activation/deactivation:** `users.is_active` is checked at login/refresh, but **no code writes it** — the only writes to `users` are `lastLogin` and `passwordHash` (`auth.service.ts:53,187`; `auth.routes.ts:596`) and there is no user update/delete route (**W-07, CONFIRMED**). Tenant level: `tenants.status` must be `ACTIVE`; it is written only by provisioning (`tenant.service.ts:264-267`) and the admin suspend toggle (`admin.routes.ts:294-298`). `Tenant.status = CANCELLED` and `Tenant.cancelledAt` are never written.

### 4.7 Platform admin authentication (CONFIRMED)
- Owner account is seeded from `OWNER_EMAIL/OWNER_PASSWORD` on **every boot**; a changed password rotates the hash and forces `role OWNER, isActive true` (`modules/admin/admin.auth.service.ts:87-116`; called at `index.ts:470`).
- `POST /api/admin/login` (10/min): bcrypt → JWT `{scope:'platform', adminId, email, role}` signed with the **same** `JWT_ACCESS_SECRET` → `platform_refresh:<token>` (7 d) → cookie `platformRefreshToken` `httpOnly`, `SameSite=Strict`, `path=/api/admin`, host-only (`admin.routes.ts:26-42,71-110`). `/refresh` has **no rate limit** (`:113`).
- `authenticatePlatformAdmin`: `jwtVerify` + `scope==='platform'` + `adminId` + DB reload with `isActive` (`shared/middleware/platform-admin.middleware.ts:22-54`).
- Frontend admin store **persists the access token** in `localStorage` (`stores/admin-auth.store.ts:38`), unlike the tenant store (`auth.store.ts:54-57`); the admin axios refresh queue has no rejection path (`api/admin-client.ts:61-99`).

---

## 5. Authorization Flow

### 5.1 Model
Per-tenant `roles.permissions` JSONB `{resource: [actions]}`. Five system roles (`isSystem=true`, immutable via API) are seeded at provisioning (`modules/tenants/tenant.service.ts:10-88`):

| Resource | super_admin | branch_manager | cashier | inventory_keeper | accountant |
|---|---|---|---|---|---|
| invoices | create read update delete refund | create read update refund | create read | — | read |
| products | create read update delete | read update | read | read update | — |
| stock | read adjust transfer | read adjust transfer | read | read adjust transfer | — |
| customers | create read update delete | create read update | create read update | — | — |
| installments | create read update approve reject | create read update approve | read | — | read |
| suppliers | create read update delete | read | — | read | read |
| purchase_orders | create read update approve receive | create read update receive | — | read receive | read |
| expenses | create read update approve delete | create read update approve | — | — | create read update |
| services | create read update delete | read update | read | — | — |
| work_orders | create read update delete | create read update | create read update | — | — |
| reports | read export | read export | read | read | read export |
| users | create read update delete | read | — | — | — |
| settings | read update | read | — | — | — |
| billing | read update | — | — | — | read |

### 5.2 Enforcement primitives (CONFIRMED)

| Primitive | Behaviour | Evidence |
|---|---|---|
| `requirePermission(r,a)` | `roleSlug === 'super_admin'` bypasses; else checks the **JWT** permissions map | `auth.middleware.ts:47-64` |
| `requireFeature(f)` | `request.tenant.plan.features[f]` truthy | `feature.middleware.ts:3-17` |
| `requireUnderLimit(r)` | counts products / users / invoices (current month, server-local midnight) / branches (`features.max_branches`); `0`/`-1` = unlimited → 402 | `limit.middleware.ts:23-86` |
| Subscription gate | latest subscription `SUSPENDED`/`CANCELLED` → 402, except URLs starting `/api/auth/` or `/api/billing/` (the exemption covers the **whole** `/api/auth/` prefix, incl. user/role management) | `tenant.middleware.ts:11,88-113` |
| Tenant status gate | `tenants.status !== 'ACTIVE'` → 404 | `tenant.middleware.ts:77-82` |
| Platform | `authenticatePlatformAdmin`; `requireOwner()` only on `/admins*` | `admin.routes.ts:168,725-849` |

**Hook order on tenant routes:** onRequest `tenantMiddleware` → onRequest `authenticate` (module hook) → preHandler `requireFeature` (module hook) → route `preHandler` (`requirePermission`, `requireUnderLimit`). The inline routes in `index.ts` run `authenticate` as a preHandler.

### 5.3 Where authorization is (and is not) enforced (CONFIRMED)
- **`authenticate` only, no permission check (A-04, Z-01):** `GET/PATCH /api/settings` (VAT, loyalty, print template, ETA issuer fields), `PUT /api/settings/eta/credentials`, `POST /api/settings/eta/test`, `GET /api/currencies`, `GET/POST/PATCH /api/branches`, `GET /api/auth/roles`, `GET /api/auth/me`, `/me/usage`, `PATCH /me/password`, `GET /api/billing/portal` (returns the full subscription row incl. `providerCardToken` + 10 payment attempts), `GET /api/billing/status`, `POST /api/billing/cancel`, `POST /api/billing/resume`, `GET /api/coupons/validate` (`index.ts:258-449`; `billing.routes.ts:93-212`; `coupon.routes.ts:20`).
- **Checked but granted to no seeded role** (only the super_admin bypass passes): `billing:create` (checkout, `billing.routes.ts:66`), `eta:manage` (resubmit, `eta.routes.ts:11`).
- **Granted but never checked by any route:** `invoices:refund` (returns use `invoices:update`, `invoice.routes.ts:113`), `installments:reject` (reject uses `installments:approve`), `reports:export` (Excel exports use `reports:read`), `users:delete`, `customers:delete`, `work_orders:delete`, `billing:read`, `billing:update`.
- **Notable mappings:** coupon CRUD uses `invoices:*` (cashier holds `invoices:create` → can create coupons, `coupon.routes.ts:50`); expense *reject* uses `expenses:delete` (`expense.routes.ts:170`); `GET /api/payment-methods` requires `settings:read`, which the seeded cashier role lacks while the POS loads payment methods from it (`pm.routes.ts:9`; `POS.tsx:149-150`) (**T-06**).
- **Plan features enforced server-side:** only `suppliers` (suppliers + purchase-orders), `expenses`, `services` (services + work-orders) (`po.routes.ts:14`, `supplier.routes.ts:25`, `expense.routes.ts:12`, `service.routes.ts:17`, `workOrder.routes.ts:39`). `installments` is gated by the monthly quota column instead (`installment.routes.ts:57-90`). `multi_currency`, `advanced_reports`, `offline_mode`, `api_access` have **no** server-side check (Z-03).
- **Branch scoping:** only `GET /api/reports/dashboard` restricts non-super-admins to their own branch (`report.routes.ts:27-37`). Every other report, and invoice/expense/PO creation, accepts any `branchId` from the client (e.g. `invoice.routes.ts:41-42`).
- **Resource-level authorization:** none beyond tenant scoping — any holder of a permission can act on any row of that tenant (no ownership/branch checks).
- **Frontend** `RoleGuard`/`FeatureGate`/`hasPermission` mirror the backend for UX only (`components/guards/AuthGuard.tsx:34-46`, `FeatureGate.tsx:22-27`).

### 5.4 Representative traces (CONFIRMED)

| Operation | Path through the code |
|---|---|
| `POST /api/invoices` | Host/`X-Tenant-Subdomain` → `tenantMiddleware` (tenant ACTIVE; subscription not SUSPENDED/CANCELLED) → `authenticate` (JWT + tenant binding) → `requirePermission('invoices','create')` → `requireUnderLimit('invoices')` → zod → `branchId` from body or JWT → `createInvoice` → interactive `$transaction` on the tenant client (`invoice.routes.ts:29-90`; `invoice.service.ts:127-551`) |
| `PATCH /api/settings` | `tenantMiddleware` → `authenticate` → zod (no ETA environment key) → `tenantSetting.update` (`index.ts:275-337`) |
| `POST /api/billing/cancel` | `tenantMiddleware` (exempt from subscription gate) → `authenticate` → `cancelSubscription(tenant.id)` on master DB → cache invalidation → email to owner (`billing.routes.ts:144-176`; `billing.service.ts:297-319`) |
| `PATCH /api/admin/tenants/:id/suspend` | `apiContext` (no tenant middleware) → `authenticatePlatformAdmin` (any ADMIN, no `requireOwner`) → `tenant.update` → `invalidateTenantCache` → `platformAudit` (`admin.routes.ts:281-312`) |
| `POST /api/purchase-orders/:id/receive` | `tenantMiddleware` → `authenticate` → `requireFeature('suppliers')` → `requirePermission('purchase_orders','receive')` → pre-tx status/outstanding checks → `$transaction` (`po.routes.ts:227-396`) |

---

## 6. Multi-Tenancy Architecture

**Model:** schema-per-tenant inside one PostgreSQL database (`hesba_master`). Master tables in `public`; each tenant gets `tenant_<subdomain>` with `-` → `_` (`tenant.service.ts:193`). Tenant tables carry **no `tenant_id` column**; there is no RLS; the compose files use one DB role (`postgres`). Isolation therefore rests on (a) which schema the Prisma client is bound to and (b) the JWT↔tenant binding in `authenticate`.

### 6.1 Request → tenant → schema trace (CONFIRMED)

| Step | Behaviour | Evidence |
|---|---|---|
| Host parsing | strip port; if `APP_BASE_DOMAIN` set: host == base → `''`; host ends `.base` → first label of the prefix; else first label of hostname | `tenant.middleware.ts:18-37` |
| Header fallback | `X-Tenant-Subdomain` is used **only** when the parsed subdomain is empty or in `SYSTEM_HOSTS {admin, www, api, localhost, 127.0.0.1}`; on `<sub>.hesbaapp.com` the header is ignored | `:6,40-43` |
| Missing tenant | empty/system subdomain → 400 `tenant_required` | `:50-58` |
| Lookup | Redis `tenant:<subdomain>` (300 s) holding the **full Tenant row + Plan as JSON**; miss → `masterDb.tenant.findUnique({include:{plan}})` → cache. On cache hits, Date/Decimal fields are plain strings (POTENTIAL type divergence) | `:60-75` |
| Status | `status !== 'ACTIVE'` → 404 | `:77-82` |
| Binding | `request.tenant = tenant`; `request.tenantDb = getTenantDb(tenant.schemaName)` | `:84-85` |
| Prisma client | LRU (max 50, 30-min idle TTL, `updateAgeOnGet`) of `TenantPrismaClient` built from `DATABASE_MASTER_URL` + `?schema=<schema>&connection_limit=5&pool_timeout=20`; eviction calls `$disconnect()` (a request still holding the evicted client is a POTENTIAL edge case) | `config/database.ts:16-42` |
| Subscription | `sub:status:<tenantId>` (30 s) = latest subscription by `createdAt`; `SUSPENDED`/`CANCELLED` → 402 unless `/api/auth/` or `/api/billing/` | `tenant.middleware.ts:88-113` |
| Token check | `authenticate` compares JWT `tenantId`/`schemaName` with `request.tenant` (HESBA-SEC-01 fix; unit-tested) | `auth.middleware.ts:34-44` |
| Query | every handler uses `request.tenantDb` (Prisma or `$queryRawUnsafe` with the schema search path from the URL) | modules |

Unauthenticated tenant-scoped routes (`login`, `refresh`, `logout`, `forgot-password`, `reset-password`) act on the host/header-resolved tenant only.

### 6.2 Lifecycle

| Concern | Implementation | Evidence |
|---|---|---|
| Provisioning | `POST /api/tenants/register` (public, **no rate limit**, no reserved-name list — `admin`, `www`, `api` satisfy the regex and collide with `SYSTEM_HOSTS`) → check subdomain + email → resolve plan → create tenant `PROVISIONING` (P2002 mapped to 409) → `CREATE SCHEMA` (raw, validated name) → `runTenantMigrations` → `seedTenantDefaults` (non-transactional: 5 roles, main branch, owner `super_admin` user, EGP, 2 tax rates, 6 expense categories, 6 payment methods, settings with `etaEnabled:true`) → status `ACTIVE` → `startTrial` (14 d). Any failure deletes the tenant row and `DROP SCHEMA … CASCADE` | `tenants/tenant.routes.ts:6-66`, `tenant.schema.ts:4-15`, `tenant.service.ts:92-286` |
| Email normalisation | owner **user** email lowercased; master `Tenant.email/ownerEmail` stored as typed (T-03) | `tenant.service.ts:125,204,230-232` |
| Response | `loginUrl` hard-coded `http://<sub>.localhost:5173/login` (ignored by the SPA, which navigates to `/login`) (T-04) | `tenant.routes.ts:20`; `Register.tsx` |
| Suspension | two independent mechanisms: **Tenant.status** (admin toggle → 404 on every tenant route, incl. login) vs **Subscription.status** (billing → 402 except auth/billing) | §5.2 |
| Deletion | no endpoint or job deletes a tenant or its schema (only provisioning rollback) | route inventory |
| Schema migrations | runner reads `migrations/tenant/*.sql` sorted, version = numeric prefix, applies files with `version > tenants.schema_version`; one connection-limited client + `pg_try_advisory_lock(hashtext('hesba_migrate:'||schema))`; each file in one transaction; **`schema_version` bumped in a separate statement after commit**; naive `;` splitter (no `$$` support); runs for `ACTIVE`+`SUSPENDED` tenants, sequentially; triggered fire-and-forget at boot and by `POST /api/admin/run-migrations` | `packages/database/src/migrate-tenants.ts:14-143`; `index.ts:484-497`; `admin.routes.ts:890-893` |
| Caches & invalidation | `tenant:<sub>` and `sub:status:<id>` deleted by admin suspend / plan change / plan edit (all tenants on the plan) / trial extend / cancel / reactivate, and by billing webhook handlers and `cancelSubscription`; trial expiry and `/billing/resume` delete only `sub:status` | `admin.routes.ts:45-62`; `billing.service.ts:21-30`; `trial-expiry.job.ts:135`; `billing.routes.ts:205` |
| Background-job context | ETA job payload carries `{invoiceId, tenantId, schemaName}` and the worker trusts `schemaName` (`jobs/eta-submission.job.ts:9-13,67-68`); installment reminders iterate `ACTIVE` tenants from master (`installment-reminders.job.ts:83-90`), and the **tenant-scoped** manual trigger `POST /api/installments/send-reminders` runs that same all-tenant cycle and returns its cross-tenant summary (`installment.routes.ts:216-224`) (J-08); billing jobs touch master only | — |
| Storage context | R2 object keys contain no tenant identifier (`products/<uuid>.<ext>`, `customers/<customerId>/<uuid>.<ext>`), one bucket for all tenants | `product.routes.ts:57`; `customer.routes.ts:183` |
| Reporting context | all reports use `request.tenantDb`; dashboard cache key `dashboard:<tenantId>:<branch>` | `report.service.ts:43` |
| Admin access to tenant data | platform admins read tenant metadata, subscriptions and payment attempts; inside tenant schemas only row **counts** (`users/products/invoices/customers`); no impersonation | `admin.routes.ts:240-273` |
| Shared cross-tenant resources | one JWT secret, one Redis keyspace (refresh tokens; `rate:forgot:<email>`), one R2 bucket, one DB role | — |

---

## 7. Database Architecture

### 7.1 Setup
PostgreSQL 16 (`postgres:16-alpine`), single database `hesba_master`. Prisma 5 with two schemas: `prisma/schema.prisma` → `generated/client` (master) and `prisma/schema.tenant.prisma` → `generated/tenant`; both datasources read `DATABASE_MASTER_URL`; the tenant URL is rewritten per schema at runtime. Tenant DDL is **not** produced by Prisma — it comes from raw SQL files; the tenant Prisma schema is a hand-maintained mirror used for typing (`schema.tenant.prisma:1-3`; `__tests__/tenant-schema-parity.test.ts:5-14`).

### 7.2 Master schema (`public`, Prisma Migrate — 8 migrations)

| Model | Key facts | Evidence |
|---|---|---|
| `Plan` | cuid id; unique `name`, `slug`; limits `maxProducts/maxOrders/maxUsers/maxStorage/maxInstallmentPlansMonthly`; `priceMonthly/Yearly DECIMAL(10,2)`; `features` JSON | `schema.prisma:14-39` |
| `Tenant` | unique `subdomain`, `schemaName`, `email`; `schemaVersion`; `status` enum `ACTIVE/SUSPENDED/CANCELLED/PROVISIONING`; `planId` | `:41-70` |
| `Subscription` | **no unique on `tenantId`** (multiple rows per tenant possible); status enum `ACTIVE/PAST_DUE/CANCELLED/TRIALING/SUSPENDED`; `providerCardToken TEXT` (plaintext); dunning fields `failedAttempts/lastFailedAt/lastFailureReason/nextBillingAt`; `cancelAtPeriodEnd`; `trialRemindersSent` | `:72-112` |
| `PaymentAttempt` | `providerTransactionId` **unique** (webhook idempotency); status enum incl. `REFUNDED` (never written) | `:127-153` |
| `PlatformAdmin` / `PlatformAuditLog` | role enum `OWNER/ADMIN`; audit with actor FK | `:159-196` |

Master timestamps are `TIMESTAMP(3)` **without time zone** (`20260510000000_init_master_schema/migration.sql:28-29`). Four master migrations are data fixes; two hard-code tenant `cmpa8sosj0001zgwu9lyrus2b` and delete its payment attempts (`20260519143000_*`, `20260519160000_*`; the latter's comment references `m3rd.talabia.app`). No `migration_lock.toml` is present.

### 7.3 Tenant schema (`tenant_<sub>`, 46 tables; header comment still says "34")

| Group | Tables |
|---|---|
| Auth & settings | `branches`, `roles`, `users`, `password_reset_tokens`, `tenant_settings`, `audit_logs` |
| Catalog & stock | `categories`, `tax_rates`, `products`, `product_variants`, `stock`, `stock_movements`, `stock_transfers`, `stock_transfer_items`, `product_discounts` |
| Sales | `customers`, `customer_documents`, `coupons`, `invoices`, `invoice_items`, `payment_methods`, `payment_fee_expenses`, `returns`, `return_items`, `currencies` |
| Installments | `installment_contracts`, `installment_payments`, `external_financing` |
| Purchasing | `suppliers`, `supplier_transactions`, `purchase_orders`, `purchase_order_items`, `purchase_receipts`, `purchase_payments` |
| Expenses | `expense_categories`, `expense_budgets`, `expense_templates`, `expenses` |
| Services | `service_categories`, `services`, `work_orders`, `work_order_services`, `work_order_status_history` |
| System | `eta_submissions`, `offline_queue` (unused by code), `print_templates` (unused by code) |

**Keys & types:** UUID PKs via `gen_random_uuid()`; money `DECIMAL(15,4)` (fees/coupon values `(10,2)`, rates `(5,2)`, exchange rates `(15,6)`); all quantities `INT`; all tenant statuses are free-form `VARCHAR` (no enums/CHECKs on status); timestamps `TIMESTAMPTZ` in SQL.

**Constraints (from SQL):** uniques — `roles.slug`, `users.email` (case-sensitive), `product_variants(product_id, sku)`, partial unique `product_variants.barcode WHERE NOT NULL`, `stock(variant_id, branch_id)`, `currencies.code`, `coupons.code`, `invoices.invoice_number`, `invoices.eta_internal_id`, `installment_contracts.invoice_id`, `external_financing.invoice_id`, `expense_budgets(category_id, period)`, `work_orders.ticket_number`, partial unique `work_orders.invoice_id`. FKs everywhere with selective `ON DELETE CASCADE / SET NULL`. Migration 016 adds non-negativity CHECKs (variant prices, stock qty/min, coupon used_count, installment amounts/count, invoice subtotal/total/paid) as **`NOT VALID`** (new writes only). Sequence `invoice_number_seq` (015). **No triggers, functions, views or RLS** in any migration (grep CONFIRMED).

**Soft vs hard deletes:** `isActive` flags on products, variants, payment methods, suppliers, categories, tax rates, coupons, branches, users, services, expense templates; hard `DELETE` for coupons, product discounts, roles, expense budgets/templates, work-order service lines, plans, platform admins. No `deletedAt` columns.

### 7.4 SQL ↔ Prisma ↔ code drift (CONFIRMED static, against all 17 tenant migrations)

| ID | Drift | Evidence |
|---|---|---|
| D-03a | `installment_payments.payment_method_id` exists in SQL but not in the Prisma model (so it can't be written via Prisma) | `010_installment_payment_method.sql:3-4`; `schema.tenant.prisma:568-584` |
| D-03b | barcode index is UNIQUE (partial) in SQL, plain `@@index` in Prisma | `002_full_schema.sql:90-91`; `schema.tenant.prisma:229` |
| D-03c | SQL `ON DELETE CASCADE/SET NULL` not mirrored in Prisma relations; SQL `TIMESTAMPTZ` vs un-annotated Prisma `DateTime` | `002_full_schema.sql` passim |
| E-01 | Raw SQL in the ETA path references columns that **no migration creates**: `tenant_settings.eta_signing_cert_pem` (real: `eta_signing_cert`), `tenant_settings.eta_is_production` (real: `eta_environment`), `invoices.eta_qr_data` (real: `eta_qr_code`), `eta_submissions.submission_id` (absent), `eta_submissions.created_at` (real: `submitted_at`); the INSERTs also omit `eta_submissions.direction` (`NOT NULL`, no default) | `jobs/eta-submission.job.ts:70-81,186-190`; `modules/eta/eta.submit.ts:64-99`; `eta.routes.ts:47-50`; DDL `002_full_schema.sql:14-34,237-269,553-566` |
| CU-03 | Customer statement selects `installment_contracts.remaining_amount` — no such column | `customers/customer.routes.ts:259-260` |

Whether the **production** database has these columns via out-of-band changes is UNVERIFIED (no DB access in this phase; local Docker was not running). The parity test only compares table names, so column drift is not detected by CI (`tenant-schema-parity.test.ts:13-14,51-75`).

### 7.5 Raw SQL inventory (24 call sites, CONFIRMED)
`$queryRawUnsafe/$executeRawUnsafe` are always parameterised (`$1…`) except `CREATE/DROP SCHEMA` (interpolated, name constrained by the signup regex — `tenant.service.ts:255,277`) and `attempt_number` (server integer interpolated — `eta.submit.ts:66,82,98`). Sites: ETA job (8), ETA submit (4), ETA routes (3), customer statement (3), invoice search (2), coupon increment/release (2, tagged templates), invoice sequence (1), expense budgets (1). Raw SQL is not type-checked, which is why E-01/CU-03 pass `tsc`.

### 7.6 Data ownership map

| Location | Data |
|---|---|
| Postgres `public` | plans, tenants (identity, status, plan, schema version), subscriptions (incl. Paymob card token), payment attempts, platform admins, platform audit |
| Postgres `tenant_<sub>` | all business data: users/roles, settings (incl. AES-GCM-encrypted ETA credentials), catalog, stock + movements, customers (incl. national ID), invoices/returns, installments, suppliers/POs, expenses, work orders, audit log (also the customer credit/loyalty ledger), ETA submissions |
| Redis | `tenant:<sub>` (5 min), `sub:status:<id>` (30 s), `refresh:<tok>` / `platform_refresh:<tok>` (7 d — the only copy of sessions), `rate:forgot:<email>`, rate-limit counters, `lock:<job>`, `dashboard:<tenant>:<branch>` (120 s), BullMQ queues/jobs |
| Cloudflare R2 | product images and customer documents (by public URL) — not wired in the UI (§13) |
| Browser `localStorage` | `hesba-auth` (user + permissions + subdomain), `hesba-admin-auth` (admin + **access token**), `pos_offline_queue` (full invoice payloads), `hesba_onboarded_<userId>` |
| External | Paymob (transactions, card tokens), ETA (documents), Resend (emails), GA4 (events) |

---

## 8. Financial Domain Map

Server money math uses `decimal.js` (precision 20, `ROUND_HALF_UP`; `roundMoney` = 4 dp) — `shared/utils/decimal.ts:3-15`. Exceptions where values pass through JS `number` (**F-07, CONFIRMED**): manual credit `Number(customer.creditBalance) + delta` (`customer.routes.ts:134`), credit cap `Math.min(input.creditAmount, availableCredit.toNumber())` (`invoice.service.ts:263`), loyalty earn `totalAmount.toNumber() * pointsPerUnit` (`:466`), PO overpayment check `.toNumber()` (`po.routes.ts:413`), report aggregation with `+=` on `.toNumber()` (`report.service.ts:195,250-253,359-362,428-431,451-459`), admin MRR (`admin.routes.ts:668-671`).

### 8.1 POS sale — `createInvoice` (CONFIRMED)
- **Input** (`invoice.schema.ts:4-35`): `paymentMethodId`; optional `branchId`, `currencyId`, `customerId`, `couponCode`, `creditAmount`, `redeemPoints`, `splitPaymentMethodId`, `splitPaymentAmount`, `feeBearer (customer|merchant)`, `notes`, `externalFinancing{companyName, referenceNo, commissionPct}`; `items[{variantId, quantity:int>0, unitPrice>0}]`.
- **Calculation** (pre-transaction reads, `invoice.service.ts:132-306`):
  1. payment method active; currency exists; coupon active / not expired / `usedCount < maxUses`. **`minAmount` is not checked**; the code is looked up exactly as sent (coupon codes are stored upper-case) (`:148-156`).
  2. Line `unitPrice` = **client-supplied value** (`:209`); `variant.sellPrice` is not consulted (F-01).
  3. Product discount = first active `ProductDiscount` of the product (percentage of the line, or fixed × qty); `lineSubtotal = unitPrice×qty − discount`; `lineTax = lineSubtotal × product.taxRate%` (tax source = **product tax rate**; `tenant_settings.vatEnabled/vatRate` not used); `costAtSale = variant.costPrice` (`:207-244`).
  4. Coupon on the summed subtotal (pre-tax), percentage or fixed, capped at subtotal; tax is not recomputed after the coupon (`:247-255`).
  5. Credit = min(requested, balance) (read outside the tx); `preFeeTotal = subtotal − coupon + tax`; fee = `calculateFee(preFeeTotal, pm, feeBearer)`; `totalBeforeCredit = preFeeTotal (+ fee if customer bears)`; credit capped at that (`:258-278`; `fee.ts:9-34`).
  6. Loyalty redemption: loyalty enabled, ≥100 points, ≤ balance; capped at 50 % of `totalBeforeCredit` and at the remaining amount (`:283-302`; `loyalty.ts:24-50`).
  7. `totalAmount = totalBeforeCredit − credit − loyalty` (`:304`).
- **Transaction** (one interactive `$transaction`, Prisma default isolation): credit `decrement` (unconditional) · loyalty conditional decrement (`gte`) · `invoices` row with `discountAmount = coupon + credit + loyalty` (`:346`), `paidAmount = totalAmount`, `status 'completed'`, split fields stored **unvalidated** (no existence check, no fee, no sum check — `:357-358`), `exchangeRate = currency.rateToBase` (amounts not converted) · per line: **conditional stock decrement** (missing stock row ⇒ `insufficient_stock`), `invoice_items` (+`cost_at_sale`), `stock_movements 'out'` · conditional `coupons.used_count + 1` (raw) · `payment_fee_expenses` if merchant bears a fee · `external_financing` row · invoice number `INV-<UTC yyyymmdd>-<nextval, 6+ digits>` · loyalty earn `floor(total × pointsPerUnit)` · `audit_logs`: invoice create + customer ledger rows `credit_used`, `loyalty_redeemed`, `loyalty_earned` (`:309-550`).
- **External:** none — no ETA enqueue (§11).
- **Final state:** completed, fully paid invoice; stock and customer balances adjusted.

### 8.2 Return — `returnInvoice` (CONFIRMED, `invoice.service.ts:555-680`)
Input `returnType refund|credit`, items with `restock`. Rejects cancelled invoices; caps the **cumulative** returned quantity per variant. Refund per unit = `(item.subtotal + item.taxAmount − item.discountAmount) / item.quantity`, where `item.subtotal` is already net of `item.discountAmount` (`:225` vs `:608-610`) — the line discount enters twice (**F-04**, arithmetic CONFIRMED; business intent to be confirmed in Phase 2). Invoice-level coupon/credit/loyalty/fee are not prorated. Tx: `returns` + `return_items`; restock via `updateMany` (no row ⇒ silent no-op, movement still logged); `credit` ⇒ `customers.credit_balance += amount`; `refund` ⇒ no money record. Invoice status unchanged; earned loyalty not reversed; ETA not notified.

### 8.3 Cancel — `cancelInvoice` (CONFIRMED, `:692-870`)
Refused if already cancelled, status `returned`, or any `returns` row exists. Tx: release coupon (`GREATEST(used_count−1,0)`), restock product lines (`'cancellation'` movements), reverse credit / earned loyalty / redeemed loyalty by reading the matching `audit_logs` entries, set `cancelled`, audit. **Not reversed:** `payment_fee_expenses`, `external_financing`, installment contract, ETA document.

### 8.4 Payment methods & fees (CONFIRMED)
Fee types `none/percentage/fixed/both`; bearer `customer` ⇒ added to total, `merchant` ⇒ `payment_fee_expenses` (deducted in P&L). **Vocabulary split (T-05):** provisioning seeds card (1.75 %) and valU (3 %) with `feeType: 'percent'` (`tenant.service.ts:168,171`) — not recognised by `calculateFee` (⇒ fee 0) and not accepted by the API schema (`pm.schema.ts:7`); the POS preview computes fees for `'percent'` but not `'percentage'` (`POS.tsx:39,82-90`). Tenant-created `'percentage'` methods ⇒ server charges a fee the POS preview shows as 0.

### 8.5 Discounts & coupons
Product discounts: date-ranged, percentage|fixed, first active per product (`invoice.service.ts:180-191`). Coupons: percentage|fixed (no upper bound on percentage; capped at subtotal), `maxUses` (race-safe increment), `expiresAt`, `minAmount` stored and returned by `/validate` but **not enforced at sale** (`coupon.routes.ts:20-30`). Coupon CRUD under `invoices:*` permissions; hard delete.

### 8.6 Taxes
Two independent VAT sources (CONFIRMED): POS + installment lines use the product's `tax_rates` row (`invoice.service.ts:226-229`; `installment.service.ts:179-182`); work-order invoices use `tenant_settings.vatEnabled/vatRate` (`workOrder.routes.ts`, invoice route). Prices are treated as tax-exclusive in both.

### 8.7 Customer credit & loyalty
Source of truth `customers.credit_balance` / `customers.loyalty_points` (mutable counters). Writers: POS (decrement / earn / redeem), return-as-credit (increment), cancel (reversal via audit), manual `POST /api/customers/:id/credit` (absolute set from a float sum, not atomic — CU-01). The **ledger is `audit_logs`** (`credit_used`, `credit_add`, `credit_deduct`, `loyalty_*`); `GET /:id/credit-ledger` reads it and omits `loyalty_redeemed`/`loyalty_redeem_refunded` (`customer.routes.ts:335-344`). Loyalty is not earned on installments or work orders and not reversed on returns.

### 8.8 Installments (CONFIRMED, `installment.service.ts`)
- **Create** (`:100-303`; route quota `installment.routes.ts:57-90`): monthly quota `maxInstallmentPlansMonthly` (server-local month); client `unitPrice`; product discount; product tax; fee (no bearer override); `downPayment ≤ total`; **flat interest** `principal × rate% × (count/12)`; `monthly = round((principal+interest)/count)`; `contractTotal = down + principal + interest`; tx creates invoice `status 'pending', paidAmount 0` + items + contract `pending_approval`; **stock untouched**.
- **Approve** (`:307-401`; status checked before the tx): contract `active`, invoice `completed` with `paidAmount = downPayment`, conditional stock decrement + movements, schedule rows whose `amount_paid` column holds the **scheduled** amount (last row absorbs rounding).
- **Reject** (`:405-433`): contract and invoice set to `cancelled` (not `rejected`).
- **Record payment** (`:437-492`): full amount only, strictly in order, `status 'paid'`; `paymentMethodId` accepted by the schema (`installment.schema.ts:30`) but **never persisted** (IN-03); invoice `paidAmount` never updated after approval; contract `completed` when all paid. Status `overdue` is read in several places but **written nowhere** (IN-04). No late fees, no interest-revenue recognition.

### 8.9 External financing
Recorded only (`external_financing`: company, reference, commission %) on a normal completed POS invoice; no receivable/commission accounting.

### 8.10 Purchasing & suppliers (CONFIRMED)
PO total = Σ unitCost × qty (Decimal). Receive ⇒ `suppliers.balance += batchCost` + `supplier_transactions 'purchase'`; PO payment ⇒ `purchase_payments`, `PO.paidAmount +=`, `supplier_transactions 'payment'`, `suppliers.balance −=` (overpayment check before the tx; allowed at any PO status) (`po.routes.ts:227-451`). Manual supplier transactions `purchase/payment/return` change the balance directly (`supplier.routes.ts:15-19,179-214`).

### 8.11 Expenses
`pending → approved` (`expenses:approve`) or `rejected` (`expenses:delete`); the creator may approve their own expense; `paymentMethod` is free text; only approved expenses feed budgets and P&L (`expense.routes.ts:77-184,189-229`).

### 8.12 Work orders
`deposit`, `estimatedTotal`, `finalTotal`, `paidAmount` (read-modify-write, no overpayment check, first payment locks `finalTotal` if null). Invoice generation: VAT from settings, fees 0, `paidAmount = total`, number `SVC-<date>-<uuid6>` (not the sequence), `etaStatus 'not_required'`, no `requireUnderLimit('invoices')` (WO-02).

### 8.13 COGS & weighted-average cost (CONFIRMED)
On PO receipt: `newCost = (onHandAllBranches × currentCost + receivedQty × unitCost) / total` (`cost.ts:14-29`; `po.routes.ts:299-319`) — **one global cost per variant**. `cost_price` is also directly editable via `PATCH /api/products/:id/variants/:variantId`. Each sale snapshots `cost_at_sale`. P&L COGS = Σ qty × (`cost_at_sale` ?? current `cost_price`) over completed invoices (`report.service.ts:423-431`); returns do not reverse COGS. Stock valuation = qty × current cost.

### 8.14 Profit & loss (CONFIRMED, `report.service.ts:386-478`)
`revenue = Σ completed invoice totalAmount (gross incl. VAT and customer-borne fees) + Σ work_orders.paidAmount (by paidAt)`; `netRevenue = revenue − Σ refund-type returns`; `grossProfit = netRevenue − COGS`; `netProfit = grossProfit − approved expenses − merchant fee expenses`. A work order that is both paid and invoiced contributes to both revenue terms (WO-03).

### 8.15 Where calculations happen

| Calculation | Authoritative | Client side |
|---|---|---|
| Line price | **client** (`unitPrice` trusted) | POS cart |
| Totals, tax, coupon, credit, loyalty, fees | server (`invoice.service.ts`) | POS preview (own fee function) |
| Coupon minimum | client only | POS |
| Installment schedule / interest | server | UI preview (not inspected — UNVERIFIED) |
| Reports, P&L, day close | server, on the fly | client Excel export (`xlsx`) |
| SaaS charge amount | server (`priceAtSubscription`) | — |

Subscriptions (SaaS billing) are mapped in §10.

---

## 9. Inventory Flow

**Source of truth:** `stock.quantity` (`INT`) per `(variant_id, branch_id)` (unique). `stock_movements` is an append-only history that is **not** reconciled against `stock` and is not written by every path. DB backstop: `CHECK (quantity >= 0)` (`NOT VALID`, new writes only).

| Event | Stock effect | Guard | Movement | Evidence |
|---|---|---|---|---|
| Product / variant created | qty-0 rows for every **active** branch | — | none | `product.service.ts:53-90,152-186`; `product.routes.ts:101-105,226-230` |
| Branch created | **no** rows for existing variants (later sales there fail `insufficient_stock` until a row exists) | — | — | `index.ts:428-437` |
| CSV import | one row (CSV `branch_id` or actor branch) with imported qty | — | **none** | `product.routes.ts:565-572` (endpoint unreachable — S-03) |
| POS sale | decrement in tx | `quantity >= qty` | `out` −qty | `invoice.service.ts:364-400` |
| Installment created | none (no reservation) | — | — | `installment.service.ts:228-302` |
| Installment approved | decrement in tx | `quantity >= qty` | `out` | `installment.service.ts:335-360` |
| Return | increment if `restock` (no row ⇒ no-op) | none | `return` +qty (logged even when no row) | `invoice.service.ts:636-653` |
| Cancel | increment | none | `cancellation` | `invoice.service.ts:722-738` |
| Manual adjust | delta | negative delta needs `quantity >= |delta|` | `adjustment` | `stock.service.ts:75-125` |
| Transfer created | none (no reservation) | — | — | `stock.service.ts:189-216` |
| Transfer approved | source **unconditional** decrement after a **pre-tx** availability/status check; destination upsert | pre-tx only | `transfer` −/+ | `stock.service.ts:218-307` |
| PO receipt | upsert increment on the PO branch | pre-tx outstanding check | `in` | `po.routes.ts:293-337` |
| Work order | none (service lines only) | — | — | `workOrder.routes.ts` |

**COGS links:** PO receipt rewrites `product_variants.cost_price` (WAC across all branches); manual variant edits can overwrite it; sales snapshot `cost_at_sale` (read before the tx). `GET /api/products/search` and `/barcode/:code` return `costPrice` to any `products:read` holder (S-05). `listStock`'s `lowStock` filter is applied after pagination (S-09).

---

## 10. Payment / Paymob Flow

**Scope:** Paymob is used only for Hesba's own SaaS subscriptions. Tenant POS payment methods are bookkeeping labels — no gateway calls exist in invoices/payment-methods (CONFIRMED).

### 10.1 Checkout (CONFIRMED)
SPA Settings → `POST /api/billing/checkout {firstName,lastName,email,phone}` (`billing:create`; super_admin only in practice) (`Settings.tsx:305-311`) → `startCheckout`: subscription = `findFirstOrThrow({where:{tenantId}})` **without `orderBy`**; `amountCents = priceAtSubscription × 100` (`billing.service.ts:92-115`) → `PaymobClient.startCheckoutSession` (`paymob.client.ts:96-116`): `POST /auth/tokens` (api_key) → `POST /ecommerce/orders` (`merchant_order_id = sub_<tenantId>_<Date.now()>`) → `POST /acceptance/payment_keys` (integration `PAYMOB_INTEGRATION_ID_CARD`, `redirect_url = FRONTEND_URL/settings?tab=billing`, `notification_url = FRONTEND_URL/api/billing/paymob/webhook`) → iframe URL → full-page browser redirect. **No internal record** (e.g. a PENDING attempt) is created at checkout; the plan/billing cycle cannot be chosen (amount = existing subscription price). `fetch` calls have no explicit timeout (B-07).

### 10.2 Webhook (CONFIRMED) — `POST /api/billing/paymob/webhook`
Public, outside the tenant scope, no rate limit, no body schema (`billing.routes.ts:27-61`). Requires `?hmac`; `verifyPaymobWebhook` = HMAC-SHA512 with `PAYMOB_HMAC_SECRET` over 20 transaction fields in fixed order; fails closed if the secret is unset; length check + `timingSafeEqual` (`paymob.webhook.ts:9-61`).

| Provider signal | Internal effect |
|---|---|
| `success && !is_refunded && !is_voided` | `handleWebhookSuccess`: tenant id = `merchant_order_id.split('_')[1]`; subscription = `findFirst({tenantId})` **without `orderBy`**; tx: `PaymentAttempt SUCCESS` (`providerTransactionId` unique ⇒ duplicate = P2002 no-op) + subscription `ACTIVE`, counters reset, period `now → now + cycle`, `providerCardToken = obj.token` (plaintext). `amount_cents` recorded but **not compared** with the expected price (B-04). Cache invalidation; email |
| `error_occured \|\| (!success && !pending)` | `handleWebhookFailure`: `failedAttempts + 1`; status by count ≥3 `PAST_DUE`, ≥7 `SUSPENDED`, ≥14 `CANCELLED`; `PaymentAttempt FAILED`; email |
| `pending`, or refunded/voided with success | nothing (200) — `REFUNDED` is never written |
| missing / invalid HMAC | 400 / 401 |

### 10.3 Recurring charges
- **Renewal** 07:00: `ACTIVE`, `currentPeriodEnd ≤ now`, card token, `!cancelAtPeriodEnd`, `failedAttempts = 0` ⇒ new order + `chargeWithToken` (`POST /acceptance/payments/pay`, source `TOKEN`) ⇒ the same success/failure handlers with locally built `merchant_order_id` (`renewal.job.ts:62-175`). Paymob's own webhook for that transaction is then LIKELY a P2002 no-op.
- **Dunning** 08:00: `ACTIVE/PAST_DUE/SUSPENDED`, `failedAttempts > 0`, card token, ≥3 days since `lastFailedAt` ⇒ charge (`dunning.job.ts:61-165`).
- **Trial expiry** 06:00: `TRIALING` past `trialEndsAt` ⇒ `PAST_DUE`, `failedAttempts 1`, `lastFailedAt now` (`trial-expiry.job.ts:115-149`). Without a stored card token dunning never retries and nothing escalates further, and the tenant middleware does not block `PAST_DUE` (**J-06**, CONFIRMED by combining these paths).

### 10.4 Cancellation, admin actions, refunds, reconciliation
`POST /billing/cancel` (any authenticated user): `TRIALING`/`CANCELLED` ⇒ immediate `CANCELLED`, otherwise `cancelAtPeriodEnd = true`; the 06:00 sweep flips due ones; `/billing/resume` clears the flag (`billing.service.ts:297-347`; `billing.routes.ts:144-212`). Admin: extend trial (`TRIALING/PAST_DUE ⇒ TRIALING`), cancel, reactivate (`PAST_DUE/SUSPENDED ⇒ ACTIVE` + new period, no payment record) (`admin.routes.ts:509-646`). No refund API; `reconcilePayments()` is a placeholder that is never scheduled (`dunning.job.ts:167-173`).

### 10.5 Plan ↔ subscription linkage
Admin plan change updates `Tenant.planId` only — `Subscription.planId` / `priceAtSubscription` are unchanged (`admin.routes.ts:317-350`), so charges follow the subscription row while feature/limit gates follow the tenant's plan (P-04). The three seeded plans are re-upserted on every boot (D-06, §15).

---

## 11. ETA / E-Invoicing Flow

### 11.1 Configuration & credentials (CONFIRMED)
- `tenant_settings`: `eta_enabled` (seeded `true`), `eta_environment` (default `preprod`), `eta_taxpayer_id`, `eta_activity_code`, `eta_branch_code` (`'0'`), encrypted `eta_client_id` / `eta_client_secret` / `eta_signing_cert`, `eta_auto_submit` (never read), `eta_doc_type` (never read), issuer name/address (migration 014).
- `PATCH /api/settings` (authenticate only) writes taxpayer/activity/branch/issuer fields. The UI also sends `etaEnvironment` (`Settings.tsx:2161-2166`), but the endpoint's zod schema has no such key (`index.ts:277-305`), so it is stripped — **the environment cannot be changed through the API** (E-07).
- `PUT /api/settings/eta/credentials` (authenticate only): AES-256-GCM with `APP_ENCRYPTION_KEY` (12-byte IV, auth tag, `iv:tag:ciphertext` base64; key = 64-hex or base64) (`shared/utils/encryption.ts:7-34`); write-only; `GET /api/settings` returns booleans instead (`index.ts:258-273,344-375`).
- `POST /api/settings/eta/test`: decrypt → OAuth `client_credentials` `POST {base}/connect/token`; base chosen by `etaEnvironment === 'production'` (`index.ts:381-409`; `eta/eta.client.ts:22-54`).

### 11.2 Triggering (CONFIRMED, E-02)
The **only** producer of ETA jobs is `POST /api/admin/eta/resubmit/:invoiceId` (`eta:manage` ⇒ super_admin), which sets `eta_status 'pending'` and enqueues (`eta.routes.ts:9-39`). POS invoices, installment approvals and work-order invoices never enqueue (work-order invoices hard-code `not_required`); new invoices keep the column default `not_required`.

### 11.3 Worker (`jobs/eta-submission.job.ts:63-226`) — queue `eta-submissions`, concurrency 3, 5 attempts, backoff 30 s / 2 min / 10 min / 1 h / 6 h, failed jobs retained
1. `SELECT … FROM invoices CROSS JOIN tenant_settings` including **non-existent columns** `eta_signing_cert_pem`, `eta_is_production` (E-01) — against the schema the repo's migrations create, this statement cannot succeed (static CONFIRMED; production runtime UNVERIFIED).
2. Gating: `eta_enabled = false` ⇒ `not_required`; missing taxpayer id / client id / secret / issuer fields ⇒ `pending_setup`.
3. Items via `JOIN product_variants` ⇒ service lines (`variant_id NULL`) are excluded.
4. `eta_status 'submitted'` → `submitInvoiceToEta`.
5. Accepted ⇒ `UPDATE invoices SET … eta_qr_data …` (non-existent column; real `eta_qr_code`).
6. Rejected ⇒ `rejected` + `eta_error` (no retry); failure ⇒ `failed` + throw (retry); after the last attempt the `failed` listener sets `failed`.

### 11.4 Preparation, canonicalisation, hashing, signing, submission (CONFIRMED)
- `submitInvoiceToEta` (`eta/eta.submit.ts:32-107`): decrypt credentials; attempt number = `MAX(attempt_number)+1`; build payload; canonical form = `JSON.stringify` with recursively sorted keys (`eta.signer.ts:21-29`); if a signing cert is stored, RSA-SHA256 over that JSON with the decrypted PEM ⇒ `signatures:[{signatureType:'I', value}]` (`:45-63`). The signer's own comments state production needs CAdES-BES via HSM/USB token; `hashDocument()` is unused. Submit `POST /api/v1.0/documentsubmissions`; match `accepted/rejectedDocuments` by `internalId === invoice_number`; insert `eta_submissions` rows with drifted columns and without `direction` (E-01).
- Payload (`eta.payload.ts:8-126`): issuer `{address, type 'B', id, name}`; **receiver never supplied** by the worker; `documentType 'I'`, version `1.0`; `dateTimeIssued` = invoice `created_at`; `internalId` = invoice number; `branchId '0'` (`eta_branch_code` never passed); lines in EGP with VAT `T1/V009` at the line's tax rate; all discount totals `0` (line and invoice-level discounts not represented). A fix for discounts is on unmerged branch `claude/eta-01-preprod` (`3819976`).

### 11.5 Responses, status sync, QR, identifiers
- No status synchronisation (`getDocumentStatus` is never called); no ETA cancellation / credit-note flow on cancel or return.
- QR = URL string `https://[preprod.]eta.gov.eg/taxmobile/Index?documentId=<longId>`; PNG generation requires `qrcode` (not installed) and is unused; the web app never reads `eta_qr_code`.
- Identifiers: invoice UUID; `internalId` = `invoice_number`; ETA `uuid` / `longId` → `eta_uuid` / `eta_long_id`; `eta_internal_id` (unique) is never written.

---

## 12. Redis / BullMQ / Background Jobs

**Connection:** one IORedis client (`lazyConnect`, `maxRetriesPerRequest: null`) shared by the tenant cache, sessions, rate limiter, locks, dashboard cache and every Queue/Worker (`config/redis.ts:4-7`). `tenantMiddleware` awaits Redis before any DB access, so Redis is on the critical path of every tenant request; with `maxRetriesPerRequest: null` commands queue while disconnected, so requests LIKELY stall rather than fail fast during an outage (runtime UNVERIFIED).

### 12.1 Key inventory (CONFIRMED)

| Key | Writer | TTL | Purpose |
|---|---|---|---|
| `tenant:<subdomain>` | tenant middleware | 300 s | tenant + plan JSON |
| `sub:status:<tenantId>` | tenant middleware | 30 s | latest subscription status |
| `refresh:<token>` | auth service | 7 d | tenant session (only copy) |
| `platform_refresh:<token>` | admin auth service | 7 d | admin session |
| `rate:forgot:<email>` | auth service | 1 h | reset throttle (all tenants) |
| plugin keys | `@fastify/rate-limit` | window | per-IP route limits |
| `lock:<name>` | `withLock` | 10–25 min | job mutual exclusion — `SET NX PX`, released by `DEL` without an owner check (J-07) |
| `dashboard:<tenantId>:<branch|all>` | report service | 120 s | dashboard cache |
| `bull:<queue>:*` | BullMQ | — | queues, repeatables, job data |

### 12.2 Jobs (CONFIRMED)

| Job | Producer / schedule | Consumer | Payload | Retry & backoff | Concurrency / lock | Tenant context | DB | External | Failure handling |
|---|---|---|---|---|---|---|---|---|---|
| `trial-expiry` | `scheduleTrialExpiry()` at boot, cron `0 6 * * *`, `jobId trial-expiry-daily` | `startTrialExpiryWorker` | `{}` | default (1 attempt) | 1 / lock 10 min | none (master) | master `subscriptions` | Resend | reminder errors logged, retried next day; sweep errors logged |
| `renewal` | cron `0 7 * * *` | `startRenewalWorker` | `{}` | 3 attempts, exponential 60 s | 1 / lock 25 min | none | master | Paymob, Resend | per-sub errors counted, job rethrows ⇒ whole cycle retried |
| `dunning` | cron `0 8 * * *` | `startDunningWorker` | `{}` | 3 attempts, exponential 60 s | 1 / lock 25 min | none | master | Paymob | same as renewal |
| `installment-reminders` | cron `0 9 * * *` **and** `POST /api/installments/send-reminders` (tenant route, `installments:update`) which calls `runReminderCycle()` directly — **iterating every ACTIVE tenant, bypassing the lock, and returning cross-tenant summary counts** (`installment.routes.ts:216-224`; `installment-reminders.job.ts:69-90`) | `startReminderWorker` | `{}` | default | 1 / lock 25 min (cron path only) | iterates master `tenants` (ACTIVE) → `getTenantDb` | tenant `installment_payments`, `audit_logs` | Resend | per-payment errors counted; idempotency via `audit_logs` `reminder_sent` within 24 h |
| `eta-submissions` | `enqueueEtaSubmission` from the resubmit route only | `startEtaWorker` | `{invoiceId, tenantId, schemaName}` | 5 attempts, custom 30 s/2 m/10 m/1 h/6 h | 3 | `schemaName` from job data | tenant `invoices`, `tenant_settings`, `eta_submissions` | ETA | permanent failure ⇒ `eta_status 'failed'`; failed jobs kept |

**Scheduling notes:** repeatables are declared without `tz`, so cron times follow the container clock (`node:20-alpine` defaults to UTC — LIKELY; comments describe local times). Schedules are re-added at each boot; every API replica runs all five workers, relying on `withLock`. `getEtaQueue()` creates a new `Queue` per enqueue (never closed) (`eta-submission.job.ts:17-31`). Graceful shutdown closes the HTTP server, then workers, within 25 s (`index.ts:516-536`).

---

## 13. File Storage

| Aspect | Implementation | Evidence |
|---|---|---|
| Provider | Cloudflare R2 (S3 API); client only if `R2_ACCOUNT_ID` is set; one bucket `R2_BUCKET_NAME`; public base `R2_PUBLIC_URL` | `config/r2.ts:5-14` |
| Upload: product images | `GET /api/products/upload-url?contentType&fileName` (`products:create`) — jpeg/png/webp; key `products/<uuid>.<ext>`; presigned PUT 300 s + public URL | `product.routes.ts:43-67`; `product.schema.ts:56-59` |
| Upload: customer documents | `POST /api/customers/:id/documents` (`customers:update`) — jpeg/png/pdf; key `customers/<customerId>/<uuid>.<ext>`; DB row with the **public** URL created before the client uploads | `customer.routes.ts:162-207` |
| Validation | MIME enum at presign time only; no size limit; no content check; `fileName` unused | — |
| Tenant association | none in the key; one bucket for all tenants | — |
| Download | `GET /api/customers/:id/documents/:docId/download` ⇒ presigned GET 300 s from the key recovered from the stored public URL (non-R2 URLs returned as-is). Real privacy depends on bucket settings (UNVERIFIED) | `customer.routes.ts:213-239`; `r2.ts:41-57` |
| Other URL fields | arbitrary client-supplied URLs (zod `url()`): product/variant `imageUrl`, installment `signatureUrl`, PO `invoiceImageUrl`, PO/expense/installment `receiptUrl` | schemas |
| Deletion | none (no R2 delete; no document delete route) | — |
| Frontend wiring | **no web code calls** `upload-url` or the documents endpoints (S-02) | grep |
| Imports | product/customer CSV sent as `multipart/form-data` (`accept=".csv"`); `@fastify/multipart` is a dependency but **never registered** ⇒ Fastify answers **415** before the handler (reproduced on 4.29.1 — S-03). If reached, the handler splits CSV on `,` and audits with `entityId:'bulk'` into a UUID column | `Products.tsx:112-118,224`; `Customers.tsx:331-337,426`; `product.routes.ts:462-584`; `customer.routes.ts:362-430` |
| Exports | server Excel (exceljs): sales / stock / P&L, customer statement (affected by CU-03), supplier statement; client Excel via dynamic `xlsx`; RFC 5987 filenames | `report.routes.ts`; `customer.routes.ts:242-317`; `supplier.routes.ts:217-295`; `shared/utils/content-disposition.ts` |

---

## 14. Frontend Architecture

| Concern | Implementation | Evidence |
|---|---|---|
| Bootstrap | StrictMode, BrowserRouter (v7 flags), QueryClient (stale 5 min, retry 1), Toaster; hash session restore; service worker in production | `main.tsx:15-88` |
| Routing | guest routes (`/login`, `/forgot-password`, `/reset-password`, `/register`) under `GuestGuard`; public `/`; protected routes = `AuthGuard` + `RoleGuard(resource, action)` (+ `FeatureGate` for suppliers/expenses/services/work-orders — **not** purchase-orders, which the API gates on `suppliers`); admin routes under separate guards; catch-all ⇒ `/`; `/dev/components` dev-only; `Onboarding.tsx` exists but is not routed | `App.tsx:65-119` |
| Auth state | Zustand `persist('hesba-auth')` = `{user (incl. permissions), tenantSubdomain}`; access token in memory only; `AuthGuard` checks only that `user` exists | `stores/auth.store.ts:23-60`; `guards/AuthGuard.tsx:6-15` |
| Admin auth state | `persist('hesba-admin-auth')` = `{admin, accessToken}` | `stores/admin-auth.store.ts:20-41` |
| API client | axios `/api`, `withCredentials`; request interceptor refreshes stale tokens then adds `Bearer` + `X-Tenant-Subdomain`; 401 ⇒ single refresh with a resolve/reject queue ⇒ logout + toast on failure | `api/client.ts:5-124` |
| Tenant context | subdomain typed at login, persisted, sent on every call (ignored by the server on subdomain hosts) | `Login.tsx:15-19,66` |
| Cross-origin session | `#s=` fragment carries access token + user to the tenant subdomain | `Login.tsx:74-83`; `main.tsx:15-43` |
| Server state | TanStack Query; `useMe` (`/auth/me`: plan features & limits), `useUsage`, `useSubscriptionStatus` | `hooks/useMe.ts`, `hooks/useSubscription.ts` |
| Forms | react-hook-form + zod; shared 12-char `passwordSchema`; Login keeps `min(8)` | `lib/validation.ts`; `Login.tsx:15-19` |
| Feature flags / permissions UI | `hasPermission` (super_admin bypass), `ForbiddenView`, `FeatureGate` upgrade card | `AuthGuard.tsx:34-100`; `FeatureGate.tsx` |
| Printing | `lib/print.ts` escapes every interpolation (`esc`); other `document.write` sinks without it: Installments contract print (customer name/phone; also uses `contractNumber`/`remainingAmount`, which the API does not return), DayClose (payment-method names), POS day-close popup, Settings print-template preview (tenant HTML; the stored template is used only for this preview) | `print.ts:16-32`; `Installments.tsx:519-565`; `DayClose.tsx:78-116`; `POS.tsx:978-983`; `Settings.tsx:2570-2583` |
| Offline | failed POS sales stored in `localStorage.pos_offline_queue`, replayed via `POST /invoices` when online — no idempotency key | `POS.tsx:116-140` |
| Service worker | network-first HTML, cache-first assets, skips `/api/` | `public/sw.js:31-82` |
| Analytics | GA4 shim (`VITE_GA_MEASUREMENT_ID`, DNT respected) | `lib/analytics.ts` |
| Checkout | `POST /billing/checkout` ⇒ `window.location.href = iframeUrl` | `Settings.tsx:305-311` |
| Error handling | per-route `ErrorBoundary` (reset on path change), `getApiErrorMessage`, toasts | `App.tsx:54-63`; `lib/api-error.ts` |
| Build | `vite build` succeeds; largest chunks Reports 435 kB, xlsx 429 kB (lazy), index 322 kB | §16 |

**Important frontend↔backend boundaries:** (1) line prices are computed client-side and trusted by the server; (2) fee preview uses a different vocabulary than the server; (3) UI permissions come from the login payload, server permissions from the JWT; (4) the Settings page requires `settings:read` in the UI while its API only requires authentication; (5) `etaEnvironment` is silently dropped by the API; (6) emailed links (`/reset`, `/billing/checkout`) match no SPA route; (7) CSV imports send a content type the API does not parse.

---

## 15. Infrastructure / Deployment

| Aspect | Finding | Evidence |
|---|---|---|
| Image | Multi-stage `node:20-alpine`: **deps** (`pnpm install --frozen-lockfile`, dev deps) → **builder** (`prisma generate` ×2, `vite build`, `tsc && tsc-alias`) → **runner** (`openssl`, `tini`, global `prisma@5` + `tsx@4`, prod deps with `--ignore-scripts`, generated clients, prisma dir, tenant SQL, API `dist`, web `dist`; non-root `nodejs` uid 1001; `NODE_ENV=production`; `EXPOSE 3000`; `ENTRYPOINT tini`) | `Dockerfile:1-82` |
| Start command | `prisma migrate deploy` (master) → `tsx src/seeds/master.seed.ts` (re-upserts the 3 plans **including prices/limits/features** — overwrites admin edits, D-06) → `exec env API_PORT=${PORT:-3000} tsx apps/api/dist/index.js`. The comment above says `node dist/index.js — no tsx` (I-01) | `Dockerfile:84-88`; `master.seed.ts:90-101` |
| In-process boot | `seedOwnerFromEnv` → `listen` → tenant migrations **asynchronously** (requests are served while tenant schemas may still be behind the code) → 5 workers + repeatable schedules → SIGTERM/SIGINT handlers | `index.ts:466-541` |
| Production compose | `postgres:16-alpine` (password from env, volume, healthcheck, `internal` network, no published ports in the repo), `redis:7-alpine` (`--requirepass`, volume, `internal`), `app` (built from repo, `env_file: .env.production` — not in repo, `expose 3000`, `internal`+`web`), `caddy:2-alpine` (80/443, Caddyfile ro, data/config volumes, `web`) | `docker-compose.prod.yml:1-79` |
| TLS / edge | Caddy auto-HTTPS for `hesbaapp.com` (+ `www` redirect); **on-demand TLS** for `*.hesbaapp.com` with `ask` → `/internal/check-tenant`, which returns 200 for **any** `*.APP_BASE_DOMAIN` host without a tenant lookup (A-02) | `Caddyfile:1-20`; `index.ts:186-191` |
| Dev compose | Postgres (`postgres`/`password`, 5432 published on all interfaces) and Redis (6379 published, no password) | `docker-compose.yml:1-36` |
| DB credential | One `DATABASE_MASTER_URL` (compose user `postgres`) used for master queries, every tenant schema, and DDL (`CREATE/DROP SCHEMA`) | `config/database.ts`; `tenant.service.ts:255,277` |
| Env vars | Required: `FRONTEND_URL`, `DATABASE_MASTER_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (unused). Optional: `APP_BASE_DOMAIN`, `R2_*`, `RESEND_API_KEY`, `EMAIL_FROM`, `PAYMOB_*`, `ETA_PREPROD/PROD_BASE_URL`, `ETA_ENCRYPTION_KEY` (unused), `APP_ENCRYPTION_KEY`. Read directly from `process.env`: `OWNER_EMAIL/PASSWORD/NAME`, `SENTRY_DSN`, `PORT`. Web build-time: `VITE_BASE_DOMAIN` (=`hesbaapp.com` in `apps/web/.env.production`), `VITE_GA_MEASUREMENT_ID`. Startup warns (does not fail) when `APP_ENCRYPTION_KEY`/`PAYMOB_HMAC_SECRET` are missing. `.env.example` omits `APP_BASE_DOMAIN`; the local `.env` (names only inspected) omits `OWNER_*` | `config/env.ts:7-77` |
| CI | GitHub Actions on push to `main`/`claude/*` and PRs to `main`: type-check, lint (must pass), API tests, web+API build — Node 22, no DB service, **no deploy / image publish step** | `.github/workflows/ci.yml:1-119` |
| Alternate deploy paths | `railway.json` (Dockerfile builder, `/health` 120 s, restart on failure ×3); `scripts/deploy.sh` (migrate + `tsx apps/api/src/index.ts`; referenced nowhere) — which path is live is UNVERIFIED | `railway.json`; `scripts/deploy.sh` |
| Health | `/health` → 503 only when **all** tenant migrations failed (`partial` ⇒ 200); compose healthchecks exist for Postgres/Redis only | `index.ts:151-183` |
| Migrations | master: blocking at container start; tenants: async at boot + admin endpoint (which never responds — P-02) | §6.2 |
| Backups / monitoring | nothing in the repo (no dump jobs, no metrics endpoint); logs = Pino stdout at `warn` + `console.*` in jobs; Sentry inactive (A-08) | — |
| Static serving | `@fastify/static` from `apps/web/dist`; non-`/api` 404s fall back to `index.html`; CORS registered only around the API context | `index.ts:454-464` |
| Runtime versions | Docker Node 20, CI Node 22, this machine Node 23.11 / pnpm 10.33.2 | — |

---

## 16. Testing Architecture

| Test file | Tests | Covers | Notes |
|---|---|---|---|
| `src/__tests__/tenant-schema-parity.test.ts` | 3 | SQL `CREATE TABLE` names ↔ Prisma `@@map` names | **table names only** — cannot see column drift (E-01, CU-03, D-03a) |
| `src/modules/auth/__tests__/authenticate.tenant-binding.test.ts` | 6 | `authenticate` tenant binding (SEC-01) with mocked request/reply | unit level; no real routes |
| `src/shared/utils/__tests__/permissions.test.ts` | 7 | `permissionsWithinActor` (SEC-02) | — |
| `src/modules/billing/__tests__/paymob.webhook.test.ts` | 6 | HMAC verification | handlers/state machine untested |
| `src/modules/installments/__tests__/installment.math.test.ts` | 5 | installment formula | **re-implements the formula inline** instead of importing the service (IN-05) |
| `src/shared/utils/__tests__/fee.test.ts` | 9 | `calculateFee` | only the `percentage` vocabulary (seed uses `percent` — T-05) |
| `src/shared/utils/__tests__/cost.test.ts` | 5 | weighted-average cost | — |
| `src/shared/utils/__tests__/loyalty.test.ts` | 4 | loyalty redemption caps | — |
| `src/shared/utils/__tests__/decimal.test.ts` | 9 | decimal helpers | not read line by line |
| `src/shared/utils/__tests__/encryption.test.ts` | 7 | AES-GCM helpers | not read line by line |

**Absent:** HTTP/route integration tests (no `fastify.inject`), database or migration tests, raw-SQL tests, E2E, any web tests, concurrency/race tests, tenant-isolation tests beyond the unit test above, webhook-handler/job/ETA tests. Vitest config: node env, env defaults in `vitest.setup.ts`, `src/**/*.test.ts`; coverage plugin installed but not used in CI.

**Checks executed in this phase** (working tree incl. the uncommitted UI edits):

| Command | Result |
|---|---|
| `pnpm --filter @hesba/api type-check` | pass (9 s) |
| `pnpm --filter @hesba/web type-check` | pass (6 s) |
| `pnpm --filter @hesba/api lint` | pass, 0 problems |
| `pnpm --filter @hesba/web lint` | 0 errors, 55 warnings (a11y/style) |
| `pnpm --filter @hesba/api test` | **10 files, 61 tests passed** |
| `vite build --outDir <session scratchpad>` | pass (≈5 s) |
| Isolated script on the repo's Fastify **4.29.1** (scratchpad, imports no repo source) | preHandler given the bare factory `requireOwner` ⇒ **no response within 3 s** for OWNER and ADMIN; `requireOwner()` ⇒ 200 / 403 as designed; `multipart/form-data` POST without `@fastify/multipart` ⇒ **415 `FST_ERR_CTP_INVALID_MEDIA_TYPE`** before the handler |

Not executed: API emit build (type-check covers compilation), anything DB-backed (Docker daemon not running and deliberately not started), `prisma generate` (clients present and current), dependency audit. The gaps line up with the drift found: nothing runs raw SQL against a real schema, and nothing exercises route wiring.

---

## 17. Trust Boundaries

| # | Boundary | Data crossing | Who controls input | Authentication | Validation | Identifiers exchanged |
|---|---|---|---|---|---|---|
| 1 | Browser → Caddy → API (tenant routes) | JSON bodies, query strings, `Host`, `X-Tenant-Subdomain`, `Authorization: Bearer`, `refreshToken` cookie | end user / any client | JWT (shared HMAC secret) + tenant binding; opaque refresh cookie | zod per route (some routes parse queries manually: `stock.routes.ts:143-145`, `supplier.routes.ts:122-127`) | subdomain, `userId/tenantId/schemaName/roleSlug/branchId/permissions` in JWT, entity UUIDs, client prices |
| 2 | Browser → API, unauthenticated | `/api/tenants/register`, `/api/plans`, `/health`; tenant-scoped `login`/`refresh`/`logout`/`forgot`/`reset` | anyone | none | zod; rate limits on auth routes, **none on register** | subdomain, email, reset token |
| 3 | Admin browser → `/api/admin/*` | admin actions on master data | platform admins | platform JWT (same secret, `scope:'platform'`) + DB reload; `platformRefreshToken` cookie (Strict, `/api/admin`) | zod | `adminId`, tenant/plan/subscription ids |
| 4 | Internet SNI → Caddy → `/internal/check-tenant` | `?domain=` | anyone triggering a TLS handshake | none | suffix check only | hostname |
| 5 | API → PostgreSQL | Prisma queries; 24 raw-SQL sites; `CREATE/DROP SCHEMA` | API code (values partly user-derived) | one DB credential for everything | Prisma typing; raw SQL untyped/parameterised | `schemaName` |
| 6 | API ↔ Redis | tenant/plan JSON, subscription status, sessions, counters, locks, dashboard JSON, BullMQ jobs | API | `REDIS_URL` (prod `requirepass`) | none on read (`JSON.parse`, job data trusted) | subdomain, tenantId, tokens, `schemaName` in job data |
| 7 | Paymob → API webhook | transaction JSON + `?hmac` | Paymob — or anyone who can reach the URL | HMAC-SHA512 over 20 fields | HMAC only; no body schema; amount not checked | `merchant_order_id` (`sub_<tenantId>_<ts>`), transaction id, order id, card token |
| 8 | API → Paymob | API key, amounts, billing data, card token, callback URLs | API | API key → auth token | n/a | `merchant_order_id`, order id |
| 9 | API → ETA | decrypted per-tenant OAuth credentials, signed document | API (credentials typed by tenant users) | OAuth2 client credentials | ETA-side | `internalId` = invoice number, uuid/longId |
| 10 | Tenant user → API → `tenant_settings` (ETA secrets) | client id/secret, signing key PEM | any authenticated tenant user | JWT | trimmed strings | — (stored AES-256-GCM) |
| 11 | Browser ↔ R2 | presigned PUT/GET (300 s), public URLs | user | presigned signature | MIME enum at presign only | object keys without tenant prefix |
| 12 | API → Resend | recipient + HTML built from tenant/customer data (unescaped) | API; recipient can be user-supplied (`email-receipt` `to`) | Resend API key | `to` must be an email | — |
| 13 | Main domain ↔ tenant subdomain (browser) | `#s=` fragment (access token + user); `.hesbaapp.com` refresh cookie | browser / whoever crafts the link | none for the fragment | none | access token, user, subdomain |
| 14 | Tenant route → all tenants (job code) | `POST /api/installments/send-reminders` runs the all-tenant reminder cycle | any tenant user with `installments:update` | tenant JWT | none | cross-tenant summary counts |
| 15 | Jobs → tenant schemas | ETA job uses `schemaName` from Redis job data; reminders iterate master tenants | API / Redis contents | n/a | none | `schemaName`, `invoiceId` |
| 16 | Browser → GA4 | funnel events | client | n/a | n/a | — |

---

## 18. Source-of-Truth Map

| Data | Source of truth | Derived / cached copies | Synchronisation |
|---|---|---|---|
| Tenant identity, status, plan | master `tenants` | Redis `tenant:<sub>` (5 min, embeds plan); JWT `tenantId/schemaName`; Prisma client LRU keyed by `schemaName`; SPA `tenantSubdomain`; refresh payload | explicit cache deletes on admin/billing writes (§6.2); JWT until expiry |
| User identity | tenant `users` | JWT (15 min); `refresh:*` (7 d); SPA persisted `user` | refresh rebuilds the JWT from DB; persisted `user` only replaced at login |
| Permissions | `roles.permissions` | JWT permissions; SPA persisted `user.permissions` | next refresh / next login respectively |
| Plan, features, limits | master `plans` | Redis tenant cache; **seed file** (overwrites on boot); duplicate user caps `maxUsers` vs `features.max_users` (Professional 10 vs 15) | admin edit invalidates caches; seed reverts at restart |
| Subscription status | master `subscriptions` — "latest by `createdAt`" in middleware/refresh/portal, but **unordered `findFirst`** in checkout/webhook | Redis `sub:status` (30 s); SPA query (5 min) | invalidation in webhook handlers, cancel, admin actions, trial expiry |
| Product price | `product_variants.sell_price` | **invoice lines store the client-sent `unitPrice`** (no reconciliation) | none |
| Product cost | `product_variants.cost_price` (one global value, WAC on PO receipt, manually editable) | `invoice_items.cost_at_sale` snapshot | snapshot at sale |
| Inventory quantity | `stock.quantity` per variant × branch | `stock_movements` history; `/products/search` sums across branches | none (no reconciliation; some writers skip movements) |
| Invoice | `invoices` + `invoice_items` | reports (on the fly), dashboard cache (120 s), audit `create` entry, ETA fields | — |
| Customer credit balance | `customers.credit_balance` | `audit_logs` (`credit_*`) — also used *as* the reversal ledger | written in the same tx (POS/cancel); manual adjust non-atomic |
| Loyalty balance | `customers.loyalty_points` | `audit_logs` (`loyalty_*`) | same tx |
| Supplier balance | `suppliers.balance` | `supplier_transactions` | same tx/batch |
| Installment receivable | `installment_payments` rows (`amount_paid` = scheduled amount, `status`) | `invoices.paid_amount` (down payment only), contract status | contract completed when all rows paid |
| Work-order payments | `work_orders.paid_amount` (cumulative) | generated invoice with `paid_amount = total` | none |
| COGS / profit | computed in reports from invoice lines | Excel exports | — |
| SaaS payment status | **Paymob** | `payment_attempts` (only written on webhook/charge result), subscription fields | webhook + direct charge responses; no reconciliation |
| ETA document status | **ETA platform** | `invoices.eta_*`, `eta_submissions` | none (no status polling) |
| Sessions | Redis `refresh:*`, `platform_refresh:*` (only copy) | cookies | rotation on refresh |
| Files | R2 objects | public URLs stored in DB | none (no deletes) |

---

## 19. Important Cross-System Dependencies

1. **Redis is on every tenant request's critical path** (tenant + subscription lookups precede DB access) and also carries sessions, locks and queues; with `maxRetriesPerRequest: null` an outage LIKELY stalls requests (§12).
2. **One PostgreSQL database and one credential** serve master, all tenant schemas, migrations and schema DDL; connection budget ≈ 50 tenant clients × 5 + master pools + one per migration run (`config/database.ts:11-17`).
3. **Boot ordering:** master migrate → plan seed (overwrites plan edits) → owner seed (rotates password from env) → listen → tenant migrations in the background → workers. Code can serve requests against tenant schemas that have not yet been migrated.
4. **Domain configuration must agree across four places:** API `APP_BASE_DOMAIN` (tenant parsing, cookie domain, CORS, TLS ask), API `FRONTEND_URL` (CORS, Paymob redirect *and* webhook URL, reset-link fallback), web build-time `VITE_BASE_DOMAIN` (login redirect to subdomains), and DNS/Caddy wildcard. The Paymob `notification_url` is derived from `FRONTEND_URL`, so it only works because the same image serves SPA and API.
5. **Email links depend on SPA routes:** reset emails use `/reset` and trial emails `/billing/checkout`, neither of which is a route (AU-11).
6. **ETA worker ↔ tenant DDL:** the worker's raw SQL depends on column names that the migrations don't create (E-01); it also needs `APP_ENCRYPTION_KEY` to decrypt credentials and an admin to enqueue jobs (E-02).
7. **Audit log as ledger:** invoice cancellation reverses credit/loyalty by reading `audit_logs`; the credit-ledger endpoint is built from it. Audit-log integrity therefore affects balances.
8. **Plan seed ↔ admin panel:** admin edits to the three seeded plans are overwritten on each container start (D-06); admin plan changes don't update the subscription's plan/price (P-04).
9. **Prisma mirror ↔ SQL ↔ raw queries:** three hand-synchronised representations of the tenant schema; CI checks only table names.
10. **Permission vocabulary** is spread over the role seed, backend guards and frontend guards, and they disagree (`refund`, `export`, `settings`, `billing`, `eta:manage`).
11. **Single process:** HTTP, static hosting and all five workers share one Node process; every replica runs every worker, coordinated only by Redis locks.
12. **Cross-tenant job reach:** a tenant-scoped route (`send-reminders`) drives an all-tenant job function (J-08).

---

## 20. Documentation vs Code Discrepancies

Only discrepancies verified against code are listed.

| # | Source | Documented claim | Code reality | Evidence |
|---|---|---|---|---|
| 1 | `Hesba_Project_Overview.md` §6.1 step 7, §7.9 | Invoices are queued for ETA automatically when ETA is enabled; `eta-submissions` is "immediate (queue)" | the only producer is the manual resubmit route (super_admin); POS/installment/work-order flows never enqueue | `eta.routes.ts:9-39`; grep of `enqueueEtaSubmission` |
| 2 | Overview §4, §7.10 | Background auto-send with signing, hashing, QR storage and retries | worker SQL uses 5 non-existent columns; `hashDocument` unused; QR written to a non-existent column; signing is RSA over sorted JSON (the code's own comment says production needs CAdES/HSM); ETA environment cannot be set | `eta-submission.job.ts:70-81,186-190`; `eta.signer.ts:3-20,31-33`; `index.ts:277-305` |
| 3 | Overview §6 | "All money with decimal.js … no floating point in any financial calculation" | several `Number()` / `.toNumber()` money paths (F-07) | §8 intro |
| 4 | Overview §4 (Products, Customers) | Product images on R2; customer documents with signed download links | endpoints exist but no UI code calls them | grep of `apps/web/src` |
| 5 | Overview §4 (Products, Customers) | "Excel import" | CSV only (`accept=".csv"`, naive comma split) and the multipart parser isn't registered ⇒ 415 | `Products.tsx:224`; `product.routes.ts:463-472`; §16 reproduction |
| 6 | Overview §4 (Customers) | Customer account statement | statement query selects non-existent `installment_contracts.remaining_amount` | `customer.routes.ts:259-260` |
| 7 | Overview §4 (Day Close) | Summary by payment method **and cashier** | grouped by payment method only | `report.service.ts:580-665` |
| 8 | Overview §6.4 | Rejected contracts become `rejected` | set to `cancelled` (contract and invoice) | `installment.service.ts:414-422` |
| 9 | Overview §6.2 | Default methods: Visa/Master 1.75 %, valU 3 % | seeded with `feeType 'percent'`, which the server's fee function ignores ⇒ fee 0 | `tenant.service.ts:168,171`; `fee.ts:14-26` |
| 10 | Overview §3.1–3.2 | Plan features (multi-currency, advanced reports, API access, offline) enforced via `requireFeature` | only `suppliers`, `expenses`, `services` are enforced | §5.3 |
| 11 | Overview §8 | Access token kept in memory only | true for the tenant app; the admin panel persists its access token in `localStorage` | `admin-auth.store.ts:38` |
| 12 | Overview §7.11 | Printing via `lib/print.ts` with every value escaped | four other `document.write` paths don't escape | §14 |
| 13 | Overview §9.1; `Dockerfile:84-87` comment | Container runs `node dist/index.js` | runs `tsx apps/api/dist/index.js` | `Dockerfile:88` |
| 14 | Overview §13; `billing.service.ts:64-81` comment | Per-tenant subdomains aren't resolvable; tenants are identified by header on the main domain | production web build redirects logins to `https://<sub>.hesbaapp.com/#s=…`; reset/trial emails link to subdomains; Caddy serves `*.hesbaapp.com`. Actual DNS UNVERIFIED | `Login.tsx:74-83`; `apps/web/.env.production`; `email.ts:313-316`; `trial-expiry.job.ts:51-56`; `Caddyfile:15-20` |
| 15 | Overview §8 | "Zod on every request" | webhook body unvalidated; some list endpoints parse queries by hand | `billing.routes.ts:32`; `stock.routes.ts:143-145`; `supplier.routes.ts:122-127` |
| 16 | Overview §3.2/§3.3 | SUSPENDED/CANCELLED lock everything except auth (to log in) and billing (to pay) | exemption is the whole `/api/auth/` prefix, incl. user/role management and audit logs | `tenant.middleware.ts:11,88` |
| 17 | Overview §4 (Invoices) | Sequential numbering `INV-YYYYMMDD-000001` | work-order invoices use `SVC-YYYYMMDD-<uuid6>` | `workOrder.routes.ts` invoice route |
| 18 | `documents/Markdown/Hesba_Technical_Architecture.md:32,44,400-401,417` | Frontend on Vercel, Redis on Upstash | one Docker image serves SPA + API; Redis self-hosted (or Railway) | `Dockerfile`; `docker-compose.prod.yml`; `index.ts:454-464` |
| 19 | Technical Architecture `:66,74` | WebSockets for offline sync | no WebSocket dependency or server; offline = `localStorage` replay | `apps/api/package.json`; `POS.tsx:116-140` |
| 20 | Technical Architecture `:375` | Passwords hashed SHA-256 + salt | bcryptjs cost 12 | `password.ts:3-11` |
| 21 | `schema.tenant.prisma:1` | "all 34 tenant tables" | 46 models | schema |
| 22 | `report.service.ts:405-410` comment | Work orders don't go through the invoice table in v1 | migration 013 + `POST /api/work-orders/:id/invoice` create completed invoices | `013_work_order_invoice.sql`; `workOrder.routes.ts` |
| 23 | `renewal.job.ts:73-75,147-150` comments | Dunning runs a 3/7/14-day retry schedule | dunning uses a single 3-day gap; escalation is by failure **count** (its own comment says so) | `dunning.job.ts:25-31` |
| 24 | `index.ts:185` / route name `check-tenant` | Tenant check for TLS issuance | suffix check only, no tenant lookup | `index.ts:186-191` |
| 25 | `fee.test.ts:7` (test assumptions) | Fee types `none/percentage/fixed/both` | seed writes `percent`; POS preview expects `percent` — tests pass while seeded data and UI disagree with them | `tenant.service.ts:168,171`; `POS.tsx:39` |

---

## 21. Unknowns / Unverified Areas

### 21.1 Runtime / production facts not observable in this phase
| Unknown | Why it matters | Evidence needed |
|---|---|---|
| Production tenant schemas: do the columns used by the ETA SQL and the customer statement exist (out-of-band DDL)? `schema_version` per tenant? Are 016/017 applied? | decides whether E-01/CU-03 are live breakages | read-only `information_schema` query on staging/prod |
| Which deployment is live (VPS compose vs Railway), replica count, container time zone, contents of `.env.production` (`APP_BASE_DOMAIN`, `FRONTEND_URL`, Resend/R2/Paymob/ETA/OWNER vars) | affects cookie domain, CORS, callbacks, cron times, whether reset links are logged to stdout | host access |
| Wildcard DNS for `*.hesbaapp.com` | the production login flow redirects to subdomains | DNS lookup |
| R2 bucket public/private, bucket CORS | customer-document privacy | R2 dashboard |
| Paymob configuration: HMAC secret, integrations, whether transaction callbacks carry `obj.token` (Paymob commonly sends card tokens in a separate TOKEN callback) | renewals/dunning depend on a stored token | sandbox callback capture |
| ETA's acceptance of this payload/signature | compliance | preprod submission |
| Effective `request.ip` behind Caddy (no `trustProxy`) | rate-limit keying, audit IPs | request inspection |
| Browser behaviour of `clearCookie` without `domain` | logout / failed-refresh cleanup | browser test |
| Redis persistence & backups; Postgres backups; Caddy on-demand TLS limits | recovery; certificate issuance abuse | ops config |
| Whether Sentry / GA are configured in production | observability | env/config |
| VPS-local edits recorded in project memory (Postgres published on `127.0.0.1:5432`) | not in the repo | host inspection |

### 21.2 Inferred, not executed
- Prisma `?schema=` sets the connection `search_path`, so unqualified raw SQL targets the tenant schema — LIKELY (standard Prisma behaviour).
- BullMQ repeatables de-duplicate across boots/replicas — LIKELY.
- Behaviour of an in-flight request whose tenant client is evicted from the LRU and `$disconnect`ed — POTENTIAL.
- JWT algorithm is HS256 (library default for a string secret) — LIKELY.
- Redis outage stalls (rather than fails) tenant requests — LIKELY.

### 21.3 Code not inspected in full (and why)
- **Web pages beyond targeted sections** — `Settings.tsx` (2,607 lines; billing, users, payment-methods and ETA sections read), `Reports.tsx`, `Dashboard.tsx`, `Stock.tsx`, `Suppliers.tsx`, `PurchaseOrders.tsx`, `WorkOrders.tsx`, `Expenses.tsx`, `Invoices.tsx`, `Returns.tsx`, `Services.tsx`, `Landing.tsx`, admin pages, `components/ui/*`. Reason: UI rendering; their API usage was cross-checked mechanically against all backend routes.
- **API files skimmed, not read line by line** — `workOrder.schema.ts` (`ALLOWED_TRANSITIONS`), `service.routes.ts` handlers (guards verified), the first ~100 lines of `customer.routes.ts` / `supplier.routes.ts` (list/create/update), expense-category routes, `reports/excel.ts` body, `decimal.test.ts`, `encryption.test.ts`.
- **Documentation** — only `documents/Hesba_Project_Overview.md` and `documents/Markdown/Hesba_Technical_Architecture.md` were compared to code; `documents/Claude_Code/*` (incl. 87 KB and 57 KB context docs), ERD, Logic Flow, Business, Design, Patch Notes, PDFs and interactive HTML were not.
- **History & branches** — 205 commits not reviewed individually; open branches (e.g. `claude/eta-01-preprod`, `claude/sec-03-frontend-password`) not diffed beyond confirming the current branch has no API/package changes.
- **Dependencies** — no vulnerability audit of `node_modules`/lockfile (requires network and is outside discovery).

### 21.4 Recommended next inspections
1. Read-only column inventory of a migrated tenant schema (local or staging), then re-run every raw-SQL statement with `EXPLAIN` inside a `READ ONLY` transaction.
2. Fastify-inject harness over the real route tree (tenant resolution, guards, 415/hang cases) — no DB writes needed for most wiring checks.
3. Paymob sandbox: checkout → callbacks (TRANSACTION + TOKEN) → renewal; record exact payloads.
4. ETA preprod: one plain invoice, one with a line discount, one with coupon/credit.
5. Full reads of `Settings.tsx`, `Reports.tsx`, `WorkOrders.tsx`, `POS.tsx` and the admin pages.

---

## 22. Highest-Risk Areas for Phase 2

Ranked by potential impact × breadth of evidence. These are **audit priorities, not findings**.

| Rank | Area | Why it deserves the deepest audit | Key observations |
|---|---|---|---|
| 1 | **Tenant identity & isolation boundary** | Isolation rests on host/header parsing, one shared JWT secret, one DB role and schema-bound clients; tenant context reaches code from client-influenced inputs in several places | M-01, M-02, AU-02, AU-03, W-03, J-08, §6 |
| 2 | **Authorization coverage & semantics** | State-changing routes with authentication only (settings incl. VAT and ETA secrets, branches, billing cancel/resume, portal exposing the card token); defined-but-unchecked and checked-but-ungranted permissions; no branch scoping; JWT-cached permissions with no user deactivation path; whole `/api/auth/` prefix exempt from the subscription gate | A-04, Z-01–Z-04, T-06, W-07, §5.3 |
| 3 | **ETA e-invoicing pipeline** | Tax-compliance surface; worker SQL drifts from the DDL; no automatic producer; environment not settable; signing stub; payload omits discounts/receiver/branch; no status sync or cancellation | E-01, E-02, E-07, §11 |
| 4 | **Sales money integrity** | Client-trusted line prices, unenforced coupon minimum, refund arithmetic, credit decrement outside a conditional, float paths, credit/loyalty stored as "discount", fee vocabulary split, unvalidated split payments, offline replay without idempotency, two VAT sources | F-01–F-07, T-05, W-08, §8 |
| 5 | **SaaS billing state machine & Paymob** | Unordered subscription selection with multiple rows allowed; amount not verified; no pending record or reconciliation; refunds ignored; expired-trial `PAST_DUE` dead end; plan/subscription divergence; seed overwrites plans; plaintext card token readable by any tenant user; broken email links | B-01–B-07, J-06, P-04, D-06, AU-11 |
| 6 | **Concurrency & transaction boundaries** | Status/availability checks before the transaction followed by unconditional writes (transfer approve, installment approve/payment, PO approve/receive, expense approve, WO payment); migration version bump outside the file transaction; lock release without owner check | S-07, IN-02, IN-03, PO-01, J-07, D-05, C-03 |
| 7 | **Inventory & cost model** | Stock-row lifecycle gaps per branch, global WAC across branches, movements skipped by some writers, silent restock no-ops, no reservations, cost price visible to cashiers | S-01–S-09, §9 |
| 8 | **Data layer drift & migration mechanics** | Hand-maintained Prisma mirror, undetected column drift, `NOT VALID` checks, naive SQL splitter, non-idempotent DDL with a version-bump gap, hard-coded tenant data fixes, mixed timestamp types | D-01–D-08, E-01, CU-03 |
| 9 | **Public / unauthenticated surface** | Unthrottled signup, no reserved subdomains, TLS ask accepts any subdomain, cross-tenant forgot-password counter, unvalidated webhook body, no `trustProxy` (rate-limit keys, audit IPs), reset links printed to stdout when Resend is unset | T-01, A-02, AU-05, AU-10, §4.1 |
| 10 | **Frontend trust & rendering** | Unverified `#s=` session injection, admin token in `localStorage`, unescaped `document.write` sinks, unescaped server email templates, CSP allowances | W-03, W-04, W-06, AU-10 |
| 11 | **Platform admin panel** | Any ADMIN can suspend tenants, change plans and cancel subscriptions; owner credentials re-seeded from env each boot; `run-migrations` never responds; tenant detail returns full subscription rows; admin refresh unthrottled | P-01–P-07 |
| 12 | **Operations & resilience** | All workers inside the API process; Redis on the critical path with unbounded retries; health semantics; no backups/monitoring in repo; Sentry inactive; single privileged DB credential | A-01, A-07, A-08, §15, §19 |
| 13 | **File storage & imports** | One shared bucket without tenant prefixes, public URLs persisted, privacy depends on an ops toggle, uploads unwired, imports unreachable | S-02, S-03, CU-02 |

---

## 23. Audit Coverage Matrix

| Area | Status | Evidence | Remaining Work |
|---|---|---|---|
| Architecture | REVIEWED | `index.ts`, Dockerfile, compose, Caddyfile, all modules (§2–3) | confirm live topology (VPS vs Railway), replicas |
| Authentication | REVIEWED | auth routes/service, admin auth, JWT plugin, middleware, web client/stores (§4) | runtime tests: cookie clearing, foreign refresh cookie, `#s=` injection, proxy IP keying |
| Authorization | REVIEWED | guard matrix for all 180 routes; role seed (§5) | per-role test matrix; confirm intended semantics of authenticate-only routes and unused permissions |
| Multi-tenancy | REVIEWED | tenant middleware, client LRU, provisioning, migration runner, jobs (§6) | adversarial cross-tenant tests (host/header/cookie/job payload/reminder trigger); prod schema inventory |
| Database | REVIEWED (static) | both Prisma schemas, 17 + 8 migrations, raw-SQL inventory (§7) | column-level introspection on a real schema; migration re-run/idempotency test |
| Financial | REVIEWED | invoice, installment, PO, supplier, customer, work-order and report code (§8) | numeric test vectors (returns, coupons, credit, fees, loyalty, installments); business-intent confirmation |
| Inventory | REVIEWED | every stock writer (§9) | concurrency tests; branch/stock-row lifecycle tests |
| Payments | REVIEWED (code) | billing routes/service, Paymob client/webhook, renewal/dunning/trial jobs (§10) | sandbox webhook + token-charge capture; amount verification; multiple-subscription data check |
| ETA | REVIEWED (code) | job, submit, payload, signer, client, routes, settings (§11) | run the worker against a migrated schema; preprod submissions; canonicalisation/signature vs ETA spec |
| Redis/BullMQ | REVIEWED | `redis.ts`, all jobs, `lock.ts`, key inventory (§12) | outage behaviour; multi-replica scheduling; time zone |
| Storage | REVIEWED (code) | `r2.ts`, upload/download routes, UI grep (§13) | bucket privacy/CORS; any non-UI upload path |
| Frontend | PARTIAL | core infrastructure files, targeted pages, full endpoint cross-check (§14) | full reads of large pages and admin pages; sink-by-sink escaping review |
| Infrastructure | PARTIAL | Dockerfile, compose, Caddy, CI, railway.json, deploy.sh (§15) | production host config, secrets handling, backups, DNS, TLS ask limits, monitoring |
| Testing | REVIEWED | 10 test files read and executed (§16) | Phase 2: integration, race, isolation, raw-SQL and route-wiring tests |

### 23.1 Observation ledger (index of IDs used in this report)

| ID | Claim | Evidence | Status | Remaining unknowns |
|---|---|---|---|---|
| A-01 | HTTP, static SPA and 5 workers run in one process | `index.ts:454-508` | CONFIRMED | replica count |
| A-02 | TLS ask endpoint approves any `*.APP_BASE_DOMAIN` host | `index.ts:186-191` | CONFIRMED | Caddy rate limits |
| A-04 | settings/ETA-credential/branch/currency routes require authentication only | `index.ts:258-449` | CONFIRMED | intended design |
| A-07 | `/health` is 200 when tenant migrations partially fail | `index.ts:166-183,490` | CONFIRMED | orchestrator usage |
| A-08 | Sentry inactive: `@sentry/node` not a dependency | `sentry.plugin.ts:10-19`; `apps/api/package.json` | CONFIRMED | prod install |
| AU-02 | refresh doesn't compare stored `tenantId` with the resolved tenant | `auth.routes.ts:92-163` | CONFIRMED | — |
| AU-03 | `clearCookie` omits the cookie's `domain` | `auth.routes.ts:42,105,125,140,169` | CONFIRMED (code) | browser effect UNVERIFIED |
| AU-05 | forgot-password counter keyed by email across tenants | `auth.service.ts:215-220` | CONFIRMED | — |
| AU-10 | email HTML interpolates unescaped data; reset link logged when Resend unset | `email.ts:11-130,172-221,318-321` | CONFIRMED | prod `RESEND_API_KEY` |
| AU-11 | emailed `/reset` and `/billing/checkout` paths match no SPA route | `email.ts:316`; `trial-expiry.job.ts:55`; `App.tsx:73,114` | CONFIRMED (static) | — |
| B-01 | no internal record at checkout; legacy Accept flow | `billing.service.ts:92-115`; `paymob.client.ts:96-116` | CONFIRMED | — |
| B-02 | subscription chosen with unordered `findFirst` in checkout/webhooks | `billing.service.ts:96-99,131,210` | CONFIRMED | whether tenants have >1 row |
| B-03 | refunded/voided/pending callbacks are no-ops | `billing.routes.ts:42-57` | CONFIRMED | — |
| B-04 | webhook `amount_cents` not compared with expected price | `billing.service.ts:117-198` | CONFIRMED | — |
| B-05 | escalation by failure count 3/7/14 | `billing.service.ts:213-222` | CONFIRMED | — |
| B-06 | `/billing/portal` returns the full subscription incl. card token to any tenant user | `billing.routes.ts:93-113` | CONFIRMED | — |
| B-07 | outbound `fetch` without timeouts (Paymob, ETA) | `paymob.client.ts:25-37`; `eta.client.ts:31-82` | CONFIRMED | — |
| C-03 | LRU eviction `$disconnect`s tenant clients | `config/database.ts:20-27` | CONFIRMED (code) | in-flight impact POTENTIAL |
| CU-01 | manual credit adjust is a float read-modify-write | `customer.routes.ts:128-143` | CONFIRMED | — |
| CU-02 | document rows store public R2 URLs; no tenant prefix | `customer.routes.ts:182-197` | CONFIRMED | bucket privacy |
| CU-03 | statement selects non-existent `remaining_amount` | `customer.routes.ts:259-260` | CONFIRMED (static) | prod schema |
| D-01 | master allows multiple subscriptions per tenant | `schema.prisma:72-112` | CONFIRMED | data |
| D-03 | SQL/Prisma drift (a/b/c) | §7.4 | CONFIRMED | — |
| D-04 | CHECK constraints are `NOT VALID`; no triggers/functions/RLS | `016_check_constraints.sql` | CONFIRMED | — |
| D-05 | `schema_version` bumped after the file transaction commits | `migrate-tenants.ts:97-109` | CONFIRMED | — |
| D-06 | boot-time seed overwrites the three plans | `Dockerfile:88`; `master.seed.ts:92-97` | CONFIRMED | — |
| D-07 | master data-fix migrations hard-code one tenant | `prisma/migrations/20260519143000_*`, `20260519160000_*` | CONFIRMED | — |
| D-08 | no `migration_lock.toml` | `prisma/migrations/` | CONFIRMED | — |
| E-01 | ETA SQL references 5 non-existent columns and omits `direction` | §7.4 | CONFIRMED (static) | prod schema |
| E-02 | only the manual resubmit route enqueues ETA jobs | `eta.routes.ts:9-39` | CONFIRMED | — |
| E-07 | `etaEnvironment` is stripped by `PATCH /api/settings` | `index.ts:277-305`; `Settings.tsx:2161-2166` | CONFIRMED | — |
| F-01 | POS/installment line prices come from the client | `invoice.service.ts:209`; `installment.service.ts:166` | CONFIRMED | intended design |
| F-02 | credit decrement is unconditional after an out-of-tx read | `invoice.service.ts:258-265,313-320` | CONFIRMED | race impact POTENTIAL |
| F-03 | `audit_logs` doubles as the customer credit/loyalty ledger | `invoice.service.ts:496-547,740-842` | CONFIRMED | — |
| F-04 | refund formula subtracts the line discount twice | `invoice.service.ts:225,608-610` | CONFIRMED (arithmetic) | business intent |
| F-05 | cancel doesn't reverse fee expense / financing / ETA | `invoice.service.ts:692-870` | CONFIRMED | — |
| F-06 | invoice `branchId` from body, refund permission unused, receipt email to any address | `invoice.routes.ts:41-42,113,174-250` | CONFIRMED | — |
| F-07 | money paths through JS `number` | §8 intro | CONFIRMED | — |
| I-01 | Dockerfile comment vs `tsx` CMD | `Dockerfile:84-88` | CONFIRMED | — |
| IN-02 | installment approve checks status before the tx | `installment.service.ts:312-326` | CONFIRMED | — |
| IN-03 | installment `paymentMethodId` accepted but not stored; invoice `paidAmount` frozen | `installment.schema.ts:30`; `installment.service.ts:455-466` | CONFIRMED | — |
| IN-04 | `overdue` status never written | grep | CONFIRMED | — |
| IN-05 | installment math test re-implements the formula | `installment.math.test.ts:4-20` | CONFIRMED | — |
| J-06 | expired never-paid trial stays `PAST_DUE` with access | `trial-expiry.job.ts:120-132`; `dunning.job.ts:74-81`; `tenant.middleware.ts:103` | CONFIRMED | — |
| J-07 | job lock released by `DEL` without owner check | `shared/utils/lock.ts:11-24` | CONFIRMED | — |
| J-08 | tenant route triggers the all-tenant reminder cycle | `installment.routes.ts:216-224`; `installment-reminders.job.ts:69-90` | CONFIRMED | — |
| M-01 | tenant resolution from host, header fallback for system hosts | `tenant.middleware.ts:18-58` | CONFIRMED | — |
| M-02 | no per-request user/role reload; JWT permissions | `auth.middleware.ts:17-64` | CONFIRMED | — |
| P-01 | admin refresh unthrottled; strict path-scoped cookie | `admin.routes.ts:26-42,113` | CONFIRMED | — |
| P-02 | `run-migrations` preHandler is the bare factory ⇒ request never completes | `admin.routes.ts:890`; §16 reproduction | CONFIRMED (reproduced) | — |
| P-03 | admin tenant detail returns full subscription rows | `admin.routes.ts:240-273` | CONFIRMED | — |
| P-04 | admin plan change leaves subscription plan/price untouched | `admin.routes.ts:317-350` | CONFIRMED | — |
| P-05 | two independent suspension mechanisms | §6.2 | CONFIRMED | — |
| P-06 | admins see tenant row counts only | `admin.routes.ts:257-270` | CONFIRMED | — |
| P-07 | owner seeded/rotated from env each boot | `admin.auth.service.ts:87-116` | CONFIRMED | prod env |
| PO-01 | PO/receipt status checks before the tx; no cancel/return-to-supplier | `po.routes.ts:192-396` | CONFIRMED | — |
| S-01 | new branches get no stock rows | `index.ts:428-437` | CONFIRMED | — |
| S-02 | R2 endpoints not called by the UI | grep | CONFIRMED | — |
| S-03 | multipart parser unregistered ⇒ imports 415 | `product.routes.ts:463`; `customer.routes.ts:363`; §16 | CONFIRMED (reproduced) | — |
| S-05 | cost price returned by search/barcode | `product.routes.ts:344-377` | CONFIRMED | — |
| S-07 | transfer approve: pre-tx check + unconditional decrement | `stock.service.ts:240-259` | CONFIRMED | — |
| S-08 | one global cost per variant (WAC across branches) | `po.routes.ts:299-319` | CONFIRMED | — |
| S-09 | low-stock filter applied after pagination | `stock.service.ts:62-70` | CONFIRMED | — |
| T-01 | signup unthrottled, no reserved names | `tenant.routes.ts:6`; `tenant.schema.ts:6-10` | CONFIRMED | — |
| T-03 | master tenant emails stored un-normalised | `tenant.service.ts:204,230-232` | CONFIRMED | — |
| T-04 | signup response hard-codes a localhost login URL | `tenant.routes.ts:20` | CONFIRMED | — |
| T-05 | `percent` vs `percentage` fee vocabulary | §8.4 | CONFIRMED | — |
| T-06 | cashier role can't list payment methods used by POS | `pm.routes.ts:9`; `tenant.service.ts:50-63` | CONFIRMED (static) | — |
| W-03 | `#s=` fragment session restore without verification | `main.tsx:15-43` | CONFIRMED | — |
| W-04 | admin access token persisted in `localStorage` | `admin-auth.store.ts:38` | CONFIRMED | — |
| W-06 | unescaped `document.write` sinks outside `print.ts` | §14 | CONFIRMED | exploitability (Phase 2) |
| W-07 | no endpoint updates/deactivates tenant users | route inventory; user write grep | CONFIRMED | — |
| W-08 | offline POS replay without idempotency | `POS.tsx:116-140` | CONFIRMED | — |
| WO-02 | work-order invoices: settings VAT, `SVC-` numbers, no ETA, no invoice limit | `workOrder.routes.ts` invoice route | CONFIRMED | — |
| WO-03 | P&L can count a paid + invoiced work order twice | `report.service.ts:398-455` | CONFIRMED (formula) | real data |
| Z-01 | authenticate-only route list | §5.3 | CONFIRMED | — |
| Z-02 | `billing:create` and `eta:manage` granted to no role | `billing.routes.ts:66`; `eta.routes.ts:11` | CONFIRMED | — |
| Z-03 | only 3 plan features enforced server-side | §5.3 | CONFIRMED | — |
| Z-04 | Professional `maxUsers` 10 vs `features.max_users` 15 | `master.seed.ts:46,52` | CONFIRMED | — |

---

*End of Phase 1 discovery. No code was changed. All observations above are inputs for Phase 2, not conclusions.*
