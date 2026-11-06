# Hesba Phase 6 — External Integrations & Third-Party Failure Audit

| | |
|---|---|
| Date | 2026-10-08 |
| Code under review | branch `claude/ui-pos-merge-split` @ `8846bce`. No commits since Phases 1–5; the two modified UI files (`POS.tsx`, `AppShell.tsx`) are unrelated to integrations and were left untouched |
| Inputs | Phase 1, 2, 3, 4, 4.5 and 5 reports; the repository; installed packages (`resend` 3.5.0, `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` 3.1045.0, `bullmq` 5.76.6, Node `fetch`/undici); official provider documentation (read-only web lookups, cited in §29) |
| Method | (1) inventory by repository-wide search; (2) entry-to-provider tracing of every call site; (3) installed-SDK source reading; (4) **runtime experiments with the real application modules** against loopback mocks of Paymob, ETA and Resend and throwaway PostgreSQL / Redis containers; (5) the existing unit suite |

**Evidence labels used throughout:**
- **[RT]** local runtime evidence from this phase.
- **[RT5]** runtime evidence inherited from Phase 5 (same code, no commits since).
- **[SC]** static code evidence.
- **[DOC]** official provider documentation.
- **[ASM]** deployment or provider assumption that was not verified.

**Finding IDs.** New Phase 6 findings are **INT-01 … INT-09**, likely items **L6-xx**, potential items **P6-Pxx**, and unverified items **U6-xx**. Earlier IDs are reused whenever Phase 6 re-confirms or refines them; corrections are listed explicitly in §25.

---

## 1. Executive Summary

**The question:** can a third-party integration failure produce duplicate charges, incorrect financial records, missing invoices, invalid tax submissions, silent email loss, data exposure or inconsistent tenant state?

**Yes, for every integration except R2.** R2 only fails to apply its intended restrictions, and nothing calls it today.

| Integration | Verdict | Key evidence |
|---|---|---|
| **Paymob (token charges)** | **Duplicate charges on every ambiguous outcome.** The client has one `catch` for "never reached Paymob", "rejected", "charged but the response was lost/garbled" and "timed out"; all four become "transient, retry the cycle", and the retry charges again | [RT] a connection reset, a 504, an HTML 200 and a 200 without `order` after a successful charge each produced **2 charges and 1 `payment_attempts` row** (§7 B, B2, J1, J2). Confirms and refines **BG-01** |
| **Paymob (records)** | **Payment rows record what Hesba asked for, not what Paymob reported.** The job path writes its own expected amount and `EGP`; the webhook path hard-codes `EGP` | [RT] Paymob answered 100 USD → row `300 EGP`; a signed webhook for 100 USD → row `1 EGP`, subscription `ACTIVE` (§7 I1, I2) → **INT-05**, FIN-17 |
| **Paymob (webhook binding)** | **A validly signed transaction can be re-addressed to another tenant.** The HMAC (official field list) excludes `merchant_order_id` and the card token | [RT] the same HMAC with a different `merchant_order_id` and `token` → tenant B `ACTIVE` with an attacker-chosen card token; three re-addressed declines → tenant C `PAST_DUE` (§13 W5, W6). The mechanism is confirmed. The precondition is LIKELY: winning the race against Paymob's own callback with a signed field set the payer receives in the browser redirect [DOC] → **HSEC-21** stays P1 |
| **Paymob (lifecycle)** | **An `ACTIVE` subscription without a card token is never renewed, expired, escalated or blocked** | [RT] a paid trial whose callback carried no `obj.token`, and an admin-reactivated sub: both stayed `ACTIVE` past their period end through all three billing jobs, with 0 gateway calls → **INT-04** |
| **ETA** | **Non-functional at the entry point, and incorrect if it were not:**<br>(1) every ETA SQL statement compares a UUID column with an uncast text parameter (`42883`), so even the resubmit route fails before enqueuing — a new blocker, independent of DB-23;<br>(2) behind a harness-only shim, the submitted document does not represent the sale;<br>(3) outcomes are misclassified | [RT] (1) `operator does not exist: uuid = text` ×4 statements (**INT-01**). (2) Document total **228** vs invoice **252.2**: line discount ignored, service line dropped, unsigned, no branch code (**INT-02**). (3) A duplicate or lost response ends `failed` while ETA holds the document; a malformed 200 is stuck in `submitted`; `submissionUUID` is never stored; a cancelled invoice was accepted (**INT-03**, BG-08) |
| **Resend** | **Every failure is silent.** `resend@3.5.0` resolves `{data:null, error}` for 500, 429, 422, connection reset and malformed 200, and never throws. All four app helpers resolve `undefined`; the `idempotencyKey` option is silently dropped by this version | [RT] §9 matrix. Confirms and refines **BG-05**; HSEC-06 (unescaped markup in 3 templates) re-confirmed |
| **R2** | **Presign-only; the server never calls R2.** The presigned PUT signs **only `host`**: the content type is *not* pinned, which corrects Phase 2 §14. There is no size bound. The SDK embeds the CRC32 of an *empty* body (`AAAAAA==`), which Cloudflare documents as incompatible. Public product images and private ID scans share one bucket. No UI calls these endpoints | [RT] local presign (§10) → **INT-06** |
| Other (GA4, Sentry, Google Fonts, Caddy ask) | GA4 receives `pathname + search`, so reset tokens (HSEC-25) and, LIKELY, Paymob redirect parameters reach Google when GA is enabled. Sentry is inactive (package absent) | §11 |

**Distinguishing payment outcomes (§5).** Hesba cannot tell apart "request never reached Paymob", "Paymob rejected the request", "payment definitely failed", "payment definitely succeeded but the response was lost" and "outcome unknown":
- **Never reached, rejected and outcome unknown** all collapse into the same `catch` → `transientFailures++` → whole-cycle retry → **new order id → new charge**.
- **A definite decline** is handled correctly.
- **A `pending` charge is treated as a decline** (FIN-L3).
- **No Paymob inquiry API is used anywhere.**

**Positive results:**
- The webhook HMAC matches Paymob's official 20-field list, uses constant-time comparison and fails closed.
- Duplicate deliveries are idempotent: [RT] D, E.
- No integration is called inside a DB transaction.
- ETA credentials are AES-256-GCM at rest and never returned.
- No secret values are committed: `.env` is ignored, and `.env.example` holds empty placeholders.
- The 61 existing unit tests pass.

**Severity of new IDs:**

| Severity | Count | IDs |
|---|---|---|
| P1 | 0 | none (the P1 integration defects are existing IDs re-confirmed: BG-01, BG-03, HSEC-21, FIN-17) |
| P2 | 5 | INT-01, INT-02, INT-03, INT-04, INT-05 |
| P3 | 4 | INT-06, INT-07, INT-08, INT-09 |

**ETA scoping.** INT-01/02/03 are **release blockers for enabling ETA**. They are not production incidents today, because nothing enqueues ETA jobs automatically (E-02) and the entry route itself fails (INT-01).

**INT-04 could rise to P1.** It becomes P1 if Paymob's transaction callback does not carry `obj.token` (U6-01): no paying customer would ever be renewed or expired.

**Release blockers among integrations:**
1. The per-period payment intent with explicit outcome classification (BG-01, INT-05, L5-01).
2. Binding the webhook to the signed order id and verifying the amount (HSEC-21, FIN-17).
3. A subscription expiry path that does not depend on a card token (INT-04, FIN-16).
4. Checking Resend results (BG-05). This is cheap.

Everything ETA-related blocks **enabling ETA**, not the release.

---

## 2. Scope and Safety

| Item | Detail |
|---|---|
| In scope | Paymob (checkout, token charges, webhook, redirect, reconciliation), ETA (credentials, test, resubmit, worker, payload, signer, QR), Resend (all four senders and their callers), R2/S3 (presign, document routes), GA4, Sentry, Google Fonts, Caddy on-demand TLS ask, HTTP client behaviour, secrets/config, logging |
| Out of scope | business logic that does not affect an integration (already covered by Phases 3–4), frontend rendering |
| Infrastructure | throwaway Docker containers `hesba-p6-pg` (postgres:16-alpine, 127.0.0.1:55434) and `hesba-p6-redis` (redis:7-alpine, 127.0.0.1:56380, no persistence); master schema via `prisma migrate deploy`; tenant schema via the real `runTenantMigrations` |
| Mocks | loopback HTTP servers: Paymob :58080 (orders, payment keys, token pay; modes success / decline / pending / reset / 504 / HTML-200 / missing-fields / amount-currency mismatch / slow / hang), ETA :58081 (token, submissions; modes accept / reject / 422 duplicate with the documented 10-minute payload-hash rule / 400 / 401 / reset / malformed), Resend :58082 reached **through the real SDK** via its `RESEND_BASE_URL` hook (modes ok / 500 / 429 / 422 / reset / HTML-200 / slow) |
| Network guard | `globalThis.fetch` wrapped: any host other than `127.0.0.1`/`localhost` throws. Every script printed the hosts contacted; the only ones were the loopback mocks |
| Secrets | every key of the repository `.env` was overridden with a throwaway value (`dotenv` never overwrites set variables); production credentials never loaded; `.env` key **names** inspected only |
| Throwaway-only schema patch | to look past DB-23, five missing columns were added to the **throwaway** tenant schema only (§8.2). To look past INT-01, a **harness-only** wrapper added `::uuid` casts to the throwaway tenant client's raw SQL. Both are labelled wherever used and are **not** recommendations |
| Not done | no production access; no real payment, email, tax submission, bucket access, DNS or provider configuration; no dependency install or upgrade; no commit or push |

---

## 3. Integration Inventory

| Integration | Package / version | Entry points | Calling functions | Auth | Request format | Response format | Timeout | Retry | Idempotency | DB effects | Error handling | Logging | Tenant scope | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Paymob: checkout** | plain `fetch` (undici) | `POST /api/billing/checkout` (`billing.routes.ts:64-87`, `billing:create`) | `startCheckout` (`billing.service.ts:92-115`) → `startCheckoutSession` (`paymob.client.ts:96-116`) → `/auth/tokens`, `/ecommerce/orders`, `/acceptance/payment_keys` | API key in the JSON body → auth token | JSON | JSON (`paymobFetch` throws on `!res.ok`, `paymob.client.ts:25-37`) | **none** (undici: 10 s connect, ≈ 300 s headers [RT5 X9]) | none | none (new `merchant_order_id = sub_<tenant>_<Date.now()>` per call) | none until the webhook | thrown → 500 | none | tenant from `request.tenant.id` (server) | [SC][RT] P0 |
| **Paymob: token charge** | same | renewal 07:00, dunning 08:00 (BullMQ) | `runRenewalCycle` (`renewal.job.ts:62-175`), `runDunningCycle` (`dunning.job.ts:61-165`) → `createOrder` → `chargeWithToken` (`paymob.client.ts:118-135`) → `/acceptance/payments/pay` | as above; **integration = `PAYMOB_INTEGRATION_ID_CARD`** (the checkout integration); **no `notification_url`** | JSON | JSON (`success`, `pending`, `id`, `order.id`, …) | none | whole cycle 3× (60 s, 120 s) | **none** | `payment_attempts` + `subscriptions` via `handleWebhookSuccess/Failure` **after** the charge | catch → `transientFailures++` → throw at the end of the cycle | `console.error(sub.id, err)` incl. the response text | sub row's `tenant_id` | [SC][RT] |
| **Paymob: webhook** | Fastify route | `POST /api/billing/paymob/webhook?hmac=` (public, `billing.routes.ts:28-60`) | `verifyPaymobWebhook` (`paymob.webhook.ts:9-61`) → `handleWebhookSuccess` (`billing.service.ts:117-198`) / `handleWebhookFailure` (`:200-282`) | HMAC-SHA512 over 20 transaction fields | JSON `{type, obj}` | 200 / 400 / 401 / 500 | n/a | provider re-delivery (policy U6-03) | `UNIQUE(provider_transaction_id)` + P2002 no-op | attempt row + subscription UPDATE (array tx), cache DEL, email | HMAC fail → 401 (logged without payload); handler error → 500 | warn on HMAC failure; Prisma prints expected P2002 as `prisma:error` | **parsed from the unsigned `merchant_order_id`** | [SC][RT][DOC] |
| **Paymob: redirect** | browser | `redirect_url = FRONTEND_URL/settings?tab=billing` (`billing.service.ts:82-90`) | — | Paymob appends the Response-callback query (+ `hmac`) [DOC] | — | — | — | — | — | none (not processed server-side) | — | **GA4 page_view includes the query** (§11) | — | [SC][DOC] |
| **Paymob: reconciliation** | — | `reconcilePayments` (`dunning.job.ts:167-173`) | **no caller**; placeholder | — | — | — | — | — | — | none | — | one `info` line | — | [SC] |
| **ETA: credentials** | — | `PUT /api/settings/eta/credentials` (`index.ts:344-374`, `authenticate` only, HSEC-01) | `encrypt` (`encryption.ts:15-22`) | `APP_ENCRYPTION_KEY` | JSON | `{saved:[…]}` | — | — | — | `tenant_settings.eta_client_id/secret/signing_cert` (AES-256-GCM) | 503 if the key is missing | none | own tenant | [SC] |
| **ETA: connection test** | `fetch` | `POST /api/settings/eta/test` (`index.ts:381-409`) | `EtaClient.testConnection` → `/connect/token` (`eta.client.ts:22-54`) | OAuth2 client credentials | form | JSON token | none | none | n/a | none | → `{success:false}`; `request.log.warn({err})` | the error text includes ETA's response body | own tenant; **env from `eta_environment`** (the real column) | [SC] |
| **ETA: resubmit** | BullMQ | `POST /api/admin/eta/resubmit/:invoiceId` (`eta.routes.ts:9-39`, `eta:manage`) | raw SELECT + UPDATE → `enqueueEtaSubmission` | — | — | 202 | — | — | none (no `jobId`) | `eta_status='pending'` | **first SELECT fails `42883` (INT-01)** → 500 | — | own tenant (`request.tenant.schemaName`) | [RT] |
| **ETA: submission worker** | `fetch` + BullMQ | queue `eta-submissions` (`eta-submission.job.ts:63-226`) | worker → `submitInvoiceToEta` (`eta.submit.ts:32-107`) → `EtaClient.submitDocuments` (`eta.client.ts:56-71`) | OAuth2; per-tenant creds decrypted in-process | JSON `{documents:[doc]}`; RSA-SHA256 over sorted-key JSON **only if a PEM is stored** (`eta.signer.ts:21-63`) | `submissionUUID`, `acceptedDocuments[]`, `rejectedDocuments[]` [DOC] | none | 5 attempts: 30 s, 2 m, 10 m, 1 h | none | `invoices.eta_*`, `eta_submissions` | rejected → no retry; everything else → retry | final failure: `console.error(invoiceId)` | `schemaName` from the job payload | [RT] |
| **ETA: history** | — | `GET /api/invoices/:invoiceId/eta-submissions` (`eta.routes.ts:41-55`) | raw SELECT | — | — | rows | — | — | — | — | **selects absent columns + uuid=text** (E-01, INT-01) | — | own tenant | [SC][RT] |
| **Resend** | `resend` **3.5.0** (dynamic import per send) | `sendEmail` (`email.ts:132-148`), `sendInvoiceReceiptEmail` (`:228-244`), `sendInstallmentReminderEmail` (`:261-310`), `sendPasswordResetEmail` (`:312-339`) | callers: billing handlers, trial-expiry, reminders, `/billing/cancel`, `/invoices/:id/email-receipt`, forgot-password | API key (Bearer) | JSON | **`{data, error}`; never throws** | none (undici defaults) | none | **none** (and the 3.5.0 SDK has no idempotency option) | callers write dedupe/audit rows after "sending" | return value ignored everywhere | none on failure; **dev fallback prints links and PII when the key is unset** (`email.ts:136, 232, 267, 320`) | platform sender `EMAIL_FROM`; tenant name in the body | [RT] |
| **R2 / S3** | `@aws-sdk/client-s3` + `s3-request-presigner` **3.1045.0** | `POST /api/customers/:id/documents` (`customer.routes.ts:161-208`), `GET …/documents/:docId/download` (`:213-240`), `GET /api/products/upload-url` (`product.routes.ts:46-68`) | `getUploadUrl` / `getDownloadUrl` / `keyFromPublicUrl` (`config/r2.ts:17-57`) | static access key (presign is local computation) | presigned URL | — | n/a (**no network call by the server**) | — | — | `customer_documents` row **before** the upload | 503 when unconfigured | none | **no tenant prefix** in keys | [RT] |
| **GA4** | browser `gtag` | `RouteBoundary` (`App.tsx:54-60`) → `trackPageView` (`analytics.ts:133-139`) | page views + typed events | Measurement ID (`VITE_GA_MEASUREMENT_ID`) | gtag | — | — | — | — | — | — | **`pathname + search` sent** | — | [SC] |
| **Sentry** | `@sentry/node` **not installed** | `sentry.plugin.ts:9-41` | — | `SENTRY_DSN` | — | — | — | — | — | — | missing module → warn | — | — | [SC] |
| **Google Fonts** | browser | `apps/web/index.html` | CSS/fonts | none | — | — | — | — | — | — | — | — | — | [SC] |
| **Caddy on-demand TLS** | inbound | `GET /internal/check-tenant` (`index.ts:186-191`) | — | none | query | 200/400 | — | — | — | — | — | — | suffix check only (HSEC-20) | [SC] |

**Not integrations.** `firebase-debug.log` at the repo root is a Firebase CLI debug log (git-ignored by `*.log`, no token-like strings). The `https://wa.me` links are plain hyperlinks. `schema.org` / `sitemaps` are metadata. The ETA QR is a URL string; the `qrcode` package is not installed, so `generateQrPng` returns `null` (`eta.qr.ts:21-31`).

---

## 4. Architecture and Data Flows

```
                         ┌──────────── Hesba API process ─────────────┐
 Browser ──checkout────► │ /billing/checkout ─► Paymob orders/keys     │──► iframe (accept.paymob.com, hard-coded)
 Browser ◄─redirect───── │   Paymob → FRONTEND_URL/settings?tab=billing&<signed tx fields>&hmac=… ─► GA4 (if enabled)
 Paymob ──POST────────►  │ /billing/paymob/webhook ─HMAC(20 fields)─► handleWebhook* ─► masterDb ─► Redis DEL ─► Resend
                         │                                                                                   │
 cron 07:00/08:00 ─────► │ renewal/dunning: SELECT due ─► Paymob order ─► Paymob pay ─► handleWebhook* ─► DB  │
                         │                   (no intent row; unknown outcomes = "transient")                │
 Tenant user ──────────► │ /admin/eta/resubmit ─raw SQL (uuid=text ✗)─► BullMQ ─► worker ─► ETA token+submit │
                         │                                                 └─► invoices.eta_*, eta_submissions │
 Jobs / routes ────────► │ email.ts ─► resend SDK ─► {data|error} (ignored)                                  │
 Tenant user ──────────► │ R2 presign (local) ─► URL ─► (no UI caller) ─► client PUT directly to R2          │
                         └────────────────────────────────────────────────────────────────────────────────────┘
```

**Business-side-effect flows** (read → external → outcome → write → recovery):

| Flow | DB read | External request | Provider outcome handling | DB write | Recovery |
|---|---|---|---|---|---|
| Checkout | `subscription.findFirstOrThrow({tenantId})` (no `orderBy`), price | 3 Paymob calls | errors → 500 | **none** | none needed (no money moved) |
| Token charge | due list (once per cycle) | 4 Paymob calls | `success` → success handler; else → failure handler; **exception → "transient"** | attempt + subscription (array tx) | whole-cycle BullMQ retry → **new charge** |
| Webhook | `subscription.findFirst({tenantId})` | — | dispatch by `success / is_refunded / is_voided / error_occured / pending` | attempt + subscription | provider re-delivery; P2002 dedupe |
| ETA submit | invoice + settings (raw SQL), items | token + submit | 202 + accepted → `accepted`; rejected → `rejected`; any exception → `failed` + retry | `invoices.eta_*` (4 separate statements), `eta_submissions` | BullMQ retry ×4 → resubmission |
| Email | caller-specific | Resend send | **ignored** | callers write `reminder_sent` / bump counters / audit `email_receipt` regardless | none |
| R2 document | customer exists | none by the server | n/a | `customer_documents` row with the would-be URL | none (a broken link if the client never uploads) |

---

## 5. Paymob Payment Correctness

| Question | Answer | Evidence |
|---|---|---|
| Where do amounts originate? | **Server.** `subscriptions.price_at_subscription × 100`, rounded with `decimal.js` (`billing.service.ts:100-103`, `renewal.job.ts:94-97`, `dunning.job.ts:105-108`). Set once at `startTrial` from `plan.priceMonthly` (`:45-62`); `billing_cycle` is always `MONTHLY`; an admin plan change does not update it (P-04) | [SC] |
| Currency validation | none. Requests send `EGP` (default, `paymob.client.ts:57, 82`). The webhook never reads `obj.currency` for validation; `handleWebhookSuccess/Failure` **hard-code `currency: 'EGP'`** in the row (`billing.service.ts:151, 231`) | [RT] I2: a signed USD callback stored as `1 EGP` |
| Expected vs actual amount | **never compared.** The webhook stores Paymob's `amount_cents`. The **job path stores its own requested amount**, even when Paymob's response says otherwise (`renewal.job.ts:137-143` passes `amountCents`, not `charge.amount_cents`) | [RT] I1: Paymob answered 100 USD → row `300 EGP`, sub `ACTIVE` → **INT-05**; FIN-17 |
| Identifier relationships | `merchant_order_id = sub_<tenantId>_<Date.now()>` is new per order (checkout `paymob.client.ts:105`, renewal `:101`, dunning `:110`); Paymob `order.id` is stored only inside the `provider_response` JSON (`billing.service.ts:155`); `provider_transaction_id` UNIQUE. **No local record ties an order to a subscription period** | [SC] |
| Payment status validation | webhook: `success && !is_refunded && !is_voided` → success; `error_occured \|\| (!success && !pending)` → failure; otherwise 200 no-op (`billing.routes.ts:42-57`). `is_auth`/`is_capture` ignored → **auth-only success = paid** (FIN-P6). Job: `charge.success` → success, **anything else (incl. `pending: true`) → failure** (FIN-L3) | [RT] W3: auth-only → `ACTIVE`; W4: pending callback → no-op |
| Webhook authentication | HMAC-SHA512 over the official 20-field list, in order, booleans lowercase; constant-time; fail-closed on a missing secret or hmac (`paymob.webhook.ts:9-61`) | [DOC] field list matches; [RT] the unit suite plus W7 (bad/missing hmac → 401/400) |
| Replay / duplicate handling | `UNIQUE(provider_transaction_id)` → P2002 → silent return **before** cache invalidation and email | [RT] D: 3 deliveries → 1 row, 200 ×3, 1 email path |
| Payment → tenant binding | `merchantOrderId.split('_')[1]` (`billing.service.ts:128`). **`merchant_order_id` is not in the signed field set** [DOC]. `findFirst({ where: { tenantId } })` without `orderBy` | [RT] W5 (HSEC-21) |
| Payment → period binding | **none.** Every success sets `period = now … now + 1 cycle` (`:134-138, 168-170`), whatever the period it was meant for | [RT] G: two successes → one period |
| Do signed fields cover every field used for selection? | **No.** Unsigned and used: `obj.order.merchant_order_id` (tenant), `obj.token` (stored card token, `:171`). Signed but unused for validation: `amount_cents`, `currency`, `integration_id`, `is_auth`, `is_capture` | [DOC][SC] |
| Callback ordering | SUCCESS → later FAILURE (same tx) is a no-op (P2002). FAILURE → later SUCCESS (same tx): the success is dropped (DB-P01). A late success for an **older** tx resets the period and reactivates (DB-25) | [RT] F2 |
| Delayed callbacks revive cancelled subscriptions? | **Yes.** F2: admin-cancelled → late checkout success → `ACTIVE` with `cancelled_at` still set. F1: user cancel-at-period-end → late success → `ACTIVE`, period extended, flag kept (consistent) | [RT] |
| Successful charge, then a timeout → charged again? | **Yes** (§7 B, B2, J1, J2, K) | [RT] |
| DB failure after a successful charge recoverable? | **No.** Retry re-charges ([RT5] X3); the webhook can rescue it only if Paymob's processed callback reaches us before the 60 s retry. **Token charges send no `notification_url`** (`paymob.client.ts:125-130`; [RT] P0), so this depends on the dashboard-level callback configuration (U6-03) | [RT][RT5] |
| Reconciliation | none (`reconcilePayments` is a placeholder with no caller); no Paymob inquiry endpoint is used, although Paymob documents one (`transaction_inquiry` by `merchant_order_id`, and GET transaction by id) [DOC, Oman docs; Egypt availability U6-04] | [SC][DOC] |
| Refunds and cancellations | refund and void callbacks are 200 no-ops; the subscription stays `ACTIVE`; nothing is recorded (B-03) | [RT] W1, W2 |
| Recurring-charge integration | token charges use `PAYMOB_INTEGRATION_ID_CARD`, the same integration id as the 3-DS checkout ([RT] P0: `integration_id 11` for both). Paymob documents that recurring charges need a **separate integration id** obtained from Paymob [DOC] | **L6-01** |
| Checkout environment | the iframe host is hard-coded to `accept.paymob.com` (`paymob.client.ts:114`) while the API host follows `PAYMOB_BASE_URL` ([RT] P0: API on loopback, iframe on `accept.paymob.com`) | INT-08 |

**Can Hesba distinguish the five outcomes?**

| Outcome | What Hesba sees | Classified as | Correct? |
|---|---|---|---|
| Request never reached Paymob (DNS / connect error) | `fetch` rejects | transient → whole-cycle retry | **acceptable** (no money moved), but indistinguishable from the rows below |
| Paymob rejected the request (4xx on order/key/pay) | `paymobFetch` throws | transient → retried ×3 | wrong for permanent 4xx (e.g. a revoked token), but no double charge |
| Payment definitely failed | 200 `success:false, pending:false` | failure handler | ✓ |
| Payment pending (3-DS / async) | 200 `pending:true` | **failure handler** | ✗ (FIN-L3) |
| Payment succeeded, response lost / 5xx / garbled / timed out | exception | **transient → retry → new order → new charge** | ✗ (**BG-01**) |
| Payment succeeded, DB write failed | exception from the handler | same | ✗ |

**There is no state for "unknown".** The only way back to certainty would be an inquiry by `merchant_order_id`, and nothing calls one.

---

## 6. Durable Payment Lifecycle

**Current flow (from code):**
```
subscription.current_period_end ≤ now            (no row for "period P is being charged")
→ createOrder(merchant_order_id = sub_<tenant>_<now>)   (identity minted per attempt, not per period)
→ chargeWithToken                                  (no notification_url)
→ success → handleWebhookSuccess(tx) → INSERT attempt(tx) + UPDATE sub (period = now+1m)
  failure → handleWebhookFailure(tx) → INSERT attempt(tx) + failed_attempts = read+1
  exception → nothing written → BullMQ retry (60 s) → new merchant_order_id → charge again
→ Paymob processed callback (if configured) → same handlers, P2002 if already recorded
```

| Question | Answer | Evidence |
|---|---|---|
| Does an attempt have a stable identity before the provider call? | **No.** Nothing is written before `createOrder`; the id is `Date.now()` based | [SC] |
| Can the same attempt be retried under a different identity? | **Yes, always**: each retry mints a new `merchant_order_id` and a new Paymob order | [RT] B: tx 5002 then tx 5006 for one sub |
| Can the same period be charged multiple times? | **Yes**: retry (B, B2, J1, J2), stale list vs checkout (G), lock expiry (H2), trial-expiry overwrite then dunning ([RT5] S-A) | [RT] |
| Can a webhook arrive before the initiating request finishes? | **Yes**, and that case is safe: E shows the callback for the job's own tx recorded first; the job's insert then hits P2002 → 1 row | [RT] E |
| Can webhook processing race with renewal/dunning? | **Yes, unsafely** when the webhook is for a *different* tx (a checkout payment): G → 2 SUCCESS rows, 1 period | [RT] G |
| Are failed and ambiguous attempts distinguishable? | **No.** Failures are rows; ambiguous attempts leave no row at all | [SC][RT] |
| Is the provider transaction id persisted? | yes, for recorded outcomes only (`provider_transaction_id` UNIQUE); the Paymob order id only inside JSON | [SC] |
| Can successful payments be reconciled after a crash? | **No.** Nothing records that a charge was attempted, and no inquiry is implemented | [SC][RT5] X5 |
| Do cancellation and retry policies use durable payment history? | **No.** Retry eligibility = `failed_attempts` + `last_failed_at`; cancellation = flags on the subscription row; neither reads `payment_attempts` | [SC] |

**Minimum data model and invariants** (requirements, not an implementation). This refines Phase 5 §14 with the Phase 6 provider facts.

`billing_charges` (one row per *intended* charge, inserted before any Paymob call):

| Column | Purpose |
|---|---|
| `id` (UUID) | stable identity of the attempt |
| `merchant_order_id` = deterministic from `id` | lets the webhook find the intent without trusting unsigned parsing, and lets an inquiry by `merchant_order_id` [DOC] resolve unknowns |
| `subscription_id`, `tenant_id`, `period_start`, `period_end` | the unit being paid for |
| `kind` (`checkout` / `renewal` / `retry`), `attempt_no` | keeps checkout declines out of renewal escalation (DB-37) |
| `expected_amount_cents`, `expected_currency`, `integration_id` | compared against the **signed** `amount_cents`, `currency`, `integration_id` on every outcome |
| `provider_order_id` (UNIQUE), `provider_transaction_id` (UNIQUE) | binding; the webhook resolves the intent by the **signed** `obj.order.id` (closes HSEC-21) |
| `status`: `PENDING → SUBMITTED → SUCCEEDED / FAILED / PENDING_PROVIDER / UNKNOWN / REFUNDED / VOIDED` | explicit unknown and pending states; refunds/voids representable (B-03) |
| `outcome_source` (`response` / `webhook` / `inquiry`), `last_error_class` | diagnosis |
| `created_at`, `updated_at` | reconciliation windows |

**Invariants:**
1. At most one live (`PENDING / SUBMITTED / PENDING_PROVIDER / UNKNOWN / SUCCEEDED`) charge per `(subscription_id, period_start)`, enforced by a partial UNIQUE index.
2. A charge in `UNKNOWN` or `PENDING_PROVIDER` blocks any new charge for the period until resolved by inquiry or webhook.
3. A subscription period changes only through the transition of a charge to `SUCCEEDED`, and the period it grants is the charge's period. It extends from `max(now, current_period_end)`, never resets.
4. Success applies only from allowed subscription states. A charge created *before* a cancellation (`cancelled_at`, `cancel_at_period_end`) cannot reactivate the subscription; it is flagged for refund instead.
5. Webhook outcomes are applied only when the signed `order.id`, `amount_cents`, `currency` and `integration_id` match the intent.
6. Exceptions after the `SUBMITTED` write are classified `UNKNOWN`, never "transient".

---

## 7. Paymob Failure Scenarios

All scenarios ran the **real** renewal/dunning workers (BullMQ, real `billing.service`), the **real** `billingWebhookRoutes` registered in a throwaway Fastify instance and driven by `inject`, and a loopback Paymob mock. Only loopback hosts were contacted.

| # | Scenario | Expected | Actual | Evidence | Reproducible | Duplicate financial effect | Regression test |
|---|---|---|---|---|---|---|---|
| **A** | Definite decline | FAILED row, `failed_attempts 1`, one charge attempt | as expected: `FAILED:5001`, `failed 1`, 1 decline | [RT] | yes | no | RT6-A (guard) |
| **B** | Charge accepted, response lost (socket reset) | detect "unknown", inquire, record once | `fetch failed (other side closed)` → transient → **real BullMQ retry 60 s later → second charge**; rows `SUCCESS:5006` only; gateway `reset-after-charge#5002, success#5006` | [RT] | yes, deterministic | **yes: 2 charges** | RT6-B (BG-01) |
| B2 | Charge accepted, Paymob returns 504 | as B | `Paymob API /acceptance/payments/pay failed: 504` → retry → second charge | [RT] | yes | **yes** | RT6-B |
| **C** | Provider succeeds, DB write fails | as B | [RT5] X3: DB refused after the charge → retry → 2 charges, 1 row (code unchanged since) | [RT5] | yes | **yes** | RT6-C |
| **D** | Duplicate webhook | one row, one effect | 2 concurrent + 1 sequential: status `200,200,200`; 1 row `SUCCESS:7101`; sub `ACTIVE` | [RT] | yes | no ✓ | RT6-D (guard) |
| **E** | Webhook (same tx) before the initiating job finishes | one row | callback recorded first (200); the job's insert → P2002 no-op; 1 row `SUCCESS:5010`, 1 charge | [RT] | yes | no ✓ | RT6-E (guard) |
| **F** | Webhook after cancellation | F1 (user cancel-at-period-end) consistent; F2 (admin cancel) must not reactivate | F1: `ACTIVE`, `cancel_at_period_end` kept, period +1 m (acceptable). **F2: `ACTIVE` with `cancelled_at` set** | [RT] | yes | money accepted for a cancelled subscription; state contradictory | RT6-F (DB-25, BG-03) |
| **G** | Retry concurrent with a successful (checkout) webhook | the retry sees the paid period and skips | `SUCCESS:7301` (checkout) **and** `SUCCESS:5011` (dunning token charge); period +1 month only | [RT] | yes | **yes: 2 charges, 1 period** | RT6-G (BG-03) |
| **H1** | Two renewal workers, two jobs at the same time | one cycle | the `withLock` skip → each sub charged once | [RT] | yes | no ✓ | RT6-H1 (guard) |
| **H2** | Two workers, the first cycle still inside a Paymob call when the 25-min lock expires (expiry simulated by deleting the key; BG-04 makes > 25 min cycles possible) | one charge per sub | **all three subs charged twice**: `success#5014/5017`, `#5015/5018`, `#5016/5019`; 2 rows each | [RT] | yes (with the TTL simulated) | **yes** | RT6-H2 (L5-01 → CONFIRMED mechanism) |
| **I1** | Token charge answered with an inconsistent amount/currency (100 USD vs 30000 EGP expected) | reject and flag | sub `ACTIVE`; row `SUCCESS:5020:300EGP` (Hesba's expectation, not Paymob's answer) | [RT] | yes | record falsified | RT6-I (INT-05) |
| **I2** | Signed webhook with amount 100, currency USD | reject (amount/currency mismatch) | 200; `ACTIVE` for a full period; row `SUCCESS:7401:1EGP` | [RT] | yes | under-payment accepted | RT6-I (FIN-17) |
| **J1** | Malformed response: HTML body with 200 after charging | unknown → inquire | `SyntaxError: Unexpected token '<'` → transient → retry → **second charge** | [RT] | yes | **yes** | RT6-B |
| **J2** | 200 JSON missing `order`/`token` after charging | unknown | `TypeError: Cannot read properties of undefined (reading 'id')` → retry → **second charge** | [RT] | yes | **yes** | RT6-B |
| J3 | Malformed webhook (no `obj`) | 400 | **500** (`TypeError` in the HMAC builder) → Paymob re-delivers | [RT] W7 | yes | no | RT6-W |
| **K** | Provider responds slowly / never | bounded wait, then unknown | 3 s: waited, completed (no client timeout). Never: [RT5] X4/X9: the worker is blocked ≈ 300 s per call (undici `UND_ERR_HEADERS_TIMEOUT` at 301 s), then classified transient → retry | [RT][RT5] | yes | yes, if the hung call had charged | RT6-K (BG-04) |
| **L** | Process terminated during a Paymob request | the next run resolves the unknown | [RT5] X5 (SIGKILL) / X6 (real `index.ts`, SIGTERM forced exit at 25.0 s): the charge was taken, no row; the recovery was skipped by the orphaned `withLock` key; **the next day's run charged again** | [RT5] | yes | **yes** | RT6-L (BG-01 + BG-02) |

---

## 8. ETA E-Invoicing

### 8.1 Schema re-verification (E-01 / DB-23)

Re-checked against the **current** migrations and Prisma tenant model, not against prior reports:

| Code reference | Exists in migrations? | Real column | Where referenced |
|---|---|---|---|
| `tenant_settings.eta_signing_cert_pem` | **no** | `eta_signing_cert` (`002_full_schema.sql:30`; Prisma `etaSigningCert`) | `eta-submission.job.ts:74` |
| `tenant_settings.eta_is_production` | **no** | `eta_environment VARCHAR` (`002:24`; Prisma `etaEnvironment`) | `:74` |
| `invoices.eta_qr_data` | **no** | `eta_qr_code` (`002:265`) | `:186-190` |
| `eta_submissions.submission_id` | **no** | — | `eta.submit.ts:81, 97`; `eta.routes.ts:48` |
| `eta_submissions.created_at` | **no** | `submitted_at` | `eta.submit.ts:65, 81, 97`; `eta.routes.ts:48-49` |
| `eta_submissions.direction NOT NULL` (no default) | exists, **never written** | — | all three INSERTs (`eta.submit.ts:64-99`) |

[RT] The unpatched throwaway schema fails with `column ts.eta_signing_cert_pem does not exist`. **E-01 / DB-23 are confirmed unchanged.**

The repository cannot show whether production received out-of-band DDL (U6-10). The brief asks not to assume the production schema matches, so this stays UNVERIFIED for production.

### 8.2 New blocker behind the schema drift: UUID vs text parameters (INT-01)

To look past DB-23, the five columns were added to the **throwaway** tenant schema only. The worker then failed with a different error on every job: `42883`. [RT] Each ETA statement, run individually against the throwaway schema with the app's exact SQL and parameter:

| Statement | Result |
|---|---|
| `eta.routes.ts:16-19` resubmit SELECT `WHERE id = $1` | `42883 operator does not exist: uuid = text` |
| `eta.routes.ts:26-29` UPDATE `WHERE id = $1` | `42883` |
| `eta-submission.job.ts:70-81, 120-128` SELECTs | `42883` |
| `eta.submit.ts:43-46` attempt-number SELECT | `42883` |

Prisma binds a JS string to `$queryRawUnsafe`/`$executeRawUnsafe` as `text`, and PostgreSQL has no `uuid = text` operator. Other modules already cast explicitly (`invoice.service.ts:413, 718`; `expense.routes.ts:207, 212`); the ETA code does not.

**Consequence:** `POST /api/admin/eta/resubmit/:invoiceId`, the *only* ETA producer (E-02), fails with 500 **before** enqueuing. ETA is unreachable at its entry point even if DB-23 were fixed alone.

The same uncast pattern is in the customer statement export (`customer.routes.ts:258-263`). That route is outside integration scope and already broken by DB-33, so it is a cross-reference only.

### 8.3 Pipeline behaviour beyond both blockers

To observe the rest of the real worker, a **harness-only shim** wrapped the throwaway tenant client's raw-SQL methods and added `::uuid` casts: 82 rewrites, never applied to the repository.

Synthetic invoices as the POS stores them:
- line 1: 2 × 100, line discount 20, VAT 14 % = 25.20;
- line 2: a **service** line, 50 + VAT 7.00;
- invoice-level discount 10;
- `total_amount` **252.20**.

ETA mock behaviour follows the official submit contract [DOC]: `submissionUUID`, `acceptedDocuments[]`, `rejectedDocuments[]`, and HTTP 422 `DuplicateSubmission` for an identical payload hash within 10 minutes.

| Invoice | Mock outcome | Attempt 1 result | Attempt 2 result (t ≈ 31 s) | Correct? |
|---|---|---|---|---|
| INV-A | accept | `accepted`, uuid stored, `eta_submissions.submission_id = null` | — | **document wrong** (see the table below) |
| INV-CANCELLED (`status='cancelled'`) | accept | **`accepted`**: a cancelled sale was reported | — | ✗ (BG-08) |
| INV-DUP (two resubmits) | accept, then the duplicate rule | job 1 `accepted` (uuid stored); job 2 → 422 → **`failed`**, which overwrote the status while the uuid stayed | 422 again → `failed` | ✗ ETA holds the document; Hesba shows `failed` |
| INV-LOST | accepted, then connection reset | `failed` (`fetch failed`) | identical payload → 422 → `failed` | ✗ accepted at ETA, `failed` locally. A later retry (attempt 4 at ≈ 12.5 min, outside the 10-min window) would resubmit (L6-05) |
| INV-REJ | rejected (issuer `branchID` missing) | `rejected`, no retry | — | ✓ classification |
| INV-BAD | 400 BadStructure (permanent) | `failed` + retry | retried (5 attempts total, ≈ 1 h 13 m) | ✗ permanent error retried |
| INV-MAL | malformed 200 (`{status:'ok'}`) | `TypeError: … reading 'find'` thrown out of `submitInvoiceToEta`; **`eta_status` stuck at `submitted`**, no `eta_submissions` row | retried → resubmitted | ✗ |
| INV-AUTH | 401 at `/connect/token` | `failed` | `accepted` (credentials fixed in the mock); **`eta_error` still shows the old 401** (never cleared) | ✗ minor |

**The INV-A document as submitted vs the stored invoice** [RT]:

| Field | Document | Invoice / settings | Cause |
|---|---|---|---|
| lines | **1** | 2 | the item query uses an inner `JOIN product_variants`; service lines (`variant_id NULL` since `013_work_order_invoice.sql:8`) are dropped (`eta-submission.job.ts:120-128`) |
| `totalAmount` | **228** | 252.20 | the line discount is not passed (`discountAmount` is never mapped, `:148-154`); the invoice-level discount is ignored; tax is recomputed from the rate instead of the stored `tax_amount` |
| line `discount.amount` | 0 | 20 | as above |
| `signatures` | **none** | no PEM stored | `eta.submit.ts:52-58` submits unsigned when no cert is stored. When one is stored, RSA-SHA256 over `JSON.stringify` with sorted keys (`eta.signer.ts:21-56`), which the file's own header describes as dev-only, with CAdES-BES/HSM needed for production |
| issuer `address.branchID` | **absent** | settings `eta_branch_code = 7` | the address is built without a branch id; the payload puts `branchId: '0'` at the top level (`eta.payload.ts:53`) because the worker never passes `branchCode` |
| `receiver` | **absent** | — | never passed (`eta.payload.ts:40-47` supports it) |
| `itemCode` | `SKU-1` (internal SKU) | — | `itemType 'EGS'` with an internal code (`eta.payload.ts:89-91`); ETA expects registered item codes [ASM, U6-06] |
| `unitValue` | the stored `unit_price` | — | a client-supplied price (FIN-05) flows into the tax document |

### 8.4 ETA audit checklist

| Topic | Finding | Status |
|---|---|---|
| Invoice eligibility | only manual resubmit; no automatic enqueue (E-02); `eta_auto_submit` column never read | [SC] |
| Invoice construction | INT-02 | [RT] |
| Taxpayer / tenant identity | issuer from tenant settings; settings writable by any authenticated user (HSEC-01) | [SC] |
| Credentials | AES-256-GCM, write-only, masked (`index.ts:258-272, 344-374`); decrypted per job; the key has no version tag (INT-09) | [SC] |
| Environment selection | the worker reads non-existent `eta_is_production` (would be `undefined` → preprod after a naive fix); the test route reads `eta_environment` (`index.ts:400`); the environment cannot be set through the API (E-07). **The worker and the test route disagree on how the environment is chosen** | [SC] |
| Signing / auth | unsigned without a PEM; non-ETA canonicalisation with one; OAuth2 client credentials | [SC][DOC] |
| Decimal precision | `decimal.js`, 5 dp, `toNumber()` at serialisation | [SC] ✓ |
| UUIDs / submission ids | `submissionUUID` [DOC] is read as `response.submissionId` (`eta.submit.ts:83, 90, 97, 105`) → **always `undefined`** → `submission_id` null; `eta_internal_id` (UNIQUE) never written | [RT] |
| Status transitions | `pending → submitted → accepted / rejected / failed`, four separate UPDATEs, no conditional writes; `submitted` never read; `accepted` treated as final although a 202 means "accepted for processing" with validation not complete [DOC]; `getDocumentStatus` (`eta.client.ts:73-83`) never called | [RT][DOC] |
| Validation errors | rejected docs stored in `eta_error` / `eta_submissions` ✓; HTTP 400 BadStructure treated as transient | [RT] |
| Retry | 5 attempts (30 s, 2 m, 10 m, 1 h); every non-rejected error retried | [RT] |
| Duplicate prevention | none (BG-08); ETA's own 10-min hash rule turns Hesba's retries into 422s that are recorded as `failed` | [RT][DOC] |
| Cancellation / credit notes | none: cancel/return never notify ETA (F-05) | [SC] |
| Response persistence | `response_body` and `request_payload` stored (would be, after DB-23); `submission_id` lost | [RT] |
| Reconciliation of uncertain submissions | none | [SC] |
| Worker interactions | concurrency 3, no per-invoice lock (X7, INV-DUP) | [RT][RT5] |

**Can a successful submission followed by a local failure cause a duplicate submission?**
- **Within 10 minutes:** no, because ETA returns 422, but Hesba records `failed` and keeps retrying.
- **After 10 minutes:** attempt 4 resubmits an identical document, and the ETA-side outcome is UNVERIFIED (L6-05, U6-05).
- **With two concurrent jobs** whose payloads differ (e.g. a signed document with a time-dependent signature): both can be accepted (UNVERIFIED for a real signature).

**Is a permanently invalid invoice retried indefinitely?** No: it is retried 5 times (≈ 1 h 13 m), then `failed`. Permanent errors are not distinguished from transient ones (INV-BAD).

---

## 9. Resend Email Reliability

**SDK behaviour, verified on the installed `resend@3.5.0`** (`resend/dist/index.js:350-390`). The real SDK was pointed at a loopback mock through its own `RESEND_BASE_URL` hook (`:323`):

| Provider outcome | SDK threw? | SDK returned |
|---|---|---|
| 200 `{id}` | no | `{data:{id:'em_1'}, error:null}` |
| 500 | **no** | `{data:null, error:{statusCode:500, name:'internal_server_error', …}}` |
| 429 (`retry-after: 1`) | **no** | `{data:null, error:{statusCode:429, name:'rate_limit_exceeded', …}}` |
| 422 validation | **no** | `{data:null, error:{statusCode:422, name:'validation_error', …}}` |
| connection reset | **no** | `{data:null, error:{name:'application_error', message:'Unable to fetch data…'}}` |
| 200 with an HTML body | **no** | the same `application_error`: **an accepted send may be reported as an error** |
| `send(payload, { idempotencyKey })` | — | header **not sent**: the option is ignored by 3.5.0. Resend documents the `Idempotency-Key` header and an SDK option in newer releases [DOC] |

**The Phase 5 claim (BG-05) is re-verified and extended** to 429, 422 and malformed 200. It is not generalised beyond 3.5.0.

**App helpers** (`email.ts`) under 500 / 429 / reset [RT]: `sendEmail`, `sendInstallmentReminderEmail`, `sendInvoiceReceiptEmail` and `sendPasswordResetEmail` all **resolved `undefined`**. No caller can detect a failure.

| Path | Recorded as sent before provider confirmation? | Duplicate after DB failure? | Inbox delivery assumed? | Evidence |
|---|---|---|---|---|
| Installment reminder | **yes**: the `reminder_sent` audit row is written whatever Resend returned (`installment-reminders.job.ts:135-154`) → the reminder is suppressed 24 h | yes, if the audit INSERT fails after an accepted send (no idempotency key) | API acceptance treated as delivery; no webhook for bounces | [RT5] R2, [RT] |
| Trial reminders | **yes**: `trial_reminders_sent` bumped regardless (`trial-expiry.job.ts:88-110`) → lost permanently | yes (crash before the bump) | same | [SC] |
| Billing notices (`payment_*`, `subscription_*`) | not recorded; `.catch` logging is unreachable | no (P2002 returns first) | same | [RT] |
| Receipt (`POST /invoices/:id/email-receipt`) | the route returns `{success:true, sentTo}` and audits `email_receipt` regardless (`invoice.routes.ts:214-248`) | user retries → duplicates | same | [SC][RT] |
| Password reset | the user is told nothing either way (anti-enumeration); a failed send is silently lost; the link path `/reset` matches no SPA route (HSEC-15) | — | — | [RT] link path `/reset?token=…` |
| Cancellation scheduled | `.catch(() => {})` | user double-click → 2 emails | — | [SC] |

**Further checks:**

| Topic | Finding |
|---|---|
| Rate limiting | none client-side; the reminder cycle sends sequentially across all tenants; a 429 is recorded as sent (above) |
| Retries / timeouts | none / undici defaults (≈ 300 s headers) inside HTTP requests (receipt, forgot-password) and jobs |
| Recipient validation | zod `.email()` on the receipt route; any address allowed (HSEC-06); jobs use DB addresses |
| Sender identity | always `EMAIL_FROM` (platform domain); **no `reply_to`** [RT], so a customer replying to a store's reminder or receipt reaches the platform's no-reply |
| HTML escaping | **none**: [RT] markup in tenant name (`trial_expired`), customer/store name (reminder) and product/customer name (receipt) is embedded raw (HSEC-06 re-confirmed in 3 templates) |
| Sensitive data in URLs | reset token in the query string (`email.ts:316`), then into GA if enabled (HSEC-25); checkout link `/billing/checkout` matches no route (AU-11) |
| Dev fallback | with `RESEND_API_KEY` unset, reset links and reminder PII are printed to stdout **in any `NODE_ENV`** (`email.ts:136, 232, 267, 320`) (HSEC-25) |

---

## 10. Cloudflare R2 / Object Storage

**The server never talks to R2.** It only presigns locally (`config/r2.ts:17-47`) and stores the would-be public URL. [RT] presigning with fake credentials made 0 outbound requests.

| Topic | Finding | Status |
|---|---|---|
| Bucket selection | one bucket (`R2_BUCKET_NAME`) for **product images (meant to be public)** and **customer national-ID scans (meant to be private, per the API-02 comment `r2.ts:35-40`)**. One R2 bucket's public access cannot serve both: making it private breaks product images (stored as public URLs); keeping it public exposes documents to anyone holding a URL | [SC] → INT-06 |
| Public vs private | not determinable from the repo | U6-07 |
| Upload authorization | `customers:update` / `products:create` | [SC] ✓ |
| Tenant ownership / key construction | `customers/<customerId>/<uuid>.<ext>`, `products/<uuid>.<ext>`: server-generated, random, **no tenant prefix**; ext from the MIME enum | [SC][RT] |
| Path traversal / key confusion | keys are server-generated; `keyFromPublicUrl` is a prefix strip that accepts `../` segments ([RT]: `…/../products/y.png` → `../products/y.png`). Only exploitable if a stored URL were client-controlled; `customer_documents.file_url` is server-set only, so not exploitable today | [RT] |
| Content type | **not enforced**: the presigned PUT's `X-Amz-SignedHeaders` is **`host`** only; `Content-Type` is neither signed nor in the query [RT]. **This corrects Phase 2 §14** ("content type pinned in the signature") | [RT] |
| File size | no bound: no `content-length` condition | [RT] (HSEC-29) |
| Presigned expiry / permission | PUT and GET 300 s, single key, single method | [RT] ✓ |
| SDK checksum default | the URL carries `x-amz-checksum-crc32=AAAAAA==` (CRC32 of an **empty** body) and `x-amz-sdk-checksum-algorithm=CRC32`; `r2.ts` sets no `requestChecksumCalculation`. AWS SDK ≥ 3.729 adds CRC32 by default [DOC]; Cloudflare's docs describe that change as incompatible with R2 [DOC] → uploads LIKELY rejected (L6-04) | [RT][DOC] |
| Overwrite | random keys → no overwrite in practice | [SC] |
| Deletion / orphan cleanup | no delete endpoint; no cleanup | [SC] |
| DB ↔ object consistency | the document row is created **before** the client uploads (`customer.routes.ts:186-197`; the comment acknowledges a broken link if the upload never happens); no confirmation step | [SC] |
| Cross-tenant access | the download route presigns only keys derived from the caller's own `customer_documents` row | [SC] ✓ |
| Logging of signed URLs / credentials | none; the presigned URL is returned in the response body only | [SC] ✓ |
| Reachability | **no web code calls these endpoints** (grep) and CSP `connect-src` (`index.ts:86-91`) would block a browser PUT to `*.r2.cloudflarestorage.com` | [SC] |

---

## 11. Other Integrations

| Integration | Required? | Missing credentials | Failure / timeout | Safe state? | Sensitive data sent externally | Data loss / duplication | Retries |
|---|---|---|---|---|---|---|---|
| **GA4** (web) | optional (`VITE_GA_MEASUREMENT_ID`, PROD, no DNT) | disabled | browser-side; no app impact | yes | **`page_location`/`page_path` = `pathname + search`** (`App.tsx:57-60`, `analytics.ts:133-139`): reset tokens on `/reset-password?token=` (HSEC-25); **Paymob redirect parameters** on `/settings?tab=billing&…` (L6-02) | — | — |
| **Sentry** | optional | `SENTRY_DSN` unset → off; `@sentry/node` is **not installed**, so even with a DSN it only warns (`sentry.plugin.ts:38-40`) | — | yes | would send URL + tenant id; inactive | — | — |
| **Google Fonts** | optional | n/a | the browser falls back to local fonts | yes | visitor IP / UA to Google (privacy) | — | — |
| **Caddy on-demand TLS ask** | infra | `APP_BASE_DOMAIN` unset → always 400 → no certs | — | — | — | approves any `*.<base>` (HSEC-20) | — |
| **WhatsApp link** | link only | — | — | — | — | — | — |

---

## 12. HTTP Client and Timeout Safety

| Client | Used by | Connect timeout | Response / headers timeout | Body timeout / size limit | Abort | Retry | Keep-alive | Evidence |
|---|---|---|---|---|---|---|---|---|
| Node global `fetch` (undici) | Paymob (`paymob.client.ts:25-37`), ETA (`eta.client.ts:31-82`), Resend SDK (`resend/dist/index.js:353`) | undici default ≈ 10 s [ASM: library default, not measured] | **≈ 300 s**: measured **301.0 s → `UND_ERR_HEADERS_TIMEOUT`** on Node 23 [RT5 X9]; the production image is `node:20-alpine` (undici default `headersTimeout` is also 300 s [ASM]) | 300 s; no response-size cap (`res.json()` / `res.text()` read everything) | **no `AbortSignal` anywhere** | none at the HTTP layer (BullMQ whole-cycle / job retries above it) | undici global dispatcher defaults | [RT][RT5] |
| AWS SDK S3 | presign only | n/a (no network) | n/a | n/a | n/a | n/a | n/a | [RT] 0 outbound calls |
| Axios | **web app only** (`apps/web`), to the Hesba API; timeout 0 (Phase 4) | — | — | — | — | — | — | Phase 4 |

**Consequences:**
- **Timeouts are not failures.** Every Paymob timeout after `/acceptance/payments/pay` is treated as transient and leads to a re-charge (BG-01, §7 K). The ETA timeout is recorded `failed` and leads to a resubmission (INT-03).
- **Hung calls block workers.** The four cron workers have concurrency 1, so one silent Paymob call blocks the queue for ≈ 300 s per call, up to 4 calls per subscription ([RT5] X4). The ETA worker (concurrency 3) blocks one slot per call.
- **Unrelated tenants are delayed.** Renewal and dunning process all tenants sequentially in one job, so one slow subscription delays every tenant after it. A cycle can exceed the 25-min `withLock` TTL, which enables H2 (overlapping cycles, double charges).
- **Graceful shutdown is defeated.** The 25 s budget (`index.ts:523-526`) is far below 300 s, so any in-flight Paymob or ETA call at deploy time ends in a forced exit ([RT5] X6).
- **HTTP requests can hang for minutes.** `/billing/checkout` (3 sequential Paymob calls), `/settings/eta/test`, `/invoices/:id/email-receipt` and `/auth/forgot-password` wait up to ≈ 300 s per external call; Fastify has no request timeout.
- **DNS / connection failures** fail fast (connect error) and are handled as transient. That is correct for "never reached".

---

## 13. Webhook Trust Boundaries

Only one inbound third-party webhook exists: **Paymob** (`POST /api/billing/paymob/webhook`). Caddy's ask endpoint is internal infrastructure (HSEC-20).

| Control | Finding | Evidence |
|---|---|---|
| Authentication | HMAC-SHA512, secret from env, fail-closed, `timingSafeEqual` | [SC] `paymob.webhook.ts:9-61`; unit tests (6) pass |
| Exact signed fields | `amount_cents, created_at, currency, error_occured, has_parent_transaction, id, integration_id, is_3d_secure, is_auth, is_capture, is_refunded, is_standalone_payment, is_voided, order.id, owner, pending, source_data.pan, source_data.sub_type, source_data.type, success`. This **matches Paymob's official list** [DOC]. `merchant_order_id` and `token` are **not** signed [DOC] | [DOC][SC] |
| Raw body | not required: Paymob signs field values, not the body [DOC]; the parsed JSON is used | [DOC] |
| Timestamp / replay | no freshness check (`created_at` is signed but not compared); replay of a recorded tx is a no-op (P2002); replay of an **unrecorded** tx is accepted | [RT] D |
| Event identity / dedupe | `provider_transaction_id` UNIQUE | [RT] D, E |
| Amount / currency | not verified | [RT] I2 (FIN-17) |
| Tenant / resource binding | **from the unsigned `merchant_order_id`**. [RT] W5: a payload signed for tenant A's transaction, re-addressed to tenant B with `token: attacker_junk_token`, was accepted (200); tenant B → `ACTIVE`, card token replaced; tenant A unchanged. W6: three signed declines re-addressed to tenant C → C `PAST_DUE`, `failed_attempts 3` (14 → `CANCELLED`) | [RT] (HSEC-21) |
| Can an attacker obtain a signed payload? | Paymob's **Response callback** (the browser redirect) carries the same signed field set plus `hmac` to the payer's browser [DOC: "For the Response (GET) callback, obj.id becomes id and order.id becomes order_id"]. The payer of a checkout therefore holds a valid signature for their own transaction. To be applied, the re-addressed POST must arrive **before** Paymob's processed callback records that tx id. That race is not verified against Paymob | [DOC] → **L6-03** (LIKELY) |
| Event ordering | §5 | [RT] |
| State-transition validation | none (success from any state, DB-25; F2) | [RT] |
| `type` dispatch | none: a `TOKEN`-type callback is verified against the transaction field list and rejected (401) [RT W7]. If Paymob delivers card tokens through that callback type [DOC: card-token objects are delivered to the notification/processed callback URL], tokens are never stored → **INT-04** | [RT][DOC] |
| Failure responses | handler exception → 500 → Paymob re-delivery (policy U6-03); a malformed body (no `obj`) → 500 instead of 400 [RT W7]; signed tx without `order` → 200 no-op | [RT] |
| Sensitive payload logging | none: only `HMAC verification failed` (no payload); Prisma prints expected P2002 as `prisma:error` with the model name, no values | [RT] |

---

## 14. External Operation / Database Ordering

| Integration | DB read → | external request → | outcome → | DB write → | retry / reconciliation |
|---|---|---|---|---|---|
| Paymob token charge | due list (stale) | order + key + **charge** | success / failure / **exception** | attempt + sub (after) | whole-cycle retry, new identity |
| Paymob checkout | sub (price) | order + key | iframe URL | none | n/a |
| Paymob webhook | sub by tenant | — | signed payload | attempt + sub | provider re-delivery |
| ETA | invoice + settings + items | token + submit | 202 accepted / rejected / exception | `submitted` (before), then result (after) | job retry; no inquiry |
| Resend | caller rows | send | **ignored** | dedupe/audit (after, unconditionally) | none |
| R2 | customer | none (presign) | — | document row (before the client's upload) | none |

| Failure | Paymob | ETA | Resend | R2 |
|---|---|---|---|---|
| External succeeds, DB write fails | **re-charge on retry** (BG-01, [RT5] X3) | resubmit → 422 → `failed` while accepted (INT-03) | reminder row missing → duplicate email next run | n/a |
| DB write succeeds, external fails | n/a (the write follows the call) | `submitted`/`failed` + retry | **reminder marked sent, never delivered** (BG-05) | **row points to a missing object** |
| Result unknown | treated as transient → re-charge | treated as failed → resubmit | treated as success | — |
| Duplicate request while processing | two jobs: guarded by `withLock` until TTL (H1 ✓ / H2 ✗); checkout + job: unguarded (G ✗) | two jobs run in parallel (INV-DUP ✗) | cron + manual route in parallel ([RT5] R3 ✗) | — |
| Cancellation while the request is pending | charge proceeds; success reactivates (F2, [RT5] S-D1/D2/D3) | cancelled invoice submitted (INV-CANCELLED) | reminder for a paid installment ([RT5] R4) | — |

**Is a transactional outbox warranted?**
- **No for Paymob.** The defect is not "DB commit then enqueue" but "external commit with no prior intent". The fix is intent-first ordering with inquiry-based resolution (§6).
- **No for ETA.** The fix is a claimed status transition plus a per-invoice job id and inquiry.
- **No for Resend.** Write the dedupe row conditionally and check the result. An outbox would be optional, not required.
- **No for R2.** Create the row after the upload is confirmed (or verify it on read).

---

## 15. Tenant Isolation

| Integration | Tenant identity obtained from | Trusted? | Credentials | Provider resource → tenant | Wrong-tenant callback possible? | Storage-key ownership | Job context | Logs expose other tenants? |
|---|---|---|---|---|---|---|---|---|
| Paymob checkout | `request.tenant.id` (server) | yes | platform-wide (one merchant account) | `merchant_order_id` string | — | — | — | no |
| Paymob jobs | subscription row | yes | platform-wide | builds `sub_<tenant>_…` itself | — | — | master DB only | sub ids only |
| Paymob webhook | **unsigned `merchant_order_id`** | **no** | platform HMAC secret | parsed string | **yes** ([RT] W5/W6; HSEC-21; precondition L6-03) | — | — | no |
| ETA | `request.tenant.schemaName` → job payload | yes at the producer; **the worker does not validate `schemaName` against `tenantId`** (L5-02) | **per-tenant** OAuth creds (encrypted) | `internalId` = invoice number (not globally unique; ETA scopes it per taxpayer [ASM]) | n/a (no callbacks) | — | payload | no |
| Resend | caller | yes | platform-wide API key, platform sender | — | — | — | the reminder job iterates all tenants; **a tenant user can trigger it for all tenants** (HSEC-05, re-confirmed [RT5] R1) | the reminder route returns platform-wide counts (HSEC-05) |
| R2 | `request.params.id` within `request.tenantDb` | yes | platform-wide keys, one bucket | key → `customer_documents` row in the tenant schema | — | **no tenant prefix**; UUID-unguessable keys; the download route only presigns the caller's own rows | — | no |
| GA4 | — | — | one measurement id | page URLs incl. the subdomain (tenant name) | — | — | — | GA receives tenant subdomains and, on billing redirects, tenant ids inside `merchant_order_id` (L6-02) |

**Previous tenant-isolation findings, re-checked:**
- **HSEC-05:** confirmed (Phase 5 runtime).
- **HSEC-21:** confirmed at runtime as a mechanism.
- **HSEC-29:** no tenant prefix; corrected on content-type pinning.
- **AU-02 / HSEC-01:** unchanged, not integration-specific.

---

## 16. Secrets and Configuration

| Variable (names only) | Validation (`config/env.ts`) | Missing behaviour | Evidence |
|---|---|---|---|
| `PAYMOB_API_KEY` | optional | `api_key: undefined` sent to `/auth/tokens` → Paymob error → checkout 500; **every renewal/dunning cycle fails "transiently" and is retried ×3 daily**, silently | [SC] |
| `PAYMOB_HMAC_SECRET` | optional; prod **warning** only | webhook fails closed (401 for everything) → payments never recorded → all checkouts lost | [SC] `env.ts:70-77`; `paymob.webhook.ts:15-16` |
| `PAYMOB_INTEGRATION_ID_CARD` / `_WALLET` / `PAYMOB_IFRAME_ID` | optional | `integration_id: undefined` / broken iframe URL; `_WALLET` unused | [SC] |
| `PAYMOB_BASE_URL` | default `https://accept.paymob.com/api` | — but the iframe host ignores it (INT-08) | [RT] P0 |
| `RESEND_API_KEY` / `EMAIL_FROM` | optional | **dev fallback in any `NODE_ENV`**: reset links and reminder PII printed to stdout (HSEC-25) | [SC] `email.ts:136, 232, 267, 320` |
| `R2_*` | optional | 503 `storage_unavailable` | [SC] |
| `ETA_PREPROD_BASE_URL` / `ETA_PROD_BASE_URL` | defaults to the real ETA hosts | — | [SC] |
| `ETA_ENCRYPTION_KEY` | optional | **unused anywhere** | grep |
| `APP_ENCRYPTION_KEY` | optional; prod warning if `length < 32` **characters** | ETA credentials cannot be saved (503) or decrypted. A base64 key shorter than 32 **bytes** passes the warning and then fails at `createCipheriv` ("Invalid key length"). **No key version in the ciphertext** (`iv:tag:data`, `encryption.ts:15-22`): rotating the key silently breaks every tenant's stored ETA credentials (the test route then says "re-enter"); no re-encryption path | [SC] |
| `SENTRY_DSN` | read directly | inert (package missing) | [SC] |
| `VITE_GA_MEASUREMENT_ID` (web build) | — | GA off | [SC] |

**Further checks:**
- **Secrets in source control:** none. `.env` is git-ignored and never committed (`git log --all -- .env` empty). `.env.example` holds empty placeholders (all secret values have length 2 = `""`). `apps/web/.env.production` contains only `VITE_BASE_DOMAIN`.
- **Secrets in responses:** ETA credentials masked ✓ (`index.ts:258-272, 326-335`). The Paymob card token is returned by `/billing/portal` to every tenant user (HSEC-04, unchanged). No API key echoed.
- **Environment separation:**
  - Paymob test vs live is decided only by which key and integration ids are configured; there is no runtime guard.
  - The ETA environment is per tenant, but the worker reads a non-existent column, the test route reads the real one, and the API cannot set it (E-07, §8.4).
- **Redaction:** Fastify redacts `authorization`, `cookie` and `set-cookie` (`index.ts:47-53`); production log level `warn`.

---

## 17. Logging and Observability

| Integration | Internal op id | Tenant id | Provider id | Attempt # | Outcome | Error category | Duration | Reconciliation status | Leaks |
|---|---|---|---|---|---|---|---|---|---|
| Paymob jobs | ✗ (no intent id) | ✗ (sub id only, on error) | ✗ in logs (tx id only in DB rows) | ✗ | cycle summary (renewal only) | raw error message (`fetch failed`, `504 …`, `SyntaxError`) | ✗ | ✗ (none exists) | the Paymob error text is logged verbatim (`renewal.job.ts:163`); bodies of error responses could contain request echoes [ASM]; no secrets seen in the mock runs |
| Paymob webhook | ✗ | ✗ | ✗ | ✗ | ✗ (only HMAC failures warn) | ✗ | ✗ | ✗ | expected P2002 → `prisma:error` noise |
| ETA | invoice id (final failure only) | ✗ | `eta_uuid` in DB; **`submission_id` always null** | `attempt_number` in DB | `eta_status` (often wrong, §8.3) | `eta_error` JSON (ETA's message) | ✗ | ✗ | `eta_submissions.request_payload` stores the full document (taxpayer data; expected); the test route logs `err` with ETA's response text |
| Resend | ✗ | schema name (reminders) | ✗ (message id discarded) | ✗ | **misleading** (`sent` counts failures) | ✗ (never surfaced) | ✗ | ✗ | the dev fallback prints reset links / PII (HSEC-25) |
| R2 | ✗ | — | — | — | — | — | — | — | none |

**Conclusions:**
- No integration can answer "what did we ask the provider to do, and what happened?" from Hesba's own data alone.
- Payment questions require Paymob's dashboard.
- Email questions require Resend's dashboard; the message id is thrown away.
- ETA questions require ETA's portal, because `submission_id` is lost.

---

## 18. Retry and Idempotency Matrix

| Operation | Retried by | Identity across retries | Provider-side idempotency used | Local idempotency | Safe? | Required |
|---|---|---|---|---|---|---|
| Paymob token charge | BullMQ whole cycle (3×), stall recovery, next day | **new `merchant_order_id` and order each time** | none | none before the call | **No** (B, B2, J1, J2, H2, L) | intent row + deterministic `merchant_order_id` + inquiry before retry |
| Paymob checkout | user | new order per click | none | none | yes (no money until paid); but **two paid iframes = two charges** (G-like) | the intent per period refuses a second live checkout |
| Paymob webhook | Paymob re-delivery | tx id | — | `UNIQUE(provider_transaction_id)` | **Yes** (D, E) | keep; bind to the intent |
| ETA submit | BullMQ (5×), duplicate jobs | invoice number (`internalId`), but **no jobId** | ETA's 10-min payload-hash rule [DOC] | none (`eta_internal_id` UNIQUE never written) | **No** (INV-DUP, INV-LOST) | `jobId` per invoice; claim `eta_status`; `getDocumentStatus` / submission lookup before resubmitting; record `submissionUUID` |
| Resend send | none (jobs: next run; HTTP: user) | none | **`Idempotency-Key` available in the API [DOC], not supported by the installed 3.5.0 SDK option** [RT] | reminders: 24 h audit lookup (check-then-act, written regardless of the result) | **No** (loss and duplicates) | check `error`; claim-before-send row; send the `Idempotency-Key` header (SDK upgrade or raw header) |
| R2 presign | user | new UUID key each time | — | — | yes (orphans only) | confirm the upload before creating the row |

---

## 19. External Failure Matrix

| Integration / call | Success | Definite reject (4xx) | 5xx | Timeout / hang | Connection reset | Malformed 2xx | Duplicate | Knows the outcome? |
|---|---|---|---|---|---|---|---|---|
| Paymob `/payments/pay` (jobs) | recorded | retried as transient (no charge) | **re-charge** (B2) | ≈ 300 s, then **re-charge** (K) | **re-charge** (B) | **re-charge** (J1, J2) | — | **no** |
| Paymob order/key (jobs, checkout) | — | retried / 500 | retried / 500 | ≈ 300 s | retried / 500 | TypeError → retried / 500 | harmless | yes (no money) |
| Paymob webhook (inbound) | applied | 401 (bad sig) | — | — | — | 500 (no `obj`) / 200 no-op (no `order`) | no-op (D) | n/a |
| ETA `/connect/token` | — | `failed` + retry (permanent creds error retried) | `failed` + retry | ≈ 300 s, `failed` | `failed` | `failed` | — | yes (no document) |
| ETA `/documentsubmissions` | `accepted` (treated as final ✗) | 400 → `failed` + retry ✗; rejectedDocuments → `rejected` ✓ | `failed` + retry | ≈ 300 s → `failed` → resubmit | `failed` → resubmit → 422 → `failed` ✗ | stuck `submitted`, retried ✗ | 422 → `failed` ✗ | **no** |
| Resend send | (ignored) | reported as sent ✗ | reported as sent ✗ | ≈ 300 s, then reported as sent ✗ | reported as sent ✗ | a possibly accepted send reported as an error by the SDK, ignored by the app | duplicates possible | **no** |
| R2 | — | — | — | — | — | — | — | n/a (client uploads) |

---

## 20. Integration / Database Race Matrix

| Entity | HTTP / provider event | Concurrent integration operation | Race | Protection | Result |
|---|---|---|---|---|---|
| subscription | checkout success webhook | dunning token charge | stale list | none | 2 charges, 1 period ([RT] G) |
| subscription | admin cancel | late checkout webhook | success from any state | none | `ACTIVE` + `cancelled_at` ([RT] F2) |
| subscription | user cancel-at-period-end | late checkout webhook | — | — | `ACTIVE`, flag kept (F1, acceptable) |
| subscription | job's own charge | Paymob processed callback (same tx) | double record | UNIQUE tx id | 1 row ✓ ([RT] E) |
| subscription | renewal cycle A (inside a hung Paymob call) | renewal cycle B after the lock TTL | same due list | `withLock` TTL only | every sub charged twice ([RT] H2) |
| subscription | re-addressed signed webhook | the legitimate tenant's state | unsigned binding | none | foreign `ACTIVE` + token replaced / escalation ([RT] W5/W6) |
| subscription | trial expiry / admin extend | checkout webhook | stale list + unconditional write | none | [RT5] S-A, S-H |
| invoice (ETA) | cancel invoice | queued submission | status not read | none | cancelled invoice accepted at ETA ([RT] INV-CANCELLED) |
| invoice (ETA) | resubmit ×2 | two workers | no job id / claim | none | 1 accepted + 1 `failed` overwrite ([RT] INV-DUP) |
| installment payment | payment recorded | reminder email | stale list | none | reminder for a paid installment ([RT5] R4) |
| customer document | document row created | client upload never happens | row before upload | none | broken link (code) |

---

## 21. Confirmed Findings

### 21.1 Matrix

| ID | Sev. | Integration | Title | Status | Root cause | Cross-ref |
|---|---|---|---|---|---|---|
| **BG-01** (re-confirmed, refined) | **P1** | Paymob | Ambiguous charge outcomes are retried as transient and re-charged | CONFIRMED [RT] B, B2, J1, J2, K, L | RC-06 + **no outcome classification** | FIN-L1 |
| **HSEC-21** (re-confirmed) | **P1** | Paymob webhook | Signed transactions can be re-addressed (tenant + card token unsigned) | CONFIRMED mechanism [RT] W5/W6; precondition LIKELY (L6-03) | RC-06 | FIN-L2 |
| **FIN-17** (re-confirmed) | **P1** | Paymob webhook | Amount / currency / capture state never verified | CONFIRMED [RT] I2, W3 | RC-06 | FIN-P6 |
| **BG-03** (re-confirmed) | **P1** | Paymob | Stale billing state vs provider events | CONFIRMED [RT] F2, G | RC-01, RC-02 | DB-25, DB-08 |
| **L5-01** → CONFIRMED mechanism | P2 | Paymob | Overlapping cycles after the lock TTL double-charge every remaining sub | CONFIRMED [RT] H2 (TTL expiry simulated) | RC-07, RC-08 | BG-04, DB-L07 |
| **INT-01** | P2 (ETA release blocker) | ETA | Raw SQL compares UUID columns with text parameters; the resubmit route fails before enqueuing | CONFIRMED [RT] | RC-09 | E-01, DB-23, E-02 |
| **INT-02** | P2 (ETA release blocker) | ETA | The submitted document does not represent the sale | CONFIRMED [RT] (behind harness shims) | RC-03, RC-09 | FIN-05, F-05 |
| **INT-03** | P2 (ETA release blocker) | ETA | Provider outcomes misclassified; `submissionUUID` never stored; no status sync or cancellation | CONFIRMED [RT][DOC] | RC-05, RC-02 | BG-08 |
| **INT-04** | P2 (P1 if U6-01 holds) | Paymob lifecycle | An `ACTIVE` subscription without a card token never renews, expires, escalates or is blocked | CONFIRMED [RT] | RC-02 | FIN-16 |
| **INT-05** | P2 | Paymob records | Payment rows record the requested amount and a hard-coded currency, not the provider's | CONFIRMED [RT] I1, I2 | RC-06 | FIN-17 |
| **BG-05** (re-confirmed, refined) | P2 | Resend | All failure classes silent; the installed SDK cannot pass an idempotency key | CONFIRMED [RT] | IND | HSEC-06 |
| **INT-06** | P3 | R2 | Presigned upload enforces neither type nor size, embeds an empty-body checksum; one bucket for public and private data | CONFIRMED [RT] (R2-side effects LIKELY) | IND | HSEC-29 (corrected) |
| **INT-07** | P3 | Email / web | Templates: no escaping, no reply-to; reset and checkout links target non-existent routes | CONFIRMED [RT] | IND | HSEC-06, HSEC-15, AU-11 |
| **INT-08** | P3 | Paymob | Webhook robustness and environment: no `type` dispatch (token callbacks 401), malformed → 500, iframe host hard-coded | CONFIRMED [RT] | IND | — |
| **INT-09** | P3 | Config | Integration secrets unvalidated at startup; unversioned encryption key; unused `ETA_ENCRYPTION_KEY`; split ETA environment logic | CONFIRMED [SC] | RC-09 | E-07 |

### 21.2 Details

#### BG-01 (refined) — Paymob charges with ambiguous outcomes are retried as transient and charged again · **P1**

| Field | Detail |
|---|---|
| Integration | Paymob token charges |
| File / lines | `apps/api/src/jobs/renewal.job.ts:92-174` (catch `:159-164`, rethrow `:172-174`); `apps/api/src/jobs/dunning.job.ts:104-164`; `apps/api/src/modules/billing/paymob.client.ts:25-37, 118-135` |
| Function | `runRenewalCycle`, `runDunningCycle`, `paymobFetch`, `PaymobClient.chargeWithToken` |
| Trigger | renewal 07:00 / dunning 08:00 |
| Preconditions | an ACTIVE (or failing) subscription with a card token; Paymob charges, and the client then sees any non-clean response |
| Failure scenario | charge accepted → response lost / 504 / HTML 200 / 200 without `order` / ≈ 300 s timeout / process killed / DB write fails → exception → `transientFailures++` → job throws → BullMQ retry 60 s (or the next day) → new `merchant_order_id`, new order → charge again |
| Observed | [RT] each of B, B2, J1, J2: 2 gateway charges, 1 `payment_attempts` row; [RT5] X3, X5, X6 |
| Root cause | RC-06 (no intent before the call) **and**, new in Phase 6, **no outcome classification**: the client code has no notion of "unknown" and never uses the provider's inquiry API |
| Current protection | selection predicates written after the outcome; the optional Paymob callback (token charges send no `notification_url`) |
| Why insufficient | the predicates derive from the very write that failed; the callback is unconfigured per request and races the 60 s retry |
| Impact | double charges, found only by complaint (no reconciliation) |
| Remediation | §6 intent model; classify `/payments/pay` exceptions as `UNKNOWN`; resolve by Paymob transaction inquiry (by `merchant_order_id` / order id [DOC]) before any new charge; per-call timeouts (BG-04) |
| Regression test | RT6-B / RT6-C / RT6-K / RT6-L (§28) |
| Cross-refs | FIN-L1, DB-L01, FIN-P3, HSEC-27, BG-02, BG-04, L5-01 |

#### HSEC-21 (runtime confirmation) — The webhook binds a signed transaction to the tenant and card token taken from unsigned fields · **P1**

| Field | Detail |
|---|---|
| File / lines | `paymob.webhook.ts:26-47` (field list); `billing.routes.ts:39-49`; `billing.service.ts:127-132, 171` |
| Handler | `POST /api/billing/paymob/webhook` → `handleWebhookSuccess/Failure` |
| Preconditions | a signed field set for a transaction id not yet recorded. Per Paymob's docs, the browser redirect (Response callback) delivers the same signed fields and `hmac` to the payer; the race against Paymob's processed callback is UNVERIFIED (L6-03) |
| Observed | [RT] W5: same HMAC, `merchant_order_id` → tenant B, `token` → `attacker_junk_token` → 200; B `ACTIVE`, token replaced; A untouched. W6: 3 re-addressed declines → C `PAST_DUE` |
| Root cause | RC-06: no server-side intent keyed by the **signed** `order.id` |
| Current protection | HMAC over the official field list; P2002 on a recorded tx |
| Why insufficient | the tenant and the token are outside the signature [DOC] |
| Impact | payments credited to the wrong tenant; a victim's stored card token replaced (their renewals fail → escalation → cancellation); targeted escalation by declined payments |
| Remediation | resolve the intent by the signed `obj.order.id`; ignore `merchant_order_id` and `obj.token` for binding; store card tokens only from authenticated token callbacks tied to the intent's order |
| Regression test | RT6-W5 (§28) |
| Cross-refs | FIN-L2, FIN-17, Phase 2 §11 |

#### FIN-17 (runtime confirmation) — Webhook success applied regardless of amount, currency or capture state · **P1**

| Field | Detail |
|---|---|
| File / lines | `billing.service.ts:117-174`; `billing.routes.ts:42-49` |
| Observed | [RT] I2: signed 100 USD → `ACTIVE` for a full month, stored as `1 EGP`. W3: `is_auth: true, is_capture: false` → `ACTIVE` |
| Root cause | RC-06 (no expected amount to compare against) |
| Remediation | compare the signed `amount_cents`, `currency` and `integration_id` with the intent; treat auth-only as pending until capture |
| Regression test | RT6-I (§28) |
| Cross-refs | FIN-L2, FIN-P6 (POTENTIAL → mechanism CONFIRMED), INT-05 |

#### BG-03 (provider-event confirmation) · **P1**

| Field | Detail |
|---|---|
| File / lines | `billing.service.ts:158-173` (success from any state, period reset); `dunning.job.ts:74-81` (stale list); `admin.routes.ts:579-582` |
| Observed | [RT] F2: admin cancel → late webhook → `ACTIVE` with `cancelled_at` set. G: checkout webhook during dunning → 2 SUCCESS rows, 1 period |
| Remediation | as Phase 5 BG-03 plus invariant 4 of §6 |
| Regression test | RT6-F, RT6-G |

#### INT-01 — ETA raw SQL compares UUID columns with text parameters; the only ETA entry point fails before enqueuing · **P2** (ETA release blocker)

| Field | Detail |
|---|---|
| Integration | ETA |
| File / lines | `modules/eta/eta.routes.ts:16-19, 26-29, 47-50`; `jobs/eta-submission.job.ts:70-81, 92-95, 113-116, 120-128, 169-172, 186-190, 193-195, 216-219`; `modules/eta/eta.submit.ts:43-46, 64-99` |
| Function | `POST /admin/eta/resubmit/:invoiceId`, `GET /invoices/:invoiceId/eta-submissions`, the ETA worker, `submitInvoiceToEta` |
| Trigger | any resubmit or worker run |
| Preconditions | none (the schema has UUID primary keys) |
| Failure scenario | `$queryRawUnsafe/$executeRawUnsafe` bind the JS string as `text` → `WHERE id = $1` (uuid) → `42883 operator does not exist: uuid = text` |
| Observed | [RT] all four statements tested → `42883`; with only DB-23's columns added, every job failed with `42883` |
| Root cause | RC-09: untyped raw SQL, no test that executes it against a migrated schema; the cast idiom used elsewhere (`invoice.service.ts:413, 718`) was not applied |
| Current protection | none (`tsc` cannot see SQL; the parity test checks table names only) |
| Why insufficient | — |
| Impact | ETA is unreachable at its entry point (a 500 before enqueue), independent of DB-23. Fixing DB-23 alone would not make ETA work |
| Remediation | parameter casts (`$1::uuid`) or Prisma model calls; a CI step that executes every raw statement against a migrated schema |
| Regression test | RT6-ETA1 |
| Cross-refs | E-01, DB-23, E-02, DB-33 (same pattern in the statement export) |

#### INT-02 — The ETA document does not represent the sale · **P2** (ETA release blocker)

| Field | Detail |
|---|---|
| File / lines | `jobs/eta-submission.job.ts:120-167` (item query + mapping); `modules/eta/eta.payload.ts:8-113`; `modules/eta/eta.submit.ts:52-58`; `modules/eta/eta.signer.ts:1-63` |
| Trigger | any submission (once INT-01/DB-23 are fixed) |
| Failure scenario | service lines dropped by the inner JOIN; line and invoice discounts not passed; tax recomputed from the rate; no branch id in the issuer address (settings branch code ignored); no receiver; internal SKU as `itemCode`; unsigned without a PEM; non-ETA canonicalisation with one |
| Observed | [RT] (behind the throwaway column patch + cast shim): 1 of 2 lines, `totalAmount 228` vs invoice `252.20`, `discount.amount 0` vs 20, no signatures, no `address.branchID`, top-level `branchId '0'` vs settings `7` |
| Root cause | RC-03/RC-09: the tax document is rebuilt from a partial projection of the invoice instead of from the recorded financial effects; the provider schema is not modelled or validated |
| Current protection | none |
| Impact | VAT and sales misreported to the tax authority; documents likely rejected (signature, item codes, branch) [ASM, U6-06] |
| Remediation | build the document from stored line `subtotal`, `discount_amount`, `tax_amount` and invoice-level discounts (allocated per line); include service lines; pass branch and receiver; validate against ETA's JSON schema in tests; real CAdES-BES signing before production |
| Regression test | RT6-ETA2 (golden document vs stored invoice totals) |
| Cross-refs | FIN-05 (client prices flow into tax documents), FIN-02, F-05 |

#### INT-03 — ETA outcomes are misclassified and never reconciled · **P2** (ETA release blocker)

| Field | Detail |
|---|---|
| File / lines | `eta.submit.ts:60-106`; `eta-submission.job.ts:169-222`; `eta.client.ts:56-83` |
| Observed | [RT] 422 DuplicateSubmission (after an accepted submission, or from a concurrent duplicate job) → `failed` while ETA holds the document (INV-DUP, INV-LOST); malformed 200 → `TypeError` outside the try → stuck `submitted` (INV-MAL); 400 retried 5× (INV-BAD); `eta_error` not cleared on later success (INV-AUTH); `submission_id` always null because ETA returns `submissionUUID` [DOC] and the code reads `submissionId` |
| Root cause | RC-05 / RC-02: no submission identity or claim; `eta_status` is written, not used as a state machine; the 202 semantics ("validation is not complete") [DOC] are not modelled |
| Impact | Hesba's ETA status cannot be trusted; operators would resubmit "failed" documents that ETA already holds; asynchronously invalidated documents stay `accepted` |
| Remediation | treat 422 DuplicateSubmission as "possibly accepted → look up"; store `submissionUUID`; poll submission / document status after 202; `UnrecoverableError` for 4xx; clear `eta_error` on success; ETA cancellation on invoice cancel/return |
| Regression test | RT6-ETA3 |
| Cross-refs | BG-08, F-05 |

#### INT-04 — An ACTIVE subscription without a card token is never renewed, expired, escalated or blocked · **P2** (P1 if U6-01)

| Field | Detail |
|---|---|
| Integration | Paymob lifecycle |
| File / lines | `renewal.job.ts:76-85` (requires `providerCardToken`); `dunning.job.ts:74-81` (requires card + `failed_attempts > 0`); `trial-expiry.job.ts:115-118` (`TRIALING` only); `tenant.middleware.ts:103` (blocks `SUSPENDED`/`CANCELLED` only); `billing.service.ts:171` (`providerCardToken: cardToken`, `undefined` → unchanged); `billing.routes.ts:46` (`obj.token`) |
| Preconditions | (a) a checkout success whose callback has no `obj.token`, **or** (b) an admin reactivation of a cardless sub (every trial-expired sub is cardless) |
| Observed | [RT] both cases: after the period end, all three jobs ran → `ACTIVE`, `card null`, `failed 0`, **0 gateway calls** |
| Root cause | RC-02: expiry is implemented only as a side effect of charging; no "period ended unpaid" transition exists |
| Current protection | none |
| Impact | indefinite free service after the first paid month (case a affects **every** customer if Paymob delivers tokens only via the separate token callback, which Hesba rejects: INT-08, U6-01) |
| Remediation | a lifecycle job: `ACTIVE ∧ period_end < now − grace ∧ no successful charge for the period` → `PAST_DUE` (with checkout link) → enforcement; accept and store token callbacks |
| Regression test | RT6-T (§28) |
| Cross-refs | FIN-16 (the same root cause for `PAST_DUE`), HSEC-08 |

#### INT-05 — Payment rows record what Hesba asked for, not what Paymob reported · **P2**

| Field | Detail |
|---|---|
| File / lines | `renewal.job.ts:137-143`, `dunning.job.ts:138-144` (pass the local `amountCents`); `billing.service.ts:150-151, 230-231` (`currency: 'EGP'` constant) |
| Observed | [RT] I1: provider answered 100 USD → row `300 EGP`. I2: webhook 100 USD → row `1 EGP` |
| Root cause | RC-06 |
| Impact | `payment_attempts` cannot be used for reconciliation, revenue or disputes; currency errors are invisible |
| Remediation | persist the provider's signed `amount_cents` and `currency` alongside the expected values; reject mismatches |
| Regression test | RT6-I |
| Cross-refs | FIN-17 |

#### BG-05 (refined) — Resend failures are silent · **P2**

| Field | Detail |
|---|---|
| File / lines | `shared/utils/email.ts:142, 238, 304, 327`; callers `installment-reminders.job.ts:135-158`, `trial-expiry.job.ts:88-110`, `invoice.routes.ts:214-248`, `auth.service.ts:150` |
| Observed | [RT] SDK 3.5.0: 500, 429, 422, reset and HTML-200 all resolve `{data:null, error}`; all four helpers resolve `undefined`; `idempotencyKey` is not forwarded |
| Refinement | Phase 5 showed 500. Phase 6 shows **every** failure class, a **false error** on a garbled 200, and that this SDK version cannot attach an idempotency key |
| Remediation | check `error` (throw or return a status), classify 429/5xx as retryable; write dedupe rows after a confirmed id; upgrade the SDK or send the `Idempotency-Key` header [DOC]; keep the message id |
| Regression test | RT6-M |

#### INT-06 — R2 presigned uploads enforce neither type nor size, embed an empty-body checksum; one bucket for public and private data · **P3**

| Field | Detail |
|---|---|
| File / lines | `config/r2.ts:5-33`; `customer.routes.ts:161-208`; `product.routes.ts:46-68` |
| Observed | [RT] `X-Amz-SignedHeaders=host`; no content-length condition; `x-amz-checksum-crc32=AAAAAA==` (crc32 of empty); 0 outbound calls |
| Root cause | SDK defaults accepted unexamined; storage privacy designed per route rather than per bucket |
| Impact | latent (no UI caller): arbitrary content types and sizes under a `.pdf`/`.png` key; uploads LIKELY rejected by R2 (L6-04); the privacy of national-ID scans depends on a bucket setting that would break product images |
| Remediation | sign `content-type` (`signableHeaders`) and a length bound (or use a presigned POST with conditions); `requestChecksumCalculation: 'WHEN_REQUIRED'` per Cloudflare guidance; separate public/private buckets; tenant-prefixed keys; create the DB row on confirmation |
| Regression test | RT6-R2 (presign-shape unit test) |
| Cross-refs | HSEC-29 (corrected, §25) |

#### INT-07 — Email templates: no escaping, no reply-to, links to non-existent routes · **P3**

| Field | Detail |
|---|---|
| File / lines | `email.ts:11-130` (billing templates), `:172-226` (receipt), `:261-310` (reminder), `:312-339` (reset → `/reset`); `trial-expiry.job.ts:51-56` (`/billing/checkout`) |
| Observed | [RT] markup embedded raw in 3 templates; no `reply_to`; the reset link path is `/reset?token=…` (the SPA route is `/reset-password`, `App.tsx:73`) |
| Remediation | escape every interpolation; set `reply_to` to the tenant's address for tenant-facing mail; fix the link paths |
| Cross-refs | HSEC-06, HSEC-15, AU-11 |

#### INT-08 — Paymob webhook robustness and environment consistency · **P3**

| Field | Detail |
|---|---|
| File / lines | `billing.routes.ts:28-60`; `paymob.webhook.ts:19-47`; `paymob.client.ts:114` |
| Observed | [RT] `TOKEN`-type callback → 401; body without `obj` → 500; iframe host `accept.paymob.com` while the API base was loopback |
| Impact | card-token callbacks (if Paymob uses them for this integration) are rejected, which feeds INT-04; malformed requests cause provider retries; checkout breaks in any non-default Paymob region or environment |
| Remediation | dispatch on `type`, verify each callback type with its own documented field list; 400 on a malformed body; derive the iframe host from config |

#### INT-09 — Integration configuration and secret handling · **P3**

| Field | Detail |
|---|---|
| File / lines | `config/env.ts:7-77`; `shared/utils/encryption.ts:7-34`; `jobs/eta-submission.job.ts:74`; `index.ts:400` |
| Observed | [SC] all integration secrets optional; prod warns for two only; a missing `PAYMOB_API_KEY` turns every billing cycle into silent "transient" failures; the ciphertext carries no key version; `ETA_ENCRYPTION_KEY` unused; the worker vs the test route choose the ETA environment from different columns |
| Remediation | fail fast at boot in production when a feature's secrets are partially configured; key-versioned ciphertext with rotation support; a single source for the ETA environment, writable by an authorized role |
| Cross-refs | E-07, HSEC-01 |

---

## 22. Likely Findings

| ID | Sev. | Finding | Basis |
|---|---|---|---|
| **L6-01** | P2 | Token charges run under the 3-DS checkout integration (`PAYMOB_INTEGRATION_ID_CARD`) with no `notification_url`. Paymob documents a **separate recurring integration id** for saved-card charges [DOC], so recurring charges LIKELY fail or come back `pending`; Hesba then counts them as declines (FIN-L3) and escalates paying customers | [RT] P0 (`integration_id 11` for both); [DOC] |
| **L6-02** | P3 | Paymob's redirect lands on `FRONTEND_URL/settings?tab=billing` with the Response-callback query (signed fields incl. masked PAN, amount, order ids, `merchant_order_id` with the tenant id, `hmac`) [DOC]; `RouteBoundary` sends `pathname + search` to GA4 when GA is enabled. Whether the page view fires before the auth guard redirects is not verified | [SC][DOC] |
| **L6-03** | P1 (HSEC-21 precondition) | The payer receives a signed field set for their own transaction in the redirect [DOC] and can POST it re-addressed before Paymob's processed callback is recorded | [DOC][RT] W5 |
| **L6-04** | P3 | Presigned R2 uploads rejected because of the SDK's default CRC32 of an empty body | [RT][DOC] |
| **L6-05** | P3 | An ETA document accepted but recorded `failed` is resubmitted by attempt 4 (≈ 12.5 min, outside ETA's 10-min duplicate window) | [RT] timing + [DOC] window; ETA outcome U6-05 |
| **L5-02** (prior) | P3 | The ETA worker trusts `schemaName` from the job payload | [SC] |
| **FIN-L3** (prior) | P2 | `pending: true` token charges counted as declines; with L6-01 this may be the common case | [SC][RT] W4 shows the webhook treats pending as a no-op, the job as a failure |

---

## 23. Potential Findings

| ID | Sev. | Finding |
|---|---|---|
| **P6-P01** | P3 | A malformed webhook returns 500, so Paymob re-delivers repeatedly (the retry policy is undocumented in the sources found, U6-03) |
| **P6-P02** | P2 | ETA invalidates a document asynchronously after a 202; Hesba keeps `accepted` forever (no status polling) |
| **P6-P03** | P3 | Rotating `APP_ENCRYPTION_KEY` silently breaks every tenant's ETA credentials (no key id in the ciphertext) |
| **P6-P04** | P3 | If server-side S3 calls are ever added, the SDK's default handler has no request timeout configured in `r2.ts` |
| **P6-P05** | P3 | Two subscriptions for one tenant: webhook `findFirst` without `orderBy` attaches the payment to an arbitrary row (FIN-P4 / P5-P02) |
| **P6-P06** | P3 | A successful send through a proxy that returns a non-JSON 200 is reported by the SDK as an error. Harmless today (the app ignores errors), but **wrong if BG-05 is fixed naïvely by retrying on every error**, which would cause duplicate emails |

---

## 24. Unverified Items

| ID | Item | Why it matters | How to verify safely |
|---|---|---|---|
| **U6-01** | Whether Paymob's **transaction processed callback** contains `obj.token` for card-saving checkouts, or delivers the token only via a separate card-token callback | decides whether INT-04 affects every customer (→ P1) and whether renewals ever run | Paymob sandbox with a test card and a callback URL pointing at a local tunnel to a throwaway server |
| **U6-02** | Paymob's response to a token charge under a non-recurring integration (decline, error, or 3-DS `pending`) | L6-01, FIN-L3 | Paymob sandbox |
| **U6-03** | Paymob processed-callback retry policy on non-2xx | P6-P01; BG-01 rescue window | Paymob documentation / support |
| **U6-04** | Availability of `transaction_inquiry` (by `merchant_order_id`) on `accept.paymob.com` (documented on Paymob's Oman docs) | the remediation for BG-01 | Paymob Egypt API reference / sandbox |
| **U6-05** | ETA behaviour for an identical resubmission **after** the 10-minute window (new document vs uuid conflict) | L6-05 | ETA preprod with synthetic data |
| **U6-06** | ETA acceptance of the current payload (unsigned / RSA over sorted JSON, SKU item codes, missing `branchID`) | INT-02 severity in practice | ETA preprod with synthetic data and a test certificate |
| **U6-07** | R2 bucket public/private setting, CORS, CRC32 support | INT-06, L6-04 | Cloudflare dashboard (read-only) |
| **U6-08** | Production values: is `RESEND_API_KEY` set (else the dev fallback logs links), is GA enabled, which Paymob integration ids are configured | HSEC-25, L6-01, L6-02 | ops |
| **U6-09** | Resend account rate limits and bounce handling | BG-05 impact | Resend dashboard |
| **U6-10** | Whether the **production** tenant schemas have the ETA columns the code expects (out-of-band DDL) | DB-23 / INT-01 live status (INT-01 fails regardless of columns) | read-only `information_schema` query |

---

## 25. Cross-Phase Verification

| Finding | Phase 6 verdict | Change |
|---|---|---|
| **BG-01** | **Confirms and refines.** New runtime cases: 504, HTML 200, 200 missing fields, slow responses. **Refined root cause:** RC-06 plus the absence of any outcome classification ("unknown") and of the provider's inquiry API | severity unchanged (P1) |
| **BG-02** | not re-tested (no code change); Phase 5 X5/X6 stand. Confirmed as the trigger of scenario L | unchanged |
| **BG-03** | **Confirms** with provider events: F2 (late webhook reactivates an admin-cancelled sub), G (checkout during dunning → 2 charges) | unchanged (P1) |
| **BG-04** | **Confirms**: no `AbortSignal` anywhere; the slow provider was waited out (K); 300 s undici bound (X9) | unchanged (P2) |
| **BG-05** | **Confirms and refines** (§9): all failure classes; a false error on a garbled 200; no idempotency support in 3.5.0. Verified on the exact installed version only | unchanged (P2) |
| **HSEC-05** | Not re-run; Phase 5 R1/R3 stand (the cross-tenant reminder trigger) | unchanged (P1) |
| **DB-01** | Not integration-related (no integration reads or writes pending installment invoices). ETA would report such invoices if enqueued, but nothing enqueues them | unchanged (P0) |
| **DB-08** | Confirmed again via G (dunning charges a period paid interactively) | unchanged (P1) |
| **FIN-04** | Not integration-related | unchanged |
| **FIN-05** | **Extends**: the client-supplied `unit_price` flows unchanged into the ETA tax document (INT-02) | unchanged (P0); new impact noted |
| **FIN-06** | Not integration-related (POS payment-method fees, not Paymob) | unchanged |
| **FIN-16** | **Root cause widened**: not only cardless `PAST_DUE` but also cardless `ACTIVE` never escalates (INT-04). Same root cause (RC-02: expiry only as a side effect of charging) | unchanged (P1) |
| **FIN-17** | **Confirmed at runtime** (I2; W3 auth-only) | unchanged (P1) |
| **FIN-L1** | already CONFIRMED in Phase 5; more cases here | — |
| **FIN-L3** | Strengthened by L6-01 | stays LIKELY (P2) |
| **FIN-P6** (auth-only treated as paid) | **Mechanism CONFIRMED** (W3); the precondition (an auth/capture integration) is a deployment fact | POTENTIAL → CONFIRMED mechanism |
| **B-03** (refund/void no-op) | **Confirmed at runtime** (W1, W2) | unchanged |
| **DB-25** | Confirmed again (F2) | unchanged |
| **DB-P01** | Not re-tested | unchanged |
| **L5-01** | **Mechanism CONFIRMED** (H2, TTL expiry simulated): every remaining sub charged twice | LIKELY → CONFIRMED (P2) |
| **ETA schema / configuration (E-01, DB-23, E-02, E-07)** | E-01/DB-23 **re-verified unchanged** against the current migrations. **New independent blocker INT-01** (uuid = text) at the entry route. E-02 confirmed. E-07 extended: the worker and the test route read different environment columns | DB-23 unchanged; INT-01 added |
| **BG-08** | Confirmed beyond the schema blockers (INV-DUP, INV-CANCELLED, INV-BAD) and refined by INT-03 | unchanged (P2) |
| **Payment webhook tenant binding (HSEC-21)** | **Mechanism CONFIRMED at runtime** (W5/W6); official docs confirm `merchant_order_id`/`token` are unsigned and that payers receive signed fields in the redirect; the race precondition remains LIKELY (L6-03) | unchanged (P1); exploitability evidence strengthened |
| **HSEC-06** | Confirmed at runtime in 3 templates (INT-07) | unchanged |
| **HSEC-15 / AU-11** | Confirmed: the emailed path is `/reset?token=…` | unchanged |
| **HSEC-25** | Extended by L6-02 (Paymob redirect parameters) | unchanged |
| **HSEC-29** | **Corrected**: Phase 2 §14 said "content type pinned in the signature". The installed SDK signs **only `host`** ([RT]). Size is unbounded as stated; the empty-body checksum and the bucket-privacy conflict are added (INT-06) | **correction recorded**; severity unchanged (P3) |
| **Missing durable payment record per period** | Confirmed as the enabler of BG-01, BG-03 (charge halves), HSEC-21, FIN-17, INT-05, L5-01. §6 gives the minimum model and invariants | — |

---

## 26. Root-Cause Clusters

| Cluster | Root cause | Integrations | Findings | Financial | Security |
|---|---|---|---|---|---|
| **C1** | **No payment intent and no outcome model** (RC-06): charges are not recorded before they happen; unknown outcomes are not a state; provider results are not verified against expectations | Paymob | BG-01, BG-03 (charge halves), HSEC-21, FIN-17, INT-05, L5-01, L6-01, FIN-L3, FIN-P6, B-03 | **H**: double charges, wrong-tenant credit, under-payment accepted | **M**: cross-tenant state change |
| **C2** | **Unbounded, unclassified external calls** (RC-08): no timeouts, every exception = "transient" | Paymob, ETA, Resend | BG-04, BG-01 (trigger), INT-03 (part), BG-02 (trigger) | M | — |
| **C3** | **Untyped contracts with the database and providers** (RC-09): raw SQL never executed in CI; provider field names and schemas assumed | ETA | INT-01, DB-23, INT-03 (`submissionUUID`), INT-02 (schema), E-07, INT-09 (env split) | M (tax) | — |
| **C4** | **Lifecycle transitions only as side effects** (RC-02): expiry depends on charging; success applies from any state | Paymob | INT-04, FIN-16, DB-25, BG-03 (overwrite halves) | **H**: unpaid service | — |
| **C5** | **Tax document derived from a partial projection** (RC-03): the ETA document is not built from recorded line effects | ETA | INT-02, FIN-05 (propagation), F-05 | M (tax) | — |
| **C6** | **Email results ignored, content unescaped** (IND) | Resend | BG-05, INT-07, HSEC-06, HSEC-15, HSEC-25 | L | M (relay/phishing) |
| **C7** | **Storage controls left to SDK defaults and bucket settings** (IND) | R2 | INT-06, HSEC-29 | — | L–M (ID documents) |

---

## 27. Remediation Priority

**Release blockers** (money or cross-tenant state):

| P | Cluster | Change | Closes | Depends on | Regression tests |
|---|---|---|---|---|---|
| 1 | C1 | **Charge intent table + deterministic `merchant_order_id` + `UNKNOWN` state + inquiry before retry** (§6) | BG-01, L5-01, INT-05, BG-03 charge halves | Paymob inquiry endpoint availability (U6-04) | RT6-B, RT6-C, RT6-G, RT6-H2, RT6-K, RT6-L, RT6-I |
| 2 | C1 | **Webhook binds by the signed `order.id` to the intent; verify amount, currency, integration id, capture; ignore unsigned fields** | HSEC-21, FIN-17, FIN-L2, FIN-P6 | P1 | RT6-W5, RT6-I |
| 3 | C4 | **Explicit "period ended unpaid" transition and enforcement independent of the card token**; success only from allowed states, extend from `max(now, period_end)` | INT-04, FIN-16, DB-25, BG-03 overwrite halves | P1 (to know "paid for period") | RT6-T, RT6-F |
| 4 | C2 | **Per-call timeouts (`AbortSignal.timeout`)**; a timeout on pay = `UNKNOWN` | BG-04 | P1 | RT6-K |
| 5 | C6 | **Check Resend results; claim-before-send dedupe; idempotency key (SDK upgrade or raw header)** | BG-05 | — | RT6-M |
| 6 | C1 | **Confirm the recurring integration id with Paymob; send `notification_url` on token charges** | L6-01, FIN-L3 | U6-02 | sandbox check |

**Before enabling ETA** (not a release blocker while ETA is not offered):

| P | Cluster | Change | Closes | Tests |
|---|---|---|---|---|
| E1 | C3 | `::uuid` casts or Prisma calls; fix DB-23 columns; execute every raw statement in CI against a migrated schema | INT-01, DB-23 | RT6-ETA1 |
| E2 | C5 | Build the document from stored line effects incl. services and allocated discounts; branch, receiver, item codes; JSON-schema validation; real CAdES-BES signing | INT-02 | RT6-ETA2 |
| E3 | C3/C1 | Submission identity: `jobId` per invoice, claimed status, `submissionUUID` stored, 422-duplicate → lookup, status polling, `UnrecoverableError` for 4xx, cancellation / credit notes | INT-03, BG-08, L6-05 | RT6-ETA3 |

**Can follow later:**

| P | Cluster | Change | Closes |
|---|---|---|---|
| L1 | C6 | Escape templates; `reply_to`; correct link paths; remove the stdout fallback outside development | INT-07, HSEC-06, HSEC-15, HSEC-25 |
| L2 | — | Strip query strings from GA page views (or allowlist params) | HSEC-25, L6-02 |
| L3 | C7 | Before shipping an upload UI: signed content-type + size bound, `WHEN_REQUIRED` checksums, separate private bucket, tenant prefix, confirm-then-record | INT-06, HSEC-29, L6-04 |
| L4 | — | Webhook `type` dispatch, 400 on malformed bodies, configurable iframe host | INT-08 |
| L5 | C3 | Startup validation per feature, key-versioned encryption, a single ETA environment source | INT-09 |
| L6 | C1 | A reconciliation job over the intent table; structured integration logging (intent id, provider id, attempt, outcome class, duration) | BG-11, §17 |

---

## 28. Regression Test Plan

**Environment for every test:**
- Disposable PostgreSQL and Redis on loopback, with a guard that refuses non-loopback `DATABASE_MASTER_URL` / `REDIS_URL`.
- Every provider replaced by a loopback mock.
- `globalThis.fetch` wrapped to throw for non-loopback hosts.
- All `.env` keys overridden.
- Real application modules: workers via BullMQ, webhook via `fastify.inject` on `billingWebhookRoutes`.
- Assertions are on durable outcomes: provider-side charge or submission counts recorded by the mock, DB rows, subscription columns.

| Test | Covers | Arrange | Act | Assert (fails today) |
|---|---|---|---|---|
| **RT6-B** | BG-01 | ACTIVE sub, period ended, token; the mock charges and then (a) resets, (b) returns 504, (c) returns HTML 200, (d) returns 200 without `order` | run the renewal job with its default attempts; wait for the retry (60 s) | exactly **1** charge recorded by the mock; 1 SUCCESS row (today: 2 charges) |
| **RT6-C** | BG-01 | as above; after the charge, block DB connections for 5 s | same | 1 charge (today: 2) |
| **RT6-K** | BG-04, BG-01 | mock `hang` on pay | run renewal | the job finishes within the configured timeout; the intent is `UNKNOWN`; **no** second charge on the next run before resolution |
| **RT6-L** | BG-01, BG-02 | the worker in a child process group; mock hangs after the charge; SIGKILL the group; restart | the next tick | 1 charge; the stalled job resumes the remaining subs on recovery |
| **RT6-G** | BG-03 | failed renewal 4 d ago, token | at the first Paymob call of dunning, inject a signed checkout success (new tx) | 1 charge for the period (today: 2 SUCCESS rows) |
| **RT6-F** | BG-03, DB-25 | admin-cancel a sub | inject a late signed checkout success | status stays `CANCELLED`; the payment is flagged for refund |
| **RT6-H2** | L5-01 | 3 due subs, 2 workers | delete the lock key during the first charge and enqueue a second job | 1 charge per sub (today: 2) |
| **RT6-I** | FIN-17, INT-05 | (a) mock pay returns 100 USD; (b) signed webhook 100 USD | run / inject | rejected or flagged; the subscription is not extended; the stored row reflects the provider's amount and currency |
| **RT6-W5** | HSEC-21 | tenants A (trialing) and B (active, token `orig`) | sign A's tx, re-address `merchant_order_id` and `token` to B, inject | B unchanged (status, period, token); A resolved by the signed order id |
| **RT6-T** | INT-04 | (a) checkout success without `obj.token`; (b) admin-reactivated cardless sub; period ended + grace | run renewal, dunning, trial-expiry | sub leaves `ACTIVE` (→ `PAST_DUE` with checkout link) and is enforced |
| **RT6-M** | BG-05 | Resend mock 500 / 429 / reset | run the reminder cycle; trial reminders; receipt route | no `reminder_sent` row; counter unchanged; the route returns an error; on retry, one delivered message (idempotency key present in the request headers) |
| **RT6-ETA1** | INT-01, DB-23 | migrated throwaway tenant schema (no patches) | call the resubmit route via `inject`; run the worker | the job is enqueued; the worker reaches the ETA mock |
| **RT6-ETA2** | INT-02 | invoice with a product line (discount) + service line + invoice discount | submit to the ETA mock | document lines = invoice lines; totals equal stored `total_amount`/`tax_total`; issuer `address.branchID` = settings; schema-valid |
| **RT6-ETA3** | INT-03, BG-08 | mock: accept-then-reset; 422 duplicate; malformed 200; 400; two resubmits; cancelled invoice | run the worker | one submission per invoice; `submissionUUID` stored; the 422 duplicate is resolved as accepted via lookup; 400 not retried; cancelled invoice not submitted |
| **RT6-R2** | INT-06 | — | presign PUT | `X-Amz-SignedHeaders` includes `content-type`; a size bound is present; no `x-amz-checksum-crc32` of an empty body |
| Guards (pass today) | — | duplicate webhook (D), same-tx webhook during the job (E), two jobs with the lock held (H1), definite decline (A) | — | keep passing after the refactors |

---

## 29. Evidence Ledger

**Runtime (this phase).** Throwaway Docker PostgreSQL `hesba-p6-pg` (127.0.0.1:55434) and Redis `hesba-p6-redis` (127.0.0.1:56380), with mocks on 127.0.0.1:58080/58081/58082. Scripts lived in the session scratchpad (`phase6/`): `h6.ts` (harness, fetch guard, mocks, Paymob signer), `p6_paymob.ts`, `p6_resend.ts`, `p6_eta.ts`, `p6_uuidcast.ts`, `p6_r2.ts`, `p6_r2b.ts`, `p6_notoken.ts`, `env.sh`. Every script reported `outbound hosts contacted` = loopback mocks only.

| Ref | What ran | Key output |
|---|---|---|
| P0 | `startCheckout` + one renewal | checkout `integration_id 11`, `notification_url set true`, `merchant_order_id sub_<tenantId>_<ms>`, iframe host `accept.paymob.com`; token charge `integration_id 11`, `notification_url set false` |
| A, B, B2, J1, J2 | one renewal cycle, per-sub mock behaviour, real BullMQ retry | `failed attempt=1 renewal_cycle_partial_failure:4`; errors `fetch failed (other side closed)`, `…/payments/pay failed: 504`, `SyntaxError: Unexpected token '<'`, `TypeError: … reading 'id'`; A `FAILED:5001`; B `charges reset-after-charge#5002, success#5006`, rows `SUCCESS:5006`; B2 `#5003/#5007`; J1 `#5004/#5008`; J2 `#5005/#5009`, each 1 row |
| D | 2 concurrent + 1 sequential signed webhooks via `inject` | `[200,200,200]`, 1 row `SUCCESS:7101` |
| E | webhook for the job's tx injected inside the mock's charge | webhook 200; job insert → P2002; 1 row `SUCCESS:5010`, 1 charge |
| F1 / F2 | late signed success after a user / admin cancel | F1 `ACTIVE`, `cancelAt true`, period 2026-11-08; F2 `ACTIVE`, `cancelledAt true` |
| G | checkout webhook at dunning's first Paymob call | rows `SUCCESS:7301`, `SUCCESS:5011`; period 2026-11-08 |
| H1 / H2 | 2 workers; H2 deletes `lock:renewal-cycle` mid-charge | H1 one charge each; H2 `success#5014/#5017`, `#5015/#5018`, `#5016/#5019` |
| I1 / I2 | amount/currency mismatch on pay / on the webhook | I1 row `SUCCESS:5020:300EGP`; I2 row `SUCCESS:7401:1EGP`, `ACTIVE` |
| K | mock delays 3 s | cycle 3135 ms, completed, 1 charge |
| W1–W7 | refund, void, auth-only, pending, re-addressed success, re-addressed declines, malformed | W1/W2 no change, no rows; W3 `ACTIVE`; W4 `TRIALING`, no rows; W5 tenant B `ACTIVE`, card `attacker_junk_token`, tenant A `TRIALING`; W6 tenant C `PAST_DUE`, `failed 3`; W7 no `obj` → 500 (`Cannot read properties of undefined (reading 'amount_cents')`), non-hex hmac → 401, no `order` → 200, no hmac → 400, `TOKEN` type → 401 |
| T | `p6_notoken.ts` | paid trial without `obj.token` and admin-reactivated sub: `ACTIVE`, `card null`, periodEnd 2026-10-06, `gatewayCalls 0` after renewal, dunning and trial-expiry |
| M | `p6_resend.ts` (real SDK → mock) | `ok → {data:{id}}`; 500/429/422 → `{data:null,error:{statusCode…}}`, `threw=false`; reset / HTML-200 → `application_error`, `threw=false`; `idempotencyKey option forwarded as header? null`; all 4 helpers `resolved(undefined)` under 500/429/reset; raw markup present in 3 templates; `reply_to set: false`; reset link path `/reset?token=<redacted>` |
| ETA-schema | unpatched throwaway schema | `column ts.eta_signing_cert_pem does not exist` |
| ETA-uuid | `p6_uuidcast.ts` | 4 × `42883 ERROR: operator does not exist: uuid = text` (resubmit SELECT, UPDATE, items SELECT, attempt SELECT) |
| ETA-run | `p6_eta.ts` (throwaway columns + cast shim, 82 rewrites) | attempt 1: INV-A `accepted`, INV-CANCELLED `accepted`, INV-DUP `failed` with uuid, INV-LOST `failed`, INV-MAL `submitted`, INV-REJ `rejected`, INV-BAD `failed`, INV-AUTH `failed`; attempt 2 (≈ 31 s): DUP/LOST/BAD/MAL → 422 duplicate → `failed`; AUTH → `accepted` with a stale `eta_error`; all `submission_id` null; INV-A document: 1 of 2 lines, `totalAmount 228` vs 252.2, discount 0 vs 20, `signatures none`, address keys `street,country,governate,regionCity,buildingNumber`, top-level `branchId 0` vs settings 7, `receiver none`, `itemCode SKU-1` |
| R2 | `p6_r2.ts`, `p6_r2b.ts` | PUT `X-Amz-Expires 300`, `SignedHeaders host`, no content-length condition, query keys incl. `x-amz-checksum-crc32=AAAAAA==`, `x-amz-sdk-checksum-algorithm=CRC32`; `keyFromPublicUrl('…/../products/y.png') → '../products/y.png'`; `client-s3 3.1045.0`; 0 outbound fetches |
| Unit | `vitest run` (existing suite, throwaway env) | **10 files, 61 tests passed** (`paymob.webhook.test.ts` 6, `encryption.test.ts` 7, …) |

**Inherited runtime (Phase 5, same code).** X3 (DB refused after the charge), X4 (hung call blocks the worker), X5 (SIGKILL), X6 (SIGTERM on the real `index.ts`), X9 (`fetch` rejects after 301.0 s), R1–R4 (reminders), S-A, S-D1–D3, S-H.

**Official documentation consulted (read-only):**
- Paymob, HMAC for the transaction callback (field list; `merchant_order_id`/`token` not signed; Response-callback key mapping): https://developers.paymob.com/paymob-docs/developers/webhook-callbacks-and-hmac/hmac/hmac-transaction-callback
- Paymob, pay with saved token / recurring integration id: https://docs.paymob.com/docs/pay-with-saved-token, https://developers.paymob.com/paymob-docs/developers/pay-with-saved-cards/cit
- Paymob, transaction inquiry (Oman docs): https://docs.oman.paymob.com/docs/retrieve-a-transaction
- ETA, Submit Documents (202 semantics, `submissionUUID`, 422 `DuplicateSubmission`, 10-minute hash window): https://sdk.invoicing.eta.gov.eg/einvoicingapi/01-submit-documents/
- Resend, idempotency keys: https://resend.com/docs/dashboard/emails/idempotency-keys
- AWS SDK for JavaScript v3, S3 checksums (CRC32 default from 3.729.0): https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/s3-checksums.html
- Secondary (non-authoritative): Hookdeck's Paymob webhook guide; a community report on R2 and SDK ≥ 3.729

**Static references:** every file:line cited in §3–§21 was read in the repository at `8846bce`.

---

## 30. Closing Declaration

| | |
|---|---|
| Source files modified | **NO** |
| Migrations modified | **NO** |
| Persistent databases modified | **NO**. Only the throwaway `hesba_p6` database (incl. the labelled column patch on a throwaway tenant schema) inside a disposable container, now deleted |
| Production accessed | **NO** |
| Production credentials used | **NO**. Every repository `.env` key was overridden with throwaway values; only key names were read |
| Real payments sent | **NO** (loopback Paymob mock) |
| Real emails sent | **NO** (loopback Resend mock via `RESEND_BASE_URL`) |
| Real ETA submissions sent | **NO** (loopback ETA mock) |
| Production storage accessed | **NO** (R2 presigning is local computation; 0 outbound requests) |
| Throwaway services used | Docker `postgres:16-alpine` (`hesba-p6-pg`, 127.0.0.1:55434) and `redis:7-alpine` (`hesba-p6-redis`, 127.0.0.1:56380), both **deleted**; loopback mocks for Paymob (:58080), ETA (:58081), Resend (:58082). Docker Desktop was started for the runs and quit afterwards; your own containers `hesba_postgres` / `hesba_redis` were not touched |
| Tests executed | Paymob scenarios P0, A, B, B2, D, E, F1, F2, G, H1, H2, I1, I2, J1, J2, K, W1–W7 and T; Resend SDK matrix + helpers + templates; ETA schema, uuid-cast and pipeline runs (8 invoices × 2 attempts); R2 presign inspection; existing unit suite (61 tests, all passing). Read-only lookups of provider documentation |
| Tests not executed and why | Scenario C, L and the hang half of K were **not re-run**: identical code, evidence inherited from Phase 5 (X3, X4, X5, X6, X9). No provider sandbox calls (Paymob, ETA, Resend, R2): they would contact third parties and need credentials, so U6-01…U6-09 stay UNVERIFIED. No production schema inspection (U6-10). Undici connect-timeout default not measured (would require an external blackhole address) |
| Temporary files created and removed | Scratchpad `phase6/` outside the repository (`h6.ts`, `env.sh`, `p6_paymob.ts`, `p6_resend.ts`, `p6_eta.ts`, `p6_uuidcast.ts`, `p6_r2.ts`, `p6_r2b.ts`, `p6_notoken.ts`, `paymob.log`, `eta.log`). **They no longer exist**: the session's temporary directory was cleared between the runs and the report write-up (not deleted by an explicit step). The outputs used are recorded in §29. Nothing was written inside the repository except this report |
| Pre-existing working-tree changes preserved | **YES** (`AppShell.tsx`, `POS.tsx` modified; `documents/Hesba_Project_Overview.md` and `documents/audit/` untracked: unchanged apart from this new report) |
| Report path | `documents/audit/Hesba_Phase6_External_Integrations_Audit.md` |

*No fixes were implemented. The absence of a reproduced vulnerability in any area above is not a claim that the area is secure.*
