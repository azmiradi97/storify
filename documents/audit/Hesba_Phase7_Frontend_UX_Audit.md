# Hesba Phase 7 — Frontend & UX Audit

| | |
|---|---|
| Date | 2026-10-12 |
| Code under review | branch `claude/ui-pos-merge-split` @ `8846bce` **plus the two pre-existing uncommitted UI edits** (`apps/web/src/pages/pos/POS.tsx`, `apps/web/src/components/layout/AppShell.tsx`), audited as they stand in the working tree. Line numbers refer to the working tree |
| Inputs | Phase 1–6 and 4.5 reports (`documents/audit/`); `apps/web` (64 files, ≈ 19.6 k lines); the API routes and services each UI flow calls; installed libraries (`@tanstack/react-query` / `query-core` 5.100.10, axios, zustand `persist`) |
| Method | (1) static trace of each critical flow: component → API call → route → service → response shape; (2) **rendered runtime checks** of the real web app (`pnpm dev:web`) against the real API on a throwaway PostgreSQL/Redis stack with a synthetic tenant; (3) build, type-check and lint; (4) deterministic re-execution of the client date expressions under `TZ=Africa/Cairo` |

**IDs used in this report:**
- Confirmed findings are **UX-01 … UX-17**; likely, potential and unverified items are **UX-Lxx**, **UX-Pxx** and **UX-Uxx**.
- Runtime evidence items are **E1 … E22**, listed in §16.
- Prior-phase IDs (FIN-, DB-, HSEC-, BG-, INT-, RC-) are cited, never re-counted.

---

## 1. Executive Summary

**The question:** does the frontend show users the financial truth, keep its state in step with the server, enforce sensible role boundaries, and work in Arabic on real devices?

**Partly. The UI shell is sound:**
- RTL is set globally (`dir=rtl`, `lang=ar-EG`).
- Dialogs and drawers trap and restore focus.
- `tsc` passes, lint reports 0 errors, and the production build succeeds.
- The in-memory query cache is discarded on logout (full reload).
- The service worker never caches `/api/`.

**But the money-handling screens show numbers that differ from what the server stores, and several workflows break for ordinary roles:**

| # | What a user experiences | Evidence | ID | Sev. |
|---|---|---|---|---|
| 1 | The POS shows **950.00**; the server records **976.00** for the same cart. The completion modal and the printed receipt list a subtotal, coupon and total that don't add up, with no VAT line. The installment form previews **88.00/month**; the server creates **90.86/month** | E3–E7, E19 | **UX-01** (FIN-01 in the UI) | **P0** |
| 2 | Invoice details show every product line as **"خدمة"** (service) with **no amount**. The return dialog shows no product names. The printed **"فاتورة ضريبية"** has empty item names and line totals of **"ليس رقمًا"** (NaN). Cause: the UI reads `productName`, `variantSku` and `totalPrice`, which the API never returns | E8–E10 | **UX-02** | **P1** |
| 3 | A user with the seeded **cashier** role cannot complete **any** sale. `GET /payment-methods` returns 403 (it requires `settings:read`); the POS silently renders an empty payment list, and **إتمام البيع** never enables | E14 | **UX-03** | **P1** |
| 4 | Returns: the cashier confirms a cash refund **without ever seeing the amount**. The server recorded **926.00** for an invoice the customer paid **976.00** for (FIN-02). The dialog then offers to return the same line again, and the rejection appears as a raw code with a UUID | E10, E11 | **UX-04** | **P1** |
| 5 | "Offline mode" does not work as advertised. With the network down, the sale button **spins indefinitely** (TanStack Query pauses the mutation), the sale exists only in memory, and the localStorage queue the banner promises is not used. When that queue *is* used, it survives logout and replays under the **next user** | E12, E13 | **UX-05** | **P2** |
| 6 | The end-of-day cash summary shows **the same totals** when reopened after a sale (5-minute cache, no invalidation). Its total and its per-method breakdown use different day definitions | E18 | **UX-06** | **P2** |
| 7 | "Today" is the **UTC** date in Day Close, Reports, EOD, expenses and installment payments. Between 00:00 and 02:00/03:00 Cairo time the UI shows yesterday, the Reports month starts on the previous month's last day, and an installment payment cannot be dated the real local date | Node replay at 00:30 Cairo; E6 | **UX-07** | **P2** |
| 8 | A **suspended** store's users see an empty app ("لا توجد فواتير — لم يتم إصدار أي فاتورة بعد") with no banner and no message. A subscription stuck in INT-04's state shows **"سيتجدد اشتراكك خلال 0 يوماً"** forever | E16, E17 | **UX-08** | **P2** |
| 9 | Product discounts **cannot be created** from the UI: every attempt returns 500 (date string passed to Prisma `DateTime`), and the UI shows only "حدث خطأ" | E1 | **UX-09** | **P2** |

**Other findings, grouped by cause:**
- action visibility vs permissions (UX-10)
- error mapping (UX-11)
- money formatting (UX-12)
- responsive layout (UX-13)
- asynchronous double-submit guard (UX-14)
- cart loss on session expiry (UX-15)
- unredeemable loyalty points (UX-16)
- accessibility labelling (UX-17)

**Severity totals for the new IDs:**

| Severity | Count | IDs |
|---|---|---|
| P0 | 1 | UX-01 (the frontend manifestation of FIN-01; not double-counted) |
| P1 | 3 | UX-02, UX-03, UX-04 |
| P2 | 5 | UX-05, UX-06, UX-07, UX-08, UX-09 |
| P3 | 8 | UX-10 … UX-17 |

**Corrections to earlier phases (detail in §13):**
- **FIN-01:** its *product-discount* component cannot be reached through the UI, because discounts can't be created (UX-09). Its VAT component is confirmed at runtime.
- **HSEC-02 framing:** Phase 2 said "the POS UI never edits prices", but the **installment contract form exposes an editable unit price** (`Installments.tsx:449`).
- **Cashier vs payment methods:** Phase 2 recorded this only as an unrated "functional" table note; it is raised here to **UX-03 (P1)**.

**Root causes:**
- **RC-04** (no server-owned pricing): UX-01, UX-04
- **RC-09** (no shared contract): UX-02, UX-09, UX-11
- **RC-10** (opt-in, inconsistent authorization): UX-03, UX-10
- **RC-05** (no idempotency): UX-05, UX-14
- Frontend-specific, three causes:
  - no mutation-driven cache invalidation (UX-06)
  - no business timezone (UX-07)
  - no handling of HTTP 402 (UX-08)

---

## 2. Scope and Limitations

| Area | Covered |
|---|---|
| Financial screens | POS (`pages/pos/POS.tsx`), completion modal, thermal receipt and A4 invoice (`lib/print.ts`), invoices / returns / cancel (`pages/invoices/Invoices.tsx`), installments (`pages/installments/Installments.tsx`), day close (`pages/pos/DayClose.tsx`, POS EOD modal), billing settings |
| Request lifecycle | axios client (`api/client.ts`), QueryClient defaults (`main.tsx:51-58`), every `useMutation` (inventory in §5), offline queue |
| State | zustand `hesba-auth` (`stores/auth.store.ts`), localStorage keys, query keys and invalidation, the service worker (`public/sw.js`) |
| Authorization UX | `AuthGuard` / `GuestGuard` / `RoleGuard` / `FeatureGate`, sidebar filtering, per-page action visibility, seeded role permissions vs route permissions |
| Forms | RHF + zod schemas vs server zod schemas, for the financial forms |
| RTL / responsive / a11y | rendered at 1366×860 and 375×812; dialogs and drawers; ESLint `jsx-a11y` |

**Limitations:**
- **Rendered pages:** POS, the completion modal, the invoices drawer, the return dialog, the subscription banner states, Settings (billing) and Invoices at phone width. Every other page was reviewed statically only.
- **Browsers and devices:** one Chromium-based pane. No Safari/iOS, no Firefox, no physical receipt printer, no screen reader.
- **Offline:** simulated by overriding `navigator.onLine` and dispatching `offline`/`online` events in the page, not by cutting the network.
- **Providers:** Paymob, ETA and Resend were not contacted. Their UI consequences are traced from Phase 5/6 evidence.
- **Subscription states:** set directly in the throwaway master DB to observe the UI.
- **Tests:** the repository has **no web unit tests**, so none were run.

---

## 3. Frontend Architecture and Critical Workflow Map

**Stack:** React 18, Vite 5, React Router 6, TanStack Query 5.100.10, zustand (`persist`), axios, RHF + zod, Tailwind.

**Request and session plumbing:**
- **API client:** the axios `api` instance uses `baseURL /api` and **no timeout** (`api/client.ts:5-9`).
  - The request interceptor refreshes a missing or near-expiry access token, then adds `Bearer` and `X-Tenant-Subdomain` (`:34-67`).
  - The response interceptor handles **401 only**, with a single-flight refresh and replay. On refresh failure it shows a toast and calls `logout()`, which runs `window.location.href = '/login'` (`:76-125`; `auth.store.ts:35-38`).
- **Query defaults:** `staleTime 5 min`, `retry 1` for queries, default mutations (`main.tsx:51-58`). **There is no global error handler and no `networkMode` override.**
- **Persisted state:**
  - `hesba-auth` holds `user` (incl. permissions) and `tenantSubdomain`; the access token stays in memory only (`auth.store.ts:47-58`).
  - Other localStorage keys: `pos_offline_queue` (full sale payloads), `hesba_onboarded_<userId>`.
- **Service worker:** network-first for HTML, cache-first for static assets, and it **skips `/api/`** (`public/sw.js:31-80`).

**Critical workflows:**

| Workflow | UI computes | API call | Server computes | What the user sees afterwards |
|---|---|---|---|---|
| POS sale | subtotal = Σ catalog price × qty; coupon; fee; credit; split; **no VAT, no product discount** (`POS.tsx:270-306`) | `POST /invoices` with the client `unitPrice` (`:312-335`) | product discount, VAT per product, coupon, fee (`'percentage'` vocabulary), credit, loyalty (`invoice.service.ts:193-304`) | completion modal and receipt mix the **client** subtotal/coupon/fee with the **server** total (`POS.tsx:337-357, 1017-1076`; `print.ts:52-88`) |
| Invoice detail / print | — | `GET /invoices/:id`, a raw Prisma include (`invoice.service.ts:97-122`) | — | the UI reads non-existent `productName` / `variantSku` / `totalPrice` (`Invoices.tsx:17-27, 343-360`; `print.ts:106-113`) |
| Return | qty cap = sold qty (`Invoices.tsx:52-64`) | `POST /invoices/:id/return` (`invoices:update`) | refund amount (FIN-02 formula) | a toast only, **no amount** (`:74-78`) |
| Cancel | — | `POST /invoices/:id/cancel` (`invoices:update`) | reversals | toast; invalidates `invoices`, `customer-ledger`, `stock` (`:220-231`) |
| Installment contract | preview without VAT or product discount; **editable unit price** (`Installments.tsx:362-371, 449`) | `POST /installments` (`:373-390`) | VAT, discount, flat interest | a toast only (`:391-395`) |
| EOD / Day close | "today" = UTC date (`POS.tsx:165`; `DayClose.tsx:64`) | `/reports/dashboard`, `/reports/sales`, `/reports/day-close` | invoice-total based (FIN-11) | cached up to 5 min (E18) |
| Subscription | banner from `/billing/status` (`hooks/useSubscription.ts:21-35`) | — | 402 gate on all other tenant routes (`tenant.middleware.ts:88-112`) | no 402 handling (E17) |
| Checkout | RHF form → `POST /billing/checkout` → redirect to the Paymob iframe (`Settings.tsx:303-311`) | — | — | returns to `/settings?tab=billing` |

---

## 4. Financial Correctness Matrix

Runtime values come from one real sale. Cart: phone 1000.00 (VAT 14 %, active 10 % product discount), coupon `SAVE50` (fixed 50), method "فيزا / ماستر" (seeded `feeType: 'percent'`, 1.75 %, merchant bears the fee).

| Quantity | Frontend shows | Server computes / persists | Match? | Where |
|---|---|---|---|---|
| Line amount | 1000.00 (catalog price × qty) | subtotal 900 (1000 − 100 product discount) | ✗ | `POS.tsx:270`; `invoice.service.ts:209-231` |
| Product discount | **not shown anywhere** in the POS | 100 | ✗ | — |
| VAT | **not shown before the sale**, not in the completion modal, **not on the receipt** | 126 | ✗ | `POS.tsx:812-851, 1045-1063`; `print.ts:78-83` |
| Coupon | −50.00 | 50 | ✓ (value) | `POS.tsx:272-277` |
| Fee | **17.50** on the method button and **16.63** in the totals panel, at the same moment (two bases: `subtotal` vs `subtotal − coupon`) | **0** (`'percent'` ≠ `'percentage'`, FIN-06), no `payment_fee_expenses` row | ✗ | `POS.tsx:639, 279`; `fee.ts:20-26` |
| Amount due before submit | **950.00** | 976.00 | ✗ (−26) | `POS.tsx:848-850` (E3, E4) |
| Completion modal | subtotal 1,000.00 (client), coupon −50.00 (client), total **976.00** (server) | — | the lines don't reconcile | `POS.tsx:338-357, 1045-1063` (E5) |
| Thermal receipt | subtotal 1000.00, coupon −50.00, total 976.00; **no VAT**, no store name | — | ✗ | `print.ts:52-88` (E7) |
| A4 "فاتورة ضريبية" | items: name **empty**, line total **NaN**; totals 900 / −50 / 126 / 976 | — | lines ✗, totals ✓ | `print.ts:106-167` (E9) |
| Invoice drawer | item "خدمة × 1", amount empty; totals `900 / -50 / 126 / 976 ج.م` (unformatted) | — | lines ✗, totals ✓ | `Invoices.tsx:343-376` (E8) |
| Store credit | capped at the **pre-tax** client total (`POS.tsx:282-284`) | capped at the post-tax total; shown in the drawer as "الخصم" (merged with coupon and loyalty) | different caps | `invoice.service.ts:259-279, 346` |
| Split payment | remainder computed on the client total (`POS.tsx:306, 723-728`) | stored unvalidated (FIN-15) | ✗ when VAT applies | — |
| Loyalty redemption | **no UI at all** | supported (`redeemPoints`) | — | UX-16 |
| Refund (return) | **amount never shown** | 926.00 for a 976.00 sale (FIN-02) | ✗ | `Invoices.tsx:68-86` (E10) |
| Installment preview | 88.00/month, with an editable unit price | 90.86/month; total 1108.60 | ✗ (+3.25 %) | `Installments.tsx:362-371, 449` (E19) |
| EOD "إجمالي المبيعات" | 1,261 (integer-rounded, `maximumFractionDigits: 0`) | invoice totals incl. a refunded invoice (FIN-11) | conceptually ✗ | `POS.tsx:910` (E18) |
| Rounding | JS doubles, `toFixed(2)` / `Intl` (FIN-18) | `decimal.js` HALF_UP | small drift possible | `POS.tsx:270-306`; `print.ts:54` |

**Conflicting sources of truth.** The POS, installment form, receipt printer and EOD each re-derive money on the client:
- `calculateFee` is duplicated (`POS.tsx:82-90` vs `shared/utils/fee.ts`) with a different vocabulary (FIN-06).
- The installment formula is duplicated (`Installments.tsx:366-371` vs `installment.service.ts`).
- Receipt totals are assembled from client state (`POS.tsx:338-356`).

There is no endpoint that previews server-computed totals before committing. That gap is the frontend face of **RC-04**.

---

## 5. Request Lifecycle and Concurrency Findings

**Mutation inventory (money-relevant):**

| Mutation | Endpoint | Pending guard | Confirm dialog | Invalidates | Idempotent? |
|---|---|---|---|---|---|
| POS sale | `POST /invoices` (`POS.tsx:308-377`) | button `loading` + `disabled` via `isPending`, **async** (E20) | no | **nothing** | no (DB-10) |
| Offline replay | `POST /invoices` loop (`POS.tsx:122-146`) | none; runs per tab | no | — | no |
| Return | `POST /invoices/:id/return` (`Invoices.tsx:68-86`) | `loading` | the modal itself | `invoices` only | no (DB-06) |
| Cancel | `POST /invoices/:id/cancel` (`Invoices.tsx:220-231`) | `loading`; Escape can dismiss mid-request | yes (`:383-407`) | `invoices`, `customer-ledger`, `stock` | no (DB-05) |
| Email receipt | `POST /invoices/:id/email-receipt` (`:233-242`) | `loading` | modal | — | no |
| Installment contract | `POST /installments` (`Installments.tsx:373-395`) | `isPending` | form | `installments` | no |
| Installment payment | `POST /installments/:c/payments/:p` (`:657-667`) | `loading={isRecording}` (`:191, 240, 832`) | modal | `installments` | no (DB-27) |
| Contract approve / reject | `:646-656` | `loading={isReviewing}` (`:809`) | modal | `installments` | no (DB-03/04) |
| Send reminders | `POST /installments/send-reminders` (`:591-604`) | `loading` | **no** | — | no (HSEC-05) |
| PO receive / pay | `PurchaseOrders.tsx:395-430` | `isReceiving` / `isPaymentPending` | — | `purchase-orders` | no (DB-07/16) |
| Customer credit | `Customers.tsx:58-80` | `isPending` | form | customer queries | no (DB-15) |
| Billing checkout / cancel / resume | `Settings.tsx:303-376` | `isPending` | cancel: `ConfirmDialog` | `billing` | — |

**Observations:**
1. **Timeouts and ambiguous responses:**
   - The axios client has **no timeout** (`api/client.ts:5-9`); the server has no request timeout either (Phase 4). A hung `POST /invoices` leaves the button spinning indefinitely.
   - Mutations are **not retried automatically** (TanStack default `retry: 0`), so the UI never re-sends a sale on its own after a timeout.
   - The 401 interceptor does replay the *original* request after a refresh (`api/client.ts:94-108`). This is safe, because a 401 means the server rejected the request before running the handler.
   - The **user** can retry after a network error (`getApiErrorMessage` shows "تعذر الاتصال بالخادم"). Without an idempotency key (DB-10) that retry duplicates a sale the server had in fact committed.
2. **The double-submit guard is asynchronous** (UX-14). `isPending` reaches the button only after TanStack's `notifyManager` flush and a React re-render.
   - Two activations in the same task produced **two invoices 4 ms apart**.
   - Activations 120 ms apart were blocked (E20).
3. **Offline: the mutation is paused rather than queued** (UX-05).
   - TanStack Query 5.100.10 defaults to `networkMode: 'online'`; `canStart` is false while `onlineManager` is offline (`query-core/build/modern/retryer.js:10-11, 43`). After the browser's `offline` event, `mutationFn` (which contains the localStorage branch, `POS.tsx:323-333`) **is not called**, and the button spins (E12).
   - The paused mutation lives only in memory: a reload while offline discards it (library semantics; not exercised).
   - The localStorage branch runs only when `navigator.onLine` is already false and no `offline` event has reached `onlineManager`, e.g. a page opened offline. It then returns `totalAmount: 0`, so the completion modal and printed receipt show **0.00** for a real sale (`:332, 341`).
   - The queue is replayed **only on a later `online` event** (`:122-146`), not on page load. With items pending and the device already online, the "سيتم إرسالها تلقائياً" banner never comes true until the next disconnect/reconnect.
4. **Navigation during a mutation:**
   - The POS mutation's `onSuccess` sets component state. If the user navigates away mid-request, the invoice is still created but no confirmation or receipt is shown; the user must find it in Invoices.
   - With no idempotency, re-ringing the sale duplicates it.
5. **Optimistic updates:** none (all mutations are pessimistic). No rollback concerns.
6. **Success messages vs persisted state:**
   - Sale, return and cancel toasts follow a 2xx, so they are true.
   - **Not true for the email receipt:** "تم إرسال الفاتورة إلى …" appears even when Resend failed (BG-05; the backend always returns `sentTo`).
   - **Not true for reminders:** "أُرسل N" counts failed sends and other tenants' customers (BG-05, HSEC-05).

---

## 6. Cache, Session and Tenant-Switching Analysis

| Topic | Finding | Status |
|---|---|---|
| Query keys | no tenant or user component (e.g. `['invoices', search, status, from, to, page]`, `['payment-methods']`, `['eod-dashboard']`) | acceptable only because the cache is in memory and dropped on logout (below) |
| Logout | `api.post('/auth/logout')` then `logout()` → `set({user:null,…})` + `window.location.href='/login'` (`Sidebar.tsx:83-89`; `auth.store.ts:35-38`). The full reload discards the in-memory QueryClient | ✓ for query data |
| localStorage after logout | `hesba-auth` → `{user:null, tenantSubdomain:null}` ✓; **`pos_offline_queue` kept** (E13); `hesba_onboarded_<id>` kept (harmless) | ✗ (UX-05) |
| Tenant switch | `GuestGuard` redirects a logged-in user away from `/login` (`AuthGuard.tsx:17-25`), so a tenant switch always passes through logout and reload ✓. The offline queue is the one piece of state that crosses it: replay posts the stored payloads with the **current** user's token and `X-Tenant-Subdomain` (`POS.tsx:130-134`; `api/client.ts:61-67`) | ✗ (UX-05) |
| Session expiry mid-work | a failed refresh → `logout()` → hard navigation: the POS cart, coupon, customer and every open form are discarded without a draft (`api/client.ts:109-120`) | ✗ (UX-15) |
| Stale data after mutations | `staleTime 5 min` globally (`main.tsx:54`). The POS sale invalidates **nothing**; the return invalidates only `invoices`. EOD reopened after a sale showed identical numbers (E18). Dashboard, reports, customer balances and stock lists can be up to 5 min stale after a sale or return | ✗ (UX-06) |
| Day definition | client "today" = UTC (`toISOString().slice(0,10)`) at 16 call sites (§9 / UX-07); server "today" depends on the process TZ (production container: UTC) | ✗ (UX-07) |
| Concurrent tabs | `hesba-auth` is persisted but not synchronised across tabs (zustand `persist` without storage-event sync). Two POS tabs share `pos_offline_queue` and both replay it on `online` (duplicate sales; FIN-09/DB-10). Cross-tab, cross-subdomain refresh-cookie interplay (AU-02/HSEC-23) was not exercised (UX-U02) | LIKELY / UNVERIFIED |
| Conflict presentation | there is no versioning or ETag. Concurrent edits are last-writer-wins on the server (Phase 4), and the UI never tells the user that data changed under them | by design; see the RC-01 findings |
| Service worker | never intercepts `/api/` (`sw.js:33`); no cross-tenant API data risk | ✓ |

---

## 7. Authorization and Role-Based UX Analysis

**Guards.**
- `RoleGuard` mirrors `requirePermission` on routes (`AuthGuard.tsx:34-46`), with a `super_admin` bypass on both sides (`auth.store.ts:43`; `auth.middleware.ts:51`).
- `FeatureGate` mirrors plan features.
- The sidebar hides items without permission (`Sidebar.tsx:78-81`).
- **Inside pages, actions are not permission-filtered.** `hasPermission` is not used in `Invoices.tsx`, `Installments.tsx` or `Customers.tsx` (grep).

**Seeded roles vs what the UI needs** (role permissions from the provisioning seed, read from the throwaway DB):

| Role | Can open | Breaks or misleads | Evidence |
|---|---|---|---|
| cashier (`invoices:create/read`, `customers:*`, `stock:read`, …; **no `settings:read`**) | POS, invoices, installments, reports, customers | **cannot complete a sale**: `GET /payment-methods` → 403 → empty list → button disabled (UX-03). Sees **Return** and **Cancel** on invoices → 403 toast (UX-10). Sees the subscription banner CTA → `/settings?tab=billing` → Forbidden view (`App.tsx:101`) | E14, E15 |
| accountant (`billing:read`, no `settings:read`) | invoices (read), reports | the billing banner CTA leads to a forbidden page; no billing view reachable despite `billing:read` | static |
| inventory_keeper (no `settings:read`) | stock, products, POs | — | static |
| branch_manager (`settings:read`, no `settings:update`) | all of Settings, **every tab incl. Users, Payment methods, ETA credentials, Print template** (`Settings.tsx:22-79`, no per-tab permission). Many writes there are `authenticate`-only on the server (**HSEC-01**), so they succeed | static + Phase 2 |
| any role with `installments:read` | Installments page incl. the **"send reminders"** button (`Installments.tsx:701`) → server requires `installments:update`; with it, the call runs the **all-tenant** reminder cycle and shows platform-wide counts as this store's (HSEC-05) | static + Phase 5 R1 |

**Frontend hiding vs backend enforcement (traced):**
- Invoice return/cancel: server-enforced (`invoices:update`) ✓.
- Payment methods: read needs `settings:read`, write needs `settings:update` ✓.
- Settings, ETA credentials, branches, billing cancel/resume: `authenticate` only (HSEC-01/04, unchanged).
- No hidden action is the *only* barrier for a money write, except where the server itself is open (HSEC-01/03/04, already rated).

---

## 8. Forms and Validation Analysis

| Form | Client schema | Server schema | Gap / consequence | Evidence |
|---|---|---|---|---|
| POS sale | no schema; `unitPrice` from the catalog (`POS.tsx:321`); `creditAmount` capped pre-tax; split capped on the client total | `invoice.schema.ts`: `unitPrice amountPositive`, `creditAmount ≥ 0`, `splitPaymentAmount ≥ 0` (no upper bound, FIN-15) | the client caps don't match the server's totals (UX-01) | §4 |
| Product discount | `discountValue` + two native date inputs (`Products.tsx:497-523`) | `startDate`/`endDate` regex `YYYY-MM-DD` → passed raw to Prisma `DateTime` | **always 500** (UX-09) | E1 |
| Installment contract | zod: `unitPrice positive`, `downPayment ≥ 0`, `installmentsCount 1–120`, `interestRate 0–100` (`Installments.tsx:268-281`); **unit price is editable** (`:449`) | `installment.schema.ts`: `unitPrice amountPositive`, `downPayment` not bounded by total (checked later) | the client allows `downPayment > total`; the server returns `down_payment_exceeds_total` shown raw; the unit price is user-controlled (FIN-05) | E19 |
| Installment payment date | `max = new Date().toISOString().slice(0,10)` (`Installments.tsx:833, 850-853`) | regex `YYYY-MM-DD` | after local midnight the **real local date is rejected** until 02:00/03:00 (UX-07) | Node replay |
| Return | qty stepper capped at the **sold** qty (`Invoices.tsx:59-60, 107`) | cumulative cap (`return_qty_exceeds_sold:<id>`) | already-returned qty selectable; raw error (UX-04) | E11 |
| Store settings | `vatEnabled`, `vatRate`, `timezone`, `currencyDefault` (`Settings.tsx:99-108`) | stored | **`vatEnabled/vatRate` do not affect POS sales** (product tax rates are used; only work-order invoices read them, Phase 1 §6). **`timezone` is never read** by any API code (grep). The form implies controls that don't exist (UX-L03) | static |
| Coupon at POS | `minAmount` checked once against the pre-tax subtotal (`POS.tsx:292-294`) | not checked (FIN-14) | not repeated | Phase 3 |
| Numeric inputs | `type="number"` with `dir="ltr"` for money fields (`POS.tsx:589-599, 712-722, 941-958`) | — | ✓ Latin digits (`ar-EG-u-nu-latn`, `format.ts:3`) | static |
| Destructive actions | invoice cancel ✓ confirm (`Invoices.tsx:383-407`); subscription cancel ✓ `ConfirmDialog` (`Settings.tsx:467-471`); **return ✗ no amount confirmation**; **send reminders ✗ no confirm**; product discount delete ✗ no confirm (`Products.tsx:526-530, 585`) | — | partial | static |
| Unsaved changes | no `beforeunload` / route-blocking anywhere (grep) — the POS cart is lost on navigation or reload | — | UX-15 | static |
| Duplicate entity creation | relies on server uniqueness (coupons 409, subdomain/email 409). Customers have no duplicate check (phone/email) | — | not a defect by itself | static |

---

## 9. RTL, Responsive Layout and Accessibility Analysis

**Objectively verified (rendered or measured):**

| Check | Result | Evidence |
|---|---|---|
| Document direction / language | `dir="rtl"`, `lang="ar-EG"` | E21 |
| Digits | Latin digits throughout via `ar-EG-u-nu-latn` (`lib/format.ts:3`) | rendered text |
| Money component | `<Money>` renders `dir="ltr"` "1,000.00 ج.م" ✓ **for numbers**; **strings (Prisma `Decimal` JSON) bypass formatting** → `976 ج.م`, `900 ج.م`; `undefined` → just `ج.م` (`components/ui/Money.tsx:25-41`) | E8 (UX-12) |
| Currency suffix | `ج.م` (Money) and `ج` (inline `formatMoney`) mixed **in the same totals panel** (`POS.tsx:815-849`) | E3 (UX-12) |
| POS at 375×812 | no horizontal overflow ✓; single-column stack; **checkout button 1151 px down (1.42 screens)**, below the full payment-method list | E21 (UX-13) |
| Subscription banner at 375 | `truncate` (`SubscriptionBanner.tsx:182`) cuts off the remaining-days number | E21 (UX-13) |
| Settings at 375 | **56 px horizontal overflow** (431 vs 375); fixed `w-48` tab rail (`Settings.tsx:55-56`) leaves a 184 px content column; tab labels clipped at the right edge | E22 (UX-13) |
| Invoices table at 375 | 658 px table in an `overflow-x:auto` wrapper ✓ | E22 |
| Dialogs / drawers | `role="dialog"`, `aria-modal`, `aria-labelledby`, focus moved in, Tab trapped, Escape closes, focus restored (`Modal.tsx:30-81`; `Drawer.tsx:35-60`) ✓. Escape also dismisses while a mutation is pending (e.g. the cancel-invoice modal); the request still completes | static ✓ / minor |
| POS search combobox | `role="combobox"`, `aria-activedescendant`, `listbox`/`option`, arrow keys + Enter (`POS.tsx:414-476`) ✓ | static |
| Form labels | ESLint `jsx-a11y/label-has-associated-control`: **24 warnings**; `click-events-have-key-events` 3; `no-static-element-interactions` 3 | lint (UX-17) |
| Icon-only buttons | quantity ± and remove in the POS have `aria-label` ✓ (`POS.tsx:528, 538, 550`); the return-dialog ± buttons have **no label** (`Invoices.tsx:100-110`); the customer remove "×" has no label (`POS.tsx:580`) | static (UX-17) |
| Error boundary | `ErrorBoundary` keyed by pathname wraps all routes (`App.tsx:54-62`) ✓ | static |
| Empty / loading / error states | lists use skeletons and empty states ✓, but **query errors render as empty states** ("لا توجد فواتير"): no error state, no retry (E17) | UX-08, UX-11 |
| Permission-denied state | route level ✓ (`ForbiddenView`); action level ✗ (403 toasts) | UX-10 |

**POS workflow friction (objective counts, desktop).** Recording one cash sale for a returning customer requires these interactions (counted from the component flow in `POS.tsx`; the product, payment and submit steps were also performed in the rendered app): search (type) → pick result → open customer modal → type 2+ characters → pick customer → pick payment method → **إتمام البيع** → **بيع جديد**. That is **8 interactions plus typing**.
- The payment method is **reset after every sale** (`POS.tsx:360`), so it must be picked again each time, even when 90 % of sales are cash.
- The completion modal must be dismissed before the next scan.

**Subjective design recommendations (not findings):**
- Default the payment method to the last used method or to cash.
- Auto-focus search after the completion modal closes.
- On phones, pin a compact totals bar with the checkout button.

---

## 10. Cross-Phase Findings and User-Visible Consequences

Each backend or integration finding below was traced through the actual frontend flow. A finding is marked "visible" only when a rendered or code-traced UI path exists.

| Prior finding | Frontend path | User-visible consequence | Status |
|---|---|---|---|
| **FIN-01** POS total excludes VAT / product discount | `POS.tsx:270-281, 848-850` | 950.00 shown vs 976.00 recorded; the receipt and modal don't reconcile | **visible, runtime** (UX-01) |
| **FIN-02** refund formula | `Invoices.tsx:68-86` | cashier refunds without a figure; the system books 926 for a 976 sale | **visible as absence**, runtime (UX-04) |
| **FIN-05 / HSEC-02** client prices | POS sends the catalog price (not editable); **installment form has an editable unit price** (`Installments.tsx:449`) | a user can lower a contract's price in the UI | **visible** (static; server acceptance confirmed in Phase 3) |
| **FIN-06** fee vocabulary | `POS.tsx:82-90, 639` | the cashier sees a 17.50 / 16.63 fee; the server records 0 and no fee expense; EOD "رسوم الدفع 0" | **visible, runtime** |
| **FIN-11** day close from invoice totals | `POS.tsx:905-1014`; `DayClose.tsx` | EOD total includes a refunded sale; expected cash comes from invoice totals | **visible, runtime** (E18) |
| **FIN-14** coupon minimum client-only | `POS.tsx:292-294` | not re-checked after the cart shrinks | visible (static, Phase 3) |
| **FIN-16** expired trial → PAST_DUE forever | `SubscriptionBanner.tsx:66-73` | red banner "تأخر دفع الاشتراك … لتجنب التعليق" persists; the app keeps working; the suspension never comes | visible (static) |
| **INT-04** ACTIVE without card never renews | `SubscriptionBanner.tsx:122-138` | **"سيتجدد اشتراكك خلال 0 يوماً"** forever | **visible, runtime** (E16, UX-08) |
| **DB-25 / BG-03** subscription state flips | banner cached 5 min (`useSubscription.ts:32`), refetched every 15 min | state changes appear up to 15 min late | visible (static) |
| **Billing 402** (`tenant.middleware.ts:103-112`, refresh `auth.routes.ts:111-130`) | no 402 handling (`api/client.ts:76-82`) | suspended/cancelled store sees an empty app with no explanation | **visible, runtime** (E17, UX-08) |
| **HSEC-04** card token in `/billing/portal` | `Settings.tsx:347-352` fetches it; the UI shows history only | token not displayed, but present in the browser's network data for anyone with Settings access | static (unchanged) |
| **INT-01 / DB-23** ETA blocked | Settings → ETA → retry (`Settings.tsx:2394-2402`) | generic toast "فشلت إعادة الإرسال"; no reason | visible (static + Phase 6 runtime of the route) |
| **INT-03** ETA statuses wrong | ETA tab lists by `etaStatus` | statuses shown would mirror the wrong DB values | potential (pipeline blocked) |
| **BG-05** Resend never throws | `Invoices.tsx:233-242`; `ForgotPassword.tsx`; `Installments.tsx:591-604` | "تم إرسال الفاتورة إلى X" and "أُرسل N" shown on failure | visible (static + Phase 6 runtime) |
| **HSEC-15** reset link `/reset` | email → `/reset?token=` → catch-all → `/` | password reset via email impossible | visible (Phase 2/6) |
| **HSEC-05** all-tenant reminders | `Installments.tsx:701` | a store user triggers other stores' reminder emails; the toast shows platform-wide counts | visible (static + Phase 5 runtime) |
| **DB-01** pending installment invoice cancellable | Invoices drawer shows **إلغاء الفاتورة** for `pending` (`Invoices.tsx:326-330`) | direct UI path to the P0 phantom-stock defect | visible (static) |
| **DB-10** no idempotency | POS retry after a network error; offline replay; two tabs; same-task double activation | duplicate sales | **runtime** (E20), static |
| **DB-38** invoice numbers use the UTC date | completion modal / receipt | `INV-20261011-…` printed on a receipt dated 12/10 | **visible, runtime** (E6) |
| **HSEC-01** settings authz | Settings tabs visible to `settings:read` | branch_manager can edit ETA credentials, payment methods, users | visible (static) |
| **HSEC-22** print HTML injection | EOD print writes unescaped method names (`POS.tsx:980-1003`); `lib/print.ts` escapes ✓ | as Phase 2 | unchanged |

---

## 11. Confirmed Findings

### UX-01 — The POS and installment form show, collect and print amounts that differ from what the server records · **P0** · Confirmed

| Field | Detail |
|---|---|
| Workflow / role | POS checkout, completion modal, thermal receipt, installment contract preview; cashier, branch_manager, owner |
| Files | `apps/web/src/pages/pos/POS.tsx:82-90` (fee), `:270-306` (totals), `:337-357` (completion record), `:638-662` (method fee), `:812-851` (totals panel), `:1017-1076` (completion modal); `apps/web/src/lib/print.ts:52-88` (receipt); `apps/web/src/pages/installments/Installments.tsx:362-371` (preview) |
| Root cause | pricing re-implemented on the client without VAT, product discounts or the server's fee vocabulary. The post-sale views combine client-computed lines with the server total. There is no server "quote" endpoint (RC-04) |
| Manifestations | (a) amount due 950.00 vs recorded 976.00 (E3, E4)<br>(b) the same method's fee shown as 17.50 and 16.63 simultaneously; the server records 0 (E3, E4)<br>(c) the completion modal's lines don't reconcile and have no VAT line (E5)<br>(d) the receipt has no VAT line and uses the client subtotal (E7)<br>(e) the installment preview is 88.00 vs 90.86/month (E19) |
| Reproduction | POS: product with a 14 % tax rate and an active discount, apply a coupon, select a percent-fee method, read the total, complete the sale, compare with the modal, the receipt and `invoices.total_amount` |
| Impact | the cashier collects 26.00 less than the invoice on this cart (VAT under-collected on every taxed sale), or more when product discounts exist; customers receive receipts whose numbers don't add up and that lack VAT; installment customers are quoted a lower monthly amount than contracted |
| Remediation | one server pricing function behind a `POST /invoices/quote` (and `/installments/quote`) the UI calls on every cart change; render the server breakdown (lines, discounts, VAT, fee, credit, total) in the panel, the modal and the receipt; delete the client `calculateFee` and the installment formula |
| Related | FIN-01 (P0), FIN-05, FIN-06, FIN-18, RC-04 |
| Regression test | Playwright against a seeded stack: the cart above → the total displayed before submit **equals** the persisted `total_amount`; the modal and receipt show tax 126.00, and their lines sum to the total; the installment preview equals the server's `monthly_amount` |

### UX-02 — Invoice details, the return dialog and the A4 tax invoice read fields the API does not return · **P1** · Confirmed

| Field | Detail |
|---|---|
| Workflow / role | Invoices → detail drawer, return dialog, "طباعة" (A4), bulk print; all roles with `invoices:read` |
| Files | `apps/web/src/pages/invoices/Invoices.tsx:17-27` (assumed item shape), `:52-64` (return items), `:346-357` (drawer lines), `:449-454` (bulk print from list rows); `apps/web/src/lib/print.ts:106-113, 137-167`; API `apps/api/src/modules/invoices/invoice.service.ts:97-122` (returns raw `items[].variant.product.name`, `variant.sku`, `subtotal`), `invoice.routes.ts:93-108` |
| Root cause | the frontend type `InvoiceItem { productName, variantSku, totalPrice }` was never mapped from the API shape; there is no shared contract (RC-09). TypeScript can't catch it because the axios response is cast |
| Evidence | drawer: `خدمة × 1`, amount `ج.م` (E8); return dialog: `— · الكمية المباعة: 1` (E10); A4: empty item name, line total `ليس رقمًا` (E9). The list endpoint returns no items at all, so bulk print produces invoices **without lines** |
| Impact | no invoice can be reviewed line by line in the UI; product lines are mislabelled "service"; on multi-item invoices the cashier cannot tell which line they are returning; printed tax invoices are unusable for customers and auditors |
| Remediation | map the API items server-side into a stable DTO (`productName`, `sku`, `lineSubtotal`, `taxAmount`, `discountAmount`), or adapt the UI to `variant.product.name` / `subtotal`; share the type via `packages/shared`; fetch details before bulk printing |
| Related | RC-09; FIN-22 (names read live) |
| Regression test | component test with a recorded `GET /invoices/:id` fixture: the drawer shows the product name and a 2-dp line amount; snapshot of the A4 HTML contains no `NaN` / `ليس رقمًا` and a non-empty item name |

### UX-03 — The seeded cashier role cannot complete a sale; the POS hides the 403 · **P1** · Confirmed

| Field | Detail |
|---|---|
| Workflow / role | POS checkout; **cashier** (also accountant and inventory_keeper if given POS access) |
| Files | `apps/web/src/pages/pos/POS.tsx:148-151` (query; no error handling; default `[]`), `:853-859` (button disabled without a method); API `apps/api/src/modules/payment-methods/pm.routes.ts:9` (`requirePermission('settings','read')`); seed roles in `tenant.service.ts` (cashier lacks `settings:read`) |
| Root cause | a configuration read the POS needs is classified as a settings permission (RC-10), and the UI swallows query errors |
| Evidence | E14: `GET /api/payment-methods → 403` twice; empty list; **إتمام البيع** disabled; no message |
| Impact | stores that give staff the "cashier" role cannot sell; owners have to grant `settings:read`, which also opens the whole Settings page including HSEC-01's unprotected writes |
| Remediation | a dedicated read permission (or allow `invoices:create`) on `GET /payment-methods`; show a blocking error state in the POS when a required query fails |
| Related | Phase 2 §5.1 (table note, unrated); HSEC-12; RC-10 |
| Regression test | log in as the seeded cashier → POS lists the active payment methods → a cash sale completes (201) |

### UX-04 — Returns are confirmed without the refund amount; already-returned lines can be selected again; errors are raw · **P1** · Confirmed

| Field | Detail |
|---|---|
| Workflow / role | Invoices → إرجاع; branch_manager, owner (cashier sees the button but gets 403, UX-10) |
| Files | `apps/web/src/pages/invoices/Invoices.tsx:52-64` (`maxQty = sold qty`), `:68-86` (mutation: success toast only; invalidates `invoices` only), `:117-148` (no amount preview); API `invoice.service.ts` `returnInvoice` (amount computed server-side, FIN-02) |
| Root cause | the refund amount exists only on the server and is not previewed or returned to the user; the dialog has no knowledge of prior returns (RC-03) |
| Evidence | E10: confirmed a cash refund with no amount shown; persisted `returns.amount = 926.00` (sale 976.00); invoice status still `completed`. E11: the same line selectable again → toast `return_qty_exceeds_sold:d6ab3056-…` |
| Impact | the cashier pays out cash from memory (likely 976) while the system books 926: the drawer is short by the difference, and no audit trail captures the cash actually handed over. "Credit" returns silently credit the FIN-02 amount. Raw errors confuse staff |
| Remediation | `POST /invoices/:id/return/preview` returning the per-line and total refund; show it and require confirmation; return the amount in the response and print a refund slip; cap the qty at the remaining returnable qty (sold − returned); map error codes |
| Related | FIN-02 (P0), DB-06, FIN-11 |
| Regression test | a full return of a taxed, couponed sale shows the refund amount before confirmation, and it equals the persisted `returns.amount`; reopening the dialog shows 0 returnable |

### UX-05 — Offline mode is blocked by TanStack Query's paused mutation; when the queue is used, it is wrong · **P2** · Confirmed

| Field | Detail |
|---|---|
| Workflow / role | POS during connectivity loss; any POS user |
| Files | `apps/web/src/pages/pos/POS.tsx:116-118, 122-146` (queue + replay on `online` only), `:308-336` (mutation; offline branch `:323-333` returns `totalAmount: 0`), `:398-408` (banner); `main.tsx:51-58` (no `networkMode`); `@tanstack/query-core` 5.100.10 `build/modern/retryer.js:10-11, 43`; `auth.store.ts:35-38` (logout keeps the queue) |
| Root cause | the offline design assumes `mutationFn` runs while offline, but the library pauses it (`networkMode: 'online'`); the queue is not scoped to user or tenant and has no idempotency key (RC-05) |
| Evidence | E12: after `offline`, the button spins and the queue stays empty; on reconnection the paused sale posted (285.00 vs 250.00 shown). E13: the queue survived logout and was presented to the next user ("1 فاتورة معلقة"). Static: replay only on an `online` event; offline completion shows a total of 0 |
| Impact | during an outage the till is blocked, contrary to the banner ("ستُحفظ محلياً"). A reload while offline loses the pending sale. A queued sale replays under whoever is logged in next (wrong cashier, wrong tenant after a store switch on a shared device); two tabs replay the same queue (duplicates, DB-10) |
| Remediation | either declare offline unsupported (remove the banner/queue) or implement it properly: `networkMode: 'always'` for the sale mutation, a persisted queue keyed by tenant + user with client-generated idempotency keys honoured by the server, replay on load and on `online`, single-tab leadership (BroadcastChannel/Web Locks), and receipts marked "pending sync" with the client-computed (quote) totals |
| Related | FIN-09, DB-10, RC-05 |
| Regression test | Playwright `context.setOffline(true)`: a sale is queued (not paused), visible in the banner; reload keeps it; `setOffline(false)` posts it exactly once with the original cashier; logout clears or segregates it |

### UX-06 — Financial summaries are served stale after sales and returns · **P2** · Confirmed

| Field | Detail |
|---|---|
| Workflow / role | POS "إغلاق اليوم" modal, Dashboard, Reports, customer balances after a sale or return; cashier, manager |
| Files | `apps/web/src/main.tsx:54` (`staleTime: 5 min` global); `POS.tsx:171-192` (EOD queries, key `['eod-dashboard']` without a date; `enabled: showEOD`), `:308-377` (sale mutation: no `invalidateQueries`); `Invoices.tsx:74-77` (return invalidates only `invoices`) |
| Root cause | a global staleTime with no mutation-driven invalidation; enabling a query that already holds fresh data doesn't refetch it |
| Evidence | E18: EOD 1,261 / 2 invoices / cash 285 × 1, unchanged after a new 285.00 cash sale |
| Impact | the cashier counts the drawer against totals that omit recent sales (and include refunded ones, FIN-11). The dashboard and customer credit balances lag up to 5 min after sales and returns |
| Remediation | invalidate `['eod-*']`, `['dashboard']`, `['reports']`, `['customers']`, `['stock']` on sale, return and cancel success; give the EOD queries `staleTime: 0` and a date in the key; show "as of HH:MM" with a refresh button |
| Related | FIN-11 |
| Regression test | open EOD → close → sell → reopen: totals include the new sale |

### UX-07 — The client uses the UTC calendar day for "today" · **P2** · Confirmed

| Field | Detail |
|---|---|
| Workflow / role | Day close, POS EOD, Reports default range, Dashboard, installment payment date, expense date, discount start date; all roles, every night between 00:00 and 02:00 (EET) / 03:00 (EEST) |
| Files | `POS.tsx:165`; `DayClose.tsx:64`; `Reports.tsx:67-68`; `Dashboard.tsx:107, 132`; `Installments.tsx:589, 659, 664, 787, 833, 850, 853`; `Expenses.tsx:511, 544`; `Products.tsx:532` (16 call sites of `toISOString().slice(0,10)`) |
| Root cause | no business timezone. `tenant_settings.timezone` is stored but unused (§8); the code takes the date from UTC |
| Evidence | deterministic replay under `TZ=Africa/Cairo` at local 2026-11-01 00:30 → `clientToday = 2026-10-31`, `reportsMonthStart = 2026-10-31`, `installmentMaxPaidDate = 2026-10-31`; E6 (invoice number `…20261011` on a sale made on local 12 Oct) |
| Impact | late-night day close shows the previous day; the monthly report for the new month begins on the previous month's last day; installment payments taken after midnight must be back-dated (the local date is rejected by `max`/`disabled`), shifting overdue status; invoice numbers carry the previous date (DB-38) |
| Remediation | one date utility using the tenant's timezone (`Intl.DateTimeFormat(…, { timeZone })`) for every "today"/range on the client, and the same zone on the server for reports and numbering |
| Related | DB-38, BG-14 (server-side TZ), FIN-11 |
| Regression test | unit tests with a fake clock at 00:30 Africa/Cairo: `today()` = local date; month start = the 1st of the local month |

### UX-08 — Subscription states are misrepresented: suspended stores see an empty app; INT-04 shows "renews in 0 days" forever · **P2** · Confirmed

| Field | Detail |
|---|---|
| Workflow / role | every page for a tenant in `SUSPENDED` / `CANCELLED` / INT-04 / FIN-16 state; all roles |
| Files | `apps/web/src/api/client.ts:76-82` (only 401 is handled), `:34-57` (refresh failure swallowed); `hooks/useSubscription.ts:21-35` (`enabled: !!accessToken`); `components/SubscriptionBanner.tsx:20-25` (`daysUntil` clamps at 0), `:66-73` (PAST_DUE), `:122-138` (ACTIVE ≤ 7 days), `:182` (truncate), `:184` (CTA to Settings for every role); API `auth.routes.ts:111-130` (refresh → 402), `tenant.middleware.ts:88-112` |
| Root cause | HTTP 402 is not modelled in the client; the banner derives everything from `status` + dates and has no "period ended" state |
| Evidence | E17: SUSPENDED + reload → refresh 402, `/invoices` 402, empty state "لم يتم إصدار أي فاتورة بعد", no banner, no toast. E16: ACTIVE with an ended period → "سيتجدد اشتراكك خلال 0 يوماً" |
| Impact | suspended owners believe their data is gone and get no path to pay until a forced re-login. INT-04 tenants are told "renews in 0 days" indefinitely while using the product unpaid. PAST_DUE banners threaten a suspension that never happens (FIN-16). Non-owner roles are sent to a forbidden page by the CTA |
| Remediation | a global 402 handler (axios interceptor plus QueryCache `onError`) that shows a full-page "subscription inactive" state with the billing link for owners and a "contact the owner" message for others; a banner state for "period ended, payment not received"; show the CTA only to `billing` holders |
| Related | INT-04, FIN-16 / HSEC-08, BG-03, DB-25 |
| Regression test | MSW: `/invoices` → 402 `subscription_inactive` → the full-page inactive state is rendered (not an empty list); `/billing/status` ACTIVE with a past `currentPeriodEnd` → no "0 days" text |

### UX-09 — Product discounts cannot be created; the UI shows a generic error · **P2** · Confirmed

| Field | Detail |
|---|---|
| Workflow / role | Products → discounts; owner, branch_manager (`products:update`) |
| Files | UI `apps/web/src/pages/products/Products.tsx:510-523` (sends `startDate`/`endDate` from date inputs; `onError` → "حدث خطأ"); API `apps/api/src/modules/products/product.routes.ts:437-451` (`...parsed.data` into `productDiscount.create`; Prisma `DateTime @db.Date`) |
| Root cause | the date strings are passed to a Prisma `DateTime` without conversion (RC-09); the UI masks the server message |
| Evidence | E1: `500 PrismaClientValidationError: Invalid value for argument startDate: premature end of input. Expected ISO-8601 DateTime` for the exact UI payload |
| Impact | the discount feature is unusable; staff see "حدث خطأ" with no hint. It also means FIN-01's product-discount component can only arise from data created outside the UI (§13) |
| Remediation | convert to `new Date(\`${d}T00:00:00Z\`)` (or `z.coerce.date()`) server-side; surface the server error message in the UI |
| Related | FIN-01 (correction), RC-09 |
| Regression test | API test: POST discount with `YYYY-MM-DD` → 201; UI test: adding a discount lists it |

### UX-10 — Actions are offered to roles the server will refuse; settings sub-areas aren't filtered · **P3** · Confirmed

| Field | Detail |
|---|---|
| Files | `Invoices.tsx:321-330` (return/cancel shown to all), `Installments.tsx:701` (send reminders shown to all page users), `SubscriptionBanner.tsx:184` (CTA for all), `Settings.tsx:22-79` (all tabs for `settings:read`) |
| Root cause | per-page action visibility does not consult `hasPermission`, and server permissions are not uniformly modelled (RC-10) |
| Evidence | E15: the cashier sees إرجاع / إلغاء الفاتورة; confirming → "ليس لديك صلاحية للقيام بهذا الإجراء" |
| Impact | confusing dead-ends; branch_manager can use Settings writes the server never protects (HSEC-01); not a security control either way |
| Remediation | gate each action button on `hasPermission(resource, action)` mirrored from the route; per-tab permissions in Settings that match the server |
| Related | HSEC-01, HSEC-04, HSEC-05, HSEC-12 |
| Regression test | render the Invoices drawer as cashier: no return/cancel buttons; as branch_manager: present |

### UX-11 — Error mapping exposes raw codes and hides actionable messages; one unhandled rejection · **P3** · Confirmed

| Field | Detail |
|---|---|
| Files | `lib/api-error.ts:26-39` (shows `error.message` verbatim); server messages that *are* raw codes (`return_qty_exceeds_sold:<uuid>`, `down_payment_exceeds_total`); generic toasts that drop the server message (`Products.tsx:522` "حدث خطأ", `Settings.tsx:2401` "فشلت إعادة الإرسال", `Installments.tsx:604` "فشل إرسال التذكيرات"); `Invoices.tsx:215-218` (`openDetail` without `try/catch` → unhandled promise rejection, no feedback); query errors rendered as empty lists (E17) |
| Evidence | E11, E19 |
| Impact | staff can't act on errors; failures are indistinguishable from "no data" |
| Remediation | a central code → Arabic message map (server codes never as messages); an error state with retry in list components; `try/catch` with a toast around imperative fetches |
| Related | RC-09 |
| Regression test | MSW returns `return_qty_exceeds_sold:<id>` → the toast shows an Arabic sentence without the id |

### UX-12 — Money formatting is inconsistent; server decimals render unformatted · **P3** · Confirmed

| Field | Detail |
|---|---|
| Files | `components/ui/Money.tsx:25-41` (strings passed through unformatted; `undefined` renders just the currency); `POS.tsx:815-849` (`ج.م` via Money and `ج` via `formatMoney` in one panel), `:910` (EOD total rounded to an integer); `print.ts:54, 79-82` (`toFixed(2)` without grouping) |
| Evidence | E8 (`976 ج.م`, `900 ج.م`), E3 (`1,000.00 ج.م` next to `-50.00 ج`), E18 (`1,261 ج`) |
| Impact | amounts look different on every screen (1,000.00 / 1000.00 / 976); piasters are hidden in the EOD total |
| Remediation | coerce strings to numbers (or format the decimal string) in `Money`; one currency label; 2 dp everywhere money is shown |
| Regression test | `Money` unit test: `"976"` → `976.00 ج.م`; `undefined` → `—` |

### UX-13 — Responsive layout: Settings overflows at phone width; the POS checkout sits below the fold; the banner hides key data · **P3** · Confirmed

| Field | Detail |
|---|---|
| Files | `Settings.tsx:55-56` (fixed `w-48` rail in a non-wrapping flex row); `POS.tsx:564-871` (single column on mobile, checkout after the full method list); `SubscriptionBanner.tsx:182` (`truncate`) |
| Evidence | E21, E22 (431 px document on a 375 px viewport; 184 px content column; clipped labels; checkout at 1.42 screens) |
| Impact | Settings (incl. billing/checkout) barely usable on phones; mobile cashiers scroll for every sale; the trial-days number is cut off |
| Remediation | stack or collapse the Settings rail below `md` (tabs as a select); a sticky mobile checkout bar; let the banner wrap |
| Regression test | Playwright at 375×812: `scrollWidth === innerWidth` on `/settings`; checkout button within the first viewport on `/pos` |

### UX-14 — The double-submit guard is asynchronous; no idempotency key backs it · **P3** · Confirmed

| Field | Detail |
|---|---|
| Files | `POS.tsx:308, 384-393, 853-859`; all `useMutation` buttons relying on `isPending` |
| Evidence | E20: two activations in one task → two invoices 4 ms apart; 120 ms apart → one |
| Impact | low likelihood (human double-clicks are blocked), but any synchronous double dispatch (a scripted scanner/keyboard macro sending Enter plus a click, a hotkey and a click) creates a duplicate sale that has to be cancelled by hand |
| Remediation | a synchronous `useRef` in-flight flag in the handler, plus a client idempotency key per checkout (server-enforced, DB-10) |
| Related | DB-10, FIN-09 |
| Regression test | dispatch two clicks synchronously → exactly one `POST /invoices` |

### UX-15 — Session expiry or navigation discards the POS cart and form state without warning · **P3** · Confirmed (static)

| Field | Detail |
|---|---|
| Files | `api/client.ts:109-120` → `auth.store.ts:35-38` (`window.location.href`); `POS.tsx:93-113` (cart in component state only); no `beforeunload`/`useBlocker` anywhere (grep: 0 matches) |
| Impact | a cashier mid-sale whose refresh fails (Redis blip, revoked session, 402) loses the cart and has to re-scan; contract and PO forms are also lost on navigation |
| Remediation | persist the cart draft (sessionStorage, keyed by tenant + user); re-authenticate in a modal instead of a hard redirect; block navigation with unsaved forms |
| Regression test | expire the refresh cookie with items in the cart → after re-login the cart is restored |

### UX-16 — Loyalty points can be earned but not redeemed from any screen · **P3** · Confirmed (static)

| Field | Detail |
|---|---|
| Files | server supports `redeemPoints` (`invoice.schema.ts:14`; `invoice.service.ts:280-304`); POS payload has no such field (`POS.tsx:312-322`); `grep redeemPoints apps/web/src` → 0 matches; customer ledger lists `loyalty_earned` / `loyalty_reversed` but no `loyalty_redeemed` label (`Customers.tsx:126, 236-237`) |
| Impact | the advertised loyalty programme accrues a liability customers can't use; staff can't honour points |
| Remediation | a redemption control in the POS customer card (with the server quote, UX-01); a ledger label for redemptions |
| Related | FIN-12 |

### UX-17 — Accessibility labelling gaps · **P3** · Confirmed (static / lint)

| Field | Detail |
|---|---|
| Files | ESLint: 24 × `label-has-associated-control` (e.g. `Suppliers.tsx:290, 447`), 3 × `click-events-have-key-events`, 3 × `no-static-element-interactions`; unlabeled icon buttons `Invoices.tsx:100-110` (return ±), `POS.tsx:580` (remove customer) |
| Positive | dialogs and drawers trap focus and restore it; the POS search is a proper combobox; the POS quantity buttons are labelled |
| Remediation | associate labels (`htmlFor`/`id` via the shared `Input`), `aria-label` on icon buttons, keyboard handlers for clickable non-buttons |

---

## 12. Likely, Potential and Unverified Findings

| ID | Class | Sev. | Finding | Basis |
|---|---|---|---|---|
| **UX-L01** | Likely | P2 | The printed "فاتورة ضريبية" and the thermal receipt identify the platform ("حِسبة POS" / "حِسبة") instead of the selling store, and carry no tax registration number. Egyptian tax-invoice requirements are not verified here | `print.ts:69, 137-138`; E7, E9 |
| **UX-L02** | Likely | P2 | Cash drawer discrepancies on returns: the cashier refunds the price paid (976) while the system records 926 (UX-04 + FIN-02); EOD's expected cash ignores refunds (FIN-11) | E10, E18 |
| **UX-L03** | Likely | P3 | The store-settings VAT toggle / rate and the timezone field mislead: POS VAT ignores them (product tax rates), and `timezone` is never read | `Settings.tsx:99-108`; Phase 1 §6; grep |
| **UX-L04** | Likely | P3 | Two open POS tabs both replay `pos_offline_queue` on `online` → duplicate sales | `POS.tsx:122-146` (no lock) |
| **UX-P01** | Potential | P3 | POS search options may lack an accessible name in some AT (the accessibility tree read by the audit tool showed `option` with no name) | read_page output; not verified with a screen reader |
| **UX-P02** | Potential | P3 | A hung `POST /invoices` (no client timeout) leaves the till blocked until a reload, which loses the cart | `api/client.ts:5-9`; UX-15 |
| **UX-U01** | Unverified | — | Behaviour on Safari/iOS (date inputs, `navigator.onLine`, print), thermal printers (80 mm layout), screen readers | not tested |
| **UX-U02** | Unverified | — | Cross-subdomain tabs sharing the parent-domain refresh cookie (HSEC-23) after logging into another tenant: the refresh with the other tenant's header (AU-02) | not exercised (single-origin dev) |
| **UX-U03** | Unverified | — | Production values: GA enabled (HSEC-25 page-view leakage), container TZ, Paymob redirect contents on `/settings?tab=billing` (L6-02) | not accessible |

---

## 13. Findings Deliberately Excluded or Corrected

**Corrections to earlier phases:**

| Item | Earlier statement | Phase 7 result |
|---|---|---|
| FIN-01 | the POS total excludes VAT **and product discounts** | VAT part **confirmed at runtime**. Product discounts **cannot be created through the UI** (UX-09), so that part only arises from data created outside the UI (seed/import/SQL). FIN-01 severity unchanged (the VAT part alone is P0) |
| HSEC-02 framing (Phase 2 §5.2) | "the POS UI never edits prices" | true for the POS; the **installment contract form exposes an editable unit price** (`Installments.tsx:449`), a direct UI path to FIN-05 |
| Phase 2 §5.1 table note | "cashier cannot list methods the POS needs (functional)", unrated | runtime-confirmed and rated **P1 (UX-03)** |
| Memory of earlier frontend work | "55 a11y/style warnings remain" | still exactly **55 warnings, 0 errors** |

**Excluded (investigated, no defect):**

| Area | Why excluded |
|---|---|
| Cross-tenant cache leakage via TanStack Query | the cache is in memory, and logout does a full reload; login while logged in is blocked by `GuestGuard` |
| Service-worker API caching | `sw.js:33` skips every `/api/` request |
| Silent replay of non-idempotent POSTs by the axios interceptor | it replays only after 401, which the server returns before running handlers; mutations have `retry: 0` |
| Modal focus management | correct (§9) |
| Coupon minimum, split validation, loyalty floor | already FIN-14 / FIN-15 / FIN-12; no new UI consequence beyond §4 |
| Print HTML injection in `lib/print.ts` | escaped (`print.ts:20-27`); the remaining unescaped sinks are HSEC-22, unchanged |
| Invoice list table at phone width | scrolls inside its container (acceptable) |

---

## 14. Prioritized Remediation Recommendations

**Release blockers** (money shown or collected wrongly, or a core workflow blocked):

| # | Change | Closes | Depends on |
|---|---|---|---|
| 1 | **Server quote endpoint + UI renders only server totals** (POS panel, completion modal, receipt, installment preview); remove the client `calculateFee` and installment math | UX-01 (FIN-01 UI), part of UX-04 | RC-04 server pricing (Phase 4.5 change #3) |
| 2 | **Return preview + confirmation of the refund amount**, remaining-qty cap, refund slip | UX-04 | FIN-02 fix |
| 3 | **Fix the invoice-detail contract** (a DTO with names, SKUs, line totals) and the A4/bulk print | UX-02 | — |
| 4 | **Payment-method read access for POS roles** + an error state when a POS prerequisite query fails | UX-03 | — |

**Next** (correctness of state and time):

| # | Change | Closes |
|---|---|---|
| 5 | Global 402 / `subscription_inactive` handling and banner states for "period ended unpaid" | UX-08 |
| 6 | Mutation-driven invalidation (sale/return/cancel → EOD, dashboard, reports, customers, stock); EOD `staleTime: 0` | UX-06 |
| 7 | Tenant-timezone date utility on client and server | UX-07, DB-38 |
| 8 | Decide on offline: remove it, or rebuild it (`networkMode: 'always'`, persisted per-tenant/user queue, idempotency keys, replay on load, single-tab leadership) | UX-05, UX-14, UX-L04 |
| 9 | Product-discount date conversion; surface server messages | UX-09 |

**Can follow:**

| # | Change | Closes |
|---|---|---|
| 10 | Permission-gated actions and Settings tabs | UX-10 |
| 11 | Error-code → message map; error states in lists | UX-11 |
| 12 | `Money` formatting and one currency label | UX-12 |
| 13 | Mobile Settings layout, sticky mobile checkout, wrapping banner | UX-13 |
| 14 | Cart draft persistence; re-auth modal | UX-15 |
| 15 | Loyalty redemption UI | UX-16 |
| 16 | a11y labels | UX-17 |
| 17 | Store identity and tax id on printed documents (after confirming the legal requirement) | UX-L01 |

---

## 15. Regression Test Plan

**Environment for every test:**
- A disposable PostgreSQL + Redis.
- The real API with a loopback-only `fetch` guard and every `.env` key overridden.
- The real web build.
- A synthetic tenant seeded through `POST /api/tenants/register` and the public API.
- Playwright (Chromium + WebKit) for rendered flows; Vitest + Testing Library + MSW for component tests.
- No external providers.

| Test | Covers | Type | Assertion |
|---|---|---|---|
| RT7-01 | UX-01 | Playwright | for a taxed + product-discounted + couponed cart, the displayed amount due equals the persisted `total_amount`; modal and receipt show the VAT line, and their lines sum to the total |
| RT7-02 | UX-01 | Playwright | the installment preview equals the server's `monthly_amount` for the same form |
| RT7-03 | UX-02 | Vitest + recorded fixture | the drawer shows the product name, SKU and a 2-dp line amount; the A4 HTML has no `NaN`/`ليس رقمًا` |
| RT7-04 | UX-03 | Playwright | the seeded cashier completes a cash sale (201) |
| RT7-05 | UX-04 | Playwright | the return dialog shows the refund before confirmation, equal to `returns.amount`; reopening shows remaining qty 0 |
| RT7-06 | UX-05 | Playwright `setOffline` | an offline sale is queued and survives reload; online → posted exactly once with the original cashier; logout segregates the queue |
| RT7-07 | UX-06 | Playwright | EOD reopened after a sale includes it |
| RT7-08 | UX-07 | Vitest fake timers, `TZ=Africa/Cairo` | `today()` and `monthStart()` at 00:30 local return the local date |
| RT7-09 | UX-08 | Vitest + MSW | 402 → full-page inactive state; ACTIVE with a past period → no "0 days" text |
| RT7-10 | UX-09 | API | `POST /products/:id/discounts` with `YYYY-MM-DD` → 201 |
| RT7-11 | UX-10 | Vitest | cashier: no return/cancel buttons; branch_manager: visible |
| RT7-12 | UX-11 | Vitest + MSW | raw codes are mapped to Arabic messages; list query errors show an error state |
| RT7-13 | UX-12 | Vitest | `Money` formats strings and `undefined` |
| RT7-14 | UX-13 | Playwright 375×812 | `/settings` has no horizontal overflow; POS checkout in the first viewport |
| RT7-15 | UX-14 | Vitest | two synchronous clicks → one POST |
| RT7-16 | UX-15 | Playwright | refresh failure mid-cart → the cart is restored after re-login |

**Gates:** RT7-01…RT7-05 gate the release (P0/P1). The rest gate their respective fixes.

---

## 16. Evidence Ledger

**Runtime stack (throwaway):**
- Docker `postgres:16-alpine` (`hesba-p7-pg`, 127.0.0.1:55436) and `redis:7-alpine` (`hesba-p7-redis`, 127.0.0.1:56382).
- Master schema via `prisma migrate deploy` and the repo's master seed (plans).
- The real `apps/api/src/index.ts` on :3000 behind a loopback-only `fetch` guard, with every repo `.env` key overridden (Paymob/ETA/Resend pointed at unused loopback ports, `RESEND_API_KEY` empty).
- The real web dev server via the existing `.claude/launch.json` entry `hesba-web` (Vite :5173, `/api` proxied to :3000), driven in the in-app browser pane.

**Synthetic data:**
- Tenant `p7shop` (plan professional) registered through `POST /api/tenants/register`.
- Owner and cashier users.
- Products "هاتف تجريبي Galaxy" (1000, VAT 14 %) and "سماعة لاسلكية" (250, VAT 14 %), stock 20 each.
- Coupon `SAVE50` (fixed 50, min 900); a customer with 200 credit.
- A 10 % product discount inserted directly in SQL (the API route fails, E1).
- All containers, processes and scratch files were removed at the end (§17).

| # | Observation | Source |
|---|---|---|
| E1 | `POST /api/products/:id/discounts` with the UI's exact body (`YYYY-MM-DD` dates) → **500** `PrismaClientValidationError … startDate: premature end of input. Expected ISO-8601 DateTime`; the UI shows "حدث خطأ" | API log; `product.routes.ts:437-451`; `Products.tsx:510-523` |
| E2 | the 10 % product discount was inserted directly in the throwaway schema to continue | SQL |
| E3 | POS totals panel: `المجموع الفرعي 1,000.00 ج.م`, `خصم الكوبون (SAVE50) -50.00 ج`, `رسوم فيزا / ماستر (يتحملها التاجر) 16.63 ج`, **`الإجمالي 950.00 ج.م`**; the same method's button: `17.50 رسوم` | DOM text |
| E4 | `POST /api/invoices` → 201; persisted `subtotal 900`, `discount_amount 50`, `tax_total 126`, `fee_amount 0`, **`total_amount 976`**; item `unit_price 1000`, `discount 100`, `tax 126`; 0 `payment_fee_expenses` rows | psql |
| E5 | completion modal: `INV-20261011-000001`, `976.00 ج.م`; lines `1,000.00 / -50.00 / الإجمالي 976.00`; no VAT or product-discount line | screenshot |
| E6 | invoice number date `20261011` while local time was `Mon Oct 12 00:24 EEST 2026`; the receipt prints `12/10/2026 12:24:40 ص` | psql + `date` |
| E7 | thermal receipt HTML (captured by stubbing `window.open`): `حِسبة / نقطة البيع`, item `1000.00 ج`, `المجموع الفرعي 1000.00 ج`, `خصم (SAVE50) -50.00 ج`, `الإجمالي 976.00 ج`; no VAT, store name or tax id | captured HTML |
| E8 | invoice drawer: item **`خدمة × 1`**, amount **`ج.م`**; totals `900 ج.م`, `-50 ج.م`, `126 ج.م`, `976 ج.م` | DOM text |
| E9 | A4 "فاتورة ضريبية": item name empty, qty `1`, unit `1,000.00`, line total **`ليس رقمًا`**, totals `900.00 / - 50.00 / 126.00 / 976.00 ج`, header `حِسبة POS` | captured HTML |
| E10 | return dialog: `— · الكمية المباعة: 1`; confirm (qty 1, استرداد نقدي) → toast `تم تسجيل المرتجع`; persisted **`returns.amount = 926.0000`**; invoice status `completed` | DOM, psql |
| E11 | second return of the same line allowed by the dialog → toast **`return_qty_exceeds_sold:d6ab3056-1165-4be6-a999-e5b8611caa53`** | DOM toast |
| E12 | offline simulation: banner `… ستُحفظ محلياً (0 في الانتظار)`; sale (headset 250, نقدي) → button stays loading, `pos_offline_queue` empty; after `online`/`focus` the paused mutation posted **INV-20261012-000002 = 285.00** (UI showed 250.00) | DOM, localStorage, psql; `query-core` 5.100.10 `retryer.js:10-11, 43` |
| E13 | logout → `hesba-auth` cleared, **`pos_offline_queue` kept** (a synthetic marker planted before logout); the cashier's POS then showed `1 فاتورة معلقة — سيتم إرسالها تلقائياً` | localStorage, screenshot |
| E14 | cashier POS: `GET /api/payment-methods` → **403 ×2**; the method list is empty; **إتمام البيع** disabled; no message | network log, DOM, roles in DB |
| E15 | cashier: the drawer shows إرجاع / إلغاء الفاتورة; confirming the cancel → `ليس لديك صلاحية للقيام بهذا الإجراء` | DOM |
| E16 | subscription `ACTIVE`, period ended 5 days ago, no card → banner **`سيتجدد اشتراكك خلال 0 يوماً`** | DOM `[role=alert]` |
| E17 | subscription `SUSPENDED`, reload: `POST /api/auth/refresh` → 402; `/invoices`, `/reports/dashboard` → 402; page shows `لا توجد فواتير — لم يتم إصدار أي فاتورة بعد`; no banner, no toast | network log, DOM |
| E18 | EOD before: `1,261 ج / 2 / رسوم 0 ج / نقدي 285 × 1`; after a new cash sale INV-20261012-000003 (285.00), reopened: identical | DOM at 05:44Z |
| E19 | installment payload as in `Installments.tsx:374-389` (1000, down 200, 10 × 12 %): form formula 88.00/month vs server **90.86/month** (total 1108.60, invoice 1026 incl. VAT 126 and discount 100); with `unitPrice 1` → `400 down_payment_exceeds_total` (raw) | node → API, psql |
| E20 | two synchronous clicks → INV-…000004 and INV-…000005 (285.00 each, 4 ms apart); two clicks 120 ms apart → one invoice (button disabled at 120 ms) | psql timestamps |
| E21 | 375×812 `/pos`: `dir=rtl`, `lang=ar-EG`, no overflow; checkout at y = 1151 px (1.42 screens); banner text truncated | DOM metrics, screenshot |
| E22 | 375×812 `/settings?tab=billing`: scroll width 431 px; content 184 px; clipped tab labels. `/invoices`: 658 px table in an `overflow-x:auto` wrapper | DOM metrics, screenshot |

**Static / tool evidence:**
- **Type-check:** `npx tsc --noEmit` (apps/web) → exit 0, no errors.
- **Lint:** `npx eslint src --ext .ts,.tsx` → **0 errors, 55 warnings**: `label-has-associated-control` 24, `react-hooks/incompatible-library` 11, `react-hooks/set-state-in-effect` 8, `react/no-unescaped-entities` 4, `click-events-have-key-events` 3, `no-static-element-interactions` 3, `exhaustive-deps` 2.
- **Build:** `npx vite build --outDir <scratchpad>` → built in 3.04 s (largest chunks: Reports 434.85 kB, xlsx 429.03 kB, index 322.42 kB); output written outside the repository.
- **Date replay:** `TZ=Africa/Cairo` with a fixed clock 2026-11-01 00:30 local → `clientToday 2026-10-31`, `reportsMonthStart 2026-10-31`, `installmentMaxPaidDate 2026-10-31`.
- **Library source:** `@tanstack/query-core` 5.100.10 `build/modern/retryer.js:10-11` (`canFetch`: default `networkMode 'online'`), `:43` (`canStart`); `onlineManager.js:4, 13-14` (initial online, window listeners).
- **Greps:** `hasPermission` absent from Invoices/Installments/Customers; `beforeunload|useBlocker` 0 matches; `redeemPoints` 0 matches in `apps/web/src`; `toISOString().slice(0, 10)` 16 date call sites.

---

## 17. Audit Declaration

| | |
|---|---|
| Application source files modified | **NO** |
| Tests, migrations, configuration, package files modified | **NO** (`.claude/launch.json` used as-is, not edited) |
| Production data or services accessed | **NO** |
| Real payments, emails, tax submissions | **NO** (no provider contacted; outbound `fetch` restricted to loopback) |
| Destructive actions | only on throwaway data (sales, a return, a cancel attempt, installment contracts, subscription-state edits in the throwaway master DB) |
| Throwaway services used | Docker `hesba-p7-pg`, `hesba-p7-redis` (**deleted**); API on :3000 and Vite on :5173 (**stopped**); Docker Desktop started for the run and quit afterwards |
| Tested at runtime | POS sale (taxed, discounted, couponed, fee method); completion modal; thermal receipt and A4 print HTML; invoice drawer; return and repeated return; cancel as cashier; offline pause/resume; offline queue persistence across logout; cashier POS permissions; subscription banner states (INT-04 / SUSPENDED); EOD staleness; installment preview vs server; synchronous double activation; 375 px layouts of POS / Settings / Invoices |
| Tested statically | all other pages' flows (§3–§10), RHF/zod vs server schemas, guards and role matrices, mutation inventory, date handling |
| Not tested, and why | Safari/iOS, Firefox, physical printers, screen readers (not available); real network cut (simulated in-page instead); cross-subdomain sessions (dev runs on one origin); real Paymob checkout / ETA / Resend (prohibited; consequences traced from Phases 5–6); web unit tests (none exist) |
| Temporary files | session scratchpad `phase7/` (`env.sh`, `api_child.ts`, `seed7.mjs`, `inst7.mjs`, `api.log`, build output `dist/`) — **removed**; one transient lint JSON written to the system temp directory and deleted; nothing written inside the repository except this report |
| Pre-existing working-tree changes | **preserved** (`AppShell.tsx`, `POS.tsx` still modified; `documents/Hesba_Project_Overview.md` and `documents/audit/` untracked) |
| Report path | `documents/audit/Hesba_Phase7_Frontend_UX_Audit.md` |

*No fixes were implemented. Absence of a reproduced defect in an area is not a claim that the area is correct.*
