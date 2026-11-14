# Hesba Phase 3 — Financial Integrity Audit

> **Scope:** whether Hesba's financial state (sales, discounts, tax, fees, credit, installments, refunds, inventory, COGS, profit, purchases, suppliers, expenses, loyalty, subscriptions) stays correct under normal use, malicious client input, retries, failures and concurrency.
> **Method:** every financial claim from Phases 1–2 was re-derived from source. Arithmetic claims were checked with an **isolated calculation script** that imports the repo's real pure helpers (`shared/utils/decimal|fee|loyalty|cost.ts`) and replicates the DB-bound formulas from `invoice.service.ts`, `installment.service.ts` and `POS.tsx` verbatim (results quoted as **calc §n**; script and output in the session scratchpad). No database, external provider or production system was used; no source was modified.
> **Snapshot:** `claude/ui-pos-merge-split` @ `8846bce` (no API diff vs `main`), 2026-10-08. IDs `FIN-xx` are new; `HSEC-xx` / Phase 1 IDs are cross-referenced.
> **Labels:** CONFIRMED · LIKELY · POTENTIAL · UNVERIFIED. Priority P0–P3 per the brief.

---

## 1. Executive Summary

**Hesba can reach economically incorrect states during ordinary use, not only under attack.** The money arithmetic itself is mostly sound: `decimal.js`, 4-dp HALF_UP rounding and `NUMERIC(15,4)` storage, and floating-point noise is absorbed by 4-dp rounding everywhere except loyalty earning. The defects sit in **which amounts are computed where**, **which formulas are used**, and **what happens around state transitions**.

| # | Headline (CONFIRMED unless noted) | Evidence | Priority |
|---|---|---|---|
| FIN-01 | The POS shows an amount due that **excludes VAT and product discounts**; the server records a different total (e.g. **100 shown vs 114 recorded** for a 14 %-VAT item) | calc §2; `POS.tsx:270-281,848-850` | P0 |
| FIN-02 | Refunds are mis-computed: the line discount is subtracted **twice** (under-refund), and coupons / store credit / loyalty are **ignored** (over-refund: **228 refunded on 128 paid** with a 50 % coupon) | calc §3; `invoice.service.ts:605-614` | P0 |
| FIN-03 | Cancelling (UI) or returning (API) a **pending installment invoice** restocks goods that never left (**phantom inventory**), and the return path also issues store credit for goods never delivered | `invoice.service.ts:555-738`; `Invoices.tsx:326` | P0 |
| FIN-05 | The server prices sales from the **client's** `unitPrice` (HSEC-02 re-verified); stale POS carts and offline replays use old prices even without malice | `invoice.service.ts:209` | P0 |
| FIN-06 | Seeded card and valU methods (1.75 % / 3 %) compute a **zero fee** on the server while the POS previews the fee; switching to the API vocabulary inverts the mismatch | calc §1 | P1 |
| FIN-10 | "Net profit" is **gross of VAT** and customer fees, **double-counts** invoiced work orders, never reverses COGS for returns, and books refunds in the original sale's period | `report.service.ts:386-478` | P1 |
| FIN-07 / 08 / 09 | Status-gated transitions and balance updates are check-then-write without locks or idempotency: duplicate installment schedules with double stock decrements, double cancellation reversals, double PO receipts/payments, two invoices per work order, negative store credit, lost credit updates | §22 | P1 |

**Holds correctly (CONFIRMED):** the POS sale is one atomic DB transaction. Stock decrements, coupon usage and loyalty redemption use conditional updates, so they can't oversell, overuse or double-spend. The invoice number sequence is collision-free. Cost is snapshotted at sale and the weighted-average cost math is correct (**10×100 + 10×200 → 150**). Installment schedules always sum to the contract total. The Paymob webhook is idempotent per transaction. Approved expenses are immutable. Supplier balance updates are atomic increments.

---

## 2. Financial Invariants

Derived from the implementation (what the code is evidently trying to keep true), then checked.

| Area | Invariant (as implemented / intended by the code) | Holds? | Violations |
|---|---|---|---|
| Sale total | `total = Σ(lineSubtotal) − coupon + Σ(lineTax) + fee[if customer bears] − credit − loyalty`, where `lineSubtotal = unitPrice×qty − productDiscount`, `lineTax = lineSubtotal×rate`; `total ≥ 0`; `paidAmount = total` | formula consistent server-side; **amount collected at POS ≠ total** | FIN-01, FIN-05, FIN-13 |
| Line price | `unitPrice` = catalog `sell_price` (no override feature exists in UI) | **No** — client value stored | FIN-05 |
| Discounts | product discount ≤ line amount; coupon ≤ subtotal; coupon only if `subtotal ≥ minAmount` | coupon cap ✓; **line cap ✗; minAmount ✗** | FIN-13, FIN-14 |
| Coupon usage | `used_count ≤ max_uses` | ✓ (conditional increment) | — |
| Tax | stored per line at sale; history immutable | ✓ in invoices; ✗ in ETA recomputation | FIN-22 |
| Payment fee | `fee = f(method config)`; merchant-borne fee ⇒ `payment_fee_expenses` row | **No** for seeded percentage methods | FIN-06 |
| Mixed payment | `Σ allocations = total` | **Not modelled** (split stored unvalidated) | FIN-15 |
| Store credit | `credit_balance ≥ 0`; balance = Σ credits − Σ debits as recorded in `audit_logs` | **No** under concurrency; ledger incomplete | FIN-08, FIN-19 |
| Supplier balance | `balance = Σ purchases(received) − Σ payments ± manual` | ✓ sequentially; overpayment under concurrency | FIN-08 |
| Installments | `Σ schedule + down = contractTotal`; each payment pays exactly one scheduled amount; contract completes when all paid | ✓ math (calc §7); ✗ under concurrency / invoice cancel | FIN-04, FIN-07, FIN-20 |
| Refund | `Σ refunds(line) ≤ amount paid for that line`; returned qty ≤ sold qty | **No** (formula) / ✓ qty sequentially | FIN-02, FIN-07 |
| Inventory | `stock ≥ 0`; every change has one movement; changes happen exactly once per business event | ✓ for sales; ✗ for pending-invoice cancel/return, imports, concurrent transitions | FIN-03, FIN-07 |
| COGS | `COGS(sale) = qty × cost_at_sale` (WAC at receipt) | ✓ new rows; ✗ returns never reversed | FIN-10 |
| Profit | `profit = revenue(net) − COGS − expenses − merchant fees` | **No** (VAT in revenue, double counting) | FIN-10 |
| Loyalty | `points ≥ 0`; redeemed value = points consumed × point value | **No** (floor gap, negative reversal) | FIN-12 |
| Expenses | only approved expenses count; approved immutable | ✓ | — |
| Subscription | unpaid trial ⇒ access restricted after expiry (banner: pay "to avoid suspension") | **No** | FIN-16 |
| SaaS payment | `received amount = expected price` before activation | **No check** | FIN-17 |

---

## 3. Money Representation

| Layer | Representation | Evidence |
|---|---|---|
| Storage | `NUMERIC(15,4)` for money and line values; `NUMERIC(10,2)` for fixed fee, coupon value, plan prices; `NUMERIC(5,2)` for rates; `NUMERIC(15,6)` exchange rates; quantities `INT` | tenant migrations `002`; master `init` |
| API input | JSON numbers → `z.coerce.number().finite()` → `toDecimal(number)` | `shared/validation.ts:18-20`; `decimal.ts:8-11` |
| Calculation | `decimal.js` (precision 20, HALF_UP), `roundMoney` = 4 dp at line, coupon, fee and total level | `decimal.ts:3-15` |
| API output | Prisma `Decimal` serialises to strings (e.g. `"114.0000"`); the web converts with `Number()` for display | — |
| Client | POS, installment and print previews use JS numbers | `POS.tsx:82-90,270-281`; `lib/print.ts` |

**Does floating point change a financial outcome?** (calc §9, §6)
- `toDecimal(19.99)`, `toDecimal(99.99)`, `toDecimal(100.01)` are exact: inputs survive the JSON number round-trip.
- JS-number paths that are rounded to 4 dp before storage don't change stored values: `0.1+0.2 → 0.3000`; manual credit `Number("100.1")+0.2 → 100.3000` (`customer.routes.ts:134`); the credit cap via `Math.min(… .toNumber())` (`invoice.service.ts:263`).
- **Loyalty earning does change outcomes:** `Math.floor(total.toNumber() × pointsPerUnit)` (`invoice.service.ts:466`) gives `19.99×100 → 1998` (exact 1999); also 0.29, 1.15 and 4.35 at 100 points/unit. It's off by one point whenever `pointsPerUnit > 1` meets a non-representable product → part of **FIN-12**.
- Report aggregation in JS (`+=` over `.toNumber()`, e.g. `report.service.ts:195,250-253,428-431`) produces float noise (`0.1×10 → 0.9999999999999999`) that disappears at 2-dp display → presentation only.
- **Display rounding differs from server rounding:** JS `toFixed(2)`/`Intl` round the binary double (`1.005 → "1.00"`), while server HALF_UP gives `1.01`. Combined with 4-dp storage (fee `1.7498` shown as `1.75`), receipts and reports can disagree by 0.01 → **FIN-18**.
- **Sub-piastre amounts:** prices `> 0` but `< 0.00005` pass validation and are stored as `0.0000` (NUMERIC rounding). Money is kept at 4 dp but EGP settles at 2 dp; nothing rounds to currency precision → FIN-18.

---

## 4. Sales

**Lifecycle (`POST /api/invoices` → `createInvoice`, `invoice.service.ts:127-551`):** validate payment method / currency / coupon / variants (pre-tx reads) → line math → coupon → credit cap → fee → loyalty redemption → **one interactive transaction**: credit decrement · loyalty conditional decrement · invoice insert · per line: conditional stock decrement, item insert (with `cost_at_sale`), movement · coupon conditional increment · merchant fee expense · external-financing row · invoice number (sequence) · loyalty earn · audit/ledger rows → COMMIT. No external call happens inside or after the transaction (receipt email is a separate endpoint; ETA is never enqueued).

### 4.1 Edge cases

| Case | Behaviour | Correct? |
|---|---|---|
| Empty sale | rejected (`items.min(1)`) | ✓ |
| Zero / negative / fractional quantity | rejected (`int().positive()`); `kg`/`liter` products therefore can't be sold fractionally | ✓ (limitation INFO) |
| Quantity > 2³¹−1 | passes zod, fails at the `INT` column → 500 | ✓ (late) |
| Zero / negative price | rejected (`positive`) | ✓ |
| Price `0.00001` | accepted, stored as `0.0000` | ✗ (FIN-05/18) |
| Price ≠ catalog price | accepted as sent | ✗ FIN-05 |
| Duplicate lines of one variant | each line checks stock ✓; refunds later price all units at the first line's price | ✗ FIN-02 |
| Inactive variant | rejected | ✓ |
| Deactivated **product** (variants still active) | **sellable via API** (only `variant.isActive` checked, `:160-165`) | ✗ FIN-21 |
| Insufficient stock / no stock row | `insufficient_stock`, whole tx rolls back | ✓ |
| Concurrent sales of the last unit | conditional `updateMany … quantity ≥ qty` → one fails | ✓ |
| Product discount > line value | negative line subtotal/tax (calc §4); persists if other lines keep the invoice ≥ 0, otherwise the DB CHECK rejects the insert | ✗ FIN-13 |
| Partial / unpaid / on-account sale | not modelled — every POS invoice is `completed` with `paidAmount = total` | — |
| Store-credit sale | capped at balance read before the tx; decrement unconditional | ✗ under concurrency (FIN-08) |
| Mixed payment | split method/amount stored without validation | ✗ FIN-15 |
| Failed payment | no gateway for POS payments | n/a |
| Duplicate submission / retry | no idempotency key ⇒ second invoice, second stock decrement, second loyalty earn | ✗ FIN-09 |
| Offline sale | queued in `localStorage`; replayed later at the captured price; a replay that fails (e.g. stock) stays queued — the sale is never recorded | ✗ FIN-09 |
| POS amount due | excludes tax, product discounts and loyalty; fee on a different base | ✗ FIN-01 |

### 4.2 Numeric edge-case matrix (brief §32)

| Input | Where | Accepted? | Correct? |
|---|---|---|---|
| unitPrice 0 / negative | sale, installment | no | ✓ |
| unitPrice 0.01 / 0.1 / 0.2 / 19.99 / 99.99 / 100 / 100.01 / 999999.99 | sale | yes, exact | ✓ (but client-trusted, FIN-05) |
| unitPrice < 0.00005 | sale | yes → stored 0 | ✗ |
| coupon % = 0 / negative | coupon | no | ✓ |
| coupon % = 100 / > 100 | coupon | yes, capped at subtotal | ✓ |
| product-discount % > 100, fixed > price | product discount | yes | ✗ FIN-13 |
| fee % > 100 / negative fixed fee | payment method | no | ✓ |
| VAT/tax rate 0–100 | settings / tax rates | yes (writable by any user, HSEC-01) | ✓ range |
| credit > balance / negative | sale | capped / rejected | ✓ |
| redeemPoints < 100 / > balance | sale | rejected | ✓ |
| redeemPoints where point value > capped discount | sale | yes, **0 points consumed** | ✗ FIN-12 |
| split amount > total / split = primary method | sale | yes | ✗ FIN-15 |
| installments 0 / > 120 | contract | rejected | ✓ |
| down payment > total / = total | contract | rejected / accepted with zero-amount installments | ✓ / edge (FIN-20) |
| PO unit cost 0 | PO | rejected | ✓ (free goods can't be received) |
| PO payment > remaining | PO | rejected sequentially, accepted concurrently | ✗ FIN-08 |
| work-order payment > total | work order | accepted | ✗ FIN-08 |
| expense 0 / negative | expense | rejected | ✓ |
| loyalty point value / points-per-unit (no max) | settings | yes | ✗ (bounds; FIN-12, HSEC-01) |

---

## 5. Discounts & Coupons

| Discount type | Rule in code | Evidence |
|---|---|---|
| Product (line) discount | first active `product_discounts` row per product (date range, `isActive`); `percentage` = % of line, `fixed` = value × qty; **no upper bound** (`discountValue.positive()`), **no clamp** at line amount | `product.routes.ts:437-452`; `invoice.service.ts:180-223` |
| Coupon (order) discount | `percentage` of summed subtotal or `fixed`; capped at subtotal; applied **after** line tax was computed (tax not reduced) | `invoice.service.ts:247-255` |
| Manual discount | none (price override via client `unitPrice` is the de-facto manual discount — FIN-05) | — |
| Credit / loyalty | reduce `totalAmount` and are **added into `invoices.discount_amount`** together with the coupon | `invoice.service.ts:346` |
| Stacking | product discount + one coupon + credit + loyalty may all apply | — |

**Coupon controls:**

| Control | Status | Evidence |
|---|---|---|
| Active / expiry | checked before the tx | `invoice.service.ts:150-151` |
| Global usage limit | pre-check + **conditional** `UPDATE … WHERE used_count < max_uses` inside the tx ⇒ two concurrent redemptions of the last use: one rolls back | ✓ CONFIRMED race-safe (`:409-417`) |
| Per-customer limit | none | — |
| Maximum discount amount | none (percentage unbounded but capped at subtotal) | — |
| Tenant ownership | schema-scoped | ✓ |
| Duplicate application | one `couponCode` per invoice | ✓ |
| **Minimum amount** | **enforced only in the POS, once, at validation time**, against a pre-tax, pre-product-discount JS subtotal (`POS.tsx:294`); never re-checked when the cart shrinks, never checked by the server (`invoice.service.ts:148-156`) | **FIN-14** — "enforced only in frontend" |
| Code normalisation | stored upper-case; sale lookup uses the code as sent (POS upper-cases) | functional only |
| Release on cancel | `used_count − 1` (floored at 0); returns don't release | ✓ / by design |

---

## 6. Tax / VAT

- **Two VAT sources (CONFIRMED):** POS and installment lines use the product's `tax_rates` row (`invoice.service.ts:226-229`; `installment.service.ts:179-182`). Work-order invoices use `tenant_settings.vatEnabled/vatRate` (`workOrder.routes.ts` invoice route). `tenant_settings.vat*` is ignored by product sales.
- **Base:** tax-exclusive prices; tax on the line after the product discount; the coupon is applied after tax and doesn't reduce it (whether the taxable base should drop with an order discount is a legal question the code doesn't settle — POTENTIAL FIN-P1).
- **Rounding:** each line's tax is rounded to 4 dp, then summed (line-level). ETA recomputes tax at 5 dp from `unit × qty` with no discount (`eta.payload.ts:67-85`) → e-invoice tax ≠ invoice tax for discounted lines (latent: the ETA worker can't run, Phase 1 E-01).
- **Historical immutability:** invoices store `tax_amount`, `tax_rate_id`, `tax_total` → editing a tax rate or VAT setting **doesn't** change stored invoices ✓. The ETA worker joins the **current** `tax_rates.rate` (`eta-submission.job.ts:120-128`) → a later resubmission would use today's rate (FIN-22). Deactivated tax rates still apply to products that reference them (no `isActive` check).
- **Refund tax:** the refund includes the line's stored `taxAmount` pro rata (correct component; formula issue is in the discount term — FIN-02).
- **Who can change VAT:** any authenticated user (HSEC-01).

---

## 7. Payments & Fees

**Trace:** payment method (`feeType`, `feePercentage`, `feeFixed`, `feeBearer`) → `calculateFee(preFeeTotal)` (`fee.ts:9-34`) → `feeAddedToTotal` if the bearer is the customer → invoice stores the fee fields (immutable) → merchant-borne fee ⇒ `payment_fee_expenses` → fee report and P&L.

**Fee vocabulary (FIN-06, CONFIRMED, calc §1):**

| Source | Recognised percentage token |
|---|---|
| Server `calculateFee` | `percentage` (and `both`) |
| API schema (create/update) | `none / percentage / fixed / both` |
| Settings UI | `percentage` |
| Tenant seed | **`percent`** for "فيزا / ماستر" (1.75 %) and "فاليو" (3 %) |
| POS preview | **`percent`** (and `both`) |

- Seeded card/valU ⇒ server fee **0.0000** on 1,000 (POS preview shows 17.5). No `payment_fee_expenses` row, no customer surcharge, and fee report and P&L under-state fees. Applies to every tenant that never edited those two methods.
- Editing the method to `percentage` (the only token the API accepts — tenants can't create `percent`) fixes the server but makes the POS preview show 0 while the server charges the fee.
- Fixed, both and none are consistent on both sides, but the POS fee base is the **pre-tax** discounted subtotal, while the server uses the **tax-inclusive** pre-fee total (calc §2d: 92.80 vs 107.08).
- History: fee fields are stored per invoice, so changing a method later doesn't alter past invoices ✓.

**Mixed payments (FIN-15):** the only model is `splitPaymentMethodId` + `splitPaymentAmount` on the invoice (`invoice.service.ts:357-358`). There's no allocation table and no `Σ = total` check. The split amount may exceed the total, the split method may equal the primary, and its existence and active status aren't checked. The fee is computed **once, with the primary method's rate on the full amount**. Day close and the per-method reports group by the primary method only (`report.service.ts:591-596`). "One payment succeeds and another fails" can't be represented — nothing is charged electronically.

**Customer credit as tender:** reduces `totalAmount` and is recorded in `discount_amount` + `audit_logs` (§8).

---

## 8. Customer Credit

**Model:** `customers.credit_balance` is **store credit owed to the customer** (a liability), not customer debt. Customer debt exists only as unpaid installment rows (§9). There is no ledger table; the history is reconstructed from `audit_logs`.

| Operation | Effect on `credit_balance` | Atomic? | Ledger row | Evidence |
|---|---|---|---|---|
| POS sale using credit | `decrement creditUsed` (cap read **before** the tx) | atomic SQL, but **unconditional** | `customer/credit_used` | `invoice.service.ts:258-265,313-320,499-514` |
| Return as credit | `increment refundAmount` | atomic | **none** (only `invoice/return`) | `:655-661,663-676` |
| Invoice cancel | `increment` the amount from the matching `credit_used` audit row | atomic | `customer/credit_add` | `:765-788` |
| Manual add/deduct | **absolute set** from a JS sum computed on a stale read; deduct rejects < 0 | **not atomic**; update and audit not in one tx | `customer/credit_add|deduct` | `customer.routes.ts:128-155` |

**Findings:**
- Two concurrent sales can both pass the cap and drive the balance **negative** (no DB CHECK — migration 016 intentionally leaves `credit_balance` unconstrained).
- A manual adjustment racing a sale **overwrites** the sale's decrement (lost update) → **FIN-08**.
- The credit-ledger endpoint filters `entity:'customer'` (`customer.routes.ts:335-339`), so **credits from returns never appear**: ledger ≠ balance → **FIN-19**.
- Refund-as-credit amounts inherit FIN-02's formula errors.

---

## 9. Installments

**Model (CONFIRMED, `installment.service.ts`):**
```
principal      = invoiceTotal − downPayment          (invoiceTotal includes tax and customer-borne fee)
interest       = principal × rate% × (count / 12)    (flat, on the whole term)
monthly        = round4((principal + interest) / count)
contractTotal  = round4(downPayment + principal + interest)
schedule       = (count − 1) × monthly  +  last,   last = round4(contractTotal − down − monthly × (count − 1))
remaining      = Σ amount_paid of installment rows with status ≠ 'paid'   (never stored)
```
calc §7: 1000/0/3/0 % → 333.3333 ×2 + 333.3334; 1000/0/12/12 % → 93.3333 ×11 + 93.3337 = 1120; 999999.99 / 0.01 / 120 / 18 % reconciles exactly. **The schedule always sums to the contract total.**

| Topic | Behaviour |
|---|---|
| Creation | invoice `pending` (`paidAmount 0`) + contract `pending_approval`; stock **not** decremented; client `unitPrice` (FIN-05); monthly quota |
| Approval | contract `active`, invoice `completed` with `paidAmount = downPayment`, conditional stock decrement, schedule rows created. The status check happens **before** the transaction (FIN-07) |
| Payment | marks one scheduled row `paid` (no amount input) in strict order. Partial, over- and early payments are **impossible**; the payment method is accepted but not stored; invoice `paidAmount` is never updated |
| Late fees / overdue | none; `overdue` is never written |
| Cancellation / early settlement | no endpoint for active contracts; reject only from `pending_approval` (→ `cancelled`) |
| Full down payment | accepted → `count` rows of **0.0000** that must still be "paid" (FIN-20) |
| Interest revenue | not recognised anywhere (P&L counts the invoice total, not the contract total) |

**Brief §14 scenario (A pays 700 ∥ B pays 700 on 1000):** not reachable. Payments are whole scheduled rows, so the balance can't go negative. Concurrent payment of the *same* row marks it paid twice (benign) and writes two audit rows. Concurrent payment of the *last two* rows can leave the contract `active` with every row paid, because each transaction excludes only its own row when counting (FIN-20). The real concurrency defect is **double approval** (FIN-07): it duplicates the whole schedule and decrements stock twice.

**Invoice lifecycle mismatch (FIN-04, CONFIRMED):** cancelling (UI-exposed for completed and pending invoices) or returning an installment invoice never touches the contract. The customer keeps owing the schedule (and receiving reminders) for a sale that was cancelled or returned, and the down payment has no refund record.

---

## 10. Refunds

**Formula (CONFIRMED, `invoice.service.ts:605-614`):**
`refund = round4( Σ over returned lines: (item.subtotal + item.taxAmount − item.discountAmount) / item.qty × returnedQty )`, with the invoice line found by `find(variantId)` (first match). But `item.subtotal` is **already** `unitPrice×qty − discountAmount` (`:225`, stored at `:386`).

| Scenario (calc §3) | Customer paid for the returned lines | Refund issued | Error |
|---|---|---|---|
| 2 × 100, 10 % line discount, 14 % VAT | 205.20 | 185.20 | **−20.00** (discount subtracted twice) |
| 2 × 100, 14 % VAT, 50 % coupon | 128.00 (invoice total) | 228.00 | **+100.00** (coupon ignored) |
| 2 × 100, no discounts | 228.00 | 228.00 | 0 ✓ |
| same variant twice @100 and @10 | 125.40 | 228.00 | **+102.60** (first line's price for all units) |

Also: store credit and loyalty used on the sale aren't prorated (over-refund); redeemed points aren't returned and earned points aren't reversed; a customer-borne fee isn't refunded.

| Check | Behaviour |
|---|---|
| Refund more than sold (sequential) | blocked — cumulative cap per variant (`:575-602`) ✓ |
| Refund twice concurrently | both pass the pre-tx cap ⇒ over-return (FIN-07) |
| Refund on cancelled invoice | blocked ✓ |
| Refund on **pending** installment invoice | **allowed** (only `cancelled` is rejected) ⇒ phantom restock + credit for undelivered goods (FIN-03) |
| Refund on an approved installment invoice | allowed; contract untouched (FIN-04) |
| Money movement | `refund` type creates **no money record** (only the `returns` row); `credit` type increments store credit |
| Inventory | `restock` lines `increment` stock at the invoice's branch for the exact variant ✓; if no stock row exists, the update is a silent no-op while a `return` movement is still logged ✗ |

---

## 11. Inventory

Writers (re-verified from Phase 1 §9) plus newly confirmed defects:

| Mutation | Guard | Exactly once? | Issue |
|---|---|---|---|
| POS sale | conditional decrement | ✓ (no idempotency for retries) | FIN-09 |
| Installment approval | conditional decrement | **✗** concurrent approvals decrement twice | FIN-07 |
| Cancel of a **completed** invoice | none needed | ✗ concurrent cancels restock twice | FIN-07 |
| Cancel of a **pending** installment invoice | none | **✗ restocks stock never removed** (UI-exposed) | FIN-03 |
| Return | cumulative cap (pre-tx) | ✗ concurrent returns; pending invoices; no-row no-op logs a movement | FIN-03, FIN-07 |
| Transfer approval | pre-tx availability + status check, unconditional decrement | ✗ concurrent approvals move stock twice | FIN-07 |
| PO receipt | pre-tx outstanding check | ✗ concurrent receipts double the quantity and liability | FIN-07 |
| Manual adjustment | conditional for negatives | ✓ (duplicates on retry) | FIN-09 |
| CSV import | — | n/a (endpoint returns 415) | — |
| Work order | none (services only) | — | — |

Negative stock is prevented by the conditional decrements and, where migration 016 is applied, by `CHECK (quantity >= 0)` for new writes; an unconditional decrement that would cross zero therefore fails the transaction rather than corrupting it.

---

## 12. COGS

**Basis (CONFIRMED):** single global weighted-average cost per variant (`product_variants.cost_price`), updated on each PO receipt from on-hand stock across **all branches** (`po.routes.ts:299-319`; `cost.ts:14-29`). Each sale snapshots `cost_at_sale` (`invoice.service.ts:242,387`). There's no FIFO.

| Scenario (calc §8) | Recorded |
|---|---|
| receive 10 @100, then 10 @200, sell 10 | cost 150.0000 → COGS **1,500.00** ✓ |
| 10 on hand @100, partial receipt 5 @200 | 133.3333 ✓ |
| 10 on hand at cost 0, receive 10 @100 | **100.0000** (true WAC 50) — zero cost is treated as "unset" (FIN-23) |
| multiple branches | one blended cost for every branch (by design) |
| returns | restocked units don't change WAC ✓; **P&L COGS isn't reduced** (FIN-10) |
| negative adjustments / shrinkage | reduce on-hand only; never expensed |
| cost edits | `PATCH` variant `costPrice` changes future snapshots and the WAC base, not history ✓; pre-migration-017 rows fall back to the **live** cost (history moves) |

---

## 13. Profit

**Implemented formula (`report.service.ts:386-478`):**
```
revenue      = Σ invoices.total_amount (status 'completed', by invoice created_at)   ← includes VAT and customer-borne fees
             + Σ work_orders.paid_amount (by paid_at)
netRevenue   = revenue − Σ returns.amount (type 'refund', selected by the ORIGINAL invoice's date)
grossProfit  = netRevenue − Σ qty × (cost_at_sale ?? current cost_price)   (all lines of completed invoices)
netProfit    = grossProfit − Σ approved expenses (by expense_date) − Σ payment_fee_expenses
```

| Question | Answer |
|---|---|
| Refunds | reduce revenue (refund type only), booked in the **sale's** period; COGS **not** reversed |
| Credit-type returns | don't reduce revenue (credit is consumed later as a reduction of another sale) |
| Cancelled sales | excluded retroactively from the original period |
| Unpaid / installment sales | full invoice total counted once approved (interest never counted) |
| Expenses | approved only ✓ |
| Inventory adjustments | ignored |
| **Tax** | **included in revenue and profit** — `taxTotal` is fetched (`:401`) but never subtracted |
| Payment fees | merchant-borne fees subtracted ✓ (zero for seeded percentage methods — FIN-06); customer-borne fees counted as revenue |
| Work orders | counted twice when a work order is both paid (`paid_amount`) and invoiced (`completed` invoice) |

→ **FIN-10**: for a VAT-registered store at 14 %, net profit is overstated by ~12.3 % of tax-inclusive sales, before any other effect.

---

## 14. Purchases

| Stage | Behaviour | Evidence |
|---|---|---|
| Create (draft) | `totalAmount = Σ round4(unitCost × qty)` (Decimal); supplier/branch FKs only; no taxes, fees or discounts on purchases | `po.routes.ts:50-87` |
| Amend | only while `draft` (checked before the tx); lines replaced wholesale | `:116-189` |
| Submit / approve | status checks before an unconditional update | `:192-224` |
| Receive | one transaction: WAC update → stock upsert at the PO branch → movement `in` → `receivedQuantity += qty` → receipt row → `supplier_transactions 'purchase'` (batch cost) → `suppliers.balance += batch cost` → status `partially_received`/`received` | `:227-396` |
| Pay | array transaction: payment row, `PO.paidAmount +=`, `supplier_transactions 'payment'`, `suppliers.balance −=`; overpayment check against the **ordered** total (prepayment allowed), before the tx | `:399-451` |
| Cancel / close / return to supplier | **none** | — |

**Partial failure:** the receive and pay transactions are atomic, so "purchase saved but inventory failed" can't persist. **Duplicate / concurrent:** two receipts of the same outstanding quantity both pass validation → double stock, double liability, `receivedQuantity > quantity`; two payments both pass the remaining-balance check → `paidAmount > totalAmount`, supplier balance over-reduced (FIN-07, FIN-08).

---

## 15. Supplier Balances

`suppliers.balance` = Σ received batch costs − Σ PO payments ± manual transactions (`purchase` +, `payment` −, `return` −) (`supplier.routes.ts:15-19,179-214`). All writes use atomic `increment/decrement` together with a `supplier_transactions` row in one array transaction → no lost updates ✓. Negative balances (supplier owes the store) are allowed by design (migration 016 comment). Manual `purchase` and `return` transactions don't touch stock — they are pure ledger adjustments for `suppliers:update` holders. Gaps: duplicates on retry (no idempotency), PO overpayment under concurrency, and no cancellation flow (outstanding PO liabilities can't be closed).

---

## 16. Expenses

`pending → approved` (`expenses:approve`) or `rejected` (`expenses:delete`); amounts strictly positive; only pending expenses are editable; approved ones are immutable with no delete (`expense.routes.ts:77-184`). P&L uses approved expenses by `expense_date`; budgets compare approved spend in the current month/year (`:189-229`). Edge cases: the creator may approve their own expense (no separation of duties); duplicate submissions create duplicate pending rows (caught by approval); `paymentMethod` is free text and isn't linked to any cash account. **No financial-integrity defect found** beyond the missing idempotency.

---

## 17. Loyalty

| Step | Implementation | Status |
|---|---|---|
| Earn | `floor(total.toNumber() × pointsPerUnit)` on the final total (after credit and loyalty), inside the sale tx | JS-float floor loses a point (calc §6) |
| Redeem | ≥100 points, ≤ balance, loyalty enabled; `computeLoyaltyRedemption` caps the discount at 50 % of the sale and at the remainder; points consumed = `floor(discount / pointValue)` when capped | **the discount isn't reduced to the value of the points actually consumed** (calc §5): 100 pts @0.6 → discount 50.00 for 83 pts (49.80); 100 pts @15 on a 10 sale → discount **5.00 for 0 pts**; 150 pts @1000 → **50.00 for 0 pts**; when 0 points are consumed nothing is decremented (`invoice.service.ts:326-334`), so the same balance can be reused on every sale |
| Double spend | conditional `updateMany … loyaltyPoints ≥ used` | ✓ race-safe |
| Cancel | earned points decremented **unconditionally** (balance can go negative if already spent); redeemed points refunded | partial |
| Return | no loyalty adjustment | ✗ |
| Expiry / manual adjustment | none | — |
| Configuration | point value and points-per-unit have no upper bound and are editable by any user (HSEC-01) | ✗ |
| POS support | the POS never sends `redeemPoints` — redemption is API-only | INFO |

→ **FIN-12.** With the default point value (0.01) the per-redemption leak is below 0.01. It becomes material once the point value is configured at or above the capped discount, and any user can configure it.

---

## 18. Subscription Billing

**State machine (master `subscriptions.status`):**

| From | To | Trigger | Evidence |
|---|---|---|---|
| (signup) | TRIALING (14 d) | `startTrial` | `billing.service.ts:45-62` |
| TRIALING | PAST_DUE (`failedAttempts=1`) | trial-expiry job | `trial-expiry.job.ts:115-132` |
| TRIALING, CANCELLED, any | ACTIVE (period = now + cycle) | webhook success / token charge success | `billing.service.ts:117-198` |
| ACTIVE | PAST_DUE / SUSPENDED / CANCELLED | failure count 3 / 7 / 14 (webhook or job) | `:200-282` |
| ACTIVE (`cancelAtPeriodEnd`) | CANCELLED | daily sweep | `:326-347` |
| TRIALING | CANCELLED (immediate) | `POST /billing/cancel` by **any** employee | `:297-319`; HSEC-04 |
| TRIALING/PAST_DUE | TRIALING (+days) · PAST_DUE/SUSPENDED → ACTIVE · any → CANCELLED | platform admin | `admin.routes.ts:509-646` |

**Answers to brief §23:**
1. *Is trial → PAST_DUE intentional?* The transition is deliberate (comment: anchor for dunning). The product's own copy defines the rule that follows: the trial-expired email says paying is required "to continue using", and the PAST_DUE banner says to pay "to avoid suspension" (`SubscriptionBanner.tsx:66-72`).
2. *After PAST_DUE?* Dunning retries only subscriptions with a stored card token (`dunning.job.ts:74-81`); an unpaid trial has none, so it never escalates.
3. *Access?* Remains enabled — the gate blocks only `SUSPENDED`/`CANCELLED` (`tenant.middleware.ts:103`).
4. *Which code decides?* `tenantMiddleware` (30 s cache) and the refresh endpoint.
5. *Bypass?* None needed — expired unpaid trials keep full access, including Enterprise features if they signed up on Enterprise (**FIN-16**, CONFIRMED against the stated rule).
6. *Billing vs tenant state:* independent — `Tenant.status` stays `ACTIVE` while the subscription is `CANCELLED` (enforced by the 402 gate).
7. *Cashier cancel:* yes (HSEC-04).
8. *Repeat cancel:* idempotent for `cancelAtPeriodEnd`; on `CANCELLED` it rewrites `cancelledAt` and re-sends the email.
9. *Webhook retry:* the unique transaction id makes it a no-op ✓.

Other: a success resets the period from the **payment date** (early renewals forfeit remaining days). Failure counts use a read-then-set (`failedAttempts + 1` from a stale read), so concurrent failures can lose increments. A manual checkout while a renewal is due can charge twice (POTENTIAL FIN-P7).

---

## 19. Paymob Financial Integrity

**Trace:** `POST /billing/checkout` → expected amount = `subscription.priceAtSubscription × 100` (subscription chosen with an **unordered** `findFirstOrThrow`) → Paymob order (`merchant_order_id = sub_<tenantId>_<ts>`) + payment key + iframe → browser redirect to `/settings?tab=billing` (not processed by the API) → webhook `POST /api/billing/paymob/webhook` → HMAC over 20 fields → `success && !refunded && !voided` → tenant parsed from `merchant_order_id` → `findFirst` subscription → `PaymentAttempt SUCCESS` (unique `providerTransactionId`) + subscription `ACTIVE`.

| Check | Implemented? | Evidence |
|---|---|---|
| Expected amount stored at checkout | **no** (no pending record) | `billing.service.ts:92-115` |
| Received amount = expected | **no comparison** | `:117-174` |
| Currency = EGP | not checked (signed field, never compared) | — |
| Integration id (card vs wallet) / auth-only vs captured | not checked | `billing.routes.ts:42` |
| Transaction id uniqueness | ✓ unique index → replay no-op | `schema.prisma:134` |
| Order → tenant mapping | via **unsigned** `merchant_order_id` (HSEC-21) | `paymob.webhook.ts:26-47` |
| Subscription selection | unordered `findFirst` | `:131,210` |
| Refund / void | ignored (no state change) | `billing.routes.ts:42-57` |

**Answer to "expected 1000, actual 1":** **Yes** — the code would mark the subscription `ACTIVE` for a full period on any validly signed success with that tenant's `merchant_order_id`, whatever the amount (CONFIRMED in code, **FIN-17**). Whether a low-amount signed transaction can be obtained for a tenant depends on Paymob-side conditions and the unsigned tenant binding (HSEC-21) — UNVERIFIED, not tested against Paymob by design.

---

## 20. Idempotency

| Operation | Exact repeat | Concurrent | Success but response lost → client retry |
|---|---|---|---|
| POS sale | **duplicate invoice** (2× stock, loyalty, credit) | same | duplicate; offline queue re-sends unconfirmed payloads |
| Coupon redemption | each sale consumes one use | ✓ conditional | duplicate use with duplicate sale |
| Loyalty redemption | each sale redeems | ✓ conditional | duplicate with sale |
| Store-credit use | each sale decrements | **negative balance possible** | duplicate |
| Return | second return allowed up to the cap | **over-return** | duplicate (until cap) |
| Cancel | second → `already_cancelled` ✓ | **double reversal** | safe ✓ |
| Installment create | duplicate contract + pending invoice | same | duplicate |
| Installment approve | second → `contract_not_pending` ✓ | **duplicate schedule + double stock** | safe ✓ |
| Installment payment | second → `already_paid` ✓ | duplicate audit; possible stuck completion | safe ✓ |
| PO receive | second receives the remaining outstanding (if any) | **double receipt** | may receive twice if lines were still outstanding |
| PO payment / supplier txn / manual credit / expense / WO payment | **duplicate** | duplicate (manual credit and WO payment also lose updates) | duplicate |
| WO invoice | second → `already_invoiced` ✓ | **two invoices** | safe ✓ |
| Stock transfer approve | second → `transfer_not_pending` ✓ | **double transfer** | safe ✓ |
| Paymob webhook | ✓ no-op | ✓ (unique) | ✓ |
| Renewal / dunning charge | guarded by state (period/failure count) + lock | lock without owner check | **re-charge if the DB write failed after a successful charge** (FIN-L1) |
| ETA submission | each resubmit enqueues another job | duplicate submissions possible (latent) | — |

---

## 21. Transactions

| Operation | BEGIN → reads/validations → writes → external → COMMIT | External calls |
|---|---|---|
| POS sale | reads + validation **outside**; single interactive tx for every write | none |
| Return / cancel | invoice + prior returns read **outside**; single tx for every write | none |
| Installment create / approve / pay | status/validation **outside**; single tx; approve returns via the base client inside the callback (stale pre-commit read in the response, INFO) | none |
| PO receive / pay | validation **outside**; single tx | none |
| Manual credit | read → update → audit — **no tx** (audit failure leaves an unlogged change) | none |
| WO invoice | validation outside; single tx (number + link) | none |
| WO payment | read → single update (no tx needed, but read-modify-write) | none |
| Checkout | Paymob order + payment key created; **nothing persisted** | Paymob (outside any tx) |
| Webhook | HMAC → array tx (attempt + subscription) → cache invalidation → email | email after commit ✓ |
| Renewal / dunning | Paymob order + charge **then** DB writes in a separate step | **external success → possible DB failure** ⇒ charged with no record; job retry may charge again (FIN-L1) |
| ETA | `submitted` update → ETA call → result update (separate statements) | ETA success then DB failure ⇒ resubmission (latent) |

Default Prisma interactive-transaction isolation is Postgres **READ COMMITTED**. No code uses `SELECT … FOR UPDATE`, explicit isolation levels or advisory locks in `apps/api` (CONFIRMED by search). Safety relies solely on conditional `UPDATE … WHERE` statements where they exist.

---

## 22. Concurrency

| Check-then-write | Guarded by | Violation under concurrency | Finding |
|---|---|---|---|
| Sale stock | conditional decrement | none | ✓ |
| Coupon `max_uses` | conditional increment | none | ✓ |
| Loyalty redeem | conditional decrement | none | ✓ |
| Store credit cap | pre-read only | negative balance | FIN-08 |
| Manual credit | pre-read + absolute set | lost update | FIN-08 |
| WO payment | pre-read + absolute set, no total check | lost update / overpayment | FIN-08 |
| PO payment remaining | pre-read | overpayment | FIN-08 |
| Subscription `failedAttempts` | pre-read + set | lost increment | FIN-08 (LOW) |
| Installment approve status | pre-read | duplicate schedule, double stock | FIN-07 |
| Installment completion | count excluding own row | stuck `active` | FIN-20 |
| Invoice cancel status / no-returns | pre-read | double restock / credit / loyalty reversal | FIN-07 |
| Return cumulative cap | pre-read | over-return | FIN-07 |
| Cancel ∥ return | pre-reads on both sides | both applied | FIN-07 |
| Transfer approve | pre-read | double transfer | FIN-07 |
| PO receive outstanding | pre-read | double receipt | FIN-07 |
| WO already invoiced | pre-read | two invoices | FIN-07 |
| Plan limits | count | limit exceeded by N−1 | HSEC-13 |
| Reminder idempotency | audit lookup then send | duplicate emails | HSEC-05 |

---

## 23. Retries & Partial Failure

| Operation | Timeout / lost response | DB failure mid-op | Redis down | Crash / worker restart | Classification |
|---|---|---|---|---|---|
| POS sale | retry duplicates | tx rollback ✓ | request stalls before any write (tenant middleware) | rollback ✓ | **UNSAFE, NON-IDEMPOTENT** |
| Return | retry may duplicate | rollback ✓ | stall | rollback ✓ | UNSAFE |
| Cancel | `already_cancelled` | rollback ✓ | stall | rollback ✓ | SAFE (sequential) |
| Installment approve / pay | safe by status | rollback ✓ | stall | rollback ✓ | SAFE (sequential), UNSAFE (concurrent) |
| PO receive / pay | may duplicate | rollback ✓ | stall | rollback ✓ | UNSAFE |
| Manual credit | duplicate | **partial** (balance set, audit missing) | stall | partial | UNSAFE |
| Webhook | Paymob retries → no-op | rollback; Paymob retries | n/a (no tenant middleware) | — | IDEMPOTENT |
| Renewal / dunning | — | **charged, not recorded** → job retry re-charges | worker stalls | BullMQ re-runs the cycle | **UNSAFE** (no per-period idempotency key) |
| Trial expiry | — | per-row updates; re-run is safe (state-based) | stall | re-run safe | SAFE |
| Reminders | — | duplicates possible | stall | re-run uses 24 h audit check | MOSTLY SAFE |
| ETA job | retries up to 5 | inconsistent statuses possible | stall | re-run resubmits | UNSAFE (latent) |
| Offline POS replay | entries removed only on HTTP success | — | — | queue survives in `localStorage` | **UNSAFE** (duplicates; permanently failed sales never recorded) |

---

## 24. Historical Immutability

| Value | Preserved on the record? | Can history change later? |
|---|---|---|
| Unit price | `invoice_items.unit_price` ✓ | no (but was client-supplied) |
| Product discount | `invoice_items.discount_amount` ✓ | no |
| Tax | `tax_amount`, `tax_rate_id`, `tax_total` ✓ | **ETA recomputes from the current rate** (latent) |
| Payment fee | fee fields on the invoice ✓ | no |
| Coupon | `coupon_id` + amount folded into `discount_amount` | coupon edits don't change history ✓; the coupon's share of `discount_amount` isn't separable |
| Loyalty / credit | balances + `audit_logs` amounts ✓ | config changes don't rewrite history ✓ |
| COGS | `cost_at_sale` ✓ (since 017) | pre-017 rows follow the **live** cost |
| WO VAT | stored at invoice time ✓ | no |
| Reports | computed on the fly | **yes** — cancellations and refunds move revenue out of the original period after the fact; work-order revenue jumps to the last payment date |

---

## 25. Reporting Consistency

| Report | Discrepancy vs operational records | Evidence | Finding |
|---|---|---|---|
| P&L | VAT and customer fees in revenue; work orders double-counted; refunds by sale date; no COGS reversal for returns | `report.service.ts:386-478` | FIN-10 |
| Day close (POS section) | counts **installment invoices at their full total** on the contract's creation date (only the down payment was collected); split payments shown under the primary method only; work-order cash attributed to the last payment day | `:580-665` | FIN-11 |
| Day close (installments) | sums scheduled amounts of rows paid that day ✓; down payments appear nowhere as cash | `:597-601` | FIN-11 |
| Sales report | `discountTotal` mixes coupons, store credit and loyalty | `invoice.service.ts:346`; `report.service.ts:146` | FIN-18 (presentation) |
| Fees report | under-states merchant fees for seeded percentage methods | — | FIN-06 |
| Returns report | uses the **return** date while P&L uses the **sale** date | `:487-576` vs `:446-449` | FIN-10 |
| Customer credit ledger | omits return credits | `customer.routes.ts:335-344` | FIN-19 |
| Customer statement | query references a non-existent column (Phase 1 CU-03) | `customer.routes.ts:259-260` | — |
| Dashboard | 120 s cache; same basis as sales | `:42-119` | INFO |
| Installments report | receivable = Σ pending scheduled rows ✓; contracts tied to cancelled invoices still counted | — | FIN-04 |

---

## 26. Business State Machines

| Entity | Valid transitions (code) | Allowed but invalid / impossible states |
|---|---|---|
| **Invoice** | POS: `completed → cancelled`; installment: `pending → completed` (approve) / `cancelled` (reject); returns keep `completed` | `pending → cancelled` via the cancel endpoint with **phantom restock** (UI-exposed); `pending` + return rows (phantom stock + credit); `cancelled → completed` when a contract is approved after its invoice was cancelled; `completed` with negative line items (FIN-13); `returned` is checked but never set |
| **Installment contract** | `pending_approval → active → completed`; `pending_approval → cancelled` | `active` while its invoice is `cancelled`/fully returned; `active` with every row paid (race); duplicated schedules (race); `overdue` never set |
| **Installment payment** | `pending → paid` | zero-amount rows; method not recorded |
| **Return (refund)** | created only | over-returns under concurrency; returns on pending invoices |
| **Subscription** | §18 | `PAST_DUE` forever without a card (FIN-16); `ACTIVE` after any signed success amount (FIN-17) |
| **Purchase order** | `draft → pending → approved → partially_received → received` | `receivedQuantity > quantity` and `paidAmount > totalAmount` (races); no terminal cancel |
| **Work order** | `ALLOWED_TRANSITIONS` machine; payments in any state; one invoice | two invoices for one WO (race); `paid_amount > final_total` |
| **Stock transfer** | `pending → completed | rejected` | completed twice (race) |
| **Expense** | `pending → approved | rejected` | — |

---

## 27. Confirmed Findings

Field key: **Conc.** = requires concurrency · **Authz** = privilege needed · **FE-bypass** = requires calling the API outside the normal UI.

### FIN-01 — POS amount due differs from the recorded invoice total · **HIGH · P0**
| Field | Detail |
|---|---|
| Business impact | Cash/card under-collection equal to the VAT on every taxed sale (14 % rate is seeded); over-collection equal to any active product discount; receipts whose lines don't add up |
| Technical impact | Two independent total computations with different formulas |
| Location | `apps/web/src/pages/pos/POS.tsx:270-281` (subtotal = Σ price×qty; no tax, no product discount), `:848-850` (amount due shown before completing the sale), `:82-90` (fee preview), `:1061` (server total shown only after completion); server `invoice.service.ts:207-304` |
| Data flow | cart (catalog price) → POS total (no tax) → cashier collects/keys card amount → `POST /invoices` → server total (with tax/discounts/fee) → receipt prints server total with client subtotal/fee |
| Current behaviour | calc §2: VAT item 100 → **POS 100 / invoice 114**; 10 % product discount → 100 / 102.60; VAT + 10 % coupon → 90 / 104; + customer fee (2 %+1) → 92.80 / 107.08 |
| Expected invariant | amount presented for payment = amount recorded |
| Failure scenario | any sale of a product with a tax rate or an active product discount |
| Conc. / Authz / FE-bypass | no / cashier (normal use) / no |
| Remediation | compute totals in one place: a server "quote" endpoint (or shared pure function) used by the POS, and display tax and discounts before payment |
| Regression test | for a matrix of carts (tax, product discount, coupon, fee bearer, credit), POS-displayed due == server `totalAmount` |

### FIN-02 — Refund amounts are mis-computed · **HIGH · P0**
| Field | Detail |
|---|---|
| Business impact | Under-refunds on line-discounted items; **over-refunds (cash or store credit) on coupon / credit / loyalty sales**; wrong refunds when a variant appears on two lines |
| Location | `modules/invoices/invoice.service.ts:605-614` (`returnInvoice`), with `:225` and `:386` defining `subtotal` as already net of the line discount |
| Data flow | `POST /invoices/:id/return` → per-unit = (subtotal + tax − discount)/qty using the **first** line for the variant → `returns.amount` → `credit` ⇒ `customers.credit_balance +=`; `refund` ⇒ P&L revenue −= |
| Current behaviour | calc §3: 205.20 paid → 185.20 refunded; 128.00 paid → 228.00 refunded; 125.40 paid → 228.00 refunded |
| Expected invariant | refund for returned units = amount actually paid for those units (line net + tax, less a prorated share of invoice-level discounts), never more than paid |
| Failure scenario | any return of a discounted, couponed, credit- or loyalty-paid sale, or of a duplicated-variant line |
| Conc. / Authz / FE-bypass | no / `invoices:update` (branch manager, owner) / no |
| Remediation | refund = `(subtotal + taxAmount) / qty × returned` per **specific line id**, minus the prorated invoice-level discount share; track refunded amounts per line; reverse loyalty proportionally |
| Regression test | table-driven test over the calc §3 scenarios (refund == paid share) |

### FIN-03 — Cancelling or returning a pending installment invoice creates phantom stock (and credit) · **HIGH · P0**
| Field | Detail |
|---|---|
| Business impact | Inventory overstated by the contract quantity; for API returns, store credit issued for goods never delivered; a later approval revives the cancelled invoice |
| Location | `invoice.service.ts:692-738` (`cancelInvoice` restocks all variant lines regardless of status — `pending` passes the checks at `:702-710`); `:568-569` (`returnInvoice` rejects only `cancelled`); `installment.service.ts:321-332` (approve sets the invoice to `completed` without checking its status); UI `Invoices.tsx:326` offers "إلغاء الفاتورة" for `pending` invoices |
| Data flow | installment create (stock untouched, invoice `pending`) → cancel ⇒ `stock += qty` + `cancellation` movements → (optional) approve ⇒ invoice `completed`, `stock −= qty` → final stock = original, although the goods left |
| Expected invariant | stock is restored only by the amount previously removed for that invoice; pending invoices can't be cancelled or returned independently of their contract |
| Failure scenario | a manager cancels a pending installment invoice from the Invoices screen |
| Conc. / Authz / FE-bypass | no / `invoices:update` / no for cancel (UI); yes for the return path |
| Remediation | restrict cancel/return to invoice kinds and states that moved stock; route installment invoices through contract reject/cancel; make approval require the invoice to be `pending` |
| Regression test | cancel/return of a pending installment invoice → rejected; stock unchanged |

### FIN-04 — Installment contracts survive cancellation or return of their invoice · **MEDIUM · P1**
| Field | Detail |
|---|---|
| Business impact | Customer keeps owing (and being reminded about) a cancelled or returned sale; down payment has no refund record; the receivables report counts the contract |
| Location | `invoice.service.ts:555-870` never reads or updates `installment_contracts`; `installment-reminders.job.ts:95-108` keeps selecting active contracts |
| Expected invariant | an invoice's financing contract is cancelled or adjusted together with the invoice |
| Conc. / Authz / FE-bypass | no / `invoices:update` / no (cancel is in the UI) |
| Remediation | block cancel/return on financed invoices, or cascade to the contract (cancel unpaid rows, record a down-payment refund or credit) |
| Regression test | cancelling a financed invoice either fails or leaves no pending installment rows |

### FIN-05 — Sale prices come from the client (HSEC-02 re-verified, financial scope) · **HIGH · P0**
| Field | Detail |
|---|---|
| Business impact | Under-priced sales (insider), **stale-price sales in normal use** (carts kept across a price change; offline replays carry captured prices), and sub-piastre prices stored as 0 |
| Location | `invoice.schema.ts:26-33`; `invoice.service.ts:209`; `installment.schema.ts:17-25`; `installment.service.ts:166`; the POS always sends `variant.sellPrice` (`POS.tsx:245,321`) |
| Expected invariant | line price = current catalog price (or an explicit, authorised, audited override) |
| Conc. / Authz / FE-bypass | no / `invoices:create` or `installments:create` / yes for deliberate manipulation; **no** for stale prices |
| Remediation | price lines server-side; reject mismatches or require an override permission with reason, ceiling and audit |
| Regression test | stored `unit_price` == catalog price; a mismatched client price → 400 |

### FIN-06 — Payment-fee vocabulary mismatch zeroes seeded percentage fees · **MEDIUM · P1**
| Field | Detail |
|---|---|
| Business impact | Card (1.75 %) and valU (3 %) fees never recorded for tenants on seeded methods → fee report under-stated, profit over-stated, customer-borne surcharges not charged; after editing to `percentage`, the POS preview drops the fee instead |
| Location | seed `tenant.service.ts:168,171`; `fee.ts:14-26`; `pm.schema.ts:7,16`; `POS.tsx:39,86` |
| Current behaviour | calc §1: server 0.0000 vs POS 17.5 on 1,000 (`percent`); server 17.5 vs POS 0 (`percentage`) |
| Expected invariant | one fee vocabulary; server fee == previewed fee |
| Conc. / Authz / FE-bypass | no / none (default data) / no |
| Remediation | one shared enum; data migration `percent → percentage`; POS uses the server calculation |
| Regression test | seed-data test (every seeded `feeType` is in the API enum); server/POS fee parity |

### FIN-07 — State transitions are check-then-write without locking → duplicated financial effects · **MEDIUM-HIGH · P1**
| Field | Detail |
|---|---|
| Business impact | duplicate installment schedules with stock decremented twice; invoice reversals applied twice (stock, credit, loyalty); over-returns; double PO receipts (stock + supplier liability); double stock transfers; two invoices for one work order |
| Location | `installment.service.ts:312-326`; `invoice.service.ts:697-712` (cancel), `:561-602` (return); `stock.service.ts:224-249`; `po.routes.ts:238-285`; `workOrder.routes.ts:409,510` |
| Data flow | status/availability read outside the tx → unconditional writes inside it; READ COMMITTED, no `FOR UPDATE`, no conditional status update |
| Expected invariant | each business transition applies exactly once |
| Failure scenario | double-click, two tabs, client retry after a timeout, concurrent managers |
| Conc. / Authz / FE-bypass | **yes** / respective permissions / no (achievable from the UI with timing) |
| Remediation | make the transition itself conditional (`updateMany … WHERE status = 'pending_approval'` → count 1, or `SELECT … FOR UPDATE`) and abort otherwise; unique constraints where natural (one invoice per WO in the tx) |
| Regression test | for each transition, two concurrent calls → exactly one effect |

### FIN-08 — Balance updates that are not atomic or not conditional · **MEDIUM · P1**
| Field | Detail |
|---|---|
| Business impact | negative store credit; lost updates (manual credit vs. sale; WO payments); supplier/PO overpayment; lost dunning failure counts |
| Location | `invoice.service.ts:258-265,313-320`; `customer.routes.ts:128-143`; `workOrder.routes.ts` payment route (`newPaid = wo.paidAmount + amount`, no total check); `po.routes.ts:410-416`; `billing.service.ts:213-222` |
| Expected invariant | balances never negative unless allowed; every update preserved |
| Conc. / Authz / FE-bypass | **yes** (except WO overpayment, which needs none) / respective permissions / no |
| Remediation | conditional atomic updates (`decrement … WHERE credit_balance ≥ x`), `increment` instead of absolute sets, remaining-amount checks inside the tx |
| Regression test | concurrent credit spends never go below 0; concurrent manual and sale updates sum correctly |

### FIN-09 — No idempotency on financial creates; offline replay duplicates and loses sales · **MEDIUM · P1**
| Field | Detail |
|---|---|
| Business impact | duplicate invoices (stock, revenue, loyalty, credit) when a response is lost; offline sales whose replay fails are never recorded (goods out, no invoice) |
| Location | every create route (no idempotency key); `POS.tsx:122-140` (replay removes an entry only on HTTP success; failures stay queued indefinitely; queued while `!navigator.onLine`) |
| Expected invariant | one business event ⇒ one record |
| Conc. / Authz / FE-bypass | no / normal use / no |
| Remediation | client-generated idempotency key stored with a unique index (sales, payments, returns, receipts); offline queue with server-side reconciliation (the unused `offline_queue` table) |
| Regression test | the same idempotency key twice → one invoice; replay after a lost response → no duplicate |

### FIN-10 — Profit & loss misstates profit · **MEDIUM · P1**
| Field | Detail |
|---|---|
| Business impact | net profit overstated by VAT collected (~12.3 % of tax-inclusive sales at 14 %) and customer-borne fees; work-order income double-counted; returns lower revenue without lowering COGS; past periods change when later refunds/cancellations occur |
| Location | `report.service.ts:398-459` (`totalAmount` used; `taxTotal` fetched, unused), `:411-418` (WO `paid_amount`) + invoiced WOs, `:423-431` (COGS ignores returns), `:446-449` (refunds selected by the sale's period) |
| Expected invariant | revenue net of tax; each income counted once; COGS reduced for returned goods; transactions reported in the period they occur |
| Conc. / Authz / FE-bypass | no / none / no |
| Remediation | revenue = Σ(subtotal − order discount); exclude tax/pass-through fees; count WO income through invoices only; subtract returned-line COGS; book returns/cancellations at their own date |
| Regression test | P&L for a fixture month equals a hand-computed ledger |

### FIN-11 — Day close and per-method totals don't match cash collected · **MEDIUM · P1**
| Field | Detail |
|---|---|
| Business impact | expected cash overstated by the financed part of installment sales; split tenders attributed wholly to the primary method; work-order payments attributed to the last payment day; down payments not shown as cash |
| Location | `report.service.ts:580-665` |
| Expected invariant | day close = money actually received that day, per method |
| Conc. / Authz / FE-bypass | no / none / no |
| Remediation | derive day close from a payments ledger (down payments, installment payments, split allocations, WO payments) rather than from invoice totals |
| Regression test | fixture day with an installment sale, a split sale and a WO payment reconciles to cash |

### FIN-12 — Loyalty redemption and earning defects · **MEDIUM · P1** (LOW with default settings)
| Field | Detail |
|---|---|
| Business impact | discount granted without consuming equivalent points (zero points when the point value exceeds the capped discount → reusable indefinitely); earned points lost to float flooring; negative balances after cancellation; points kept on returns |
| Location | `shared/utils/loyalty.ts:39-49` (discount not recomputed after flooring); `invoice.service.ts:283-302,326-334` (no decrement when `pointsUsed = 0`), `:466` (float floor), `:789-796` (unconditional reversal) |
| Current behaviour | calc §5–§6 |
| Expected invariant | discount = pointsUsed × pointValue; earned = floor(exact decimal); balance ≥ 0 |
| Conc. / Authz / FE-bypass | no / cashier with loyalty enabled; any user can raise the point value (HSEC-01) / yes (POS doesn't send `redeemPoints`) |
| Remediation | discount = `min(cap, floor(cap / pv) × pv)`; reject redemptions consuming 0 points; Decimal floor for earning; conditional reversal; bound settings |
| Regression test | property test: discount ≤ pointsUsed × pointValue and pointsUsed ≥ 1 whenever discount > 0 |

### FIN-13 — Product discounts can push lines negative · **MEDIUM · P2**
| Field | Detail |
|---|---|
| Location | `product.routes.ts:437-452` (no bound); `invoice.service.ts:214-225` (no clamp) |
| Current behaviour | calc §4: −20.00 subtotal / −2.80 tax line; persists when other lines keep the invoice ≥ 0 (calc §4c), otherwise the sale fails on the DB CHECK |
| Expected invariant | 0 ≤ line discount ≤ line amount; percentage ≤ 100 |
| Conc. / Authz / FE-bypass | no / `products:update` (configuration) / no |
| Remediation | validate discounts at creation (≤100 %, fixed ≤ min variant price) and clamp at sale |
| Regression test | discount > price never yields a negative line |

### FIN-14 — Coupon minimum amount is enforced only in the browser · **MEDIUM · P2**
| Field | Detail |
|---|---|
| Location | `POS.tsx:294` (checked once at validation, pre-tax); `invoice.service.ts:148-156` (not checked) |
| Failure scenario | apply the coupon, then remove items; or call the API |
| Conc. / Authz / FE-bypass | no / `invoices:create` / partially (cart shrink is normal UI) |
| Remediation | enforce `minAmount` server-side against the agreed base |
| Regression test | sale below `minAmount` → `coupon_min_not_met` |

### FIN-15 — Mixed payments are unvalidated and mis-reported · **MEDIUM · P2**
| Field | Detail |
|---|---|
| Location | `invoice.schema.ts:15-16`; `invoice.service.ts:267-272,357-358`; `report.service.ts:591-596` |
| Current behaviour | split amount unbounded; split method unchecked; fee computed with the primary method's rate on the full total; reports ignore the split |
| Expected invariant | Σ allocations = total; fees per allocation; reports per allocation |
| Remediation | payment-allocation rows with validation; per-allocation fees |
| Regression test | split > total → 400; split fees and day close per method |

### FIN-16 — Expired unpaid trials keep full access (HSEC-08 re-verified) · **MEDIUM · P1**
Evidence: §18. Expected invariant (from product copy): restriction after trial unless paid. Conc. no; Authz none; FE-bypass no. Remediation: grace period then `SUSPENDED` for `PAST_DUE` without a payment method. Test: time-travel to trial end + grace → 402.

### FIN-17 — SaaS payment success doesn't verify amount, currency or capture state · **MEDIUM · P1**
| Field | Detail |
|---|---|
| Location | `billing.service.ts:92-198`; `billing.routes.ts:42-48` |
| Current behaviour | any validly signed success for the tenant's `merchant_order_id` activates a full period; amount and currency recorded, not compared; auth-only flags ignored |
| Exploitability | depends on obtaining such a signed transaction (HSEC-21) — UNVERIFIED |
| Remediation | persist the expected amount/currency/order id at checkout; compare on webhook; ignore unsigned fields |
| Regression test | signed success with amount ≠ expected → no activation |

### FIN-18 — Precision and presentation inconsistencies · **LOW · P2**
4-dp storage vs 2-dp currency; JS display rounding differs from server HALF_UP (calc §9e); sub-piastre prices stored as 0; `discount_amount` mixes coupon, credit and loyalty (`invoice.service.ts:346`). Remediation: round settled amounts to 2 dp at defined points; format from decimal strings; store discount components separately.

### FIN-19 — Store-credit ledger can't reconcile to the balance · **LOW · P2**
Return credits aren't written as customer ledger entries (`invoice.service.ts:663-676` vs `customer.routes.ts:335-339`); manual adjustment and its audit aren't in one transaction (`customer.routes.ts:139-155`). Remediation: a credit ledger table written in the same tx as every balance change.

### FIN-20 — Installment model gaps · **LOW · P2**
Zero-amount schedules on full down payment; contract can stay `active` with all rows paid (race); payment method not persisted; invoice `paidAmount` frozen at the down payment; `overdue` never written; no partial/early settlement (`installment.service.ts:209-213,437-492`).

### FIN-21 — Deactivated products remain sellable via the API · **LOW · P2**
`invoice.service.ts:160-165` and `installment.service.ts:121-124` check only `variant.isActive`; `DELETE /products/:id` sets only `product.isActive` (`product.service.ts:140-148`).

### FIN-22 — Historical values that move · **LOW · P2**
ETA uses the current tax rate (`eta-submission.job.ts:120-128`); pre-017 COGS uses the live cost (`report.service.ts:429`); reports re-bucket cancellations and refunds into the original sale's period.

### FIN-23 — WAC treats zero cost as unset · **LOW · P3**
`cost.ts:23` adopts the received cost when the existing cost is 0 (calc §8c: 100 vs true 50).

### FIN-24 — Minor · **INFO · P3**
Invoice numbers skip values on rollback (sequence) and use the UTC date; the approval response is read via the base client inside the transaction (pre-commit data, `installment.service.ts:396-399`).

---

## 28. Likely Findings

| ID | Finding | Evidence (CONFIRMED part) | Missing proof | Priority |
|---|---|---|---|---|
| **FIN-L1** | Renewal/dunning can charge a card twice when the DB write fails after a successful charge | charge then separate DB write; any error ⇒ job retry (3 attempts) re-runs the cycle (`renewal.job.ts:92-173`; `dunning.job.ts:104-164`) | whether Paymob's webhook records the first charge before the retry | P1 |
| **FIN-L2** | A low-amount signed success could activate another tenant | FIN-17 + unsigned tenant binding (HSEC-21) | availability of such payloads | P1 |
| **FIN-L3** | Token charges answered as `pending` (e.g. 3-D Secure) are counted as failures | `if (charge.success) … else handleWebhookFailure` (`renewal.job.ts:132-158`) | Paymob response semantics | P2 |

---

## 29. Potential Findings

| ID | Finding | Condition |
|---|---|---|
| FIN-P1 | VAT is computed before the order-level coupon | depends on the applicable tax rule for order discounts |
| FIN-P2 | Multi-currency amounts are stored unconverted | only if non-base currencies get created (no API today) |
| FIN-P3 | Duplicate renewal charges across replicas | multi-replica + cycle longer than the lock TTL (HSEC-27) |
| FIN-P4 | Wrong subscription charged/activated | more than one subscription row per tenant (unordered `findFirst`) |
| FIN-P5 | Duplicate ETA submissions | repeated resubmits once the ETA pipeline works |
| FIN-P6 | Auth-only card transactions treated as paid | card integration configured for auth/capture |
| FIN-P7 | Manual checkout + due renewal charge the same period twice | ACTIVE sub with a token that also pays manually |
| FIN-P8 | Negative stock/invoice totals not blocked | tenant schemas without migration 016 |
| FIN-P9 | Very large carts exceed the 5 s interactive-tx timeout | availability only; tx rolls back cleanly |

---

## 30. Unverified Items

| ID | Item | Evidence needed |
|---|---|---|
| U-01 | Migration 016/017 applied in every production tenant schema | read-only schema query |
| U-02 | How many tenants use non-zero tax rates, product discounts, coupons, loyalty | aggregate counts (FIN-01/02/12 frequency) |
| U-03 | Paymob pending/3DS, auth/capture, TOKEN callbacks, obtainable amounts | sandbox |
| U-04 | Whether price override is a wanted feature | product decision |
| U-05 | Tax treatment of order-level discounts | tax advisor |
| U-06 | Real-world concurrency/duplicate frequency (buttons are disabled while pending, but multi-tab and retries remain) | production logs |
| U-07 | Cashier workflow: collect before or after "complete sale" | user research |
| U-08 | Whether tenants edited the seeded payment methods | data check |
| U-09 | Replica count | deployment |

---

## 31. Cross-Check of Previous Audit Findings

| Earlier claim | Phase 3 verdict | Notes |
|---|---|---|
| **HSEC-02** server trusts client `unitPrice` | **CONFIRMED, broadened** | also hits installments; stale prices in normal use (cached carts, offline replay); sub-piastre prices persist as 0 (FIN-05) |
| **HSEC-05** reminder trigger loops over all ACTIVE tenants | **CONFIRMED** | no balance is modified; side effects are emails and `reminder_sent` audit rows in other tenants; the manual path skips the job lock |
| Coupon minimum not enforced (Phase 1 §8.1 / Phase 2 HSEC-03 context) | **CONFIRMED, refined** | enforced only in the POS, once, at validation time, on a pre-tax/pre-product-discount subtotal; never server-side (FIN-14) |
| Refund subtracts the line discount twice (Phase 1 F-04) | **CONFIRMED by calculation** (calc §3a) | **plus a larger, new defect:** invoice-level discounts are ignored → over-refunds; duplicate-variant lines priced from the first line (FIN-02) |
| Fee type `percent` vs `percentage` (Phase 1 T-05) | **CONFIRMED** (calc §1) | only seeded data can hold `percent` (the API enum rejects it); editing to `percentage` flips the POS-preview mismatch; historical invoices keep the fee stored at sale (FIN-06) |
| Paymob amount not verified (Phase 1 B-04, Phase 2 HSEC-21) | **CONFIRMED in code** | exploitability still UNVERIFIED (FIN-17 / FIN-L2) |
| Trial → PAST_DUE keeps access (Phase 1 J-06, Phase 2 HSEC-08) | **CONFIRMED** | the intended rule is now established from the product's own banner/email copy (FIN-16) |
| Phase 1 F-07 "money passes through JS numbers" | **CORRECTED** | those paths are absorbed by 4-dp rounding (calc §9) — no financial outcome changes, **except** loyalty earning (calc §6) |
| Phase 1 §8.15 "POS preview; server authoritative" | **CORRECTED / understated** | the POS figure is the amount presented for payment **before** the server computes the total, and it omits tax and product discounts (FIN-01) |
| Phase 1 §9 "cancel → increment" | **REFINED** | for pending installment invoices the increment restores stock that was never removed (FIN-03) |
| Phase 1 F-02 credit race "POTENTIAL" | **UPGRADED to CONFIRMED** (concurrency-dependent) | READ COMMITTED + unconditional decrement (FIN-08) |
| Phase 1 IN-02 / S-07 pre-tx status checks | **UPGRADED** | concrete duplicated effects: schedules, stock, transfers (FIN-07) |
| Phase 2 HSEC-03 "credit adjust uses a JS-number read-modify-write" | **partly CORRECTED** | the float aspect is harmless (calc §9b); the lost-update aspect stands (FIN-08) |
| Phase 1 §13 profit | **EXTENDED** | VAT and pass-through fees counted as profit; refunds/COGS period mismatch (FIN-10) |

No earlier finding was found to be wrong in substance; the corrections above concern scope or magnitude.

---

## 32. Top Financial Risks

Ranked by **Financial Impact × Probability × Scope × Difficulty of Detection** (each 1–3):

| Rank | ID | Score | Priority |
|---|---|---|---|
| 1 | FIN-01 POS amount due ≠ recorded total | 3×3×3×2 = 54 | P0 |
| 2 | FIN-02 refund formula | 3×2×3×3 = 54 | P0 |
| 3 | FIN-05 client-supplied prices | 3×2×3×3 = 54 | P0 |
| 4 | FIN-06 seeded percentage fees = 0 | 2×3×3×3 = 54 | P1 |
| 5 | FIN-10 profit gross of VAT, double counting | 2×3×3×3 = 54 | P1 |
| 6 | FIN-03 phantom stock from pending-invoice cancel/return | 2×2×2×3 = 24 | P0 |
| 7 | FIN-04 contracts survive invoice cancel/return | 2×2×2×3 = 24 | P1 |
| 8 | FIN-09 no idempotency / offline replay | 2×2×3×2 = 24 | P1 |
| 9 | FIN-07 duplicated transitions under concurrency | 3×1×3×2 = 18 | P1 |
| 10 | FIN-16 unpaid trials keep access | 2×3×3×1 = 18 | P1 |
| — | next: FIN-08 (18), FIN-11 (16), FIN-12 / FIN-17 / FIN-L1 / FIN-14 (12) | | |

---

## 33. Required Regression Tests

| ID | Test | Asserts |
|---|---|---|
| RT-F01 | POS/server total parity matrix (tax, product discount, coupon, fee bearer, credit, loyalty) | displayed due == `totalAmount` |
| RT-F02 | Refund table (calc §3) | refund == amount paid for the returned units; never above |
| RT-F03 | Pending-invoice cancel/return | rejected; stock and credit unchanged |
| RT-F04 | Financed invoice cancel/return | contract cancelled/adjusted or request rejected |
| RT-F05 | Server-side pricing | `unit_price` == catalog price unless authorised override |
| RT-F06 | Fee vocabulary | every seeded `feeType` ∈ API enum; server fee == POS fee |
| RT-F07 | Concurrent transitions (approve, cancel, return, transfer, receive, WO invoice) | exactly one effect |
| RT-F08 | Concurrent balances (credit spend, manual credit, WO payment, PO payment) | no negative/lost updates; no overpayment |
| RT-F09 | Idempotency key on sales/payments/returns | duplicate key → single record |
| RT-F10 | Offline replay | lost-response replay doesn't duplicate; failed replay surfaces for reconciliation |
| RT-F11 | P&L fixture month | equals a hand-built ledger (tax excluded, WO once, return COGS reversed, period by event date) |
| RT-F12 | Day close fixture | equals cash received per method |
| RT-F13 | Loyalty property test | discount ≤ pointsUsed × pointValue; earn uses decimal floor; balance ≥ 0 |
| RT-F14 | Product-discount bounds | no negative line amounts |
| RT-F15 | Coupon minimum server-side | below minimum → rejected |
| RT-F16 | Split payment | Σ allocations == total; per-allocation fees |
| RT-F17 | Trial expiry | trial end + grace → 402 |
| RT-F18 | Paymob amount/currency | mismatch → no activation |
| RT-F19 | Renewal crash between charge and DB write | retry doesn't charge again (idempotency per period) |
| RT-F20 | Credit ledger reconciliation | Σ ledger == balance for every customer |

---

## 34. Remediation Priority

| Priority | Findings | Why |
|---|---|---|
| **P0** | FIN-01, FIN-02, FIN-03, FIN-05 | incorrect money movement in normal operation (amount collected, refunds) and systematic inventory/credit corruption |
| **P1** | FIN-04, FIN-06, FIN-07, FIN-08, FIN-09, FIN-10, FIN-11, FIN-12, FIN-16, FIN-17, FIN-L1, FIN-L2 | significant miscalculation, balance corruption, duplicate effects, profit/COGS errors, billing integrity |
| **P2** | FIN-13, FIN-14, FIN-15, FIN-18, FIN-19, FIN-20, FIN-21, FIN-22, FIN-L3 | limited inconsistencies, reporting, edge cases |
| **P3** | FIN-23, FIN-24, FIN-P1 – FIN-P9 | low impact / conditional |

---

## 35. Evidence Ledger

| ID | Claim | Primary evidence | Calc | Status |
|---|---|---|---|---|
| FC-01 | Sale is one atomic tx; conditional stock decrement | `invoice.service.ts:309-401` | — | CONFIRMED (control) |
| FC-02 | Coupon usage race-safe | `invoice.service.ts:409-417` | — | CONFIRMED (control) |
| FC-03 | Loyalty redemption race-safe | `invoice.service.ts:326-334` | — | CONFIRMED (control) |
| FC-04 | WAC math correct; cost snapshotted | `cost.ts`; `po.routes.ts:299-319`; `invoice.service.ts:242` | §8a-b | CONFIRMED (control) |
| FC-05 | Installment schedule reconciles | `installment.service.ts:23-34,220-224,367-384` | §7 | CONFIRMED (control) |
| FC-06 | Webhook idempotent per transaction | `billing.service.ts:144-181` | — | CONFIRMED (control) |
| FC-07 | Float noise absorbed by 4-dp rounding (except loyalty earn) | `decimal.ts`; NUMERIC(15,4) | §9 | CONFIRMED |
| FIN-01 | POS due excludes tax/discounts | `POS.tsx:270-281,848-850` | §2 | CONFIRMED |
| FIN-02 | Refund formula | `invoice.service.ts:605-614` | §3 | CONFIRMED |
| FIN-03 | Phantom stock/credit on pending invoices | `invoice.service.ts:568-569,692-738`; `Invoices.tsx:326` | — | CONFIRMED |
| FIN-04 | Contracts survive invoice cancel/return | `invoice.service.ts:555-870` | — | CONFIRMED |
| FIN-05 | Client prices | `invoice.service.ts:209`; `installment.service.ts:166` | — | CONFIRMED |
| FIN-06 | Fee vocabulary | `tenant.service.ts:168,171`; `fee.ts:14-26`; `POS.tsx:86` | §1 | CONFIRMED |
| FIN-07 | Non-atomic transitions | §22 rows | — | CONFIRMED (conc.) |
| FIN-08 | Non-atomic balances | §22 rows | §9b | CONFIRMED (conc.) |
| FIN-09 | No idempotency / offline replay | create routes; `POS.tsx:122-140` | — | CONFIRMED |
| FIN-10 | P&L misstatement | `report.service.ts:398-459` | — | CONFIRMED |
| FIN-11 | Day close | `report.service.ts:580-665` | — | CONFIRMED |
| FIN-12 | Loyalty | `loyalty.ts:39-49`; `invoice.service.ts:466,789-796` | §5-6 | CONFIRMED |
| FIN-13 | Negative lines | `product.routes.ts:437-452`; `invoice.service.ts:214-225` | §4 | CONFIRMED |
| FIN-14 | Coupon minimum | `POS.tsx:294`; `invoice.service.ts:148-156` | — | CONFIRMED |
| FIN-15 | Mixed payments | `invoice.service.ts:267-272,357-358`; `report.service.ts:591-596` | — | CONFIRMED |
| FIN-16 | Unpaid trials | `trial-expiry.job.ts:115-132`; `dunning.job.ts:74-81`; `tenant.middleware.ts:103`; `SubscriptionBanner.tsx:66-72` | — | CONFIRMED |
| FIN-17 | Paymob amount/currency | `billing.service.ts:92-198` | — | CONFIRMED (code) |
| FIN-18 – FIN-24 | precision, ledger, installment gaps, inactive products, history, WAC zero, minor | as cited in §27 | §9e-f, §8c | CONFIRMED |
| FIN-L1 – L3 | renewal re-charge, low-amount activation, pending-as-failure | as cited in §28 | — | LIKELY |
| FIN-P1 – P9 | conditional issues | §29 | — | POTENTIAL |

---

# Top 10 Financial Risks

**1 · FIN-01 — The POS asks for a different amount than the invoice records**
- **Evidence:** `POS.tsx:270-281,848-850` vs `invoice.service.ts:207-304`; calc §2 (100 shown vs 114 recorded).
- **Module:** POS / invoices.
- **Impact:** VAT under-collected on every taxed sale; overcharge on discounted products.
- **Likelihood:** high wherever tax rates or product discounts are used.
- **Concurrency:** none.
- **Current mitigation:** the post-sale modal shows the server total.
- **Fix:** a single server-computed quote shown before payment.
- **Test:** RT-F01.

**2 · FIN-02 — Refunds don't equal the amount paid**
- **Evidence:** `invoice.service.ts:605-614`; calc §3 (−20 / +100 / +102.60).
- **Module:** returns.
- **Impact:** under-refunds and over-refunds (cash or store credit).
- **Likelihood:** every return of a discounted, couponed, credit- or loyalty-paid sale.
- **Concurrency:** none.
- **Current mitigation:** quantity cap only.
- **Fix:** per-line refund of the amount paid, net of prorated invoice-level discounts.
- **Test:** RT-F02.

**3 · FIN-05 — Prices are taken from the client**
- **Evidence:** `invoice.service.ts:209`; `installment.service.ts:166`.
- **Module:** sales, installments.
- **Impact:** under-pricing and stale-price sales; sub-piastre prices stored as 0.
- **Likelihood:** medium (stale carts, offline replay) to deliberate (insider).
- **Concurrency:** none.
- **Current mitigation:** the UI sends catalog prices.
- **Fix:** server-side pricing plus an authorised override.
- **Test:** RT-F05.

**4 · FIN-06 — Seeded card/valU fees compute as zero**
- **Evidence:** calc §1; `tenant.service.ts:168,171`; `fee.ts:14-26`.
- **Module:** payment methods, reports.
- **Impact:** missing fee expenses and customer surcharges; profit overstated.
- **Likelihood:** every tenant that never edited the seeded methods.
- **Concurrency:** none.
- **Current mitigation:** none.
- **Fix:** one enum, a data migration, and server-driven previews.
- **Test:** RT-F06.

**5 · FIN-10 — "Net profit" includes VAT and double counts**
- **Evidence:** `report.service.ts:398-459`.
- **Module:** reports.
- **Impact:** profit overstated (~12.3 % of tax-inclusive sales at 14 % VAT) plus work-order double counting, return COGS and period errors.
- **Likelihood:** systematic for VAT stores.
- **Concurrency:** none.
- **Current mitigation:** none.
- **Fix:** net-of-tax revenue, single counting, return COGS reversal, event-date periods.
- **Test:** RT-F11.

**6 · FIN-03 — Cancelling or returning pending installment invoices creates phantom stock and credit**
- **Evidence:** `invoice.service.ts:568-569,692-738`; `Invoices.tsx:326`.
- **Module:** invoices, installments, inventory.
- **Impact:** stock overstated by the contract quantity; credit for undelivered goods (API path).
- **Likelihood:** medium (the cancel button is exposed in the UI).
- **Concurrency:** none.
- **Current mitigation:** none.
- **Fix:** restrict to invoices that moved stock; route through the contract.
- **Test:** RT-F03.

**7 · FIN-04 — Financing outlives the sale**
- **Evidence:** `invoice.service.ts:555-870` never touches contracts.
- **Module:** installments.
- **Impact:** customers owe and are reminded about cancelled or returned sales; down payments are unaccounted for.
- **Likelihood:** medium for installment stores.
- **Concurrency:** none.
- **Current mitigation:** none.
- **Fix:** block, or cascade to the contract.
- **Test:** RT-F04.

**8 · FIN-09 — Duplicates on retry; lost offline sales**
- **Evidence:** no idempotency keys; `POS.tsx:122-140`.
- **Module:** sales, payments.
- **Impact:** duplicate invoices, stock and loyalty; unrecorded sales.
- **Likelihood:** medium (network loss, offline mode).
- **Concurrency:** no (timing).
- **Current mitigation:** buttons are disabled while a request is pending.
- **Fix:** idempotency keys plus server-side offline reconciliation.
- **Test:** RT-F09, RT-F10.

**9 · FIN-07 — Duplicated transitions under concurrency**
- **Evidence:** §22.
- **Module:** installments, invoices, stock, POs, work orders.
- **Impact:** duplicate schedules, double stock moves, double reversals, two invoices per work order.
- **Likelihood:** low–medium.
- **Concurrency:** **yes**.
- **Current mitigation:** sequential status checks only.
- **Fix:** conditional status updates or row locks.
- **Test:** RT-F07.

**10 · FIN-16 — Unpaid trials keep full access**
- **Evidence:** `trial-expiry.job.ts:115-132`; `dunning.job.ts:74-81`; `tenant.middleware.ts:103`.
- **Module:** billing.
- **Impact:** unpaid perpetual use (incl. Enterprise).
- **Likelihood:** certain for non-paying trials.
- **Concurrency:** none.
- **Current mitigation:** banner only.
- **Fix:** grace period, then suspension.
- **Test:** RT-F17.

*End of Phase 3. No code was changed; calculations ran in an isolated script against the repo's own helpers.*
