# Hesba Phase 4.5 — Cross-Phase Root Cause Consolidation

| | |
|---|---|
| Date | 2026-10-08 |
| Code under review | branch `claude/ui-pos-merge-split` @ `8846bce`. The working tree's two modified UI files (`POS.tsx`, `AppShell.tsx`) date from 2026-09-13, before every audit phase, so all four reports describe the same code. |
| Inputs | `Hesba_Phase1_Discovery_Report.md`, `Hesba_Phase2_Security_Audit.md`, `Hesba_Phase3_Financial_Integrity_Audit.md`, `Hesba_Phase4_Database_Concurrency_Audit.md`; the repository (source of truth); `documents/Hesba_Project_Overview.md` (documented behaviour) |
| Method | Consolidation, not a new audit. Every important finding was re-traced to its implementation (function, callers, transaction boundary, guard, constraint). Runtime evidence is inherited from Phase 4's harness; nothing new was executed. |

---

## 1. Executive Summary

**The question: how many fundamental engineering problems produce most of the findings? Eleven.**

The four reports contain **205 finding or observation identifiers**. After merging duplicates and splitting umbrella IDs, they reduce to **136 canonical findings** plus **2 corrections**:

| Severity | Count |
|---|---|
| P0 | 5 |
| P1 | 26 |
| P2 | 32 |
| P3 | 69 |
| INFO | 4 |

**Eleven root causes (RC-01 … RC-11) are the primary cause of 92 of the 136 findings (68 %), and of 26 of the 31 P0/P1 findings (84 %).** The other 44 are genuinely independent. Five of those are P1: HSEC-06, HSEC-18, HSEC-19, HSEC-20 and FIN-12. The rest are P2 or lower.

| ID | Root cause | Primary for | of which P0 / P1 |
|---|---|---|---|
| **RC-01** | **Ad-hoc concurrency control**: guards checked against a snapshot, then an unconditional write; absolute SETs from stale reads; no lock ordering or retry | 21 | 0 / 6 |
| **RC-02** | **Implicit, multi-writer state model**: blacklist status checks, several modules writing one status, no invoice ↔ contract ↔ work-order coupling, conflated subscription semantics | 11 | 1 / 2 |
| **RC-03** | **Financial effects aren't recorded as first-class entries**: no payment allocations or per-document effect records, so refunds, reversals and reports recompute from mutable aggregates | 10 | 1 / 2 |
| **RC-04** | **The server doesn't own monetary calculation**: client-supplied prices, duplicated client/server pricing logic, no shared vocabulary (`packages/shared` is empty) | 5 | 2 / 1 |
| **RC-05** | **No durable idempotency boundary**: retried or replayed requests and jobs repeat their effects | 4 | 0 / 1 |
| **RC-06** | **No server-side payment intent**: SaaS charges aren't bound to an expected tenant, period and amount | 9 | 0 / 4 |
| **RC-07** | **Multi-step lifecycle without a durable step record**: provisioning and migrations aren't resumable or atomic with their bookkeeping | 7 | 0 / 0 |
| **RC-08** | **Unbounded waits and shared resources**: no failure isolation, timeouts or capacity budget | 7 | 0 / 1 |
| **RC-09** | **No single schema contract**: SQL migrations, a hand-written Prisma model and untyped raw SQL drift apart; CI compares table names only | 7 | 0 / 0 |
| **RC-10** | **Authorization is opt-in per route**: `authenticate` alone is the default; coarse permissions; platform actions not tenant-scoped | 8 | 1 / 3 |
| **RC-11** | **Sessions have no per-user registry**: no revocation, deactivation or claim reload | 3 | 0 / 1 |

**What the clustering shows:**
1. **Most "race" findings are one pattern.** Thirteen check-then-write operations broke at runtime in Phase 4, and every one reads its guard outside the transaction. The *correct* pattern already exists in five places (sale stock, coupon, loyalty redemption, stock adjustment, password reset). The team knows how; there is just no shared primitive, so each path chose differently. **Coupon and loyalty redemption are not race findings**: Phase 4 found them safe.
2. **The P0 money bugs are not race bugs.** FIN-01, FIN-02, FIN-05 and DB-01 come from ownership problems: who computes the price (RC-04), what a reversal is computed from (RC-03), and which entity owns a state transition (RC-02).
3. **Background-job races are not an independent cluster.** Every job defect is RC-01, RC-02 or RC-06 seen from a job: stale selection then an unconditional write, a selection predicate that ignores business state, and no per-period payment record.
4. **Infrastructure findings are one availability problem (RC-08):** no budgets on waits or connections. The individual fixes are small configuration changes.

**If only five changes ship before the next release** (detail in §34):

| # | Change | P0 / P1 eliminated |
|---|---|---|
| 1 | A guarded-mutation toolkit used by every write path, plus DB constraints (RC-01) | DB-02, DB-03, DB-04, DB-05, DB-06, DB-07 |
| 2 | An explicit state model with one owner per entity, starting with invoice ↔ contract and subscriptions (RC-02) | DB-01 (with FIN-03/04), DB-08, FIN-16 |
| 3 | Server-owned pricing through one shared calculation module (RC-04) | FIN-01, FIN-05 (HSEC-02), FIN-06 |
| 4 | Record financial effects, and reverse exactly what was recorded (RC-03) | FIN-02, FIN-10, FIN-11 (and DB-01's phantom stock and credit) |
| 5 | Default-deny authorization (RC-10) | HSEC-01, HSEC-03, HSEC-04, HSEC-05 |

Together these clear **all 5 P0 and 14 of the 26 P1** findings, and reduce several more.

The P1s left over:
- **Root-cause fixes:** RC-06 (payment intent: FIN-17, FIN-L1, FIN-L2, HSEC-21), RC-05 (DB-10), RC-08 (DB-09), RC-11 (HSEC-07).
- **Independent fixes:** HSEC-06, HSEC-18, HSEC-19, HSEC-20, FIN-12.

**Corrections:**
- **FIN-23 is not a defect.** The behaviour is asserted by `cost.test.ts:10-13`.
- **The Phase 3 "last two installments leave the contract active" sub-claim** stays refuted (Phase 4 S5b).
- **NEW-01 (new finding).** Found while mapping side effects: cancelling a work-order invoice leaves the work order linked to it, so the order can never be re-invoiced.

---

## 2. Audit Scope

| Item | Detail |
|---|---|
| In scope | Every finding and observation ID in the four reports: the Phase 1 observation ledger, HSEC-01..29, FIN-01..24 / FIN-L1..L3 / FIN-P1..P9, and DB-01..38 with Phase 4's likely, potential and unverified lists |
| Verification | Re-traced in code for this phase: HSEC-01 (`index.ts:258-428` guards), HSEC-02/FIN-05 (`invoice.service.ts:207-209`), HSEC-03 (`coupon.routes.ts:33-90`; seed cashier role `tenant.service.ts:54-57`), HSEC-04 (`billing.routes.ts:93-182`), HSEC-05 (`installment.routes.ts:216-224`), HSEC-07 (`auth.routes.ts:237-577`), HSEC-16 (`admin.routes.ts:890`), FIN-01 (`POS.tsx:270-284,849`), FIN-02 (`invoice.service.ts:225,605-614`), FIN-06 (`fee.ts:14-26` vs `tenant.service.ts:167-172` vs `POS.tsx:85-88`), FIN-10 (`report.service.ts:399-455`), FIN-11 (`report.service.ts:580-600`), FIN-12 (`loyalty.ts:24-50`), FIN-21 (`invoice.service.ts:160-165`), DB-08's checkout path (`paymob.client.ts:105`). Writers of every status and balance column were enumerated by grep (§24) |
| Runtime evidence | inherited from Phase 4 (throwaway PostgreSQL, real services and routes: scenarios S1–S20, B1–B8, M1–M6, P1–P4). No new runtime work |
| Not done | no source, migration or data change; no production access; no external service; no new tests |

**ID conventions used here:**
- Phase 4's likely, potential and unverified items are written **DB-L01..L10**, **DB-P01..P10** and **DB-U01..U07**, to avoid clashing with Phase 1's `P-01..P-07` and Phase 2's `U-01..U-12`.
- New items found in this phase are **NEW-xx**.

**Severity normalisation.** Phase 3 and 4 already used P0–P3. Phase 2's ratings map as follows:

| Phase 2 rating | Consolidated |
|---|---|
| HIGH | P0 (both HIGH findings are exploitable by any authenticated employee in normal operation) |
| MEDIUM | P1 |
| LIKELY-MEDIUM | P1 (status LIKELY) |
| LOW | P3 |
| INFO | P3 or INFO |
| POTENTIAL | P3 |

- **Merged findings keep the highest severity any phase gave them.** Example: FIN-L1 (P1 in Phase 3) and DB-L01 (P2 in Phase 4) are the same finding, kept at P1 because customer money is charged.
- **Phase 2's own remediation list** put HSEC-04/05/06 in its first batch because they are cheap. This consolidation rates impact, not effort.

---

## 3. Finding Inventory

One row per **canonical** finding, with every merged identifier in brackets. Rows are sorted by severity, then ID. All 205 identifiers from the four reports appear, either as a row or as a merged alias (coverage checked mechanically).

**Legend:**
- **Status:** CR = confirmed at runtime (Phase 4 harness); CC = confirmed in code; LK = likely; PO = potential; OB = observation (confirmed design, not a defect by itself); CX = corrected (see §31).
- **Root cause:** RC-01..RC-11 (§5); IND = independent. When several are listed, the first is primary.
- **Impact columns:** H / M / L / — for financial, security and operational impact.

| ID (merged aliases) | Phase | Sev. | Domain | Status | Immediate cause | Root cause | Module | Entity | Fin | Sec | Ops |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **DB-01** (FIN-03, FIN-04) | 3,4 | P0 | Installments/Sales | CR | Cancel/return accept a `pending` installment invoice; approval updates the invoice unconditionally | RC-02, RC-03, RC-01 | invoice.service; installment.service; Invoices.tsx | invoice, contract, stock, credit | H | — | M |
| **FIN-01** | 3 | P0 | Sales (POS) | CC | POS total omits tax and product discounts | RC-04 | POS.tsx | invoice total (client copy) | H | — | M |
| **FIN-02** (F-04) | 1,3 | P0 | Returns | CC | Refund formula subtracts the line discount twice and ignores invoice-level discounts | RC-03 | invoice.service.returnInvoice | return, credit | H | — | L |
| **FIN-05** (HSEC-02, F-01) | 1,2,3 | P0 | Sales/Installments | CC | Server prices lines from the client's `unitPrice` | RC-04 | invoice.service; installment.service | invoice items | H | H | — |
| **HSEC-01** (A-04, Z-01) | 1,2 | P0 | Authorization | CC | Settings, ETA credentials, branches use `authenticate` only | RC-10 | index.ts settings/branches routes | tenant_settings, branches | M | H | M |
| **DB-02** (F-02, FIN-08 (credit)) | 1,3,4 | P1 | Customer credit | CR | Cap read outside the tx; unconditional decrement; no CHECK | RC-01 | invoice.service.createInvoice | customers.credit_balance | H | L | — |
| **DB-03** (IN-02, FIN-07 (approve)) | 1,3,4 | P1 | Installments | CR | Status read before the tx; update by id; no unique schedule key | RC-01, RC-02 | installment.service.approveContract | contract, schedule, stock | H | — | M |
| **DB-04** | 4 | P1 | Installments | CR | Approve and reject both unconditional | RC-01, RC-02 | installment.service approve/reject | contract, invoice, stock | H | — | M |
| **DB-05** (FIN-07 (cancel)) | 3,4 | P1 | Sales cancel | CR | Status read before the tx; reversals unconditional | RC-01 | invoice.service.cancelInvoice | stock, credit, points, coupon | H | — | L |
| **DB-06** (FIN-07 (returns)) | 3,4 | P1 | Returns | CR | Cumulative cap read outside the tx; invoice not locked | RC-01 | invoice.service.returnInvoice | returns, stock, credit | H | — | L |
| **DB-07** (PO-01, FIN-07 (receipts)) | 1,3,4 | P1 | Purchasing | CR | Outstanding computed outside the tx; unbounded increments | RC-01 | po.routes receive | PO items, stock, supplier balance | H | — | M |
| **DB-08** (FIN-P7 (related)) | 4 | P1 | SaaS billing | CR | Dunning selection ignores paid period and scheduled cancel; one counter for all failures | RC-02, RC-06 | dunning.job; billing.service | subscription, card charges | H | — | M |
| **DB-09** (HSEC-28 (outage)) | 2,4 | P1 | Infrastructure | CR | Shared ioredis with `maxRetriesPerRequest: null`; no fallback/timeouts | RC-08 | config/redis.ts; tenant.middleware | all tenant requests | M | — | H |
| **DB-10** (FIN-09, W-08, DB-L04) | 1,3,4 | P1 | Sales (all creates) | CC | No idempotency key; POS retries and replays | RC-05 | invoice.routes; POS.tsx | invoices and all creates | H | — | M |
| **FIN-06** (T-05) | 1,3 | P1 | Payments/fees | CR | Seed writes `percent`; server matches `percentage` | RC-04, RC-09 | tenant.service seed; fee.ts; POS.tsx | payment_methods, fees | M | — | — |
| **FIN-10** (WO-03) | 1,3 | P1 | Reporting | CC | P&L from invoice totals incl. tax; WO counted twice; COGS not reversed | RC-03 | report.service P&L | reports | M | — | L |
| **FIN-11** | 3 | P1 | Reporting | CC | Day close from invoice totals, not money received | RC-03 | report.service day close | reports | M | — | L |
| **FIN-12** | 3 | P1 | Loyalty | CC | Capped redemption floors points without recomputing the discount; 0-point redemption allowed | IND, RC-04 | loyalty.ts; invoice.service | customers.loyalty_points | L | — | — |
| **FIN-16** (HSEC-08, J-06) | 1,2,3 | P1 | SaaS billing | CC | Expired trial → PAST_DUE never escalates (no token) and isn't blocked | RC-02 | trial-expiry.job; tenant.middleware | subscription | M | L | — |
| **FIN-17** (B-01, B-04) | 1,3 | P1 | SaaS billing | CC | No payment record at checkout; webhook amount/currency not compared | RC-06 | billing.service | subscription, payment_attempts | M | M | — |
| **FIN-L1** (DB-L01, FIN-P3, HSEC-27 (dup. charges)) | 2,3,4 | P1 | SaaS billing | LK | Charge before DB write; whole-cycle retry; new order id per attempt | RC-06, RC-05 | renewal.job; dunning.job | card charges | H | — | M |
| **FIN-L2** | 3 | P1 | SaaS billing | LK | Low-amount signed success could activate a tenant (FIN-17 + HSEC-21) | RC-06 | billing.service | subscription | M | M | — |
| **HSEC-03** | 2 | P1 | Authorization | CC | Coupons under `invoices:*`, credit under `customers:update` (cashier holds both) | RC-10 | coupon.routes; customer.routes; seed roles | coupons, credit | M | M | — |
| **HSEC-04** (B-06) | 1,2 | P1 | Authorization | CC | Billing status/portal/cancel/resume authenticate-only; portal returns card token | RC-10 | billing.routes | subscription | M | M | — |
| **HSEC-05** (J-08) | 1,2 | P1 | Authorization/jobs | CC | Tenant route runs the all-tenant reminder cycle outside the lock | RC-10, RC-05 | installment.routes; reminders job | reminders (all tenants) | — | M | M |
| **HSEC-06** (AU-10) | 1,2 | P1 | Email | CC | Receipt email interpolates unescaped tenant data; any recipient | IND | invoice.routes email-receipt; email.ts | email relay | — | M | — |
| **HSEC-07** (W-07) | 1,2 | P1 | Identity | CC | No endpoint to deactivate, re-role or revoke users | RC-11 | auth.routes | users, sessions | — | M | M |
| **HSEC-18** | 2 | P1 | Abuse controls | LK | No `trustProxy`: rate limits keyed by proxy IP | IND | index.ts | rate limiting | — | M | M |
| **HSEC-19** (T-01) | 1,2 | P1 | Abuse controls | LK | Signup unthrottled; each signup creates a schema | IND, RC-07 | tenant.routes; tenant.service | tenants, schemas | — | M | M |
| **HSEC-20** (A-02) | 1,2 | P1 | TLS | LK | On-demand TLS approves any subdomain | IND | index.ts check-tenant; Caddyfile | certificates | — | M | M |
| **HSEC-21** | 2 | P1 | SaaS billing | LK | Tenant parsed from unsigned `merchant_order_id` | RC-06 | billing.service; paymob.webhook | subscription | M | M | — |
| **B-03** | 1 | P2 | SaaS billing | CC | Refund/void callbacks are no-ops | RC-06 | billing.routes | subscription | M | — | — |
| **B-07** | 1 | P2 | Infrastructure | CC | Outbound `fetch` (Paymob, ETA) without timeouts | RC-08 | paymob.client; eta client | jobs | — | — | M |
| **DB-11** (S-07, FIN-07 (transfers)) | 1,3,4 | P2 | Inventory | CR | Availability/status read outside tx; unconditional decrement | RC-01 | stock.service.approveTransfer | stock, transfer | M | — | L |
| **DB-12** | 4 | P2 | Inventory cost | CR | WAC read-compute-write without lock | RC-01 | po.routes receive | product_variants.cost_price | M | — | — |
| **DB-13** (FIN-07 (WO)) | 3,4 | P2 | Work orders | CR | Pre-check `invoiceId`; link updated unconditionally | RC-01 | workOrder.routes invoice | invoice, work order | M | — | — |
| **DB-14** (FIN-08 (WO)) | 3,4 | P2 | Work orders | CR | Absolute SET of `paid_amount`; no bound | RC-01 | workOrder.routes payment | work_orders.paid_amount | M | — | — |
| **DB-15** (CU-01, FIN-08 (manual)) | 1,3,4 | P2 | Customer credit | CR | Absolute SET from a stale read | RC-01 | customer.routes credit | customers.credit_balance | M | L | — |
| **DB-16** (FIN-08 (PO)) | 3,4 | P2 | Purchasing | CR | Remaining checked outside the tx | RC-01 | po.routes payments | PO paid, supplier balance | M | — | — |
| **DB-17** (FIN-12 (reversal)) | 3,4 | P2 | Loyalty | CR | Reversal decrements earned points unconditionally | RC-03, RC-01 | invoice.service.cancelInvoice | customers.loyalty_points | L | — | — |
| **DB-18** | 4 | P2 | Sales | CR | Row locks taken in client item order; no retry | RC-01 | invoice.service (and cancel/return/approve/transfer) | stock rows | — | — | M |
| **DB-19** | 4 | P2 | SaaS billing | CR | Trial-expiry updates by id after a stale list | RC-01, RC-02 | trial-expiry.job | subscription | M | — | L |
| **DB-20** (U-09 (Ph2)) | 2,4 | P2 | Infrastructure | CR | 50 clients × 5 connections > max_connections 100 | RC-08 | config/database.ts | DB connections | — | — | H |
| **DB-21** (D-05) | 1,4 | P2 | Tenant migrations | CR | Version bump outside the DDL tx; 001/002/016 not re-runnable | RC-07 | migrate-tenants.ts | tenants.schema_version | — | — | M |
| **DB-22** | 4 | P2 | Tenant provisioning | CR | Multi-commit signup with in-memory compensation only | RC-07 | tenant.service.provisionTenant | tenant row, schema | — | — | M |
| **DB-23** (E-01) | 1,4 | P2 | ETA | CR | Raw SQL names columns no migration creates | RC-09 | eta-submission.job; eta.submit | invoices.eta_*, eta_submissions | L | — | H |
| **DB-L02** (A-07 (related)) | 1,4 | P2 | Tenant migrations | LK | `listen` before the migration sweep | RC-07 | index.ts | schema vs code | — | — | M |
| **DB-L03** | 4 | P2 | SaaS billing | LK | Renewal charges from a list read once | RC-01, RC-02 | renewal.job | card charges | M | — | — |
| **DB-P01** | 4 | P2 | SaaS billing | PO | Same txn FAILED then SUCCESS → success dropped (P2002) | RC-06 | billing.service | subscription | M | — | — |
| **E-02** (doc #1) | 1 | P2 | ETA | CC | Only the manual resubmit route enqueues ETA jobs | IND | eta.routes | ETA submissions | L | — | M |
| **F-05** | 1 | P2 | Sales cancel | CC | Cancel doesn't reverse fee expense, financing or ETA | RC-03 | invoice.service.cancelInvoice | fee expenses, financing | M | — | — |
| **FIN-13** | 3 | P2 | Pricing | CC | Product discounts unbounded; line subtotal not clamped | IND | product.routes; invoice.service | invoice items | M | — | — |
| **FIN-14** | 3 | P2 | Pricing | CC | Coupon `minAmount` checked only in the browser | RC-04 | POS.tsx; invoice.service | coupons | L | L | — |
| **FIN-15** | 3 | P2 | Payments | CC | Split payment stored as two unvalidated columns | RC-03, RC-04 | invoice.service; report.service | invoices (split) | M | — | — |
| **FIN-18** (F-07) | 1,3 | P2 | Pricing/precision | CC | Client JS-number math and display rounding; discount components mixed | RC-04, RC-03 | POS.tsx; invoice.service:346 | amounts | L | — | — |
| **FIN-19** (F-03) | 1,3 | P2 | Customer credit | CC | Credit ledger lives in JSON audit rows | RC-03 | invoice.service; customer.routes | audit_logs, credit | L | — | L |
| **FIN-20** (IN-04, IN-03 (paidAmount)) | 1,3 | P2 | Installments | CC | No overdue/settlement states; invoice paid frozen at down payment | RC-02 | installment.service | contract, invoice | L | — | L |
| **FIN-21** | 3 | P2 | Sales | CC | Only the variant's `isActive` is checked | IND | invoice.service:160-165 | products | L | — | — |
| **FIN-22** | 3 | P2 | History | CC | Names, tax rate and pre-017 cost read live | RC-03 | report.service; eta job | historical documents | L | — | L |
| **FIN-L3** | 3 | P2 | SaaS billing | LK | `pending` token charges handled as failures | RC-06, RC-02 | renewal.job; dunning.job | subscription | M | — | — |
| **P-04** | 1 | P2 | SaaS billing | CC | Admin plan change updates tenant plan only | RC-02 | admin.routes | tenant.plan_id vs subscription | M | — | L |
| **P-05** | 1 | P2 | Tenant lifecycle | CC | Two suspension mechanisms (tenant vs subscription status) | RC-02 | tenant.middleware; admin.routes | tenant, subscription | L | — | L |
| **S-03** (doc #5) | 1 | P2 | Imports | CC | Multipart parser unregistered → imports return 415 | IND | index.ts; product/customer import | imports | — | — | M |
| **A-01** | 1 | P3 | Infrastructure | OB | HTTP, SPA and 5 workers in one process | RC-08 | index.ts | process | — | — | L |
| **A-07** | 1 | P3 | Tenant migrations | CC | `/health` 200 when some tenants fail | RC-07 | index.ts:166-175 | health | — | — | L |
| **A-08** | 1 | P3 | Observability | CC | Sentry inactive (dependency absent) | IND | api package | monitoring | — | — | L |
| **AU-02** | 1 | P3 | Identity | OB | Refresh doesn't compare stored tenantId with the resolved tenant | IND | auth.routes | sessions | — | L | — |
| **AU-05** | 1 | P3 | Identity | CC | Forgot-password counter keyed by email across tenants | IND | auth.service | rate limit | — | L | — |
| **D-04** (FIN-P8) | 1,3 | P3 | Schema | CC | CHECKs `NOT VALID`; no credit/loyalty/received/paid CHECKs | RC-01 | 016_check_constraints.sql | constraints | M | — | — |
| **D-06** | 1 | P3 | Configuration | CC | Boot-time plan seed overwrites admin edits | RC-09 | plan seed | plans | L | — | L |
| **D-07** | 1 | P3 | Schema | CC | Master data-fix migrations hard-code one tenant | IND | prisma/migrations | master data | — | — | L |
| **D-08** | 1 | P3 | Schema | CC | No `migration_lock.toml` | IND | prisma/migrations | tooling | — | — | L |
| **DB-24** (FIN-08 (dunning)) | 3,4 | P3 | SaaS billing | CR | `failedAttempts` absolute SET | RC-01 | billing.service | subscription | L | — | — |
| **DB-25** | 4 | P3 | SaaS billing | CR | Success accepts any source state; period = now + cycle | RC-02 | billing.service | subscription | L | — | — |
| **DB-26** | 4 | P3 | Jobs | CR | Reminder dedupe is check-then-send | RC-05 | installment-reminders.job | reminder emails | — | — | L |
| **DB-27** | 4 | P3 | Installments | CR | `already_paid` read before the tx | RC-01 | installment.service.recordPayment | installment_payments | L | — | — |
| **DB-28** | 4 | P3 | Installments | CR | Base client used inside the tx | IND | installment.service:396-399 | API response | — | — | L |
| **DB-29** (C-03) | 1,4 | P3 | Infrastructure | CR | LRU dispose disconnects in-use client | RC-08 | config/database.ts | tenant clients | — | — | L |
| **DB-30** (F-03 (part)) | 1,4 | P3 | Sales cancel | CR | Cancel scans all customer audit rows in the tx | RC-03 | invoice.service.cancelInvoice | audit_logs | — | — | M |
| **DB-31** (FIN-P9) | 3,4 | P3 | Infrastructure | CR | 5 s/2 s tx defaults, pool 5, no DB timeouts | RC-08 | config/database.ts; Prisma defaults | transactions | — | — | M |
| **DB-32** (D-03a, IN-03 (method)) | 1,4 | P3 | Schema | CR | Column missing from the Prisma model | RC-09 | schema.tenant.prisma | installment_payments | L | — | — |
| **DB-33** (CU-03, doc #6) | 1,4 | P3 | Schema | CR | Raw SQL selects a missing column | RC-09 | customer.routes statement | statement export | — | — | L |
| **DB-34** (D-03, D-03b, D-03c) | 1,4 | P3 | Schema | CR | Hand-maintained tenant model differs from SQL | RC-09 | schema.tenant.prisma | tooling | — | — | L |
| **DB-35** | 4 | P3 | History | CC | Coupon hard delete (SET NULL); admin delete cascades audit; rollback drops schema | IND | coupon.routes; admin.routes; tenant.service | history | L | L | — |
| **DB-36** | 4 | P3 | Work orders | CC | Invoice route ignores WO status | RC-02 | workOrder.routes | work orders | L | — | — |
| **DB-37** (B-05) | 1,4 | P3 | SaaS billing | CC | 3/7/14 thresholds applied to every decline | RC-02 | billing.service | subscription | L | — | L |
| **DB-L05** | 4 | P3 | Cache | LK | Cache-aside write-back after invalidation | IND | tenant.middleware | Redis tenant cache | — | L | — |
| **DB-L07** (J-07, HSEC-27, FIN-P3) | 1,2,3,4 | P3 | Jobs | LK | Lock released by DEL without owner check | RC-05 | shared/utils/lock.ts | job cycles | L | — | L |
| **DB-L08** | 4 | P3 | Plan limits | LK | Count-then-create | RC-01 | limit.middleware | plan limits | L | — | — |
| **DB-L09** | 4 | P3 | Sales/returns | LK | Inverse lock order customer↔stock | RC-01 | invoice.service | customer, stock | — | — | L |
| **DB-L10** | 4 | P3 | Tenant migrations | LK | Sweep skips CANCELLED tenants | RC-07 | migrate-tenants.ts | schema version | — | — | L |
| **DB-P02** (B-02, D-01, FIN-P4) | 1,3,4 | P3 | SaaS billing | PO | Unordered `findFirst`; several subscriptions allowed | RC-02 | billing.service | subscription | M | — | — |
| **DB-P03** | 4 | P3 | Tenant migrations | PO | Pending files computed before the lock | RC-07 | migrate-tenants.ts | schema version | — | — | L |
| **DB-P04** | 4 | P3 | Schema | PO | `tenant_settings` singleton not enforced | RC-09 | schema; eta job | settings | — | — | L |
| **DB-P05** | 4 | P3 | Reporting | PO | Reports read several snapshots | IND | report.service | reports | L | — | — |
| **DB-P06** | 4 | P3 | Returns | PO | Movement logged when no stock row changed | RC-03 | invoice.service.returnInvoice | stock_movements | L | — | — |
| **DB-P07** | 4 | P3 | Tenant provisioning | PO | Rollback leaves cache and client entries | RC-07 | tenant.service | Redis, LRU | — | — | L |
| **DB-P08** | 4 | P3 | Installments | PO | Two connections per approval can starve the pool | RC-08 | installment.service | pool | — | — | L |
| **DB-P09** (FIN-P5) | 3,4 | P3 | ETA | PO | Resubmission after a crash duplicates | RC-05 | eta-submission.job | ETA documents | L | — | — |
| **DB-P10** | 4 | P3 | Customer credit | PO | Negative balance becomes a negative discount | RC-01 | invoice.service:263 | invoice totals | M | — | — |
| **E-07** | 1 | P3 | ETA | CC | `etaEnvironment` dropped by `PATCH /api/settings` schema | RC-09 | index.ts settings | tenant_settings | — | — | L |
| **FIN-24** | 3 | P3 | Misc. | CC | Minor items (Phase 3 §FIN-24) | IND | various | — | L | — | — |
| **FIN-P1** | 3 | P3 | Tax | PO | VAT computed before the order-level coupon | IND | invoice.service | tax | L | — | — |
| **FIN-P2** | 3 | P3 | Currency | PO | Non-base currency amounts stored unconverted | IND | invoice.service | currency | L | — | — |
| **FIN-P6** | 3 | P3 | SaaS billing | PO | Auth-only card transactions treated as paid | RC-06 | billing.routes | subscription | M | — | — |
| **FIN-P7** | 3 | P3 | SaaS billing | PO | Manual checkout + due renewal charge one period twice | RC-06 | renewal.job; billing.service | card charges | M | — | — |
| **HSEC-09** | 2 | P3 | Identity | CC | Login timing reveals accounts | IND | auth.service | users | — | L | — |
| **HSEC-10** (DB-L06) | 2,4 | P3 | Identity | CC | Non-atomic refresh rotation; no reuse detection; no revocation | RC-11 | auth.service; auth.routes | sessions | — | L | — |
| **HSEC-11** (W-03) | 1,2 | P3 | Identity | CC | URL-fragment session restored unverified | IND | web auth | sessions | — | L | — |
| **HSEC-12** (Z-02, T-06, F-06 (refund perm)) | 1,2 | P3 | Authorization | CC | Permissions granted to no role; unused; POS role gaps | RC-10 | seed roles; routes | roles | — | L | L |
| **HSEC-13** (Z-03, Z-04, doc #10) | 1,2 | P3 | Entitlements | CC | Only 3 plan features enforced; conflicting limits | RC-10 | feature.middleware; plans | plans | L | — | — |
| **HSEC-14** (S-05, P-03) | 1,2 | P3 | Authorization | CC | Cost price, full subscription row exposed | RC-10 | product search; admin routes | responses | — | L | — |
| **HSEC-15** (AU-11) | 1,2 | P3 | Email | CC | Emailed `/reset` and checkout links match no SPA route | IND | email.ts; web router | links | — | — | L |
| **HSEC-16** (P-02) | 1,2 | P3 | Platform admin | CR | `[requireOwner]` passes the factory; request hangs | IND | admin.routes:890 | run-migrations | — | — | L |
| **HSEC-17** (AU-03) | 1,2 | P3 | Identity | CC | `clearCookie` omits the domain | IND | auth.routes | cookies | — | L | — |
| **HSEC-22** (W-06) | 1,2 | P3 | Web | PO | Unescaped `document.write` print sinks | IND | web print paths | XSS (CSP-mitigated) | — | L | — |
| **HSEC-23** | 2 | P3 | Web | PO | Subdomain trust amplifies any XSS | IND | cookies/CORS | sessions | — | L | — |
| **HSEC-24** (W-04) | 1,2 | P3 | Web | PO | Admin access token in localStorage | IND | admin-auth.store | admin session | — | L | — |
| **HSEC-25** | 2 | P3 | Identity | PO | Reset tokens may reach analytics/logs | IND | App.tsx; email.ts | reset tokens | — | L | — |
| **HSEC-26** (F-06 (branchId)) | 1,2 | P3 | Authorization | PO | No branch-level authorization | RC-10 | invoice/report routes | branches | L | L | — |
| **HSEC-29** (CU-02, S-02) | 1,2 | P3 | Storage | PO | Permanent public R2 URLs; no size limits | IND | config/r2.ts; customer docs | files | — | L | — |
| **IN-05** | 1 | P3 | Testing | CC | Installment math test re-implements the formula | IND | installment.math.test | tests | L | — | — |
| **M-02** | 1,2 | P3 | Identity | CC | Role/permissions read from the JWT, not reloaded | RC-11 | auth.middleware | claims | — | L | — |
| **NEW-01** | 4.5 | P3 | Work orders | CC | `cancelInvoice` never clears `work_orders.invoice_id`; the order stays `already_invoiced` forever | RC-02 | invoice.service.cancelInvoice; workOrder.routes:409-411 | work order, invoice | L | — | L |
| **P-01** | 1 | P3 | Platform admin | CC | Admin refresh unthrottled | IND | admin.auth | admin sessions | — | L | — |
| **P-07** | 1 | P3 | Platform admin | CC | Owner credentials re-seeded from env on every boot | IND | admin.auth.service | platform owner | — | L | — |
| **S-01** | 1 | P3 | Inventory | CC | New branches get no stock rows | IND | branches route | stock | — | — | L |
| **S-08** | 1 | P3 | Inventory cost | OB | One cost per variant across branches | IND | po.routes; cost.ts | cost_price | L | — | — |
| **S-09** | 1 | P3 | Reporting | CC | Low-stock filter applied after pagination | IND | stock.service | stock list | — | — | L |
| **T-03** | 1 | P3 | Tenant lifecycle | CC | Tenant emails stored un-normalised | IND | tenant.service | tenants.email | — | L | — |
| **T-04** | 1 | P3 | Tenant lifecycle | CC | Signup response hard-codes a localhost URL | IND | tenant.routes | signup | — | — | L |
| **WO-02** (doc #17) | 1 | P3 | Work orders | CC | WO invoices: settings VAT, `SVC-` numbers, no ETA, no limit | IND | workOrder.routes | invoices | L | — | — |
| **DB-38** | 4 | INFO | Sales | CC | Sequence gaps; UTC date in the number | IND | invoice.service:448-455 | invoice_number | — | — | — |
| **I-01** (doc #13) | 1 | INFO | Deployment | CC | Dockerfile comment vs `tsx` CMD | IND | Dockerfile | — | — | — | L |
| **M-01** | 1 | INFO | Multi-tenancy | OB | Tenant from host; header fallback on system hosts | IND | tenant.middleware | tenant resolution | — | — | — |
| **P-06** | 1 | INFO | Platform admin | OB | Admins see tenant row counts only | IND | admin.routes | — | — | — | — |
| **FIN-20 (sub-claim)** (Phase 3 §9 'last two rows') | 3,4 | CORR | Installments | CX | 'Last two rows paid concurrently leave the contract active' — refuted (S5b 20/20) | — | installment.service | contract | — | — | — |
| **FIN-23** | 3 | CORR | Inventory cost | CX | WAC adopts the received cost when prior cost is 0 — asserted by `cost.test.ts:10-13` | — | cost.ts | cost_price | — | — | — |

**Totals:**

| Measure | Count |
|---|---|
| Canonical findings | 136 (P0 5 · P1 26 · P2 32 · P3 69 · INFO 4) |
| Corrections | 2 |
| Confirmed at runtime | 35 |
| Confirmed in code | 62 |
| Likely | 14 |
| Potential | 20 |
| Observations | 5 |

---

## 4. Finding Deduplication

Identifiers merged into a canonical finding. They describe the same implementation and would be fixed by the same change.

Two Phase 3 umbrella IDs were **split**:
- **FIN-07** (duplicated transitions) → DB-03, DB-05, DB-06, DB-07, DB-11, DB-13.
- **FIN-08** (balance races) → DB-02, DB-14, DB-15, DB-16, DB-24.

Phase 4 measured each of these separately, and each is fixed in a different code path, though all are fixed by the same RC-01 primitive.

| Canonical | Merged identifiers | Basis for the merge |
|---|---|---|
| **DB-01** | FIN-03, FIN-04 | FIN-03 (phantom stock/credit) and FIN-04 (contract survives) are two outcomes of the same unguarded invoice↔contract transition; one fix (owned transition + reversal of recorded effects) |
| **FIN-02** | F-04 | Phase 1 F-04 is the formula defect Phase 3 quantified |
| **FIN-05** | HSEC-02, F-01 | same line of code (`invoice.service.ts:209`, `installment.service.ts:166`) reviewed for security (HSEC-02) and money (FIN-05) |
| **HSEC-01** | A-04, Z-01 | A-04 and Z-01 are Phase 1's list of the same authenticate-only routes |
| **DB-02** | F-02, FIN-08 (credit) | F-02 / FIN-08 credit part: same decrement at `invoice.service.ts:313-320` |
| **DB-03** | IN-02, FIN-07 (approve) | IN-02 and FIN-07's approval case: same pre-tx status check (`installment.service.ts:319`) |
| **DB-05** | FIN-07 (cancel) | FIN-07's cancel case (`invoice.service.ts:697-848`) |
| **DB-06** | FIN-07 (returns) | FIN-07's return case (`invoice.service.ts:579-680`) |
| **DB-07** | PO-01, FIN-07 (receipts) | PO-01 and FIN-07's receipt case (`po.routes.ts:238-336`) |
| **DB-08** | FIN-P7 (related) | FIN-P7 (manual checkout + renewal) is the same 'no per-period payment' gap seen from renewal |
| **DB-09** | HSEC-28 (outage) | HSEC-28's outage half; its token-storage half is covered under RC-11 notes |
| **DB-10** | FIN-09, W-08, DB-L04 | FIN-09, W-08 and DB-L04 describe the same missing idempotency from server, client and retry angles |
| **FIN-06** | T-05 | T-05 is the same vocabulary mismatch; also Phase 1 doc discrepancies #9 and #25 |
| **FIN-10** | WO-03 | WO-03 is one of FIN-10's three P&L defects |
| **FIN-16** | HSEC-08, J-06 | HSEC-08 and J-06 are the same trial-expiry behaviour |
| **FIN-17** | B-01, B-04 | B-01 (no record at checkout) is the cause of B-04/FIN-17 (nothing to compare the amount with) |
| **FIN-L1** | DB-L01, FIN-P3, HSEC-27 (dup. charges) | DB-L01 re-states it; HSEC-27/FIN-P3 overlap through duplicate charges (kept under DB-L07 for the lock mechanism) |
| **HSEC-04** | B-06 | B-06 (portal returns the card token) is part of HSEC-04 |
| **HSEC-05** | J-08 | J-08 is the same manual trigger |
| **HSEC-06** | AU-10 | AU-10 is the same unescaped email interpolation |
| **HSEC-07** | W-07 | W-07 is the same missing user lifecycle |
| **HSEC-19** | T-01 | T-01 is the same unthrottled signup |
| **HSEC-20** | A-02 | A-02 is the same TLS-ask check |
| **DB-11** | S-07, FIN-07 (transfers) | S-07 and FIN-07's transfer case (`stock.service.ts:224-259`) |
| **DB-13** | FIN-07 (WO) | FIN-07's work-order case (`workOrder.routes.ts:409,510`) |
| **DB-14** | FIN-08 (WO) | FIN-08's work-order payment case |
| **DB-15** | CU-01, FIN-08 (manual) | CU-01 and FIN-08's manual-credit case (`customer.routes.ts:128-143`) |
| **DB-16** | FIN-08 (PO) | FIN-08's PO overpayment case |
| **DB-17** | FIN-12 (reversal) | FIN-12's 'negative balance after cancellation' sub-defect |
| **DB-20** | U-09 (Ph2) | Phase 2 U-09 asked exactly this; Phase 4 measured it |
| **DB-21** | D-05 | D-05 is the same version-bump placement |
| **DB-23** | E-01 | E-01 (static) confirmed at runtime in Phase 4 |
| **DB-L02** | A-07 (related) | A-07 (health hides partial failures) is related but kept separate (different fix) |
| **E-02** | doc #1 | doc discrepancy #1 |
| **FIN-18** | F-07 | F-07 (JS-number money paths) is one of FIN-18's inconsistencies |
| **FIN-19** | F-03 | F-03 (audit log as ledger) is the cause of FIN-19 |
| **FIN-20** | IN-04, IN-03 (paidAmount) | IN-04 (overdue never written) and IN-03's frozen `paidAmount` are FIN-20 items |
| **S-03** | doc #5 | doc discrepancy #5 |
| **D-04** | FIN-P8 | FIN-P8 (negative values without 016) depends on the same NOT VALID constraints |
| **DB-24** | FIN-08 (dunning) | FIN-08's lost dunning counts |
| **DB-29** | C-03 | C-03 (static) confirmed at runtime |
| **DB-30** | F-03 (part) | part of F-03: the JSON ledger is also slow |
| **DB-31** | FIN-P9 | FIN-P9 (large carts exceed 5 s) is the same timeout budget |
| **DB-32** | D-03a, IN-03 (method) | D-03a and IN-03's payment-method half |
| **DB-33** | CU-03, doc #6 | CU-03 and Phase 1 doc discrepancy #6 |
| **DB-34** | D-03, D-03b, D-03c | D-03, D-03b and D-03c |
| **DB-37** | B-05 | B-05 (escalation by count) |
| **DB-L07** | J-07, HSEC-27, FIN-P3 | J-07, HSEC-27 and FIN-P3 all rest on the owner-less lock release |
| **DB-P02** | B-02, D-01, FIN-P4 | B-02, D-01 and FIN-P4 (several subscriptions per tenant; unordered `findFirst`) |
| **DB-P09** | FIN-P5 | FIN-P5 |
| **HSEC-10** | DB-L06 | DB-L06 (rotation race) is part of HSEC-10 |
| **HSEC-11** | W-03 | W-03 |
| **HSEC-12** | Z-02, T-06, F-06 (refund perm) | Z-02, T-06 and F-06's unused refund permission |
| **HSEC-13** | Z-03, Z-04, doc #10 | Z-03, Z-04 and doc discrepancy #10 |
| **HSEC-14** | S-05, P-03 | S-05 and P-03 |
| **HSEC-15** | AU-11 | AU-11 |
| **HSEC-16** | P-02 | Phase 1 P-02 (reproduced in Phase 1) |
| **HSEC-17** | AU-03 | AU-03 |
| **HSEC-22** | W-06 | W-06 |
| **HSEC-24** | W-04 | W-04 |
| **HSEC-26** | F-06 (branchId) | F-06's body-supplied `branchId` |
| **HSEC-29** | CU-02, S-02 | CU-02 and S-02 |
| **WO-02** | doc #17 | doc discrepancy #17 |
| **I-01** | doc #13 | doc discrepancy #13 |

**Kept separate on purpose** (related, but with different root causes or fixes):
- **HSEC-05 vs DB-26.** HSEC-05 is the missing tenant scope and authorization (RC-10). DB-26 is the duplicate send caused by check-then-send deduplication (RC-05).
- **DB-01 vs DB-03 / DB-04.** DB-01 is about *which* transition is legal (RC-02). DB-03 and DB-04 are about making a legal transition happen once (RC-01).
- **FIN-12 vs DB-17.** FIN-12 is the redemption arithmetic (independent). DB-17 is the reversal that ignores points already spent (RC-03).
- **A-07 vs DB-L02.** A-07 is the health signal. DB-L02 is serving traffic before migrating.

---

## 5. Root Cause Clusters

### 5.1 Verdicts on the candidate clusters (A–G)

| Cluster | Hypothesis | Verdict | Evidence |
|---|---|---|---|
| **A: non-atomic state transitions** | one READ → CHECK → WRITE pattern explains the races | **Mostly yes (RC-01), with exclusions.** Store credit, installment approval, cancellation, returns, PO receiving, work-order invoicing, transfers, PO and WO payments, trial expiry and `failedAttempts` all read their guard outside the write (13 operations unsafe at runtime). **Excluded: coupon and loyalty redemption, sale stock, negative stock adjustment and password reset.** These five already use conditional writes and were safe at runtime (S2, S3, S4; code for the other two). Subscription transitions are partly RC-01 (unconditional writes) and partly RC-02 (wrong rules) | `invoice.service.ts:258-265 → 313-320` (credit); `installment.service.ts:319 → 323`; vs safe `invoice.service.ts:327-334, 364-375, 410-416`; `stock.service.ts:85-94`; `auth.service.ts:177-186` |
| **B: missing idempotency** | many duplicate effects share "no durable idempotency boundary" | **Yes (RC-05)** for request and job replays: sales (DB-10), reminders (DB-26), ETA resubmission (DB-P09), overlapping cycles (DB-L07). **Payment retries are a separate, stronger root cause (RC-06):** Paymob charges have no server-side intent at all. The webhook itself *is* idempotent (B1) | no `Idempotency-Key` anywhere (grep); `renewal.job.ts:101` / `dunning.job.ts:110` new `Date.now()` order ids; `billing.service.ts:144-181` P2002 dedupe works |
| **C: invalid state-machine design** | cancel-after-cancel, approve-after-cancel and similar are symptoms of missing central transition rules | **Two things, both real.** "*After X, do X again*" (cancel ×2, return ×2, approve ×2) is RC-01: the rule exists, but it is checked on a snapshot. "*Doing Y when Y is illegal*" (approve a cancelled invoice, cancel a pending one, invoice a cancelled WO, dunning a paid subscription, suspending a valid trial) is **RC-02**: no rule exists, or it lives in another module | only work orders have a transition table (`workOrder.schema.ts:24-32`); invoices are blacklist-checked (`invoice.service.ts:569,702-710`); invoice status written from 3 modules (§24) |
| **D: financial mutation scattered** | one business action mutates many entities through independent paths | **Yes, and the deeper cause is RC-03.** Mutations *inside* a sale are atomic, but nothing records what each effect was. Reversals and reports therefore recompute: cancel re-derives quantities from lines (DB-01 phantom stock), refund re-derives money with a formula (FIN-02), credit and loyalty reversal re-read JSON audit rows (DB-30, FIN-19), day close and P&L re-derive from invoice totals (FIN-10/11), split tenders have no rows (FIN-15) | `invoice.service.ts:605-614, 722-738, 747-763`; `report.service.ts:399-455, 580-600` |
| **E: jobs vs user requests** | a shared "job race" root cause | **No independent root cause.** Each job defect is a combination of RC-01, RC-02 and RC-06: trial expiry = stale list + unconditional update (RC-01) on the wrong rule (RC-02); dunning = selection ignoring the paid period (RC-02) and no per-period payment record (RC-06); renewal = stale list (RC-01) + no intent (RC-06); reminders = check-then-send (RC-05); ETA = ignores invoice status (RC-02) | `trial-expiry.job.ts:115-132`; `dunning.job.ts:74-81`; `renewal.job.ts:76-165`; `installment-reminders.job.ts:119-154` |
| **F: tenant lifecycle atomicity** | partial provisioning and unrecoverable identifiers share one cause | **Yes (RC-07).** Provisioning and migration are multi-commit operations whose progress lives only in memory (the compensation `catch`, the version bump after commit). Reserved identifiers are unrecoverable because the reservation (the unique tenant row) is committed first and nothing resumes or reaps it | `tenant.service.ts:224-279`; `migrate-tenants.ts:95-107,121-143` |
| **G: infrastructure dependency failure** | independent issues, or one availability problem | **One problem (RC-08):** no failure or capacity budget. Redis waits forever, outbound HTTP has no timeout, the server has no request timeout, the database has no lock or statement timeout, and the pools sum past `max_connections`. Each fix is a small configuration change, and they belong together | `config/redis.ts:4-7`; `config/database.ts:16-42`; `paymob.client.ts:24-37`; `index.ts:42`; `docker-compose.prod.yml` |

Clusters not in the brief, confirmed by the evidence: **RC-04** (pricing ownership), **RC-09** (schema contract), **RC-10** (authorization default), **RC-11** (session registry).

### 5.2 Root Cause Matrix

| Root Cause | Findings (primary; secondary) | Severity (max) | Affected modules | Evidence | Confidence |
|---|---|---|---|---|---|
| **RC-01** Ad-hoc concurrency control | DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, DB-11, DB-12, DB-13, DB-14, DB-15, DB-16, DB-18, DB-19, DB-24, DB-27, D-04, DB-L03, DB-L08, DB-L09, DB-P10; *secondary: DB-01, DB-17* | P1 | invoices, installments, stock, purchase-orders, work orders, customers, billing, trial-expiry job, limit middleware | 13 runtime races (S1, S6–S10, S12–S16b, B2, B6); safe counter-examples S2–S4 | **High** |
| **RC-02** Implicit multi-writer state model | DB-01, DB-08, FIN-16, FIN-20, P-04, P-05, DB-25, DB-36, DB-37, DB-P02, NEW-01; *secondary: DB-03, DB-04, DB-19, DB-L03, FIN-L3* | P0 | invoices, installments, work orders, billing (service, routes, jobs, admin), tenant middleware | S11, B3, B4, B6, B7; writer map §24 | **High** |
| **RC-03** Effects not recorded | FIN-02, FIN-10, FIN-11, FIN-15, FIN-19, FIN-22, F-05, DB-17, DB-30, DB-P06; *secondary: DB-01, FIN-18* | P0 | invoices (sale, return, cancel), reports, customers | S11/S11b (reversal of effects that never happened), S20, P2-run; formulas `invoice.service.ts:605-614` | **High** |
| **RC-04** Server doesn't own pricing | FIN-01, FIN-05, FIN-06, FIN-14, FIN-18; *secondary: FIN-12, FIN-15* | P0 | POS, invoice and installment services, fee util, seed | `invoice.service.ts:209`; `POS.tsx:270-284`; `fee.ts:14` vs seed `'percent'`; `packages/shared` empty | **High** |
| **RC-05** No idempotency boundary | DB-10, DB-26, DB-L07, DB-P09; *secondary: FIN-L1, HSEC-05* | P1 | invoice routes, POS offline queue, jobs | B8; code (no key anywhere) | **High** |
| **RC-06** No payment intent | FIN-17, FIN-L1, FIN-L2, HSEC-21, B-03, DB-P01, FIN-L3, FIN-P6, FIN-P7; *secondary: DB-08* | P1 | billing service, routes, renewal and dunning jobs, Paymob client | B5; `billing.service.ts:92-198` (nothing persisted at checkout; amount not compared) | **High** (code); Paymob behaviour UNVERIFIED |
| **RC-07** Lifecycle without durable steps | DB-21, DB-22, DB-L02, A-07, DB-L10, DB-P03, DB-P07; *secondary: HSEC-19* | P2 | tenant service, migration runner, startup | M1, M2, M4, M6 | **High** |
| **RC-08** Unbounded waits / shared resources | DB-09, DB-20, DB-29, DB-31, B-07, A-01, DB-P08 | P1 | Redis config, DB client LRU, Paymob/ETA clients, server config | Redis experiment; P1-, P3-, P4-run | **High** |
| **RC-09** No single schema contract | DB-23, DB-32, DB-33, DB-34, E-07, D-06, DB-P04; *secondary: FIN-06* | P2 | ETA job, customer statement, Prisma tenant model, settings schema, plan seed | `prisma migrate diff`; EXPLAIN 42703 ×6 | **High** |
| **RC-10** Authorization opt-in per route | HSEC-01, HSEC-03, HSEC-04, HSEC-05, HSEC-12, HSEC-13, HSEC-14, HSEC-26 | P0 | `index.ts` sub-routes, billing, coupons, customers, reminders route, seed roles, feature middleware | route guard inventory (Phase 2 §5; re-verified §2) | **High** |
| **RC-11** No per-user session registry | HSEC-07, HSEC-10, M-02 | P1 | auth service, routes and middleware | refresh tokens keyed only by token (`auth.service.ts:68-123`); no user-update endpoint | **High** |

### 5.3 Root cause statements

- **RC-01.** A business rule is evaluated against data read before, or outside, the statement that changes it. The write then executes unconditionally (or as an absolute SET), so two concurrent requests both pass the rule. Under READ COMMITTED the second writer blocks on the first one's row lock and then proceeds. The same family also covers multi-row locks taken in client order with no retry (DB-18, DB-L09). **What is missing is a primitive, not knowledge:** five call sites already do it correctly.
- **RC-02.** Status is a free `VARCHAR`. Legality is checked by blacklist (`!== 'cancelled'`), the same status is written from several modules, and related entities (invoice ↔ contract ↔ work order; subscription ↔ tenant ↔ payment) are never checked against each other. Subscription semantics are also conflated:
  - one `failedAttempts` counter serves both renewal failures and checkout declines;
  - a period is "now + cycle", not an extension of the current period end;
  - dunning selects by counter rather than by unpaid period.
- **RC-03.** What a sale *did* (stock out per line, credit used, points earned or redeemed, money received per method, fee booked, financing booked) is not stored as typed, per-document records. Reversals, refunds, day close and P&L recompute from current mutable values, so they can't match what happened. They also reverse effects that never happened (pending invoices) and are slow (JSON audit scans).
- **RC-04.** The client sends prices and computes its own totals and fees, the server trusts the price, and the vocabulary (fee types) differs between seed, server and POS. With no shared module for calculation or enums, every rule exists twice and drifts.
- **RC-05.** Nothing durable identifies "this operation was already applied". A retried, replayed or overlapping request or job applies it again.
- **RC-06.** A SaaS charge is not represented before it happens: no "expected payment" row with tenant, period, amount, currency and provider order id. So the webhook can't verify the amount or the tenant binding, retries can't tell a charge already happened, and a paid period can't be recognised.
- **RC-07.** Provisioning and migrations are sequences of independent commits whose progress is kept in memory (a `catch` block; a version bump after commit). A crash leaves a state that nothing resumes or repairs.
- **RC-08.** Every wait (Redis command, outbound HTTP, request handling, row lock) and every pool is unbounded or unsummed. One dependency's failure becomes a platform-wide stall.
- **RC-09.** The tenant schema exists three times (SQL files, a hand-written Prisma model, raw SQL strings), and nothing verifies the three agree.
- **RC-10.** Routes are authenticated by default but authorised only when a developer adds `requirePermission`. The permission catalogue is coarse, and platform-wide actions are reachable from tenant routes.
- **RC-11.** A refresh session is an opaque Redis key with no index by user and no token family, so user lifecycle actions can't revoke it, and claims are never reloaded.

---

## 6. Root Cause Dependency Graph

Edges are drawn only where the code path is shared (file:line evidence in §5.2 and §33).

```
RC-01 Ad-hoc concurrency control (guard outside the write)
 ├─ Sales/Returns ── invoice.service.createInvoice / returnInvoice / cancelInvoice
 │    ├─ DB-02 credit −400 ........................ symptom: negative balance
 │    ├─ DB-05 double cancel ...................... symptom: double restock/credit
 │    ├─ DB-06 double return / return∥cancel ..... symptom: over-refund
 │    ├─ DB-18, DB-L09 deadlocks .................. symptom: failed checkouts
 │    └─ DB-P10 negative credit → negative discount
 ├─ Installments ── installment.service.approveContract / rejectContract / recordPayment
 │    ├─ DB-03 duplicate schedule   ├─ DB-04 lost reject   └─ DB-27 row paid twice
 ├─ Purchasing ── po.routes receive / payments
 │    ├─ DB-07 over-receipt         ├─ DB-12 WAC lost update   └─ DB-16 overpayment
 ├─ Inventory ── stock.service.approveTransfer ── DB-11 double move
 ├─ Work orders ── workOrder.routes invoice / payment ── DB-13 two invoices, DB-14 lost payment
 ├─ Customers ── customer.routes credit ── DB-15 lost update
 ├─ Billing/jobs ── billing.service failure, trial-expiry.job, renewal.job
 │    ├─ DB-24 lost decline count   ├─ DB-19 paid → PAST_DUE   └─ DB-L03 stale renewal list
 └─ Backstops missing ── D-04 (CHECKs NOT VALID; none for credit/loyalty/received/paid), DB-L08 limits

RC-02 Implicit multi-writer state model
 ├─ Invoice ↔ contract ↔ work order (3 modules write invoices)
 │    ├─ DB-01 = FIN-03 + FIN-04 (cancel/return pending; approval revives)
 │    ├─ NEW-01 cancelled WO invoice blocks re-invoicing   └─ DB-36 cancelled WO invoiceable
 ├─ Installment model ── FIN-20 (no overdue/settlement; paid frozen)
 └─ Subscription (billing.service ×5, billing.routes, trial-expiry.job, admin.routes ×3)
      ├─ DB-08 dunning charges paid/cancelled ── also RC-06
      ├─ FIN-16 = HSEC-08 unpaid trials keep access   ├─ DB-37 thresholds on any decline
      ├─ DB-25 CANCELLED revived / period = now+cycle ├─ DB-P02 several subscriptions
      └─ P-04 plan on tenant vs subscription          └─ P-05 two suspension mechanisms

RC-03 Effects not recorded (no allocations / effect records)
 ├─ Refunds ── FIN-02 formula over/under-refund
 ├─ Reversals ── DB-01 (phantom part), DB-17 negative loyalty, F-05 fee/financing not reversed,
 │               DB-30 JSON audit scan, DB-P06 movement without effect
 ├─ Ledgers ── FIN-19 credit ledger irreconcilable, FIN-15 split tenders, DB-32 (method not stored)
 └─ Reports ── FIN-10 P&L, FIN-11 day close, FIN-22 historical values move

RC-04 Server doesn't own pricing
 ├─ POS.tsx totals ── FIN-01 (amount due ≠ recorded), FIN-18 (display rounding)
 ├─ Client unitPrice ── FIN-05 = HSEC-02
 ├─ Vocabulary ── FIN-06 'percent' vs 'percentage' (also RC-09)
 └─ Browser-only rules ── FIN-14 coupon minimum

RC-05 No idempotency boundary ── DB-10 (=FIN-09, W-08), DB-26 reminders, DB-L07 overlapping cycles, DB-P09 ETA
RC-06 No payment intent ── FIN-17, HSEC-21, FIN-L1, FIN-L2, FIN-L3 → DB-P01, FIN-P6, FIN-P7, B-03; feeds DB-08
RC-07 Lifecycle without durable steps ── DB-21, DB-22, DB-L02, DB-L10, DB-P03, DB-P07, A-07; feeds HSEC-19 cost
RC-08 Unbounded waits/resources ── DB-09, DB-20, DB-29, DB-31, B-07, A-01, DB-P08; amplifies DB-10 (hang → retry)
RC-09 No schema contract ── DB-23 (=E-01), DB-32, DB-33 (=CU-03), DB-34, E-07, D-06, DB-P04; feeds FIN-06
RC-10 Authorization opt-in ── HSEC-01, HSEC-03, HSEC-04, HSEC-05, HSEC-12, HSEC-13, HSEC-14, HSEC-26
RC-11 No session registry ── HSEC-07, HSEC-10, M-02
```

**Cross-root-cause amplification** (each edge has evidence in the cited scenario):
- RC-08 → RC-05: a Redis hang makes users retry, and with no idempotency the retries duplicate (DB-09 → DB-10).
- RC-02 + RC-06 → DB-08: the wrong selection rule plus no per-period payment record produce double charges.
- RC-01 + RC-02 → DB-19: an unconditional write on the wrong rule makes a paid subscription dunning-eligible.
- RC-03 + RC-02 → DB-01: reversing unrecorded effects of an illegal transition.

---

## 7. Symptoms vs Root Causes

Every P0/P1 finding, classified. **SYMPTOM** means the finding is an outcome of a root cause and disappears when that root cause is fixed. **ROOT CAUSE** means the finding *is* a design decision or defect in its own right (an instance of an RC, or independent).

| Finding | Sev. | Class | Root cause | Reasoning |
|---|---|---|---|---|
| DB-01 (FIN-03/04) | P0 | SYMPTOM | RC-02 + RC-03 (+RC-01) | Phantom stock, credit on unpaid invoices and revived invoices are outcomes. The causes are no rule tying invoice to contract (RC-02), reversals computed from lines instead of recorded movements (RC-03), and an unconditional invoice update (RC-01) |
| FIN-01 | P0 | SYMPTOM | RC-04 | The POS displays its own total because the server's quote isn't the one shown |
| FIN-02 | P0 | SYMPTOM + local defect | RC-03 | Ignoring coupon, credit and loyalty happens because a refund isn't derived from what was paid. The double-subtracted line discount is a separate formula bug (`invoice.service.ts:610` vs `:225`) |
| FIN-05 (HSEC-02) | P0 | ROOT CAUSE (RC-04 instance) | RC-04 | Accepting a client price *is* the design decision |
| HSEC-01 | P0 | SYMPTOM | RC-10 | The missing permission follows from authorization being opt-in |
| DB-02 | P1 | SYMPTOM | RC-01 | Negative credit is the symptom of an unbounded decrement with no CHECK |
| DB-03 | P1 | SYMPTOM | RC-01 (+RC-02) | Duplicate schedules come from an unconditional transition with no unique key |
| DB-04 | P1 | SYMPTOM | RC-01 (+RC-02) | Lost reject comes from two unconditional transitions |
| DB-05 | P1 | SYMPTOM | RC-01 | Double reversal comes from an unconditional transition |
| DB-06 | P1 | SYMPTOM | RC-01 | Over-return comes from a cap read outside the transaction |
| DB-07 | P1 | SYMPTOM | RC-01 | Over-receipt comes from an outstanding quantity read outside the transaction |
| DB-08 | P1 | SYMPTOM | RC-02 + RC-06 | Double charge comes from the wrong selection rule plus no per-period payment record |
| DB-09 | P1 | ROOT CAUSE (RC-08 instance) | RC-08 | The shared client with `null` retries is the configuration defect itself |
| DB-10 (FIN-09) | P1 | ROOT CAUSE (RC-05 instance) | RC-05 | The missing key is the cause; duplicate invoices are its symptoms |
| FIN-06 | P1 | ROOT CAUSE (RC-04/RC-09 instance) | RC-04 | The vocabulary drift is the defect; zero fees are the symptom |
| FIN-10 | P1 | SYMPTOM | RC-03 | P&L recomputed from invoice totals |
| FIN-11 | P1 | SYMPTOM | RC-03 | Day close recomputed from invoice totals |
| FIN-12 | P1 | ROOT CAUSE (independent) | IND | Arithmetic in `loyalty.ts:44-49`: the discount is not reduced to the floored points |
| FIN-16 (HSEC-08) | P1 | SYMPTOM | RC-02 | No escalation path for a `PAST_DUE` subscription without a token, and a gate that ignores `PAST_DUE` |
| FIN-17 | P1 | SYMPTOM | RC-06 | Nothing to compare the amount against |
| HSEC-03 | P1 | SYMPTOM | RC-10 | Coarse permission catalogue |
| HSEC-04 | P1 | SYMPTOM | RC-10 | Authenticate-only routes |
| HSEC-05 | P1 | SYMPTOM | RC-10 (+RC-05) | Platform-wide action on a tenant route; the duplicates are RC-05 |
| HSEC-06 | P1 | ROOT CAUSE (independent) | IND | Missing output encoding in the email templates |
| HSEC-07 | P1 | SYMPTOM | RC-11 | Without a per-user registry, deactivation can't revoke sessions |
| FIN-L1 | P1 | SYMPTOM | RC-06 (+RC-05) | Charge without an intent; the retry has no idempotency |
| FIN-L2 | P1 | SYMPTOM | RC-06 | Signed success not checked against an expected amount or tenant |
| HSEC-18 | P1 | ROOT CAUSE (independent) | IND | Proxy configuration (`trustProxy`) |
| HSEC-19 | P1 | ROOT CAUSE (independent) | IND (+RC-07) | No abuse throttling; RC-07 makes each abandoned signup costly |
| HSEC-20 | P1 | ROOT CAUSE (independent) | IND | TLS issuance check |
| HSEC-21 | P1 | SYMPTOM | RC-06 | Tenant parsed from an unsigned field because no intent exists |

**Result:**

| Class | Count |
|---|---|
| Symptoms of an RC | 22 |
| RC instances (the finding is the design defect itself) | 4 (FIN-05, DB-09, DB-10, FIN-06) |
| Independent root causes | 5 |

---

## 8. P0 Root Causes

These root causes drive at least one P0 finding. Each is described with the seven required fields.

### RC-02 — Implicit, multi-writer state model
| Field | Detail |
|---|---|
| Current problem | Invoice status is written from 3 modules (invoices, installments, work orders), and subscription status from 4 modules / 10 sites. Legality is checked by blacklist on a snapshot. Related entities are never checked together: an installment invoice can be cancelled or returned while its contract lives on; approval revives a cancelled invoice; a cancelled work-order invoice blocks re-invoicing forever (NEW-01). Subscription rules conflate counters and periods, so paid subscriptions get dunned and unpaid trials never escalate |
| Root cause | No explicit transition table per entity and no single owner function per state change; cross-entity rules have no home |
| Recommended design | **One lifecycle module per stateful entity**: Invoice, InstallmentContract, WorkOrder, StockTransfer, PurchaseOrder, Subscription. Each owns that entity's status writes and exposes named transitions (`complete`, `cancel`, `return`, `approve`, `reject`, `renew`, `fail`, `expire`, `reactivate`). It contains: (1) an allowed-transition table (the WO table is the template); (2) the cross-entity rule applied in the same transaction (an invoice with a contract can't be cancelled or returned directly; approval requires the invoice to be `pending`; cancelling a WO invoice clears or refuses the WO link); (3) a status domain enforced in the DB (`CHECK (status IN …)`, NOT VALID then validated). For subscriptions: separate renewal-failure and checkout-decline counters; dunning only for an *ended, unpaid* period that isn't cancel-scheduled; periods extended from `max(now, current_period_end)`; explicit allowed sources for a payment success; an escalation path for token-less `PAST_DUE` matching the documented lifecycle (Overview §3.3). Routes and jobs call the module and stop writing status columns directly |
| Why it solves multiple findings | One rule location replaces ten scattered checks: DB-01, NEW-01, DB-36, FIN-20, DB-08 (with RC-06), FIN-16, DB-25, DB-37, DB-P02, P-04, P-05, and the legality half of DB-03, DB-04, DB-19 and FIN-L3 |
| Risks | visible behaviour changes needing product decisions (cancelling an installment sale goes through the contract; expired trials get restricted; the policy for a payment arriving on a `CANCELLED` subscription); existing rows already in illegal combinations need cleanup first (Phase 4 §38 queries) |
| Migration complexity | **Medium**: refactor of 4–6 modules; small DDL (status CHECKs); a data clean-up script for existing inconsistencies |
| Required tests | transition-matrix test per entity (each illegal pair rejected, each legal pair applied once); cross-entity tests (cancel or return a pending installment invoice → 409; approve after cancel → 409; cancel a WO invoice → WO consistent); subscription scenarios (paid + decline → not dunned; trial expiry ∥ payment → stays `ACTIVE`; token-less `PAST_DUE` → escalates per policy) |

### RC-03 — Financial effects aren't recorded as first-class entries
| Field | Detail |
|---|---|
| Current problem | Reversals, refunds and reports recompute what a sale did. Cancel restocks invoice lines even when nothing left the store; refund = a formula over line fields that ignores order-level discounts and credit; credit and loyalty reversal scan JSON audit rows; split tenders are two loose columns; day close and P&L sum invoice totals (tax included, WO revenue counted twice); fee expense and financing aren't reversed |
| Root cause | No typed, per-document record of effects: money received per method, credit used, points earned and redeemed, discount components, stock moved for *this* invoice |
| Recommended design | **Record each effect when it happens, in the same transaction**, and derive everything else from those records: (1) **reversal = what was recorded**. Reverse stock using the invoice's own `out` movements net of earlier reversals (the `stock_movements` table already exists and is written atomically); reverse credit and loyalty from typed columns on the invoice (`credit_used`, `loyalty_points_redeemed`, `loyalty_value_redeemed`, `loyalty_points_earned`) instead of JSON. (2) **payment allocation rows** (`invoice_payments`: invoice, method, amount, kind = sale / refund / down payment / installment / WO), which also store installment payment methods (DB-32). (3) **discount components** stored separately (coupon, product, credit, loyalty). (4) refunds computed from the line's recorded net share of what was actually paid. The cap (refund ≤ paid) is **not documented today** and needs owner confirmation (§19). (5) reports read allocations, movements and `cost_at_sale` |
| Why it solves multiple findings | FIN-02, FIN-10, FIN-11, FIN-15, FIN-19, FIN-22, F-05, DB-17, DB-30, DB-P06, and the money and stock half of DB-01 (a pending installment invoice has no `out` movements and no allocations, so reversing it restocks 0 and refunds 0) |
| Risks | historical invoices lack allocations (backfill one allocation per invoice from `payment_method_id` and the split columns, flagged as approximated); report figures change (they were wrong); refund policy needs a product decision |
| Migration complexity | **Medium–High**: 1–2 new tables, columns on invoices, a backfill, a rewrite of the report queries |
| Required tests | cancelling a pending installment invoice restocks 0; refund with coupon + credit + loyalty = recorded net share; day close = Σ allocations by method; a fixture month's P&L equals a hand-built ledger; cancel after the earned points were spent never produces a negative balance |

### RC-04 — The server doesn't own monetary calculation
| Field | Detail |
|---|---|
| Current problem | The server prices lines from the client's `unitPrice`. The POS computes its own total without tax or product discounts, and uses a different fee vocabulary (`'percent'`, matching the seed) from the server (`'percentage'`, matching the tests and the documentation). Coupon `minAmount` is enforced only in the browser |
| Root cause | Pricing rules exist twice (POS, server) with no shared module (`packages/shared` is empty) and no shared enums; the server trusts client values |
| Recommended design | **One pure pricing module** in `packages/shared`, used by the server (authoritative) and the POS (preview and offline): catalog price looked up server-side; product discounts clamped; coupon rules including `minAmount`; tax; fee by a shared enum; credit and loyalty application (with FIN-12's arithmetic corrected). The server ignores `unitPrice`, or accepts it only as an explicit override with a permission and an audit row (a product decision, Phase 3 U-04). A data migration rewrites seeded `percent` to `percentage`, plus a CHECK on `fee_type` |
| Why it solves multiple findings | FIN-01, FIN-05, FIN-06, FIN-14, FIN-18 (display), and part of FIN-12, FIN-13 and FIN-15 |
| Risks | offline POS: sales priced from a cached catalog must be re-validated on sync (accept with a recorded override, or flag); tenants who edited seeded methods (Phase 3 U-08) |
| Migration complexity | **Medium**: new package; POS refactor; one data migration |
| Required tests | parity test (shared module = server result for a fixture matrix of tax, discounts, coupon, fee, credit, loyalty); a mismatched client price is ignored or rejected; seeded methods produce the documented fees (1.75 %, 3 %); coupon below its minimum → 400 |

### RC-10 — Authorization is opt-in per route
| Field | Detail |
|---|---|
| Current problem | Tenant routes require only `authenticate` unless a developer adds `requirePermission`: settings, ETA credentials, branches, billing status / portal / cancel / resume (`index.ts:258-428`; `billing.routes.ts:93-182`). Permissions are coarse (coupons under `invoices:*`, credit under `customers:update`, both held by cashiers). A tenant route triggers the reminder cycle for **all** tenants. Sensitive fields are returned to broad roles |
| Root cause | Default-allow route registration; no permission catalogue tied to routes and seeded roles; no field-level response policy |
| Recommended design | **Default-deny registration**: a tenant-scope helper that refuses to register a route without `permission` (or an explicit `selfService` flag), so startup fails on an unguarded route. One permission catalogue shared by routes, seeded roles and the UI, with dedicated permissions for settings, ETA credentials, branches, billing, coupons, customer credit and refunds. Platform-wide actions are never reachable from tenant routes (the reminders trigger runs for the caller's tenant, under the job lock). Response DTOs omit card tokens and cost prices |
| Why it solves multiple findings | HSEC-01, HSEC-03, HSEC-04, HSEC-05, HSEC-12, HSEC-13 (entitlements declared the same way), HSEC-14, HSEC-26 |
| Risks | existing custom roles lose implicit access and need a role migration; UI gating must follow |
| Migration complexity | **Low–Medium** |
| Required tests | route-inventory test (every tenant route declares a permission; a snapshot of the route → permission map); role-matrix tests; reminders trigger touches only the caller's tenant; portal response contains no card token |

---

## 9. P1 Root Causes

### RC-01 — Ad-hoc concurrency control
| Field | Detail |
|---|---|
| Current problem | 13 operations failed at runtime under two concurrent calls (Phase 4: S1, S6–S10, S12–S16b, B2, B6). Each reads its guard outside the transaction (base-client `findUnique`), then writes with `update({ where: { id } })`, an unbounded `increment`, or an absolute SET. Multi-row writes lock rows in request order and are never retried (39/40 deadlocks) |
| Root cause | No shared primitive for guarded writes. Each path chose its own pattern; five already chose the conditional UPDATE (sale stock, coupon, loyalty, stock adjustment, password reset) |
| Recommended design | **A small guarded-mutation toolkit, used inside each domain transaction:** (1) `transition(tx, entity, id, from[], to)` = `UPDATE … WHERE id = $1 AND status = ANY($from)`, requiring count = 1 and otherwise raising `409 state_conflict` (also the mechanism RC-02 uses); (2) `adjust(tx, entity, id, column, delta, bounds)` = `UPDATE … SET c = c + $d WHERE id = $1 AND c + $d BETWEEN …`, requiring count = 1; (3) `lockParent(tx, entity, id)` = `SELECT … FOR UPDATE` before checking an aggregate rule (cumulative returns, outstanding receipts, WAC); (4) a canonical lock order (sort rows by id) plus a bounded retry on `40P01` / `40001` / `P2034`. Retrying the whole transaction is safe because a failed transaction rolls back completely (Phase 4 §6). **Database backstops:** `CHECK (credit_balance >= 0)`, `CHECK (loyalty_points >= 0)`, `CHECK (received_quantity <= quantity)`, `UNIQUE (contract_id, installment_number)`, and validating 016's NOT VALID CHECKs after cleanup. Bounds on PO and work-order paid amounts follow the existing code rules (`overpayment` check at `po.routes.ts:414`) |
| Why it solves multiple findings | One mechanism fixes 21 findings (DB-02..07, DB-11..16, DB-18, DB-19, DB-24, DB-27, DB-L03, DB-L08, DB-L09, DB-P10, D-04) and supplies the transition primitive RC-02 needs |
| Risks | duplicates that were silently accepted become `409`s (the UI must show them); CHECK violations must map to clean errors; existing rows that break the new constraints must be found and fixed first |
| Migration complexity | **Low–Medium**: mechanical changes at ~15 call sites (§24 writer list) + 1 DDL migration |
| Required tests | Phase 4's race scenarios as CI tests (two concurrent calls, 20 trials, invariant checks; §28) |

### RC-05 — No durable idempotency boundary
| Field | Detail |
|---|---|
| Current problem | A sale submitted twice (retry after a lost response, offline replay, two tabs, Redis-hang recovery) creates two invoices. Reminder cycles that overlap both send. ETA resubmission and overlapping job cycles repeat their effects |
| Root cause | Nothing durable records "this operation already happened". Webhook deduplication on `provider_transaction_id` is the only exception, and it works (B1) |
| Recommended design | An **`operation_keys` table per tenant schema** (`key` PK, `operation`, `request_hash`, `response`, `created_at`). The domain transaction inserts the key with `ON CONFLICT DO NOTHING`; on conflict it returns the stored response, and on a hash mismatch it returns 422. The POS generates one key per cart and keeps it with the offline queue entry. **Jobs use natural keys:** a reminder-log row `UNIQUE (payment_id, day)` inserted *before* sending; ETA submissions keyed by invoice. Redis locks are scheduling hints, never the correctness mechanism |
| Why it solves multiple findings | DB-10 (FIN-09, W-08, DB-L04), DB-26, DB-L07 (overlaps become harmless), DB-P09; also reduces FIN-L1 (with RC-06) and the duplicate half of HSEC-05 |
| Risks | key retention and cleanup; replayed responses must be scoped to the tenant (the table lives in the tenant schema) |
| Migration complexity | **Low–Medium** |
| Required tests | same key, sequential and concurrent → one effect, the second returns the first response; replay after a lost response → no duplicate; two reminder cycles → one email per payment per day |

### RC-06 — No server-side payment intent (SaaS billing)
| Field | Detail |
|---|---|
| Current problem | Checkout persists nothing. The webhook derives the tenant from an unsigned field and never compares the amount. Renewal and dunning charge before writing anything and use a new order id per attempt, so a retry after a post-charge failure charges again. Refunds and voids are ignored. A `FAILED` record blocks a later `SUCCESS` for the same transaction. A paid period can't be recognised, which feeds DB-08 |
| Root cause | No row represents an expected payment (tenant, subscription, period, amount, currency, provider order id) before it happens |
| Recommended design | A master **`subscription_payments`** (intent) table: `id`, `subscription_id`, `tenant_id`, `period_start`, `period_end`, `amount`, `currency`, `kind`, `status` (pending / succeeded / failed / refunded / voided), `provider_order_id` UNIQUE, `provider_transaction_id` UNIQUE, and `UNIQUE (subscription_id, period_start)` for renewal and dunning. **Flow:** create the intent → send its id as `merchant_order_id` → the webhook or charge response **settles the intent conditionally** (pending → succeeded / failed, via RC-01) and transitions the subscription in the same transaction (RC-02). The tenant and expected amount come from the intent. Jobs skip periods with a succeeded intent, and retries reuse the pending intent |
| Why it solves multiple findings | FIN-17, HSEC-21, FIN-L1, FIN-L2, FIN-L3, DB-P01, FIN-P6, FIN-P7, B-03; also removes the double-charge path of DB-08 and the period ambiguity of DB-25 |
| Risks | legacy Paymob semantics (Phase 2 U-05, Phase 3 U-03): order-id rules, pending / 3-DS responses, TOKEN callbacks; payments in flight at cut-over |
| Migration complexity | **Medium** |
| Required tests | amount mismatch → no activation; replay → no change; renewal retry after a post-charge DB failure → exactly one charge request (fake Paymob); FAILED then SUCCESS for one transaction → intent and subscription follow the defined transitions; manual checkout for an already-paid period → refused, or extends from period end |

### RC-08 — Unbounded waits and shared resources
| Field | Detail |
|---|---|
| Current problem | A Redis outage hangs every tenant request (one client shared with BullMQ, `maxRetriesPerRequest: null`). 50 tenant pools × 5 connections exceed `max_connections` 100 (17/110 failed). LRU eviction kills an in-flight transaction. Outbound Paymob and ETA calls, the HTTP server and database locks have no timeouts |
| Root cause | No explicit failure or capacity budget |
| Recommended design | **(1)** Separate Redis connections: BullMQ keeps `null` retries; the request path uses `maxRetriesPerRequest: 1`, `enableOfflineQueue: false` and a `commandTimeout`; cache errors fall back to the DB, and session lookups fail with a fast 503. **(2)** Timeouts: Fastify `requestTimeout`, `AbortSignal.timeout` on outbound fetch, and a DB role with `lock_timeout`, `statement_timeout` and `idle_in_transaction_session_timeout`. **(3)** Connection budget: `TENANT_DB_MAX × limit + master pools ≤ max_connections − reserve`, or PgBouncer in transaction mode. **(4)** LRU disposal with an idle grace instead of an immediate `$disconnect` |
| Why it solves multiple findings | DB-09, DB-20, DB-29, DB-31, B-07, A-01, DB-P08; also shrinks DB-10's retry trigger |
| Risks | **PgBouncer transaction mode breaks the migration runner's session advisory lock** (`migrate-tenants.ts:76` relies on a pinned connection), so migrations must keep a direct connection. Fail-fast errors need UI handling |
| Migration complexity | **Low** (configuration) to **Medium** (pooler) |
| Required tests | Redis unreachable → answer or 503 within 1 s; Paymob unreachable → job fails within the timeout and retries without a second charge (with RC-06); N busy tenants → no `too many clients`; eviction during a transaction → it completes |

### RC-11 — No per-user session registry
| Field | Detail |
|---|---|
| Current problem | Users can't be deactivated, re-roled or have their sessions revoked. Refresh rotation is non-atomic with no reuse detection. Role and permission claims live in the JWT and are never reloaded |
| Root cause | A refresh session is an opaque Redis key with no index by user and no token family |
| Recommended design | A session record per user (a Redis set or a DB table) with a token family and atomic consume (`GETDEL` or a conditional DB update); revocation on deactivation, password change and role change; a `token_version` / `is_active` check in `authenticate` (cached briefly) |
| Why it solves multiple findings | HSEC-07, HSEC-10, M-02 |
| Risks | one extra lookup per request (cache it); a one-time logout when storage changes |
| Migration complexity | **Medium** |
| Required tests | deactivated user → refresh fails and the access token is rejected after the cache TTL; concurrent refresh → one succeeds; reuse of a rotated token revokes the family; password change revokes other sessions |

---

## 10. P2 Root Causes

### RC-07 — Multi-step lifecycle without a durable step record
| Field | Detail |
|---|---|
| Current problem | Signup commits the tenant row, schema, 17 migration transactions, 12 seed writes, the activation and the trial separately; a crash leaves `PROVISIONING` with the subdomain and email locked forever (M6). The migration version is bumped outside the DDL transaction, and 001 / 002 / 016 can't be re-run (M1, M2). The server serves before migrating; the sweep skips `CANCELLED` and `PROVISIONING`; `/health` stays 200 on partial failure |
| Root cause | Progress lives in memory (a `catch` block; an after-commit update) instead of in a durable record that a retry or sweeper can resume |
| Recommended design | **Provisioning state on the tenant row** (`provisioning_step`, attempts, last error), with every step idempotent (`IF NOT EXISTS`, seed with `ON CONFLICT DO NOTHING`); the trial and `ACTIVE` in one master transaction; a sweeper that resumes or removes stale `PROVISIONING` rows (freeing the identifiers). **Migrations:** update `public.tenants.schema_version` **inside** the file's transaction (same database), compute pending files after taking the lock, make DDL idempotent, and gate each tenant's traffic until it is migrated (readiness), or migrate before `listen`. Include reactivated tenants. Report partial failures in readiness |
| Why it solves multiple findings | DB-21, DB-22, DB-L02, DB-L10, DB-P03, DB-P07, A-07; also caps HSEC-19's cost |
| Risks | sweeper races with a slow legitimate signup (use generous timeouts plus the step record); startup time if migrating before `listen` (prefer readiness gating) |
| Migration complexity | **Medium** |
| Required tests | SIGKILL at each provisioning step → retry completes or the sweeper cleans up; the version bump can't be lost; every migration file re-runs cleanly; two runners → one applies; an unmigrated tenant gets 503, not 500 |

### RC-09 — No single schema contract
| Field | Detail |
|---|---|
| Current problem | The ETA job's queries and inserts name columns that don't exist (42703 ×6); the customer statement selects a missing column; `installment_payments.payment_method_id` exists in SQL but not in Prisma; the tenant model differs from SQL in 722 diff lines; settings validation drops a UI field (E-07); the boot-time plan seed overwrites admin edits (D-06); seed vocabulary drifts from code (FIN-06) |
| Root cause | The tenant schema is written three times (SQL, a hand-written Prisma model, raw SQL strings), and CI checks only table names |
| Recommended design | **One source of truth:** keep the SQL migrations authoritative and **regenerate the Prisma tenant model from a migrated template schema** (`prisma db pull`, annotating `@db.Timestamptz` and FK actions to match SQL rather than the reverse). **CI:** migrate a scratch schema; `prisma migrate diff` must be empty; `EXPLAIN` every raw statement; replace raw SQL with Prisma where possible (ETA). Shared enums for vocabularies. Seed configuration only when absent |
| Why it solves multiple findings | DB-23, DB-32, DB-33, DB-34, E-07, D-06, DB-P04; also catches FIN-06-style drift |
| Risks | the first diff (722 lines) must be reviewed by hand; prefer annotating Prisma over altering SQL types |
| Migration complexity | **Low–Medium** |
| Required tests | CI drift check; raw-SQL EXPLAIN suite; the ETA job against a migrated schema with a fake ETA API |

---

## 11. P3 Root Causes

No root cause is P3-only; every RC drives at least one P2 finding. The P3 and INFO findings that remain are **independent hygiene items**, grouped by fix owner rather than by cause:

| Group | Findings |
|---|---|
| Web hardening (CSP backstop exists) | HSEC-22, HSEC-23, HSEC-24, HSEC-25 |
| Identity hygiene | HSEC-09, HSEC-11, HSEC-15, HSEC-17, AU-02, AU-05, P-01, P-07 |
| Operations and observability | A-08, I-01, D-07, D-08, P-06, M-01 |
| Data quality and features | DB-35, DB-38, FIN-24, FIN-P1, FIN-P2, S-01, S-08, S-09, T-03, T-04, WO-02, IN-05, DB-28, DB-L05, DB-P05 |
| Storage | HSEC-29 |

---

## 12. Atomicity Problems

**Inside a transaction, atomicity holds.** Phase 4 injected deadlocks, timeouts, CHECK violations, client disconnects and migration failures, and every one rolled back fully. The atomicity problems are all **across** transactions: an operation that is one business step but several commits.

| Operation | Commits today | Gap | Findings | RC |
|---|---|---|---|---|
| Tenant provisioning | 7+ (row, schema, 17 migration txs, 12 seed writes, activation, trial) | crash leaves an orphan | DB-22 | RC-07 |
| Tenant migration file | DDL tx, then a separate version update | lost bump → permanent failure | DB-21 | RC-07 |
| Manual credit adjustment | update, then a separate audit insert | balance changed without a ledger row | DB-15, FIN-19 | RC-01, RC-03 |
| PO payment / WO invoice | array/interactive tx, then a separate audit insert | missing audit row on crash | DB-16, DB-13 | RC-01 |
| WO payment | update, then audit | same | DB-14 | RC-01 |
| Renewal / dunning | **external charge**, then DB write | money taken, not recorded | FIN-L1 | RC-06 |
| Webhook | DB tx, then Redis invalidation, then email | stale cache; hangs if Redis is down | DB-09 | RC-08 |
| Trial expiry | update, then Redis delete, then email | stale status ≤ 30 s | DB-19 | RC-01 |
| Reminders | send, then audit | duplicate on retry | DB-26 | RC-05 |
| ETA | status `submitted`, then external call, then status | resubmission after a crash | DB-P09 | RC-05 |

**Missing from the sale boundary entirely:** nothing in `createInvoice` records the fee expense and financing in a way that cancel reverses (F-05). That is not a split transaction; it is a missing reversal (RC-03).

---

## 13. Idempotency Problems

| Trigger | Operations affected | Today | Required boundary | RC |
|---|---|---|---|---|
| Client retry after timeout or lost response | all creates (sales, contracts, payments, returns, receipts) | duplicates (no key) | `operation_keys` row in the business tx | RC-05 |
| POS offline replay (`POS.tsx:122-145`) | sales | replayed until HTTP success; tabs share the queue | key stored with each queued payload | RC-05 |
| Webhook replay | subscription payment | **safe** (unique transaction id) | keep it, and settle an intent | RC-06 |
| Worker retry (BullMQ, 3 attempts) | renewal and dunning cycles | re-charges after a post-charge failure | per-period intent; reuse the pending intent | RC-06 |
| Duplicate background execution (cron + manual trigger; lock overrun) | reminders, renewal, dunning | reminders duplicate (B8); charges protected only by timing | unique reminder log; per-period intent | RC-05, RC-06 |
| Migration re-run | DDL files 001, 002, 016 | fail on re-run | idempotent DDL + version in tx | RC-07 |
| Provisioning retry | signup | blocked (`subdomain_taken`) | resumable step record | RC-07 |

---

## 14. State Machine Problems

| Entity | Rule location today | Problems | RC |
|---|---|---|---|
| Invoice | blacklist checks in `invoice.service.ts:569,702-710`; status also written by installments and work orders | pending can be cancelled or returned (DB-01); cancelled can be revived (DB-01); WO invoice cancel leaves the WO linked (NEW-01) | RC-02 |
| Installment contract | `status !== 'pending_approval'` before the tx | double approval (DB-03); approve ∥ reject (DB-04); payment recorded on a cancelled contract (code); `overdue` never written, no settlement (FIN-20) | RC-01, RC-02 |
| Installment row | `already_paid` before the tx | paid twice accepted (DB-27) | RC-01 |
| Stock transfer / PO | status before the tx | double approval or receipt (DB-11, DB-07); edit ∥ approve (likely) | RC-01 |
| Work order | `ALLOWED_TRANSITIONS` (the only table), checked before the tx | concurrent transitions, last writer wins (likely); invoicing ignores status (DB-36) | RC-01, RC-02 |
| Subscription | spread over billing service, billing routes, trial-expiry job and admin routes | dunning of paid or cancel-scheduled (DB-08); trial expiry overwrites a payment (DB-19); `CANCELLED` revived (DB-25); thresholds hit valid trials (DB-37); unpaid trials never escalate (FIN-16); several subscriptions allowed (DB-P02) | RC-02 (+RC-01, RC-06) |
| Tenant | tenant service and admin routes | two suspension mechanisms (P-05); plan on tenant vs subscription (P-04); `PROVISIONING` dead end (DB-22) | RC-02, RC-07 |
| ETA status | ETA job and route (raw SQL) | every job fails before reaching ETA (DB-23) | RC-09 |

**The missing primitive is the same everywhere:** an allowed-transition table evaluated *inside* the UPDATE. The work-order module already has the table half; RC-01's `transition()` supplies the other half.

---

## 15. Concurrency Problems

The detail and measurements are in Phase 4 §10. The consolidated view:

| Pattern | Instances | Safe instances (same codebase) | RC |
|---|---|---|---|
| Guard read outside the tx, then an unconditional write | DB-03, DB-04, DB-05, DB-06, DB-07, DB-11, DB-13, DB-16, DB-19, DB-27, DB-L03, DB-L08 | — | RC-01 |
| Unbounded atomic decrement | DB-02 | sale stock, coupon, loyalty, stock adjustment (conditional) | RC-01 |
| Absolute SET from a stale read | DB-14, DB-15, DB-24, DB-12 (WAC) | settings PATCH (field-level, safe by design) | RC-01 |
| Unordered multi-row locks, no retry | DB-18, DB-L09 | — | RC-01 |
| Non-atomic Redis read-modify-write | HSEC-10 / DB-L06, DB-L05 | — | RC-11, IND |
| Count-then-create limits | DB-L08 | — | RC-01 |

**The double-spend models from earlier phases:**
- **Credit:** UNSAFE (−400, 20/20).
- **Loyalty:** SAFE.
- **Stock:** SAFE.
- **Coupon:** SAFE.
- **Installments:** not applicable as a double spend; double approval is the real defect.

---

## 16. Background Job Race Problems

**Not an independent root cause** (§5.1, cluster E). Every job defect combines the job's stale selection with RC-01, RC-02 or RC-06:

| Job | Races with | Mechanism | RC | Finding |
|---|---|---|---|---|
| Trial expiry (06:00) | checkout success | list once → unconditional update by id | RC-01 + RC-02 | DB-19 |
| Renewal (07:00) | cancel or payment during the loop | list once; no intent | RC-01 + RC-06 | DB-L03, FIN-L1 |
| Dunning (08:00) | an earlier decline; payment; cancel | selection ignores the paid period and `cancelAtPeriodEnd` | RC-02 + RC-06 | DB-08 |
| Cancel sweep (06:00) vs dunning (08:00) | cancel between 06:00 and 08:00 | dunning doesn't filter scheduled cancels | RC-02 | DB-08 (B7) |
| Reminders (09:00) | manual trigger; payment; cancellation | check-then-send; manual path skips the lock; contract status only | RC-05 + RC-10 | DB-26, HSEC-05, FIN-04 (reminders for cancelled sales) |
| ETA worker | invoice cancel | never reads invoice status | RC-02 | (moot until DB-23 is fixed) |
| Startup migration sweep | live traffic | serves before migrating; DDL locks | RC-07 | DB-L02 |

**Shared fix:** jobs call the same domain transitions as the HTTP routes (RC-02 + RC-01), so a job can only act if the state still allows it at write time. Charges go through an intent (RC-06).

---

## 17. Tenant Lifecycle Problems

| Stage | Problem | Finding | RC |
|---|---|---|---|
| Signup | unthrottled; each signup creates a schema | HSEC-19 | IND (+RC-07) |
| Provisioning | not resumable; orphan locks the identifiers; rollback drops a pre-existing schema | DB-22, DB-35 | RC-07, IND |
| Activation | `ACTIVE` before a subscription exists (window with no gate) | DB-22 (§24 in Phase 4) | RC-07 |
| Migration | version bump outside the tx; non-idempotent DDL; TOCTOU; `CANCELLED` skipped; serve before migrate; health hides partial failure | DB-21, DB-P03, DB-L10, DB-L02, A-07 | RC-07 |
| Suspension | tenant status vs subscription status, two mechanisms; a `SUSPENDED` *tenant* can't reach billing | P-05 | RC-02 |
| Plan change | tenant plan updated, subscription plan and price not | P-04 | RC-02 |
| Cached state | tenant JSON cached 300 s; stale write-back possible | DB-L05 | IND |

**One architectural cause for provisioning and migrations (RC-07):** progress is never persisted. The unrecoverable reserved identifiers are a direct consequence: the reservation (the unique row) is the first commit, and nothing ever resumes or reaps it.

---

## 18. Infrastructure Correctness Problems

**One availability problem (RC-08): nothing has a budget.**

| Resource | Today | Failure mode | Finding |
|---|---|---|---|
| Redis (cache, sessions, rate limiter, locks, BullMQ) | one client, `maxRetriesPerRequest: null`, offline queue on | every request hangs while Redis is down; burst on recovery | DB-09 |
| Postgres connections | 50 tenant clients × 5 + 2 master pools vs `max_connections` 100 | `too many clients` for all tenants | DB-20 |
| Tenant client lifecycle | LRU dispose calls `$disconnect()` immediately | in-flight transaction aborted | DB-29 |
| Interactive transactions | 5 s timeout, 2 s `maxWait`, pool 5, no DB-side timeouts | one stall fails the tenant | DB-31 |
| Outbound HTTP (Paymob, ETA) | `fetch` with no timeout | jobs stall up to the undici defaults; cycles outlive their locks | B-07, DB-L07 |
| Process model | HTTP, SPA and 5 workers in one process | one failure domain | A-01 |

The fixes are individually small configuration changes (§9, RC-08). The one interaction to watch: **a transaction-mode pooler breaks the migration runner's session advisory lock.**

---

## 19. Financial Invariants

Only invariants supported by **code** (a guard, comment or error code), a **DB constraint**, an **existing test**, or **documented behaviour** (`documents/Hesba_Project_Overview.md`, "Overview") are listed. Rules that an auditor might expect but that nothing in the repository states are listed separately, at the end, as *not documented*.

### Financial Invariants

| # | Invariant | Source | Current enforcement | Race safe? | Failure mode |
|---|---|---|---|---|---|
| 1 | Sale quantity ≤ branch stock | code `insufficient_stock` (`invoice.service.ts:364-375`); Overview §6.1 | conditional UPDATE in the sale tx | **Yes** (S3) | — |
| 2 | Stock never negative | CHECK `chk_stock_quantity_nonneg` (016, NOT VALID); Overview §7.7 | conditional decrements; transfers rely on the CHECK alone | Yes where 016 exists | transfer fails with a raw 23514 → 500; a schema without 016 could go negative (D-04) |
| 3 | Coupon uses ≤ `max_uses` | code `coupon_exhausted` (`:409-417`); Overview §6.1 | conditional raw UPDATE | **Yes** (S4) | — |
| 4 | Cancelling a sale releases its coupon use once | Overview §6.6; code `:715-720` | unconditional `GREATEST(n−1, 0)` | **No** | double cancel releases twice (S8) |
| 5 | Credit used ≤ customer balance | code cap (`:258-265`) | read before the tx | **No** | balance −400 (S1) |
| 6 | Credit balance ≥ 0 | code `insufficient_credit` (`customer.routes.ts:135`) | manual path only, on a stale read; no CHECK | **No** | negative (DB-02); erased by an absolute SET (DB-15) |
| 7 | Credit used ≤ invoice total | code (`:278`) | in-request | Yes | — |
| 8 | Redemption ≥ 100 points, ≤ balance, ≤ 50 % of the sale, ≤ amount owed | code (`:290-301`); `loyalty.ts`; `loyalty.test.ts`; Overview §6.3 | conditional decrement for the balance | **Yes** (S2) | discount larger than the consumed points' value (FIN-12) |
| 9 | Points consumed under the cap = floor(value used ÷ point value) | Overview §6.3; `loyalty.ts:44-47`; `loyalty.test.ts:16-22` | pure function | n/a | 0 points consumed for a positive discount (FIN-12) |
| 10 | Loyalty balance never negative | code comment (`invoice.service.ts:322-324`) | redemption only; the reversal is unconditional; no CHECK | **No** | −1,000 after cancelling the earning sale (S20) |
| 11 | Total = subtotal − product discounts − coupon (≤ subtotal) + tax (+ fee when the customer bears it) − credit − loyalty | Overview §6.1; code (`:207-304`) | server-side computation | n/a | the POS shows a different total (FIN-01); line prices come from the client (FIN-05) |
| 12 | Fee by type: none / percentage / fixed / both | Overview §6.2; `fee.ts:14-26`; `fee.test.ts` | server function | n/a | seeded `percent` → fee 0 (FIN-06) |
| 13 | Default card 1.75 %, valU 3 % | Overview §6.2 | seed data | n/a | computed as 0 (FIN-06) |
| 14 | All money in decimal.js, 4 dp HALF_UP | Overview §6; `decimal.ts`; `decimal.test.ts` | server helpers | n/a | JS-number paths (FIN-18); only loyalty earning loses a point |
| 15 | Cumulative returned ≤ sold, per variant | Overview §6.6; code ACC-02 (`:575-602`) | read before the tx | **No** | two full returns accepted (S9) |
| 16 | An invoice with a return can't be cancelled | Overview §6.6; code ACC-01 (`:705-710`) | count before the tx | **No** | return ∥ cancel both succeed (S10) |
| 17 | Cancel restores that invoice's stock, credit and loyalty, once | code comment (`:682-688`) | unconditional reversals computed from lines | **No** | doubled (S8); restores stock never removed (S11) |
| 18 | Σ schedule + down payment = contract total | Overview §6.4; code (`installment.service.ts:362-372`); `installment.math.test.ts` | computed at approval | Yes serially | doubled by double approval (S6) |
| 19 | Down payment ≤ total | Overview §6.4; `installment.math.test.ts` | validation at create | Yes | — |
| 20 | Installments are paid in order | code `previous_installments_not_paid` (`:450-453`) | pre-check on committed data | **Yes** (S5b) | — |
| 21 | Contract completes when every row is paid | code (`:469-478`) | in the payment tx | Yes | also completes a *cancelled* contract (no status check) |
| 22 | Contract cycle: `pending_approval` → active or rejected | Overview §6.4 | status read before the tx | **No** | approve ∥ reject (S7) |
| 23 | PO receipt ≤ outstanding quantity | code `qty_exceeds_outstanding` (`po.routes.ts:264-270`) | read before the tx | **No** | 20 of 10 received (S13) |
| 24 | PO payment ≤ remaining | code `overpayment` (`po.routes.ts:413-416`) | read before the tx | **No** | 2,000 paid on 1,000 (S16b) |
| 25 | Supplier liability = cost of the batch actually received | code comment (`po.routes.ts:349`) | in the receive tx | **No** | doubled by a double receipt (S13) |
| 26 | Weighted average cost formula | Overview §6.5; `cost.ts`; `cost.test.ts` | unlocked reads inside the tx | **No** | 250 vs 233.33 (S13b) |
| 27 | Cost frozen at sale | Overview §6.5; migration 017 | `cost_at_sale` at sale | Yes | pre-017 rows read the current cost (FIN-22) |
| 28 | One invoice per work order | code `already_invoiced` (`workOrder.routes.ts:409-411`) | pre-check; the partial unique points the wrong way | **No** | two invoices (S14) |
| 29 | Work-order status follows `ALLOWED_TRANSITIONS` | code (`workOrder.schema.ts:24-32`) | checked before the tx | No (likely) | last writer wins |
| 30 | Unique, sequential invoice numbers per tenant | UNIQUE + `invoice_number_seq`; Overview §4 | DB | Yes | gaps on rollback (DB-38); `SVC-` numbers differ (WO-02) |
| 31 | A provider transaction is processed once | UNIQUE `provider_transaction_id`; code comment; Overview §3.3 | P2002 → no-op | **Yes** (B1) | FAILED then SUCCESS for one id drops the success (DB-P01) |
| 32 | `SUSPENDED` / `CANCELLED` → 402 except auth and billing | Overview §3.2; `tenant.middleware.ts:103` | middleware | Yes | `PAST_DUE` is never blocked; token-less `PAST_DUE` never escalates (FIN-16) |
| 33 | Escalation at 3 / 7 / 14 failures; dunning every ≥ 3 days | Overview §3.3; `billing.service.ts:213-222`; `dunning.job.ts:31` | absolute SET of the counter | **No** | lost increments (B2); checkout declines counted (DB-37) |
| 34 | A cancel-scheduled subscription is not charged | code comment (`renewal.job.ts:70-72`) | renewal filter only | **No** | dunning still charges (B7) |
| 35 | Charge only when the paid period has ended | code filter and comment (`renewal.job.ts:65-67`) | renewal only | **No** | dunning charges a paid period (B4) |
| 36 | Plan quantity limits | Overview §3.2; `limit.middleware.ts` | count, then act | No (likely) | limits exceeded under concurrency (DB-L08) |
| 37 | A password-reset token is single-use | code (`auth.service.ts:172-186`) | conditional claim | **Yes** | — |
| 38 | A token's tenant = the resolved tenant | `authenticate.tenant-binding.test.ts` | middleware | **Yes** | — |

**Not documented anywhere** (need an owner decision before they become invariants):
- refund ≤ the amount actually paid for the line;
- work-order paid ≤ final total (the code says "Allows partial payments" with no ceiling);
- one active subscription per tenant;
- `Σ stock_movements` = `stock.quantity` (the Overview promises a "complete movement log", not an equality);
- supplier balance bounds;
- whether a payment arriving for a `CANCELLED` subscription reactivates it.

---

## 20. Data Ownership

| Value | Canonical store | Other representations | Writers | Synchronization risk |
|---|---|---|---|---|
| Stock quantity | `stock.quantity` | `stock_movements` (log); POS cart | **5 modules**: invoices (sale, return, cancel), installments (approve), stock (adjust, transfer), purchase orders (receive), products (bulk import) | movement logged with no quantity change (DB-P06); phantom restock (DB-01); no reconciliation |
| Product cost | `product_variants.cost_price` | `invoice_items.cost_at_sale` (snapshot) | PO receive (WAC), product edits | WAC lost update (DB-12); a manual edit can overwrite WAC; pre-017 sales read the live value (FIN-22) |
| Customer credit | `customers.credit_balance` | `audit_logs` `credit_used` / `credit_add` (JSON) | invoices (3 paths), customers (manual) | ledger irreconcilable (FIN-19); absolute SET (DB-15); negative (DB-02) |
| Loyalty points | `customers.loyalty_points` | `audit_logs` `loyalty_*` (JSON) | invoices (4 paths) | unconditional reversal (DB-17); JSON scan (DB-30) |
| Supplier balance | `suppliers.balance` | `supplier_transactions` | PO receive, PO payment, supplier routes | consistent (same tx), but both duplicated by DB-07 / DB-16 |
| Invoice total | `invoices.total_amount` | POS total (client-computed) | invoices, installments, work orders | the POS shows a different number (FIN-01) |
| Invoice paid | `invoices.paid_amount` | split columns; installment rows; `work_orders.paid_amount` | invoices (= total), installments (= down payment, frozen), work orders (= total) | not a payment ledger (FIN-11, FIN-20) |
| Installment balance | not stored (derive from `installment_payments`) | statement expects `remaining_amount` | installments | statement broken (DB-33) |
| Coupon usage | `coupons.used_count` | count of invoices with `coupon_id` | invoices (sale, cancel), coupons (edit, delete) | under-count after double cancel (S8); delete nulls history (DB-35) |
| Work-order paid | `work_orders.paid_amount` | its invoice's `paid_amount = total` | work orders | P&L counts both (FIN-10); lost update (DB-14) |
| PO paid | `purchase_orders.paid_amount` | Σ `purchase_payments` | PO routes | consistent writes; overpayment race (DB-16) |
| Subscription status | `subscriptions.status` | Redis `sub:status:<id>` (30 s); SPA cache; `tenants.status` | **4 modules / 10 sites** (billing service, billing routes, trial-expiry job, admin routes) | two suspension mechanisms (P-05); webhook's unordered `findFirst` vs the middleware's "latest" (DB-P02) |
| Tenant status | `tenants.status` | Redis `tenant:<sub>` (300 s, with plan) | tenant service, admin routes | stale write-back (DB-L05); provisioning rollback leaves the cache (DB-P07) |
| Plan | `tenants.plan_id` (features, limits) | `subscriptions.plan_id`, `price_at_subscription` (charges) | admin (tenant), billing (subscription), boot seed (plans) | limits and charges follow different plans (P-04); seed overwrites admin edits (D-06) |
| User permissions | `roles.permissions` | JWT claims (≤ 15 min); refresh payload | auth routes | stale claims (M-02); no revocation (HSEC-07) |
| Schema version | `tenants.schema_version` | actual DDL in the tenant schema | migration runner | diverges after a lost bump (DB-21) |
| ETA status | `invoices.eta_status` | `eta_submissions`; the ETA platform | ETA job, ETA route | submission history never written (DB-23) |
| Fee vocabulary | `payment_methods.fee_type` | POS `calculateFee`; server `fee.ts`; Overview §6.2 | seed, payment-method routes | three vocabularies (FIN-06) |

---

## 21. Cross-Phase Findings

The findings the brief named, plus all Phase 4 P0/P1 findings, re-checked against the code at `8846bce`.

| Finding | Still valid? (re-verified evidence) | Root cause | Related to | Independent? |
|---|---|---|---|---|
| HSEC-01 | **Yes**: `index.ts:258,275,344,381,412,420,428` use `authenticate` only (`POST /api/branches` adds only a plan limit) | RC-10 | HSEC-03, HSEC-04, HSEC-12; amplifies FIN-12 (any user can raise the point value) and HSEC-22 (print templates) | no |
| HSEC-02 | **Yes**: `const unitPrice = toDecimal(item.unitPrice)` (`invoice.service.ts:209`); same in `installment.service.ts:166` | RC-04 | = FIN-05 | no (merged) |
| HSEC-05 | **Yes**: `installment.routes.ts:216-224` calls `runReminderCycle()` (all ACTIVE tenants) outside `withLock` | RC-10 (+RC-05) | DB-26 (duplicate sends) | no |
| FIN-01 | **Yes**: POS `subtotal = Σ unitPrice × qty`, minus the coupon, plus the customer fee; **no tax, no product discount** (`POS.tsx:270-281`); amount due at `:849` | RC-04 | FIN-05, FIN-18 | no |
| FIN-02 | **Yes**: the line subtotal is already net of the line discount (`:225`) and the refund subtracts it again (`:610`); order-level coupon, credit and loyalty are ignored (`:605-614`) | RC-03 (+local formula) | DB-06 (multiplied by concurrent returns), DB-01 (return of a pending invoice) | partly (the formula bug) |
| FIN-03 | **Yes** (Phase 4 S11, S11b, runtime) | RC-02 + RC-03 | = DB-01 | no |
| FIN-04 | **Yes** (S11: approval revives the cancelled invoice); `invoice.service.ts` never references contracts (grep) | RC-02 | = DB-01; NEW-01 is the same gap for work orders | no |
| FIN-05 | **Yes** (see HSEC-02) | RC-04 | FIN-01, FIN-14 | no |
| FIN-06 | **Yes**: `fee.ts:14-26` matches `'percentage'`; the seed writes `'percent'` (`tenant.service.ts:168,171`); the POS matches `'percent'` (`POS.tsx:86`); `fee.test.ts:27-30` asserts `'percentage'`; Overview §6.2 documents 1.75 % / 3 % | RC-04 (+RC-09) | FIN-18 | no |
| FIN-07 | **Yes**, split into DB-03, DB-05, DB-06, DB-07, DB-11, DB-13 (all runtime) | RC-01 | DB-04, DB-27 | no |
| FIN-08 | **Yes**, split into DB-02, DB-14, DB-15, DB-16, DB-24 (all runtime) | RC-01 | DB-17 | no |
| FIN-09 | **Yes**: no idempotency key anywhere; replay at `POS.tsx:122-145` | RC-05 | = DB-10; amplified by DB-09 | no |
| FIN-10 | **Yes**: revenue = Σ `totalAmount` (tax included) + WO `paid_amount` by `paidAt`; refunds subtract only `returnType: 'refund'` (`report.service.ts:399-455`) | RC-03 | FIN-11, FIN-22, DB-14 | no |
| FIN-12 | **Yes**: `loyalty.ts:44-49` floors the points but returns the capped discount; `invoice.service.ts:326` skips the decrement when 0 points are used. The reversal half is DB-17 | IND (arithmetic) + RC-03 (reversal) | HSEC-01 (point value editable by anyone) | **arithmetic part independent** |
| FIN-16 | **Yes**: trial expiry → `PAST_DUE`, `failedAttempts` 1 (`trial-expiry.job.ts:121-132`); dunning requires a token (`dunning.job.ts:78`); the gate blocks only `SUSPENDED`/`CANCELLED` (`tenant.middleware.ts:103`) | RC-02 | = HSEC-08; DB-19, DB-37 | no |
| DB-01 | Yes (runtime) | RC-02 + RC-03 + RC-01 | FIN-03, FIN-04, NEW-01 | no |
| DB-02 | Yes (runtime, 20/20) | RC-01 | DB-15, DB-P10 | no |
| DB-03 / DB-04 | Yes (runtime) | RC-01 + RC-02 | FIN-07 | no |
| DB-05 / DB-06 / DB-07 | Yes (runtime) | RC-01 | FIN-07; FIN-02 for DB-06 amounts | no |
| DB-08 | Yes (selection reproduced; checkout orders are `sub_<tenantId>_<ts>`, `paymob.client.ts:105`, so checkout declines feed the same counter) | RC-02 + RC-06 | DB-37, DB-25, FIN-P7 | no |
| DB-09 | Yes (experiment) | RC-08 | DB-10 (retry amplification), HSEC-28 | no |
| DB-10 | Yes (code) | RC-05 | FIN-09, DB-09 | no |
| DB-21 / DB-22 | Yes (runtime) | RC-07 | A-07, HSEC-19 | no |
| DB-23 | Yes (runtime EXPLAIN) | RC-09 | E-01, E-02 | no |

**No named finding failed re-verification.** The only corrections are FIN-23 and the Phase 3 sub-claim (§31).

---

## 22. Single Fix → Many Findings

### Single Fix → Many Findings

| Root Cause (fix) | Findings Resolved | Findings Reduced | Findings Remaining (need their own fix) | Evidence |
|---|---|---|---|---|
| **RC-01** guarded-mutation toolkit + DB backstops | DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, DB-11, DB-12, DB-13, DB-14, DB-15, DB-16, DB-18, DB-19, DB-24, DB-27, DB-L03, DB-L08, DB-L09, DB-P10, D-04 | DB-01 (the unconditional approval becomes refusable), DB-17 (a CHECK stops negatives; the policy is still needed) | DB-01's rule (RC-02), DB-17's policy (RC-03), DB-08 (RC-02/06) | 13 runtime races; 5 safe counter-examples (§5.1 A) |
| **RC-02** explicit state model, one owner per entity | DB-01 (legality), NEW-01, DB-36, FIN-20, FIN-16, DB-25, DB-37, DB-P02, P-04, P-05 | DB-08 (with RC-06), DB-03 / DB-04 / DB-19 (legality), FIN-L3 | race mechanics (RC-01); payment binding (RC-06) | S11, B3, B4, B6, B7; writer map §24 |
| **RC-03** record effects, reverse what was recorded | FIN-02 (order-level part), FIN-10, FIN-11, FIN-15, FIN-19, FIN-22, F-05, DB-17, DB-30, DB-P06 | DB-01 (phantom stock and credit become 0), FIN-18 (discount components), DB-32 (method stored on the allocation) | FIN-02's formula error; FIN-12's arithmetic | S11b, S20, P2-run; `report.service.ts` |
| **RC-04** server-owned pricing in a shared module | FIN-01, FIN-05, FIN-06, FIN-14, FIN-18 (display) | FIN-12 (if the module recomputes the discount), FIN-13 (clamps), FIN-15 (split validation) | FIN-13's configuration validation | `POS.tsx:270-281`; `invoice.service.ts:209`; `fee.ts` vs seed |
| **RC-05** durable idempotency boundary | DB-10, DB-26, DB-L07 (overlaps harmless), DB-P09 | FIN-L1 (with RC-06), HSEC-05 (duplicate part), DB-L04 | HSEC-05's scope (RC-10) | B8; no key anywhere |
| **RC-06** payment intent per subscription period | FIN-17, HSEC-21, FIN-L1, FIN-L2, FIN-L3, DB-P01, FIN-P6, FIN-P7, B-03 | DB-08, DB-25, DB-P02 | DB-08's selection rule (RC-02) | B5; `billing.service.ts:92-198` |
| **RC-07** durable lifecycle steps | DB-21, DB-22, DB-L02, DB-L10, DB-P03, DB-P07, A-07 | HSEC-19 (abandoned signups reaped) | HSEC-19's throttling (independent) | M1, M2, M4, M6 |
| **RC-08** failure and capacity budget | DB-09, DB-20, DB-29, DB-31, B-07, DB-P08, A-01 | DB-10 (fewer hang-then-retry duplicates), DB-18 (bounded waits) | — | Redis experiment; P1-, P3-, P4-run |
| **RC-09** single schema contract + CI | DB-23, DB-32, DB-33, DB-34, E-07, DB-P04, D-06 | FIN-06 (drift detected) | E-02 (ETA auto-enqueue is a feature gap) | `migrate diff`; EXPLAIN |
| **RC-10** default-deny authorization | HSEC-01, HSEC-03, HSEC-04, HSEC-05, HSEC-12, HSEC-13, HSEC-14, HSEC-26 | HSEC-06 (receipt sending becomes permissioned), DB-26 (trigger moved under the lock) | HSEC-06's escaping | route inventory |
| **RC-11** per-user session registry | HSEC-07, HSEC-10, M-02 | HSEC-11, AU-02 | — | `auth.service.ts:68-123` |

**Reading the table:**
- The three largest single fixes are RC-01 (21 resolved), RC-02 (10) and RC-03 (10).
- The highest *risk* reduction per unit of effort is RC-10, which is low complexity and covers a P0 plus three P1s.
- RC-08's configuration changes are also small.

---

## 23. Architectural Boundaries

**Goal:** each business operation runs as **one** database transaction containing its guard, its effects, its effect records and its idempotency key. External calls happen outside that transaction, bracketed by a durable intent. No microservices: the boundaries are function boundaries inside the existing monolith.

### Domain Transaction Boundary

| Domain operation | Current boundary | Required atomic boundary | Current risk |
|---|---|---|---|
| **Sale** | one interactive tx (credit, points, invoice, items, stock, coupon, fee, financing, number, audit); credit cap, prices and coupon checks read **before** it; no key | same tx **plus**: bounded credit decrement; server-computed quote; idempotency key row; effect records (allocations, credit and loyalty columns); canonical lock order | DB-02, DB-10, DB-18, FIN-05, FIN-01 |
| **Purchase (PO create / edit / approve)** | edit tx with the draft check outside; approve is an unconditional update | conditional transitions (`draft` → `approved`; edit only `WHERE status = 'draft'`) | edit ∥ approve (likely) |
| **Return** | tx for return rows, restock and credit; cumulative cap read outside; invoice not locked | lock the invoice row → recompute cumulative returns → refund from recorded paid shares → conditional returned state | DB-06, FIN-02, DB-01 |
| **Refund (cash)** | the return row only; no money record | an allocation reversal row in the same tx | FIN-11, FIN-02 |
| **Cancel** | tx; status read outside; reversal from lines and JSON audit; fee and financing untouched | conditional transition first → reverse recorded effects (movements, allocations, effect columns, fee expense, financing) → refuse if a contract or returns exist (checked inside) | DB-05, DB-01, DB-30, F-05 |
| **Installment approval** | tx; contract status read outside; invoice updated unconditionally | conditional transitions on **both** contract (`pending_approval` → `active`) and invoice (`pending` → `completed`); unique schedule key; down payment recorded as an allocation | DB-03, DB-04, DB-01 |
| **Installment rejection** | tx; status read outside | conditional transition on both entities | DB-04 |
| **Installment payment** | tx; `already_paid` read outside; method not stored; contract status not checked | conditional row transition; contract must be `active`; allocation row with the method | DB-27, DB-32 |
| **PO receiving** | tx; outstanding read outside; WAC from unlocked reads | lock the PO (and the variant, for WAC) → recompute outstanding → bounded increments | DB-07, DB-12 |
| **PO payment** | array tx; remaining read outside; audit after | bounded conditional increment + audit row in the same tx | DB-16 |
| **Stock transfer approval** | tx; status and availability read outside | conditional transition + conditional decrement, in id order | DB-11 |
| **Work-order completion (invoice)** | tx + audit after; `invoiceId` read outside; status ignored | conditional link `WHERE invoice_id IS NULL` + status in (`ready`, `delivered`) inside the tx; invoice cancel clears or refuses the link | DB-13, DB-36, NEW-01 |
| **Work-order payment** | no tx; absolute SET | tx with a bounded increment + audit | DB-14 |
| **Customer credit adjustment** | no tx; absolute SET | bounded delta + ledger entry + audit in one tx | DB-15, FIN-19 |
| **Subscription payment (webhook)** | array tx (attempt + subscription), then cache, then email | settle the **intent** conditionally and transition the subscription in one tx; amount, currency and tenant from the intent | FIN-17, HSEC-21, DB-25, DB-P01 |
| **Renewal / dunning charge** | no tx: charge, then write | intent (pending) committed **before** the charge → charge with the intent id → settle conditionally; skip periods already paid | FIN-L1, DB-08, DB-L03 |
| **Trial expiration** | per-row unconditional update after a stale list | conditional transition `WHERE status = 'TRIALING'` | DB-19, FIN-16 |
| **Subscription cancel / resume / admin actions** | single updates after a pre-read | conditional transitions in the billing owner module | lost-update risk vs webhook (likely) |
| **Tenant provisioning** | 7+ independent commits | durable step record; idempotent steps; trial + `ACTIVE` in one master tx; sweeper | DB-22 |
| **Tenant migration (per file)** | DDL tx; version updated separately | DDL + `schema_version` in **one** tx | DB-21 |

---

## 24. State Transition Ownership

Writers were enumerated by grep over `apps/api/src` for every create, update, upsert and raw-SQL write of each column (call sites at `8846bce`).

### State Ownership

| Entity / column | Current writers (file:line) | Required owner | Risk |
|---|---|---|---|
| `invoices.status` | **3 modules**: `invoice.service.ts:336` (create `completed`), `:845` (cancel); `installment.service.ts:230` (create `pending`), `:329` (approve `completed`), `:419` (reject `cancelled`); `workOrder.routes.ts:456` (create `completed`) | **Invoice lifecycle** module; installments and work orders call `complete`, `cancel` and `return` | DB-01 (approval revives a cancelled invoice), NEW-01, DB-36 |
| `invoices.paid_amount` | `invoice.service.ts:354` (= total); `installment.service.ts:331` (= down payment, then frozen); `workOrder.routes.ts:473` (= total) | derived from payment allocations (RC-03) | FIN-11, FIN-20 |
| `invoices.eta_status` | `eta-submission.job.ts:93,114,170,188,194,217`; `eta.routes.ts:27` (raw SQL) | ETA module (already single), via Prisma | DB-23 |
| `installment_contracts.status` | `installment.service.ts:271` (create), `:323` (approve), `:415` (reject), `:474` (complete) | Contract lifecycle module (already single), using conditional transitions | DB-03, DB-04; completes a cancelled contract |
| `installment_payments.status` | `installment.service.ts:375` (create), `:458` (pay) | same module | DB-27 |
| `stock.quantity` | **5 modules**: `invoice.service.ts:364,638,724`; `installment.service.ts:337`; `stock.service.ts:85,254,272`; `po.routes.ts:310`; `product.routes.ts:568` (import) | **Inventory** module exposing `move(variant, branch, delta, reason, reference)`, which writes stock + movement together, bounded and in id order | DB-11, DB-18, DB-P06, DB-01 |
| `product_variants.cost_price` | `po.routes.ts:316-318` (WAC); `product.service.ts:171,206` and `product.routes.ts:554` (create / edit) | Inventory cost owner; receiving locks the variant | DB-12; a manual edit can overwrite WAC (likely) |
| `customers.credit_balance` | **2 modules**: `invoice.service.ts:316` (sale), `:659` (return), `:769` (cancel); `customer.routes.ts:142` (manual, absolute) | **Customer ledger** module: entry + bounded balance update | DB-02, DB-15, FIN-19 |
| `customers.loyalty_points` | `invoice.service.ts:329` (redeem), `:470` (earn), `:794` (reverse), `:821` (refund redeemed) | same ledger module | DB-17 |
| `coupons.used_count` | `invoice.service.ts:411` (sale), `:717` (cancel); `coupon.routes.ts:58,77,91` (create / edit / delete) | Coupon owner (sale and cancel go through it) | S8 under-count; DB-35 |
| `suppliers.balance` | `po.routes.ts:362` (receive), `:445` (payment); `supplier.routes.ts:208` (manual) | Supplier ledger (`supplier_transactions` is already written in the same tx) | duplicated by DB-07 / DB-16 |
| `purchase_orders.*`, `purchase_order_items.received_quantity` | `po.routes.ts:63,163,201,217,333,371,429` | PO lifecycle (already single module) | DB-07, DB-16 |
| `work_orders.status / paid_amount / invoice_id` | `workOrder.routes.ts:126,157,234,284,353,377,510,547` | WO lifecycle (already single), plus the invoice-cancel hook | DB-13, DB-14, NEW-01 |
| `stock_transfers.status` | `stock.service.ts:198,232,297` | Inventory (already single) | DB-11 |
| `subscriptions.*` | **4 modules / 10 sites**: `billing.service.ts:49` (trial), `:158` (success), `:238` (failure), `:310` (cancel), `:338` (sweep); `billing.routes.ts:199` (resume); `trial-expiry.job.ts:121` (expiry; `:107` reminder counter); `admin.routes.ts:532` (extend trial), `:579` (cancel), `:622` (reactivate) | **Subscription lifecycle** module (billing service) with a transition table; jobs and admin call it | DB-08, DB-19, DB-25, DB-37, FIN-16 |
| `subscriptions.failed_attempts` | `billing.service.ts:162,241`; `trial-expiry.job.ts:125`; `admin.routes.ts:538,626` | same owner; split into renewal-failure and checkout-decline counters | DB-24, DB-37, DB-08 |
| `tenants.status` | `tenant.service.ts:224,264`; `admin.routes.ts:298` | Tenancy module | P-05, DB-22 |
| `tenants.plan_id` vs `subscriptions.plan_id` | `admin.routes.ts:332` (tenant only); `billing.service.ts:49` (subscription at trial) | one owner (the subscription), with the tenant plan derived | P-04 |
| `tenants.schema_version` | `migrate-tenants.ts:104-107` | migration runner, inside the DDL tx | DB-21 |

**Pattern:** the entities with a *single* writing module (contracts, POs, work orders, transfers) still fail under concurrency (RC-01). The entities with *several* writing modules (invoice status, stock, credit, subscriptions) additionally fail on legality (RC-02). The ownership fix and the guard fix are complementary, not alternatives.

---

## 25. Side-Effect Ownership

For each operation: every effect, where it is written, whether it is in the operation's transaction, whether a retry duplicates it, and whether cancel or return reverses it.

**Sale** (`createInvoice`)

| Side effect | Where | Same tx | Retry duplicates | Reversed by cancel | Reversed by return |
|---|---|---|---|---|---|
| credit decrement | `invoice.service.ts:313-320` | yes | **yes** | yes (via JSON audit, `:765-788`) | no (a return issues new credit from the refund formula) |
| loyalty redemption | `:326-334` | yes | **yes** | yes (`:816-841`) | **no** |
| invoice + items | `:336-389` | yes | **yes** | status → `cancelled` | return rows |
| stock decrement + `out` movement | `:364-400` | yes | **yes** | yes, recomputed from lines | yes (selected lines) |
| coupon usage +1 | `:409-417` | yes | **yes** | yes (floored −1) | **no** |
| fee expense | `:420-429` | yes | **yes** | **no** (F-05) | **no** |
| external financing | `:432-441` | yes | **yes** | **no** (F-05) | **no** |
| invoice number | `:448-455` | yes (the sequence ignores rollback) | **yes** | n/a | n/a |
| loyalty earned | `:457-477` | yes | **yes** | yes, unconditional (DB-17) | **no** (points kept on returns) |
| ledger audit rows | `:480-547` | yes | **yes** | adds reversal rows | adds return audit |
| ETA submission | none (manual route only, E-02) | — | — | — | — |

**Installment approval** (`approveContract`)

| Side effect | Where | Same tx | Retry duplicates | Reversed by cancel / return of the invoice | Reversed by contract action |
|---|---|---|---|---|---|
| contract → `active` | `installment.service.ts:323-326` | yes | **yes** (DB-03) | **no** (contract untouched, FIN-04) | no cancel endpoint for active contracts |
| invoice → `completed`, paid = down payment | `:329-332` | yes | yes | cancel → `cancelled` | — |
| stock decrement + movements | `:335-360` | yes | **yes** (double) | cancel / return restock lines | — |
| N schedule rows | `:367-384` | yes | **yes** (2N) | **no**: rows remain and reminders continue | — |
| audit | `:386-394` | yes | yes | — | — |
| down-payment money record | **none** | — | — | — | — |

**Installment payment** (`recordPayment`)
- **Effects:** the row is marked `paid` (`:458-466`); the contract is completed when it is the last row (`:469-478`); an audit row is written (`:480-488`). All three are in the same tx.
- **Retry:** accepted again (DB-27).
- **Payment method:** dropped (DB-32).
- **Reversal:** no reversal path exists.

**PO receiving**
- **Effects:** stock upsert + `in` movement, WAC cost, received quantity, receipt, supplier transaction, supplier balance, PO status and audit (`po.routes.ts:293-392`).
- **Atomicity:** all in one tx ✓.
- **Retry:** duplicates everything (DB-07).
- **Reversal:** none. There is no PO cancel or return-to-supplier (PO-01).

**Work-order invoice**
- **Effects:** invoice + lines + number + WO link in the tx (`workOrder.routes.ts:455-513`); the audit row is written after it (`:515`).
- **Retry:** creates a second invoice (DB-13).
- **Cancelling that invoice** (generic `cancelInvoice`) skips service lines correctly but **never clears `work_orders.invoice_id`**, so the work order can never be re-invoiced (NEW-01). Meanwhile WO payments stay in `work_orders.paid_amount`, which the P&L also counts (FIN-10).

**Subscription payment** (webhook success)
- **Effects:** attempt insert + subscription update (array tx, `billing.service.ts:145-174`), then cache invalidation and email.
- **Retry with the same transaction id:** no-op ✓.
- **A different transaction:** resets the period to now + cycle (DB-25).
- **Reversal:** none for refunds or voids (B-03).

**Trial expiration**
- **Effects:** reminder emails, then counter (explicit value, idempotent ✓); expiry update (`PAST_DUE`, `failedAttempts` 1), then Redis delete, then email; scheduled-cancellation sweep.
- **Re-running** re-applies the same values, but if the subscription was paid in between it overwrites `ACTIVE` (DB-19).

**What this shows:**
- Within each operation, effects are atomic.
- **Retries duplicate every effect** (RC-05).
- **Reversals cover only some effects:**
  - cancel misses the fee expense and the financing record;
  - a return misses loyalty and the coupon;
  - nothing reverses an installment approval;
  - nothing reverses a PO receipt.

  And reversals are **recomputed** rather than read from what was recorded (RC-03).

---

## 26. Recommended Target Architecture

**Keep the modular monolith, the schema-per-tenant layout, Prisma, BullMQ and Postgres.** The target adds a thin domain layer and a few tables. It does **not** require microservices, Kafka, event sourcing, CQRS, distributed transactions, a workflow engine, or Redis locks as a correctness tool. None of the findings needs them: every invariant here fits in one Postgres transaction.

```
HTTP route / job / admin action
        │  (permission declared at registration — RC-10)
        ▼
Domain operation (one per business action)          e.g. sales.cancelInvoice(cmd)
  withTenantTx(db, { idempotencyKey }) {            — RC-05: operation_keys row in the same tx
    guard:   transition() / adjust() / lockParent() — RC-01 primitives (conditional SQL)
    rules:   entity transition table + cross-entity checks — RC-02 (owner module)
    effects: inventory.move(), ledger.post(), allocations.add() — RC-03 (recorded effects)
    price:   pricing.quote(cart) from packages/shared — RC-04
  }
        │  after commit (outside the tx)
        ▼
External calls via a durable intent row — RC-06 (payments); ETA keyed by invoice — RC-05
```

| Building block | Purpose | Replaces |
|---|---|---|
| `transition`, `adjust`, `lockParent`, ordered locking + retry (RC-01) | race-safe guards in SQL | 15+ ad-hoc pre-reads |
| Lifecycle modules with transition tables (RC-02) | one owner per status column | 3–10 writers per status |
| Effect records: `stock_movements` (exists) as the reversal source, `invoice_payments` allocations, typed effect columns on invoices, a credit ledger (RC-03) | reversals, refunds and reports read what happened | formulas, JSON audit scans |
| `packages/shared/pricing` + shared enums (RC-04) | one calculation for the POS and the server | duplicated POS logic; client prices |
| `operation_keys` per tenant; natural-key dedupe rows for jobs (RC-05) | exactly-once effects per request | nothing |
| `subscription_payments` intents in master (RC-06) | bind every charge to tenant, period and amount | `merchant_order_id` parsing |
| Provisioning step record + sweeper; version-in-tx migrations (RC-07) | crash-safe lifecycle | in-memory `catch` |
| Separate Redis connections, timeouts, a pool budget, DB `lock_timeout` / `statement_timeout` (RC-08) | bounded failure | unbounded waits |
| Migrated-template → Prisma model; `migrate diff` + EXPLAIN in CI (RC-09) | one schema contract | three drifting copies |
| Default-deny route registration + permission catalogue (RC-10) | authorization by construction | opt-in `requirePermission` |
| Per-user session registry with token families (RC-11) | revocation and deactivation | opaque refresh keys |

**Outbox:** not required for any P0/P1. Post-commit side effects today are emails, cache invalidation and a manual ETA enqueue, all tolerable or covered by RC-05 deduplication. Introduce an outbox only when ETA auto-submission is implemented (E-02), so that "invoice committed" and "submission enqueued" can't diverge.

---

## 27. Remediation Roadmap

**Ordering rules:**
1. Enablers first: the RC-01 primitives (RC-02 is built on them) and the RC-09 CI check (it catches drift introduced by every later change).
2. Then the root causes behind P0 findings.
3. Then P1, then P2.

The independent P1 items are small and ship alongside.

| Wave | Contents | Depends on | Exit criterion |
|---|---|---|---|
| **0: measure (read-only)** | run Phase 4 §38's detection queries in production (via the owner's DB access) to size existing damage: negative balances, duplicate schedules, over-receipts, double cancels, dunning targets, orphan tenants | — | damage list agreed; cleanup scripts drafted (not run here) |
| **1: enablers** | RC-01 toolkit (`transition`, `adjust`, `lockParent`, ordered locks + retry); RC-09 CI (scratch migrate + `migrate diff` + raw-SQL EXPLAIN) | — | primitives with unit and race tests; CI red on any drift |
| **2: P0 root causes** | RC-02 for invoice ↔ contract ↔ work order (DB-01, NEW-01, DB-36); RC-03 minimal (reverse recorded movements; typed effect columns; allocations, so FIN-02 and FIN-11 are fixable); RC-04 (shared pricing; ignore client price; fee vocabulary migration); RC-10 (default-deny registration, permission catalogue) | Wave 1 | all 5 P0 resolved; RT-A6, RT-D1, RT-E1, RT-J1 and the legality cases of RT-A2 green |
| **3: P1 root causes** | RC-01 applied to every writer in §24 + CHECK/UNIQUE backstops (after Wave 0 cleanup); RC-02 + RC-06 for subscriptions (intent table, dunning rules, separate counters, period extension); RC-05 (`operation_keys`, POS keys, reminder log); RC-08 (Redis split, timeouts, pool budget); RC-11 (session registry). Independent: HSEC-06 escaping, HSEC-18 `trustProxy`, HSEC-19 throttling, HSEC-20 tenant check, FIN-12 arithmetic | Waves 1–2 | 26 P1 resolved; Phase 4 race suite green in CI |
| **4: P2 root causes** | RC-07 (provisioning steps + sweeper; version-in-tx; readiness gating); the rest of RC-03 (P&L from allocations and movements; history snapshots) | Waves 1–3 | DB-21/22 crash tests green |
| **5: P3 / independent** | hygiene groups (§11) | — | backlog |

### Remediation Priority

| Priority | Root cause | Findings affected (primary) | Business impact | Recommended fix |
|---|---|---|---|---|
| **P0** | RC-02 implicit state model | DB-01 (FIN-03/04), NEW-01, DB-36, FIN-20, DB-08†, FIN-16†, DB-25, DB-37, DB-P02, P-04, P-05 | phantom stock; credit for unpaid goods; revived invoices; wrong subscription states | lifecycle modules with transition tables and cross-entity rules (§8) |
| **P0** | RC-03 effects not recorded | FIN-02, FIN-10, FIN-11, FIN-15, FIN-19, FIN-22, F-05, DB-17, DB-30, DB-P06 | wrong refunds, wrong profit, wrong day close | effect records; reverse what was recorded (§8) |
| **P0** | RC-04 server doesn't own pricing | FIN-01, FIN-05, FIN-06, FIN-14, FIN-18 | amount collected ≠ amount recorded; insider price manipulation; fees lost | shared pricing module; server-side prices; vocabulary migration (§8) |
| **P0** | RC-10 opt-in authorization | HSEC-01, HSEC-03, HSEC-04, HSEC-05, HSEC-12, HSEC-13, HSEC-14, HSEC-26 | any employee changes VAT, ETA credentials, billing; cross-tenant job trigger | default-deny registration + catalogue (§8) |
| **P1** | RC-01 ad-hoc concurrency | 21 (DB-02..07, DB-11..16, DB-18, DB-19, DB-24, DB-27, D-04, DB-L03, DB-L08, DB-L09, DB-P10) | double spend, double refund, double receipts, doubled schedules | guarded-mutation toolkit + DB backstops (§9) |
| **P1** | RC-06 no payment intent | FIN-17, FIN-L1, FIN-L2, HSEC-21, FIN-L3, DB-P01, FIN-P6, FIN-P7, B-03 | customer cards charged twice; payments mis-bound | per-period payment intents (§9) |
| **P1** | RC-05 no idempotency | DB-10, DB-26, DB-L07, DB-P09 | duplicate sales on retry or replay | `operation_keys` + natural-key job logs (§9) |
| **P1** | RC-08 unbounded waits | DB-09, DB-20, DB-29, DB-31, B-07, A-01, DB-P08 | platform-wide outage when Redis blips; connection exhaustion | split Redis, timeouts, pool budget (§9) |
| **P1** | RC-11 no session registry | HSEC-07, HSEC-10, M-02 | ex-employees keep access | per-user session registry (§9) |
| **P2** | RC-07 lifecycle without durable steps | DB-21, DB-22, DB-L02, DB-L10, DB-P03, DB-P07, A-07 | stuck tenants; unrecoverable signups | step record + sweeper; version-in-tx (§10) |
| **P2** | RC-09 no schema contract | DB-23, DB-32, DB-33, DB-34, E-07, D-06, DB-P04 | ETA impossible; broken exports; tooling hazards | single schema source + CI (§10) |

† DB-08 and FIN-16 are P1 findings driven by RC-02 (together with RC-06 for DB-08).

---

## 28. Regression Test Strategy

**Harness** (from Phase 4, suitable for CI): an ephemeral Postgres migrated by the repo's own runner; real services and route plugins; concurrent actors via `Promise.allSettled`; 20 trials per race; the invariant queries from Phase 4 §38 asserted after every test.

| Suite | Setup | Concurrent actors | Expected invariant | Expected final state | Must never happen |
|---|---|---|---|---|---|
| **RT-A1** store credit spend (RC-01) | customer credit 1,000; item 700 | 2 sales using 700 credit | credit ≥ 0 | one sale ok, one `409/400`; balance 300 | balance < 0; two invoices using 1,400 |
| **RT-A2** installment approval (RC-01/02) | pending contract, 3 rows, stock 5 | 2 approvals; approve ∥ reject (staggered 0–20 ms) | one transition | 3 rows, stock 4, `active`; or `cancelled` with 0 rows and stock 5 | 6 rows; stock −2; `cancelled` with rows |
| **RT-A3** invoice cancellation (RC-01) | completed sale with credit + coupon | 2 cancels | effects reversed once | stock restored once; credit +used once; coupon −1 once | double restock or refund; `used_count` below its true value |
| **RT-A4** concurrent return (RC-01/03) | invoice with 2 units | 2 full returns; return ∥ cancel | Σ returned ≤ sold; refund ≤ recorded paid share | one return; the other `409` | stock +4; credit for more than was paid |
| **RT-A5** PO receiving (RC-01) | approved PO 10 units @ 200; on hand 10 @ 100 | 2 "receive all"; 2 POs of one variant | received ≤ ordered; WAC = serial | received 10; WAC 233.3333 for the 3-receipt case | received 20; liability ×2; WAC 250 |
| **RT-A6** duplicate work-order completion (RC-01/02) | WO `ready`, total 300 | 2 invoice requests; invoice a cancelled WO | one invoice per WO | 1 invoice; cancelled WO refused | 2 invoices; invoice for a cancelled WO |
| **RT-A7** opposite-order sales (RC-01) | 2 items, high stock | 40 pairs, reversed order | no deadlock errors | all sales succeed | `40P01` reaching the client |
| **RT-B1** client retry after timeout (RC-05) | sale payload + key K | same request twice, sequential and concurrent | one effect per key | 1 invoice; second response = first | 2 invoices; stock −2 |
| **RT-B2** offline replay (RC-05) | 3 queued sales with keys | 2 tabs replay at once; replay after a lost response | one effect per key | 3 invoices | 4–6 invoices |
| **RT-B3** worker retry (RC-05/06) | due renewal; fake Paymob succeeds; DB write fails once | BullMQ retry | one charge per period | 1 charge request; intent `succeeded` | 2 charge requests |
| **RT-B4** webhook replay and ordering (RC-06) | intent for period P | same success twice; SUCCESS then PENDING; FAILED then SUCCESS; amount mismatch | intent transitions are legal and monotonic | succeeded once; mismatch rejected | double activation; activation on a wrong amount |
| **RT-C1** user action + background job (RC-01/02) | expired trial | trial-expiry job ∥ checkout success | a paid subscription stays paid | `ACTIVE`, `failed_attempts` 0 | `PAST_DUE` after payment |
| **RT-C2** dunning vs paid or cancel-scheduled (RC-02/06) | paid `ACTIVE` + one decline; `PAST_DUE` + cancel at period end | dunning cycle | dunning only for ended, unpaid, non-cancelled periods | no charge request | a charge on a paid or cancel-scheduled subscription |
| **RT-C3** reminders (RC-05/10) | 1 due row | cron ∥ manual trigger; trigger from tenant A | one reminder per row per day; only the caller's tenant | 1 email | 2 emails; another tenant touched |
| **RT-D1** reversal from recorded effects (RC-03) | pending installment invoice; completed sale with coupon + credit + loyalty | cancel or return | reversal = recorded effects | pending: restock 0, credit 0; completed: proportional net refund | restock of goods never removed |
| **RT-D2** reports (RC-03) | fixture month (VAT, WO, returns, split, installments) | — | P&L and day close = hand-built ledger | equal | tax counted as revenue; WO counted twice |
| **RT-E1** pricing parity (RC-04) | fixture matrix (tax, discounts, coupon minimum, fee types, credit, loyalty) | POS module vs server | identical totals | equal | divergence; client price accepted |
| **RT-F1** tenant provisioning crash (RC-07) | signup | SIGKILL at each step | resumable or reaped | retry succeeds, or the row is removed and the subdomain is reusable | a permanent `PROVISIONING` row |
| **RT-F2** migration crash and concurrency (RC-07) | tenant at version N−1 | kill after DDL; 2 runners | version and DDL agree | next run clean; one applies | `42710` on re-run; version behind its DDL |
| **RT-G1** Redis outage (RC-08) | Redis stopped | 50 tenant requests | bounded latency | DB fallback or 503 within 1 s | a request pending indefinitely |
| **RT-G2** DB connection exhaustion (RC-08) | many tenant clients | N busy tenants × pool | aggregate ≤ budget | queued, no errors | `too many clients` |
| **RT-G3** LRU eviction (RC-08) | in-flight transaction | 50 other tenants touched | the transaction completes | committed | "Transaction not found" |
| **RT-H1** schema contract (RC-09) | migrated scratch schema | — | Prisma model = SQL; every raw statement valid | empty diff; EXPLAIN ok | `42703` at runtime |
| **RT-J1** route authorization (RC-10) | route inventory | every role | each tenant route declares a permission | snapshot matches | an authenticate-only mutating route |
| **RT-K1** session revocation (RC-11) | user with 2 sessions | deactivate; change password; concurrent refresh | revoked sessions can't refresh | 401 | a refresh succeeding after revocation |

---

## 29. Findings That Must NOT Be Fixed Independently

Patching any of these one by one would either leave sibling paths broken or create new inconsistencies.

| Group | Findings | Why it must be one change |
|---|---|---|
| **Guarded writes** | DB-02, DB-03, DB-04, DB-05, DB-06, DB-07, DB-11, DB-13, DB-14, DB-15, DB-16, DB-19, DB-24, DB-27 | Same pattern at ~15 call sites. A per-site patch would produce 15 slightly different guards, the exact situation that created RC-01. Ship the primitives once and migrate every writer in §24 |
| **Invoice ↔ contract ↔ work-order lifecycle** | DB-01 (FIN-03/04), NEW-01, DB-36, FIN-20 | Fixing cancel (DB-01) without approval (FIN-04's revival) or the WO link (NEW-01) just moves the inconsistency. The rule belongs to one owner (RC-02) |
| **Reversal and refund semantics** | FIN-02, DB-01 (phantom part), DB-17, F-05, DB-30, FIN-19 | Correcting the refund formula alone, while cancel still reverses lines and JSON audit entries, keeps two contradictory definitions of "what the sale did". Define the recorded effects first (RC-03), then derive refund, cancel and return from them |
| **Pricing ownership** | FIN-01, FIN-05, FIN-06, FIN-14, FIN-18 | Fixing the POS display (FIN-01) without server-side pricing (FIN-05) keeps two calculators that will drift again; fixing FIN-06's data without a shared enum lets the next seed or edit reintroduce it |
| **Subscription state machine** | DB-08, DB-19, DB-25, DB-37, DB-24, FIN-16, FIN-L1, FIN-L3, DB-P01, FIN-17, HSEC-21 | The dunning filter, trial expiry, period arithmetic, counters and payment binding are one model. Patching the dunning predicate alone still leaves trial expiry overwriting payments, and payments without intents |
| **Idempotency** | DB-10 (FIN-09, W-08), DB-26, DB-P09 | The key must exist end to end (POS → route → transaction); a server-only or client-only half doesn't help |
| **Availability budget** | DB-09, DB-20, DB-29, DB-31, B-07 | Fail-fast Redis without DB fallback turns hangs into outages; a pooler without a direct migration connection breaks the advisory lock. Tune together |
| **Schema contract** | DB-23, DB-32, DB-33, DB-34, E-07 | Fix the CI contract first, otherwise each SQL fix is unverified and the next drift is invisible |
| **Authorization** | HSEC-01, HSEC-03, HSEC-04, HSEC-05, HSEC-12, HSEC-14 | Adding `requirePermission` to the known routes leaves the default-allow mechanism that produced them |

---

## 30. Findings That Require Independent Fixes

These have no shared root cause; each needs its own change (the `IND` rows of §3):

| Finding | Sev. | Independent fix |
|---|---|---|
| HSEC-06 | P1 | escape interpolated values in email templates; restrict recipients |
| HSEC-18 | P1 (LK) | `trustProxy` matching the proxy topology; per-account limits |
| HSEC-19 | P1 (LK) | signup throttling, reserved names, captcha or verification (the RC-07 sweeper only limits the damage) |
| HSEC-20 | P1 (LK) | the TLS ask endpoint verifies that the tenant exists |
| FIN-12 (arithmetic) | P1 | discount = consumed points × point value; reject redemptions that consume 0 points |
| FIN-13 | P2 | validate product discounts at configuration (≤ 100 %, fixed ≤ price) |
| FIN-21 | P2 | check `product.isActive` at sale |
| E-02 | P2 | wire ETA auto-submission (with an outbox, §26) once DB-23 is fixed |
| S-03 | P2 | register the multipart parser (imports return 415) |
| DB-35 | P3 | soft-delete coupons; RESTRICT on audit-log actors; drop only schemas this run created |
| DB-28 | P3 | use `tx` in `approveContract`'s return |
| DB-38 | P3 | tenant time zone in the invoice-number date; document gaps |
| DB-L05 | P3 | versioned or delete-after-write tenant cache |
| DB-P05 | P3 | run multi-query reports in one REPEATABLE READ snapshot |
| HSEC-09, -11, -15, -16, -17, -22..-25, -29 | P3 | individual hardening items (Phase 2) |
| AU-02, AU-05, P-01, P-07, A-08, I-01, D-07, D-08, T-03, T-04, S-01, S-08, S-09, WO-02, IN-05, FIN-24, FIN-P1, FIN-P2, M-01, P-06 | P3 / INFO | hygiene (Phase 1 / 3) |

---

## 31. Corrections to Previous Audits

| # | Previous claim | Source | Verdict | Evidence |
|---|---|---|---|---|
| 1 | **FIN-23**: "WAC treats zero cost as unset" (a defect, P3) | Phase 3 | **CORRECTION — NOT CONFIRMED AS A DEFECT.** The behaviour is intentional and tested: `cost.test.ts:10-13` asserts that `weightedAverageCost(5, 0, 5, 80) === 80`. It remains a product question whether a zero cost should ever be blended; it is not a code defect | `apps/api/src/shared/utils/__tests__/cost.test.ts:10-13` |
| 2 | Concurrent payment of the last two installments can leave the contract `active` with every row paid (sub-claim of FIN-20, Phase 3 §9) | Phase 3 | **CORRECTION — NOT CONFIRMED** (already corrected in Phase 4 §31; restated) | ordering pre-check `installment.service.ts:450-453`; Phase 4 S5b 20/20 |
| 3 | Severity mismatch: FIN-L1 (P1) vs DB-L01 (P2) for the same re-charge risk | Phases 3 and 4 | **Normalised to P1 (LIKELY)**: customer money is charged | §2 rule |
| 4 | HSEC-28 "Redis outage LIKELY stalls requests" | Phase 2 | **Upgraded to CONFIRMED** (not a correction) | Phase 4 §29 experiment |
| 5 | Phase 1 C-03 "in-flight impact POTENTIAL"; Phase 2 U-09 pool behaviour | Phases 1 and 2 | **Upgraded to CONFIRMED** | Phase 4 P3-run, P4-run |
| 6 | The brief's cluster-A hypothesis lists "coupon race" and "loyalty race" | this brief | **Not race findings.** Both redemptions are race-safe (Phase 4 S4, S2) and no previous phase claimed otherwise. Only coupon *release* on double cancel (DB-05) and loyalty *reversal* (DB-17) are defects | `invoice.service.ts:327-334, 409-417` |

Every other finding named in §21 was re-traced and remains valid.

---

## 32. Unverified Items

Consolidated from Phase 2 §19, Phase 3 §30 and Phase 4 §36, with duplicates merged.

| ID | Item | Needed to verify | Blocks or affects |
|---|---|---|---|
| UV-01 | Production schema state per tenant (`schema_version`, migrations 016/017 present, existing CHECK violations, out-of-band columns) | read-only queries on production | D-04, DB-21, DB-23 |
| UV-02 | **Existing damage** from the races and P0s (negative balances, duplicate schedules, over-receipts, double cancels, phantom restocks, double charges, orphan tenants) | Phase 4 §38 queries on production | Wave 0; constraint rollout |
| UV-03 | Paymob behaviour: token-charge callbacks, pending / 3-DS, auth/capture, TOKEN callbacks, a transaction id changing outcome, retry policy, order-id uniqueness | provider documentation or sandbox | RC-06 design, FIN-L1..L3, DB-P01, HSEC-21 |
| UV-04 | Production infrastructure: replica count, `max_connections`, DB timeouts, Redis persistence / auth / eviction policy, proxy topology and effective `request.ip` | host configuration | RC-08, HSEC-18, DB-L07 |
| UV-05 | Active tenant count and concurrency levels | production metrics | DB-20, DB-29 likelihood |
| UV-06 | Product decisions: price override, refund policy (refund ≤ paid), a payment for a `CANCELLED` subscription, grace and suspension for unpaid trials, tax on order-level discounts | owner | RC-02, RC-03, RC-04 designs |
| UV-07 | Usage frequency of the affected features (tax rates, product discounts, coupons, loyalty, installments, split tender, edited seed methods) | aggregate counts | FIN-01/02/06/12 exposure |
| UV-08 | Whether the UI offers checkout to `ACTIVE` subscriptions | UI walkthrough | DB-08 frequency |
| UV-09 | GA build flag, `RESEND_API_KEY` in production, CSP actually served, R2 bucket privacy, wildcard DNS, Caddy on-demand limits | build, host and browser checks | HSEC-20, -22, -25, -29 |
| UV-10 | PostgreSQL 16 vs the 18.3 harness; real network latency (local race windows are lower bounds) | a staging run | Phase 4 timing figures |

---

## 33. Evidence Ledger

### 33.1 Verified in this phase (static, at `8846bce`)

| # | Claim | Location |
|---|---|---|
| E45-01 | Settings, ETA credentials, ETA test, currencies and branches use `authenticate` only | `apps/api/src/index.ts:258,275,344,381,412,420,428` |
| E45-02 | Line price is taken from the request | `apps/api/src/modules/invoices/invoice.service.ts:209` |
| E45-03 | Line subtotal is net of the line discount; the refund subtracts it again; order-level discounts are ignored | `invoice.service.ts:225`, `:605-614` (`:610`) |
| E45-04 | POS total = Σ `unitPrice × qty` − coupon (+ fee); no tax, no product discount; amount due displayed | `apps/web/src/pages/pos/POS.tsx:270-284`, `:849` |
| E45-05 | Fee vocabulary: server and tests use `'percentage'`; seed and POS use `'percent'` | `apps/api/src/shared/utils/fee.ts:14-26`; `__tests__/fee.test.ts:27-30`; `tenants/tenant.service.ts:167-172`; `POS.tsx:85-88` |
| E45-06 | Loyalty: points floored, discount not recomputed; 0-point redemption decrements nothing | `shared/utils/loyalty.ts:44-49`; `invoice.service.ts:326` |
| E45-07 | P&L revenue includes tax and WO payments; only `refund` returns subtracted; COGS falls back to the current cost | `modules/reports/report.service.ts:399-455` |
| E45-08 | Day close groups invoice totals by method; installment payments aggregated without a method | `report.service.ts:580-600` |
| E45-09 | Coupon CRUD under `invoices:*`; credit under `customers:update`; the cashier seed holds both | `modules/coupons/coupon.routes.ts:33-90`; `customer.routes.ts:114`; `tenant.service.ts:54-57` |
| E45-10 | Billing status, portal, cancel and resume are authenticate-only | `modules/billing/billing.routes.ts:93-182` |
| E45-11 | Manual reminder trigger runs the all-tenant cycle | `modules/installments/installment.routes.ts:216-224` |
| E45-12 | No user update, deactivate or revoke endpoint | `modules/auth/auth.routes.ts:237,280,309,337,577` |
| E45-13 | `run-migrations` passes the bare factory | `modules/admin/admin.routes.ts:890` |
| E45-14 | Variant `isActive` checked; product `isActive` not | `invoice.service.ts:160-165` |
| E45-15 | Checkout order id `sub_<tenantId>_<ts>` (declines reach the shared counter) | `modules/billing/paymob.client.ts:105` |
| E45-16 | `invoice.service.ts` references neither work orders nor contracts; nothing clears `work_orders.invoice_id`; the WO invoice route refuses when `invoiceId` is set | grep; `workOrder.routes.ts:409-411` (NEW-01) |
| E45-17 | WAC zero-cost behaviour is asserted by a test | `shared/utils/__tests__/cost.test.ts:10-13` (FIN-23 correction) |
| E45-18 | Writer map of every status and balance column | §24 (grep over `apps/api/src`) |
| E45-19 | Admin subscription actions: extend trial, cancel, reactivate (check, then write) | `admin.routes.ts:518-538, 570-583, 610-630` |
| E45-20 | Documented behaviour used for invariants | `documents/Hesba_Project_Overview.md` §3.2, §3.3, §4, §6.1–6.6, §7.7 |
| E45-21 | Existing tests are unit-only (helpers, HMAC, tenant binding, permissions, parity by table name) | `apps/api/src/**/__tests__/*.test.ts` (10 files) |
| E45-22 | Inventory coverage: all 205 IDs from the four reports map to a canonical row or alias | scratchpad `phase45/inventory.py` coverage check |

### 33.2 Inherited runtime evidence (Phase 4 §39)

| Area | Scenarios |
|---|---|
| Race scenarios | S1–S20 (credit, loyalty, stock, coupon, installment, cancel, return, transfer, PO, WO, deadlock, response freshness) |
| Billing | B1–B8 |
| Migrations and provisioning | M1–M6 |
| Performance and availability | P1–P4 |
| Other | Redis outage experiment; `prisma migrate diff`; raw-SQL EXPLAIN; detection-query validation |

All ran against a throwaway PostgreSQL 18.3 cluster that was deleted afterwards.

### 33.3 Previous reports (identifiers and evidence tables)

| Phase | Where |
|---|---|
| Phase 1 | observation ledger (§23 and IDs throughout) |
| Phase 2 | §20 finding index, §18 potentials, §19 unverified |
| Phase 3 | §31–§33 evidence index |
| Phase 4 | §33 matrix and §39 ledger |

---

## 34. Final Prioritized Root Cause List

| Rank | Root cause | Priority | Primary findings | P0 / P1 | Smallest sufficient fix |
|---|---|---|---|---|---|
| 1 | **RC-01** Ad-hoc concurrency control | P1 (highest volume) | 21 | 0 / 6 | `transition` / `adjust` / `lockParent` / ordered locks + retry; CHECK and UNIQUE backstops |
| 2 | **RC-02** Implicit, multi-writer state model | P0 | 11 | 1 / 2 | lifecycle owner modules with transition tables and cross-entity rules |
| 3 | **RC-04** Server doesn't own pricing | P0 | 5 | 2 / 1 | shared pricing module; server-side prices; shared enums |
| 4 | **RC-03** Effects not recorded | P0 | 10 | 1 / 2 | record effects; reverse what was recorded; allocations |
| 5 | **RC-10** Authorization opt-in | P0 | 8 | 1 / 3 | default-deny route registration + catalogue |
| 6 | **RC-06** No payment intent | P1 | 9 | 0 / 4 | per-period `subscription_payments` intents |
| 7 | **RC-08** Unbounded waits and shared resources | P1 | 7 | 0 / 1 | split Redis, timeouts, pool budget |
| 8 | **RC-05** No idempotency boundary | P1 | 4 | 0 / 1 | `operation_keys`; natural-key job logs |
| 9 | **RC-11** No session registry | P1 | 3 | 0 / 1 | per-user sessions with token families |
| 10 | **RC-07** Lifecycle without durable steps | P2 | 7 | 0 / 0 | provisioning step record + sweeper; version-in-tx migrations |
| 11 | **RC-09** No single schema contract | P2 | 7 | 0 / 0 | migrated template → Prisma model; `migrate diff` + EXPLAIN in CI |
| — | Independent findings | mixed | 44 | 0 / 5 | individual fixes (§30) |

### The final question: five changes before the next production release

**Question:** "If the team can only implement 5 architectural/correctness changes before the next production release, what 5 changes eliminate the largest number of P0/P1 risks?"

**Method:**
- Count P0 and P1 findings fully resolved per change, weighting P0 first.
- Prefer changes that are prerequisites for others.
- Independent cheap fixes (HSEC-06, FIN-12, HSEC-16) can ship regardless and are not counted.

#### Change 1. A guarded-mutation toolkit applied to every write path, with DB backstops (RC-01)
- **Covers (P1):** DB-02 (credit double spend), DB-03 (double approval), DB-04 (approve ∥ reject), DB-05 (double cancel), DB-06 (concurrent returns), DB-07 (double receipt).
- **Also resolves (P2/P3):** DB-11, DB-12, DB-13, DB-14, DB-15, DB-16, DB-18, DB-19, DB-24, DB-27, DB-L03, DB-L08, DB-L09, DB-P10, D-04.
- **Why first:** the largest single block of P1s, a mechanical change, and change 2 is built on its `transition()` primitive.

#### Change 2. An explicit state model with one owner per entity: invoice ↔ contract ↔ work order, and subscriptions (RC-02)
- **Covers:** DB-01 (P0; FIN-03 + FIN-04), DB-08 (P1; the dunning predicate, separate counters and period extension, which stops paid subscriptions being charged even before intents exist), FIN-16 (P1).
- **Also resolves:** NEW-01, DB-36, FIN-20, DB-25, DB-37, DB-P02, P-04, P-05.
- **Why:** the only change that removes the P0 inventory and credit corruption from normal UI use, and the customer-facing double charge.

#### Change 3. Server-owned pricing through one shared calculation module (RC-04)
- **Covers:** FIN-01 (P0), FIN-05 / HSEC-02 (P0), FIN-06 (P1).
- **Also resolves:** FIN-14, FIN-18; reduces FIN-12, FIN-13, FIN-15.
- **Why:** two P0s in one change. Today the amount collected at the till and the amount recorded differ on every taxed or discounted sale, and the price itself is client-controlled.

#### Change 4. Record financial effects, and reverse exactly what was recorded (RC-03, minimal form)
- **Scope:** typed effect columns on invoices, payment allocations, reversal from `stock_movements`.
- **Covers:** FIN-02 (P0, together with the one-line formula correction), FIN-10 (P1), FIN-11 (P1).
- **Also resolves:** FIN-15, FIN-19, F-05, DB-17, DB-30, DB-P06. It removes DB-01's phantom stock and credit even if change 2 slips.
- **Why:** refunds and the daily cash figure are wrong today without any concurrency. This is the fix that makes reversal and reporting trustworthy.

#### Change 5. Default-deny authorization with a permission catalogue (RC-10)
- **Covers:** HSEC-01 (P0), HSEC-03, HSEC-04, HSEC-05 (P1).
- **Also resolves:** HSEC-12, HSEC-13, HSEC-14, HSEC-26.
- **Why:** low complexity, and closes the remaining P0. Any employee can currently change VAT, loyalty values, ETA credentials, print templates and the subscription.

**Result:**

| | P0 | P1 |
|---|---|---|
| Resolved by the five changes | all 5 | 14 of 26 |
| Still open after them | 0 | 12 |

The five changes also resolve **36 P2/P3 findings** and reduce several more.

**The 12 P1s still open:**
- RC-06 payment intent: FIN-17, FIN-L1, FIN-L2, HSEC-21. Change 2 already removes the most common double-charge path (DB-08).
- RC-05: DB-10.
- RC-08: DB-09.
- RC-11: HSEC-07.
- Independent: HSEC-06, HSEC-18, HSEC-19, HSEC-20, FIN-12.

**Why not the alternatives:**
- **RC-06 (payment intent)** would resolve 4 P1s (2 of them likely) and 0 P0s. It ranks sixth by risk eliminated, and should be the first item after this release.
- **RC-08 (Redis split and timeouts)** resolves 1 P1 but is mostly configuration; ship it alongside if capacity allows.

---

## Closing statement

| Item | Answer |
|---|---|
| **Source files modified** | **NO** (`git status` unchanged: the two pre-existing UI modifications and untracked `documents/`) |
| **Database modified** | **NO** |
| **Migrations modified** | **NO** |
| **Production accessed** | **NO** |
| **Tests executed** | none in this phase; static re-verification only. Runtime evidence was reused from Phase 4 (~45 scenarios on a throwaway database that no longer exists; existing unit suite 61/61 at that time) |
| **Temporary services used** | none |
| **Temporary files created** | session scratchpad only, outside the repository: `phase45/inventory.py`, `inventory.md`, `inventory.json`, `dedup.md` |
| **Report path** | `documents/audit/Hesba_Phase4.5_Root_Cause_Consolidation.md` |

*End of Phase 4.5. Analysis and architecture consolidation only; no fix was implemented.*
