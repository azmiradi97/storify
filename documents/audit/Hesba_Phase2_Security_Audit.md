# Hesba Phase 2 Security Audit

> **Scope:** multi-tenancy, authentication, authorization, sessions, billing, admin and job boundaries of the Hesba codebase.
> **Method:** every security-relevant Phase 1 claim was re-verified against source; library behaviour was verified by reading the installed `node_modules` source; two route-wiring behaviours were reproduced in an isolated local Fastify 4.29.1 harness (Phase 1 §16). No source was modified; no production system, credential or data was touched; no exploit tooling was written. "Reproduction" entries below are **regression-test specifications** for a local test harness.
> **Snapshot:** branch `claude/ui-pos-merge-split` @ `8846bce` (no API diff vs `main`), 2026-10-08.
> **Labels:** CONFIRMED · LIKELY · POTENTIAL · UNVERIFIED. Severity: CRITICAL · HIGH · MEDIUM · LOW · INFO. Impact and exploitability are stated separately for every finding.

---

## 1. Executive Summary

**No CRITICAL issue was found.** The core tenant boundary holds: every authenticated tenant route binds the JWT's `tenantId`/`schemaName` to the host/header-resolved tenant (`auth.middleware.ts:34-44`), every tenant query runs on a schema-bound Prisma client, no handler accepts tenant identifiers from client input, and no path was found that lets one tenant read or modify another tenant's database records over HTTP.

The material risks sit **inside** tenants and around **platform-level shared resources**:

| | Count | Highlights |
|---|---|---|
| CONFIRMED HIGH | 2 | **HSEC-01** any authenticated employee (incl. cashier) can rewrite tenant financial/tax settings, ETA credentials and branches; **HSEC-02** the server accepts sale prices from the client |
| CONFIRMED MEDIUM | 6 | discount/credit authority on over-broad permissions (HSEC-03); subscription cancel/resume/portal open to any employee (HSEC-04); a tenant-scoped endpoint runs the reminder job **for all tenants** (HSEC-05); platform email relay with unescaped HTML (HSEC-06); no way to deactivate or re-role users (HSEC-07); expired unpaid trials keep access indefinitely (HSEC-08) |
| CONFIRMED LOW / INFO | 9 | login timing enumeration, refresh-token rotation semantics, URL-fragment session fixation, permission-model inconsistencies, unenforced plan entitlements, broad exposure of sensitive fields, broken reset-email link (availability), `run-migrations` hang (fails closed), cookie clearing |
| LIKELY (MEDIUM) | 4 | rate limits keyed to the proxy address (HSEC-18); unthrottled tenant provisioning (HSEC-19); TLS-issuance ask endpoint approves any subdomain (HSEC-20); Paymob webhook binds the tenant through an unsigned field (HSEC-21) |
| POTENTIAL | 8 | CSP-mitigated HTML injection in print popups (HSEC-22) and five other conditional items |

**Controls verified as effective:** JWT verification (HS-only, signature required — fast-jwt 4.0.5); tenant↔token binding; platform/tenant token separation; password-reset token design (256-bit, sha256 at rest, single-use atomic claim, 1 h, sessions revoked); role-escalation guard (subset rule, immutable system roles, `super_admin` not assignable by non-super-admins); zod allow-lists (no mass assignment found); webhook HMAC (fail-closed, constant-time) and transaction-id idempotency; no password hashes or decrypted secrets in any response; parameterised SQL; literal routing (no path-normalisation bypass of the subscription gate); CSP + `Referrer-Policy: no-referrer`; httpOnly/Secure/SameSite cookies and memory-only tenant access tokens.

**Biggest exposure by audience:** a *self-registered outsider* (signup is public and makes them `super_admin` of their own tenant) can reach HSEC-05, HSEC-06, HSEC-19 and HSEC-20; a *low-privilege employee* can reach HSEC-01–HSEC-04; *every tenant* is affected by HSEC-07 and HSEC-08.

---

## 2. Threat Model

| Actor | Starting position | Realistic goals |
|---|---|---|
| A1 Unauthenticated internet user | public endpoints (`/api/tenants/register`, auth routes, webhook, `/internal/check-tenant`, `/health`, `/api/plans`) | resource exhaustion, account enumeration, squatting, abuse of platform email/TLS |
| A2 Self-registered tenant owner | `super_admin` of a fresh trial tenant (free, unverified email) | cross-tenant access, platform abuse via tenant-scoped features, billing evasion |
| A3 Low-privilege employee | seeded `cashier` / `inventory_keeper` / `accountant` in a victim tenant | escalate privileges, manipulate money/settings, sabotage, exfiltrate data |
| A4 Departed / compromised employee | previously valid account and sessions | retain access after offboarding |
| A5 Platform ADMIN (non-owner) | platform JWT | owner-only operations |
| A6 Network/provider-adjacent actor | can observe or replay provider callbacks / browser redirects | forge payment state |
| A7 Script running on any `*.hesbaapp.com` page (only if an XSS exists) | same-site with every tenant and the admin panel | steal sessions across tenants |

**Trust anchors:** `JWT_ACCESS_SECRET` (one HMAC secret for tenant and platform tokens), Redis (sessions, caches, jobs), the PostgreSQL credential (one role for all schemas and DDL), `PAYMOB_HMAC_SECRET`, `APP_ENCRYPTION_KEY`, and the browser same-site boundary `hesbaapp.com`.

---

## 3. Multi-Tenant Isolation

### 3.1 Resolution chain (re-verified)
Request → `tenantMiddleware` (`tenant.middleware.ts:13-113`): host parsed against `APP_BASE_DOMAIN`; `X-Tenant-Subdomain` consulted **only** when the parsed label is empty or a system host → Redis `tenant:<sub>` (value only ever written from a `masterDb.tenant.findUnique` result) → status must be `ACTIVE` → `request.tenantDb = getTenantDb(tenant.schemaName)` (schema name from the master row) → subscription gate → route `authenticate` binds JWT `tenantId`+`schemaName` to `request.tenant` → handlers query `request.tenantDb` only.

### 3.2 Boundary tests by vector

| Vector | Result | Status | Evidence |
|---|---|---|---|
| `X-Tenant-Subdomain` on a tenant host | ignored | CONFIRMED | `tenant.middleware.ts:40-43` |
| `X-Tenant-Subdomain` / `Host` on base or system host | selects a tenant; any authenticated route then rejects a foreign token with 403 `tenant_mismatch` | CONFIRMED | `auth.middleware.ts:34-44`; unit test `authenticate.tenant-binding.test.ts` |
| JWT claim tampering (`tenantId`, `schemaName`, `roleSlug`, `permissions`) | requires a valid HMAC signature; `alg:none`/missing signature rejected; only HS256/384/512 accepted for a string secret | CONFIRMED | fast-jwt `verifier.js:146-148,195-196`, `crypto.js:166-167` |
| `tenantId` / `schemaName` in body, query or params | never read from client input anywhere | CONFIRMED | grep of `modules/`, `shared/`, `index.ts` |
| Foreign resource IDs (customer, product, variant, invoice, installment, payment, branch, user, PO, work order) | looked up on the caller's schema-bound client → not found | CONFIRMED | `config/database.ts:29-42`; all handlers use `request.tenantDb` |
| Master-DB reads/writes from tenant routes | always filtered by `request.tenant.id` | CONFIRMED | `billing.routes.ts:97-212`; `auth.routes.ts:117-122` |
| Redis tenant cache key | derived from the subdomain string; attacker cannot write values | CONFIRMED | `tenant.middleware.ts:60-75` |
| Prisma client cache / raw-SQL schema | keyed and bound by the DB-sourced schema name; raw SQL is parameterised and unqualified (search path from the client URL) | CONFIRMED | `database.ts:29-42`; Phase 1 §7.5 |
| Unauthenticated tenant routes (`login`, `forgot`, `reset`, `refresh`, `logout`) | act only on the selected tenant and require that tenant's credentials/tokens | CONFIRMED | `auth.routes.ts:48-233` |
| Refresh cookie presented to another tenant | user lookup in the other schema fails → token deleted; minted JWTs keep the original tenant claims | CONFIRMED (no exploitable path; see HSEC-10 hardening) | `auth.routes.ts:133-155` |
| Platform token on tenant routes / tenant token on admin routes | rejected | CONFIRMED | `auth.middleware.ts:35-44`; `platform-admin.middleware.ts:32-38` |
| Background-job tenant context | server-derived (`request.tenant` at enqueue; master tenant list) | CONFIRMED | `eta.routes.ts:31-35`; `installment-reminders.job.ts:83-90` |
| **Tenant-scoped trigger of an all-tenant job** | **exists** | CONFIRMED → HSEC-05 | `installment.routes.ts:216-224` |
| **Payment webhook → tenant binding** | **relies on a field outside the HMAC** | LIKELY → HSEC-21 | `paymob.webhook.ts:26-47`; `billing.service.ts:127-132` |
| Subscription-gate exemption by path tricks | not possible: routing is literal (find-my-way 8.2.2 does no dot-segment resolution; duplicate-slash folding off) | CONFIRMED | `find-my-way/index.js:87,127,567-576` |

**Conclusion:** cross-tenant **data** isolation over HTTP holds. Two cross-tenant **actions** exist (HSEC-05 confirmed, HSEC-21 likely), both outside the request→schema path.

---

## 4. Authentication

| Flow | Verified behaviour | Verdict |
|---|---|---|
| Registration | public, no rate limit, no CAPTCHA, no email verification; owner becomes `super_admin`; subdomain regex safe for DDL | signup abuse → HSEC-19; squatting INFO |
| Password hashing | bcryptjs cost 12 (`password.ts:3`) | effective |
| Password policy | 12 chars + letter + digit for new passwords (`validation.ts:8-12`); login accepts any length (legacy) | effective |
| Login | rate-limited 10/min per `request.ip`; generic error; **bcrypt skipped for unknown/inactive accounts** (`auth.service.ts:48-51`) | timing enumeration → HSEC-09; rate-limit keying → HSEC-18 |
| Access token | HS JWT, 15 min, claims incl. role + permissions; no `iss/aud/jti` | effective; stale-claim window 15 min (§8) |
| Refresh token | 32 random bytes, Redis `refresh:<token>` (plaintext key), 7 d sliding, rotation = `GET` then `DEL`+`SET` | non-atomic, no reuse detection → HSEC-10 |
| Logout | deletes server token; access token lives until expiry; `clearCookie` without `domain` | HSEC-17 (INFO) |
| Reset request | 256-bit token, sha256 at rest, 1 h, per-email 5/h + per-IP 20/min, uniform 200 response | effective (no enumeration) |
| Reset completion | atomic single-use claim; all of the user's refresh sessions deleted | effective |
| Change password | requires current password; **existing sessions not revoked** | HSEC-10 |
| Deactivation / role change / admin reset | **no endpoint exists** | HSEC-07 |
| Email verification | none | HSEC-19 context |

### 4.1 Password-reset trace (Part 6 of the brief)
`POST /api/auth/forgot-password` → token generated (`auth.service.ts:138-148`) → email link `https://<sub>.<base>/reset?token=…` (`email.ts:313-316`) → browser loads the SPA (server falls back to `index.html`) → **no route matches `/reset`**; the catch-all `<Navigate to="/" replace>` drops the query (`App.tsx:114`) → no API call is made → the token is never consumed and expires after 1 h. The working route is `/reset-password` (`App.tsx:73`, reads `token` at `ResetPassword.tsx:31`) → `POST /api/auth/reset-password` → hash lookup → atomic claim → password update → session purge (`auth.service.ts:153-211`).

**Classification:** availability/functionality (users cannot recover accounts from the email) — **HSEC-15, LOW**. No token reuse, brute-force, or enumeration weakness was found in the reset design. Two **environment-dependent leakage channels** exist (HSEC-25): (a) when GA is compiled into the build, `RouteBoundary` sends `pathname + search` — including `?token=` — as a `page_view` on both `/reset` and `/reset-password` (`App.tsx:57-60`, `lib/analytics.ts:133-139`); (b) when `RESEND_API_KEY` is unset, reset links are printed to stdout in any environment (`email.ts:318-321`).

---

## 5. Authorization

### 5.1 Route × permission × feature × scope (security-relevant groups)

| Endpoint group | Backend check | Feature gate | Scope | Seeded roles that pass | Gap |
|---|---|---|---|---|---|
| `GET/PATCH /api/settings` | `authenticate` only | — | tenant | **all** | HSEC-01 |
| `PUT /api/settings/eta/credentials`, `POST /api/settings/eta/test` | `authenticate` only | — | tenant | **all** | HSEC-01 |
| `GET/POST/PATCH /api/branches` | `authenticate` (+limit on POST) | — | tenant | **all** | HSEC-01 |
| `GET /api/currencies`, `GET /api/auth/roles` | `authenticate` | — | tenant | all | INFO (read-only) |
| `/api/payment-methods` | `settings:read` / `settings:update` | — | tenant | read: super_admin, branch_manager | cashier cannot list methods the POS needs (functional) |
| `/api/auth/users` | `users:read` / `users:create` + subset guard | — | tenant | super_admin (create); +branch_manager (read) | no update/delete routes → HSEC-07 |
| `/api/auth/roles` mutations | `users:update` + subset guard; system roles immutable | — | tenant | super_admin | downgrade of higher custom roles → HSEC-12 |
| `/api/auth/audit-logs` | `users:read` | — | tenant | super_admin, branch_manager | — |
| `POST /api/invoices` | `invoices:create` + monthly limit | — | tenant (any branch) | super_admin, branch_manager, cashier | client price → HSEC-02; branch → HSEC-26 |
| invoice return / cancel | `invoices:update` (`refund` never checked) | — | tenant | super_admin, branch_manager | HSEC-12 |
| invoice email receipt | `invoices:read` | — | tenant | all except inventory_keeper | arbitrary recipient → HSEC-06 |
| `/api/coupons` CRUD | `invoices:create/update/delete` | — | tenant | create: incl. **cashier** | HSEC-03 |
| `POST /api/customers/:id/credit` | `customers:update` | — | tenant | incl. **cashier** | HSEC-03 |
| `/api/installments` create/approve/pay | `installments:create/approve/update` | quota only | tenant | — | client price → HSEC-02 |
| `POST /api/installments/send-reminders` | `installments:update` | — | **all tenants** | super_admin, branch_manager (and any self-registered owner) | HSEC-05 |
| `/api/suppliers`, `/api/purchase-orders` | resource perms | `suppliers` | tenant | — | effective |
| `/api/expenses` | resource perms (reject = `delete`) | `expenses` | tenant | — | effective (naming only) |
| `/api/services`, `/api/work-orders` | resource perms | `services` | tenant | — | effective |
| `/api/reports/*` (+ Excel) | `reports:read` (`export` never checked) | none (`advanced_reports` unenforced) | tenant; branch only on dashboard | all incl. cashier | HSEC-12, HSEC-13, HSEC-26 |
| `POST /api/billing/checkout` | `billing:create` (granted to no role) | — | tenant | super_admin only | — |
| `GET /api/billing/portal`, `POST /api/billing/cancel`, `POST /api/billing/resume` | `authenticate` only | — | tenant | **all** | HSEC-04 |
| `GET /api/billing/status` | `authenticate` | — | tenant | all | INFO (by design) |
| `POST /api/admin/eta/resubmit/:id` | `eta:manage` (granted to no role) | — | tenant | super_admin only | — |
| `/api/admin/*` (platform) | platform JWT + DB reload; `requireOwner()` on `/admins*` only | — | platform | platform ADMIN/OWNER | `run-migrations` hang → HSEC-16 |

### 5.2 Frontend assumptions that the backend does not mirror (CONFIRMED)
Settings page requires `settings:read` in the UI (`App.tsx:101`) but its APIs only authenticate (HSEC-01); the POS UI never edits prices (`POS.tsx:245,321`) but the API trusts them (HSEC-02); billing actions sit in the owner's settings UI but the API is open to every employee (HSEC-04). The `/purchase-orders` UI route lacks a `FeatureGate`, but the API enforces the `suppliers` feature — no bypass.

---

## 6. Privilege Escalation

| Attempt | Result | Status | Evidence |
|---|---|---|---|
| Modify own role / grant self permissions | requires `users:update`; new permission set must be ⊆ caller's JWT permissions; system roles immutable | blocked | `auth.routes.ts:469-529`; `permissions.ts:7-18` |
| Create a user with `super_admin` or broader perms | blocked for non-super-admins (`permission_escalation`) | blocked | `auth.routes.ts:351-368` |
| Create a role with slug `super_admin` | slug unique → 409; slugs immutable on update | blocked | `auth.routes.ts:419-428,461-467` |
| Delete system role / role in use | 403 / 409 | blocked | `auth.routes.ts:543-551` |
| Change another user's role | no endpoint exists | n/a (see HSEC-07) | route inventory |
| Downgrade a more-privileged custom role | allowed for any `users:update` holder (subset rule only constrains the new set) | CONFIRMED LOW → HSEC-12 | `auth.routes.ts:483-513` |
| Mass assignment via object spread | all write paths parse with zod objects (unknown keys stripped) or map fields explicitly | no instance found | e.g. `index.ts:277-325`; `workOrder.routes.ts:236-252` |
| Prototype pollution through JSON | Fastify's JSON parser rejects `__proto__` by default; permissions validated as `record<string,string[]>` | blocked | Fastify defaults; `auth.routes.ts:395,462` |
| Tenant user → platform admin | requires `scope:'platform'` token + DB admin row | blocked | `platform-admin.middleware.ts:22-54` |
| Platform ADMIN → OWNER operations | `/admins*` require `requireOwner()`; everything else is open to ADMIN by design (schema comment) | by design | `admin.routes.ts:725-849`; `schema.prisma:175-178` |
| **Modify tenant settings / credentials as low-priv user** | **possible** | CONFIRMED → HSEC-01 | §5.1 |
| **Business-authority escalation (pricing, coupons, credit, subscription)** | **possible** | CONFIRMED → HSEC-02/03/04 | §5.1 |
| Bypass feature gates | only for features never enforced anywhere | CONFIRMED LOW → HSEC-13 | §13 |
| Bypass subscription limits | invoice cap not applied to installment/work-order invoices; count-then-create races | CONFIRMED LOW → HSEC-13 | `limit.middleware.ts`; `installment.service.ts:228-251` |

---

## 7. IDOR / BOLA

- **Cross-tenant BOLA: not possible** through any reviewed endpoint (§3.2). Resource IDs are random UUIDs resolved only inside the caller's schema.
- **Per-user ownership:** the product has no per-user data ownership; all tenant data is shared among the tenant's users according to role permissions. No endpoint exposes another *user's* private data beyond what the role model grants (users list requires `users:read`; no password hashes are ever selected — every user relation in responses uses an explicit `select`).
- **Nested resources are scoped to their parent** (verified WHERE conditions): variant ↔ product (`product.service.ts:194-197`), installment payment ↔ contract (`installment.service.ts:444-446`), document ↔ customer (`customer.routes.ts:217-219`), work-order line ↔ work order (`workOrder.routes.ts:365-371`), PO item ↔ PO (`po.routes.ts:255-263`), returned variant ↔ invoice (`invoice.service.ts:597-602`).
- **Branch-level objects:** branch IDs supplied by the client are accepted on invoices, stock adjustments/transfers, expenses, purchase orders and reports for any role; only the dashboard restricts non-super-admins to their branch (`report.routes.ts:27-37`). If branch isolation is a requirement, this is a horizontal authorization gap — **HSEC-26 (POTENTIAL)**.
- **Exports/files:** Excel exports and the document-download endpoint are tenant-scoped; R2 object keys are unguessable (HSEC-29).

---

## 8. Session / JWT Security

| Property | Finding | Status | Evidence |
|---|---|---|---|
| Signing | HMAC with `JWT_ACCESS_SECRET` (env, ≥32 chars); verifier accepts HS256/384/512 only for a string secret; unsigned / `alg:none` tokens rejected; asymmetric confusion not applicable | CONFIRMED effective | `jwt.plugin.ts:7-10`; fast-jwt `crypto.js:166-167`, `verifier.js:146-148,195-196` |
| Expiry | `expiresIn = JWT_ACCESS_EXPIRES_IN` (default 15 m); `exp` validated | CONFIRMED | `jwt.plugin.ts:9` |
| Issuer/audience | none; tenant vs platform tokens differ only by claims and share one secret; both middlewares check the distinguishing claims | CONFIRMED (hardening opportunity) | `auth.middleware.ts:34-44`; `platform-admin.middleware.ts:32-38` |
| Stale claims | role, branch and **permissions are read from the JWT** for every request; changes take effect at the next refresh (≤15 min); `isActive` is never re-checked per request | CONFIRMED | `auth.middleware.ts:47-64` |
| Rotation of the signing secret | single secret, no `kid`; rotating it invalidates access tokens only (refresh tokens are opaque) | INFO | — |
| Revocation | no access-token denylist; logout and password reset revoke refresh sessions only | CONFIRMED | `auth.routes.ts:166-171`; `auth.service.ts:194-210` |
| Refresh entropy & storage | 256-bit random; stored as **plaintext Redis keys** | CONFIRMED | `auth.service.ts:68-75` |
| Rotation atomicity | `GET` (`:102`) … later `DEL`+`SET` (`:111-118`) — not atomic | CONFIRMED → HSEC-10 | `auth.service.ts:101-120`; `auth.routes.ts:103,158` |
| **Concurrent refresh A ∥ B** | both read the same token, both mint access tokens and each writes a *new* refresh token; the second `DEL` is a no-op → **two valid refresh tokens** exist; the browser keeps whichever `Set-Cookie` arrives last, the other stays valid for 7 days (orphan session) | CONFIRMED (code trace) | same |
| Reuse detection | none — a stolen refresh token can be rotated indefinitely; the legitimate user is merely logged out when their copy stops working | CONFIRMED → HSEC-10 | same |
| Replay after logout / after rotation | rejected (key deleted) | CONFIRMED effective | `auth.routes.ts:103-110` |
| Lifetime | 7-day sliding TTL renewed at every rotation → no absolute session limit | CONFIRMED → HSEC-10 | `auth.service.ts:107-119` |
| Session invalidation coverage | password reset ✓; password change ✗; deactivation ✗ (impossible) | CONFIRMED → HSEC-07/10 | — |
| Redis failure | sessions live only in Redis; with `maxRetriesPerRequest:null` commands queue during outages (LIKELY stalls) | LIKELY → HSEC-28 | `config/redis.ts:4-7` |
| Frontend token handling | tenant access token memory-only (`auth.store.ts:54-57`); **admin access token persisted to `localStorage`** (`admin-auth.store.ts:38`); session can be injected from a URL fragment (`main.tsx:15-43`) | CONFIRMED → HSEC-24 / HSEC-11 | — |

---

## 9. CSRF / CORS / Cookies

| Item | Actual configuration | Evidence |
|---|---|---|
| Tenant access token | memory; sent as `Authorization: Bearer` | `api/client.ts:61-67` |
| Tenant refresh token | cookie `refreshToken`: `HttpOnly`, `Secure` (production), `SameSite=Lax`, `Path=/`, **`Domain=.hesbaapp.com`** (shared by every tenant subdomain) | `auth.routes.ts:34-44` |
| Admin refresh token | cookie `platformRefreshToken`: `HttpOnly`, `Secure` (prod), `SameSite=Strict`, `Path=/api/admin`, host-only | `admin.routes.ts:26-42` |
| CORS | credentials allowed for `FRONTEND_URL`, `https://<base>`, **any origin ending in `.<base>`** (http or https); no-`Origin` requests allowed; `null` origin rejected | `index.ts:195-207` |
| CSRF tokens | none | — |

**Can a cross-site attacker trigger an authenticated state change?** No (CONFIRMED by architecture). State-changing API calls authenticate with the bearer header, which a foreign site cannot attach. The only cookie-authenticated endpoints are `POST /api/auth/refresh`, `POST /api/auth/logout` and their admin twins. Cross-site POSTs don't carry `SameSite=Lax/Strict` cookies, and responses aren't readable cross-origin, because the CORS allow-list excludes foreign origins.

**Residual same-site exposure (POTENTIAL → HSEC-23):** every tenant subdomain is *same-site* with every other tenant and with the admin panel. `SameSite` therefore doesn't separate them — including `Strict`, contrary to the comment at `admin.routes.ts:30-35`. CORS also grants credentialed read access to every subdomain origin. Any script execution on any `*.hesbaapp.com` page could therefore obtain fresh access tokens for any tenant user or platform admin who visits it. No such script-execution primitive was confirmed (HSEC-22 is CSP-mitigated), so this stays POTENTIAL.

**Login CSRF:** the `#s=` fragment flow lets a crafted link place a chosen session into the victim's browser. CONFIRMED LOW → HSEC-11.

---

## 10. Sensitive Data Exposure

| Data | Exposure found | Status | Evidence |
|---|---|---|---|
| Password hashes | not returned anywhere (all user relations use `select`; only server-side reset logic includes full user rows) | effective | grep of `include/select` patterns |
| Reset tokens | hashed at rest ✓; **sent to GA** in page paths when GA is built in; **printed to stdout** when Resend is unset | POTENTIAL → HSEC-25 | `App.tsx:57-60`; `analytics.ts:133-139`; `email.ts:318-321` |
| Refresh tokens | httpOnly cookie ✓; plaintext Redis keys | LOW → HSEC-28 | `auth.service.ts:70-75` |
| Access tokens | tenant memory-only ✓; admin `localStorage`; transient URL fragment during login | LOW → HSEC-24/11 | — |
| Paymob card token | stored plaintext in `subscriptions.provider_card_token`; **returned by `GET /api/billing/portal` to every tenant user**; returned to all platform ADMINs in tenant detail | CONFIRMED → HSEC-04 / HSEC-14 | `billing.routes.ts:98-111`; `admin.routes.ts:240-252` |
| ETA credentials | AES-256-GCM at rest, write-only, masked in responses ✓; overwritable by any user (integrity, HSEC-01) | effective (confidentiality) | `index.ts:258-273,344-375` |
| API keys / secrets | env only; not echoed; 5xx messages masked in production | effective | `index.ts:104-144` |
| Customer PII (national ID, phone, address, documents) | available to every `customers:read` holder by design; document records carry permanent public R2 URLs | LOW → HSEC-14/29 | `customer.routes.ts:66-85` |
| Cost prices / margins | product search and barcode lookup return `costPrice` to `products:read` (cashier) | LOW → HSEC-14 | `product.routes.ts:359-367` |
| Platform metrics | the cross-tenant reminder trigger returns platform-wide counts to a tenant user | CONFIRMED → HSEC-05 | `installment-reminders.job.ts:75-81,169` |
| Logs | auth headers/cookies redacted ✓; dev-fallback logs include reset links and reminder PII when Resend is unset | POTENTIAL → HSEC-25 | `index.ts:47-54`; `email.ts:267,320` |

---

## 11. Paymob Security

| Question | Answer | Status | Evidence |
|---|---|---|---|
| Is the webhook authenticated? | HMAC-SHA512 over 20 transaction fields, secret from env, fail-closed, constant-time | CONFIRMED effective | `paymob.webhook.ts:9-61` |
| Can a user mark a payment successful without Paymob? | not without a valid signature | CONFIRMED blocked | same |
| Can a payment be reused / replayed? | duplicate transaction ids hit the unique index → no-op | CONFIRMED blocked | `billing.service.ts:144-181`; `schema.prisma:134` |
| Is the tenant binding signed? | **no** — the tenant comes from `obj.order.merchant_order_id`, which is **not** in the HMAC field list; `obj.token` (card token) is also unsigned | CONFIRMED gap → HSEC-21 (LIKELY exploitability) | `paymob.webhook.ts:26-47`; `billing.routes.ts:39-48`; `billing.service.ts:127-132,171` |
| Is the amount / currency verified? | recorded but never compared with the expected price or currency | CONFIRMED gap (part of HSEC-21) | `billing.service.ts:117-174` |
| Order ownership at checkout | Paymob order created for `request.tenant.id` (server-side) | CONFIRMED effective | `billing.routes.ts:69-83` |
| Access another tenant's payments / card token | portal/status are scoped to `request.tenant.id` | CONFIRMED blocked (cross-tenant) | `billing.routes.ts:97-141` |
| Access *own tenant's* card token as a low-priv user | **yes** | CONFIRMED → HSEC-04 | `billing.routes.ts:93-113` |
| Trigger a refund | no refund capability exists | n/a | — |
| Unauthorized subscription actions | cancel/resume open to any employee | CONFIRMED → HSEC-04 | `billing.routes.ts:144-212` |
| Status transitions | success ⇒ `ACTIVE` from any state; failures escalate by count; refunds/voids ignored | CONFIRMED (business) | `billing.service.ts:117-282` |

---

## 12. Background Jobs

| Job | Tenant context | User-triggerable? | Finding |
|---|---|---|---|
| `trial-expiry` | master only | no | expired trials stay `PAST_DUE` with access → HSEC-08 |
| `renewal`, `dunning` | master only; amounts from `priceAtSubscription` | no | lock release without owner check → duplicate-charge risk on multi-replica deployments (HSEC-27, POTENTIAL) |
| `installment-reminders` | iterates every ACTIVE tenant | **yes**, via `POST /api/installments/send-reminders` (tenant route, `installments:update`) — **bypasses the job lock, runs synchronously in the request, returns cross-tenant counts** | HSEC-05 |
| `eta-submissions` | `schemaName` from `request.tenant` at enqueue | only by the tenant's `super_admin` (`eta:manage`) on its own invoices | none (pipeline non-functional — Phase 1 E-01) |

**HSEC-05 call chain (CONFIRMED):** `POST /api/installments/send-reminders` → `authenticate` (own tenant) → `requirePermission('installments','update')` → `runReminderCycle()` (`installment.routes.ts:216-224`) → `masterDb.tenant.findMany({status: ACTIVE})` (`installment-reminders.job.ts:83-86`) → for every tenant: `getTenantDb` → pending/overdue payments due within 3 days → per payment: audit-log lookup for a reminder in the last 24 h (`:119-131`) → `sendInstallmentReminderEmail` (`:136-144`) → audit insert (`:145-153`) → summary across all tenants returned (`:169`). Cross-tenant effects: emails to other tenants' customers on demand; **duplicate emails when calls overlap** (check-then-act idempotency, no lock on this path); platform-wide counts disclosed; unbounded per-call workload with no rate limit. No other tenant's data is modified except `audit_logs` rows (`reminder_sent`) in their schemas.

---

## 13. Feature / Plan Enforcement

| Entitlement | Frontend gate | Backend gate | Result |
|---|---|---|---|
| `suppliers` (suppliers, purchase orders) | `FeatureGate` on `/suppliers` (not `/purchase-orders`) | `requireFeature('suppliers')` on both modules | enforced |
| `expenses` | `FeatureGate` | `requireFeature('expenses')` | enforced |
| `services` (services, work orders) | `FeatureGate` | `requireFeature('services')` | enforced |
| `installments` | none | monthly quota `maxInstallmentPlansMonthly` | enforced (quota) |
| `advanced_reports`, `multi_currency`, `api_access`, `offline_mode` | none | none | **not enforced anywhere** → HSEC-13 (all reports available on every plan) |
| `maxProducts` | usage banner | `requireUnderLimit('products')` on create (import unreachable — 415) | enforced; racy |
| `maxUsers` (column) vs `features.max_users` | usage banner | `requireUnderLimit('users')` uses the column | enforced (column); values disagree for Professional |
| `maxOrders` (invoices / month) | usage banner | POS route only | **bypassed** by installment-contract and work-order invoices → HSEC-13 |
| `features.max_branches` | — | `requireUnderLimit('branches')` on create | enforced; racy |
| `maxStorage` | displayed | none | **not enforced** → HSEC-13 |
| Subscription status | banner | middleware blocks `SUSPENDED`/`CANCELLED` except `/api/auth/*` and `/api/billing/*` | effective for those states; `PAST_DUE` never blocked → HSEC-08 |

No frontend-only gate protects something the backend leaves open; the gaps above are gaps on **both** sides.

---

## 14. File / Storage Security

| Check | Finding | Status |
|---|---|---|
| Upload authorization | `products:create` (product images) / `customers:update` (documents) | effective |
| Object keys | server-generated `products/<uuid>.<ext>`, `customers/<customerId>/<uuid>.<ext>`; no path traversal; **no tenant prefix**, single bucket | CONFIRMED |
| Cross-tenant object access | keys are random UUIDs, never listable through the API; the download endpoint only presigns keys of the caller's own documents | CONFIRMED blocked via API |
| Public URLs | stored permanently in DB and returned to `customers:read` holders; real privacy depends on bucket settings | UNVERIFIED (bucket) → HSEC-29 |
| Signed URLs | PUT/GET presigned for 300 s; content type pinned in the signature | effective |
| Size limits / content validation | none (no length condition on the presigned PUT; MIME enum only) | CONFIRMED → HSEC-29 (abuse/cost) |
| Delete authorization | no delete capability | n/a |
| Imports | multipart parser not registered → 415 (Phase 1 S-03) | not reachable |
| UI wiring | the web app never calls the upload/document endpoints | CONFIRMED |

---

## 15. Admin Security

| Route / control | Verified behaviour | Status |
|---|---|---|
| `/api/admin/login`, `/refresh`, `/logout` | public by necessity; login 10/min (proxy-keyed, HSEC-18); refresh unthrottled; bcrypt; no MFA | effective, hardening advised |
| Scoped `preHandler authenticatePlatformAdmin` | runs before route preHandlers; unauthenticated → 401 and the chain stops | CONFIRMED effective |
| `/admins` CRUD | `requireOwner()` correctly invoked | CONFIRMED effective |
| `POST /api/admin/run-migrations` | preHandler is the **uncalled factory** `requireOwner`; reproduced locally: the request never completes for OWNER or ADMIN, the handler never runs | CONFIRMED — fails closed → HSEC-16 (INFO) |
| Tenant suspend / plan change / plan CRUD / trial extend / subscription cancel & reactivate / revenue | any platform ADMIN (owner not required) — consistent with the schema's role description | by design |
| Tenant provisioning / deletion | provisioning is public; no deletion capability | — |
| Data visibility | tenant detail returns full subscription rows incl. card tokens; tenant DB access limited to row counts | LOW → HSEC-14 |
| Owner bootstrap | owner account created/rotated from env on every boot, forced active | INFO (operational trust in env) |
| Cookie / storage | `Strict` + path-scoped cookie (same-site caveat, HSEC-23); access token in `localStorage` (HSEC-24) | POTENTIAL |

---

## 16. Confirmed Vulnerabilities

Each block lists the fields required by the brief. "Reproduction" is a **local regression-test specification** (Fastify `inject` against the real route tree with a mocked tenant, Redis and Prisma, and a JWT signed with a *test* secret) — not an exploit.

### HSEC-01 — Tenant configuration, ETA credentials and branches writable by any authenticated user · **HIGH**
| Field | Detail |
|---|---|
| CWE | CWE-862 Missing Authorization |
| Location | `apps/api/src/index.ts:275-337` `PATCH /api/settings`; `:344-375` `PUT /api/settings/eta/credentials`; `:381-409` `POST /api/settings/eta/test`; `:428-449` `POST`/`PATCH /api/branches` (inline handlers) |
| Entry point / privileges | tenant API; **any** authenticated tenant user (seeded `cashier`, `inventory_keeper`, `accountant` hold no `settings` permission) |
| Request / input | zod-allowed keys only: VAT flag/rate, loyalty flag / points-per-unit (no max) / point value (no max), print template (free HTML), timezone, currency, ETA taxpayer/activity/branch/issuer fields; ETA client id/secret/signing key; branch name/address/phone/`isActive` |
| Auth state / checks | `authenticate` (valid token, tenant-bound) — **no `requirePermission`** |
| Tenant resolution | correct (own tenant only) |
| Service / DB | inline → `tenantSetting.update`, `branch.create/update` |
| Failure sequence | low-privilege session → mutation accepted after shape validation → new values drive later sales (loyalty redemption is capped only at 50 % of each sale, `loyalty.ts:24-50`), work-order VAT, ETA submissions/credential use, print previews, branch lists |
| Why the control fails | authorization never attached to these inline routes; the UI's `settings:read` guard (`App.tsx:101`) has no server counterpart, while `settings:update` *is* enforced on payment methods (`pm.routes.ts:18-57`) |
| Impact | integrity of financial, tax and compliance configuration; stored HTML reaches managers' preview popups (HSEC-22); e-invoicing identity/credentials can be replaced or broken |
| Exploitability | high — any insider account, no tooling |
| Affected | every tenant (systemic); all sales/e-invoices of the affected tenant |
| Reproduction | `cashier` token → `PATCH /api/settings {loyaltyPointValue: …}` → expect **403**; current code path updates the row (200) |
| Remediation | `requirePermission('settings','update')` on all mutations (and on the ETA test); `settings:read` on GET if intended; a branches permission; upper bounds on loyalty/VAT values; audit-log every settings change |
| Regression test | role × route matrix asserting 403 for every role lacking `settings:update` on all four routes |

### HSEC-02 — Sale prices are taken from the client · **HIGH**
| Field | Detail |
|---|---|
| CWE | CWE-602 Client-Side Enforcement of Server-Side Security; CWE-840 Business Logic Errors |
| Location | `modules/invoices/invoice.schema.ts:26-33`; `invoice.service.ts:207-244` (`toDecimal(item.unitPrice)` at `:209`); `modules/installments/installment.schema.ts:17-25`; `installment.service.ts:164-197` (`:166`) |
| Entry point / privileges | `POST /api/invoices` (`invoices:create`: cashier, branch_manager, super_admin); `POST /api/installments` (`installments:create`) |
| Request / input | `items[].unitPrice` (any positive number) |
| Auth state / checks | authenticated + tenant-bound; `requirePermission` ✓, monthly limit ✓; **no price validation, no override permission** |
| Tenant resolution | correct |
| Service / DB | `createInvoice` / `createContract` → `invoice_items.unit_price` = client value; totals, tax, loyalty and revenue derived from it; stock decremented |
| Failure sequence | a sales-role request carries a unit price different from `product_variants.sell_price` → server computes and commits a completed invoice at that price |
| Why the control fails | the server never loads or compares the catalog price; the POS UI always sends `variant.sellPrice` (`POS.tsx:245,321`), so the only enforcement is client-side |
| Impact | insider under-pricing / goods leaving stock at arbitrary prices; falsified revenue, margins, tax base |
| Exploitability | high for any sales account (direct API call or modified request) |
| Affected | every tenant |
| Reproduction | `POST /api/invoices` with a unit price below the variant's `sell_price` → expect 400 (or a permission-gated override); currently persisted |
| Remediation | price lines server-side from `sell_price` (+ active product discounts); if manual overrides are a feature, add an explicit permission, reason, ceiling and audit entry |
| Regression test | stored `unit_price` equals catalog price for callers without the override permission; same for installment contracts |

### HSEC-03 — Discount and store-credit authority granted by broad permissions · **MEDIUM**
| Field | Detail |
|---|---|
| CWE | CWE-269 Improper Privilege Management; CWE-285 Improper Authorization |
| Location | `modules/coupons/coupon.routes.ts:50-93` (coupon CRUD gated by `invoices:create/update/delete`); `modules/customers/customer.routes.ts:112-159` (`POST /:id/credit`, `customers:update`); `invoice.schema.ts:17` (client-chosen `feeBearer`) |
| Entry point / privileges | seeded `cashier` holds `invoices:create` and `customers:update` |
| Request / input | coupon with any percentage/fixed value; credit `add` with any amount; `feeBearer` override |
| Auth state / checks | authenticated; permission present but semantically unrelated (sales permission ⇒ coupon management; customer-edit permission ⇒ money adjustment) |
| Tenant resolution | correct |
| Service / DB | `coupon.create`; `customer.update({creditBalance})` (non-atomic read-modify-write of a JS number, `:128-143`); fee bearer stored on invoice |
| Failure sequence | sales-role user creates a discount or adds store credit, then applies it at the POS; or shifts payment fees between merchant and customer |
| Why the control fails | no dedicated permissions for discount creation, credit adjustment or fee-bearer override; no approval or limits |
| Impact | insider-driven revenue loss; credit balances altered without approval (audit entry exists for credit, none for coupons) |
| Exploitability | high for insider accounts |
| Affected | every tenant using default roles |
| Reproduction | `cashier` token → `POST /api/coupons` / `POST /api/customers/:id/credit {type:'add'}` → expect 403 |
| Remediation | dedicated permissions (`coupons:manage`, `customers:credit_adjust`, `invoices:override_fee`) excluded from cashier; atomic increments; limits/approval |
| Regression test | role matrix for coupon and credit routes; concurrency test for credit adjustment |

### HSEC-04 — Subscription cancel/resume and payment data available to any employee · **MEDIUM**
| Field | Detail |
|---|---|
| CWE | CWE-862 Missing Authorization; CWE-200 Exposure of Sensitive Information |
| Location | `modules/billing/billing.routes.ts:93-113` (portal), `:144-176` (cancel), `:180-212` (resume); `billing.service.ts:297-319` |
| Entry point / privileges | any authenticated tenant user |
| Request / input | none (POST bodies empty) |
| Auth state / checks | `authenticate` only; checkout, by contrast, requires `billing:create` |
| Tenant resolution | correct (`request.tenant.id`) |
| Service / DB | master `subscriptions.update` (`cancelAtPeriodEnd=true`, or **immediate `CANCELLED` when the subscription is `TRIALING`**); portal returns the whole row incl. `providerCardToken` and the last 10 payment attempts |
| Failure sequence | employee cancels → for trial tenants every non-auth/non-billing route returns 402 for all users until the owner pays; for paid tenants cancellation is scheduled; any employee also reads the stored card token |
| Why the control fails | billing permissions exist in the role model but are not applied to these routes; the portal selects all columns |
| Impact | tenant-wide availability loss (trial), unwanted cancellations, exposure of a stored payment credential (usable only with the platform's Paymob API key) |
| Exploitability | high for insiders |
| Affected | every tenant |
| Reproduction | `cashier` token → `POST /api/billing/cancel` → expect 403; `GET /api/billing/portal` must not include `providerCardToken` |
| Remediation | `billing:update` on cancel/resume, `billing:read` on portal; explicit `select` without card token; owner email confirmation for cancellation |
| Regression test | role matrix + response-schema test forbidding `providerCardToken` |

### HSEC-05 — Tenant-scoped endpoint runs the reminder job for all tenants · **MEDIUM**
| Field | Detail |
|---|---|
| CWE | CWE-285 Improper Authorization (scope); CWE-770 Allocation of Resources Without Limits |
| Location | `modules/installments/installment.routes.ts:216-224`; `jobs/installment-reminders.job.ts:69-170` |
| Entry point / privileges | `POST /api/installments/send-reminders`; `installments:update` (branch_manager, super_admin) — reachable by **any self-registered tenant owner** |
| Request / input | empty body |
| Auth state / checks | authenticated, permission checked against the caller's own tenant only |
| Tenant resolution | ignored by the job function — iterates `masterDb.tenant.findMany({status: ACTIVE})` |
| Service / DB | per tenant: payment query, audit lookup, email send, audit insert; response = platform-wide summary |
| Failure sequence | caller triggers a full platform reminder run on demand; overlapping calls race the check-then-act idempotency (no lock on this path) |
| Why the control fails | a platform job function is exposed through a tenant route without passing the tenant |
| Impact | emails to other tenants' customers at attacker-chosen times and duplicates under concurrency; disclosure of platform-wide counts; unbounded work per call |
| Exploitability | high (public signup ⇒ owner role) |
| Affected | all ACTIVE tenants and their customers |
| Reproduction | with two mocked tenants, tenant A's call must touch only tenant A's schema and return only A's counts |
| Remediation | pass `request.tenant` to a tenant-scoped variant; enqueue through the locked queue; rate-limit; insert-first idempotency claim |
| Regression test | cross-tenant isolation test for the manual trigger; concurrency test proving one email per payment per window |

### HSEC-06 — Platform email relay with unescaped tenant content · **MEDIUM**
| Field | Detail |
|---|---|
| CWE | CWE-116 Improper Encoding of Output (HTML injection in email); CWE-770 |
| Location | `modules/invoices/invoice.routes.ts:174-250`; `shared/utils/email.ts:172-244` (also `:11-130`, `:261-310`) |
| Entry point / privileges | `POST /api/invoices/:id/email-receipt`; `invoices:read` (most roles; any self-registered tenant) |
| Request / input | `{ to: <any email> }`; tenant-controlled strings rendered into HTML (product, customer and payment-method names) |
| Auth state / checks | authenticated + permission; **no recipient restriction, no rate limit, no escaping** |
| Tenant resolution | correct |
| Service / DB | Resend send from `EMAIL_FROM` (platform domain); audit entry |
| Failure sequence | tenant data containing markup is emailed under the platform's sender identity to arbitrary recipients, repeatedly |
| Why the control fails | recipient is free-form and templates interpolate raw strings |
| Impact | phishing/spam relayed through the platform's sending domain (reputation, deliverability for all tenants); insider exfiltration of invoice data |
| Exploitability | high |
| Affected | platform email reputation; external recipients |
| Reproduction | snapshot test: an invoice whose product name contains markup must render escaped; `to` outside the invoice's customer email must be rejected or permission-gated |
| Remediation | HTML-escape every interpolation in all email templates; restrict recipients; per-tenant send quota |
| Regression test | template escaping unit tests; recipient-policy route test |

### HSEC-07 — Users cannot be deactivated, re-roled or reset by the tenant (offboarding gap) · **MEDIUM**
| Field | Detail |
|---|---|
| CWE | CWE-284 Improper Access Control; CWE-613 Insufficient Session Expiration |
| Location | route inventory of `modules/auth/auth.routes.ts` (no user update/delete); only user writes: `auth.service.ts:53,187`, `auth.routes.ts:596`; system roles immutable `auth.routes.ts:501-503`; sliding refresh `auth.service.ts:107-119` |
| Entry point / privileges | n/a — capability missing for owners |
| Auth state / checks | `isActive` checked only at login/refresh and cannot be set |
| Failure sequence | an employee leaves or is compromised → the owner has no product path to disable the account, change its role, revoke its sessions or reset its password; refresh keeps the session alive indefinitely |
| Why the control fails | lifecycle endpoints were never implemented |
| Impact | persistent unauthorized access by former staff with whatever role they held |
| Exploitability | medium (requires a former/compromised insider) |
| Affected | every tenant |
| Remediation | deactivate/reactivate, role/branch change and admin-initiated reset endpoints (permission-gated, escalation-guarded) that also revoke all of the user's refresh sessions; keep a per-user session index instead of scanning Redis |
| Regression test | deactivated user: refresh → 401 and existing access token rejected within its lifetime (or via a token-version check) |

### HSEC-08 — Expired unpaid trials keep full access indefinitely · **MEDIUM** (business integrity)
| Field | Detail |
|---|---|
| CWE | CWE-840 Business Logic Errors |
| Location | `jobs/trial-expiry.job.ts:115-132`; `jobs/dunning.job.ts:74-81` (requires stored card token); `shared/middleware/tenant.middleware.ts:103` (blocks only `SUSPENDED`/`CANCELLED`) |
| Entry point / privileges | none — passive; any tenant (public signup, any plan incl. Enterprise trial) |
| Failure sequence | trial ends → `PAST_DUE` with `failedAttempts=1` → no card token so dunning never runs → status never escalates → middleware keeps serving the tenant |
| Impact | unpaid perpetual use of paid plans |
| Exploitability | trivial |
| Affected | all tenants that never pay |
| Remediation | grace period then `SUSPENDED` for `PAST_DUE` without a payment method; or enforce `trialEndsAt` in the gate |
| Regression test | time-travel test: trial end + grace ⇒ 402 on business routes |

### HSEC-09 — Account enumeration via login timing · **LOW**
| Field | Detail |
|---|---|
| CWE | CWE-208 Observable Timing Discrepancy |
| Location | `modules/auth/auth.service.ts:48-51` (returns before bcrypt for unknown/inactive users) |
| Privileges / input | unauthenticated; email + password per tenant |
| Impact / exploitability | confirms whether an email exists in a tenant; slowed by rate limits |
| Remediation | always run a bcrypt comparison (dummy hash) before rejecting |
| Regression test | response-time parity test (mocked bcrypt call count) |

### HSEC-10 — Refresh-session weaknesses: non-atomic rotation, no reuse detection, unlimited sliding lifetime, no revocation on password change · **LOW**
| Field | Detail |
|---|---|
| CWE | CWE-613; CWE-362 Race Condition |
| Location | `auth.routes.ts:92-163`; `auth.service.ts:101-124`; `auth.routes.ts:577-599` |
| Failure sequence | concurrent refreshes fork a session; a stolen cookie can be rotated forever without detection; a password change leaves other sessions alive |
| Impact / exploitability | prolongs a cookie theft (requires a prior theft — httpOnly makes that hard) |
| Remediation | atomic consume (`GETDEL`/Lua), token families with reuse detection, absolute lifetime, revoke on password change, store token hashes |
| Regression test | double-spend test: only one of two concurrent refreshes succeeds; reuse of a rotated token revokes the family |

### HSEC-11 — Session fixation / login CSRF through an unverified URL-fragment session · **LOW**
| Field | Detail |
|---|---|
| CWE | CWE-384 Session Fixation; CWE-352 (login CSRF variant) |
| Location | `apps/web/src/main.tsx:15-43` (accepts `#s=` before render); producer `pages/auth/Login.tsx:74-83` |
| Failure sequence | a crafted link opens a tenant subdomain already signed into a session chosen by the link's author; the victim may enter data into the wrong tenant |
| Impact / exploitability | confusion/phishing enabler; requires the victim to follow a link; no access to the victim's own account |
| Remediation | replace with a one-time, server-issued, short-lived code exchanged by POST (or rely on the shared refresh cookie + refresh on arrival); never accept tokens from the URL |
| Regression test | the SPA ignores fragment payloads it did not request (state nonce) |

### HSEC-12 — Permission model inconsistencies · **LOW**
| Field | Detail |
|---|---|
| CWE | CWE-285 Improper Authorization |
| Location | returns/cancel check `invoices:update` not `refund` (`invoice.routes.ts:113,149`); Excel exports use `reports:read` not `export` (`report.routes.ts:40-58,161-182`); reject uses `installments:approve`; role PATCH lets any `users:update` holder **downgrade** more-privileged custom roles (`auth.routes.ts:483-513`) |
| Impact / exploitability | custom roles cannot express intended separations; possible tampering by mid-level managers with custom roles |
| Remediation | align route checks with the permission vocabulary; require the editor to hold every permission of the role being edited |
| Regression test | permission-vocabulary consistency test (every granted action is checked by some route, every checked action exists) |

### HSEC-13 — Plan entitlements not enforced · **LOW** (revenue integrity)
| Field | Detail |
|---|---|
| CWE | CWE-840 |
| Location | `requireFeature` used for 3 features only (§13); `installment.service.ts:228-251` and `workOrder.routes.ts` invoice route skip `requireUnderLimit('invoices')`; `maxStorage` unused; count-then-create races in `limit.middleware.ts` |
| Impact / exploitability | paid-tier features (advanced reports etc.) usable on every plan; invoice caps bypassable |
| Remediation | gate every advertised feature server-side; count all invoice-creating paths; transactional quota checks |
| Regression test | per-plan entitlement matrix |

### HSEC-14 — Sensitive fields exposed to broad roles · **LOW**
| Field | Detail |
|---|---|
| CWE | CWE-200; CWE-359 Exposure of Private Personal Information |
| Location | cost prices in search/barcode (`product.routes.ts:359-367`, `product.service.ts:253-267`); customer documents with permanent public URLs (`customer.routes.ts:66-85`); card tokens in platform tenant detail (`admin.routes.ts:240-252`) |
| Remediation | role-based field selection; presigned URLs only; never return card tokens |
| Regression test | response-schema tests per role |

### HSEC-15 — Password-reset email link targets a non-existent route · **LOW** (availability)
| Field | Detail |
|---|---|
| Location | `shared/utils/email.ts:316` (`/reset`) vs `apps/web/src/App.tsx:73` (`/reset-password`) and catch-all `:114` |
| Impact | account recovery from the email fails; tokens expire unused after 1 h; no security exposure on its own |
| Remediation | align the path; add an end-to-end test of the emailed link |
| Regression test | snapshot of the reset URL builder against the router's route table |

### HSEC-16 — `POST /api/admin/run-migrations` never completes · **INFO** (fails closed)
| Field | Detail |
|---|---|
| Location | `modules/admin/admin.routes.ts:890` (`preHandler: [requireOwner]` — factory not invoked) |
| Evidence | local reproduction on Fastify 4.29.1: no response within 3 s for OWNER and ADMIN; `requireOwner()` behaves as designed |
| Impact | the endpoint is unusable; requests hang until client timeout; the handler (and the migration run) never executes — no authorization bypass |
| Remediation | `preHandler: [requireOwner()]` |
| Regression test | inject test: OWNER → 200, ADMIN → 403 |

### HSEC-17 — Cookie clearing omits the cookie domain · **INFO**
| Field | Detail |
|---|---|
| Location | `auth.routes.ts:105,125,140,169` vs `:42` |
| Impact | the browser may keep a dead cookie; the server-side token is already deleted |
| Remediation | clear with the same `domain`/`path` options used to set it |

---

## 17. Likely Vulnerabilities

| ID | Title | Severity | Code evidence (CONFIRMED) | What is not yet proven | Remediation |
|---|---|---|---|---|---|
| **HSEC-18** | Rate limits and audit IPs keyed to the proxy address | MEDIUM | Fastify created without `trustProxy` (`index.ts:42`); limiter key = `req.ip` (`@fastify/rate-limit/index.js:27`); `req.ip` = socket peer (`fastify/lib/request.js:250-256`); production traffic arrives through Caddy (`docker-compose.prod.yml`, `Caddyfile`) | that production really sits behind a single proxy hop (Caddy vs Railway) | `trustProxy` set to the proxy network/hop count; key auth limits by account + IP |
| | *Impact:* login (10/min), refresh (30/min), forgot (20/min), reset (5/5 min) and admin login (10/min) would become **platform-wide** budgets. Any client could exhaust them; ordinary refresh traffic above ~30/min would produce 429s that the SPA turns into logouts (`api/client.ts:109-120`). Brute-force limits wouldn't be per attacker, and audit/reset IPs would record the proxy. *Exploitability:* unauthenticated, trivial. | | | | |
| **HSEC-19** | Unauthenticated, unthrottled tenant provisioning | MEDIUM | `POST /api/tenants/register` has no rate limit, CAPTCHA or email verification (`tenant.routes.ts:6`); each call creates a schema, applies 17 migrations, seeds data and caches a tenant client of up to 5 connections (`tenant.service.ts:98,192-286`; `config/database.ts:16-17`) | the load at which DB connections/catalog are exhausted (not load-tested by design) | rate limit + verification before provisioning; asynchronous provisioning queue; reserved names; tighter per-tenant pool |
| | *Impact:* platform-wide database exhaustion; subdomain/email squatting; unsolicited lifecycle emails to unverified addresses. *Exploitability:* unauthenticated. | | | | |
| **HSEC-20** | TLS-issuance ask endpoint approves any subdomain | MEDIUM | `/internal/check-tenant` returns 200 for any host ending in `.<base>` with no tenant lookup (`index.ts:186-191`); Caddy issues on-demand certificates on that answer (`Caddyfile:1-5,15-20`) | Caddy/CA behaviour under issuance pressure | answer 200 only for existing ACTIVE tenants (cached lookup); or a wildcard certificate via DNS challenge |
| | *Impact:* certificate-authority rate limits and certificate storage can be consumed, blocking certificates for new tenants. *Exploitability:* unauthenticated, trivial. | | | | |
| **HSEC-21** | Paymob webhook binds the tenant through an unsigned field; amount/currency unchecked | MEDIUM | HMAC field list excludes `merchant_order_id` and `token` (`paymob.webhook.ts:26-47`); the handler derives the tenant from `merchant_order_id` and stores `token` (`billing.routes.ts:39-48`; `billing.service.ts:127-132,171`); amount/currency are never compared (`billing.service.ts:117-174`) | whether a validly signed transaction payload whose id is not yet recorded is obtainable in practice (provider redirect contents, callback timing/delivery) | create a pending record at checkout and resolve the tenant from the **signed** `obj.order.id`; verify amount, currency and integration id; ignore unsigned fields |
| | *Impact:* another tenant's subscription state could be altered (activation, or failure escalation towards `SUSPENDED`/`CANCELLED`), and an unsigned card token could be stored. *Exploitability:* low–medium (conditions external to the code). | | | | |

---

## 18. Potential Issues

| ID | Title | Severity (current) | Condition that would make it real | Evidence |
|---|---|---|---|---|
| **HSEC-22** | Stored HTML injection in print popups | LOW (would be HIGH without CSP) | CSP not served/inherited, or rolled back via the documented switch (`index.ts:78-80`). Sinks: print-template preview (template writable by any user via HSEC-01), installment contract print (customer name/phone), day-close prints (payment-method names). With CSP (`script-src 'self'`, `script-src-attr 'none'`, inherited by `about:blank` popups) script execution is LIKELY blocked; markup such as redirects remains possible | `Settings.tsx:2570-2583`; `Installments.tsx:519-565`; `DayClose.tsx:78-116`; `POS.tsx:978-983`; `index.ts:81-95` |
| **HSEC-23** | Subdomain trust model amplifies any XSS | LOW | any script execution on any `*.hesbaapp.com` origin | refresh cookie on parent domain (`auth.routes.ts:42`); CORS for all subdomains with credentials (`index.ts:196-204`); `Strict` admin cookie still same-site (`admin.routes.ts:26-42`) |
| **HSEC-24** | Admin access token persisted in `localStorage` | LOW | any script execution on the admin origin | `admin-auth.store.ts:38` |
| **HSEC-25** | Reset tokens reach analytics or logs | LOW–MEDIUM | GA compiled into the build (`VITE_GA_MEASUREMENT_ID`) → `page_view` carries `?token=`; or `RESEND_API_KEY` unset → links printed to stdout | `App.tsx:57-60`; `analytics.ts:133-139`; `email.ts:318-321` |
| **HSEC-26** | No branch-level authorization | LOW–MEDIUM | if branch isolation is a product requirement (the dashboard already restricts by branch) | `invoice.routes.ts:41-42`; `report.routes.ts:27-37`; stock/expense/PO handlers |
| **HSEC-27** | Duplicate renewal/dunning charges | LOW | multiple replicas and a cycle longer than its 25-min lock (lock released without owner check) | `shared/utils/lock.ts:11-24`; `renewal.job.ts`, `dunning.job.ts` |
| **HSEC-28** | Plaintext session tokens in Redis; Redis outage stalls requests | LOW | Redis compromise / outage | `auth.service.ts:70-75`; `config/redis.ts:4-7` |
| **HSEC-29** | R2 objects: permanent public URLs, no size limits, privacy depends on bucket settings | LOW | public bucket; upload abuse | `config/r2.ts:17-33`; `customer.routes.ts:183-197` |

---

## 19. Unverified Items

| ID | Item | Evidence missing | Affects |
|---|---|---|---|
| U-01 | Production proxy topology (Caddy on VPS vs Railway) and the effective `request.ip` | runtime request inspection | HSEC-18 |
| U-02 | Whether production web builds include `VITE_GA_MEASUREMENT_ID` | build environment | HSEC-25 |
| U-03 | Whether `RESEND_API_KEY` is set in production | production env | HSEC-25, email flows |
| U-04 | R2 bucket privacy and CORS | R2 dashboard | HSEC-29, HSEC-14 |
| U-05 | Paymob redirect parameters, TOKEN-callback behaviour, callback reliability | provider sandbox capture | HSEC-21; card-token presence for renewals |
| U-06 | CSP header served and inherited by popups in target browsers | browser test against staging | HSEC-22 |
| U-07 | Wildcard DNS for tenant subdomains | DNS lookup | HSEC-11, HSEC-20 context |
| U-08 | Caddy/ACME limits on on-demand issuance | Caddy config/version, CA account | HSEC-20 |
| U-09 | `max_connections` and Prisma pool behaviour with many cached tenant clients | DB config, load test | HSEC-19 |
| U-10 | Replica count | deployment | HSEC-27 |
| U-11 | Redis persistence, auth and network exposure in production | host config | HSEC-28 |
| U-12 | Browser handling of `clearCookie` without `domain` | browser test | HSEC-17 |

No live or production testing was performed by design.

---

## 20. Attack Paths

Conceptual chains that link findings, for prioritisation. They name the preconditions, the control gaps involved, the outcome, and where the chain breaks once fixed.

| ID | Precondition | Chain of control gaps | Outcome | Breaks at |
|---|---|---|---|---|
| AP-1 Insider margin erosion | a sales-role account | client-trusted prices (HSEC-02) · self-service discounts/credit (HSEC-03) · loyalty value changes (HSEC-01) | goods sold below value; falsified revenue and margins; partial audit trail (settings and coupons unaudited) | server-side pricing; dedicated permissions; settings authorization |
| AP-2 Insider sabotage | any employee account | subscription cancel (HSEC-04) · ETA credential/issuer overwrite and branch deactivation (HSEC-01) | trial tenants locked out; e-invoicing misconfigured | billing and settings permissions |
| AP-3 Persistent former employee | departed staff with credentials or a live session | no deactivation path (HSEC-07) · sliding sessions without revocation (HSEC-10) | continued access with the old role | user lifecycle endpoints + session revocation |
| AP-4 Outsider abusing platform resources | none (public signup) | free tenant creation (HSEC-19) → owner role → all-tenant reminder runs (HSEC-05) · email relay (HSEC-06) · certificate issuance (HSEC-20) | platform email reputation, customer annoyance across tenants, resource exhaustion | verification + rate limits; tenant-scoped job trigger; recipient policy; restrictive TLS ask |
| AP-5 Platform-wide auth lockout | none; single-proxy deployment (LIKELY) | proxy-keyed limits (HSEC-18) | users and admins unable to log in or refresh | `trustProxy` + per-account limits |
| AP-6 Billing evasion | any tenant | trial never escalates (HSEC-08) · entitlements not enforced (HSEC-13) | unpaid indefinite use incl. paid-tier features | dunning/grace enforcement; entitlement gates |
| AP-7 *Conditional* cross-tenant session exposure | script execution on any tenant subdomain (none confirmed; CSP in place) | HTML sinks (HSEC-22) → same-site cookie + permissive CORS (HSEC-23) → stored admin token (HSEC-24) | sessions of other tenants' users or admins | keep CSP; escape sinks; host-only cookies; exact-origin CORS; memory-only admin token |
| AP-8 *Conditional* subscription tampering | a signed but unrecorded transaction payload (provider/timing dependent) | unsigned tenant binding (HSEC-21) | another tenant's subscription state changed | bind via signed order id + amount checks |

---

## 21. Security Control Matrix

| Control | Where | Status | Evidence |
|---|---|---|---|
| Tenant resolution | `tenantMiddleware` | Effective | §3 |
| Token ↔ tenant binding | `authenticate` | Effective (unit-tested) | `auth.middleware.ts:34-44` |
| JWT verification | `@fastify/jwt` / fast-jwt | Effective | §8 |
| Tenant vs platform token separation | both middlewares | Effective | §3.2 |
| RBAC on resource modules | `requirePermission` | Effective | §5.1 |
| RBAC on configuration/billing routes | inline/billing routes | **Missing** | HSEC-01, HSEC-04 |
| Business-authority controls (price, discounts, credit) | invoices, coupons, customers | **Missing** | HSEC-02, HSEC-03 |
| Privilege-escalation guard | role/user creation | Effective (downgrade gap) | §6; HSEC-12 |
| User lifecycle (deactivate, re-role, revoke) | — | **Missing** | HSEC-07 |
| Feature gates | 3 modules | Partial | HSEC-13 |
| Quota gates | `requireUnderLimit` | Partial (bypass paths, races) | HSEC-13 |
| Subscription gate | middleware | Partial (`PAST_DUE` never blocked) | HSEC-08 |
| Password storage & policy | bcrypt 12, 12-char rule | Effective | §4 |
| Reset tokens | auth service | Effective (delivery broken; env-dependent leaks) | HSEC-15, HSEC-25 |
| Session rotation & revocation | refresh flow | Partial | HSEC-10 |
| Rate limiting | `@fastify/rate-limit` | Partial (keying, unthrottled signup/webhook/email) | HSEC-18, HSEC-19, HSEC-06 |
| CORS | `apiContext` | Partial (all subdomains trusted) | HSEC-23 |
| Cookies | auth/admin routes | Effective flags; parent-domain scope | §9 |
| CSP & security headers | helmet | Effective (only barrier for HSEC-22) | `index.ts:81-95` |
| Output encoding | print helpers, emails | Partial | HSEC-06, HSEC-22 |
| Webhook authentication | HMAC | Effective for signed fields; **binding gap** | HSEC-21 |
| Webhook idempotency | unique transaction id | Effective | §11 |
| Secret encryption at rest | AES-256-GCM (ETA) | Effective; card token plaintext | HSEC-04 |
| Sensitive-field minimisation | responses | Partial | HSEC-04, HSEC-14 |
| Job tenant scoping | jobs | Partial (manual trigger) | HSEC-05 |
| Admin authorization | platform middleware | Effective (one wiring defect, fails closed) | HSEC-16 |
| Storage authorization | API | Effective via API; bucket UNVERIFIED | HSEC-29 |
| Audit logging | `audit_logs` / `platform_audit_logs` | Partial (settings, coupons, branches unaudited) | HSEC-01, HSEC-03 |

---

## 22. Remediation Priority

| Priority | Items | Rationale |
|---|---|---|
| **P0 — next release** | HSEC-01 (settings/ETA/branches authorization) · HSEC-02 (server-side pricing) · HSEC-05 (scope the reminder trigger) · HSEC-04 (billing permissions + drop card token from responses) · HSEC-06 (escape email templates, restrict recipients) | high exploitability by insiders or any self-registered user; small, local code changes |
| **P1 — next sprint** | HSEC-07 (user lifecycle + session revocation) · HSEC-08 (trial/`PAST_DUE` enforcement) · HSEC-03 (dedicated financial permissions) · HSEC-18 (`trustProxy` + per-account limits) · HSEC-19 (signup throttling/verification) · HSEC-20 (restrictive TLS ask) · HSEC-21 (signed order binding + amount checks) | broader design changes or deployment confirmation needed |
| **P2 — hardening** | HSEC-09, HSEC-10, HSEC-11, HSEC-12, HSEC-13, HSEC-14, HSEC-15, HSEC-16, HSEC-17, HSEC-22 – HSEC-29 | defence in depth, availability, consistency |

---

## 23. Required Regression Tests

All are local tests (Fastify `inject` + mocked tenant/Redis/Prisma, test secrets) and need no production access.

| ID | Test | Asserts |
|---|---|---|
| RT-01 | Role × route authorization matrix (generated from the route table) | every mutation returns 403 for roles lacking its permission; covers settings, ETA, branches, billing, coupons, credit, reminders |
| RT-02 | Cross-tenant token binding over the full stack | tenant-A token against tenant-B host/header → 403 on every authenticated route |
| RT-03 | Tenant identifiers never read from input | fuzz `tenantId`/`schemaName` in body/query/params → no effect on schema selection |
| RT-04 | Server-side pricing | stored `unit_price` equals catalog price without an override permission (POS + installments) |
| RT-05 | Reminder trigger isolation | manual trigger touches only the caller's schema and returns only its counts; concurrent calls send at most one email per payment |
| RT-06 | Billing response minimisation | portal/admin responses never contain `providerCardToken` |
| RT-07 | Email template escaping & recipient policy | markup in tenant strings is escaped; foreign recipients rejected or permission-gated |
| RT-08 | User lifecycle | deactivated user cannot refresh; sessions revoked on deactivation and password change |
| RT-09 | Refresh double-spend | two concurrent refreshes with one token → exactly one succeeds; reuse revokes the family |
| RT-10 | Trial expiry enforcement | trial end + grace ⇒ 402 on business routes |
| RT-11 | Webhook binding | tenant resolved from the signed order id; unsigned `merchant_order_id`/`token` changes have no effect; wrong amount/currency rejected |
| RT-12 | Webhook replay | duplicate transaction id → no state change |
| RT-13 | Admin owner gate | `run-migrations`: OWNER 200, ADMIN 403, completes within timeout |
| RT-14 | Rate-limit keying | distinct client IPs (via trusted proxy header) get independent buckets |
| RT-15 | Plan entitlements | per-plan matrix for every advertised feature and every invoice-creating path |
| RT-16 | Reset link | emailed URL matches a router route and reaches the reset API |
| RT-17 | Analytics redaction | page-view payloads contain no query strings/tokens |
| RT-18 | Print sinks | all `document.write` paths escape tenant strings |
| RT-19 | Escalation guard | users cannot edit roles holding permissions they lack (incl. downgrades) |
| RT-20 | TLS ask | 200 only for ACTIVE tenant subdomains |

---

## 24. Evidence Ledger

| ID | Claim | Primary evidence | Status | Phase 1 ref |
|---|---|---|---|---|
| C-01 | JWT↔tenant binding enforced on all authenticated tenant routes | `auth.middleware.ts:34-44`; route inventory | CONFIRMED (control) | M-02 |
| C-02 | HS-only JWT verification; signature required | fast-jwt `verifier.js:146-148,195-196`; `crypto.js:166-167` | CONFIRMED (control) | AU-01 |
| C-03 | No client-supplied tenant identifiers | grep | CONFIRMED (control) | — |
| C-04 | Escalation guard (subset rule, immutable system roles) | `auth.routes.ts:351-368,410-417,481-503`; `permissions.ts` | CONFIRMED (control) | AU-09 |
| C-05 | No mass assignment found | zod allow-lists / explicit mapping | CONFIRMED (control) | — |
| C-06 | Reset token design sound | `auth.service.ts:128-211` | CONFIRMED (control) | AU-05/06 |
| C-07 | Webhook HMAC fail-closed + idempotent | `paymob.webhook.ts:9-61`; `billing.service.ts:144-181` | CONFIRMED (control) | B-03 |
| C-08 | No password hashes in responses | include/select grep | CONFIRMED (control) | — |
| C-09 | Literal routing (no gate bypass via paths) | find-my-way 8.2.2 source | CONFIRMED (control) | — |
| C-10 | CSP + no-referrer + frame-ancestors | `index.ts:81-95`; helmet 7.2.0 defaults | CONFIRMED (control) | A-05 |
| HSEC-01 | settings/ETA/branches lack authorization | `index.ts:275-449` | CONFIRMED · HIGH | A-04 |
| HSEC-02 | client-supplied sale prices | `invoice.service.ts:209`; `installment.service.ts:166`; `POS.tsx:245,321` | CONFIRMED · HIGH | F-01 |
| HSEC-03 | coupons/credit/fee bearer under broad permissions | `coupon.routes.ts:50-93`; `customer.routes.ts:112-159`; `invoice.schema.ts:17` | CONFIRMED · MEDIUM | CU-01 |
| HSEC-04 | billing cancel/resume/portal open; card token returned | `billing.routes.ts:93-212` | CONFIRMED · MEDIUM | B-06 |
| HSEC-05 | tenant route runs all-tenant reminder job | `installment.routes.ts:216-224`; `installment-reminders.job.ts:69-170` | CONFIRMED · MEDIUM | J-08 |
| HSEC-06 | email relay with unescaped HTML | `invoice.routes.ts:174-250`; `email.ts:172-244` | CONFIRMED · MEDIUM | AU-10, F-06 |
| HSEC-07 | no user lifecycle management | route inventory; user write grep | CONFIRMED · MEDIUM | W-07 |
| HSEC-08 | expired trials keep access | `trial-expiry.job.ts:115-132`; `dunning.job.ts:74-81`; `tenant.middleware.ts:103` | CONFIRMED · MEDIUM | J-06 |
| HSEC-09 | login timing enumeration | `auth.service.ts:48-51` | CONFIRMED · LOW | — |
| HSEC-10 | refresh rotation/reuse/lifetime weaknesses | `auth.service.ts:101-124`; `auth.routes.ts:92-163,577-599` | CONFIRMED · LOW | AU-02, AU-07 |
| HSEC-11 | URL-fragment session fixation | `main.tsx:15-43` | CONFIRMED · LOW | W-03 |
| HSEC-12 | permission vocabulary inconsistencies; role downgrade | `invoice.routes.ts:113,149`; `report.routes.ts`; `auth.routes.ts:483-513` | CONFIRMED · LOW | Z-02 |
| HSEC-13 | entitlements unenforced / bypassable | §13 | CONFIRMED · LOW | Z-03 |
| HSEC-14 | sensitive fields to broad roles | `product.routes.ts:359-367`; `customer.routes.ts:66-85`; `admin.routes.ts:240-252` | CONFIRMED · LOW | S-05, P-03 |
| HSEC-15 | reset email path mismatch | `email.ts:316`; `App.tsx:73,114` | CONFIRMED · LOW (availability) | AU-11 |
| HSEC-16 | run-migrations hang | `admin.routes.ts:890`; local reproduction | CONFIRMED · INFO | P-02 |
| HSEC-17 | clearCookie without domain | `auth.routes.ts:42,105,125,140,169` | CONFIRMED · INFO | AU-03 |
| HSEC-18 | proxy-keyed rate limits | `index.ts:42`; rate-limit `index.js:27`; fastify `request.js:250-256` | LIKELY · MEDIUM | — |
| HSEC-19 | unthrottled provisioning | `tenant.routes.ts:6`; `tenant.service.ts:192-286` | LIKELY · MEDIUM | T-01 |
| HSEC-20 | TLS ask approves any subdomain | `index.ts:186-191`; `Caddyfile` | LIKELY · MEDIUM | A-02 |
| HSEC-21 | unsigned webhook tenant binding | `paymob.webhook.ts:26-47`; `billing.service.ts:127-132` | LIKELY · MEDIUM | B-04 |
| HSEC-22 – HSEC-29 | potential issues (§18) | as listed | POTENTIAL | W-04, W-06, S-02 |

---

### Top 10 security risks

Ranked by **Risk = Impact × Exploitability × Scope** (each 1–3). Ties are broken by confidence (CONFIRMED before LIKELY), then impact.

| Rank | ID | Risk | Score (I×E×S) | Status · Severity |
|---|---|---|---|---|
| 1 | HSEC-01 | Any employee can rewrite financial/tax settings, ETA credentials and branches | 3×3×2 = 18 | CONFIRMED · HIGH |
| 2 | HSEC-02 | Server trusts client-supplied sale prices | 3×3×2 = 18 | CONFIRMED · HIGH |
| 3 | HSEC-05 | Tenant user triggers the reminder job across all tenants | 2×3×3 = 18 | CONFIRMED · MEDIUM |
| 4 | HSEC-06 | Platform email relay with unescaped tenant HTML | 2×3×3 = 18 | CONFIRMED · MEDIUM |
| 5 | HSEC-08 | Expired unpaid trials keep full access | 2×3×3 = 18 | CONFIRMED · MEDIUM |
| 6 | HSEC-18 | Proxy-keyed rate limits → platform-wide lockout | 2×3×3 = 18 | LIKELY · MEDIUM |
| 7 | HSEC-19 | Unthrottled tenant provisioning → resource exhaustion | 2×3×3 = 18 | LIKELY · MEDIUM |
| 8 | HSEC-07 | Users cannot be deactivated or have sessions revoked | 3×2×2 = 12 | CONFIRMED · MEDIUM |
| 9 | HSEC-04 | Any employee can cancel the subscription and read the card token | 2×3×2 = 12 | CONFIRMED · MEDIUM |
| 10 | HSEC-03 | Discounts and store credit available to sales roles | 2×3×2 = 12 | CONFIRMED · MEDIUM |

Next in line: HSEC-20 (TLS ask, 12, LIKELY), HSEC-21 (webhook binding, 6, LIKELY), HSEC-22 (print-sink HTML injection — 6 with CSP, would rise sharply without it).

*End of Phase 2. No code was changed; all reproductions above are specifications for local regression tests.*
