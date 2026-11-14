# حِسبة (Hesba) — W1 Remediation Tracking

| Item | Value |
|---|---|
| Wave | **W1: safety net and isolated fixes** (`Hesba_Phase10_Final_Consolidation_Roadmap.md` §7 W1; tasks T-04, T-06) |
| Purpose | Records only what was actually done and verified in W1. The Phase 1–11 reports and the Phase 10 roadmap are **not** edited; findings close here, with evidence |
| Working copy | Git worktree `.claude/worktrees/w1-safety-net`, branch `claude/w1-safety-net`, cut from `main` @ `7317c97`. The main checkout (`claude/ui-pos-merge-split` @ `8846bce`, with the user's uncommitted `AppShell.tsx` / `POS.tsx` edits and untracked `documents/`) is untouched |
| Environment | Local only; session 4 used disposable loopback PostgreSQL / Redis containers, approved by the user and since removed (§5M); sessions 5–6 used a temporary Homebrew PostgreSQL 18.3 on 127.0.0.1, approved by the user, stopped and deleted after each run (§5N). No production host, database, Redis, VPS, deployment, or live Paymob / ETA / Resend call |
| Commits / pushes | **None.** All W1 changes are uncommitted in the worktree until the user explicitly approves. Sessions 5–6 (W3–W12, under the owner's delegation, §6.0) are in §5N |

---

## 1. Status board

| # | CF | Original IDs | Status | Date (UTC) |
|---|---|---|---|---|
| 1 | **CF-132** | HSEC-16, P-02 (Phase 1) | **Fixed, tests passing; uncommitted** | 2026-10-13 |
| 2 | **CF-085** | HSEC-15, AU-11 | **Fixed, tests passing; uncommitted** (accepted provisionally) | 2026-10-13 |
| 2a | **CF-085-FU1** (follow-up; not a Phase 10 CF) | from CF-085 review finding R3 | **Fixed, tests passing; uncommitted.** Security review found and fixed S1 and S2 (§5.7). **Production-router defect** (every login landed on `/pos` under `v7_startTransition`) **reproduced, root-caused and fixed** in `GuestGuard`, with 19 production-router tests (§5.8) and 5 persisted-session tests (§5.10). **CLOSED at code level** (§5.10); real-browser verification still open | 2026-10-13 / 2026-10-14 |
| 3 | **CF-048** | INFRA-08 | **Fixed (git verified; Docker context check emulated, real Docker run not done); uncommitted** | 2026-10-13 |
| 4 | **CF-035** | HSEC-20, A-02, INFRA-P03 | **Fixed, tests passing; uncommitted.** Policy taken from Phase 2/8/10, not ambiguous (§5B) | 2026-10-13 |
| 5 | **CF-025** | UX-03, T-06 | **API fix done, tests passing; uncommitted** (§5C). The POS error-state half is still deferred (`POS.tsx` has user edits). RT7-04 passed on disposable PostgreSQL (§5M): the seeded cashier, logged in for real, completes a cash sale (201) | 2026-10-13 / 2026-10-15 |
| 6 | **CF-026** | UX-02 | **Implemented at code level; uncommitted; NOT cleared for release** (§5J). Invoice items now carry `productName`, `sku` and `lineSubtotal`; the drawer, return dialog, A4 print and bulk print use them. Canonical P1 release blocker. **RT7-03 done (§5M):** the detail response was recorded from a real PostgreSQL database and the web tests run against it. **Open:** real-browser popup and printing behaviour, visual A4 check, review and merge approval | 2026-10-14 / 2026-10-15 |
| 7 | **CF-050** | PERF-03 | **Partially fixed (W1 label scope); uncommitted** (§5K): the sales report and its Excel export state "latest N of M" (`invoicesTruncated`, `invoicesLimit`). Found implemented in the worktree but not previously recorded; re-verified 2026-10-15 (diff read, mutation V7 caught). **Open:** full export streaming (W7) | 2026-10-15 |
| 8 | **CF-023: closed at code level (owner decision); NOT cleared for release** | HSEC-06, INT-07, AU-10 | **Closed at code level by owner decision** (§5F.9). **Release acceptance outstanding:** canonical P1 release blocker (Phase 10 §4.5); its §8.2 recovery criterion ("legitimate receipts still deliver") and source test RT6-M passed only locally (§5M: the real route and database with a recording sender; RT6-M against a loopback Resend mock, not Resend); not operationally verified (§1.1, §7 G-E). Work recorded: AU-10 (§5D), HTML escaping (§5E), recipient policy R1 (§5F); the override is available to **every `super_admin`**. **Done locally (§5M):** a real-DB receipt send (address on file: 200 with an audit row; cashier override: 403, nothing sent; owner override: 200). **Still required before release:** the rendered recipient-dialog test. Uncommitted | 2026-10-13 / 2026-10-15 |
| 9 | **CF-042**, **CF-041 (Resend part)** | BG-05, P6-P06, BG-04, B-07 | **CF-042 fixed at code level; uncommitted** (§5K): the Resend result is checked (`EmailDeliveryError` `failed` / `unknown`), jobs record a reminder or counter only after a confirmed send, no automatic retry; the last two silent `.catch(() => {})` paths now log template and tenant (no recipient). **CF-041 Resend part fixed at code level** (10 s bound). Found implemented but not previously recorded; re-verified 2026-10-15 (mutations V5, V6 caught). **RT6-M passed (§5M)** against a loopback Resend mock (200 / 500 / 429 / connection reset). **Open:** PV-17. CF-041 is **one** canonical finding split across rows 9 and 11 plus a W6 Paymob part (§1.2) | 2026-10-15 |
| 10 | **CF-022 (scoping)**; CF-091, CF-092 | HSEC-05, J-08, DB-26, BG-06 | **CF-022 scoping fixed, tests passing; uncommitted** (§5G): the manual trigger processes only the caller's store, under a per-store lock shared with the daily job. **CF-091 and CF-092 fixed at code level (§5M):** each reminder is claimed atomically, once per payment per day and only while the payment is still due (additive tenant migration 018, `reminder_claims`); a definitely failed send releases the claim, an unknown outcome keeps it. This replaces CF-092's interim re-read (§5K). RT-C3 / RT-HSEC05 passed on disposable PostgreSQL and Redis (cycle invoked directly, not through a BullMQ worker). **CF-022 stays partially fixed:** its §8.2 recovery criterion ("a re-run the next day sends again") has not been tested | 2026-10-13 / 2026-10-15 |
| 10a | **CF-022-FU1** (non-canonical follow-up; it is the release part of canonical **CF-040**, row 10c) | DB-L07 (Phase 4), CF-040 | **Fixed, tests passing (mock Redis only); uncommitted** (§5H): random owner token plus atomic compare-and-delete release. **Real-Redis check passed (§5M):** 20 concurrent `withLock` trials, and a release after TTL expiry leaves the next owner's lock in place. **Not done:** lock renewal (overlap after TTL expiry is still possible; CF-091's claim now stops duplicate reminders in that case) | 2026-10-14 |
| 10b | **CF-135 (reset-token channel)**; pulled forward from W12 | HSEC-25 (Phase 2) → L6-02 (Phase 6). Both channels were addressed at code level: the reset token in §5I.3 and the Paymob return fields in §5I.8 | **Unsafe path established in code (unit-verified); actual leakage NOT confirmed** (GA enablement unknown, PV-03). **Fixed, tests passing (jsdom); uncommitted** (§5I): the token is moved out of the URL before render, and page views drop `token`. Follow-up §5I.7: route-matching gap fixed (`matchPath`); the reload trade-off documented (in-memory token, no persistence). **§5I.8: Paymob fields fixed at code level (jsdom):** the `/settings` landing URL is cleaned before render, page views are allowlisted (`tab`, `plan`), and the reset page has recovery guidance. **Open:** a real-browser check, deployed GA state (PV-03), the local service-worker cache key. **Not closed** | 2026-10-14 |
| 10c | **CF-040** (canonical; P2, FG, wave **W6**; Phase 10 registry line 192) | BG-02 → DB-L07, J-07, BG-10 | **Partially fixed; uncommitted.** Only the owner-safe release part is implemented, through the non-canonical follow-up CF-022-FU1 (row 10a, §5H): a random owner token and an atomic compare-and-delete, **tested with mocked Redis and, since §5M, a real Redis 7**. **Open:** lock renewal; the progress-record, orphaned-lock and tick re-execution parts (Phase 10 T-26, W6). **Not fixed, not closed;** wave and release class unchanged | 2026-10-14 |
| 11 | **CF-041 (ETA part)** | BG-04, B-07 | **Partially fixed; uncommitted** (§5K): the idempotent ETA calls (OAuth token, document status) are bounded at 15 s; re-verified 2026-10-15 (mutation V4 caught). The `submitDocuments` timeout stays **blocked** until CF-058 (W11). The Paymob part waits for W6 (Phase 10 T-25, D-14); see §1.2 | 2026-10-15 |
| 12 | **CF-093** | BG-15 | **Fixed at code level; uncommitted** (§5K): one-line JSON job logs (no stacks, no recipients) for completed and failed jobs and per-subscription failures; 30-day retention; ETA failed jobs capped. Found implemented but not previously recorded; re-verified 2026-10-15 (mutations V8, V9 caught) | 2026-10-15 |
| 13 | **CF-043** | INFRA-03, A-07, INFRA-L03 | **Fixed at code level; uncommitted** (§5K): `/health` keeps its status codes and reports dependencies (report-only); new `/readyz` (503 unless PostgreSQL, Redis, migrations `ok` and startup complete) and `/livez`; migration state shared with the manual run-migrations route. Found implemented but not previously recorded; re-verified 2026-10-15 (mutations V1–V3 caught). **Readiness check run (§5M):** with the PostgreSQL or Redis container paused, `/readyz` returned 503 and `/livez` 200, and 200 again after recovery. The run found and fixed a defect: Redis is created with `lazyConnect`, so readiness reported it down until something else connected. **Open:** a week of observation before it gates deploys | 2026-10-15 |
| 14 | CF-032 | INFRA-02, A-08 | Not started; alert delivery **blocked** (needs a Sentry project or DSN and a recipient) | — |
| 15 | **CF-047** | INFRA-07 | **Fixed at code level; uncommitted** (§5N.15): production fail-fast on partly configured features (decision in §6.0) | 2026-10-21 |
| 16 | **CF-033** | HSEC-18, INFRA-10 | **Partially fixed (configuration part); uncommitted** (§5K): Fastify `trustProxy` now comes from `TRUST_PROXY` (unset = off = unchanged behaviour; malformed value fails at boot; documented in `.env.example`). The production value stays **blocked** on the new host's proxy topology (PV-01) | 2026-10-15 |
| 17 | **CF-044** | INFRA-04 | **Fixed in the repository; uncommitted** (§5N.15): `stop_grace_period: 35s`; nothing deployed | 2026-10-21 |
| 18 | **CF-124, CF-126, CF-127, CF-128, CF-129, CF-131** (W9; pulled forward, independent of T-28) | HSEC-09, HSEC-17/AU-03, AU-02, AU-05, P-01, HSEC-24/W-04 | **Fixed at code level; uncommitted** (§5K.1) | 2026-10-15 |
| 19 | **CF-079, CF-113, CF-140, CF-141, CF-142, CF-143** (W12; pulled forward) | S-03, DB-33/CU-03, S-01, S-09, T-03, T-04 | **Fixed at code level; uncommitted** (§5K.1). Real-schema checks run (§5M): CSV imports, the statement export (the run found and fixed a `uuid = text` defect), CF-140, CF-141, CF-142 | 2026-10-15 |
| 20 | **CF-061 + CF-062** (W4; co-requisite D-22, shipped together) | FIN-13, UX-09 | **Fixed at code level; uncommitted** (§5K.1). No data migration | 2026-10-15 |
| 21 | **CF-100** (W5) and **CF-144** (W2) | DB-28; IN-05 | **Fixed at code level; uncommitted** (§5K.1) | 2026-10-15 |
| 22 | **CF-021, CF-081, CF-116, CF-133, CF-145, CF-155, CF-156, CF-157, CF-160** | HSEC-04/B-06, UX-06, DB-35, HSEC-22/W-06, FIN-24, UX-11, UX-12, UX-13, UX-17 | **Partially fixed; uncommitted** (§5K.2). Remaining parts blocked: W3 authorisation (CF-021), `POS.tsx` (user edits pending), a master FK migration (CF-116), owner decisions (CF-145) | 2026-10-15 |
| 23 | CF-114 (guard only) | DB-34 | **Not fixed.** A DB-free column-parity test was added (§5K.1); the one current drift is CF-112. T-08's scratch-database `migrate diff` is still needed | 2026-10-15 |
| 24 | **W2 primitives (T-07; not a CF)** | RC-01 | **Implemented at code level; uncommitted** (§5L.1): `transition` (conditional change that must hit one row, else 409) and `lockRow` (no-op update that takes a row lock), both through Prisma delegates. Unit-tested; the W2 race harness ran on disposable PostgreSQL (§5M): 20 trials each, no lost update; an unlocked control shows lost updates | 2026-10-15 |
| 25 | **CF-011, CF-012, CF-013, CF-014, CF-015, CF-070, CF-071, CF-072, CF-073, CF-074, CF-075, CF-101** (W5b guarded writes; RB: CF-011 … CF-015) | DB-02, DB-03/04, DB-05, DB-06, DB-07, DB-11, DB-12, DB-13, DB-14, DB-15, DB-16, DB-27 | **Fixed at code level; uncommitted** (§5L.2), built on row 24. **NOT cleared for release.** RT-A1 … RT-A5 and the other W5b race tests passed on disposable PostgreSQL (§5M; 20 trials, 0–20 ms stagger); sequential losers now get 409 instead of 400. The CHECK / UNIQUE backstops are DDL (need T-01/T-02 cleanup and the T-03 restore drill) | 2026-10-15 |
| 26 | **CF-036, CF-063, CF-068** (W4; independent of T-05 / T-11) and **CF-104** (W5) | FIN-12, FIN-14, FIN-21, DB-P06 | **Fixed at code level; uncommitted** (§5L.3); a real-DB sale for each guard passed (§5M). CF-063's base (Σ unit price × qty) mirrors the POS; the owner may confirm another base | 2026-10-15 |
| 27 | **CF-149, CF-165** (W10 hygiene) | D-08, I-01 | **Fixed at code level; uncommitted** (§5L.4) | 2026-10-15 |
| 28 | **CF-064, CF-076, CF-083, CF-106, CF-120** | FIN-15, DB-18, UX-08, DB-36, HSEC-12/UX-10 | **Partially fixed; uncommitted** (§5L.5). Remaining parts: allocation rows (T-13), deadlock retry, W6 banner state, owner rule for invoicing states, W3 permission model | 2026-10-15 |
| 29 | **Session 4: disposable PostgreSQL / Redis acceptance** (approved by the user) | §7.3 | **Run locally on loopback containers, since removed** (§5M): 9 integration files / 56 tests pass from a fresh database; two real defects found and fixed (CF-043 lazy Redis, CF-113 `uuid = text`); CF-091 and CF-092 implemented. Nothing merged; no release blocker cleared | 2026-10-15 |

### 1.1 Canonical status of the worked findings (reconciled 2026-10-14; CF-026 added the same day; extended 2026-10-15, §5K, §5L, §5M; totals reconciled 2026-10-19, §5N — per-finding detail for sessions 5–6 is in §8)

**Rules:**
- The Phase 10 §3.2 registry is authoritative for IDs, titles, severity, release class and wave. This report records remediation status only.
- **CF-085-FU1 and CF-022-FU1 are non-canonical follow-ups** (of CF-085 and of CF-022 / CF-040). They are not counted as findings.
- **"Fixed at code level" means a diff and passing automated tests in the uncommitted worktree.** It is not merged, not deployed and not operationally verified.

| CF | Registry (line): sev · release · wave | Status | Evidence | Outstanding before acceptance or release |
|---|---|---|---|---|
| CF-132 | 284: P3 · POST · W1 | Fixed at code level; uncommitted | §3 | Merge; a staging call (P3, no §8.2 row) |
| CF-085 | 237: P2 · PR · W1 | Fixed at code level; uncommitted (accepted provisionally) | §4; FU1 §5 to §5.10 | E2E-EMAIL "reset link opens the reset page" from a real e-mail (Phase 10 §8.3); merge |
| CF-048 | 200: P2 · CT · W1 | Fixed at code level; uncommitted | §5A | CT-6 host-side check (Phase 10 §4.6; Phase 11 G-6); a real Docker build-context check (§5A) |
| CF-035 | 187: P1 · PR · W1 | Fixed at code level; uncommitted | §5B | §8.2 recovery criterion "a new tenant's certificate is issued"; PV-01, PV-14 (§4.7); `/internal/*` restricted at the proxy (§5B) |
| CF-026 | 178: P1 · **RB** · W1 | Fixed at code level; uncommitted. **NOT cleared for release** | §5J, §5M | Real-browser popup and printing behaviour; visual A4 check; review and merge approval |
| CF-023 | 175: P1 · **RB** · W1 | Fixed at code level; uncommitted. **Closed at code level by owner decision (§5F.9); NOT cleared for release** | §5D to §5F.9, §5M | Rendered recipient-dialog test (§5F.9, §7 G-E); the real-DB send and RT6-M passed locally (§5M) |
| CF-025 | 177: P1 · **RB** · W1 | Fixed at code level; uncommitted (2026-10-19) | §5C, §5M | Cashier permissions (§5C) + POS payment-method error state with retry (§5N.13) |
| CF-022 | 174: P1 · **RB, CT** · W1 | Partially fixed; uncommitted | Fixed at code level; uncommitted | BullMQ worker run and "a re-run the next day sends again" verified on real Redis (§5N.16). CF-091 / CF-092 and RT-C3 / RT-HSEC05 done locally (§5M) |
| CF-040 | 192: P2 · FG · W6 | Fixed at code level; uncommitted (2026-10-19) | Row 10c, §5H, §5M; §5N | Lock renewal (RENEW script) + owner-safe release (§5N.3) |
| CF-135 | 287: P3 · POST · W12 | Partially fixed; uncommitted | §5I to §5I.8 | Real-browser check; PV-03; the service-worker cache key; the logs-channel residual assigned to CF-047 (`NODE_ENV` missing → development) |
| CF-043 | 195: P2 · PR · W1 | Fixed at code level; uncommitted | §5K.3, §5M | Observe a week before gating deploys (readiness 503 with dependencies paused verified locally, §5M) |
| CF-042 | 194: P2 · PR · W1 | Fixed at code level; uncommitted | §5K.1, §5K.3, §5M | PV-17 (RT6-M passed against a loopback mock, §5M) |
| CF-093 | 245: P3 · POST · W1 | Fixed at code level; uncommitted | §5K.3 | Merge |
| CF-041 | 193: P2 · POST · W1 | Fixed at code level; uncommitted (2026-10-19) | §1.2, §5K.3; §5N | Paymob and ETA submit bounded; ambiguous outcomes never retried (§5N.3, §5N.7) |
| CF-050 | 202: P2 · PR · W1 | Fixed at code level; uncommitted (2026-10-19) | §5K.3; §5N | Streamed Excel export of every row (§5N.4) |
| CF-033 | 185: P1 · PR · W1 | Partially fixed (configuration); uncommitted | §5K.1 | Production `TRUST_PROXY` value from PV-01; §8.2 criterion (line 965) on the real proxy |
| CF-091 | 243: P3 · POST · W1 | Fixed at code level; uncommitted | §5M | Merge; migration 018 (additive) is applied by the normal tenant migration run |
| CF-092 | 244: P3 · POST · W1 | Fixed at code level; uncommitted | §5K.1, §5M | Merge |
| CF-124 | 276: P3 · POST · W9 | Fixed at code level; uncommitted | §5K.1 | Merge |
| CF-126 | 278: P3 · POST · W9 | Fixed at code level; uncommitted | §5K.1 | PV-18 browser check of cookie clearing |
| CF-127 | 279: P3 · POST · W9 | Fixed at code level; uncommitted | §5K.1 | Merge |
| CF-128 | 280: P3 · POST · W9 | Fixed at code level; uncommitted | §5K.1 | Merge |
| CF-129 | 281: P3 · POST · W9 | Fixed at code level; uncommitted | §5K.1 | Merge (limit keyed by IP: depends on CF-033's value) |
| CF-131 | 283: P3 · POST · W9 | Fixed at code level; uncommitted | §5K.1 | Real-browser check of the admin reload → refresh path |
| CF-079 | 231: P2 · POST · W12 | Fixed at code level; uncommitted | §5K.1, §5M | Merge (real-schema import passed, §5M); owner to confirm the limits (§6) |
| CF-113 | 265: P3 · POST · W12 | Fixed at code level; uncommitted | §5K.1, §5M | Merge (the real-schema run found and fixed a `uuid = text` defect, §5M) |
| CF-140 | 292: P3 · POST · W12 | Fixed at code level; uncommitted | §5K.1 | Merge |
| CF-141 | 293: P3 · POST · W12 | Fixed at code level; uncommitted | §5K.1 | Merge |
| CF-142 | 294: P3 · POST · W12 | Fixed at code level; uncommitted | §5K.1 | Existing mixed-case master rows are not migrated (needs T-03) |
| CF-143 | 295: P3 · POST · W12 | Fixed at code level; uncommitted | §5K.1 | Merge |
| CF-144 | 296: P3 · POST · W2 | Fixed at code level; uncommitted | §5K.1 | Merge |
| CF-061 | 213: P2 · POST · W4 | Fixed at code level; uncommitted | §5K.1 | Merge with CF-062 (D-22) |
| CF-062 | 214: P2 · POST · W4 | Fixed at code level; uncommitted | §5K.1 | UI test "adding a discount lists it"; merge with CF-061 |
| CF-100 | 252: P3 · POST · W5 | Fixed at code level; uncommitted | §5K.1 | Merge |
| CF-021 | 173: P1 · **RB** · W3 | Fixed at code level; uncommitted (2026-10-19) | §5K.2; §5N | Credit adjust needs a financial permission (§5N.1) |
| CF-081 | 233: P2 · POST · W12 | Fixed at code level; uncommitted (2026-10-19) | §5K.2 | Sale invalidates every sales summary; EOD dated keys, staleTime 0, "as of" + refresh (§5N.13) |
| CF-116 | 268: P3 · POST · W12 | Fixed at code level; uncommitted (2026-10-19) | §5K.2; §5N | Admin delete deactivates; FK RESTRICT (master migration 20261019000000, §5N.8); real-DB w12 passed |
| CF-133 | 285: P3 · POST · W12 | Fixed at code level; uncommitted (2026-10-19) | §5K.2 | POS end-of-day print escaped (§5N.13); PV-14 (CSP inherited by popups) still to observe |
| CF-145 | 297: P3 · POST · W12 | Fixed at code level; uncommitted (2026-10-19) | §5K.2; §5N | UTC date fixed by CF-082; sequence gaps accepted (PostgreSQL sequences, §6) |
| CF-155 | 307: P3 · POST · W12 | Fixed at code level; uncommitted (2026-10-21) | §5K.2; §5N | List error states with retry; 44 mutation toasts carry the server message (guard test) (§5N.8, §5N.14) |
| CF-156 | 308: P3 · POST · W12 | Fixed at code level; uncommitted (2026-10-19) | §5K.2 | POS amounts via Money / one currency label; EOD totals 2 dp (§5N.13) |
| CF-157 | 309: P3 · POST · W12 | Fixed at code level; uncommitted (2026-10-19) | §5K.2 | Sticky mobile checkout bar (§5N.13); not re-measured in a real browser at 375 px |
| CF-160 | 312: P3 · POST · W12 | Fixed at code level; uncommitted (2026-10-21) | §5K.2 | jsx-a11y lint clean; no unnamed icon buttons (scan); POS / installment labels (§5N.13, §5N.14) |
| CF-011 | 163: P1 · **RB** · W5 | Fixed at code level; uncommitted. **NOT cleared for release** | §5L.2, §5M | Merge; `CHECK (credit_balance >= 0)` (DDL; conflicts with migration 016, §6). RT-A1 passed locally (§5M) |
| CF-012 | 164: P1 · **RB** · W5 | Fixed at code level; uncommitted. **NOT cleared for release** | §5L.2, §5M | Merge; `UNIQUE (contract_id, installment_number)` (DDL). RT-A2 passed locally (§5M) |
| CF-013 | 165: P1 · **RB** · W5 | Fixed at code level; uncommitted. **NOT cleared for release** | §5L.2, §5M | Merge. RT-A3 passed locally (§5M) |
| CF-014 | 166: P1 · **RB** · W5 | Fixed at code level; uncommitted. **NOT cleared for release** | §5L.2, §5M | Merge. RT-A4 passed locally (§5M) |
| CF-015 | 167: P1 · **RB** · W5 | Fixed at code level; uncommitted. **NOT cleared for release** | §5L.2, §5M | Merge; `CHECK (received_quantity <= quantity)` (DDL). RT-A5 passed locally (§5M) |
| CF-070, CF-071, CF-072, CF-073, CF-074, CF-075, CF-101 | 222–227, 253: P2/P3 · POST · W5 | Fixed at code level; uncommitted | §5L.2, §5M | Merge; `CHECK (paid_amount <= total_amount)` for CF-075 (DDL). Real-DB race tests passed locally (§5M) |
| CF-036, CF-063, CF-068 | 188, 215, 220: P2 · POST · W4 | Fixed at code level; uncommitted | §5L.3, §5M | Merge; CF-063 base confirmation (owner) |
| CF-104 | 256: P3 · POST · W5 | Fixed at code level; uncommitted | §5L.3 | Merge |
| CF-149, CF-165 | 301, 317: P3/Info · POST · W10 | Fixed at code level; uncommitted | §5L.4 | Merge |
| CF-064 | 216: P2 · POST · W5 | Fixed at code level; uncommitted (2026-10-19) | §5L.5; §5N | Allocation rows with per-allocation fees (migration 020) |
| CF-076 | 228: P2 · POST · W5 | Fixed at code level; uncommitted (2026-10-19) | §5L.5; §5N | Bounded deadlock/serialization retry on sale/return/cancel (§5N.8) |
| CF-083 | 235: P2 · POST · W6 | Fixed at code level; uncommitted (2026-10-19) | §5L.5; §5N | Period-ended-unpaid banner state (§5N.3) |
| CF-106 | 258: P3 · POST · W5 | Fixed at code level; uncommitted (2026-10-19) | §5L.5; §5N | Invoice only from ready/delivered (delegated decision, §6) (§5N.8) |
| CF-120 | 272: P3 · POST · W3 | Fixed at code level; uncommitted (2026-10-19) | §5L.5; §5N | Server permission model + Settings tabs (§5N.1) |

**Registry totals (167):**

| Status | Count | Findings |
|---|---|---|
| Not started (open) | 0 | |
| Partially fixed | 8 | CF-032, CF-033, CF-045, CF-057, CF-059, CF-135, CF-136, CF-151 |
| Fixed at code level, uncommitted | 156 | CF-001, CF-002, CF-003, CF-004, CF-005, CF-006, CF-007, CF-008, CF-009, CF-010, CF-011, CF-012, CF-013, CF-014, CF-015, CF-016, CF-017, CF-018, CF-019, CF-020, CF-021, CF-022, CF-023, CF-024, CF-025, CF-026, CF-027, CF-028, CF-029, CF-030, CF-031, CF-034, CF-035, CF-036, CF-037, CF-038, CF-039, CF-040, CF-041, CF-042, CF-043, CF-044, CF-046, CF-047, CF-048, CF-049, CF-050, CF-051, CF-052, CF-053, CF-054, CF-055, CF-056, CF-058, CF-060, CF-061, CF-062, CF-063, CF-064, CF-065, CF-066, CF-067, CF-068, CF-069, CF-070, CF-071, CF-072, CF-073, CF-074, CF-075, CF-076, CF-077, CF-078, CF-079, CF-080, CF-081, CF-082, CF-083, CF-084, CF-085, CF-086, CF-087, CF-088, CF-089, CF-090, CF-091, CF-092, CF-093, CF-094, CF-095, CF-096, CF-097, CF-098, CF-099, CF-100, CF-101, CF-102, CF-103, CF-104, CF-105, CF-106, CF-107, CF-108, CF-109, CF-110, CF-111, CF-112, CF-113, CF-114, CF-115, CF-116, CF-117, CF-118, CF-119, CF-120, CF-121, CF-122, CF-123, CF-124, CF-125, CF-126, CF-127, CF-128, CF-129, CF-130, CF-131, CF-132, CF-133, CF-134, CF-137, CF-138, CF-139, CF-140, CF-141, CF-142, CF-143, CF-144, CF-145, CF-146, CF-147, CF-148, CF-149, CF-150, CF-152, CF-153, CF-154, CF-155, CF-156, CF-157, CF-158, CF-159, CF-160, CF-161, CF-162, CF-163, CF-165 |
| No action required | 3 | CF-164, CF-166, CF-167 (Info; Phase 10 §7 "not scheduled, no action") |
| Blocked | 0 | |
| Deferred | 0 | |
| Merged | 0 | |
| Operationally verified | 0 | |

Check: 2 + 7 + 155 + 3 = 167 (reconciled 2026-10-21, §5N.16; the per-finding list is §8). Before: 2 / 8 / 154 after §5N.15; 8 / 11 / 142 (+2 blocked, 1 deferred) after §5N.14; 10 / 19 / 132 after the POS items; 13 / 27 / 121 after sessions 5–6; 95 / 21 / 45 after session 4 (2026-10-15).

**Release blockers: 26** (Phase 10 §4.5: 21 RB plus 5 conditional RB\*). **None is cleared** (§7).

### 1.2 CF-041 component map (one canonical finding; registry line 193: P2 · POST · W1)

| Part | Where tracked | Status | Blocker or dependency |
|---|---|---|---|
| Resend calls | Row 9 (with CF-042) | Fixed at code level (10 s bound; §5K.3) | — |
| ETA calls | Row 11; §6 | Token and status calls bounded (15 s; §5K.3). The `submitDocuments` timeout is blocked | CF-058 (W11), D-14 |
| Paymob calls | No W1 row; Phase 10 T-25 (W6) | Not started (by design) | T-22's `UNKNOWN` intent first (Phase 10 §6.4), D-14 |

This split does not change CF-041's canonical wave (W1) or its release class.

---

## 2. Pre-checks and baseline (2026-10-13)

| Check | Command | Result |
|---|---|---|
| `main` exists at the expected commit | `git rev-parse main` | `7317c975212d4c3d8f28c1e5b6816634e39a3b47`: **OK** |
| Worktree path unused | `test -e .claude/worktrees/w1-safety-net` | did not exist: **OK** |
| Branch unused | `git show-ref --verify refs/heads/claude/w1-safety-net` | did not exist: **OK** |
| Worktree folder git-ignored | `git check-ignore .claude/worktrees/w1-safety-net` | ignored: **OK** |
| Existing worktrees | `git worktree list` | 3 detached worktrees under `.claude/worktrees/`; **not touched** |
| User changes fingerprinted before any work | `git diff \| shasum -a 256`; `shasum documents/Hesba_Project_Overview.md` | `439b10007f77b183…`; `c45dd64cc9e53b0f…` |
| Worktree created | `git worktree add -b claude/w1-safety-net .claude/worktrees/w1-safety-net main` | created at `7317c97`, clean |
| Dependencies | `pnpm install --frozen-lockfile` | done; 856 packages reused from the local store, 0 downloaded |
| Prisma clients | `DATABASE_MASTER_URL=<dummy localhost URL> pnpm db:generate` | master and tenant clients generated (no database contacted) |
| **Baseline tests** (before any change) | `pnpm --filter @hesba/api test` | **10 files, 61 tests passed** |
| Baseline type-check | `pnpm --filter @hesba/api type-check` | no errors |
| Baseline lint | `pnpm --filter @hesba/api lint` | no findings |

---

## 3. CF-132: `POST /api/admin/run-migrations` hangs for every caller

### 3.1 Finding

| Field | Value |
|---|---|
| Canonical ID | CF-132 (P3, W1) |
| Original IDs | HSEC-16 (Phase 2), P-02 (Phase 1). The Phase 4 ID "P-02" is a different, unrelated item |
| Root cause | `admin.routes.ts:890` passed the guard **factory** `requireOwner` as a preHandler, instead of the hook returned by `requireOwner()`. Fastify called the factory as a hook; it returned a function rather than a promise and never called `done`. Every request, OWNER and ADMIN alike, hung until the socket timed out. The handler never ran (it failed closed) |
| Phase 10 acceptance | §8.4 regression guard; Phase 2 RT-13: "OWNER 200, ADMIN 403, completes within timeout" |

### 3.2 Change

| File | Change |
|---|---|
| `apps/api/src/modules/admin/admin.routes.ts` (line 890) | `preHandler: [requireOwner]` → `preHandler: [requireOwner()]`. This is the same form the other four OWNER-only routes in the file already use (lines 725, 740, 783, 829). One line |
| `apps/api/src/modules/admin/__tests__/run-migrations.guard.test.ts` (new, 90 lines) | Route test (see §3.3) |
| `apps/api/src/__tests__/route-guard-factories.test.ts` (new, 72 lines) | Class guard (see §3.3) |

No other file changed.

### 3.3 Regression tests

**`run-migrations.guard.test.ts`**
- Mounts the **real** `adminRoutes` with the **real** `requireOwner` in a fresh Fastify instance.
- Stubs only `@hesba/database` (`migrateAllTenants` becomes a spy), `config/database`, `config/redis`, and the platform-admin JWT check. The role is supplied through a test header.
- Each request runs inside a 1 s race, so a hang is reported as `'hung'`.
- No real service is contacted.

| Case | Expected |
|---|---|
| OWNER | 200, `{ success: true, data: … }`, migrations run **once** |
| ADMIN | 403 `owner_only`, migrations **not** run |
| Unauthenticated | 401, migrations **not** run |

**`route-guard-factories.test.ts`**
- Scans every `*.routes.ts` file and `index.ts` under `apps/api/src`.
- Fails if any `preHandler` passes `requireOwner`, `requirePermission`, `requireAnyPermission` or `requireUnderLimit` without calling it.
- Includes self-tests of the detector:
  - it flags `[requireOwner]`;
  - it accepts `[requireOwner()]` and `requirePermission('invoices','read')`.

### 3.4 Results (actually run; local worktree)

| Step | Command | Result |
|---|---|---|
| Red, before the fix: route test | `pnpm --filter @hesba/api exec vitest run src/modules/admin/__tests__/run-migrations.guard.test.ts` | **2 failed, 1 passed.** OWNER and ADMIN: `expected 'hung' not to be 'hung'`, which reproduces HSEC-16. Unauthenticated: 401 (passed) |
| Red, before the fix: class guard | `pnpm --filter @hesba/api exec vitest run src/__tests__/route-guard-factories.test.ts` | **1 failed, 2 passed.** Exactly one offender across all route files: `modules/admin/admin.routes.ts: requireOwner in [requireOwner]` |
| Green, after the fix: focused tests | both files above | **2 files, 6 tests passed** |
| Full API suite | `pnpm --filter @hesba/api test` | **exit 0: 12 files, 67 tests passed** (baseline 61 + 6 new) |
| Type-check | `pnpm --filter @hesba/api type-check` | **exit 0**, no errors |
| Lint | `pnpm --filter @hesba/api lint` | **exit 0**, no findings |
| Not run | `test:integration` (does not exist yet; not needed for CF-132); web tests (no web change) | — |

### 3.5 Diff review and preservation check

- **Worktree diff:** one modified tracked line (`admin.routes.ts:890`) plus two untracked test files. Nothing else. Generated Prisma clients and `node_modules` are git-ignored.
- **Main checkout after CF-132:**
  - `git status --porcelain` shows the same four entries as before:
    - ` M apps/web/src/components/layout/AppShell.tsx`
    - ` M apps/web/src/pages/pos/POS.tsx`
    - `?? documents/Hesba_Project_Overview.md`
    - `?? documents/audit/`
  - `git diff` fingerprint is unchanged (`439b10007f77b183…`).
  - `Hesba_Project_Overview.md` fingerprint is unchanged (`c45dd64cc9e53b0f…`).
  - Nothing is staged.
  - Branch and HEAD are unchanged (`claude/ui-pos-merge-split` @ `8846bce`).
- The other three worktrees are untouched.

### 3.6 Risk and behaviour change

- **Before:** the route hung for everyone.
- **After:** OWNER can run pending tenant migrations on demand (the documented intent); ADMIN gets 403.
- No effect on money, tenant data or isolation.
- In a future production, an OWNER call runs `migrateAllTenants()`. That is the same idempotent runner used at boot, with the CF-045 / CF-053 caveats Phase 10 already records.

### 3.7 Blockers

None for CF-132.

---

## 4. CF-085: e-mailed reset and trial-checkout links land on no route

### 4.1 Finding

| Field | Value |
|---|---|
| Canonical ID | CF-085 (P2, W1) |
| Original IDs | HSEC-15 (Phase 2), AU-11 (Phase 1); also cited by INT-07 (Phase 6) |
| Root cause | The reset e-mail linked to `/reset?token=…` (`email.ts:316`), and the trial e-mails linked to `/billing/checkout` (`trial-expiry.job.ts:55`). The SPA (`apps/web/src/App.tsx`) defines `/reset-password` and has no `/billing/*` route. Both links fell through to the `*` catch-all, which redirects to `/`, so password reset by e-mail was impossible and the token was dropped |
| Acceptance | Phase 2 RT-16: "emailed URL matches a router route and reaches the reset API" |

### 4.2 Pre-check

| Check | Result |
|---|---|
| Worktree branch | `claude/w1-safety-net` |
| CF-132 diff before starting | Unchanged: `admin.routes.ts:890` only, plus its two test files |
| Main checkout before starting | Same four status entries; `git diff` fingerprint `439b10007f77b183…` |

### 4.3 Change

| File | Change |
|---|---|
| `apps/api/src/shared/utils/email.ts` | New exported pure function `buildPasswordResetUrl(rawToken, subdomain?)`, used by `sendPasswordResetEmail`. The path is now **`/reset-password`**. Query values are built with `URLSearchParams` (no behaviour change for the hex token). **`subdomain` is added when known** — see the note below |
| `apps/api/src/jobs/trial-expiry.job.ts` | `checkoutUrlFor` is now exported (for the test) and returns **`/settings?tab=billing`**. That is the Settings billing tab, a valid tab id, and the same page Paymob's return URL already uses (`billing.service.ts:87`) |
| `apps/api/src/shared/utils/__tests__/email-links.test.ts` (new) | Regression test (see §4.4) |

**Note on `subdomain`.** `ResetPassword.tsx:31-43` reads both `token` and `subdomain` from the query and sends `subdomain` as `X-Tenant-Subdomain`.
- On a tenant's own host (`https://<sub>.<base>`) the host already identifies the store, so the parameter is redundant there.
- In the `FRONTEND_URL` fallback (no `APP_BASE_DOMAIN`), the link reaches the reset API only if it carries `subdomain`.

The link still has the requested form `/reset-password?token=…`; `subdomain` is an additional parameter the page already expects.

**Not changed (still open, belongs to CF-023 / AU-10).** In development with no `RESEND_API_KEY`, `sendPasswordResetEmail` still `console.log`s the reset URL, including the token. Removing that is part of CF-023 and was deliberately left for that task.

### 4.4 Regression test (`email-links.test.ts`)

**Ground truth.** The test reads the real web sources from disk:
- `<Route path="…">` entries in `App.tsx`;
- tab ids in `Settings.tsx`;
- `ResetPassword.tsx`.

**Route matching.** A path counts only if it matches an explicit route; the `*` catch-all never counts.

**Fixture checks**
- `/reset-password`, `/settings/*`, `*` and the `billing` tab are parsed.
- The reset page reads `token` and `subdomain`.
- The **pre-fix paths `/reset` and `/billing/checkout` match no route.** This is the regression evidence: the old links fail the same check the new ones pass.

**Run twice:** once with `APP_BASE_DOMAIN` set (tenant host `https://shop1.hesba.test`) and once unset (`FRONTEND_URL` fallback).
- Reset link: path `/reset-password` (matches a route), token present, `subdomain` present when given and absent when not.
- Trial link: path `/settings` (matches `/settings/*`), `tab=billing`, and `billing` is a real Settings tab.

**Token safety**
- The token is a dummy, hex-shaped value.
- Token checks are **boolean comparisons**, so a failure prints `true`/`false`, never the value.
- After the runs, a grep of the complete test output for the dummy token found **0** occurrences.

### 4.5 Results (actually run; local worktree)

| Step | Command | Result |
|---|---|---|
| Focused test | `pnpm --filter @hesba/api exec vitest run src/shared/utils/__tests__/email-links.test.ts` | **exit 0: 1 file, 9 tests passed**; dummy token in output: **0** |
| Full API suite | `pnpm --filter @hesba/api test` | **exit 0: 13 files, 76 tests passed** (CF-132 total 67 + 9 new); dummy token in output: **0** |
| Type-check | `pnpm --filter @hesba/api type-check` | **exit 0**, no errors |
| Lint | `pnpm --filter @hesba/api lint` | **exit 0**, no findings |
| Web checks | — | **Not run. No web file was changed**; the web sources were only read by the test |

**How the regression was demonstrated.** The code was not temporarily reverted. Instead, the test asserts that the pre-fix paths (`/reset`, `/billing/checkout`) fail the route check that the new paths pass. The pre-fix functions did not exist as exports, so running the new test against the old code would only have failed on import.

### 4.6 Diff review and preservation check

- **Worktree tracked diff** (3 files, +21 / −6):
  - `admin.routes.ts`: the CF-132 line, unchanged since CF-132;
  - `email.ts`;
  - `trial-expiry.job.ts`.
- **Untracked:** the three test files (two from CF-132, one from CF-085).
- **No stale link strings remain.** A search of `apps/api/src` for the old link paths finds only:
  - a code comment;
  - the API's own `POST /api/billing/checkout` endpoint (`billing.routes.ts:65`), which is correct and not an e-mail link.
- **Main checkout after CF-085:**
  - `git status --porcelain` shows the same four entries;
  - `git diff` fingerprint `439b10007f77b183…` (unchanged);
  - `Hesba_Project_Overview.md` fingerprint `c45dd64cc9e53b0f…` (unchanged);
  - nothing staged;
  - branch `claude/ui-pos-merge-split`.

### 4.7 Risk and behaviour change

- Users who click the reset e-mail now reach the reset page with the token.
- Trial e-mail readers reach Settings → Billing.
  - That page requires `settings:read`. Trial e-mails go to the tenant owner (`super_admin`, who has it), but any other role would see the app's "forbidden" view rather than the landing page.
- No effect on money, tenant data or isolation.
- Tokens are not newly exposed. The URL holds the same token as before, and the existing dev-only log is unchanged and tracked under CF-023.

### 4.8 Blockers

None for CF-085.

### 4.9 Focused review addendum (2026-10-13, requested before CF-048)

This addendum supersedes the test description in §4.4 and the test counts in §4.5. The production code from §4.3 is **unchanged** by the review.

**Review findings**

| # | Check | Result |
|---|---|---|
| R1 | Token and `subdomain` encoding vs `ResetPassword.tsx` | **OK.** `buildPasswordResetUrl` encodes both values with `URLSearchParams`. The page reads them with `useSearchParams().get('token' / 'subdomain')`, which decodes, so they round-trip. The page needs only `token` (without it, it shows "invalid link") and optionally `subdomain` (sent as `X-Tenant-Subdomain`). The link carries exactly those keys; `subdomain` only when known |
| R2 | Did the tests genuinely validate routes and the Settings tab? | **Weakness found and fixed (test-only).** Three problems:<br>• routes were matched by a hand-written matcher, not react-router;<br>• tab ids were collected file-wide from any `{ id: '…' }`;<br>• the `tab` key and the `billing` render branch were not checked |
| R3 | Post-login redirect for the trial link | **Pre-existing web issue; not fixed (outside this review's mandate; awaiting your decision).** See below |
| R4 | `GuestGuard` on `/reset-password` | **Pre-existing; observation only.** See below |
| R5 | CF-132 change and the main checkout | Untouched (see "Preservation") |

**R3 in detail.** When the trial link reaches a logged-out owner, `AuthGuard` (`AuthGuard.tsx:10-12`) redirects to `/login` with `state.from`. But `Login.tsx:28` keeps only `from.pathname`, and line 87 navigates to it. After login the owner lands on `/settings` **without `?tab=billing`**, which is the store tab. The e-mail link itself is correct and resolves to `/settings/*`.

Proposed fix, not applied:
- keep `from.search` in `Login.tsx`;
- a web test for it needs the approved web test runner (vitest and Testing Library in `apps/web`).

The same limitation affects every deep link with a query string that hits the login wall, not only this e-mail.

**R4 in detail.** `GuestGuard` (`AuthGuard.tsx:17-24`) redirects a **logged-in** user to `/pos`. A user who opens a reset link in a browser that already holds a session is sent to the POS, and the token is dropped. This is rare (users who can log in seldom reset) and not a CF-085 regression, so no change was made.

**Test fix (R2), applied to `apps/api/src/shared/utils/__tests__/email-links.test.ts` only**

- **Route matching** now uses **react-router's real `matchRoutes`** (`@remix-run/router` 1.23.2, resolved through the web app's installed `react-router-dom` 6.30.3). It is fed with the `<Route path>` list parsed from `App.tsx`. Each test asserts which route react-router would render:
  - `/reset-password` for the reset link;
  - `/settings/*` for the trial link;
  - `*` (the catch-all) for the pre-fix `/reset` and `/billing/checkout`.
- **Settings tab**
  - Ids are parsed only from the `const tabs = [...]` literal, and must be unique.
  - The query key is taken from Settings' own `searchParams.get('…')` call (`tab`), not hard-coded.
  - The test asserts the source's selection rule: `validTabIds` is built from `tabs`; an unknown tab falls back to `store`; `tab === 'billing' && <BillingSettings />`.
- **Reset page keys** are taken from `ResetPassword.tsx`'s own `params.get('…')` calls. The link must carry **exactly** those keys (`subdomain`, `token`), or only `token` when no subdomain is given.
- **New encoding round-trip test:** a value containing `+ & = / ? #` and a space must decode back exactly from both the token and the subdomain.
- **Token safety:** comparisons stay boolean.
- **Remaining limit (stated, not hidden).** The Settings checks read the page source; they don't render it. A rendered check needs the web test runner.

**Mutation check.** This is proof the tests fail for the right reasons. Each mutation was applied temporarily to the worktree source, run, then restored. The `git diff` fingerprint was `0c2f7cbe7507033e…` before and after, so the restore was byte-identical.

| Mutation | Result |
|---|---|
| M1: reset path back to `/reset` | **6 failed** / 5 passed |
| M2: trial link back to `/billing/checkout` | **2 failed** / 9 passed (both host variants) |
| M3: raw string concatenation instead of `URLSearchParams` | **2 failed** / 9 passed: exactly the encoding round-trip test, in both host variants. A first attempt via `sed` could not be confirmed as applied; it was redone with a checked replacement, which was verified as applied before the run |
| M4: wrong query key (`?section=billing`) | **2 failed** / 9 passed |

The dummy token appeared **0** times in every mutation run's output.

**Results after the review (actually run)**

| Step | Command | Result |
|---|---|---|
| Focused | `pnpm --filter @hesba/api exec vitest run src/shared/utils/__tests__/email-links.test.ts` | **exit 0: 11 passed**; token printed 0 |
| Full API suite | `pnpm --filter @hesba/api test` | **exit 0: 13 files, 78 tests passed** (76 + 2 net new CF-085 cases); token printed 0 |
| Type-check | `pnpm --filter @hesba/api type-check` | **exit 0** |
| Lint | `pnpm --filter @hesba/api lint` | **exit 0** |
| Web checks | — | not run: no web file changed |

**Preservation**

- **Worktree tracked diff unchanged by the review:** 3 files, +21 / −6. The CF-132 line (`[requireOwner]` → `[requireOwner()]`) is intact.
- **Untracked:** the same three test files. Only `email-links.test.ts` changed in the review.
- **A temporary probe test** (`apps/api/src/__probe_router.test.ts`, used to confirm the router import works) was created and **deleted**.
- **Main checkout:**
  - same four status entries;
  - `git diff` fingerprint `439b10007f77b183…`;
  - `Hesba_Project_Overview.md` fingerprint `c45dd64cc9e53b0f…`;
  - 0 staged files;
  - `claude/ui-pos-merge-split` @ `8846bce`.
- **Report files:** all Phase 1–11 reports and the overview have modification times from before W1 began (latest: Phase 11 at 12:47 local). Only this tracking report changed since.

---

## 5. CF-085-FU1: login drops the deep link's query string (follow-up to CF-085)

### 5.1 Scope and root cause

| Field | Value |
|---|---|
| ID | **CF-085-FU1**: a clearly labelled follow-up, approved separately. Not a Phase 10 canonical finding |
| Origin | CF-085 review finding R3 (§4.9) |
| Goal | `/settings?tab=billing` (the trial e-mail link) must reopen the Billing tab after a successful login. The redirect must stay restricted to valid in-app destinations |
| Root cause | `AuthGuard` (`AuthGuard.tsx:10-12`) already stores the full router location (path, query and hash) in `state.from`. `Login.tsx:28` read only `from.pathname`, so the query was lost. It also accepted any `pathname` value as the destination, unchecked |
| Out of scope (unchanged) | The `GuestGuard` reset-link redirect (R4): kept open, as instructed. The bare-domain `#s=` session hand-off branch of `Login.tsx`. `AuthGuard`, `App.tsx`, `Settings.tsx`, `ResetPassword.tsx` |

### 5.2 Changes (W1 worktree)

| File | Change |
|---|---|
| `apps/web/src/lib/redirect.ts` (new, 43 lines) | `postLoginPath(from)`. It returns `pathname + search` for a plain in-app path, else `null` (meaning "use the existing default landing"). Rules:<br>• must be a string path starting with a single `/`;<br>• rejects `//host`, `/\host`, absolute URLs and `javascript:`;<br>• rejects control characters;<br>• `search` must be empty or start with `?`;<br>• resolves with `new URL()` and requires the same origin, so dot-segments are normalised (e.g. `/settings/../admin` → `/admin`, which is then rejected);<br>• excludes `/login`, `/register`, `/forgot-password`, `/reset-password` and `/admin` (including sub-paths, exact-prefix only);<br>• **drops the hash**, so a `#s=` session hand-off payload is never replayed |
| `apps/web/src/pages/auth/Login.tsx` (+5 / −2) | `requestedFrom = postLoginPath(state.from) ?? undefined`. Everything else is unchanged, including `navigate(requestedFrom ?? landingFor(user))`, the onboarding rule, and the bare-domain hand-off |
| `apps/web/package.json` | `"test": "vitest run"`. devDependencies, exact versions: `vitest` 1.6.1 (the API's version), `jsdom` 24.1.3, `@testing-library/react` 16.0.1, `@testing-library/dom` 10.4.0 |
| `pnpm-lock.yaml` (+472 / −6) | Adds those packages. The 6 removed lines only **re-key** the API's existing `vitest@1.6.1` / `@vitest/coverage-v8@1.6.1` entries with the new optional `jsdom` peer. **No existing package version changed** |
| `apps/web/vitest.config.ts`, `apps/web/vitest.setup.ts` (new) | Reuse the app's Vite config (React plugin, `@` alias); jsdom environment; Testing Library cleanup after each test |
| `apps/web/src/lib/__tests__/redirect.test.ts` (new, 25 tests) | Sanitizer unit tests (see §5.3) |
| `apps/web/src/pages/auth/__tests__/login-redirect.test.tsx` (new, 8 tests) | Rendered flow test (see §5.3) |

**Package download (approved by the user for this task).** An offline install from the local pnpm store was tried first and failed with `ERR_PNPM_NO_OFFLINE_META`; nothing was changed by that attempt. With approval, the four dev dependencies were then fetched from `registry.npmjs.org` (`pnpm --filter @hesba/web add -D -E …`). No other network access was used.

### 5.3 Regression tests

**`redirect.test.ts` (unit)**
- Accepted, with the expected result:
  - `/settings?tab=billing`;
  - `/invoices` (with and without `search`);
  - a query with `&`;
  - a full react-router `Location` object (hash dropped).
- Rejected (19 cases):
  - no / null / string state;
  - missing or non-string `pathname`;
  - `//evil.example`, `/\evil.example`, `https://…`, `javascript:`;
  - a `search` not starting with `?`;
  - newline and tab characters;
  - `/login`, `/register`, `/forgot-password`, `/reset-password?token=x`, `/admin`, `/admin/tenants`;
  - `/settings/../admin`.
- Lookalike prefixes are **not** over-blocked (`/administration-notes`, `/login-help`).

**`login-redirect.test.tsx` (rendered flow)**

What is real and what is stubbed:
- **Real:** `MemoryRouter`, `AuthGuard`, `GuestGuard`, `RoleGuard`, the `Login` page (form, validation, mutation, `setAuth`) and the `Settings` page.
- **Stubbed:** only `@/api/client` (`post` resolves a login; `get` stays pending), `AppShell` (layout chrome) and analytics. No request leaves the test.

The route mirror is checked against `App.tsx`: the exact `/login` and `/settings/*` route lines must exist there.

| Case | Asserts |
|---|---|
| **Deep link** | Logged-out visit to `/settings?tab=billing`:<br>1. location becomes `/login`, the login form is shown, and no settings request was made;<br>2. submitting the real form posts `/auth/login` with the subdomain header;<br>3. location is restored to **`/settings?tab=billing`**, and the **Billing section mounted**: `/billing/status` was requested and `/settings` was not. Within Settings, only `BillingSettings` requests `/billing/status` (`Settings.tsx:346`); `StoreSettings` requests `/settings` |
| Existing behaviour: path-only deep link | `/invoices` → login → `/invoices` |
| Existing behaviour: direct login, onboarded cashier | → `/pos` (role landing) |
| Existing behaviour: first-ever login | → `/settings`, Store section (`/settings` requested, `/billing/status` not) |
| Forged saved destination | `//evil.example/settings?tab=billing`, `/admin` and `/login` are each ignored → `/pos` |

**Mutation check** (temporarily applied, run, then restored; `git diff` fingerprint `8f474372acbdf136…` identical before and after):

| Mutation | Failing tests |
|---|---|
| M1: the original pathname-only line put back | **3 failed:** the Billing deep-link test, plus the protocol-relative and `/admin` forged-destination tests. The old code would navigate to those |
| M2: path + query, but no sanitizer | **2 failed:** the protocol-relative and `/admin` forged-destination tests |

The forged-`/login` case passes in both mutations, because `GuestGuard` already bounces a logged-in user from `/login` to `/pos`. It is kept as behaviour documentation.

### 5.4 Results (actually run; local worktree)

| Check | Command | Result |
|---|---|---|
| Web tests | `pnpm --filter @hesba/web test` | **exit 0: 2 files, 33 tests passed.** stderr has only React Router's standard v7 future-flag notices (`v7_startTransition`, `v7_relativeSplatPath`), which are informational |
| Web type-check | `pnpm --filter @hesba/web type-check` | **exit 0** (the first run found 4 strict-typing errors in the new test file; they were fixed, then re-run) |
| Web lint (touched files) | `eslint` on `redirect.ts`, `Login.tsx` and both new test files | **exit 0, no findings** |
| Web lint (full) | `pnpm --filter @hesba/web lint` | **exit 0: 0 errors, 55 warnings.** These are pre-existing: the same count as the recorded 55 a11y/style warnings, and none in touched files |
| Web build | `pnpm --filter @hesba/web build` (`tsc -b && vite build`) | **exit 0**, built in 3.00 s. `dist/` and `*.tsbuildinfo` are git-ignored |
| API tests (lockfile re-keyed vitest) | `pnpm --filter @hesba/api test` | **exit 0: 78 passed** (unchanged) |
| API type-check / lint | `pnpm --filter @hesba/api type-check` / `lint` | **exit 0 / exit 0** |
| Not run | the API integration suite (not created yet); Playwright / real-browser end-to-end tests (not in the repository) | — |

An earlier attempt to run all checks in one shell loop reported exit 1 for every command. That was a zsh word-splitting error in the loop itself, not a code failure; every command was re-run individually, with the results above.

### 5.5 Diff review and preservation

- **Worktree.** The API diff is unchanged at +21 / −6: the CF-132 line plus the CF-085 changes. FU1 adds only:
  - `Login.tsx`;
  - `apps/web/package.json`;
  - `pnpm-lock.yaml`;
  - 7 new web files (listed above).
- **Verified unchanged (`git diff --quiet`):**
  - `AuthGuard.tsx`, `ResetPassword.tsx`, `App.tsx`, `Settings.tsx`;
  - `POS.tsx`, `AppShell.tsx`;
  - `docker-compose.prod.yml`.
- **Main checkout:**
  - same four status entries;
  - `git diff` fingerprint `439b10007f77b183…`;
  - `Hesba_Project_Overview.md` fingerprint `c45dd64cc9e53b0f…`;
  - 0 staged;
  - `claude/ui-pos-merge-split` @ `8846bce`;
  - its `pnpm-lock.yaml` and `apps/web/package.json` untouched.
- **Scratch files:**
  - manifest backups and mutation copies in the session scratchpad were removed;
  - temporary logs in `/tmp` were deleted.

### 5.6 Risk and behaviour change

- **New behaviour.** A logged-out user following any in-app deep link returns to the full path **and query** after login.
- **Only previous behaviour that changes.** A saved destination that is not a plain in-app path, or that points at an auth or admin page, now falls back to the role landing page. Previously it was navigated to as-is. In normal use `AuthGuard` only ever saves app routes, so this tightens behaviour against forged history state.
- No effect on the API, money, tenant data or isolation.

### 5.7 Security review of the post-login redirect sanitizer (2026-10-13)

**Scope:** `apps/web/src/lib/redirect.ts` and its tests, checked against how the installed React Router (6.30.3 / `@remix-run/router` 1.23.2) and the WHATWG URL parser actually behave. Also the web Vitest setup and the dependency and lockfile changes.

**Outcome: two concrete defects found and fixed in `redirect.ts`.** No other file's behaviour changed.

| # | Defect | Evidence | Impact before the fix | Fix |
|---|---|---|---|---|
| **S1** | **The restricted-page exclusion could be bypassed by changing letter case or percent-encoding.** React Router matches routes case-insensitively (`compilePath`: `caseSensitive` defaults to false, so the regex gets the `i` flag), and it matches on per-segment `decodeURIComponent`-decoded paths (`decodePath`). `App.tsx` sets no `caseSensitive`. The sanitizer compared the raw, case-sensitive path | Inputs `/ADMIN`, `/Admin/Tenants`, `/LOGIN`, `/Reset-Password`, `/%61dmin`, `/%4Cogin`, `/%61dmin/tenants` and `/%41DMIN/plans` were **accepted**, yet the real router renders a restricted route for each. The test asserts that precondition | In-app only: the user landed on an auth or admin page instead of their role landing page. No other origin was reached and no privilege was gained (admin has its own login), but it breached the "restricted destinations" rule | The exclusion check, and a second control-character check, now run on the path **as the router matches it**: each segment percent-decoded, then lower-cased. A path that cannot be decoded returns `null` |
| **S2** | **Dot-segments could normalise into a protocol-relative path.** The WHATWG URL parser resolves `/.//evil.example`, `/x/..//evil.example`, `/..//evil.example`, `/%2e//evil.example` and `/.%2e//evil.example` to pathname **`//evil.example`** while `url.origin` stays internal, so the origin check passed. Probe output: `postLoginPath(...)` returned `"//evil.example?tab=billing"` for all five | `@remix-run/router` `createBrowserHistory`: `push()` catches a failed `pushState` and falls back to **`window.location.assign(url)`**. `replace()` has no fallback | `Login.tsx` navigates with `replace: true`, so a forged history state would have made `replaceState` throw a SecurityError, not leave the site. But the sanitizer's contract was broken, and any `push` navigation would have become an **open redirect** | `if (url.pathname.startsWith('//')) return null` after URL resolution |

**What was reviewed and found sound (no change)**
- Leading `//` and `/\`, absolute URLs and `javascript:` are rejected before parsing.
- Raw tab, newline and other C0/DEL characters are rejected. This matters because WHATWG URL strips tab and newline, so the check must happen before parsing; it does.
- `search` must be empty or start with `?`.
- The hash is dropped, so a `#s=` session payload is never replayed.
- Encoded separators (`%2F`, `%5C`) stay percent-encoded in the returned path and are same-origin. React Router re-encodes `/` inside decoded segments, so they can't create new path segments either.
- Lookalike prefixes are not over-blocked (`/login-help`, `/administration-notes`).
- Non-ASCII lookalikes (full-width letters, the Kelvin sign) cannot match the ASCII route patterns under the router's non-Unicode `i` regex. The hostile-corpus test checks this against the real router.
- The output is the parser's normalised `pathname + search`, which is exactly what `navigate()` receives.

**Regression tests added** (`redirect.test.ts`: 25 → 46 tests; `login-redirect.test.tsx`: 8 → 9 tests)

- **S1:** eight router-equivalent spellings. Each first asserts that the real `matchRoutes` (over the `App.tsx` route table) renders a restricted route, then that `postLoginPath` returns `null`. Plus: malformed `%E0%A4%A`, encoded `%0a`, encoded `%00` → `null`.
- **S2:** five dot-segment inputs. Each first asserts that the URL parser produces `//evil.example` with an internal origin, then `null`. The "encoded separators" invariant and the hostile corpus now also require every accepted result to start with a single `/` and resolve to the internal origin.
- **Hostile corpus (17 inputs)** with the real router: every accepted destination must render a non-restricted route.
- **Rendered flow:** a forged saved destination `/.//evil.example?tab=billing` now lands on `/pos`.
- **Kept:** `/settings?tab=billing` is preserved exactly and resolves to `/settings/*`.

**Mutation check** (each fix removed temporarily, the full web suite run, then restored; `redirect.ts` checksum `4c806b8ffa7c645d…` identical before and after)

| Mutation | Result |
|---|---|
| Without the S2 `//` check | **8 failed** / 47: the five dot-segment cases, the separator invariant, the hostile corpus, and the rendered-flow forged destination. Under MemoryRouter the app actually navigated to `//evil.example` |
| With the pre-review raw-path exclusions (S1 reverted) | **9 failed** / 46: all eight case and encoding spellings, plus the hostile corpus |

**Red before the fix (actually run).** The first run of the new S1 tests had **12 failed / 29 passed**. The S2 probe showed `//evil.example?tab=billing` for all five inputs. The probe file was removed.

**Workspace compatibility (item 3)**

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile --offline` | **exit 0**, changed nothing. The lockfile is self-consistent; no network and no re-resolution |
| Lockfile `packages` vs `main` | **0 removed**, 45 added (`main` 931 → 976) |
| Lockfile `snapshots` vs `main` | **0** existing entries with changed dependencies. The only "removed" keys are the API's `vitest@1.6.1` and `@vitest/coverage-v8@1.6.1`, re-keyed with the optional `jsdom` peer (same versions). The first comparison script mis-parsed single-line `{}` entries and showed false changes; it was corrected and re-run |
| Additional side-by-side versions (pulled in by `@testing-library/dom` / `jsdom`; existing consumers unchanged) | `aria-query`, `entities`, `pretty-format`, `react-is`, `saxes` |
| Vitest and Vite | web `vitest@1.6.1` uses `vite@5.4.21`, the same Vite the web app uses; the same vitest version as `apps/api` |
| Declarations | `apps/web` devDependencies only, exact pins; `"test": "vitest run"`. `vitest.config.ts` merges the existing `vite.config.ts` (unchanged). CI (`ci.yml`) is not changed, so web tests are not yet run in CI |

**Results after the fixes (actually run; worktree)**

| Check | Result |
|---|---|
| `pnpm --filter @hesba/web test` | **exit 0: 55 passed** (2 files) |
| `pnpm --filter @hesba/web type-check` | **exit 0** |
| `eslint` on the touched web files | **exit 0**, no output |
| `pnpm --filter @hesba/web lint` | **exit 0: 0 errors, 55 warnings** (pre-existing, unchanged) |
| `pnpm --filter @hesba/web build` | **exit 0** |
| `pnpm --filter @hesba/api test` / `type-check` / `lint` | **exit 0: 78 passed** / **exit 0** / **exit 0** |

**Integrity**
- **CF-132:** the `admin.routes.ts:890` line is unchanged.
- **CF-085:** the API diff is unchanged at +21 / −6; `/reset-password?` and `/settings?tab=billing` are present.
- **FU1:** `Login.tsx` is unchanged by this review.
- **Verified unchanged:** `AuthGuard.tsx`, `ResetPassword.tsx`, `App.tsx`, `Settings.tsx`, `POS.tsx`, `AppShell.tsx`, `vite.config.ts`, `docker-compose.prod.yml`.
- **Main checkout:**
  - same four entries;
  - `git diff` fingerprint `439b10007f77b183…`;
  - overview `c45dd64cc9e53b0f…`;
  - 0 staged;
  - `claude/ui-pos-merge-split` @ `8846bce`;
  - its lockfile and web `package.json` untouched.
- **Scratch files:** the scratchpad is empty and the temporary logs are deleted.

### 5.8 Production-router defect: every login landed on `/pos` (found in §5I.8 D; fixed 2026-10-14)

**Scope (approved):** reproduce under the exact `main.tsx` router configuration, trace the cause, apply the smallest reliable fix, and add production-router tests. The CF-135 implementation and tests are not modified.

**Pre-checks: all matched.**
- Worktree: tracked `ef42d071b5e4ddf5…`, untracked `a8421c0bad0a4e73…`, 0 staged.
- Main checkout: diff `439b10007f77b183…`, overview `c45dd64cc9e53b0f…`.
- This report: `ba347db1bc59b936…`.

**Reproduction.** Real `App` in `<BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>`, as in `main.tsx`; a static test asserts the flags match. **14 of 19** new tests failed, and every login ended on `/pos`:
- the saved deep link (`/settings?tab=billing`, `/invoices?from=…&to=…`);
- the role landing page (an accountant's `/reports`);
- first-login onboarding (`/settings`);
- every forged-destination fallback.

**The defect is wider than first reported in §5I.8 D:** it also discarded the role landing page and onboarding, not only deep links.

**Root cause (demonstrated, not assumed).** A temporary probe (deleted after the run) recorded history writes and render order during login:

| Router | History writes | Render order |
|---|---|---|
| `v7_startTransition: true` | `["/settings?tab=billing", "/pos"]`, final `/pos` | Store update at `/login`, then the next renders are already `/pos`. `/settings` never rendered |
| `v7_startTransition: false` | `["/settings?tab=billing"]`, final `/settings?tab=billing` | Store update and navigation commit together, rendering `/settings` |

**Mechanism:**
- `Login.onSuccess` calls `setAuth()` and then `navigate(requestedFrom ?? landingFor(user), { replace: true })`.
- With `v7_startTransition`, React Router writes history immediately but applies its location update **inside a transition**.
- The auth store is zustand (`useSyncExternalStore`), whose updates are always synchronous. So `GuestGuard` re-renders first with `user` set while the router location is still `/login`.
- It then renders `<Navigate to="/pos" replace />`, which supersedes the pending navigation.
- `GuestGuard` is the only code that navigates to `/pos` (repository grep).
- Reordering `Login`, or wrapping `setAuth` in a transition, would not help, because the store update stays urgent.

**Fix (`apps/web/src/components/guards/AuthGuard.tsx`, +8 / −2).**
- `GuestGuard` now records whether a user was signed in **when the guest page opened** (`useState` initialiser) and redirects only in that case.
- When the user signs in **on** the page, `Login` is the single navigator, to the sanitized `postLoginPath(state.from)` or the role landing page.
- **Unchanged:**
  - a user who is already signed in and opens `/login`, `/register` or `/forgot-password` is still sent to `/pos`;
  - the persisted session is hydrated synchronously from `localStorage` (zustand 5.0.13 `persist`: `hydrate()` at store creation, synchronous thenables for sync storage; `middleware.mjs:305,332,469-470`), so it is present on the guard's first render.
  - `postLoginPath` (the sanitizer), `Login.tsx`, `redirect.ts` and `App.tsx` are not changed.
- **Side benefit:** in the cross-domain `#s=` login branch, the guard no longer flashes `/pos` while the browser leaves for the tenant subdomain.

**Tests.**
- **New `src/pages/auth/__tests__/login-redirect.production-router.test.tsx` (19 tests; 188 lines).** Real `App` with the production `BrowserRouter` flags; HTTP client and AppShell chrome stubbed; every history write recorded.

  | Case | Expected |
  |---|---|
  | Flags | Match `main.tsx` |
  | Logged-out `/settings?tab=billing` → `/login` → login | Billing tab (`/billing/status` requested); **no write of `/pos`** |
  | Logged-out `/invoices?from=2026-01-01&to=2026-01-31` | Query preserved |
  | Forbidden saved destination (cashier → `/settings?tab=billing`) | That page with the guard's "صلاحية غير كافية" (insufficient permission) view; unchanged FU1 design |
  | Normal login: onboarded cashier | `/pos` |
  | Normal login: onboarded accountant | `/reports` |
  | Normal login: first-ever login | `/settings` (Store tab) |
  | 9 unsafe saved destinations | Role landing `/reports`, same origin, every history write a single-slash path |
  | Already signed in on `/login`, `/register`, `/forgot-password` | `/pos` |

  The 9 unsafe destinations are: protocol-relative, a dot-segment that normalises to protocol-relative, a backslash host, an absolute URL, `javascript:`, a malformed query, a control character, `/admin`, and `/LOGIN`.
- **Updated `src/pages/auth/__tests__/login-redirect.test.tsx`** (the original FU1 suite, 9 tests): its `MemoryRouter` now uses the production future flags (+2 lines). Without them it had masked this defect.
- **Red:** 14 failed / 5 passed. **Green:** 28 passed (both files).

**Mutation tests** (restores checksum-verified, `2f6e64c756a2839e…`):

| Mutation | Failed |
|---|---|
| Fix reverted | **17**, including 3 in the updated original suite |
| Guard never redirects | **3** (the signed-in cases) |
| `Login` ignores the saved destination | **5** |
| Sanitizer bypassed | **13** (every unsafe-destination case, in both files) |

| Check | Command | Result |
|---|---|---|
| Web suite | `pnpm --filter @hesba/web test` | **exit 0: 11 files, 118 passed** (99 + 19) |
| Web type-check | `pnpm type-check` (in `apps/web`) | **exit 0.** The first run failed with exit 2 on the new test's `history` spy signature (`url` must be optional); fixed, then rerun |
| Web lint | `pnpm lint` | **exit 0** (the same 55 pre-existing warnings; 0 in touched files) |
| Web build | `pnpm build` | **exit 0.** The first run failed with exit 1 on the same type error, since the build runs `tsc` |
| API | — | Not run: no API file changed |
| **Not run** | — | Real browser; Docker; any external service |

**Preservation:**
- Tracked diff excluding `AuthGuard.tsx`: `ef42d071b5e4ddf5…`, equal to the pre-task value.
- Untracked, rebuilt with the original suite's 2-line edit reverted (on a scratch copy) and the new test excluded: `a8421c0bad0a4e73…`, equal.
- The CF-135 files match §5I.8: `billing-return.ts` `26570917…`, `settings-tabs.ts` `57cb3427…`, `analytics.ts` `516df15f…`, `main.tsx` `1388222f…`, `ResetPassword.tsx` `69efc978…`, `reset-token.ts` `3b03e3f5…`, `billing-return-login.test.tsx` `c98502de…`.
- **Full tree after:** tracked `398a6dc46cf444db…`, untracked `76f472ad0a3e1445…`, 0 staged.
- **Files:**

  | File | Hash |
  |---|---|
  | `AuthGuard.tsx` | `ccaa733fadf27b9a…` |
  | `login-redirect.test.tsx` | `34003633e6a6a73c…` |
  | `login-redirect.production-router.test.tsx` | `16d36db443599159…` |
- Main checkout unchanged. No commit or push.

**Remaining:**
1. **Stale comment in a CF-135 test (not modified, per instruction).** The comment in `billing-return-login.test.tsx` says `GuestGuard`'s redirect "currently wins". It is now outdated. The test still passes, because it asserts no leak rather than a destination. Update the comment, and optionally assert the destination, when CF-135 test edits are approved.
2. **Real-browser check:** not done (jsdom only).
3. **Forbidden saved destinations land on the forbidden view, by FU1 design.** Falling back to the role landing page instead would be a separate product decision.

### 5.9 Final read-only review for code-level closure (2026-10-14): closure NOT yet granted

**State verified first.** Worktree tracked `398a6dc46cf444db…` and untracked `76f472ad0a3e1445…`, both equal to §5.8's final state, so the §5.8 results correspond to the current source. Also unchanged: main checkout diff `439b10007f77b183…`, overview `c45dd64cc9e53b0f…`, 0 staged; this report `fc7c6825c08156b7…` before this entry.

| # | Check | Result |
|---|---|---|
| 1 | `AuthGuard.tsx` diff distinguishes "signed in on arrival" from "signed in during this visit" | **Pass.** `useState(() => user !== null)` is evaluated once, when the guard mounts; it redirects only if `user && signedInOnArrival`. A user who signs in on `/login` doesn't trigger the guard; `Login` navigates. If React Router reuses the guard instance across guest routes, that is harmless: a signed-out user moving between guest pages still has `user === null`. The `#s=` cross-domain branch now stays on `/login` while the browser leaves, instead of flashing `/pos` |
| 2 | Tests cover `/login`, `/register`, `/forgot-password`, persisted sessions, and successful-login navigation, under the production router | **Partial.** Successful-login navigation: covered on `/login`, the only guest page that signs a user in (`Register` and `ResetPassword` just navigate to `/login`). Signed-in redirect: covered on all three pages, **but the session is put into the store in memory** (`useAuthStore.setState`). **No test seeds a persisted `hesba-auth` session in `localStorage` and lets the store load it at startup.** That synchronous loading is verified only by reading zustand 5.0.13's source (§5.8) |
| 3 | Redirect sanitization still enforced; nothing unsafe can navigate | **Pass.** `redirect.ts` is unchanged since FU1 (`4c806b8ffa7c645d…`, the FU1 fingerprint recorded in the CF-022 pre-checks), and so is `Login.tsx` (the tracked diff outside `AuthGuard.tsx` equals the pre-task value). `Login.tsx:31,90` is the only consumer of `state.from`, always through `postLoginPath`; `GuestGuard` navigates only to the constant `/pos`. Tests: 9 unsafe saved destinations, same origin, single-slash history writes; the sanitizer-bypass mutation fails 13; plus the 10 FU1 unit tests in `redirect.test.ts` |
| 4 | CF-135 files untouched | **Pass.** The hashes match §5I.8. The stale comment in `billing-return-login.test.tsx` stays a tracked documentation-cleanup item (§6) |
| 5 | Reported results correspond to the final source | **Pass.** Web tests (118), type-check, lint and build were all run after the last source edit (the test's `history`-spy typing fix), and the fingerprints are unchanged since. *Caveat:* the mutation runs happened before that typing-only fix; it does not affect behaviour. **No real-browser verification** |
| 6 | Fingerprints, main checkout | **Pass** |

**Decision: CF-085-FU1 is NOT closed.** Check 2 is only partly met. The smallest step to close it is one approved test addition, with no source change: open `/login`, `/register` and `/forgot-password` with a seeded `hesba-auth` session, imported fresh, and assert → `/pos` under the production router.

**Still open:** real-browser verification.

### 5.10 Persisted-session test, and code-level closure (2026-10-14)

**Scope (approved):** one focused test plus test-only setup; no application-source change.

**Pre-checks: all matched.**
- Worktree: tracked `398a6dc46cf444db…`, untracked `76f472ad0a3e1445…`, 0 staged.
- Main checkout: diff `439b10007f77b183…`, overview `c45dd64cc9e53b0f…`.
- This report: `4d55748b2026ced7…`.

**Persisted format (read from source, not guessed).**
- `auth.store.ts`: `persist` with `name: 'hesba-auth'`, `partialize` → `{ user, tenantSubdomain }`, default `localStorage` storage, default `version: 0`.
- zustand 5.0.13 `middleware.mjs:300,334,358-363` writes `JSON.stringify({ state: partialize(state), version })`.
- The test does not hand-write this value. A fresh instance of the real store calls `setAuth(…)`, and the test reads back what the middleware wrote.

**Test: `apps/web/src/pages/auth/__tests__/login-redirect.persisted-session.test.tsx`** (new, 101 lines, 5 tests). Each case is a fresh page load:
1. clear `localStorage`;
2. seed `hesba-auth` with the captured value;
3. `vi.resetModules()`;
4. import a **new** auth store and `App`;
5. render under the production future flags, as in `main.tsx`.

There is **no `useAuthStore.setState`**.

| Case | Asserts |
|---|---|
| Shape | Keys are `{ state, version }`; `state` holds `{ user, tenantSubdomain }`; the access token is not persisted |
| `/login`, `/register`, `/forgot-password` with the restored session | `persist.hasHydrated()` is true and the user was restored before render (access token `null`, as in production), then the page ends on **`/pos`** and the login form is never shown |
| Control: the same load without a session | Stays on `/login` with the form |

**Verification mutations** (temporary, application source restored by checksum `6020f605175cf6bb…`; not source changes):

| Mutation | Failed |
|---|---|
| Guard never redirects | 3 (the three restored-session cases) |
| Guard ignores a session present on arrival | 3 |
| Store skips rehydration (`skipHydration: true`) | 3, which proves the test depends on real `localStorage` rehydration |

| Check | Command | Result |
|---|---|---|
| Focused | `vitest run` on the new file | **exit 0: 5 passed** |
| Web suite | `pnpm --filter @hesba/web test` | **exit 0: 12 files, 123 passed** (118 + 5) |
| Web type-check / lint / build | in `apps/web` | **exit 0 / 0 / 0.** Lint: the same 55 **pre-existing** warnings; **0 new** (none in the new file) |
| **Not run** | — | Real browser; Docker; any external service |

**Preservation.**
- Tracked `398a6dc46cf444db…`, unchanged (no application source touched).
- Untracked excluding the new file: `76f472ad0a3e1445…`, unchanged.
- Full untracked after: `3b67acbfe6f719a8…`; new test `cd4d27c0b6853b5e…`; 0 staged.
- Unchanged: `AuthGuard.tsx` `ccaa733f…`, `redirect.ts` `4c806b8f…`, and CF-135's `billing-return-login.test.tsx` `c98502de…` (stale comment left as is).
- Main checkout unchanged. No commit or push.

**Decision: CF-085-FU1 is CLOSED at code level.** The §5.9 check 2 gap is now covered. **Still open:**
- real-browser verification;
- the stale CF-135 test comment (separate documentation cleanup item, §6).

---

## 5A. CF-048: production secrets file not git-ignored or docker-ignored

### 5A.1 Finding and pre-checks

| Field | Value |
|---|---|
| Canonical ID | CF-048 (P2, W1) |
| Original ID | INFRA-08 (Phase 8) |
| Root cause | `docker-compose.prod.yml` reads `env_file: .env.production` from the repository root (compose project directory), and builds with `context: .` (the repository root).<br>• `.gitignore` covered only `.env`, `.env.local` and `.env.*.local`.<br>• `.dockerignore` covered only `**/.env` and `**/.env.local`.<br>So a root `.env.production` could be committed by `git add -A` (and the repository is public, W0-03), and it would be sent to the Docker builder as part of the build context |
| Pre-task state of earlier W1 work | CF-132, CF-085 and FU1 present.<br>Fingerprints taken before editing: tracked diff `8f474372acbdf136…`; untracked files `22b40cee9f01a652…`; `redirect.ts` `4c806b8ffa7c645d…` |

**Is `.env.production` tracked? (names only; no file content was read or printed)**

| File | Tracked? | Notes |
|---|---|---|
| Root `.env.production` (the compose secrets file) | **No** | Not tracked, and not present in the worktree |
| **`apps/web/.env.production`** | **Yes** (since `f75aea6`) | **Reported separately, tracking not changed.** It holds one public build variable, `VITE_BASE_DOMAIN` (W0 S-1). Vite loads it during `vite build`, which runs inside the image after `COPY apps ./apps` (`Dockerfile:20`). It is a required build input, not a secret. Any broad `.env.production` rule would wrongly match it, and in `.dockerignore` would drop it from the build context, so the web build would lose its base domain (CF-153). It was not untracked, removed, read or modified |
| `.env.example` | Yes | Unaffected |

### 5A.2 Change (narrowest rules: root-anchored)

| File | Change |
|---|---|
| `.gitignore` | Under "# Environment": a 3-line comment plus **`/.env.production`** (root only). `.env.production.local` was already covered by the existing `.env.*.local`. The file also gained a trailing newline: the last line `.claire/` was previously unterminated. Its content is unchanged; the diff shows it as −1 / +1 |
| `.dockerignore` | After `**/.env.local`: a 3-line comment plus **`/.env.production`** (root only) and **`**/.env.production.local`**, so local production overrides are kept out of the build context, matching the existing git rule |
| `apps/api/src/__tests__/env-ignore-rules.test.ts` (new, 19 tests) | Regression test (see §5A.3) |

Not changed: `Dockerfile`, `docker-compose*.yml`, `Caddyfile`, `railway.json`, `apps/web/.env.production`, `.env.example`.

**Residual, by design (narrowest scope).** An env file named `.env.production` **inside a subdirectory other than the root** (e.g. a hypothetical `apps/api/.env.production`) is **not** covered. The compose secrets file is root-only, and `apps/web/.env.production` must stay tracked. Widening the rule with exceptions (`!apps/web/.env.production`) is possible if wanted; it would be a separate decision.

### 5A.3 Checks

**Git behaviour** (`git check-ignore --no-index -v`, which tests the rules for tracked or non-existent paths without creating any file)

| Path | Result |
|---|---|
| `.env.production` | **ignored** by `.gitignore:12:/.env.production` (new) |
| `.env`, `.env.local` | ignored (existing rules) |
| `.env.production.local`, `apps/web/.env.production.local`, `apps/api/.env.production.local` | ignored by `.gitignore:8:.env.*.local` (existing) |
| `.env.example` | **not ignored** |
| `apps/web/.env.production` | **not ignored**, and still tracked |
| `apps/api/.env.production`, `docs/.env.production` | not ignored (residual above) |
| `.env.staging`, `.env.production.example` | not ignored |

**Tracking unchanged.** `git ls-files --error-unmatch` still lists `.env.example` and `apps/web/.env.production`. The root `.env.production` is not tracked.

**`env-ignore-rules.test.ts`** (runs `git check-ignore` / `git ls-files` against the rules; creates and reads no env file)
- **Git:** the matrix above, 8 cases, plus the tracking assertions.
- **Docker context (emulated):** a minimal emulation of Docker's documented `.dockerignore` matching (paths relative to the context root, leading `/` dropped, `**` spanning directories, parent-directory matches, `!` exceptions, last match wins, no "match anywhere") applied to the real `.dockerignore`.
  - **Excluded:** `.env.production`, `.env`, `.env.production.local`, `apps/web/.env.production.local`, `apps/web/node_modules/x`.
  - **Kept:** `apps/web/.env.production`, `.env.example`, `apps/api/src/index.ts`, `packages/database/prisma/schema.prisma`.
- **Structural:** both files contain `/.env.production`, and neither contains a broad form (`.env.production`, `**/.env.production`, `.env.*`, `**/.env.*`, `.env*`).

**Mutation check** (each applied, run, then restored; checksum of both ignore files `a9fe70c945de074c…` identical before and after)

| Mutation | Result |
|---|---|
| M1: the pre-CF-048 ignore files put back | **5 failed** / 14: the root `.env.production` and the `.local` variants are not excluded, and the root-anchored rule is missing |
| M2: over-broad rules (unanchored `.env.production` in `.gitignore`, `**/.env.production` in `.dockerignore`) | **3 failed** / 16: the tracked `apps/web/.env.production` becomes git-ignored and excluded from the build context |

**Real Docker build-context check: NOT RUN.** The Docker daemon was not running (`docker info`: cannot connect to `docker.sock`). It was deliberately not started. Project notes record local containers named `hesba_postgres` / `hesba_redis`, and starting Docker Desktop could auto-restart them and bind ports 5432 / 6379, a side effect outside this task. The emulated check above is not a substitute.

**The command originally given here is WITHDRAWN as unsafe. Do not run it** (follow-up review, §5A.6, defect D1). It wrote dummy content to `.env.production` and `apps/web/.env.production.local` in the working tree, then `rm -f`'d them. Anywhere a real `.env.production` exists, that would overwrite the real secrets file and then delete it.

Replacement, for the user to run once Docker is up:
- never starts or stops Docker or any container, and aborts unless the daemon is already running and the active builder uses the `docker` driver;
- never writes to the repository;
- reads no env-file contents;
- needs no image pull (`FROM scratch`).

It was syntax-checked only (`sh -n`, `bash -n`: OK), **not executed**.

```sh
#!/bin/sh
# CF-048 Docker build-context check. Run from the W1 worktree root.
# Never starts or stops Docker or any container, never writes to the
# repository, never reads env-file contents (names only).
set -eu
command -v docker >/dev/null 2>&1 || { echo "docker CLI not found"; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker daemon not running - this script will not start it"; exit 1; }
driver=$(docker buildx inspect 2>/dev/null | awk -F': *' '/^Driver:/ {print $2; exit}')
[ "$driver" = "docker" ] || { echo "Active builder driver is '$driver', not 'docker' (it would run a BuildKit container) - aborting"; exit 1; }
[ -f .dockerignore ] && [ -f apps/web/.env.production ] || { echo "Run from the W1 worktree root"; exit 1; }

CTX=$(mktemp -d); OUT_A=$(mktemp -d); OUT_B=$(mktemp -d)
trap 'rm -rf "$CTX" "$OUT_A" "$OUT_B"' EXIT INT TERM

# A. The real .dockerignore (byte-identical copy) + dummy files in an isolated context.
cp .dockerignore "$CTX/.dockerignore"
cmp -s .dockerignore "$CTX/.dockerignore"
mkdir -p "$CTX/apps/web" "$CTX/apps/api"
for f in .env .env.example .env.production .env.production.local \
         apps/web/.env.production apps/web/.env.production.local apps/api/.env.production; do
  printf 'DUMMY=1\n' > "$CTX/$f"
done
printf 'FROM scratch\nCOPY . /ctx\n' | docker build -q -f - --output "type=local,dest=$OUT_A" "$CTX" >/dev/null
echo "A. env files that reach the build context:"
echo "   expected: ./.env.example ./apps/api/.env.production ./apps/web/.env.production"
(cd "$OUT_A/ctx" && find . -name '.env*' | sort | sed 's/^/   /')

# B. The real worktree context, listed by name only (nothing created or read).
printf 'FROM scratch\nCOPY . /ctx\n' | docker build -q -f - --output "type=local,dest=$OUT_B" . >/dev/null
echo "B. env files in the real build context:"
echo "   expected: ./.env.example ./apps/web/.env.production"
(cd "$OUT_B/ctx" && find . -name '.env*' | sort | sed 's/^/   /')
```

### 5A.4 Results (actually run; worktree)

| Check | Command | Result |
|---|---|---|
| Focused | `pnpm --filter @hesba/api exec vitest run src/__tests__/env-ignore-rules.test.ts` | **exit 0: 19 passed** |
| API suite | `pnpm --filter @hesba/api test` | **exit 0: 14 files, 97 passed** (78 + 19) |
| API type-check | `pnpm --filter @hesba/api type-check` | **exit 0** |
| API lint | `pnpm --filter @hesba/api lint` | **exit 0** |
| Web suite (unaffected; run for completeness) | `pnpm --filter @hesba/web test` | **exit 0: 55 passed** |
| Real Docker context check | — | **Not run** (§5A.3) |

### 5A.5 Diff review and preservation

- **CF-048 diff:** `.dockerignore` +5, `.gitignore` +5 / −1 (the −1 is the newline fix), plus 1 new test file.
- **Earlier W1 work unchanged:**
  - the tracked diff excluding the two ignore files is still `8f474372acbdf136…`;
  - the untracked files excluding the new test are still `22b40cee9f01a652…`.

  So CF-132, CF-085, FU1 and its security fixes are byte-identical.
- **No `.env.production` file was created** in the worktree at any point, and no env file content was read or printed.
- **Main checkout:**
  - same four entries;
  - `git diff` fingerprint `439b10007f77b183…`;
  - overview `c45dd64cc9e53b0f…`;
  - 0 staged;
  - `claude/ui-pos-merge-split` @ `8846bce`;
  - its `.gitignore` / `.dockerignore` untouched.
- **Scratch files:** the scratchpad is empty.

### 5A.6 Follow-up review of CF-048 (2026-10-13)

**Method:** source and config review only.
- Docker not started.
- No external service contacted.
- No env file created, read for values, printed or modified.
- **No code or config change.** The only change is this report: the defect found was in the report's own documented command.

**Q1. Do subdirectory `.env.production` files need protection?** **No, not under current behaviour.** No broadening; the rules stay root-anchored.

Evidence: every runtime and deployment env loader in the repository reads only a root `.env` or the root `.env.production`:

| Loader | File it loads |
|---|---|
| `apps/api/src/config/env.ts:5` | `dotenv.config({ path: <repo>/.env })` |
| `packages/database/src/run-tenant-migrations.ts:7` | `dotenv` → `<repo>/.env` |
| `packages/database/src/seeds/master.seed.ts:5` | `dotenv` → `<cwd>/../../.env`, i.e. the repo root `.env` |
| Prisma schemas (`schema.prisma:9`, `schema.tenant.prisma:13`) | `env("DATABASE_MASTER_URL")` from the process environment |
| `docker-compose.prod.yml:46` | `env_file: .env.production` at the **root** (now git-ignored and docker-ignored) |
| Vite (`apps/web`, `vite build`, mode `production`) | `apps/web/.env`, `.env.local`, `.env.production`, `.env.production.local`. `vite.config.ts` sets no `root` / `envDir` / `envPrefix` / `mode`, so only `VITE_*` keys reach the bundle |

- No package script passes `--env-file` or loads `.env.production`.
- A file named `.env.production` in any other subdirectory (e.g. `apps/api/`) is **loaded by nothing**, so it cannot carry secrets into the app.
- The places secrets do live (`.env` anywhere, `*.env.*.local`) were already ignored before CF-048.

**Re-evaluate the decision** if a future change makes a subdirectory load `.env.production` (e.g. an API `dotenv` path change or a new compose file). The CF-048 test's structural check will need a deliberate update then, with a `!apps/web/.env.production` exception.

**Q2. Is the tracked `apps/web/.env.production` needed, and is it public build-time configuration only?** **Yes on both counts.** Verified without printing any value:

- **Keys:** exactly **one** non-comment line, key `VITE_BASE_DOMAIN`. Names only were extracted.
- **Value:** a boolean comparison shows it equals the public apex domain, which is also the `Caddyfile` site address and public DNS. The value itself was not printed.
- **Consumer:** `apps/web/src/pages/auth/Login.tsx:77` (`onMainDomain`) decides whether a login on the apex hands the session over to `https://<store>.<domain>/#s=…`. Without the file, that hand-off would never happen in production builds; Phase 8 CF-153 already records that the base domain is baked from this committed file.
- **History:** unchanged since it was added in `f75aea6` (2026-07-10).
- **Other `VITE_*` variable:** the only other one referenced, `VITE_GA_MEASUREMENT_ID` (`analytics.ts:13,61`), is **not** in the file. It is optional and public by design.

**Q3. Was the documented Docker-context command safe and accurate?** **No. Concrete defects, now corrected in §5A.3.**

| # | Defect in the original command | Impact |
|---|---|---|
| **D1** | Wrote `DUMMY=1` to `.env.production` and `apps/web/.env.production.local` in the working tree, then `rm -f` both | If run where a real `.env.production` exists, **it would overwrite and then delete the real secrets file**. The statement that it "doesn't modify the repository" was also incorrect |
| D2 | A fixed `/tmp/hesba-ctx` plus `rm -rf` of that path | Could delete an unrelated, pre-existing directory |
| D3 | No builder-driver check | With a `docker-container` buildx builder, `docker build` would create or start a BuildKit container |
| D4 | No daemon-state guard; no cleanup on interruption | Ctrl-C could leave dummy files behind |

What the original did get right: `-f -` with context `.` uses the context-root `.dockerignore`, the same file and context that `docker-compose.prod.yml` (`context: .`) uses. **It was never run**, because the Docker daemon was off.

**Replacement (now in §5A.3)**
- **Guards:** aborts unless the daemon is already running; never starts it. Aborts unless the active builder's driver is `docker`.
- **Part A:** builds an isolated `mktemp` context containing a byte-verified (`cmp`) copy of the real `.dockerignore` and dummy files at the relevant paths. It exports that context with `FROM scratch` + `--output type=local`, so no image pull and no container, and lists which `.env*` names got through. Expected: `./.env.example`, `./apps/api/.env.production` (the residual by design, made visible) and `./apps/web/.env.production`.
- **Part B:** exports the real worktree context and lists `.env*` **names only**. Expected: `./.env.example`, `./apps/web/.env.production`. It creates no files in the repository; any real `.env.production` present would only be checked for absence.
- **Cleanup:** all output goes to `mktemp` directories and is removed by a trap on exit or interruption.
- **Verification so far:** syntax only (`sh -n` OK, `bash -n` OK). ShellCheck is not installed. **The script has not been executed.**

**Integrity after the review**

| Item | Fingerprint / result | Matches |
|---|---|---|
| Tracked diff excluding the ignore files (CF-132, CF-085, FU1) | `8f474372acbdf136…` | yes |
| Untracked files excluding the CF-048 test (FU1 files, security fixes, earlier tests) | `22b40cee9f01a652…` | yes |
| CF-048 ignore files | `a9fe70c945de074c…` | yes, unchanged |
| CF-048 test | re-run: **19 passed** | — |
| `.env*` files in the worktree | only `.env.example` | — |
| Main checkout | same four entries; `git diff` `439b10007f77b183…`; overview `c45dd64cc9e53b0f…`; 0 staged; `claude/ui-pos-merge-split` @ `8846bce` | yes |
| Scratch | the script draft used for the syntax check was removed; the scratchpad is empty | — |

---

## 5B. CF-035: the on-demand TLS ask endpoint approves any subdomain

### 5B.1 Pre-checks

| Item | Fingerprint / result |
|---|---|
| Worktree | `claude/w1-safety-net` |
| CF-132, CF-085, FU1 tracked diff (excluding ignore files) | `8f474372acbdf136…`: matches |
| Untracked files (excluding the CF-048 test) | `22b40cee9f01a652…`: matches |
| CF-048 ignore files | `a9fe70c945de074c…`: matches |
| CF-048 test | `6f19b7dffe344e0b…`: matches |
| Full tree before CF-035 | tracked `df8d4e57b975f175…`; untracked `812fbb3a76fc63cb…` |

### 5B.2 Trace: where any subdomain was accepted

**Certificate path.**
1. The `Caddyfile` site `*.hesbaapp.com` uses `tls { on_demand }` (lines 15–20).
2. Before obtaining a certificate for a host, Caddy calls the global `on_demand_tls { ask http://app:3000/internal/check-tenant }` (lines 1–5) with `?domain=<host>`.
3. Caddy proceeds only on HTTP 200.

The apex `hesbaapp.com` and `www.hesbaapp.com` have their own site blocks, so they never go through the ask endpoint.

**The defect: `apps/api/src/index.ts:186-191`.**

```ts
if (base && domain.endsWith(`.${base}`)) return reply.status(200).send()
```

There was no tenant lookup. The handler approved:
- unknown names;
- suspended, cancelled and provisioning tenants;
- the system hosts;
- nested labels (`evil.shop1.<base>`);
- an empty label;
- invalid characters.

It rejected uppercase hosts (case-sensitive comparison) and threw on a repeated `domain` parameter.

**Impact.** Anyone can make Caddy request certificates for arbitrary names, which exhausts CA rate limits and certificate storage and can block certificates for real new tenants (HSEC-20).

**No TLS verification is weakened anywhere** in the repository: there is no `rejectUnauthorized`, `NODE_TLS_REJECT_UNAUTHORIZED`, `insecure_skip_verify`, custom CA or `checkServerIdentity`. The outbound Paymob, ETA and Resend calls use default Node TLS verification.

### 5B.3 Intended policy (from configuration and documentation)

**Project documents.** The architecture docs and the implementation roadmap only planned wildcard DNS plus wildcard SSL (`Hesba_Implementation_Roadmap.md:832-833`). They say nothing about on-demand issuance.

**The audit reports are explicit:**
- Phase 2 HSEC-20: "answer 200 only for existing ACTIVE tenants (cached lookup); or a wildcard certificate via DNS challenge".
- Phase 8 INFRA-10: "an `ask` endpoint that checks an ACTIVE tenant (cached)".
- **Phase 10 §8.2 CF-035 acceptance:** "returns 200 only for existing, active tenants … random subdomain requests [refused] … a new tenant's certificate is issued".

**Not ambiguous.** The wildcard-certificate alternative would change the `Caddyfile` and DNS, which is production configuration, so it is out of scope. Every edge case is settled by existing code:

| Edge case | Decided by |
|---|---|
| Which status counts as "active" | `tenants.status = 'ACTIVE'`, the same gate `tenant.middleware.ts:77` uses to serve a store |
| Tenants whose subscription is suspended | The tenant row stays `ACTIVE`, so the certificate is allowed; the store must stay reachable to pay. Tenants suspended or cancelled by the admin are refused |
| New tenants | Registration flips `PROVISIONING` → `ACTIVE` when provisioning completes (`tenant.service.ts:234 → 266`), before the owner first visits, so their certificate is still issued |
| Name shape | Registration allows exactly one lowercase label `^[a-z0-9-]{3,63}$` (`tenant.schema.ts:6-10`). Nested labels can never be a tenant. Hosts are compared lowercased, because DNS names are case-insensitive and this is not a weakening |
| `www` / `api` / `admin` | `tenant.middleware.ts` `SYSTEM_HOSTS`: the app never serves a tenant on these hosts. `www` has a static certificate. No code uses `api.` or `admin.` hosts; the admin panel is `/admin` on the apex |
| Caching | Read the existing `tenant:<subdomain>` Redis cache (invalidated on admin suspend/activate, `admin.routes.ts:47`, and in `billing.service.ts:28`). **Never write it:** the middleware stores the full tenant row there, and a partial object would corrupt the tenant context |

### 5B.4 Change (worktree)

| File | Change |
|---|---|
| `apps/api/src/modules/tenants/tls-ask.routes.ts` (new, 47 lines) | `tlsAskRoutes` registers `GET /internal/check-tenant` (same path, same root context, so CORS still doesn't apply).<br>**Returns 200 only when all of these hold:**<br>• `domain` is a single string;<br>• lowercased, it is exactly `<label>.<base>`;<br>• `<label>` matches `^[a-z0-9-]{3,63}$`;<br>• `<label>` is not in `SYSTEM_HOSTS`;<br>• the tenant is `ACTIVE`, read from the cache or with `masterDb.tenant.findUnique({ select: { status } })`.<br>**Otherwise 400.** A lookup error returns **503**, failing closed (Caddy only proceeds on 200) |
| `apps/api/src/index.ts` | The inline handler (old lines 185–191) is replaced by `app.register(tlsAskRoutes)`, plus the import |
| `apps/api/src/shared/middleware/tenant.middleware.ts` | `const SYSTEM_HOSTS` → **`export const`**. No behaviour change |
| `apps/api/src/modules/tenants/__tests__/tls-ask.test.ts` (new, 26 tests) | See §5B.5 |

**Not changed:** `Caddyfile`, `docker-compose.prod.yml`, `Dockerfile`, `railway.json`, and all certificate and trust settings.

### 5B.5 Tests (`tls-ask.test.ts`)

**How it runs:** `fastify.inject` on the real route module. Only `masterDb.tenant.findUnique` and the Redis `get` / `setex` are stubbed; no network.

**Accepted (200)**
- An `ACTIVE` tenant.
- The same tenant in mixed case.
- A cached `ACTIVE` tenant, with **no** database query and **no** cache write (`setex` never called).

**Refused (400)**
- An unknown subdomain.
- `SUSPENDED`, `CANCELLED` and `PROVISIONING` tenants.
- `www` / `api` / `admin`, even when a tenant row with that name exists (registration has no reserved-name list).
- A nested label under a real tenant, a doubled label, an empty label.
- The apex, another domain, the suffix trick `shop1.<base>.evil.test`, a missing dot.
- Invalid characters, a 2-character label, a 64-character label, a trailing dot.
- A cached non-`ACTIVE` tenant.
- A missing, empty or repeated `domain` parameter.
- `APP_BASE_DOMAIN` unset.
- Malformed names are refused **before** any cache or database access.

**Fail-closed:** a lookup error returns **503**, never 200.

### 5B.6 Results (actually run; worktree)

**Red, the policy tests against the unchanged logic** (the handler was first moved verbatim into the module): **18 failed / 8 passed**. This demonstrates the current behaviour:
- certificates approved for unknown, suspended, cancelled and provisioning tenants, system hosts, nested and empty labels, and invalid or wrong-length labels;
- the lookup-error case could not fail closed, because there was no lookup;
- uppercase hosts were refused;
- a repeated parameter errored.

**Green after the fix: 26 / 26.**

**Mutation check** (each applied, run, restored; `tls-ask.routes.ts` checksum `5765100bab8d5af2…` identical before and after)

| Mutation | Result |
|---|---|
| M1: tenant status ignored | **4 failed:** suspended, cancelled, provisioning, cached suspended |
| M2: system hosts not excluded | **3 failed:** `www`, `api`, `admin` |
| M3: label-shape check removed | **1 failed:** "malformed names … without touching the database". Nested names are still refused because the tenant lookup misses, which is defence in depth |
| M4: lookup error answers 200 | **1 failed:** fail-closed |

**Full checks**

| Check | Command | Result |
|---|---|---|
| API suite | `pnpm --filter @hesba/api test` | **exit 0: 15 files, 123 passed** (97 + 26) |
| API type-check | `pnpm --filter @hesba/api type-check` | **exit 0** |
| API lint | `pnpm --filter @hesba/api lint` | **exit 0** |
| API build | `pnpm --filter @hesba/api build` | **exit 0**; `apps/api/dist/` is git-ignored |
| Web suite (unaffected) | `pnpm --filter @hesba/web test` | **exit 0: 55 passed** |
| Not run | — | No live Caddy, ACME or network test (prohibited, and no Docker) |

### 5B.7 Diff review and preservation

- **CF-035 tracked diff:** `index.ts` (+3 / −7) and `tenant.middleware.ts` (+1 / −1, export keyword). **New files:** the route module and its test.
- **Earlier W1 work:**
  - tracked diff excluding the CF-035 files: `df8d4e57b975f175…`, unchanged;
  - untracked files excluding the CF-035 files: `812fbb3a76fc63cb…`, unchanged.

  So CF-132, CF-085, FU1 (including the S1/S2 fixes) and CF-048 are byte-identical.
- **Main checkout:**
  - same four entries;
  - `git diff` fingerprint `439b10007f77b183…`;
  - overview `c45dd64cc9e53b0f…`;
  - 0 staged;
  - `claude/ui-pos-merge-split` @ `8846bce`.
- **Scratch files:** the scratchpad is empty.

### 5B.8 Residual observations (not fixed; outside CF-035)

1. **The ask endpoint is publicly reachable** through the apex: `hesbaapp.com { reverse_proxy app:3000 }` forwards every path, including `/internal/*`.
   - It now only answers 200 or 400 for a tenant name, and tenant existence is already observable by visiting `<name>.hesbaapp.com`.
   - Each probe of an unknown valid-looking name costs one indexed DB lookup, because negative results are not cached.
   - Restricting `/internal/*` to the Caddy-internal path needs a `Caddyfile` or proxy change, which is production configuration and not done.
   - The app cannot tell Caddy-internal calls apart: without `trustProxy` (CF-033), every request's IP is Caddy's.
2. **Registration has no reserved-name list** (`www`, `api`, `admin` and similar can be registered as tenant subdomains). The ask endpoint now refuses certificates for them anyway, but such a tenant would be unreachable on its own host (`SYSTEM_HOSTS`). This is a separate defect for a later task.
3. **Caddy renewal behaviour for tenants that later become `SUSPENDED` / `CANCELLED`:** it is not verified from Caddy documentation (no network access) whether Caddy re-consults `ask` at renewal. Either way, such stores already get the app's "store not found" response.

---

## 5C. CF-025: the seeded cashier role cannot complete a sale

### 5C.1 Pre-checks

| Item | Fingerprint / result |
|---|---|
| Worktree | `claude/w1-safety-net` |
| CF-132 / CF-085 / FU1 / CF-048 tracked (excluding CF-035 files) | `df8d4e57b975f175…`: matches |
| Untracked files (excluding CF-035 files) | `812fbb3a76fc63cb…`: matches |
| CF-035 module | `5765100bab8d5af2…`: matches |
| CF-048 ignore files | `a9fe70c945de074c…`: matches |
| FU1 `redirect.ts` | `4c806b8ffa7c645d…`: matches |
| Full tree before CF-025 | tracked `ec31679bb21dc8a2…`; untracked `f644c54b3d3389b7…` |

### 5C.2 Trace of the cashier sale flow

**Front end.**
- `/pos` is guarded by `RoleGuard invoices:create` (`App.tsx`); the cashier passes.
- `POS.tsx` makes 10 API calls. The user's uncommitted `POS.tsx` edits change none of them (checked read-only with `git diff` in the main checkout).

**Server guard for each call, against the seeded cashier permissions** (`tenant.service.ts:44-56`: `invoices` create/read, `products` read, `stock` read, `customers` create/read/update, `installments` read, `services` read, `work_orders` create/read/update, `reports` read):

| POS call | Route guard | Cashier |
|---|---|---|
| `GET /payment-methods` | `pm.routes.ts:9` **`settings:read`** | **403** |
| `GET /currencies` | `index.ts` `authenticate` only | ok |
| `GET /customers` | `customers:read` | ok |
| `GET /reports/dashboard`, `GET /reports/sales` | `reports:read` | ok |
| `GET /products/search`, `GET /products/barcode/:code` | `products:read` | ok |
| `GET /coupons/validate` | `authenticate` only | ok |
| `POST /invoices` (online and offline replay) | `invoices:create` | ok |

**Root cause, confirmed in the current code, not just the audit text:**
1. `GET /payment-methods` requires `settings:read`, which the seeded cashier does not hold, so it returns **403**.
2. The POS query (`POS.tsx:148-151`) has no error handling and defaults to `[]`, so there is nothing to select and the complete-sale button never enables.
3. `POST /invoices` requires `paymentMethodId: z.string().uuid()` (`invoice.schema.ts:6`), so no sale can be submitted.

**This is the only blocking guard on the sale path.** The new test `pos-sale-permissions.test.ts` confirmed it on the red run: 1 of the 8 POS routes failed for the cashier.

### 5C.3 Intended policy (project documentation): unambiguous

| Source | Says |
|---|---|
| `documents/Markdown/Hesba_Business_Document.md` §5, roles table | Cashier: sale screen **"✅ full"**; **Settings "❌"** |
| `Hesba_Business_Document.md` §14.4 and `documents/Markdown/Hesba_Payment_Fees_Update.md`, fee permissions | Cashier **sees the fee: "✅ view only"**; may change `fee_bearer` only for `negotiable` methods; may **not** edit settings |
| `documents/Claude_Code/HESBA_COMPLETE_CONTEXT.md:1559-1568`, designed role seed | `cashier: { …, payment_methods: ['read'] }`: a dedicated read permission, with **no** `settings` |

The implementation dropped the designed `payment_methods` resource and guarded the read with `settings:read`, which contradicts all three. The intent is clear: the cashier **reads** payment methods and their fees, and does **not** get settings.

**Mechanism: the minimal option, as planned and approved for W1 task 5.**
- `GET /payment-methods` accepts **`settings:read` OR `invoices:create`**, meaning anyone who can use the sale screen. The write routes keep `settings:update`.
- No role data changes, because the designed `payment_methods` resource exists in no role row or role-editor option today. Only a UI label exists, in `AuthGuard.tsx`.

**Options deliberately not taken in W1:**
- A dedicated `payment_methods:read` permission. Existing tenants' role rows would need a data update, which is a backfill and excluded in W1. It belongs to W3's permission catalogue.
- Granting the cashier `settings:read`. That contradicts "Settings ❌" and would open the Settings page and CF-005's unprotected writes (Phase 7 warning).

**Exposure check.** The `PaymentMethod` fields are name, type, `feeType`, `feePercentage`, `feeFixed`, `feeBearer`, `isActive`, notes and `createdAt`. There are no credentials, and the docs say the cashier should see the fees.

### 5C.4 Change (worktree)

| File | Change |
|---|---|
| `apps/api/src/shared/middleware/auth.middleware.ts` | **New `requireAnyPermission(alternatives)`** (23 lines). It passes if the caller holds any listed `resource:action`. Otherwise it behaves like `requirePermission`: `super_admin` bypasses, and failures return 403 `forbidden`, with `required` listing the alternatives (`settings:read \| invoices:create`). `requirePermission` is unchanged |
| `apps/api/src/modules/payment-methods/pm.routes.ts` | GET `/` guard → `requireAnyPermission([['settings','read'],['invoices','create']])`, with a comment explaining why. POST and PATCH stay `requirePermission('settings','update')` |
| `apps/api/src/modules/tenants/tenant.service.ts` | `const SYSTEM_ROLES` → **`export const`**, so tests use the real seed. No data or behaviour change |
| `apps/api/src/modules/payment-methods/__tests__/pm.routes.authz.test.ts` (new, 9 tests) | The real `paymentMethodRoutes` via `fastify.inject`. Permissions come from the **real** `SYSTEM_ROLES`; only the JWT/tenant check and the tenant DB are stubbed |
| `apps/api/src/__tests__/pos-sale-permissions.test.ts` (new, 10 tests) | Class guard: the seeded cashier must satisfy the guard of every API route `POS.tsx` calls (guards parsed from route source, permissions from the real seed). It also checks the route list still matches `POS.tsx`, and that the cashier still has **no** `settings` |
| `apps/api/src/shared/middleware/__tests__/require-any-permission.test.ts` (new, 7 tests) | Unit tests for the new guard |

**Not changed:**
- `POS.tsx`, which keeps the user's uncommitted edits;
- the role seed's permission values;
- any role data;
- the web app.

`Installments.tsx` and `WorkOrders.tsx`, which also read `/payment-methods`, now work for roles holding `invoices:create`. That is consistent with the policy.

### 5C.5 Tests and results (actually run; worktree)

**`pm.routes.authz.test.ts`**
- `GET`:
  - **cashier → 200**; `branch_manager` and `super_admin` → 200;
  - `inventory_keeper` and `accountant` → **403**, unchanged, with no DB read;
  - unauthenticated → 401.
- Writes:
  - cashier `POST` → **403**, and cashier `PATCH` → **403**, with no DB write;
  - `super_admin` `POST` → not 403.

**Red, before the fix** (only the `SYSTEM_ROLES` export applied): **2 failed / 17 passed**, plus the new-guard unit file failing to import (`requireAnyPermission is not a function`):
- `cashier can list payment methods (200)`: got **403**;
- the POS prerequisite for `pm.routes.ts app.get('/')`: not allowed (guard `settings:read`);
- all keep-refused and keep-allowed cases already passed.

**Green, after the fix:** the 4 related files (including CF-132's guard-factory scan, which now also covers `requireAnyPermission`) passed **29 / 29**.

**Mutation check** (applied, run, restored; checksum of `pm.routes.ts` plus `auth.middleware.ts` `3f1a85ebef9d7d29…` identical before and after)

| Mutation | Result |
|---|---|
| M1: GET guard back to `settings:read` | **2 failed:** cashier read, and the POS prerequisite |
| M2: POST loosened to the read alternatives | **1 failed:** cashier cannot create |
| M3: any-of implemented as all-of | **3 failed:** cashier read, both single-alternative passes |

**Full checks**

| Check | Command | Result |
|---|---|---|
| API suite | `pnpm --filter @hesba/api test` | **exit 0: 18 files, 149 passed** (123 + 26 new) |
| API type-check | `pnpm --filter @hesba/api type-check` | **exit 0** |
| API lint | `pnpm --filter @hesba/api lint` | **exit 0** |
| API build | `pnpm --filter @hesba/api build` | **exit 0** |
| Web suite (unaffected) | `pnpm --filter @hesba/web test` | **exit 0: 55 passed** |
| **Not run:** DB-backed end-to-end "cashier completes a cash sale (201)" (the RT7-04 API equivalent) | — | Needs the disposable Postgres/Redis integration suite, which is not built, and the Docker daemon is off (not started, §5A.3). The authorization layer is covered above; `POST /invoices` business logic was not exercised for the cashier |

### 5C.6 Diff review and preservation

- **CF-025 tracked diff:**
  - `pm.routes.ts` (+5 / −2);
  - `auth.middleware.ts` (+23);
  - `tenant.service.ts` (+1 / −1, `export`).
- **New files:** the 3 test files (223 lines).
- **Earlier work:**
  - tracked diff excluding the CF-025 files: `ec31679bb21dc8a2…`, unchanged;
  - untracked files excluding the CF-025 tests: `f644c54b3d3389b7…`, unchanged.

  So CF-132, CF-085, FU1, CF-048 and CF-035 are byte-identical. The web app is unchanged by CF-025.
- **Main checkout:**
  - same four entries;
  - `git diff` fingerprint `439b10007f77b183…`;
  - overview `c45dd64cc9e53b0f…`;
  - 0 staged;
  - `claude/ui-pos-merge-split` @ `8846bce`.
- **Scratch files:** the scratchpad is empty.

### 5C.7 Remaining issues

1. **POS error state (the second half of UX-03).** The POS still silently shows an empty method list if the query fails for any other reason, such as a network error or a custom role without either permission. Fixing that needs `POS.tsx`, which is deferred while the user's uncommitted `POS.tsx` edits are pending.
2. **`accountant`.** The docs say the accountant "sees the fee", but the role has neither `settings:read` nor `invoices:create`, so `GET /payment-methods` stays 403 for it. That is unchanged and pre-existing; the accountant has no sale screen. It belongs to W3's permission catalogue together with the designed `payment_methods:read` resource.
3. **Custom roles.** Tenant-defined roles get payment-method read access only if they hold `invoices:create` or `settings:read`. That is consistent with the policy.
4. **DB-backed cash-sale test** pending the integration suite and Docker (5C.5).

---

## 5D. CF-023 (partial): password-reset links and tokens printed to logs (AU-10)

### 5D.1 Scope: what CF-023 is, and what this task covers

| Item | Content |
|---|---|
| Phase 10 registry | **CF-023** (P1, release blocker): "Emails interpolate unescaped tenant data; receipt email accepts any recipient". Root **HSEC-06**; aliases **AU-10**, **INT-07** |
| Phase 10 §8.2 acceptance | "Interpolated values are HTML-escaped in every template; receipt recipients are limited to the customer's address on file (or a permissioned override)" |
| AU-10 (Phase 1) | "email HTML interpolates unescaped data; **reset link logged when Resend unset**" (`email.ts:11-130,172-221,318-321`) |
| Overlap | **CF-135 / HSEC-25** (W12): "Reset tokens … can reach analytics or logs". The logs channel is the same code path; the analytics channel (GA `page_view` with `?token=`) is a different one |
| **This task** | The reset-link and token **logging** part (AU-10 second half; HSEC-25 logs channel), as requested |
| **Not done (still open in CF-023)** | HTML escaping of every template (HSEC-06 / INT-07), and the receipt-recipient restriction plus per-tenant rate limit, including the `super_admin` override verification from the plan. These are the actual §8.2 acceptance criteria, so **CF-023 is not closed** |

**Pre-checks**
- All recorded fingerprints matched before starting:
  - CF-025 tracked-excluding set `ec31679bb21dc8a2…` and untracked set `f644c54b3d3389b7…`;
  - CF-025 files `3f1a85ebef9d7d29…`;
  - CF-035 module `5765100bab8d5af2…`;
  - CF-048 ignore files `a9fe70c945de074c…`;
  - FU1 `redirect.ts` `4c806b8ffa7c645d…`;
  - the CF-132 line.
- Full tree at the start: tracked `645186ca53da3a92…`, untracked `5619d4c4463acfae…`.

### 5D.2 Trace of the reset flow

**1. Request.** `POST /api/auth/forgot-password` (`auth.routes.ts:177-203`):
- per-IP limit 20/min, plus a per-email Redis limit;
- always answers 200;
- calls `requestPasswordReset` fire-and-forget, with `.catch(err => app.log.error({ err }, …))`.

**2. Token.** `auth.service.ts:128-151`:
- `randomBytes(32)` hex;
- only the **SHA-256 hash** is stored (`passwordResetToken.tokenHash`, with `expiresAt` = now + `RESET_TOKEN_TTL_MS` = 1 h, and the IP);
- unknown or inactive users return silently.

**3. Delivery.** `sendPasswordResetEmail` (`email.ts`) builds the URL with `buildPasswordResetUrl` (CF-085).
- **With** `RESEND_API_KEY`, the URL goes only into the e-mail HTML.
- **Without** it, the fallback runs, which was the leak.

**4. Use.** `POST /api/auth/reset-password`:
- 5 per 5 min;
- the token is in the **POST body**;
- the hash is looked up;
- expired or used tokens are rejected;
- atomic single use (`updateMany … usedAt: null`);
- other errors go to `app.log.error(err)`.

**Where a reset URL or token could reach console or logs:**

| Path | Condition | Exposure (before) |
|---|---|---|
| **`email.ts` fallback, `console.log("[DEV] Password reset link for <email>: <full URL with token>")`** | `RESEND_API_KEY` unset, in **any** `NODE_ENV`, production included (Phase 2 HSEC-25, Phase 6 §9, Phase 8 INFRA-07) | **Live token, full URL and recipient e-mail.** This is the leak |
| `forgot-password` `.catch` → `app.log.error({ err })` | DB or provider errors | Only error objects. A Prisma validation error could echo the `create` arguments, which contain the **hash**, not the raw token. The hash cannot be used to reset |
| `reset-password` `app.log.error(err)` | Non-token errors | Same as above; the raw token is not passed into DB arguments |
| Fastify request logging | `info` only in `development` (`index.ts:44`), `warn` otherwise | The reset API takes the token in the **body**, which is not logged. The SPA page `/reset-password?token=` is served by Vite in development and by the API's not-found handler in production, where requests aren't logged at `warn` |
| Sentry | `onError` with the request URL | POST URLs carry no token |
| Caddy | no `log` directive | No access log |
| GA `page_view` (`?token=`) | `VITE_GA_MEASUREMENT_ID` built in | Analytics, not logs: CF-135 (W12), not in this task |

### 5D.3 Intended behaviour (from the audit) and the policy decision

- **Phase 6 remediation L1** (INT-07, HSEC-06, HSEC-15, HSEC-25): "remove the stdout fallback **outside development**."
- **Phase 2 HSEC-25:** the stdout leak exists "in any environment" when Resend is unset (LOW–MEDIUM).
- **Code comment:** the fallback exists so a developer can see the link locally. That is the local-development workflow.
- **Unambiguous, implemented:** outside `NODE_ENV=development`, never print the link, the token or the recipient, and keep a non-sensitive warning that the e-mail was not sent.
- **Not decided, left unchanged:** what happens **in development**. The audit keeps the console link. The W1 plan text said to log only "email skipped", which would remove the only way to complete a reset locally without an e-mail provider. Development behaviour is therefore **unchanged**, and the options are listed in §5D.7.

### 5D.4 Change (worktree)

| File | Change |
|---|---|
| `apps/api/src/shared/utils/email.ts`, `sendPasswordResetEmail` fallback | **`NODE_ENV === 'development'`:** the same `console.log` link as before (unchanged).<br>**Any other environment:** `console.warn('[email] password reset e-mail not sent: RESEND_API_KEY is not configured')`, with no URL, token or recipient.<br>Token generation, hashing, TTL, single use, rate limits, the URL format and the configured-Resend path are all unchanged |
| `apps/api/src/shared/utils/__tests__/reset-email-logging.test.ts` (new, 9 tests) | See §5D.5 |

### 5D.5 Tests and results (actually run; worktree)

**How the tests work**
- The tests capture `console.log/info/warn/error/debug`, so nothing is printed.
- `resend` is mocked: no network.
- Every check on captured output is a **boolean**, so a failure cannot echo a token.

**Cases**
- **`NODE_ENV=production` and `test`, Resend unset:**
  - no token, no `reset-password?` URL, no recipient in any log line;
  - exactly one non-sensitive warning mentioning `RESEND_API_KEY`;
  - the provider is not called.
- **`development`, Resend unset:** the console link is still printed (the documented local workflow).
- **Resend set, in `production` and `development`:** the e-mail is sent once to the recipient, the token is only in the HTML, and nothing is logged.

**Red, before the fix:** **4 failed / 5 passed.** Production and test leaked the link, token and recipient, and had no non-sensitive warning.

**Correction made during the red run.** One failing assertion first used a regex `toMatch` on the captured output. On failure, vitest echoed the captured log text, so the **dummy** token appeared once, in a temporary local log file (`/tmp`, deleted). The assertions were changed to boolean-only and re-run: 0 occurrences. No real token was involved.

**Green, after the fix:** 9 / 9. The CF-085 `email-links.test.ts` still passes 11 / 11. Dummy tokens in the output: 0.

**Mutation check** (applied, run, restored; `email.ts` checksum `ba2021c1537123cc…` identical before and after; 0 tokens printed in every run)

| Mutation | Result |
|---|---|
| M1: environment guard removed (always print the link) | **4 failed** |
| M2: the non-development warning includes the recipient | **2 failed** |
| M3: the non-development branch is silent (diagnostic removed) | **2 failed** |

**Full checks**

| Check | Command | Result |
|---|---|---|
| API suite | `pnpm --filter @hesba/api test` | **exit 0: 19 files, 158 passed** (149 + 9). Dummy tokens printed: 0 |
| API type-check | `pnpm --filter @hesba/api type-check` | **exit 0** |
| API lint | `pnpm --filter @hesba/api lint` | **exit 0** |
| API build | `pnpm --filter @hesba/api build` | **exit 0** |
| Web suite (unaffected) | `pnpm --filter @hesba/web test` | **exit 0: 55 passed** |

### 5D.6 Diff review and preservation

- **CF-023 tracked change:** one hunk in `email.ts` (the fallback, about +9 / −2), plus 1 new test file.
- **Proof that only that hunk changed:** with the CF-023 hunk temporarily undone, the full tracked-diff fingerprint equals the one recorded at the start of CF-023 (`645186ca53da3a92…`), and `email.ts` was then restored byte-identical. Untracked files excluding the new test: `5619d4c4463acfae…`, unchanged.
- **So these are intact:** CF-132, CF-085 (including `buildPasswordResetUrl` in the same file), FU1 with S1/S2, CF-048, CF-035 and CF-025.
- **Main checkout:**
  - same four entries;
  - `git diff` fingerprint `439b10007f77b183…`;
  - overview `c45dd64cc9e53b0f…`;
  - 0 staged;
  - `claude/ui-pos-merge-split` @ `8846bce`.
- **Scratch files:** the scratchpad is empty and the temporary logs are deleted.

### 5D.7 Remaining risks and decisions

1. **Development behaviour (decision needed).**
   - **(A)** Keep printing the link in development. This is current behaviour and matches audit L1.
   - **(B)** Never print it, and require a local mail catcher. This breaks resets without a provider.
   - **(C)** Print only with an explicit opt-in (e.g. `EMAIL_DEV_PRINT_LINKS=true`) in development.
2. **`NODE_ENV` defaults to `development`** when unset (`env.ts`). A deployment that forgets `NODE_ENV` would print reset links again.
   - The `Dockerfile` sets `NODE_ENV=production` (line 77), so the compose and Railway builds are covered.
   - CF-047 (fail-fast production config, an open decision) is the place to guard against this.
3. **Other fallbacks still log PII outside development** when Resend is unset: `email.ts:136` (billing and trial e-mails: recipient plus template data), `:232` (receipt: recipient), `:267` (installment reminder: customer e-mail plus data). They carry **no reset tokens**, but Phase 6 L1 covers them too. They were not changed, to keep this task minimal.
4. **CF-023 proper is still open:** HTML escaping (HSEC-06 / INT-07) and the receipt-recipient restriction (§8.2).
5. **CF-135, the GA channel:** `?token=` in `page_view` when GA is built in (W12).

---

## 5E. CF-023 (continued): e-mail HTML escaping done; receipt-recipient policy ambiguous

### 5E.1 Acceptance criteria and scope boundaries

**Phase 10 §8.2, CF-023:**
- **Criterion:** "Interpolated values are HTML-escaped in every template; receipt recipients are limited to the customer's address on file (or a permissioned override)".
- **Failure path:** "injection payloads in the store name and notes".
- **Recovery:** "legitimate receipts still deliver".
- **Source tests:** the Phase 2 HSEC-06 test and RT6-M.
- **Phase 2 HSEC-06 also recommends:** "per-tenant send quota".

| Part | Finding IDs | Status |
|---|---|---|
| Reset link and token in logs | AU-10 (second half); HSEC-25 logs channel | **Done**, §5D. Not modified here, verified intact |
| **HTML escaping of every template** | **HSEC-06, INT-07, AU-10 (first half)** | **Done in this task** |
| **Receipt-recipient restriction (plus per-tenant quota)** | **HSEC-06** | **Not implemented: the policy is ambiguous**, §5E.4 |
| GA `page_view` carrying `?token=` | **CF-135** / HSEC-25 analytics channel (W12) | Not in scope; untouched |
| Other dev fallbacks logging recipient PII | Phase 6 L1 | Separate open issue (§5D.7 #3); untouched |

**Pre-checks: all matched.**
- AU-10 `email.ts` `ba2021c1537123cc…`;
- CF-025 files `3f1a85ebef9d7d29…`;
- CF-035 `5765100bab8d5af2…`;
- CF-048 `a9fe70c945de074c…`;
- FU1 `4c806b8ffa7c645d…`;
- the CF-132 line;
- untracked set excluding the AU-10 test, `5619d4c4463acfae…`.

Full tree at the start of this task: tracked `fe0635dee0f3a9ea…`, untracked `30273f41620bd692…`.

### 5E.2 Trace: templates and controlled values (all in `apps/api/src/shared/utils/email.ts`, the only module building e-mail HTML)

| Template / function | Interpolated values, by origin | Caller |
|---|---|---|
| `billingEmailHtml` (`payment_succeeded`, `payment_failed`, `subscription_suspended`, `subscription_cancelled`, `trial_expired`, `trial_ending_soon`, `subscription_cancellation_scheduled`, plus the `default` branch) | **Tenant-controlled:** `tenantName` (store name), every template. **Server:** `amount`, `period`, `daysRemaining`, `periodEnd`, and `checkoutUrl` in an `href`. **The `default` branch dumped `JSON.stringify(data)` raw** | `sendEmail` from `billing.service.ts`, `billing.routes.ts` and `trial-expiry.job.ts` |
| `buildReceiptHtml` | **Tenant- or user-controlled:** `productName` (product, service, or **free-text `lineDescription`**), `customerName`, `paymentMethodName`. **Server:** `invoiceNumber`, `quantity`, the date, `fmtMoney` numbers | `sendInvoiceReceiptEmail` ← `POST /api/invoices/:id/email-receipt` |
| Installment reminder HTML | **Tenant- or user-controlled:** `customerName`, `storeName`. **Server:** `installmentNumber`, `dueDate`, the amount | `sendInstallmentReminderEmail` ← `installment-reminders.job.ts` |
| Password reset HTML | `resetUrl` in an `href` (server-built, CF-085) | `sendPasswordResetEmail` ← `auth.service.ts` |

**Before:** no value in any template was escaped. Subjects are plain-text MIME headers sent as JSON to the provider, not HTML, so they are deliberately not HTML-escaped.

### 5E.3 Change (worktree): escaping

**`email.ts`: one new exported helper, `escapeHtml(value)`.** It maps `& < > " '` to entities, which is safe for both text and double-quoted attribute contexts. It is applied to every interpolation of non-constant values in the HTML bodies (21 edits):

| Template | Escaped values |
|---|---|
| Billing | `tenantName` (as `name`), `amount`, `period`, `daysRemaining` (body), `periodEnd`, both `checkoutUrl` hrefs, and the `default` branch's JSON |
| Receipt | `productName`, `quantity`, `invoiceNumber`, the date string, `customerName` (with its `'نقدي'` fallback), `paymentMethodName` |
| Reminder | `customerName`, both `installmentNumber` occurrences, `dueDate`, `storeName` |
| Reset | the `resetUrl` href |

**Deliberately left as they were:**
- the `Number(...)`-coerced amounts (`fmtMoney`, the reminder amount), which cannot carry markup;
- internal constants and fragments (titles, tone colours, `${body}`);
- subjects;
- the AU-10 fallback and the CF-085 URL builder.

**No behaviour change for legitimate content.** Arabic text is untouched, and `&` becomes `&amp;`, which renders as `&`. Links decode to exactly the same URL; in HTML, `&` in an `href` is correctly written as `&amp;`.

**New test:** `apps/api/src/shared/utils/__tests__/email-escaping.test.ts`, 16 tests (§5E.5).

### 5E.4 Receipt-recipient policy: AMBIGUOUS, not implemented (options for decision)

**Current behaviour** (`invoice.routes.ts:174-250`):
- `requirePermission('invoices','read')`;
- `recipient = body.to ?? invoice.customer?.email`, where `body.to` can be any valid e-mail;
- no rate limit;
- an audit row (`email_receipt`, `after.to`).

The web dialog (`Invoices.tsx:233-247`) pre-fills the customer's address but leaves it **editable**.

**Why it is ambiguous:**

| Source | Points to |
|---|---|
| Audit (Phase 2 HSEC-06, Phase 10 §8.2) | Restrict to the customer's address on file, "or a permissioned override". The override permission is not named |
| Code intent | The `sendInvoiceReceiptEmail` docstring says "Email an invoice receipt to the customer **(or any address)**"; the route comment says `to` "wins" over the customer address; the UI field is deliberately editable |
| Business case in the code | Walk-in cash sales (`customerName ?? 'نقدي'`) have no customer record, so **no address on file**. A strict restriction removes e-mailed receipts for them |
| Project docs | Receipt e-mailing is not described in any non-audit document |
| Earlier planning answer (W1 plan) | "Customer on file only", with the `super_admin` bypass as override. That predates this trace of the walk-in use case and the docstring. The `super_admin` safety check (whether the slug can be obtained by a non-owner through role PATCH or DELETE) is still unverified |

**Options (none implemented):**

| Option | Effect | Needs |
|---|---|---|
| **R1. On-file only, `super_admin` override** (the earlier plan answer) | Closes the relay. Walk-in customers can only get e--mailed receipts from the owner | The `super_admin` slug-safety verification first; a UI change (lock the field for non-owners) |
| **R2. On-file, or a new permission (e.g. `invoices:email_any`)** | Matches the audit's "permissioned override" literally | A new permission in role data: a **role-data migration** for existing tenants, which W1 excludes (backfill). Fits W3 |
| **R3. Any address, but a per-tenant quota plus escaping, and the audit log kept** | Keeps the walk-in workflow; limits relay volume (HSEC-06's "per-tenant send quota") | A quota number. It does **not** meet the §8.2 criterion literally, so it would need a recorded risk acceptance |
| **R4. On-file, or an address entered at sale time and stored on the invoice** | Keeps walk-in receipts without an open relay | A schema change (an invoice e-mail column) plus a POS change. Larger; W5 or W12 |

### 5E.5 Tests and results (actually run; worktree)

**`email-escaping.test.ts` (16 tests)**
- `resend` is mocked and the HTML is captured from the mock, so there is no network.
- **Injection payload:** `<script>alert(1)</script><img src=x onerror="alert(2)">'"`, put into every tenant/user field of:
  - all 8 billing branches (including `default`);
  - the receipt (product name, customer, payment method, invoice number);
  - the reminder (customer, store, due date).
- **Assertions:** no raw `<script`, `<img` or `onerror="alert(2)"`; the escaped form is present.
- **Legitimate content:** `متجر الأمل & شركاه` renders as `…&amp;…`; a real receipt is sent once, with the invoice number, item names (`شاي &amp; سكر`) and the total `114.00`; a real reminder keeps its name, date and store.
- **Links:**
  - the trial checkout `href` decodes to exactly the input URL (`&` included);
  - a `"` in a link cannot break out of the attribute;
  - the reset `href` decodes to exactly `buildPasswordResetUrl(token)`, compared as a **boolean**, so the dummy token is never printed.

**Red, before the fix: 14 failed / 2 passed.**
- Every injection case failed, showing markup passed through raw in all templates.
- The legitimate-content cases failed because `&` was not encoded.
- The two link round-trips passed.

**Green, after the fix:** 16 / 16. The AU-10 `reset-email-logging.test.ts` (9) and CF-085 `email-links.test.ts` (11) still pass: **36 / 36** for the three files.

**Dummy tokens in any output:** 0, in every run including the mutation runs.

**Mutation check** (applied, run, restored; `email.ts` checksum `cdcda0cf2c964b29…` identical before and after)

| Mutation | Result |
|---|---|
| M1: `escapeHtml` returns its input unchanged | **14 failed**, the same set as the red run. The **first M1 attempt produced a syntax error** (the test file failed to load: "no tests"). It is not counted, and was redone as a valid no-op. A side type-check of that mutant used a wrong `-p` path and is not meaningful |
| M2: quotes not escaped | **10 failed**, including the `href` break-out test |
| M3: `&` not escaped | **3 failed:** the three legitimate-content tests |
| M4: product/line names not escaped | **2 failed:** the receipt tests |

**Full checks**

| Check | Command | Result |
|---|---|---|
| API suite | `pnpm --filter @hesba/api test` | **exit 0: 20 files, 174 passed** (158 + 16). Dummy tokens printed: 0 |
| API type-check | `pnpm --filter @hesba/api type-check` | **exit 0** |
| API lint | `pnpm --filter @hesba/api lint` | **exit 0** |
| API build | `pnpm --filter @hesba/api build` | **exit 0** |
| Web suite (unaffected) | `pnpm --filter @hesba/web test` | **exit 0: 55 passed** |

### 5E.6 Diff review and preservation

- **This task changed:**
  - `email.ts`: the `escapeHtml` helper plus 21 `escapeHtml(...)` wrappings;
  - 1 new test file.
- **Everything else is unchanged:**
  - tracked diff excluding `email.ts`: `eb0d0690567dc750…`, the same as at the end of AU-10;
  - untracked files excluding the new test: `30273f41620bd692…`, the same as at the start of this task.
- **Inside `email.ts`, verified verbatim with literal (`grep -F`) checks:**
  - the AU-10 environment guard, development `console.log` line and non-development warning;
  - the CF-085 `URLSearchParams` builder and `/reset-password?` return.

  A first check used a double-quoted pattern, which the shell expanded, so it wrongly showed 0. It was redone with literal patterns: all present.
- **Intact:** CF-132, CF-085, FU1 (with S1 / S2), CF-048, CF-035, CF-025 and AU-10.
- **Main checkout:**
  - same four entries;
  - `git diff` fingerprint `439b10007f77b183…`;
  - overview `c45dd64cc9e53b0f…`;
  - 0 staged;
  - `claude/ui-pos-merge-split` @ `8846bce`.
- **Scratch files:** the scratchpad is empty and the temporary logs are deleted.

### 5E.7 Remaining risks

1. **The receipt endpoint is still an open relay.** Any user with `invoices:read`, including cashiers, can send store-branded e-mail from the platform's `EMAIL_FROM` to **any** address, with **no** rate limit. The content is now escaped, but the destination is free. A decision is needed (§5E.4).
2. **Link schemes are not validated.** `checkoutUrl` and `resetUrl` are server-built from configuration (`FRONTEND_URL`, `APP_BASE_DOMAIN`), not user input, so escaping is sufficient. If a future caller passes user-supplied URLs, add scheme validation.
3. **No `reply_to` on tenant-facing mail** (INT-07). Not in §8.2; not changed.
4. **Plain-text subjects** include server values only (the invoice number, `daysRemaining`). They are not HTML.
5. **CF-135 (GA token channel) and the other PII fallbacks** remain separate open items.

---

## 5F. CF-023 (continued): receipt-recipient restriction, policy R1

### 5F.1 Decision and pre-checks

**Owner decision:** R1, subject to verifying the owner authorization model first.
- By default, a receipt goes only to the customer's address on file.
- Only a securely verified store owner may override the recipient.
- A cashier must not reach arbitrary addresses.
- With no address on file there is no silent fallback to a typed address. Non-e-mail receipts (print) are preserved.

**Pre-checks: all matched.**
- Escaping plus AU-10 `email.ts` `cdcda0cf2c964b29…`; AU-10 test `969b372d6fcaf5b0…`;
- tracked diff excluding `email.ts` `eb0d0690567dc750…`; untracked files excluding the escaping test `30273f41620bd692…`;
- CF-025 `3f1a85ebef9d7d29…`, CF-035 `5765100bab8d5af2…`, CF-048 `a9fe70c945de074c…`, FU1 `4c806b8ffa7c645d…`.

Full tree at the start of R1: tracked `08b9f6a3bd305a5d…`, untracked `6b0c47e69188fa7e…`.

### 5F.2 Owner authorization model: verified server-side

| Question | Evidence | Result |
|---|---|---|
| Who is the "store owner"? | Registration creates the owner user with the **system role `super_admin`** (`tenant.service.ts:119-128`). No separate owner flag exists in any schema (searched for `isOwner`, `ownerId`, `owner_user`) | Owner ≡ holder of the system `super_admin` role. Only an existing `super_admin` can create another (deliberate delegation) |
| Can request data claim it? | `authenticate` runs `jwtVerify()`. The token is signed with the server-only `JWT_ACCESS_SECRET`; verification is HS-only with a required signature (Phase 2 control **C-02**, verified in `fast-jwt`). `roleSlug` and `permissions` are set only at login and refresh from the user's **database** role row (`auth.service.ts:58-65`; refresh `auth.routes.ts:147-155`). The route reads `request.user.roleSlug` only | No. Body, query or header values cannot set `roleSlug` |
| Can tenant context be swapped? | `authenticate` binds the token's `tenantId` / `schemaName` to the resolved tenant (HESBA-SEC-01, `authenticate.tenant-binding.test.ts`). Platform-admin tokens fail this binding | No |
| Can a non-owner be assigned `super_admin`? | `POST /users`: a non-`super_admin` creator is refused when `targetRole.slug === 'super_admin'`, and must hold every permission it grants (`permissionsWithinActor`, HESBA-SEC-02). No route re-assigns an existing user's role (CF-024) | No |
| Can a role be turned into `super_admin`? | `POST /roles`: slugs are unique, and the system `super_admin` role always exists, so creating that slug returns 409. `PATCH /roles/:id` accepts only `permissions` and `name`, **never the slug**. System roles cannot be edited or deleted (`system_role_readonly`) | No |
| Stale claims | Claims live up to the 15-minute access-token lifetime (CF-118). Roles cannot be changed after creation, so there is no demotion window to exploit today | Residual, noted |

**Conclusion:** `request.user.roleSlug === 'super_admin'` is a secure, server-verified owner check. It is the same root-role signal `requirePermission` already uses for its bypass.

### 5F.3 Receipt flow trace and walk-in representation

| Step | Fact |
|---|---|
| Web dialog (`Invoices.tsx`, before) | Opened from the invoice drawer; **an editable** e-mail field pre-filled with `customer.email`; sends `{ to }` |
| Route (`invoice.routes.ts`, before) | `requirePermission('invoices','read')`; `recipient = body.to ?? invoice.customer?.email`. Any address from any reader, **including cashiers**. No rate limit; audit row `email_receipt` with `after.to` |
| Sender | `sendInvoiceReceiptEmail({ to: recipient, … })`, so the recipient passed is exactly the one the route picked (HTML escaped since §5E) |
| Walk-in sale | `invoice.customerId = null` (the POS sends `customerId: customer?.id`); the receipt shows `'نقدي'` |
| Customer without e-mail | `Customer.email` is nullable |
| Non-e-mail receipts | POS print after the sale (`printReceipt`, `POS.tsx:1066`) and the A4 print (`printInvoice`, `Invoices.tsx`). Both are client-side and **independent of the e-mail route** |

**Fit with the audit criterion** (Phase 10 §8.2: "limited to the customer's address on file (or a permissioned override)"): the owner role is the permissioned override, and printing covers walk-in sales. There is **no conflict** with any required walk-in behaviour, so R1 was implemented.

### 5F.4 Change (worktree)

**`apps/api/src/modules/invoices/invoice.routes.ts`, the email-receipt route (server enforcement)**
- `to` is now `z.string().trim().email()` (padded input is trimmed instead of being rejected).
- `onFile = customer.email` (trimmed) or null.
- A request is an **override** when a `to` is given and differs from `onFile`, case-insensitively.
- **An override by a non-`super_admin` → 403 `recipient_override_forbidden`.** Nothing is sent and no audit row is written.
- `recipient = override ? to : onFile`. No recipient → 400 `no_email`.
- The existing `actor` declaration moved up; it is reused for the audit row.
- The success path is unchanged: escaped HTML, audit row, `{ sentTo }`.

**`apps/web/src/lib/receipt-recipient.ts` (new, UI only)**
`receiptRecipientRule(isOwner, onFile)`:
- owner → editable and pre-filled;
- non-owner with an address on file → fixed to it;
- non-owner without one → cannot send.

**`apps/web/src/pages/invoices/Invoices.tsx`**
- `isOwner` comes from the auth store (`roleSlug === 'super_admin'`); the server remains the enforcement point.
- The field is **read-only** for non-owners.
- With no address on file, a non-owner sees "لا يوجد بريد مسجّل لهذا العميل. يمكنك طباعة الفاتورة بدلاً من ذلك …" ("No e-mail on file for this customer. You can print the invoice instead…"), and Send is disabled.
- The `to` sent for non-owners is the address on file, which the server accepts.

**Tests:**
- `apps/api/src/modules/invoices/__tests__/email-receipt.recipient.test.ts` (new, 20 tests);
- `apps/web/src/lib/__tests__/receipt-recipient.test.ts` (new, 7 tests).

### 5F.5 Tests and results (actually run; worktree)

**`email-receipt.recipient.test.ts`**
- **How it runs:** the real `invoiceRoutes` via `fastify.inject`. Permissions come from the **real** `SYSTEM_ROLES`, and `roleSlug` only from the token stand-in. The tenant DB, e-mail sender and audit are stubbed. Recipient checks are **boolean-only**, so no address is printed.
- **Allowed:**
  - `cashier`, `branch_manager` and `accountant` with no `to` → the address on file, with one audit row;
  - a `cashier` `to` equal to the address on file (different case and spaces) → sent to the **stored** address;
  - owner → another address; owner on a walk-in sale → the typed address; owner with no `to` → the address on file.
- **Denied:**
  - `cashier` / `branch_manager` → another address: **403**, not sent, no audit row;
  - `cashier` on a walk-in sale, or a customer without an e-mail, with a typed address: **403**;
  - `cashier` with no address on file and no `to`: **400 `no_email`**;
  - owner with no address and no `to`: **400**.
- **UI-bypass attempts by a cashier:**
  - owner claims in the body (`roleSlug: 'super_admin'`, `isOwner`, `override`);
  - an array of recipients;
  - a comma-separated list.

  All refused (400 or 403), and nothing is sent.
- **Unchanged:** invalid e-mail → 400; unknown invoice → 404; `inventory_keeper` (no `invoices:read`) → 403 `forbidden` before any DB access.

**Red, before the fix: 7 failed.** Cashier and branch-manager overrides went through (200 instead of 403), as did the walk-in and no-e-mail typed addresses and the body-claim bypass. A padded matching address got 400.

**Test-harness fix during the red run:** one failure (`inventory_keeper` … "before anything else") was caused by the test itself. The DB spy was not reset between tests. It was fixed in the test setup; the code was not changed for it.

**Green, after the fix:** 20 / 20, with **0** recipient addresses in the output.

**Mutation check** (applied, run, restored; `invoice.routes.ts` checksum `c6e2c7420637215f…` identical before and after; 0 addresses printed)

| Mutation | Result |
|---|---|
| M1: owner check removed | **5 failed:** every non-owner override, plus the body-claim bypass |
| M2: role read from the request body (the bypass vector) | **1 failed:** body-claim bypass |
| M3: case-sensitive comparison with the address on file | **1 failed** |

**Full checks**

| Check | Command | Result |
|---|---|---|
| API suite | `pnpm --filter @hesba/api test` | **exit 0: 21 files, 194 passed** (174 + 20). Tokens printed 0; addresses printed 0 |
| API type-check / lint / build | `pnpm --filter @hesba/api type-check` / `lint` / `build` | **exit 0 / 0 / 0** |
| Web suite | `pnpm --filter @hesba/web test` | **exit 0: 3 files, 62 passed** (55 + 7) |
| Web type-check | `pnpm --filter @hesba/web type-check` | **exit 0** |
| Web ESLint on touched files | `eslint` on `Invoices.tsx`, `receipt-recipient.ts` and its test | **exit 0, 0 errors, 1 warning:** `Invoices.tsx:134` `label-has-associated-control`. This is the **pre-existing** "return reason" `<label>` (HEAD line 132, shifted by 2 import lines), outside every changed hunk |
| Web lint (full) | `pnpm --filter @hesba/web lint` | **exit 0: 0 errors, 55 warnings** (unchanged count) |
| Web build | `pnpm --filter @hesba/web build` | **exit 0** |
| Not run | A rendered dialog test; a DB-backed end-to-end send (no integration suite, Docker off) | — |

### 5F.6 Diff review and preservation

- **R1 changed:**
  - `invoice.routes.ts`: one route;
  - `Invoices.tsx`: +25 / −13;
  - new: `receipt-recipient.ts` and 2 test files.
- **Everything else is byte-identical:**
  - tracked diff excluding the R1 files: `08b9f6a3bd305a5d…`, the same as at the start of R1;
  - untracked files excluding the R1 files: `6b0c47e69188fa7e…`, the same as at the start.
- **Re-verified fingerprints:** escaping plus AU-10 `email.ts` `cdcda0cf2c964b29…`; CF-025 `3f1a85ebef9d7d29…`; CF-035 `5765100bab8d5af2…`; CF-048 `a9fe70c945de074c…`; FU1 `4c806b8ffa7c645d…`. CF-132 and CF-085 are inside the unchanged tracked set.
- **Main checkout:**
  - same four entries;
  - `git diff` fingerprint `439b10007f77b183…`;
  - overview `c45dd64cc9e53b0f…`;
  - 0 staged;
  - `claude/ui-pos-merge-split` @ `8846bce`.
- **Scratch files:** the scratchpad is empty.

### 5F.7 Remaining risks

1. **No per-tenant send quota.** Phase 2 HSEC-06 recommends one, but it is not in §8.2. Volume is now bounded only by the customers' own addresses on file, plus owner overrides.
2. **"Owner" means any `super_admin`.** Owners can create additional `super_admin` users; that is deliberate delegation. Claims last up to 15 minutes (CF-118 / CF-024 for revocation).
3. **No staff-level opt-out.** If a customer's address on file is wrong, staff cannot correct it at send time; the owner can, or the customer record can be edited.
4. **The audit row stores the recipient** (`after.to`), as before. That is the product audit trail, not console or diagnostic logging.
5. **Still separate:** other PII fallbacks (§5D.7 #3), CF-135, and `NODE_ENV` defaulting to development (CF-047).

### 5F.8 Final CF-023 review: is every `super_admin` meant to have the override? (2026-10-13)

**Method:** documentation and code review only. **No code was changed.**

**Fingerprints verified at the start (all matched):**
- R1 `invoice.routes.ts` `c6e2c7420637215f…`;
- tracked diff excluding the R1 files `08b9f6a3bd305a5d…`; untracked files excluding the R1 files `6b0c47e69188fa7e…`;
- escaping plus AU-10 `email.ts` `cdcda0cf2c964b29…`; AU-10 test `969b372d6fcaf5b0…`;
- CF-025 `3f1a85ebef9d7d29…`, CF-035 `5765100bab8d5af2…`, CF-048 `a9fe70c945de074c…`, FU1 `4c806b8ffa7c645d…`;
- the CF-132 line and the CF-085 builder.

**Note:** `Invoices.tsx` and `receipt-recipient.ts` were not checksummed at the end of R1. Their baselines are recorded now (`2d8fc9f91ce4a749…`, `f07f24ca1ff10d85…`), and their behaviour was re-verified by the tests below.

Full tree before and after this review: tracked `f214498b3d0cbce0…`, untracked `b0aac6573bff209d…`. **Unchanged.**

**Evidence on the intended policy**

| Source | Says |
|---|---|
| `documents/Markdown/Hesba_Logic_Flow_Document.md` §12 (user management) | "[2] اختيار الدور: **Super Admin** / Branch Manager / Cashier / …" ("[2] choose the role: Super Admin / …"). Super Admin is a role chosen **when adding users**, so **multiple Super Admins are an intended product feature** |
| `documents/Hesba_Project_Overview.md` §5 (user's untracked doc; read only) | Permissions live in each role and the JWT; "الـ `super_admin` بيعدّي أي فحص" (**`super_admin` bypasses every check**). The seed creates "المستخدم المالك (super_admin)" (**the owner user is the `super_admin`**) |
| `documents/Markdown/Hesba_Business_Document.md` §5, §14.4 | Super Admin: full rights in every area, including settings and fee configuration |
| `documents/Hesba_Implementation_Roadmap.md:809` | "ETA configuration (**Super Admin only**)": sensitive capabilities are granted by role, not to a single owner |
| Code | `tenants.ownerEmail` / `ownerName` are used only as the **billing contact** (trial and renewal e-mails) and in admin search, **never for authorization**. No single-owner user flag exists in any schema |
| Phase 2 control **C-04** | "Escalation guard (subset rule, immutable system roles)": CONFIRMED. A non-`super_admin` cannot mint or assign `super_admin` (re-confirmed in §5F.2) |
| Phase 10 §8.2 CF-023 | "limited to the customer's address on file (**or a permissioned override**)" |

**Conclusion: the policy is clear and supports the implementation.**
- The product defines Super Admin as the store's root, full-authority role, assignable by an existing Super Admin, and bypassing every permission check.
- The codebase establishes **no** single-owner authorization concept, so none was invented.
- Granting the recipient override to every `super_admin` is consistent with the documented role model, and it is a "permissioned override" in the §8.2 sense. Super Admin holds every permission, and only a Super Admin can create another (C-04).

**The 15-minute caveat**
- Claims (`roleSlug`, `permissions`) live for the access-token lifetime, 15 minutes (`JWT_ACCESS_EXPIRES_IN`).
- **Today no route can change an existing user's role or deactivate a user** (CF-024, P1, W9), so there is no demotion window to exploit yet.
- When W9 adds deactivation or re-roling, **CF-024's acceptance criterion** (Phase 10 §8.2: "a deactivated user's refresh fails at once and their access token is rejected within the claim-cache TTL") and **CF-118** (claims never reloaded, W9) govern this window. **Owner:** W9; not a CF-023 defect.

**Checks run in this review (actual results)**

| Check | Result |
|---|---|
| Focused API tests (`email-receipt.recipient`, `email-escaping`, `reset-email-logging`, `email-links`) | exit 0: **4 files, 56 passed**; dummy tokens 0, test addresses 0 in the output |
| Web R1 helper (`receipt-recipient.test.ts`) | exit 0: **7 passed** |
| `pnpm --filter @hesba/api test` / `type-check` / `lint` | exit 0: **194 passed** / exit 0 / exit 0 |
| `pnpm --filter @hesba/web test` / `type-check` / `lint` | exit 0: **62 passed** / exit 0 / exit 0 (0 errors, 55 pre-existing warnings) |
| **Not run:** a real-database receipt send, and a rendered-dialog test | **Not performed.** No integration suite exists and Docker is off. **CF-023 has no end-to-end validation.** The evidence is route-level (`fastify.inject` with the real routes and real role seed, but a stubbed DB and sender) plus unit-level |

**Recommendation.** Every Phase 10 §8.2 CF-023 criterion is implemented and verified at route and unit level:
- HTML escaping in every template, with injection payloads rendered harmless and legitimate receipts still sent;
- recipients limited to the address on file, with a permissioned override (`super_admin`);
- AU-10 log exposure removed outside development.

**CF-023 can be closed at code level**, provided the following are recorded:
1. End-to-end validation (a DB-backed send and the rendered dialog) is still pending, and must run once the integration suite exists, before release.
2. These are tracked as separate items, not CF-023 blockers:
   - the per-tenant receipt send quota (HSEC-06 recommendation, not in §8.2);
   - other e-mail fallbacks logging recipient PII outside development;
   - CF-135 (GA token channel);
   - `NODE_ENV` defaulting to development (CF-047);
   - claim staleness (CF-024 / CF-118, W9).

**Status: left as "partial" in the status board** until the owner explicitly accepts closure.

### 5F.9 Closure decision: CF-023 closed at code level (2026-10-13)

| Item | Record |
|---|---|
| **Decision** | **CF-023 is closed at code level**, by explicit owner decision, on the evidence and documented policy in §5F.8 |
| **Policy** | The receipt-recipient override is available to **every user holding the system role `super_admin`**, under the project's current role model. The model defines Super Admin as the store's root role: assignable by an existing Super Admin, and bypassing every permission check (Logic Flow §12; Project Overview §5; Phase 2 control C-04). Everyone else may only send to the customer's address on file. No single-owner rule was introduced |
| **What was implemented** | AU-10 reset-link logging (§5D); HTML escaping in every e-mail template (§5E); the receipt-recipient restriction R1, server-enforced, with the UI aligned (§5F) |
| **Evidence level** | Route level (`fastify.inject` with the real routes and the real role seed; stubbed DB and e-mail sender) and unit level only. All suites pass (§5F.8). **No end-to-end validation has been performed** |
| **Pre-release verification (NOT yet executed)** | 1. A **real-database receipt send**: a disposable Postgres/Redis integration test that sends a receipt (on-file allowed; non-owner override refused; owner override allowed; walk-in without an address refused for non-owners), with a mocked e-mail provider.<br>2. A **rendered recipient-dialog test** in the web app: read-only for non-owners, editable for `super_admin`, and the print hint with Send disabled when there is no address on file.<br>Both remain **required before release** and are **not** satisfied by this closure |
| **Not resolved by CF-023; still open as separate items** | **CF-135** (reset token in GA `page_view`, W12); **CF-047** (fail-fast production config, including `NODE_ENV` defaulting to development, which would re-enable the development reset-link log); other e-mail fallbacks logging recipient PII outside development (§5D.7 #3); the per-tenant receipt send quota (HSEC-06 recommendation, not in §8.2); claim staleness with a 15-minute access token (**CF-024 / CF-118**, W9) |
| **Code changed by this closure** | **None.** Documentation only (this file) |
| **Status clarification (2026-10-14 reconciliation)** | "Closed at code level" records the owner's decision only. CF-023 is a canonical P1 **release blocker** (Phase 10 §4.5). Its §8.2 recovery criterion ("legitimate receipts still deliver") and source test RT6-M are **not executed**, so CF-023 is **not cleared for release** and not operationally verified (§1.1, §7 G-E) |

## 5G. CF-022: the tenant reminder trigger ran the reminder cycle for every store (scoping only)

### 5G.1 Finding, scope and pre-checks

| Field | Value |
|---|---|
| Canonical ID | **CF-022** (P1; Release: **RB, CT**; W1) |
| Original IDs | HSEC-05 (Phase 2), J-08 (Phase 1). Bundled in Phase 10 W1 with CF-091 (DB-26) and CF-092 (BG-06) |
| Root cause (verified, static and Phase 5 runtime R1) | `POST /api/installments/send-reminders` (`installment.routes.ts`, `requirePermission('installments','update')`) called `runReminderCycle()`. That walks **every ACTIVE tenant** (`masterDb.tenant.findMany`), **outside** the job lock, and returned platform-wide counts (`tenants`). Phase 5 R1: a call from store A e-mailed store B's customer |
| Phase 10 §8.2 acceptance | "The reminder trigger touches only the caller's tenant, runs under the job lock, and sends one e-mail per payment per day" (RT-C3, RT-HSEC05) |
| **This task (approved)** | **Scoping only:** the caller's store only, under a lock compatible with the daily job, with store-only counts |
| **Not in this task** | **CF-091 / CF-092** (claim-before-send; "one e-mail per payment per day" under concurrency; skipping rows paid mid-cycle), and the DB-backed RT-C3 / RT-HSEC05 |

**Pre-checks: all matched.** Full tree tracked `f214498b3d0cbce0…` and untracked `b0aac6573bff209d…`; R1 `c6e2c7420637215f…`, `2d8fc9f91ce4a749…`, `f07f24ca1ff10d85…`; `email.ts` `cdcda0cf2c964b29…`; CF-025 `3f1a85ebef9d7d29…`; CF-035 `5765100bab8d5af2…`; CF-048 `a9fe70c945de074c…`; FU1 `4c806b8ffa7c645d…`.

### 5G.2 Change (worktree)

| File | Change |
|---|---|
| `apps/api/src/jobs/installment-reminders.job.ts` | The per-store loop body is extracted, **logic unchanged**, into **`runReminderCycleForTenant(t)`**, which touches only `getTenantDb(t.schemaName)`. Ignoring whitespace, no payment-selection, 24-hour dedupe, send or audit line changed; the body was only dedented one level.<br>**New:** `tenantReminderLockKey(id)` = `installment-reminders:tenant:<id>` and `TENANT_REMINDER_LOCK_TTL_MS` (25 min, the same as the cycle lock).<br>**`runReminderCycle()` (daily):** keeps the worker's global cycle lock, and now runs each store **inside that store's lock**. A store whose lock is held is skipped and counted in `skippedLocked`.<br>Types: `TenantReminderSummary`; `ReminderCycleSummary` adds `skippedLocked` |
| `apps/api/src/modules/installments/installment.routes.ts` | `send-reminders` now runs `runReminderCycleForTenant` for **`request.tenant` only**: the store resolved and bound to the token by `authenticate` (HESBA-SEC-01), never the request body or query.<br>It runs under the **same per-store lock** as the daily job; a held lock returns **409 `reminders_in_progress`**.<br>The response is that store's counts only (`sent`, `skippedNoEmail`, `skippedRecentlyReminded`, `errors`); there is no `tenants` count. The permission is unchanged (`installments:update`) |
| `apps/api/src/jobs/__tests__/installment-reminders.scope.test.ts` (new, 5 tests) | Job level (§5G.3) |
| `apps/api/src/modules/installments/__tests__/send-reminders.scope.test.ts` (new, 10 tests) | Route level (§5G.3) |

The web is unchanged. `Installments.tsx` reads only `sent`, `skippedNoEmail`, `skippedRecentlyReminded` and `errors`; a 409 shows its existing generic error toast.

### 5G.3 Tests and results (actually run; worktree; mocked DB, Redis and e-mail; no Docker)

**Job (`installment-reminders.scope.test.ts`)**
- `runReminderCycleForTenant(A)` never lists tenants, opens only `tenant_a`, e-mails only A's customer, and uses A's store name. Its summary has no `tenants` count.
- The daily cycle processes both stores, each under its **own** per-store lock (`SET … NX`), and releases the locks afterwards.
- With A's lock held, as during a manual run, the daily cycle **skips A** (`skippedLocked = 1`), processes B, and leaves A's lock in place.
- The lock keys are distinct per store.

**Route (`send-reminders.scope.test.ts`)**
How it runs: real `installmentRoutes` and the real job. Permissions come from the real `SYSTEM_ROLES`; the role and store come from a token stand-in that binds them as `authenticate` does.
- `branch_manager` and `super_admin` of store A: only store A is processed, with no tenant listing.
- Store-only counts are returned.
- The per-store lock is acquired and released.
- Store B's user processes only B.
- **A lock held by the daily job or another trigger → 409**, with nothing queried or sent and the lock left intact.
- Another store's lock does not block this store.
- **Scope-widening attempts** through the body or the query string (`tenantId`, `schemaName`, `all`) still process only A.
- A `cashier` (no `installments:update`) gets 403, with nothing processed.

**Red, before the fix: 14 failed / 1 passed.** The route tests failed **behaviourally**: today's code lists every tenant and e-mails store B's customer. The job tests failed because the per-store function and lock did not exist.

**Correction during the red run.** The first failing diffs printed the **dummy** test addresses (6, then 2 from code frames). The tests were changed to boolean-only recipient checks, with the addresses held in named constants: **0** occurrences from then on. These were fake `@store-*.test` values, not customer data.

**Green, after the fix:** 15 / 15, with 0 addresses in the output.

**Mutation check** (applied, run, restored; checksum of the route plus the job `da2765e4688932f8…` identical before and after; 0 addresses printed)

| Mutation | Result |
|---|---|
| M1: the route runs the all-store `runReminderCycle()` again | **8 failed:** every scoping test, the store-only counts, the lock-key test, and both scope-widening tests |
| M2: the route without the per-store lock | **2 failed:** the 409-when-held test and the lock test |
| M3: the daily cycle without the per-store lock | **2 failed:** both daily-cycle lock tests |

**Full checks**

| Check | Command | Result |
|---|---|---|
| API suite | `pnpm --filter @hesba/api test` | **exit 0: 23 files, 209 passed** (194 + 15). Test addresses 0; tokens 0 |
| API type-check / lint / build | `pnpm --filter @hesba/api type-check` / `lint` / `build` | **exit 0 / 0 / 0** |
| Web suite / type-check (consumer of the response) | `pnpm --filter @hesba/web test` / `type-check` | **exit 0: 62 passed / exit 0** |
| **Not run** | — | **RT-C3 / RT-HSEC05** (DB-backed, with the real BullMQ worker and concurrency). Docker is not running and was **not** started |

### 5G.4 Diff review and preservation

- **CF-022 changed:**
  - `installment-reminders.job.ts`: +72 ignoring whitespace (the raw diff is larger because of the dedent);
  - `installment.routes.ts`: +26 / −…;
  - 2 new test files (268 lines).
- **Everything else is byte-identical to the start of the task:**
  - tracked diff excluding the two files: `f214498b3d0cbce0…`;
  - untracked files excluding the two tests: `b0aac6573bff209d…`.

  So CF-132, CF-085, FU1, CF-048, CF-035, CF-025 and CF-023 (AU-10, escaping, R1) are intact.
- **Full tree after:** tracked `e77b5dad08bfa412…`, untracked `3ef87d8f84ba7077…`.
- **Main checkout:**
  - same four entries;
  - `git diff` fingerprint `439b10007f77b183…`;
  - overview `c45dd64cc9e53b0f…`;
  - 0 staged;
  - `claude/ui-pos-merge-split` @ `8846bce`.
- **Scratch files:** the scratchpad is empty. Docker was not started; no commit and no push.

### 5G.5 Remaining risks

1. **Duplicate or wrong reminders within one store are still possible** (CF-091 / CF-092, not started).
   - The per-store lock stops the daily job and a manual trigger from overlapping for one store.
   - Within a single run, the dedupe is still check-then-send with no claim.
   - A payment paid during the cycle can still receive a reminder.
2. **The lock is the existing `withLock`:** a constant value, an owner-less `DEL`, and no renewal (CF-040, W6). If one store's run outlives the 25-minute TTL, a second run could start and the first run's `DEL` would remove the second run's lock. This is pre-existing and not changed here.
3. **No per-store rate limit was added.**
   - Phase 2 HSEC-05 recommends one, but it is not in the §8.2 acceptance criterion.
   - Repeat manual triggers are bounded by the per-store lock (no concurrency) and the existing 24-hour per-payment dedupe, and now affect only the caller's own customers.
   - A specific limit would be a new policy choice.
4. **A daily-cycle skip on contention:** if a manual run holds a store's lock at the 09:00 tick, the daily cycle skips that store for the day. The manual run is doing the same work for that store at that moment.
5. **UX:** a 409 shows the existing generic failure toast ("فشل إرسال التذكيرات", "sending reminders failed"), not a "already in progress" message.
6. **Exposure context:** the trigger still requires `installments:update` (`super_admin` or `branch_manager`), and signup is public and unthrottled (CF-034, W10). After this fix, those users can only remind their own store's customers.

## 5H. CF-022-FU1: owner-safe lock release (follow-up to CF-022; release part of CF-040 only)

> **Canonical mapping (2026-10-14 reconciliation):** CF-022-FU1 is a **non-canonical** follow-up. Its work is the owner-safe release part of canonical **CF-040** (P2, FG, W6), tracked in status-board row 10c. CF-040 remains **partially fixed**: the release is tested with mocked Redis only, and lock renewal and real-Redis validation are open.

### 5H.1 Finding, scope and pre-checks

| Field | Value |
|---|---|
| Origin | The read-only CF-022 locking review (2026-10-13), confirming Phase 4 **DB-L07** / Phase 10 **CF-040** (P2, W6, task T-26) |
| Defect (verified in source) | `withLock` (`shared/utils/lock.ts`) stored the constant value `'1'` and released with an unconditional `DEL`. An execution that outlived its TTL deleted whichever lock was current, including a newer execution's, which let a third execution start |
| **This task (approved)** | **Owner-safe release only:** a random per-execution token, and an atomic compare-and-delete release |
| **Not in this task** | Lock renewal or heartbeat; any TTL change; the rest of CF-040 (lock used as a progress record; BG-02 crash and skip); CF-041 / CF-042 timeouts; CF-091 / CF-092 claim-before-send |
| Callers (all reviewed) | `renewal.job.ts:31` (`renewal-cycle`, 25 min); `trial-expiry.job.ts:33` (`trial-expiry-cycle`, 10 min); `dunning.job.ts:39` (`dunning-cycle`, 25 min); `installment-reminders.job.ts:33` (`installment-reminders-cycle`, 25 min) and `:104` (per store, 25 min); `installment.routes.ts:225` (per store, 25 min). Every one uses only the return value (`null` means busy). **No code reads, writes or deletes `lock:*` keys outside `lock.ts`** (repository-wide grep) |

**Pre-checks: all matched.**
- Worktree: tracked `e77b5dad08bfa412…`, untracked `3ef87d8f84ba7077…`, 0 staged.
- Main checkout: diff `439b10007f77b183…`, overview `c45dd64cc9e53b0f…`, 0 staged, `claude/ui-pos-merge-split` @ `8846bce`.
- This report: `8bc94c15365d5c70…`.

### 5H.2 Change (worktree)

**`apps/api/src/shared/utils/lock.ts`** (+29 / −8):

1. **Token.** `const token = randomUUID()` (`node:crypto`) is stored as the value: `SET lock:<key> <token> PX <ttl> NX`.
2. **Release.** `redis.eval(RELEASE_SCRIPT, 1, lockKey, token)` replaces `redis.del(lockKey)`. The exported `RELEASE_SCRIPT` is the standard compare-and-delete:
   ```lua
   if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end
   ```
   Lua scripts execute atomically in Redis, and ioredis 5.10.1 (installed) supports `eval(script, numKeys, ...args)`.
3. **Unchanged:**
   - key format `lock:<key>`;
   - TTLs, which are set by the callers;
   - `PX` / `NX`;
   - return value (`fn`'s result, or `null` when busy, without running `fn`);
   - an acquire error still propagates;
   - a release error is still swallowed (`.catch(() => {})`), so it never masks `fn`'s result or error.
4. **Doc comment.** It now describes the real return contract (the old text said `true` / `false`), the ownership rule, and an explicit **LIMITATION** paragraph: no renewal, so overlap after expiry is still possible.

**Test mocks (no assertions changed).** The two CF-022 tests (`jobs/__tests__/installment-reminders.scope.test.ts`, `modules/installments/__tests__/send-reminders.scope.test.ts`) mocked Redis as `{ set, del }`. Each gains a compare-and-delete `eval` mock (3 lines) and a reset of it in `beforeEach`. Their existing assertions, such as "released afterwards" and "holder's lock left in place", now run against the owner-checked release.

### 5H.3 Tests: `apps/api/src/shared/utils/__tests__/lock.test.ts` (new, 12 tests)

**Mock coverage only.** Redis is an in-memory fake with a manual clock that simulates `PX` expiry. Its `eval` implements compare-and-delete semantics; **it does not run the Lua**. A static test checks that the script compares `GET KEYS[1]` with `ARGV[1]` before `DEL`.

| Required case | Test(s) |
|---|---|
| 1. A holder releases its own lock normally | "1. a holder releases its own lock normally": released via `eval` with its own token; `del` is not used |
| 2. A expires, B acquires, and A's cleanup cannot delete B's lock | "2. …": the clock passes the TTL while A runs; B acquires; A finishes; **B's token is still stored**, a third execution C gets `null`; B then releases normally |
| 3. A different owner token leaves the current lock intact | "3. …": the key is re-owned during `fn`; after the cleanup the other token is still stored |
| 4. A failed or rejected operation still cleans up safely | "4a" (rejects: rethrows, own lock released); "4b" (rejects after a takeover: the new lock is kept); "4c" (a failing release masks neither the result nor the original error) |
| 5. Caller semantics retained | "5a" (exact `SET` key / `PX` / ttl / `NX`, result returned); "5b" (busy: `null`, `fn` not called, holder untouched, no release attempted); "5c" (acquire error propagates); "5d" (an `undefined` result passes through). Plus the unchanged CF-022 job and route suites (15 tests) |
| Token properties | Random UUID, not `'1'`, unique per execution |

**Red phase (before the fix):** 7 failed, 5 passed. The 5 passes are the caller-semantics tests, which must pass on both versions.

**Mutation tests** (checksum-verified restore; `lock.ts` back to `0ab7b895387ed997…`):

| Mutation | Result |
|---|---|
| M1: release by unconditional `DEL` again | **5 failed** |
| M2: constant token `'1'` (with compare-and-delete) | **2 failed** |
| M3: no release at all | **4 failed** |

### 5H.4 Commands run and results

| Check | Command | Result |
|---|---|---|
| Focused | `pnpm exec vitest run` on `lock.test.ts` plus the two CF-022 suites (in `apps/api`) | **exit 0: 3 files, 27 passed** |
| API suite | `pnpm --filter @hesba/api test` | **exit 0: 24 files, 221 passed** (209 + 12). Test addresses printed: 0 |
| API type-check / lint / build | `pnpm type-check` / `lint` / `build` (in `apps/api`) | **exit 0 / 0 / 0** (`dist/` is git-ignored) |
| Web suite (prior W1 work) | `pnpm --filter @hesba/web test` | **exit 0: 3 files, 62 passed** |
| **Not run** | — | **No real-Redis verification.** The Lua script was not executed against a Redis server, and no integration test with expiry ran. Docker is off and was **not** started |

### 5H.5 Diff review and preservation

- **Changed:**
  - `lock.ts` (modified tracked file);
  - `lock.test.ts` (new);
  - the `eval` mock lines in the two CF-022 test files.
- **Everything else is byte-identical:**
  - the tracked diff excluding `lock.ts` is `e77b5dad08bfa412…`, equal to the pre-task value;
  - the untracked fingerprint, rebuilt with the two CF-022 tests' mock edits reverted (on scratch copies only) and `lock.test.ts` excluded, is `3ef87d8f84ba7077…`, also equal.

  So CF-132, CF-085, FU1, CF-048, CF-035, CF-025, CF-023 and CF-022 scoping are intact. The CF-022 suites still pass, so tenant scoping is unchanged.
- **Full tree after:** tracked `b53fb33f54d1afd2…`, untracked `65e0bf3ecaa43db4…`. Files: `lock.ts` `0ab7b895387ed997…`, `lock.test.ts` `64afbe164050d65f…`, job test `4448d7c1b99c5e0b…`, route test `b900067d17a026fa…`.
- **Main checkout:** the same four entries; diff, overview and branch fingerprints unchanged; 0 staged.
- No commit, no push, nothing staged, Docker not started. Scratch files were removed.

### 5H.6 Remaining risks (explicit)

1. **Overlap after TTL expiry is NOT prevented.** There is no renewal. If an execution runs past its TTL (25 min for reminders, renewal and dunning; 10 min for trial expiry), another execution can acquire the key and run **concurrently**. For reminders that means possible duplicate sends to one store's customers. The fix only guarantees that the stale execution no longer deletes the newer lock, so the cascade to a third or later execution is closed while the newer holder runs.
   - **Left to separately approved work:** lock renewal (CF-040 / T-26, W6), Resend timeouts that bound run length (CF-041 / CF-042), and claim-before-send (CF-091 / CF-092), which is the real duplicate guard.
2. **Redis key loss** (restart without persistence, eviction, flush) still lets a second execution start. This is unchanged and is a Redis-configuration concern.
3. **Crash while holding the lock** (BG-02): the lock still stays until its TTL runs out. Reminders: a 409 or the daily skip for that store. Billing jobs: that cycle is skipped. Unchanged.
4. **Release failure** (swallowed): the lock stays until its TTL. This is the same as before and fails safe (busy rather than overlapping).
5. **`EVAL` availability:** the release requires Redis scripting. It works on standard Redis 7 (the local compose image). A managed Redis that disables `EVAL` would make every release silently fail (each lock would live until its TTL). The production Redis has not been verified (no production access).
6. **Comments overstated (not changed, out of scope):** "never run concurrently" in `installment.routes.ts:212-214`, `installment-reminders.job.ts:70-72` and the job test header is true only within the TTL. The limitation is documented in `lock.ts`.

## 5I. CF-135: password-reset token can reach Google Analytics (reset-token channel)

### 5I.1 Finding, scope and pre-checks

| Field | Value |
|---|---|
| Canonical ID | **CF-135** (P3; Phase 10 wave **W12**, pulled forward by owner approval on 2026-10-14) |
| Original IDs | **HSEC-25** (Phase 2: `App.tsx:57-60`, `analytics.ts:133-139`); extended by **L6-02** (Phase 6: Paymob redirect parameters) |
| **This task (approved)** | The **reset-token → analytics** channel only: trace, establish, fix if a clear unsafe path exists, regression tests |
| **Not in this task** | The Paymob redirect-parameter half (L6-02); the logs channel (already handled in §5D, CF-023 / AU-10); any GA configuration or consent change. *(Reconciliation note, 2026-10-14: the L6-02 half was handled later, at code level, in §5I.8.)* |

**Pre-checks: all matched.**
- Worktree: tracked `b53fb33f54d1afd2…`, untracked `65e0bf3ecaa43db4…`, 0 staged.
- Main checkout: diff `439b10007f77b183…`, overview `c45dd64cc9e53b0f…`, 0 staged.
- This report: `d864ad66dff3b408…`.

### 5I.2 Trace (pre-fix code)

| Step | Evidence | Token exposed? |
|---|---|---|
| E-mailed link | `buildPasswordResetUrl` (`email.ts:328-335`): `/reset-password?token=<raw>&subdomain=<s>` | Yes, in the URL by design |
| Page load | `main.tsx`: only the `#s=` hash hand-off touched the URL; the query stayed in the address bar for the whole visit | Yes, in `location` |
| App page views | `RouteBoundary` (`App.tsx:54-60`) passes `location.pathname + location.search` to `trackPageView`, which sent it as `page_path` and `page_location` (`analytics.ts:133-139`) | **Yes, when GA is enabled.** **Verified at unit level:** with GA force-enabled and a stub `gtag`, the pre-fix `trackPageView` handed the token to `gtag` (red phase, 3 failing tests) |
| Timing on a fresh load | GA boots only after `window.load`, plus idle / 200 ms (`analytics.ts:99-114`), and `track` returns early while `window.gtag` is undefined (`:123`). `RouteBoundary`'s first effect normally runs before that | The app's **first** page view on a freshly opened link is **probably dropped**. Not reproduced in a real browser |
| GA's own collection | Once booted, `gtag.js` reads `document.location` for hits the app doesn't send itself: GA's documented default for `page_location`, user-engagement hits, and enhanced-measurement events if enabled in the GA property | **Theoretical:** the token was in the address bar for as long as the page stayed open. Not verified (no live GA, by rule) |
| Referrer to Google | `@fastify/helmet` 7.2.0 default `Referrer-Policy: no-referrer` on every Fastify response, including `index.html` in production (`index.ts:82`; helmet `index.cjs:189-190`) | No, when served by the API. The `gtag.js` and Google Fonts requests carry no `Referer` |
| Error reporting | No web error reporter. `ErrorBoundary` logs to the console in DEV only (`ErrorBoundary.tsx:24-28`) | No |
| Other third parties | Google Fonts `@import` in CSS (`fonts.css:3`): referrer policy as above | No |
| Server side | The reset API receives the token in the POST body (`ResetPassword.tsx`), not the URL; logs: §5D | No (analytics) |

**Is GA enabled anywhere? Unknown; deployment-dependent.** GA runs only if `VITE_GA_MEASUREMENT_ID` is set **at build time**, the build is PROD, and the browser has no DNT (`analytics.ts:61-69`).
- `apps/web/.env.production` sets only `VITE_BASE_DOMAIN`.
- The `Dockerfile` declares no `ARG VITE_GA_MEASUREMENT_ID`, and `railway.json` builds with that `Dockerfile`.
- **So no build defined in the repository compiles GA in.** The local build in §5I.4 contains **0** measurement ids.
- The `analytics.ts` header says the variable is set on Railway, but whether a deployed bundle ever contained an id was not checked (production is down, no access; Phase 10 **PV-03**).

**Conclusion:**
- There is a **clear unsafe path in code:** with GA enabled, the app hands the token to the analytics API, and GA's own collection would read it from the address bar.
- **Actual leakage is not confirmed:** GA enablement is unknown, the app's first page view is timing-dependent, and GA's automatic collection was not observed.

### 5I.3 Change (worktree)

| File | Change |
|---|---|
| `apps/web/src/lib/reset-token.ts` (new, 26 lines) | `captureResetTokenFromUrl()`: on `/reset-password` only, reads `token`, keeps it **in memory**, and removes it from the URL with `history.replaceState`. This **replaces** the history entry rather than pushing one, and keeps other parameters (`subdomain`) and the hash. Also `getCapturedResetToken()` |
| `apps/web/src/main.tsx` (+5) | Calls `captureResetTokenFromUrl()` right after the `#s=` hand-off and **before** `ReactDOM.createRoot`. So the router, `RouteBoundary`, and GA (which boots after `load`) never see the token in `location` |
| `apps/web/src/pages/auth/ResetPassword.tsx` (+3 / −1) | `token = getCapturedResetToken() ?? params.get('token') ?? ''`. The form submits the same token as before |
| `apps/web/src/lib/analytics.ts` (+16 / −2) | Defence in depth: `trackPageView` removes any `token` query parameter from `page_path` and `page_location`, on **any** route (for example a legacy `/reset?token=` link before its redirect). Paths without `token` are sent unchanged |

**Behaviour change:** reloading the reset page after it has opened loses the in-memory token, so the page shows the existing "invalid or expired link" message. The user opens the e-mailed link again; the token is still valid until it is used or expires. Nothing else changes: the URL, the form, the API request and the redirect to `/login` are as before.

### 5I.4 Tests and commands

**New tests (12; jsdom; GA force-enabled with the dummy id `G-TEST000000` and a local `gtag` stub).**
- The real GA script is never attached: fake timers in the unit test, and a no-op on script `appendChild` in the app-level test.
- The HTTP client is stubbed; nothing is contacted.
- The dummy token is checked with boolean assertions only. It was printed 0 times across all runs.

| File | Tests |
|---|---|
| `src/lib/__tests__/reset-token.test.ts` (5) | Moves the token out of the address bar and keeps it in memory (other parameters and the hash kept; history length unchanged); no bare `?` left; no-op without a token; other routes untouched; static check that `main.tsx` calls the capture **before** `ReactDOM.createRoot` |
| `src/lib/__tests__/analytics-redaction.test.ts` (6) | Sanity check that GA is enabled; `?token=` dropped from `page_path` and `page_location` while other parameters are kept; legacy `/reset?token=` becomes `/reset`; token among other parameters; non-token paths unchanged; the GA script was never injected |
| `src/pages/auth/__tests__/reset-password-analytics.test.tsx` (1) | **The full flow through the real `App`** (`RouteBoundary`, `GuestGuard`, lazy `ResetPassword`), started as `main.tsx` does. Asserts: a `page_view` for `/reset-password?subdomain=store-a`; no analytics payload (stub calls plus `dataLayer`) contains the token; `location.href` has no token; the form posts `/auth/reset-password` with the e-mailed token and the `X-Tenant-Subdomain` header; it navigates to `/login`, and still no token was sent |

**Red phase (before the fix).** The two new-module suites failed to import, as expected. `analytics-redaction.test.ts` showed **3 failed**: the token was sent to `gtag`.

**Mutation tests.** Each mutation was restored by checksum (`067ce681edba3bbf…` before and after each).

| Mutation | Result |
|---|---|
| M1: `main.tsx` doesn't call the capture | **1 failed** (static wiring test) |
| M2: the capture leaves the token in the URL | **3 failed** (2 capture tests, plus the app-level test) |
| M3: no redaction in `trackPageView` | **3 failed** |
| M4: `ResetPassword` reads only the query | **1 failed** (app-level: the form never renders) |
| M5: original behaviour (capture no-op, no redaction) | **6 failed**, including the app-level test |

**Mutation-script incident (recorded honestly).** The first mutation run used a zsh scalar for the file list. zsh did not word-split it, so the backup `cp` failed and mutations M1–M5 were applied cumulatively to the four source files without being restored. This is the same zsh word-splitting mistake already recorded in this report.
- Only these four files (this task's own new edits) were affected; no user or prior-W1 file was touched.
- They were restored by exact-string replacement and checked against the full `git diff`, then the run was repeated with a zsh array and checksum-verified restores (the table above).
- No dummy token was printed during the failed run.

| Check | Command | Result |
|---|---|---|
| Focused | `pnpm exec vitest run` on the 3 new files (in `apps/web`) | **exit 0: 12 passed** |
| Web suite | `pnpm --filter @hesba/web test` | **exit 0: 6 files, 74 passed** (62 + 12). Dummy token printed: 0 |
| Web type-check / lint / build | `pnpm type-check` / `lint` / `build` (in `apps/web`) | **exit 0 / 0 (55 pre-existing a11y warnings, none in touched files) / 0.** `dist/` is git-ignored |
| Local bundle | grep `dist/assets/*.js` for `G-…` ids | **0** measurement ids (built without `VITE_GA_MEASUREMENT_ID`) |
| API | — | **Not run:** no API file changed (the fingerprint below proves it) |
| **Not run** | — | **Real-browser check with GA, and live GA:** not performed, by rule. The production bundle was not inspected (no access). Docker not started |

### 5I.5 Diff review and preservation

- **Changed:**
  - `analytics.ts`, `main.tsx`, `ResetPassword.tsx` (modified, tracked);
  - `reset-token.ts` plus the 3 test files (new).
- **Everything else is byte-identical:**
  - tracked diff excluding the 3 files: `b53fb33f54d1afd2…`, equal to the pre-task value;
  - untracked excluding the 4 new files: `65e0bf3ecaa43db4…`, equal.

  All prior W1 work (CF-132 … CF-022-FU1) is intact.
- **Full tree after:** tracked `b8fe3cc80016cab9…`, untracked `a6aeb60e14c2b325…`, 0 staged.
- **Files:**

  | File | Hash |
  |---|---|
  | `reset-token.ts` | `54be0d51ac023014…` |
  | `main.tsx` | `4ef5a49580e35b67…` |
  | `ResetPassword.tsx` | `c7e25e38eff9a0bf…` |
  | `analytics.ts` | `390b76aa655872d4…` |
  | `reset-token.test.ts` | `74c4ed018681c81a…` |
  | `analytics-redaction.test.ts` | `e0f5992f321d8441…` |
  | `reset-password-analytics.test.tsx` | `27f126df2f46f30b…` |
- **Main checkout:** unchanged.
- No commit, no push, nothing staged, Docker not started; scratch files removed.

### 5I.6 Remaining risks

1. **Leakage is unconfirmed either way:** whether any deployed bundle had GA enabled is unknown (PV-03). If it did, tokens issued while it was live may have been collected. Reset tokens are single-use and short-lived, so a past exposure matters only within each token's lifetime.
2. **GA's automatic collection was not observed:** the fix removes the token from `location` before GA can load. The proof is the test's `location.href` assertion plus the boot order (GA waits for `load`), not a live GA capture.
3. **The token still reaches the browser itself**, and these local exposures are unchanged:
   - the browser's global history records the original link;
   - the service worker caches navigation HTML keyed by the full request URL (`sw.js:31-44`), so on a device with the service worker installed, a Cache Storage key contains `?token=`.

   Both are local to the device and not analytics; they need a separate decision.
4. **Paymob redirect parameters (L6-02, the other half of CF-135) are untouched.** `page_view` paths for `/settings?tab=billing&…` are still sent as-is when GA is enabled. A query-parameter allowlist for page views (Phase 6 L2) is the recommended follow-up.
5. **Reload loses the token** (§5I.3): a usability trade-off, chosen over persisting the token to storage.
6. **Not verified in a real browser:** jsdom only.

### 5I.7 Follow-up review (2026-10-14): helper, reload behaviour, Paymob parameters

**Scope (approved):** review the reset-token helper and its integration; assess reload behaviour; trace the Paymob redirect-parameter path. CF-135 is **not closed**.

**Pre-checks: all matched.**
- Worktree: tracked `b8fe3cc80016cab9…`, untracked `a6aeb60e14c2b325…`, 0 staged.
- Main checkout: diff `439b10007f77b183…`, overview `c45dd64cc9e53b0f…`, 0 staged.
- This report: `59ce166d933e4953…`.

#### A. Helper review (`reset-token.ts`, `main.tsx`, `ResetPassword.tsx`)

| # | Point | Verdict |
|---|---|---|
| R1 | The capture matched only the exact `/reset-password`, but React Router 6.30.3 renders `ResetPassword` for **any letter case and an optional trailing slash**. Checked with the installed `matchPath`: `/reset-password/`, `/RESET-PASSWORD` and `/Reset-Password/` match; `/reset-password/x` and `//reset-password` don't. For those forms the token stayed in the URL: page views were still redacted, but GA's own collection could read it. E-mails never produce these forms | **Fixed:** the capture now uses `matchPath({ path: '/reset-password' }, pathname)`, the router's own rule (§5I.7 D) |
| R2 | Order: the capture runs after the `#s=` hand-off and before `createRoot`; GA boots only after `load`. `replaceState` keeps `history.state` and replaces the entry | OK |
| R3 | Token storage: module memory only; same-origin script could read it, as it could read the URL before. Not logged, not persisted | OK: no weakening |
| R4 | After a successful reset the in-memory token is not cleared. It is already consumed server-side (atomic `usedAt`, `auth.service.ts`), so a reuse fails with the existing error. Clearing it would flash the "invalid link" screen during the `/login` transition | Accepted as is |
| R5 | `ResetPassword` prefers the in-memory token over a `?token=` in the URL. This matters only if an in-app navigation to `/reset-password?token=B` happened after token A was captured in the same document. No in-app link produces that | Theoretical; unchanged |
| R6 | The service-worker cache key and browser history still hold the original URL (local, §5I.6 #3) | Unchanged; open |

#### B. Reload behaviour: trade-off (no change)

Keeping the token **out of the URL** and having it **survive a reload** at the same time is only possible by storing it somewhere that outlives the document. Options considered:

| Option | Survives reload | Assessment |
|---|---|---|
| In memory (current) | No | Never persisted; the token leaves the URL before any analytics loads. **Chosen** |
| `sessionStorage` | Yes | Persistent per-tab storage that browsers may restore with the session. **Excluded** (no persistent token storage) |
| `history.state` via `replaceState` | Yes | Kept in session history, and written to disk by session restore. **Excluded** (persistent) |
| Cookie | Yes | Persistent, and sent to the server. **Excluded** |
| Move the token to the URL fragment (`#token=`) | Yes | Still in the address bar, browser history and copy/paste; whether GA includes fragments in `page_location` is unverified. **Excluded** (not clearly safe) |
| Keep the token in the URL but don't load GA on that page load | Yes | Keeps the pre-fix local exposure (address bar, history), relies on gating every present and future third-party script, and changes analytics boot logic. **Not minimal;** owner decision only |

**Current behaviour, documented:**
- A same-tab Back/Forward with the page kept in memory (including bfcache) keeps the token.
- A **reload**, or a non-bfcache return, loses it, and the page shows the existing "invalid or expired link" alert. That text is misleading after a reload, and the page has no navigation link.
- Recovery: open the e-mailed link again. The token is valid for **1 hour** (`RESET_TOKEN_TTL_MS`) and is single-use.

**Optional UX-only improvement (not done, needs approval):** when no token is present, say "open the link from your e-mail again, or request a new link" and link to `/forgot-password`. This touches no token handling.

#### C. Paymob redirect parameters (L6-02): trace

| Step | Evidence |
|---|---|
| Checkout | The Settings billing tab posts `/billing/checkout`, then **top-level** navigation `window.location.href = iframeUrl` (`Settings.tsx:305-311`) |
| Redirect target | `redirect_url = ${FRONTEND_URL}/settings?tab=billing`, sent per transaction in the payment-key request (`billing.service.ts:85-88`; `paymob.client.ts:88-91`) |
| What Paymob appends | The response-callback query. Per Phase 6 L6-02 [DOC]: transaction id, `success` / `pending`, `amount_cents`, order id, **`merchant_order_id = sub_<tenantId>_<ts>`** (`paymob.client.ts:105`), **masked PAN**, **`hmac`**, and more. **Not verified:** the exact set and how Paymob joins it to the existing `?tab=billing`; Paymob was not contacted |
| Who uses it | **Nobody.** The API acts only on the server-to-server webhook (`billing.routes.ts:26-40`), and Settings reads only `tab` (`Settings.tsx:44-46`). The parameters are incidental |
| `token` redaction (§5I.3) | Does not apply: different parameter names |

**Analytics exposure when GA is enabled:**

1. **The landing page view** carries the full query. On a fresh load it is probably dropped by GA's boot timing (as in §5I.2).
2. **Every Settings tab click re-sends it.** `setTab` copies all current parameters (`Settings.tsx:47-51`), so `location.search` changes and `RouteBoundary` sends a new `page_view` with the whole Paymob query. These clicks happen after GA has booted, so this is **the realistic channel**.
   - **Verified in jsdom** with a temporary probe (dummy values; deleted after the run; fingerprints re-checked). After clicking "الفروع" (Branches), the `page_view` path was `/settings?tab=branches&id=111&success=true&amount_cents=19900&merchant_order_id=<ORDER>&source_data.pan=0000&hmac=<HMAC>`.
3. **The address bar keeps the parameters for the whole visit**, so GA's automatic `document.location` collection could read them. Theoretical, as in §5I.2.
4. **Logged-out landing:** `AuthGuard` passes `from` in router **state**, not the URL, so the `/login` page view is clean. After login, `postLoginPath` (CF-085-FU1) restores `/settings?tab=billing&<params>`, which produces another `page_view` with the parameters, after boot. From the code and the FU1 tests; not probed. The bare-domain `#s=` hand-off drops the destination.

**Sensitivity:** the tenant UUID (inside `merchant_order_id`), the masked card number with amount and time (payment metadata, possibly personal data under GA's terms), and the `hmac` signature. The `hmac` is not a key, and no redirect-query handler exists, so no replay surface was found. P3, consistent with Phase 10.

**Fix options (NOT implemented; awaiting approval):**
- **A.** On a `/settings` landing that carries Paymob parameters, keep only the app's own parameters before render (the same pattern as the reset capture). Covers page views, tab clicks, the login round trip and GA's own collection.
- **B.** A page-view query allowlist in `trackPageView` (Phase 6 L2). Covers page views only.
- **C.** A dedicated return route that immediately replaces to `/settings?tab=billing`. Needs a server and web change.

Recommended: **A** (optionally plus **B**). This is an owner decision.

#### D. Change and tests (this follow-up)

| File | Change |
|---|---|
| `apps/web/src/lib/reset-token.ts` | Uses `matchPath` from `react-router-dom` instead of `pathname === '/reset-password'` (+5 / −1). No other behaviour change |
| `apps/web/src/lib/__tests__/reset-token.test.ts` | +5 tests: captures on `/reset-password/`, `/RESET-PASSWORD`, `/Reset-Password/`; no capture on `/reset-password/extra` or `/reset` |

**Results:**
- **Red (before the change):** 3 failed (the three variants).
- **Green:** focused 17 passed.
- **Mutation** (exact-path compare restored): **3 failed**; restore checksum-verified (`3b03e3f5a385f8e9…`).

| Check | Command | Result |
|---|---|---|
| Web suite | `pnpm --filter @hesba/web test` | **exit 0: 6 files, 79 passed** (74 + 5). Dummy token printed: 0 |
| Web type-check / lint / build | in `apps/web` | **exit 0 / 0 (the same 55 pre-existing warnings, none in touched files) / 0** |
| Temporary Paymob probe | `vitest run` on a throwaway file under `src/__cf135_probe__/` | Ran once with dummy values, then **deleted**; fingerprints re-checked equal before the code change |
| API | — | Not run: no API file changed |
| **Not run** | — | Any real-browser or live GA / Paymob check (by rule); production or deployed bundles; Docker |

**Preservation:**
- Tracked diff `b8fe3cc80016cab9…`, unchanged (the change touched only untracked files).
- Only `reset-token.ts` (`3b03e3f5a385f8e9…`) and `reset-token.test.ts` (`e22f55af8bd79dcb…`) changed. The other CF-135 files still match §5I.5: `main.tsx` `4ef5a495…`, `ResetPassword.tsx` `c7e25e38…`, `analytics.ts` `390b76aa…`, and the two test files `e0f5992f…` / `27f126df…`.
- Untracked after: `717da974a49e6e4a…`; 0 staged; main checkout unchanged.

**CF-135 status:**
- Reset-token channel: fixed, with the R1 gap closed.
- Reload trade-off: documented.
- **Paymob half: open**, with the exposure traced (realistic via tab clicks).
- Deployed GA enablement: unknown (PV-03).

**Not closed.**

### 5I.8 Paymob return-URL clean-up, page-view allowlist, reset recovery message (2026-10-14)

**Scope (approved):** option **A** (clean the `/settings` landing URL), option **B** (page-view query allowlist), and the reset-page recovery message. Payment verification is unchanged: the server webhook stays the only confirmation, and nothing is inferred from URL parameters. CF-135 is **not closed**.

**Pre-checks: all matched.**
- Worktree: tracked `b8fe3cc80016cab9…`, untracked `717da974a49e6e4a…`, 0 staged.
- Main checkout: diff `439b10007f77b183…`, overview `c45dd64cc9e53b0f…`.
- This report: `13051e7b0dfcdb04…`.
- *Note:* a first fingerprint run from `apps/web` gave a different untracked value (`7aaf0589…`) because `git ls-files` is scoped to the current directory. From the worktree root it matched. All fingerprints in this report are taken from the worktree root.

#### A. Trace before editing

**Parameters each route reads:**

| Route | Reads | Where |
|---|---|---|
| `/settings` | `tab` | `Settings.tsx:44-46` |
| `/settings` audit tab | `entity`, `action`, `actorId`, `from`, `to`, written back by its own filters | `Settings.tsx:1469-1490` |
| `/invoices` | `from`, `to` | — |
| `/stock` | `lowStockOnly` | — |
| `/register` | `plan` | — |

- **Nothing reads any Paymob field.** There is no success screen derived from the URL; payment state comes from `/billing/status`, which the webhook updates.
- **In-app links to Settings** use only `?tab=billing`: `SubscriptionBanner`, `UsageBanner`, `FeatureGate`.

#### B. Changes (worktree)

| File | Change |
|---|---|
| `apps/web/src/lib/billing-return.ts` (new, 47 lines) | `cleanSettingsLandingUrl()`: on any URL that matches `/settings/*` (router `matchPath`), rebuilds the query with **only** a known `tab`. If the tab is `audit`, it also keeps the five audit filters. Everything else is removed with `history.replaceState`: Paymob fields, **unknown parameters by default**, and the fragment. A tab value with a second `?` glued on (`billing?id=…`) is reduced to the known id. Already-clean URLs are not touched |
| `apps/web/src/lib/settings-tabs.ts` (new, 21 lines) | `SETTINGS_TAB_IDS` (13 ids) for the clean-up and the allowlist, so the lazy Settings page isn't pulled into the main bundle. **A test keeps it in sync with `Settings.tsx`** |
| `apps/web/src/main.tsx` | Calls `cleanSettingsLandingUrl()` right after the reset-token capture, before `createRoot` |
| `apps/web/src/lib/analytics.ts` | **Allowlist replaces the token-only redaction.** Page views keep only `tab` (value must be a known Settings tab) and `plan` (value must match `^[a-z][a-z0-9-]{0,31}$`). Everything else is dropped from both `page_path` and `page_location`: tokens, `subdomain`, filters, `utm_*`, unknown names, and the fragment. A `Map` is used, so names like `constructor` / `__proto__` cannot match; a repeated parameter keeps its first valid value |
| `apps/web/src/pages/auth/ResetPassword.tsx` | The no-token screen keeps the existing alert and adds guidance: the link isn't kept after opening for the account's protection, so reopen it from the e-mail after a reload, or request a new one if it expired or was used. Adds links to `/forgot-password` ("طلب رابط جديد") and `/login`. **No storage of any kind**; token handling unchanged |

**The logged-out → login path is covered by construction:** the clean-up runs before `AuthGuard` records `from`, so the saved destination is already clean.

#### C. Tests (dummy values only)

All Paymob dummy values are prefixed `pmx`, plus the dummy reset token. Checks are boolean. In normal runs neither marker was printed. During red and mutation runs, failing assertions printed only `pmx` dummy values; the reset token was printed 0 times.

| File | Tests |
|---|---|
| `src/lib/__tests__/billing-return.test.ts` (new, 11) | Paymob return → `/settings?tab=billing` (history replaced, not pushed); a glued `tab=billing?…` is normalised; fields before `tab` plus a hash are removed; an unknown tab is dropped; audit filters are kept on the audit tab (no rewrite); audit-filter names are dropped on other tabs; clean URLs are untouched; other routes are untouched. Static checks: `main.tsx` cleans before `createRoot`; `SETTINGS_TAB_IDS` equals the `Settings.tsx` tabs; Settings reads exactly `tab` plus the five filters |
| `src/lib/__tests__/analytics-redaction.test.ts` (rewritten, 11) | Reset token and `subdomain` dropped; legacy `/reset`; Paymob query → `?tab=billing`; glued or unknown tab dropped; audit filters dropped; plan slug kept and invalid plan dropped; unknown, prototype-name and `utm_*` parameters plus the fragment dropped; repeats; no query; the GA script was never injected. Each case checks **both** `page_path` and `page_location` |
| `src/pages/settings/__tests__/billing-return-analytics.test.tsx` (new, 1) | **Real `App`, logged in.** The landing opens the Billing tab (`/billing/status` requested); the address bar is `/settings?tab=billing`; the page view is clean. A **tab change** gives `?tab=branches`, also clean. No `pmx` in any GA payload, `location.href`, `history.state`, or API request |
| `src/pages/settings/__tests__/billing-return-login.test.tsx` (new, 2) | **Real `App`, logged out → `/login` → log in.** (1) **Production router config** (`v7_startTransition`): `/login` and every later page view, the address bar, history state and requests contain no `pmx`. The destination is not asserted (see D). (2) Without that flag, where the saved destination is honoured, it is exactly `/settings?tab=billing`, the Billing tab mounts, and nothing leaked |
| `src/pages/auth/__tests__/reset-password-analytics.test.tsx` (updated) | The page view is now `/reset-password` (allowlist), and the address bar keeps `?subdomain=store-a` for the form. New check: the token is never present in `localStorage`, `sessionStorage`, `document.cookie` or `history.state`, either after landing or after the reset |
| `src/pages/auth/__tests__/reset-password-recovery.test.tsx` (new, 1) | Reload state (no token in the URL or memory): existing alert plus the reopen / new-link guidance; links to `/forgot-password` and `/login`; no form; **`Storage.getItem` and `setItem` are never called** |

**Red phase (before implementing):**
- 3 suites failed to import, because the new module didn't exist yet.
- 9 assertions failed on the existing code: allowlist cases, the reset page-view path, and the recovery text.

**Mutation tests:** 7 mutations. Each was restored by checksum (`a470d622bcd5504a…`); zsh arrays were used this time.

| Mutation | Failed |
|---|---|
| M1: `main.tsx` doesn't clean | 1 (wiring) |
| M2: clean-up is a no-op | 8 (5 unit, plus the logged-in app test, plus both login cases) |
| M3: tab not validated | 2 |
| M4: no page-view allowlist | 9 (8 allowlist, plus the reset app test) |
| M5: any tab value accepted | 2 |
| M6: recovery guidance removed | 1. The `sed` step matched nothing; the Python step applied the mutation |
| M7: pre-task behaviour (no clean-up, no allowlist) | **17** |

| Check | Command | Result |
|---|---|---|
| Focused | 7 CF-135 files | **exit 0: 37 passed** |
| Web suite | `pnpm --filter @hesba/web test` | **exit 0: 10 files, 99 passed** (79 + 20). Markers printed: 0 |
| Web type-check / lint / build | in `apps/web` | **exit 0 / 0 (the same 55 pre-existing warnings; 0 in touched files) / 0** |
| API | — | Not run: no API file changed |
| **Not run** | — | Real browser; live Paymob or GA (by rule); the actual Paymob return format; deployed bundles; Docker |

#### D. New finding: CF-085-FU1 deep-link restore loses to `GuestGuard` under the production router config

Found while writing the login test; not caused by this task.
- With `BrowserRouter future={{ v7_startTransition: true, … }}` (exactly as `main.tsx`), a successful login on `/login` sets the user.
- `GuestGuard` then renders `<Navigate to="/pos" replace />`, which **wins over** `Login`'s `navigate(requestedFrom, { replace: true })`.
- So the user lands on `/pos` instead of the saved destination. Example: the trial e-mail's `/settings?tab=billing`. A user without `invoices:create` sees the forbidden screen.
- **Verified in jsdom:** the same test passes without `v7_startTransition` and lands on `/pos` with it.
- The CF-085-FU1 test (`login-redirect.test.tsx`) uses `MemoryRouter` **without** future flags, which is why it missed this.
- **Not fixed** (outside this task; needs approval). Candidate fixes: navigate before `setAuth`, or have `GuestGuard` honour `state.from` on `/login`. Either way, the FU1 test should then run with the production flags.

**CF-135 impact:** none. The destination is already clean, and `/pos` carries no parameters.

#### E. Diff review and preservation

- **Changed:**
  - `analytics.ts` (+27 / −2 vs. `main`), `main.tsx` (+7), `ResetPassword.tsx` (+20 / −2);
  - new `billing-return.ts`, `settings-tabs.ts`, and 4 new test files;
  - 2 updated test files.
- **Everything else is byte-identical:**
  - tracked diff excluding the 3 CF-135 tracked files: `b53fb33f54d1afd2…`, equal to the pre-CF-135 value;
  - untracked excluding all CF-135 files: `65e0bf3ecaa43db4…`, equal.

  All prior W1 work is intact, including CF-085-FU1, which was not modified.
- **Full tree after:** tracked `ef42d071b5e4ddf5…`, untracked `a8421c0bad0a4e73…`, 0 staged.
- **Files:**

  | File | Hash |
  |---|---|
  | `billing-return.ts` | `26570917dabd2388…` |
  | `settings-tabs.ts` | `57cb3427dfd9f998…` |
  | `analytics.ts` | `516df15f09515c8f…` |
  | `main.tsx` | `1388222fbcdc4724…` |
  | `ResetPassword.tsx` | `69efc9780c41ea0f…` |
  | `reset-token.ts` (unchanged) | `3b03e3f5a385f8e9…` |
  | `billing-return.test.ts` | `7522ddd0be4940cc…` |
  | `analytics-redaction.test.ts` | `63221ca26d4a9438…` |
  | `billing-return-analytics.test.tsx` | `8b4ddf07baffe17e…` |
  | `billing-return-login.test.tsx` | `c98502deae8b1c99…` |
  | `reset-password-analytics.test.tsx` | `ef3a7fec16b21e10…` |
  | `reset-password-recovery.test.tsx` | `e0774337cc453a1f…` |
- No commit, no push, nothing staged, Docker not started; scratch files removed.

#### F. Remaining CF-135 risks

1. **The deployed GA state is unknown (PV-03),** as before.
2. **The real Paymob return was not exercised.** The clean-up does not depend on the field list: it keeps only what Settings uses. The double-`?` handling is defensive.
3. **The Paymob fields still reach the browser:** the navigation request, the global browser history, and the service-worker cache key (`sw.js`) still contain them. All are local to the device; the service-worker item is shared with the reset token (open item).
4. **The allowlist drops `utm_*`,** so GA campaign attribution from our page views depends on GA's own collection. This is an owner decision if campaign tagging is used.
5. **The CF-085-FU1 destination defect (D)** is open and separate.
6. **Everything here is verified in jsdom only,** not in a real browser.

---

## 5J. CF-026: invoice details, return dialog and A4 print read fields the API never returned (2026-10-14)

### 5J.1 Finding and scope

| Field | Value |
|---|---|
| Canonical ID | **CF-026**: P1, **RB**, W1 (Phase 10 registry line 178; §4.5) |
| Original ID | **UX-02** (Phase 7 §UX-02) |
| §8.2 acceptance (line 958) | "The drawer shows product name, SKU and a 2-dp line amount; the A4 tax invoice has no `NaN` / `ليس رقمًا` and no blank item names". Failure path: a recorded fixture of the real API response. Source test RT7-03 |
| Prerequisites | None (Phase 10 §7 W1). PV-22, linked to CF-026, is answered (Phase 11 line 131) |
| Owner decisions applied | (1) The line amount is the line subtotal **before tax, after the line discount**, to 2 dp. (2) Bulk print opens **one** window on the click, fetches every selected invoice's details, and renders all of them in it with page breaks |
| Not in scope (unchanged) | CF-003 (refund formula), CF-027 (refund preview, remaining quantity), CF-069 (names read live), CF-084 (tax-invoice identity), CF-155 (error mapping); a shared types package |

### 5J.2 Changes (worktree, uncommitted)

| File | Change |
|---|---|
| `apps/api/src/modules/invoices/invoice.service.ts` (+23 / −1) | `getInvoice` adds three fields to every item, **additively** (all raw fields kept): `productName` (product → service → line description → `—`, the receipt e-mail's fallback); `sku` (variant SKU, or `null` for services and products without one); `lineSubtotal` (the stored line subtotal: quantity × unit price − line discount, before tax, rounded half-up to 2 dp). No refund, tax or other calculation changed |
| `apps/web/src/pages/invoices/Invoices.tsx` | The item type matches the real response; the drawer shows name, SKU and `lineSubtotal`; the return dialog reads `productName` / `sku`; new bulk-print handler. The **CF-023 receipt e-mail dialog is unchanged**: rebuilding the file without the CF-026 hunks on a scratch copy reproduces its pre-task hash `2d8fc9f91ce4a749` |
| `apps/web/src/lib/print.ts` (+67 / −20) | The A4 layout is one reusable invoice section; it uses `productName` and `lineSubtotal` and escapes every interpolated value. Single print keeps its window and timing. Bulk print: `startBulkInvoicePrint()` opens one window synchronously, `render()` writes every invoice with page breaks, and `abort()` closes it. A failed detail fetch aborts with an error; a blocked popup reports an error and fetches nothing |

`POS.tsx`, dependencies, lockfiles and configuration were not changed.

### 5J.3 Tests (as reported by the implementation)

- **Fixture.** The web tests use `apps/web/src/pages/invoices/__tests__/fixtures/invoice-detail.response.json`. It was captured from the **real route and service** with a **stubbed database** returning Prisma-shaped rows and real Prisma `Decimal` values, and an API contract test guards it. **This is an approximation of RT7-03, not a recorded real-database response.**
- **New test files:**

  | File | Tests | Covers |
  |---|---|---|
  | `apps/api/.../invoice-detail.dto.test.ts` | 7 | Name and SKU; `90.00` before tax; SKU `null`; 4-dp → `33.33`; service fallback chain; additive (raw fields equal); 404; fixture equals the route |
  | `apps/web/src/lib/__tests__/print-invoice.test.ts` | 5 | A4 names and amounts; no `NaN` / `ليس رقمًا`; escaping; one bulk window with page breaks; abort; blocked popup |
  | `apps/web/src/pages/invoices/__tests__/invoices-page.test.tsx` | 8 | The real Invoices page under the production router flags: drawer; return dialog; bulk print fetching every selected invoice; failed fetch; blocked popup; empty selection; the CF-023 dialog for non-owner and owner |
- **Red phase:** the A4 totals rendered as `ليس رقمًا` from the real API shape.
- **Mutation checks:** **11 caught** (4 API, 7 web), each restored and verified by checksum.

| Check | Result (as reported) |
|---|---|
| API suite | **228 passed, 25 files** |
| API type-check / lint / build | **pass / pass / pass** |
| Web suite | **136 passed, 14 files** |
| Web type-check / build | **pass / pass**, after a typing fix in the new tests, then rerun |
| Web lint | **pass: 55 pre-existing warnings, 0 new** |
| **Not verified** | A recorded real-database response; real-browser popup and printing; visual A4 layout. Docker not started |

This entry records the implementation report. **No tests were rerun for this documentation update.**

### 5J.4 Status

**Implemented at code level; uncommitted; NOT cleared for release.** CF-026 stays a **P1 release blocker** until its acceptance and release conditions are met:
1. RT7-03 with a recorded real-database invoice-detail response;
2. real-browser popup and printing behaviour;
3. a visual check of the A4 layout;
4. review and explicit approval before merge or release.

**It is not operationally verified, merged, deployed or release-cleared.** Canonical severity, wave, release class and acceptance criteria are unchanged.

**Worktree after the implementation:** tracked `ca9bd15782ac6943…`, untracked `e2601a7f0038c671…`, 0 staged.

---

## 5K. Autonomous remediation session (2026-10-15)

| Field | Value |
|---|---|
| Scope | The registry was reconciled against this report and the worktree; every finding with satisfied prerequisites was worked. Pulled forward: W9 (CF-124, 126, 127, 128, 129, 131), W12 (CF-079, 113, 140, 141, 142, 143 and parts of others), W4 (CF-061 + CF-062), W5 (CF-100), W2 (CF-144) |
| Environment | Worktree only. No production, database, Redis, Docker or provider access. Stubs and dummy values only. Nothing staged or committed |
| Not touched | `POS.tsx` (user edits pending), canonical audit reports, the main checkout's code |
| Method | Regression test first (red), smallest fix, mutation check (revert the change → a test must fail → restore and checksum), then the full suites |

### 5K.1 Fixed at code level (uncommitted)

| CF | Change | Files (worktree) | Tests | Mutations |
|---|---|---|---|---|
| CF-124 | One bcrypt comparison per login attempt; a cost-12 dummy hash for unknown or inactive accounts. The same in platform-admin login | `api/shared/utils/password.ts`, `api/modules/auth/auth.service.ts`, `api/modules/admin/admin.auth.service.ts` | `auth/__tests__/auth-hardening.test.ts`, `admin/__tests__/admin-auth-hardening.test.ts` | 3 caught |
| CF-126 | The refresh cookie is cleared with the Domain and Path it was set with (4 call sites) | `api/modules/auth/auth.routes.ts` | `auth-hardening.test.ts` | 1 caught |
| CF-127 | `/api/auth/refresh` refuses a session stored for another tenant or schema (401 `tenant_mismatch`) and neither deletes it nor clears the shared cookie | `auth.routes.ts` | `auth-hardening.test.ts` | 2 caught |
| CF-128 | Forgot-password counter keyed `rate:forgot:<tenantId>:<trimmed lower-case e-mail>` | `auth.service.ts`, `auth.routes.ts` | `auth-hardening.test.ts` | 2 caught |
| CF-129 | Admin refresh limited to 30 per minute (as the tenant refresh) | `api/modules/admin/admin.routes.ts` | `admin-auth-hardening.test.ts` | 1 caught |
| CF-131 | The admin access token is no longer persisted in localStorage (profile only); persist version 1 drops a token stored by the old version. `admin-client.ts` already refreshes a missing token | `web/src/stores/admin-auth.store.ts` | `web/src/stores/__tests__/admin-auth-persistence.test.ts` | 2 caught |
| CF-079 | `@fastify/multipart` registered in the product and customer route plugins only (one file ≤ 2 MiB, no other parts, ≤ 1,000 data rows: owner-adjustable defaults); RFC 4180 CSV parser (quoted commas no longer shift columns); the bulk audit row uses `entityId: null` (it wrote `'bulk'` into a UUID column, which would have failed after the rows were created); imported opening stock creates a row in every active branch plus an `adjustment` movement (`csv_import`), and only on an active branch of the store | `api/shared/utils/csv.ts`, `csv-upload.ts` (new), `shared/utils/audit.ts`, `products/product.routes.ts`, `customers/customer.routes.ts` | `shared/utils/__tests__/csv.test.ts`, `products/__tests__/csv-import.test.ts` | 9 caught (2 initially survived; tests added) |
| CF-113 | The statement export no longer selects the non-existent `installment_contracts.remaining_amount`; remaining = the contract's unpaid `installment_payments.amount_paid` | `customers/customer.routes.ts` | `customers/__tests__/customer-statement.test.ts` (stub rejects unknown columns like Postgres 42703, from the migrations' DDL) | 2 caught |
| CF-140 | A new branch and a zero-quantity stock row per existing variant are created in one transaction | `api/modules/branches/branch.service.ts` (new), `api/src/index.ts` | `branches/__tests__/create-branch.test.ts` | 1 caught |
| CF-141 | The low-stock filter is part of the query (Prisma field reference, as the dashboard uses), so pages and `total` agree | `stock/stock.service.ts` | `stock/__tests__/list-stock-low-filter.test.ts` | 2 caught |
| CF-142 | The owner e-mail is trimmed and lower-cased at the schema; the duplicate check ignores case (existing rows are not migrated) | `tenants/tenant.schema.ts`, `tenant.service.ts` | `tenants/__tests__/tenant-email-normalisation.test.ts` | 2 caught |
| CF-143 | The signup `loginUrl` follows `APP_BASE_DOMAIN` / `FRONTEND_URL`, not `http://<sub>.localhost:5173` | `tenants/tenant.routes.ts` | `tenants/__tests__/register-login-url.test.ts` | 1 caught |
| CF-144 | The installment formulas live in one production module used by the service and by the tests (the test no longer re-implements them; all original cases kept) | `installments/installment.math.ts` (new), `installment.service.ts`, `__tests__/installment.math.test.ts` | + `installment.schedule.service.test.ts` | 3 caught (2 initially survived: 12-month-only cases; static-only guard; tests added) |
| CF-061 + CF-062 | Discount creation converts YYYY-MM-DD to dates (the 500), accepts only real dates with end ≥ start, percentage ≤ 100, fixed ≤ the cheapest variant price, 404 for an unknown product; both sale paths clamp the line discount to the line amount | `shared/utils/product-discount.ts` (new), `products/product.routes.ts`, `invoices/invoice.service.ts`, `installments/installment.service.ts` | `shared/utils/__tests__/product-discount.test.ts`, `products/__tests__/product-discount-route.test.ts` | 6 caught (1 initially survived; test fixed) |
| CF-100 | `approveContract` reads its response through `tx` (red phase reproduced the stale `pending_approval` response) | `installments/installment.service.ts` | `installment.schedule.service.test.ts` | red → green |
| CF-042 (residual) | The two remaining silent `.catch(() => {})` e-mail paths (trial expired, cancellation scheduled) log template and tenant, never the recipient | `jobs/trial-expiry.job.ts`, `billing/billing.routes.ts` | `jobs/__tests__/reminder-recheck-and-silent-email.test.ts`, `billing/__tests__/cancel-email-failure.test.ts` | 2 caught |
| CF-092 (partial) | Each payment is re-read with the same due conditions right before its send; new counter `skippedNoLongerDue` (API and toast) | `jobs/installment-reminders.job.ts`, `web/.../Installments.tsx` | `reminder-recheck-and-silent-email.test.ts` | 2 caught |
| CF-033 (partial) | `TRUST_PROXY` → Fastify `trustProxy` (unset = off; hop count, IP / CIDR list or `true`; malformed values fail at boot); documented in `.env.example` | `api/config/trust-proxy.ts` (new), `config/env.ts`, `index.ts`, `.env.example` | `config/__tests__/trust-proxy.test.ts` (incl. `request.ip` behaviour) | 3 caught |
| CF-114 (guard only; not fixed) | DB-free column-level SQL ↔ Prisma parity test; the single current drift (CF-112 `installment_payments.payment_method_id`) is recorded as its baseline | `api/src/__tests__/tenant-column-parity.test.ts` | — | schema edit caught; schema restored byte-identical |

Pre-existing test files changed (fixtures only, no assertion removed): `installment-reminders.scope.test.ts`, `send-reminders.scope.test.ts`, `email-delivery.jobs.test.ts` gained an `installmentPayment.findFirst` stub, and two exact summary expectations gained `skippedNoLongerDue: 0`.

### 5K.2 Partially fixed (uncommitted)

| CF | Done | Not done (blocker) |
|---|---|---|
| CF-021 (P1 RB) | `GET /api/billing/portal` no longer returns `providerCardToken` or attempts' raw `providerResponse` (`billing.routes.ts`; `billing/__tests__/portal-card-token.test.ts`, 2 mutations caught) | Billing permissions on cancel / resume / portal (W3, owner decisions) |
| CF-081 | Return and cancel invalidate every financial summary (`web/src/lib/query-invalidation.ts`, `Invoices.tsx`; 2 caught) | POS sale path and EOD date key (`POS.tsx`) |
| CF-116 | A used coupon cannot be deleted (409 `coupon_in_use`, deactivate instead; 404 unknown); provisioning rollback drops only a schema this run created (`coupon.routes.ts`, `tenant.service.ts`; 2 caught) | Platform-admin audit-log cascade (master FK migration) |
| CF-133 | Installment contract print and day-close print escape tenant text (`lib/print-contract.ts` moved out of `Installments.tsx`, `DayClose.tsx`); the print-template preview is sanitised (`lib/print-template.ts`) (`lib/__tests__/print-sinks.test.tsx`; 7 caught) | `POS.tsx` day-close sink; PV-14 (CSP in popups) |
| CF-145 | FIN-24 "approval response via base client" (= CF-100) | Sequence gaps; UTC date (CF-082 decision) |
| CF-155 | Raw server codes mapped to Arabic, ids never shown (`lib/api-error.ts`); invoice-detail failure toasts instead of an unhandled rejection; three cited toasts show the server reason (2 caught) | List error states with retry; other generic toasts |
| CF-156 | `Money` formats decimal strings and shows `—` when missing; receipt, label and PO prints use the grouped 2-dp format (2 caught) | `POS.tsx` currency labels and integer EOD total |
| CF-157 | Settings tab rail stacks and scrolls below `md`, content `min-w-0`, `aria-current`; the banner wraps (1 caught). **Browser baseline** on the unmodified page at 375 px: 431 px document, 184 px content column (= Phase 7 E22) | Post-fix browser re-measure (not done: the preview tool serves only the main checkout); `POS.tsx` checkout |
| CF-160 | 21 labels tied to their controls; two caption labels made non-labels; decorative backdrops `aria-hidden`; the admin sidebar closes on Escape; return ± buttons named (3 caught). jsx-a11y warnings 32 → 1 | `POS.tsx` label and remove-customer button |

### 5K.3 Earlier work found in the worktree but not recorded here (re-verified 2026-10-15)

Read from the diff and mutation-checked against its own tests; all caught:

| CF | Code | Mutations |
|---|---|---|
| CF-043 | `api/modules/health/health.routes.ts`, `migration-state.ts` (new); `index.ts`; `admin.routes.ts` records manual runs | V1 `/readyz` ignoring migrations, V2 queueing on a non-ready Redis, V3 a stale pass overwriting state |
| CF-041 | `eta/eta.client.ts` (15 s on token and status calls), `shared/utils/email.ts` (10 s Resend bound) | V4, V5 |
| CF-042 | `shared/utils/email.ts` (`deliver`, `EmailDeliveryError`), jobs record only confirmed sends | V6 |
| CF-050 | `reports/report.service.ts`, `excel.ts`, `web/.../Reports.tsx` | V7 |
| CF-093 | `shared/utils/job-log.ts` (new), all five job files | V8 retention, V9 stack leak |

Spot checks of earlier recorded fixes: CF-132 (V10b), CF-035 (V11), CF-025 (V12b) caught. (A first CF-132 mutant appeared to survive because it hit another route's `requireOwner()`; retargeted, it was caught.)

### 5K.4 CF-047: current behaviour (documentation only)

In `NODE_ENV=production` the API only **warns** when `APP_ENCRYPTION_KEY` (or one shorter than 32 characters) or `PAYMOB_HMAC_SECRET` is missing. `RESEND_API_KEY` and `PAYMOB_API_KEY` are optional: e-mail is skipped with a warning, billing calls fail at use. A missing `NODE_ENV` defaults to `development`, so none of these checks run. **Owner decision still required** (row 15); nothing was enforced.

### 5K.5 Checks run (worktree; results as observed)

| Check | Session start | After the session |
|---|---|---|
| API tests | 33 files / 322 passed | **52 files / 458 passed** |
| API type-check / lint / build | pass / pass / — | **pass / pass / pass** |
| Web tests | 15 files / 138 passed (1 unidentified failure in 1 of 6 runs) | **24 files / 196 passed**, three consecutive runs |
| Web type-check / build | — | **pass / pass** |
| Web lint | 55 warnings | **0 errors, 26 warnings** (all pre-existing) |

**Not run:** DB- or Redis-backed tests (Docker not authorised), real-browser printing and popups, Playwright.

### 5K.6 Preservation

Main checkout: HEAD `8846bce`, tracked diff `439b10007f77b183…` and the `POS.tsx`, `AppShell.tsx`, overview and audit-document hashes are identical before and after the session (this report excepted, edited in place under the user's authorisation of 2026-10-15). Worktree: HEAD `7317c97`; tracked diff `ffd88b65b094cab8…` → `cd173ae6d3b79640…`; 0 staged. Pre-existing worktree files whose content changed are only those edited on purpose (listed in §5K.1–§5K.2; the CF-023 receipt dialog in `Invoices.tsx` untouched).

### 5K.7 Status

The findings in §5K.1 are **fixed at code level** and those in §5K.2 **partially fixed**: none is merged, deployed, operationally verified or release-cleared. Canonical severity, wave, release class and acceptance criteria are unchanged. **All 26 release blockers remain uncleared.**

---

## 5L. Remediation session 3 (2026-10-15): W2 primitives, W5b guarded writes, W4 guards

| Field | Value |
|---|---|
| Scope | Findings with satisfied prerequisites outside W1. W5b's guarded writes depend HARD on the W2 primitives (Phase 10 D-1), so those were built first (row 24). Legality questions (CF-004, installment cancellation) and anything needing DDL were not touched |
| Environment | Worktree only; stubbed databases (the stubs apply the `where` they receive, and model a race as a stale read before the transaction plus live state inside it). No Docker, database, Redis, production or provider access. Nothing staged or committed |
| Not touched | `POS.tsx`, `AppShell.tsx` (user edits), canonical audit reports |

### 5L.1 W2 primitives (T-07)

`apps/api/src/shared/db/guarded.ts` (new): `transition(delegate, { where, data }, code)` (count must be 1, else 409 `code`) and `lockRow(delegate, { where: { id }, data: <no-op such as { paidAmount: { increment: 0 } }> })` (takes the row lock; 404 if absent). Both use Prisma model delegates (schema-qualified), never raw SQL. Tests: `shared/db/__tests__/guarded.test.ts` (7). **Not run:** the W2 race harness (20 trials per case, real PostgreSQL).

### 5L.2 W5b guarded writes (fixed at code level)

| CF | Change | Files | Tests (all mocked) | Mutations |
|---|---|---|---|---|
| CF-011 (RB) | Credit spent with a decrement conditional on `creditBalance ≥ amount`; count 0 → 409 `insufficient_credit` (route maps it) | `invoices/invoice.service.ts`, `invoice.routes.ts` | `invoices/__tests__/create-invoice.guards.test.ts` | 2 caught |
| CF-012 (RB) | Approve and reject are conditional transitions from `pending_approval`, as the first statement; the loser gets 409 | `installments/installment.service.ts`, `installment.routes.ts` | `installments/__tests__/installment.exactly-once.test.ts` | 2 caught (re-run after a stub fix) |
| CF-013 (RB) | Cancel's first statement is the conditional status change (legal source statuses unchanged: anything but cancelled / returned) | `invoice.service.ts` | `invoices/__tests__/invoice-reversal.exactly-once.test.ts` | 1 caught |
| CF-014 (RB) | Return locks the invoice row, then re-reads status and cumulative returns; cancel re-counts returns after its transition; the race loser gets 409 (§8.2) | `invoice.service.ts`, `invoice.routes.ts` | same file | 3 caught (one non-compiling mutant redone) |
| CF-015 (RB) | Receive locks the PO row, re-reads items and status, re-plans the batch; the loser gets 409 | `purchase-orders/po.routes.ts` | `purchase-orders/__tests__/po.exactly-once.test.ts` | 2 caught; 1 equivalent (no route leaves `approved` except receiving) |
| CF-071 | Each variant is locked (sorted order) before its cost and on-hand quantity are read | `po.routes.ts` | same file | 2 caught |
| CF-075 | PO payment: lock, re-check the remaining balance, then write (was an array transaction with a stale check) | `po.routes.ts` | same file | 1 caught |
| CF-070 | Transfer approve / reject are conditional transitions; the source decrement is conditional on stock | `stock/stock.service.ts`, `stock.routes.ts` | `stock/__tests__/transfer.exactly-once.test.ts` | 3 caught (one re-run after a stub fix) |
| CF-072 | The invoice is linked with `invoiceId IS NULL` (and not cancelled); the second request rolls back with its invoice (409) | `services/workOrder.routes.ts` | `services/__tests__/work-order.exactly-once.test.ts` | 1 caught |
| CF-073 | Work-order payment under the row lock, bounded by the locked-in total, with its audit row in the same transaction | `workOrder.routes.ts` | same file | 3 caught |
| CF-074 | Manual credit adjustment: atomic increment / conditional decrement, audit row in the same transaction | `customers/customer.routes.ts` | `customers/__tests__/credit-adjust.test.ts` | 1 caught |
| CF-101 | Installment payment row paid only if not already paid (409) | `installment.service.ts`, `installment.routes.ts` | `installment.exactly-once.test.ts` | 1 caught |

**Not done (DDL, blocked):** `CHECK (credit_balance >= 0)`, `UNIQUE (contract_id, installment_number)`, `CHECK (received_quantity <= quantity)`, `CHECK (paid_amount <= total_amount)`: they need T-01/T-02 cleanup of existing rows, the T-03 restore drill and a disposable database. **Not run:** RT-A1 … RT-A5.

### 5L.3 W4 guards and CF-104 (fixed at code level)

| CF | Change | Tests | Mutations |
|---|---|---|---|
| CF-068 | POS sale and installment sale require an active product, not only an active variant | `create-invoice.guards.test.ts`, `installments/__tests__/create-contract.inactive-product.test.ts` | 2 caught |
| CF-063 | Coupon minimum enforced server-side (`coupon_min_not_met`) against Σ unit price × qty, the base the POS uses (owner may confirm another base) | `create-invoice.guards.test.ts` | 1 caught |
| CF-036 | Capped redemption grants only the floored points' value; 0 points → no discount; points earned floor the exact decimal | `shared/utils/__tests__/loyalty.test.ts` (incl. a property sweep), `create-invoice.guards.test.ts` | 2 caught; 1 equivalent (the 0-point guard is redundant) |
| CF-104 | Return and cancel restocks upsert the stock row (a missing row was "restocked" with no quantity change) | `invoice-reversal.exactly-once.test.ts` | 1 caught |

### 5L.4 W10 hygiene (fixed at code level)

CF-149: `packages/database/prisma/migrations/migration_lock.toml` (provider `postgresql`). CF-165: the Dockerfile comment now matches the `tsx` command (comment only; the command is unchanged). Guard: `apps/api/src/__tests__/release-hygiene.test.ts`.

### 5L.5 Partially fixed

| CF | Done | Not done |
|---|---|---|
| CF-064 | Split payment: both fields required, an active method other than the primary, amount ≤ total (3 caught) | Allocation rows, per-allocation fees, reports (T-13) |
| CF-076 | Stock rows locked in variant-id order in sales, returns, cancel, installment approval, transfers and PO receipts; invoice lines keep the cart order (1 caught) | Deadlock retry; customer-row vs stock-row order differs between sale and cancel |
| CF-083 | Generic 402 handling (D-28): the client marks the subscription inactive; a full-page notice for signed-in users (billing link only for whoever can pay, billing tab reachable); a refresh refused with 402 is no longer reported as "session expired" (`web/src/lib/subscription-gate.ts`, `components/SubscriptionInactiveGate.tsx`, `api/client.ts`, `App.tsx`; 4 caught after adding a billing-read-only case) | "Period ended, payment not received" banner state (T-24, W6) |
| CF-106 | A cancelled work order cannot be invoiced (pre-check and conditional link; 1 caught) | Owner: restrict invoicing to `ready` / `delivered` as DB-36 recommends? |
| CF-120 | UI no longer offers return / cancel without `invoices:update`, "send reminders" without `installments:update`, or the banner's billing link without billing write access (4 caught) | Server-side permission model and Settings tab gating (W3 T-10) |

### 5L.6 Checks run (worktree)

| Check | Result |
|---|---|
| `pnpm --filter @hesba/api test` | **62 files / 519 passed** |
| `pnpm --filter @hesba/api type-check` / `lint` / `build` | **pass / pass (0 findings) / pass** |
| `pnpm --filter @hesba/web test` | **26 files / 216 passed** |
| `pnpm --filter @hesba/web type-check` / `lint` / `build` | **pass / 0 errors, 26 warnings (all pre-existing) / pass** |
| Mutation checks | N1–N42: all caught except three equivalent mutants (N8, N17, N29 control) and one control (N32 before its test was added; N32b caught). Two stubs that treated a missing condition as a mismatch were corrected and their mutants re-run (N13b, N14b, N22b caught) |

**Not run:** any real-database, Redis or browser check.

### 5L.7 Status

Every finding in §5L.2–§5L.4 is **fixed at code level**; §5L.5 is **partially fixed**. None is merged, deployed, operationally verified or release-cleared. Canonical severity, wave, release class and acceptance criteria are unchanged. **All 26 release blockers remain uncleared** (§7.2).

## 5M. Remediation session 4 (2026-10-15): disposable PostgreSQL / Redis acceptance

| Field | Value |
|---|---|
| Authorisation | The user approved "a disposable local PostgreSQL and Redis with Docker (no production access)" for the RT-A\* race tests and the other DB / Redis checks in §7.3. Nothing else was run under that approval (the CF-048 Docker build-context check was not run) |
| Environment | `postgres:16-alpine` (PostgreSQL 16.13) and `redis:7-alpine` (Redis 7.4.8) containers `hesba-it-pg` / `hesba-it-redis`, published on 127.0.0.1 only. The user's `hesba_postgres` / `hesba_redis` containers were not touched. Docker Desktop was off before the session; it was started for these checks and shut down afterwards. Starting it also auto-started the user's existing `moneyprinterturbo-*` containers, which stopped again with it. The test containers were removed; the ports are free |
| Isolation | The suite refuses to start unless `HESBA_IT_DATABASE_URL` and `HESBA_IT_REDIS_URL` point at loopback. Every provider key is blanked, `fetch` is restricted to loopback, and JWT / encryption secrets are dummies. No production host, provider, real e-mail, card or tax call |
| Not touched | `POS.tsx`, `AppShell.tsx` (user edits), canonical audit reports. Nothing staged or committed |

### 5M.1 Integration harness (new, opt-in)

- `apps/api/vitest.integration.config.ts` and `vitest.integration.setup.ts`; script `test:integration`. The default `vitest.config.ts` now excludes `src/**/*.int.test.ts`, so `pnpm test` is unchanged and needs no database.
- `src/__integration__/fixtures.ts`: tenants come from the real `provisionTenant` (all tenant migrations, seeded roles); helpers for products, customers, stock, and 20-trial races with a 0–20 ms random stagger.
- `src/__integration__/app.ts`: the real auth path (cookie, JWT, rate-limit plugins, `tenantMiddleware`, `/api/auth/login`) for role-dependent checks.

Command: `HESBA_IT_DATABASE_URL=postgresql://…@127.0.0.1:<port>/… HESBA_IT_REDIS_URL=redis://127.0.0.1:<port> pnpm --filter @hesba/api test:integration`.

### 5M.2 Results (final run from a freshly created database: 9 files, 56 tests, all pass)

| Check | CF | Result |
|---|---|---|
| W2 harness: `transition` ×20, `lockRow` ×20; an unlocked control | T-07 | Exactly one winner per trial; no lost update under `lockRow`; the control **does** lose updates (the harness detects the race) |
| RT-A1 credit spend, 20 concurrent trials | CF-011 | 19 of 20 trials overlapped; the overlapping loser got 409 `insufficient_credit`; balance never negative; ledger + balance = opening credit in every trial |
| RT-A2 approve ∥ reject | CF-012 | One winner each trial (wins split 7 / 13 between approve and reject); loser 409; installments created once |
| RT-A3 cancel ∥ cancel | CF-013 | One winner; stock restored once |
| RT-A4 return ∥ return, return ∥ cancel | CF-014 | Never more returned than sold; return ∥ cancel winners 10 / 10; loser 409 |
| RT-A5 receive ∥ receive; WAC serial check | CF-015, CF-071 | Received ≤ ordered; stock and weighted average cost correct, also with two POs on one variant |
| Other W5b races | CF-070, 072, 073, 074, 075, 101 | One winner each; no oversell, double link, overpayment or negative credit |
| RT7-04, real login | CF-025 | Seeded cashier lists payment methods (200) and completes a cash sale (201); still cannot change payment methods |
| RT7-03, real database | CF-026 | Every item has `productName`, `sku` and a 2-dp `lineSubtotal`. Response recorded to `apps/web/src/pages/invoices/__tests__/fixtures/invoice-detail.real-db.response.json` (cashier / branch reduced to id and name; no secrets or personal data), and `invoice-detail.real-db.test.tsx` checks the drawer and A4 output against it |
| Receipt recipient R1, real route and database | CF-023 | On-file address: 200 plus one audit row; cashier with another address: 403, nothing sent, no audit row; owner with another address: 200 |
| RT6-M, loopback Resend mock (SDK `RESEND_BASE_URL`) | CF-042, CF-023 | Receipt: 200 → 200; 500 → 502 `email_failed`; 429 → 502; connection reset → 504 `email_unknown`. Reminder: 500 → no reminder recorded; then 200 → sent and recorded once |
| RT-C3 / RT-HSEC05 | CF-022 | Cron ∥ manual trigger: no duplicate sends (the cron cycle skipped the locked store 8 times); manual ∥ manual → [200, 409]; tenant A's trigger never e-mails tenant B's customers. The cycle was invoked directly, not through a BullMQ worker |
| `withLock` on a real Redis, ×20; release after TTL expiry | CF-040 (CF-022-FU1) | One holder at a time; an expired holder's release leaves the next owner's lock in place (Lua compare-and-delete). Renewal is still not implemented |
| `/readyz` with containers paused (`HESBA_IT_PAUSE_CONTAINERS=1`) | CF-043 | All up: 200. PostgreSQL paused: 503, `/livez` 200. Redis paused: 503. Both resumed: 200 |
| Real tenant schema | CF-079, 113, 062, 140, 141, 142 | CSV imports (quoted commas, stock rows per branch); statement export (remaining = unpaid scheduled amounts); discount dates; low-stock filter; new-branch stock rows; mixed-case owner e-mail duplicate check |
| Sale guards on the real route | CF-036, 063, 064, 068 | Capped redemption consumes only floored points; coupon minimum enforced; split above total 400; deactivated product refused |
| Reminder claims | CF-091, CF-092 | 20 overlapping unlocked runs: no duplicate send in any trial; a payment paid mid-cycle is not reminded; a definitely failed send releases the claim, an unknown outcome keeps it; `migrateAllTenants` brings existing tenants to version 18 |

### 5M.3 Defects found by the real-database run and fixed (test first)

| Defect | Fix | Tests |
|---|---|---|
| CF-043: Redis is created with `lazyConnect`; until something else connected it, its status was `wait`, so `/readyz` reported Redis down | The readiness probe connects a `wait` client before checking it | `modules/health/__tests__/readiness-lazy-redis.test.ts`; integration readiness test |
| CF-113: the three statement queries compared a `uuid` column with a text parameter (PostgreSQL 42883 `operator does not exist: uuid = text`), so every statement export returned 500 on a real database. The DDL-only guard could not see it | `customer_id = $1::uuid` | Unit guard in `customer-statement.test.ts`; integration statement test |
| Sequential losers (second cancel, return after cancel, second approve / payment / receipt) got 400; §8.2 asks for 409 on state conflicts | State-transition pre-checks return 409 (`invoice_cancelled`, `already_cancelled`, `invoice_returned`, `contract_not_pending`, `already_paid`, `transfer_not_pending`, `nothing_to_receive`). Returning more than was sold stays 400 | Sequential-loser cases in `invoice-reversal.exactly-once.test.ts` and the integration races |

### 5M.4 CF-091 and CF-092: claim before send (fixed at code level)

- **Migration:** additive tenant migration `packages/database/migrations/tenant/018_reminder_claims.sql`, which creates `reminder_claims (payment_id, reminder_date)`:
  - primary key on the pair;
  - foreign key to `installment_payments`, `ON DELETE CASCADE`;
  - `CREATE TABLE IF NOT EXISTS`, so no existing data changes.
- **Prisma:** model `ReminderClaim`.
- **The claim:** before sending, `installment-reminders.job.ts` takes it with one statement: `INSERT … SELECT … WHERE` the payment (`pending` / `overdue`) and its contract (`active` / `overdue`) are still due, with `ON CONFLICT DO NOTHING`.
  - No row inserted → no send. The run counts the payment as recently reminded if a claim already exists, otherwise as no longer due.
  - A definitely failed send (`EmailDeliveryError` `failed`) deletes the claim, so a later run may retry.
  - An `unknown` outcome keeps the claim (P6-P06: no automatic retry of a send that may have happened).
- **Replaced:** CF-092's interim re-read (§5K.1).
- **Tests:** unit `reminder-recheck-and-silent-email.test.ts` (rewritten for claims); the scope tests' stubs extended; integration `reminder-claims.int.test.ts`.
- **Deploy:** migration 018 runs with the normal tenant migration step. It has only been applied to the disposable database.

### 5M.5 Mutation checks (session 4)

- **Integration mutants IT1–IT9: all caught**, each by a real-database test. They removed or weakened the guard for CF-011, CF-013, CF-014, CF-012, CF-015, CF-071, CF-073, CF-113 (cast) and CF-091 (claim condition).
- **Unit mutants N43 and N44: caught.**
- Each mutant was restored and the file checksum verified.

### 5M.6 Checks run (worktree, after all session-4 changes)

| Check | Result |
|---|---|
| `pnpm --filter @hesba/api test` | **63 files / 531 passed** |
| `pnpm --filter @hesba/api type-check` / `lint` / `build` | pass / pass / pass |
| `pnpm --filter @hesba/web test` | **27 files / 218 passed** |
| `pnpm --filter @hesba/web type-check` / `lint` / `build` | pass / 0 errors, 26 warnings (all pre-existing) / pass |
| `@hesba/database` type-check | pass |
| `pnpm --filter @hesba/api test:integration` (disposable PostgreSQL / Redis, fresh database) | **9 files / 56 passed** |

### 5M.7 Status

- **Changed to fixed at code level:** CF-091 and CF-092. Totals are now 45 fixed / 21 partial / 95 not started / 2 blocked / 1 deferred / 3 no action (§1.1, §8).
- **Local acceptance only:** every check above passed on local disposable infrastructure. That is not staging, not production and not operational verification.
- **CF-022 stays partially fixed:** its §8.2 recovery criterion ("a re-run the next day sends again") and a run through the BullMQ worker are untested.
- **New owner question (§6):** tenant migration 016 allows a negative `credit_balance`, which conflicts with the `CHECK ≥ 0` proposed for CF-011.
- **Nothing is merged or deployed.** **All 26 release blockers remain uncleared** (§7.2).

---

## 5N. Remediation sessions 5–6 (2026-10-16 to 2026-10-19): W3–W12

**Mandate.** The owner said "كمل باللي انت شايفه صح واصلح كل حاجه" (fix everything, use your judgement). Two explicit approvals were given:
- the W3 permission and security edits (CF-005, CF-020, CF-021, CF-120 to CF-123), with no role-data migration and no commit;
- a temporary local PostgreSQL from Homebrew, on 127.0.0.1 only, run from the session scratchpad, then stopped and deleted after each run.

Business decisions taken under the delegation are listed in §6 ("Delegated decisions").

**Scope and boundaries.**
- Everything is in the `w1-safety-net` worktree, uncommitted: nothing staged, committed, pushed, merged or deployed.
- No production access, no real e-mail, no card charges, no tax submissions.
- `POS.tsx` was not edited because the owner's own POS edits are pending in the main checkout. Every POS-side item is listed in §5N.12.
- The auto-mode classifier blocked two things. A tenant migration that would grant permissions to stored roles was dropped; W3 uses fallback permission pairs instead. Starting a local PostgreSQL waited for the owner's approval.

### 5N.1 W3: permissions and branch scope
- **CF-005:** every settings, ETA and branch write requires `settings:update`. `GET /api/settings` returns a subset (no ETA registration) to users without `settings:read`. The routes moved from `index.ts` to `modules/settings/settings.routes.ts`.
- **CF-020, CF-021, CF-122:** `requireAnyPermission` takes fallback pairs: `coupons:X` or `invoices:update`, `customers:credit_adjust` or `invoices:refund`, `products:read_cost` or `products:update`, and `installments:reject` or `approve`. Cost fields are redacted for everyone else (`redactKeys`, `COST_FIELDS`). The platform tenant detail strips card tokens and provider responses.
- **CF-120:** a permission catalogue validates role edits (`unknown_permission`, `role_outranks_editor`). The web app has a capabilities module, filtered Settings tabs and gated buttons.
- **CF-121:** the user quota is the plan's `maxUsers` column. `features.max_users` was removed from the seed.
- **CF-123:** branch-bound users are scoped to their own branch on reads and writes (`scopeBranch`, `branch_forbidden`).
- **Tests:** RT-J1 route inventory and a role matrix (57 tests, `authz-role-matrix.test.ts`). 15 mutations were caught.

### 5N.2 W4 / W5: price, refunds, idempotency, allocations
- **CF-001:** the price is the variant's catalogue price on sales and installment contracts; a client `unitPrice` is ignored. The coupon minimum is checked on that price (CF-063).
- **Fee bearer:** comes from the payment method's setting. The cashier chooses only on `negotiable`; overriding needs `invoices:override_fee`. `percent` is normalised to `percentage` on the server (CF-017, server part).
- **CF-003:** refund = the paid share. Coupon, credit and loyalty are prorated, the fee is not refunded, and the credit share goes back to credit (`computeReturnRefund`). There is a return-quote endpoint and dialog (CF-027).
- **CF-004:** an installment invoice is cancelled or returned only through its contract (409 `installment_invoice`). Approval is a guarded transition (`invoice_not_pending`).
- **CF-016 (server):** tenant migration `019_operation_keys` and an `Idempotency-Key` header with claim, record and replay. CORS exposes `Idempotent-Replay`.
- **Migration `020_payment_allocations` (CF-018, CF-019, CF-064):** one row per tender with its fee. The invoice gets `coupon_discount`, `credit_used`, `loyalty_discount` and `cancelled_at`; a return gets `net_amount` and `tax_amount`.
- **CF-066:** loyalty never goes negative; a shortfall is recorded.
- **CF-112:** the installment payment method is now stored.
- **Migration `021_list_indexes` (CF-049, CF-137 partial):** list indexes, plus page-only item counts.

### 5N.3 W6: subscription lifecycle and payment intents
- Master migration `20261016000000_subscription_payment_intents` adds the `PaymentIntentStatus` enum, the `subscription_payment_intents` table and a partial unique index on the open intent per period.
- `modules/billing/lifecycle.ts` holds one rule, with or without a card:
  - paid subscriptions: +3 days → PAST_DUE, +14 → SUSPENDED, +30 → CANCELLED;
  - trials: 0 days → PAST_DUE, +7 → SUSPENDED, +30 → CANCELLED.
- The sweep is conditional and runs per row (CF-007, CF-010, CF-087, CF-088, CF-089).
- `modules/billing/payment-intent.ts`:
  - claim → charge → `UNKNOWN` on timeout; an unknown outcome is reconciled, never re-charged (CF-006, CF-038, CF-039, CF-090);
  - amount, currency and capture are verified before a payment is applied (CF-008);
  - tenant and card come from the signed intent; the card token is taken only from a signed TOKEN callback (CF-009);
  - an automatic payment on a CANCELLED subscription → `refund_required`, while a checkout reactivates.
- Paymob timeouts and `PaymobOutcomeUnknown` (CF-041, Paymob part). Lock renewal (CF-040).
- An admin plan change reaches the subscription (CF-077). Reminders skip suspended and cancelled stores (CF-078). The banner has a "period ended, unpaid" state (CF-083).

### 5N.4 W7 / W8: reports, Redis, the database pool, caches
- **CF-018 P&L:** computed in SQL inside one REPEATABLE READ transaction (`statement_timeout` 20 s) from the recorded effects: tax is not revenue, cancellations and returns are netted, and COGS uses `cost_at_sale`.
- **CF-019 day close:** built from the allocation ledger. Days before the ledger existed use the old computation; the switch-over day excludes ledger-covered ids.
- **CF-030:** stock report paged with an SQL summary; sales periods grouped in SQL.
- **CF-050:** a streamed Excel export of every matching invoice.
- **CF-139, CF-163:** the dashboard shows `generatedAt` and polls less often.
- **CF-028 Redis:** command timeout of 1.5 s with one retry; a cache miss on failure. BullMQ uses its own client.
- **CF-108:** generation-checked tenant cache (`shared/utils/tenant-cache.ts`).
- **CF-029, CF-098, CF-099:** connection budget (`DB_TENANT_CLIENTS_MAX` 20 × `DB_TENANT_CONNECTION_LIMIT` 3 + `DB_MASTER_CONNECTION_LIMIT` 10, checked against `DB_MAX_CONNECTIONS` 90), transaction limits, and retired clients with a 60 s grace period.
- **CF-051:** bcrypt runs in a worker-thread pool.
- **CF-094 (partial):** jobs use bounded concurrency (`mapLimit`).
- **CF-138:** asset cache headers, plus a Caddy `(app_proxy)` snippet (zstd/gzip, `/internal/*` → 404). The Caddyfile is **not validated**; no caddy binary was available.

### 5N.5 W9: sessions
- **`modules/auth/sessions.ts` (CF-117, CF-119):**
  - Redis keeps token hashes only;
  - refresh tokens rotate atomically within token families;
  - a reused refresh token revokes its family, except within a 10 s grace window for a second tab;
  - a family lasts at most 30 days;
  - a per-user registry supports revoking all of a user's sessions.
- **CF-118:** role, permissions and branch come from the user's current record (cached ≤ 60 s; invalidated on any user or role change). A deactivated user gets 401 `user_inactive`.
- **CF-024:** `PATCH /users/:id` handles self-change, outranking and the last owner, revokes the user's sessions and is audited. The web app has user controls with a confirm dialog.
- **CF-125:** the session hand-off from the main domain to the store subdomain uses the cookie, not the URL.
- **CF-134:** a browser `Origin` on store A cannot act on store B (403 `origin_mismatch`). The platform domain and system hosts are unaffected.

### 5N.6 W10: platform and operations
- **CF-034:** signup is limited to 3 per hour per IP, `SIGNUP_MAX_CONCURRENT` (2; excess → 503 `signup_busy`) and `SIGNUP_MAX_PER_HOUR` (30; excess → 429 `signup_capacity`), counted locally if Redis is down. The subdomain must be a DNS label of at most 56 characters (the `tenant_<sub>` identifier limit) and not a reserved name.
- **CF-053:** `schema_version` is updated inside each file's DDL transaction, in UTC.
- **CF-110:** CANCELLED stores are migrated, and the pending list is read under the lock.
- **CF-054:** a PROVISIONING row untouched for 30 minutes is reclaimed, at the next signup and by the daily sweep. Its schema is **renamed** to `orphan_<epoch>_<schema>`, never dropped. Activation and the trial share one transaction.
- **CF-111:** a rollback forgets the client and the cache.
- **CF-130:** the platform owner is created on first boot only. `OWNER_RESET_PASSWORD=true` is the break-glass reset.
- **CF-148, CF-149:** `migration-hygiene.test.ts` guards against migrations hard-coded to one tenant; the historical files are untouched.
- **CF-045 (partial):**
  - a CI `image` job builds the production image and boots it until `/readyz` answers;
  - the plan seed only creates missing plans;
  - Railway's health check is `/readyz` with `ALWAYS` restart (CF-152);
  - the runbook is `docs/operations/release-and-rollback.md`.
- **CF-150 (partial):** pnpm 10.33.2, prisma 5.22.0 and tsx 4.21.0 are pinned.
- **CF-151 (partial):** Docker log rotation (5 × 20 MB) and a `LOG_LEVEL` override.
- **CF-153:** a `VITE_BASE_DOMAIN` build argument (not build-verified).
- **CF-154:** the dev compose binds to 127.0.0.1, and `scripts/deploy.sh` is retired.

### 5N.7 W11: ETA (feature-gated; nothing auto-submits)
- **CF-055, CF-056:** the worker, routes and submit path use Prisma only (no raw SQL against columns that don't exist, no `uuid = text`).
- **CF-095:** the tenant comes from the master database; a schema name in the job payload is ignored.
- **CF-096:** one Queue per process.
- **CF-058 outcome model (partial):** each submission is claimed (`submitting`) and classified:
  - 202 with the document accepted → `submitted`, then polled until Valid → `accepted` (QR stored) or Invalid → `rejected`;
  - timeout, 5xx, a 422 duplicate or a garbled answer → `unknown`. These are never retried automatically, and a resubmit needs `confirmNotFiled`;
  - 400 → `rejected`; 401/403 → `failed`; 429 or the token endpoint unreachable → retried.
  Every attempt is recorded with ETA's `submissionUUID`.
- **CF-057 (partial):** the document is built from the stored lines:
  - service lines are included;
  - each line carries its stored discount and tax, at the sale-time rate;
  - the coupon is `extraDiscountAmount`;
  - a fee paid by the customer is its own line;
  - the branch is `issuer.address.branchID`;
  - the receiver is the customer;
  - item codes are ETA codes (tenant migration `022_eta_item_codes`, with a per-store default code);
  - the document is refused unless it adds up to what was charged.
  Production filing stays `pending_setup` (`signer_required`) until a real CAdES-BES signer exists. The PEM signature over sorted JSON was not ETA-compliant.
- **CF-059 (partial):** the outbox (`pending` written in the sale's transaction) and an hourly sweep exist but stay **off** unless `ETA_AUTO_SUBMIT=true`. Per D-18, turn it on only after PV-16 preprod acceptance.
- **CF-097:** `etaEnvironment` is persisted by PATCH and is the single source for the environment. Secrets are validated. Ciphertext carries a `v1:` format version, and `APP_ENCRYPTION_KEY_PREVIOUS` supports key rotation.
- **RT6-ETA1, RT6-ETA2, RT6-ETA3:** covered by unit tests and real-DB `w11-eta-real-db` (stub ETA client).

### 5N.8 W12 and leftover items
- **CF-082 / CF-161: business time zone (`tenant_settings.timezone`, default Africa/Cairo; DST-safe).** It now drives:
  - "today" and date ranges in reports, day close, list filters (`to` is now inclusive) and the web app;
  - invoice, work-order and service-invoice numbers;
  - plan quotas;
  - reminders.
  The VAT toggle is relabelled as service-invoice VAT.
- **CF-084:** prints show the store's registered name, address and tax registration number, not the platform. This covers the tax invoice, receipt, PO, work-order receipt and installment contract.
- **CF-060:** a cancellation reverses the merchant fee with a negative fee row dated that day. An external financing and a filed ETA document are flagged (`followUp`, `etaStatus = cancel_required`).
- **CF-076:** a bounded retry on deadlock or serialization failure for sale, return and cancel. The whole transaction was rolled back, so it is safe to repeat.
- **CF-067:**
  - `overdue` is marked daily and cleared by payment;
  - the invoice's `paidAmount` follows the payments;
  - payments on one contract are serialised by a row lock;
  - a down payment that covers the total is refused.
- **CF-105, CF-106, CF-107 (work orders):**
  - cancelling a work-order invoice releases the work order;
  - a work order is invoiced only when ready or delivered (delegated decision);
  - service invoices use the shared invoice sequence and the ETA rule.
- **CF-116:** deleting a platform admin now deactivates them. Master migration `20261019000000_platform_audit_restrict` changes the audit FK to `ON DELETE RESTRICT`.
- **CF-136 (partial):** the content type and exact size are signed into presigned PUTs, keys get a per-tenant prefix, and the empty-body checksum is fixed.
- **CF-147:** sales in a non-base currency are refused until conversion exists. Prices are base-currency catalogue prices, and no API creates other currencies.
- **CF-080 (partial):** the offline queue is cleared on logout and on a user or store switch.
- **CF-155 (partial):** list pages show an error state with retry.

### 5N.9 Real-database verification (PostgreSQL 18.3, Homebrew, 127.0.0.1:55433; stopped and deleted after each run)
- **Final run:** 9 files, **33 tests, all pass**:
  - w4-w5-real-db 9, w6-intents-real-db 3, w7-reports-real-db 1;
  - w10-provisioning-real-db 3, w11-eta-real-db 2, w12-real-db 3;
  - guarded-primitives 3, invoice-races 4, reminder-claims 5.
- **Migrations:** applied through `prisma migrate deploy` (both new master migrations) and tenant migrations 019–022.
- **Defects the real-DB runs found and fixed:**
  - the migration runner's `updated_at` must be UTC (CF-053);
  - the w10 test's own cleanup left ACTIVE rows without a schema (fixed in the test);
  - earlier: the W6 test dates and the W7 switch-over day.
- **Not re-run (they need Redis):** w5b-races, real-schema, acceptance, resend-delivery, reminders-and-locks, health-readiness.

### 5N.10 Mutation checks (sessions 5–6)
- **Unit mutants, all caught:** W1–W15, P1–P6, R1–R6, B1–B11, C1, S1–S7, O1–O2, M1–M3, P1–P6 (provisioning), G1–G4, O1–O2 (owner seed), E1–E19 (ETA), T1–T3 (time zone), P84a/b, R76a/b, C60a/b, I67a–d and R136a/b.
- **Equivalent mutants:** S7 (the last-owner check is unreachable). E1 and T3 first survived; their tests were strengthened and the mutants are now caught.
- **Integration mutants, all caught:** IT10–IT19, IT21–IT23. IT20 is equivalent: the conditional claim still prevents a second filing.

### 5N.11 Checks (worktree, 2026-10-19, after all changes)
- **API:**
  - `tsc` passes and `eslint` is clean;
  - vitest: **97 files / 796 tests pass, exit 0**. Four unhandled rejections from a test stub (`authz-role-matrix.test.ts`) were fixed by making the stub's `$`-methods functions;
  - build passes.
- **Web:** `tsc` passes; `eslint` shows 0 errors and 26 pre-existing warnings; vitest **34 files / 242 tests pass**; build passes.
- **packages/database:** `tsc` passes. The Prisma clients were regenerated after the schema additions. `prisma format` reflowed the tenant schema once; that was reverted line by line, so the diff contains additions only.

### 5N.12 Not done, and why
- **POS.tsx:** done in the worktree on the owner's instruction (2026-10-19, §5N.13). The owner reconciles it with their own POS edits.
- **DDL gated by T-01/T-02/T-03:** CF-102 (CHECK constraints), CF-115 (settings singleton), and the CF-142 back-fill of mixed-case rows.
- **Infrastructure or platform:** CF-031 backups, CF-032 monitoring (needs a Sentry DSN), CF-046 Redis persistence, CF-045 registry deploy, CF-150 digests and Action SHAs, CF-151 log shipping, CF-136 bucket split.
- **Owner or advisor decisions:** CF-047 fail-fast configuration policy, CF-146 VAT before the coupon (tax advisor), and the CF-084 legal check.
- **Design work not attempted:**
  - CF-052 (raw SQL under a transaction pooler);
  - CF-065 (credit and loyalty ledger: DDL);
  - CF-086 (shared pricing module);
  - CF-103 (count-then-create limits);
  - CF-162 (process split);
  - CF-067 early or partial settlement;
  - CF-057 real ETA signer and PV-16.
- **Release blockers:** none is operationally cleared (§7). Many now have code-level fixes and need the gates in §7.


### 5N.13 POS items (2026-10-19; the owner said "Go ahead with the POS.tsx items in the worktree … I'll reconcile with my own POS edits later")

**Reconciliation note.** The worktree's `POS.tsx` descends from `main` @ `7317c97`. The main checkout is on `8846bce` ("merge split payment into طريقة الدفع section") and holds uncommitted POS and AppShell edits. Neither was touched; the owner reconciles them.

- **CF-002: one pricing function.**
  - `priceSale` was extracted from `createInvoice` and `priceContract` from `createContract`. `POST /invoices/quote` and `POST /installments/quote` (guarded by `invoices:create` / `installments:create`) return the server breakdown: lines, product discounts, coupon, VAT, fee, credit, loyalty and total; for contracts also the down payment, interest and monthly amount.
  - The POS calls the quote on every cart change (debounced; checkout waits for a current quote), shows only server figures in the cart lines, panel, completion modal and receipt, and no longer sends a client unit price.
  - The receipt now shows VAT, credit and loyalty, and adds up.
  - The installment form shows the server monthly amount (the browser formula omitted VAT).
  - Real DB: the quote equals the recorded sale and contract (`w12-real-db`).
- **CF-016:** the POS sends one `Idempotency-Key` per checkout attempt and reuses it when the same attempt is retried. A different cart gets a new key.
- **CF-017:** the seed writes `percentage`; tenant migration `023_fee_type_percentage` normalises existing rows (exercised on PG 18.3); the client fee calculation is gone.
- **CF-025:** the POS shows an error state with retry when payment methods fail to load.
- **CF-080 (delegated decision):** offline selling is declared unsupported. Prices come from the server, checkout is disabled while offline, and the cart is kept. Sales queued by the old version are sent only on the cashier's request, each with a stable persisted Idempotency-Key, so a retry cannot duplicate.
- **CF-081:** a sale invalidates every sales summary. End-of-day queries use dated keys and `staleTime: 0`, with "as of" and a refresh button.
- **CF-082:** the POS "today" uses the store time zone.
- **CF-133:** the end-of-day print sink is escaped.
- **CF-156:** amounts use `Money` with one currency label; end-of-day totals are 2 dp.
- **CF-157:** a sticky mobile checkout bar (total plus checkout).
- **CF-158 (partial):** the cart draft is kept in sessionStorage per store and user and restored after a reload or the same user's re-login, plus a beforeunload warning. A re-auth modal and the other forms are not done.
- **CF-159:** loyalty points are redeemed in the POS through the quote.
- **CF-160 (partial at the time):** POS and installment-form labels are done. Correction (§5N.14): the 25 lint warnings are React hook/compiler warnings, not accessibility labels; jsx-a11y reports none.
- **Tests:**
  - web: `pos-page.test.tsx` (9), `contract-quote.test.tsx` (1), the receipt test;
  - API: priceSale parity, quote route mapping, and `pos-sale-permissions.test.ts` (the route map now includes the quote, `/settings` and the invoice detail; the cashier still reaches every route).
  The POS tests found one harness issue: TanStack's global online state must be reset between tests.
- **Mutations:** PO1–PO12 and IN1 are caught. PO8 and PO11 first survived; their tests were strengthened and both are now caught.
- **Checks:**
  - API: `tsc` and `eslint` pass; vitest 98 files / 802 tests pass; build passes.
  - Web: `tsc` passes; `eslint` shows 0 errors and 25 warnings; vitest 36 files / 253 tests pass; build passes.
  - Database `tsc` passes.
  - Real DB (temporary PG 18.3, stopped and deleted): 9 files / 34 tests pass.
- **Totals:** 10 not started / 19 partial / 132 fixed at code level / 2 blocked / 1 deferred / 3 no action.


### 5N.14 Items that needed no approval (2026-10-20/21; the owner said "كمل الباقي الاول دلوقتي")

- **CF-160:** jsx-a11y is enabled and reports nothing, and a scan found no icon-only button without a name. Correction to §5N.13: the 25 web lint warnings are React hook/compiler warnings, not accessibility labels.
- **CF-155:** 44 mutation toasts that showed a fixed text now pass the server's message through `getApiErrorMessage`, with the old text as the fallback. A guard test fails if a literal toast comes back.
- **CF-158:** when the session cannot be refreshed, a signed-in user signs in again in a dialog (`ReauthDialog`, `reauth.store`). Only the same account may continue, and the failed request plus everything queued meanwhile is retried; "تسجيل الخروج" keeps the old path. Together with the POS draft (§5N.13) nothing on the page is lost. In-app navigation blocking for other forms was not added (BrowserRouter has no blocker).
- **CF-137:**
  - master migration `20261020000000_pg_trgm` installs `pg_trgm` in `public`; tenant migration `024_search_trgm_indexes` adds trigram GIN indexes on product name, SKU, barcode, customer name and phone, and invoice number;
  - product search is a per-column UNION;
  - invoice search is one filtered, paginated query (the 200 + 200 id pre-filter is gone, so the total is right);
  - the POS aborts stale searches.
  - Real DB: a customer with 300 invoices gives `total = 300`, and EXPLAIN uses both trigram indexes.
- **CF-109:** every report (dashboard, sales, stock, installments, fees, returns, day close, P&L) reads inside one REPEATABLE READ transaction. The streamed Excel export is a separate read.
- **CF-069:** each sold product line stores the product name at sale time (`line_description`). Detail and ETA show it after a rename; service lines are unchanged.
- **CF-086:** the remaining float money paths are now decimal: the credit cap, loyalty reversal, the credit-deduct check, and the purchase-order payment epsilon (0.0001 over is now refused).
- **CF-094:**
  - jobs that walk every store use `withBatchTenantDb`: they borrow an open request client without refreshing it, otherwise use a short-lived single-connection client that is never cached;
  - the reminder scan is paged;
  - tenant migration `025_installment_due_index` adds `(status, due_date)`.
- **CF-103:** a plan cap that is a sentinel (≥ 999,999, 0 or −1) skips the count. A real cap is checked under a per-store, per-resource Redis lock held until the response is sent (R-11: 20 concurrent creates at cap − 1 give exactly one 200 and 19 × 402). If Redis is down the check runs unlocked, as before.
- **CF-114:**
  - the Prisma tenant model was regenerated from a migrated tenant schema with `prisma db pull`, merged into the existing file so all comments, field order and names are kept;
  - 12 relations that existed only as SQL foreign keys are now modelled (camelCase);
  - `prisma migrate diff` (migrated schema → model) is empty;
  - opt-in integration test `schema-drift.int.test.ts` (RT-D34).
- **Found on the way (fixed):**
  - All tenant timestamp columns are `timestamptz`, while the old model declared `TIMESTAMP(3)`. The sales-period grouping I wrote in W12 assumed plain timestamps and grouped late-evening sales into the wrong day; it now uses `created_at AT TIME ZONE <store zone>` (real-DB test with a sale at 00:30 Cairo).
  - The W7 integration test used the UTC date as "today"; it now uses the store's day.
  - **PV note:** the old client wrote plain timestamps into `timestamptz` columns, which PostgreSQL reads in the server's `TimeZone`. If production's `TimeZone` is not UTC, historical rows are shifted by that offset. Confirm `SHOW timezone` on production before relying on old timestamps.
- **Mutations:** T155, R158a/b, R109, C69a/b, C86, Q103a/b, B94a/b and IT25/IT26 are caught. IT27 is equivalent: Prisma binds JavaScript `Date` parameters correctly, and the explicit ISO cast is kept for clarity.
- **Checks:**
  - API: `tsc` and `eslint` pass; 101 files / 813 tests pass; build passes.
  - Web: `tsc` passes; `eslint` shows 0 errors and 25 warnings (React hook/compiler); 38 files / 259 tests pass; build passes.
  - Database `tsc` passes.
  - Real DB (temporary PG 18.3, server TimeZone Africa/Cairo, stopped and deleted): 10 files / 38 tests pass.
- **Totals:** 8 not started / 11 partial / 142 fixed at code level / 2 blocked / 1 deferred / 3 no action.

### 5N.15 Remaining code-feasible findings (2026-10-21; the owner said "كمل من فضلك باقي المشاكل")

Worktree only; nothing staged or committed. Decisions taken under the owner's delegation are in §6.0 (rows dated 2026-10-21).

**Database integrity (CF-102, CF-115, CF-012 backstop):**
- Tenant migration `026_integrity_constraints.sql` adds six CHECK constraints NOT VALID:
  - credit ≥ 0 and loyalty ≥ 0;
  - PO item received within 0…quantity;
  - PO paid within 0…total;
  - installment amount ≥ 0;
  - work-order paid ≥ 0.
- It also adds a `tenant_settings.singleton` column with a CHECK.
- A guarded DO block then validates every unvalidated CHECK in the schema, including migration 016's. A store with bad rows keeps that constraint NOT VALID: it is still enforced for new writes, and the migration logs a WARNING instead of failing.
- Two unique indexes are created in guarded blocks: `uq_installment_payment_number` and `uq_tenant_settings_singleton`.
- The migration splitter (`splitStatements`) is now a tokenizer. It handles dollar quotes, strings and comments. It splits migrations 001–025 exactly as before (tested).
- `scripts/db/constraint-report.sql` lists the offending rows.

**Customer ledger (CF-065):**
- Migration `027_customer_ledger.sql` adds a `customer_ledger` table, plus opening rows for every existing non-zero balance.
- Every credit or loyalty change writes one row with the balance after it, in the same transaction:
  - sale (credit used, points redeemed, points earned);
  - return to credit;
  - cancellation;
  - loyalty reversals;
  - manual add and deduct.
- `GET /customers/:id/credit-ledger` returns `movements` and `reconciled {credit, loyalty}` (Σ delta = balance). The customer drawer shows both and flags a mismatch.

**Configuration and process (CF-047, CF-052, CF-162):**
- `config/config-check.ts`: production refuses to boot when Paymob, R2 or Resend is *partly* configured, and names the missing variables. A feature that is not configured at all is reported as off. A present `APP_ENCRYPTION_KEY` shorter than 32 characters is fatal. `APP_BASE_DOMAIN` without `TRUST_PROXY` produces a warning.
- `EMAIL_FROM` is not required: it has a code default.
- A transaction-mode pooler refuses to boot in every environment: `DB_POOL_MODE=transaction|statement`, or `pgbouncer=true` in the URL.
- `PROCESS_ROLE=all|api|worker`, default `all`:
  - `api`: HTTP and migrations, no workers;
  - `worker`: jobs only, no HTTP and no migrations. The image's CMD skips master migrations and the seed in that role.
- An optional `worker` service runs under the compose profile `split`.

**Infrastructure files (CF-044, CF-046, CF-150) — repository only, nothing deployed:**
- `docker-compose.prod.yml`:
  - Redis runs with `--appendonly yes --appendfsync everysec --maxmemory-policy noeviction`. The safe switch-over (CONFIG SET first, then restart) is in the runbook, because a restart straight into AOF with no AOF file can start empty.
  - The app gets `stop_grace_period: 35s`.
- Base images (Dockerfile, compose) are pinned by digest. The digests were read from Docker Hub's API.
- CI Actions are pinned by commit SHA. The SHAs were read with `git ls-remote`; pnpm's annotated `v4` tag was peeled to its commit.
- New observation, not in the registry: Node 20 reached end-of-life in April 2026. Moving to Node 22 is a separate change.

**Backups (CF-031):**
- `scripts/db/backup.sh` takes one REPEATABLE READ snapshot. In it, `pg_dump --snapshot` writes the dump and an exact row count is taken for every table. It also writes a sha256 and applies a retention of N dumps.
- `scripts/db/restore-check.sh` restores into a new `hesba_restore_check_*` database on an isolated server, compares every count, prints the restore time and drops the scratch database.
- Runbook: `docs/operations/release-and-rollback.md`.
- Not run against production (gate G-3).

**Installments (CF-067) and ETA (CF-058):**
- `POST /installments/:id/settle` (early settlement), under the contract row lock:
  - every unpaid installment is paid at its scheduled amount, with allocations;
  - the invoice paid amount grows by the sum;
  - the contract completes;
  - the contract must be active or overdue, and a row paid concurrently aborts the whole settlement with a 409.
- The contract drawer has a "تسوية مبكرة" button with a confirmation.
- The API now returns `remainingAmount` and `nextDueDate`. The list and the drawer always showed them, but they were empty (Phase 1, printing row).
- `POST /admin/eta/cancel/:invoiceId` (`eta:manage`, reason required): an explicit operator action for `cancel_required` invoices.
  - The invoice is claimed (`cancelling`), then one `PUT /documents/state/{uuid}/state` is sent to ETA.
  - Any outcome other than acceptance returns it to `cancel_required` with the reason. Nothing is retried automatically.
  - Settings → ETA shows a cancel button and labels for every outcome status.
  - Fixed in passing: `etaError` is JSON since CF-058, and rendering it as a React child would have crashed the list.
  - The endpoint shape follows ETA's published API and has not been exercised against preprod (PV-16).

**Tests:**
- Unit:
  - config check (7), process roles (3), settlement and balances (6);
  - ETA cancellation (6), ETA client request (2);
  - migration splitter;
  - ledger helper, plus the guards in the sale, return and cancel stubs;
  - web: ledger view (2), ETA cancel button (1).
- Mutation:
  - unit: 19 mutants (M1–M19), all killed;
  - integration: 4 mutants (IT-M1 validate guard, IT-M2 return ledger row, IT-M3 settlement invoice update, IT-M4 ETA claim), all killed.
- Real database (temporary local PostgreSQL 18.3 from Homebrew, 127.0.0.1:55433, TimeZone Africa/Cairo; stopped and deleted afterwards). New file `w13-integrity-ledger.int.test.ts`, 6 tests:
  - a clean store validates everything;
  - negative credit and a second settings row are refused;
  - **dirty path:** a store put back at version 25, with a negative credit and two settings rows, still migrates to 27. The credit CHECK stays NOT VALID but is enforced, the singleton index is skipped, the opening ledger row is −5, and after cleanup VALIDATE succeeds;
  - ledger: manual add, a sale with credit and points, return to credit, a cancelled sale, manual deduct → Σ delta = balance, running `balance_after` is correct, and the route reports `reconciled` true;
  - settlement;
  - ETA cancel: a refusal is released; two concurrent clicks → exactly one reaches ETA.
  - The login route needs Redis (none in this harness), so the test signs the owner's access token directly.
- Backup scripts on the same temporary server:
  - dump → restore → 657 tables match (restore 9 s), and the scratch database is dropped;
  - tampered counts → exit 2;
  - tampered dump → checksum failure;
  - retention keeps exactly N dumps.

**Checks (worktree, after all changes):**
- API: `tsc` passes; lint shows 0 errors and 3 warnings (pre-existing unused variables); 107 files / 842 tests pass; build passes.
- Web: `tsc` passes; lint shows 0 errors and 25 warnings (React hook/compiler); 40 files / 262 tests pass; build passes.
- Database `tsc` passes.
- Real DB: 11 files / 44 tests pass, including `schema-drift` (empty diff).

**Still open:**
- Not started:
  - CF-032: needs a Sentry DSN and a recipient;
  - CF-146: needs a tax adviser.
- Partially fixed:
  - CF-022: a Redis/BullMQ run is needed;
  - CF-033: PV-01 (proxy chain);
  - CF-045: the plan registry;
  - CF-057: a real ETA signer, the ETA JSON schema, PV-16;
  - CF-059: PV-16;
  - CF-135: browser verification;
  - CF-136: bucket split and UI wiring;
  - CF-151: log shipping.
- **Totals:** 2 not started / 8 partial / 154 fixed at code level / 0 blocked / 0 deferred / 3 no action = 167.

### 5N.16 Redis-backed verification and CF-022 (2026-10-21; the owner approved a temporary Homebrew Redis: "ماشي")

- **Environment:**
  - Redis 8.10.2 from Homebrew, run by hand on 127.0.0.1:6399 with no persistence (`--save '' --appendonly no`), not as a service.
  - PostgreSQL 18.3 as in §5N.15.
  - Both were stopped and their data deleted. `brew uninstall redis openssl@4` was run, plus the three config files that install created. The Homebrew formula list is identical to before.
- **First run of the Redis-dependent suites** (never run in sessions 5–8). All pass:
  - `acceptance` (6): real login, the seeded cashier sells (RT7-04);
  - `reminders-and-locks` (6);
  - `resend-delivery` (5);
  - `health-readiness` (4).
- **`health-readiness`** paused Docker containers, and Docker is not allowed here. It gained an equivalent mode: `HESBA_IT_PAUSE_PIDS="pg=<pid>,redis=<pid>"` sends SIGSTOP/SIGCONT to the server process and all its children (every PostgreSQL backend). Under it, `/readyz` returned 503 for the frozen dependency and `/health` stayed 200 (report-only). The Docker mode is unchanged.
- **`w5b-races` (12 cases, 20 trials each)** had not been run since W3. It failed at startup: its auth stub lacked `scopeBranch`, which W3 added to the routes.
  - The stub now includes `scopeBranch` as a no-op. The test already stubs authorization on purpose; branch scoping is covered by the W3 tests.
  - With that, all 12 cases pass. No product change was needed.
- **CF-022, remaining §8.2 items:** new `reminders-bullmq.int.test.ts`. It uses the real BullMQ worker on real Redis, the real Resend SDK and a loopback Resend mock (3 tests):
  - a queued job completes, the customer is e-mailed once, and both locks are released;
  - a second run the same day sends nothing;
  - **the next day sends again**;
  - a send with an unknown outcome is not retried the same day (the claim is kept) and is sent the next day.
  - Integration mutants, all killed:
    - IT-M5: release the claim on unknown;
    - IT-M6: 72 h window instead of 24 h;
    - IT-M7: no claim.
  - CF-022 → fixed at code level. Still open as a separate decision (§6.0): a per-store rate limit on the manual trigger.
- **Web:** `early-settlement.test.tsx` (3 tests) covers:
  - the button shows the server's remaining amount;
  - one settle request is sent on confirmation;
  - the button is hidden on a completed contract and without `installments:update`.
  - Mutants M20–M22, all killed.
- **Log noise only:** the `w6-intents` Redis mock has no `multi`, so best-effort cache invalidation logs a TypeError. The test passes and the code is unchanged.
- **Checks:**
  - Real DB with Redis: **18 files / 91 tests pass (the whole integration suite)**.
  - Web: 41 files / 265 tests; lint 0 errors.
  - API: `tsc` and lint 0 errors (unit suite unchanged: 107 / 842).
- **Totals:** 2 not started / 7 partial / 155 fixed at code level / 3 no action = 167.

---

## 6. Open decisions and blockers (W1-wide)

### 6.0 Delegated decisions (2026-10-16 to 2026-10-19; owner: "كمل باللي انت شايفه صح")

These choices were made under the owner's delegation. Each one can be changed in the place named; none is irreversible.

| Topic | Decision | Where to change |
|---|---|---|
| Session-4 items | Kept: migration 018, the 409s, the report edits | — |
| Sale price | The server catalogue price; a client `unitPrice` is ignored; no override path yet | `invoice.service.ts`, `installment.service.ts` |
| Fee bearer | From the payment-method setting; the cashier chooses only on `negotiable`; an override needs `invoices:override_fee` | `invoice.service.ts` (`effectiveFeeBearer`) |
| Refund | The paid share: coupon, credit and loyalty prorated; the fee is not refunded; the credit share goes back to credit | `shared/utils/refund.ts` |
| Installment invoices | Cancelled or returned only through their contract | `invoice.service.ts` (CF-004 guard) |
| Loyalty reversal | Never below zero; the shortfall is recorded | `invoice.service.ts` (`adjustLoyalty`) |
| Branch scope | A user bound to a branch works in that branch only | `auth.middleware.ts` (`scopeBranch`) |
| Plan gates | `advanced_reports` gates P&L, top products and fees; `multi_currency` gates non-base currency; `features.max_users` removed | `report.routes.ts`, `feature.middleware.ts`, seed |
| Subscription lifecycle | Paid: +3 PAST_DUE / +14 SUSPENDED / +30 CANCELLED. Trial: 0 / +7 / +30. An automatic payment on CANCELLED → `refund_required`; a checkout reactivates; the card token is taken only from a signed TOKEN callback | `billing/lifecycle.ts` (`LIFECYCLE_POLICY`), `payment-intent.ts` |
| W3 fallback permissions | coupons:X or invoices:update; credit_adjust or invoices:refund; read_cost or products:update; reject or approve (no role-data migration) | route preHandlers |
| Signup capacity | 3 per hour per IP; 2 concurrent; 30 per hour platform-wide; reserved names; subdomain ≤ 56 characters | `tenants/signup-guard.ts`, `tenant.schema.ts`, env |
| Abandoned provisioning | Reclaimed after 30 minutes; the schema is renamed, never dropped | `tenant.service.ts` (`STALE_PROVISIONING_MS`) |
| Platform owner | Created from env on first boot only; `OWNER_RESET_PASSWORD=true` is break-glass | `admin.auth.service.ts` |
| Plan rows | The boot seed only creates missing plans; the admin panel owns existing ones | `master.seed.ts` |
| Production log level | `warn` by default (request URLs can carry customer search terms); `LOG_LEVEL` overrides | `index.ts` |
| ETA | Production filing waits for a real signer; automatic submission is off until `ETA_AUTO_SUBMIT=true` (after PV-16); an unknown outcome needs `confirmNotFiled` to resubmit | `eta.document.ts`, `eta.flags.ts`, `eta.routes.ts` |
| Business time zone | `tenant_settings.timezone` (default Africa/Cairo) defines the store's day everywhere | `shared/utils/business-time.ts`, `web/lib/business-date.ts` |
| Store VAT toggle | Applies to work-order invoices only (product VAT comes from each product's tax rate); relabelled | `Settings.tsx` |
| Cancellation | The merchant fee is reversed (void); an external financing and a filed ETA document are flagged for manual follow-up | `invoice.service.ts` (`cancelInvoice`) |
| Work-order invoicing | Only from `ready` / `delivered`; cancelling the invoice releases the work order; service invoices share the invoice sequence and the ETA rule | `workOrder.routes.ts` |
| Full down payment | Refused for an installment contract (make a regular sale) | `installment.service.ts` |
| Non-base currency | Sales refused until conversion exists | `invoice.service.ts`, `installment.service.ts` |
| Platform admin delete | Deactivates (the audit history stays); FK RESTRICT | `admin.routes.ts`, master migration `20261019000000` |
| Invoice sequence gaps | Accepted (PostgreSQL sequences skip values on rollback) | — |
| Offline selling | Not supported (prices come from the server); checkout disabled offline, cart kept; old queued sales sent only on request, with stable idempotency keys | `POS.tsx`, `lib/pos-offline-legacy.ts` |

| Item | Status | Needed |
|---|---|---|
| CF-047 Paymob / e-mail fail-fast policy | **Decided 2026-10-21 (§5N.15):** production refuses to boot when a feature is *partly* configured (names the missing variables); a feature with nothing configured is off and listed at boot; a short `APP_ENCRYPTION_KEY` is fatal; `EMAIL_FROM` keeps its default | `apps/api/src/config/config-check.ts` |
| Reset link in **development** logs (CF-023 / AU-10, §5D.7 #1) | Open decision; behaviour unchanged | Choose (A) keep, (B) remove, or (C) explicit opt-in |
| Other e-mail fallbacks log PII outside development (§5D.7 #3) | Open; not reset tokens | Approve gating them like the reset fallback (Phase 6 L1) |
| CF-023 (escaping + recipient R1 + AU-10) | **Closed at code level by owner decision** (§5F.9); **not cleared for release** | The rendered dialog test (§7 G-E); the real-DB send and RT6-M passed locally (§5M) |
| **CF-023 pre-release verification**: a real-DB receipt send and the rendered recipient-dialog test | **Partly done (§5M):** the real-DB receipt send passed on disposable PostgreSQL; the rendered dialog test is not done | A web component test of the recipient dialog, before release |
| Role and claim staleness window (15-minute access token) | Owned by CF-024 / CF-118 (W9) | Moot until deactivation or re-roling exists |
| CF-023 per-tenant receipt send quota (HSEC-06 recommendation; not in §8.2) | Open | Decide whether it is required, and the limit |
| `NODE_ENV` missing → treated as development, so reset links print again (§5D.7 #2) | Open; **assigned to CF-047** | Fail-fast production config decision (CF-047) |
| CF-023 `super_admin` recipient override | To verify | Confirm a non-owner cannot obtain the `super_admin` slug (PATCH or DELETE of system roles; JWT claim source). Stop if they can |
| CF-032 alert delivery | Blocked | A Sentry project or DSN and a named recipient |
| CF-033 production `TRUST_PROXY` value | Blocked; the setting itself exists (§5K.1, default off) | The new host's proxy topology (PV-01), then set `TRUST_PROXY` |
| CF-041 ETA `submitDocuments` timeout | Blocked | The CF-058 outcome / dedupe model (W11) |
| CF-048 real Docker build-context check | Not run. Docker was started in session 4 only for the approved PostgreSQL / Redis checks; this build-context check is outside that approval. The original documented command was **withdrawn as unsafe** (§5A.6 D1–D4) | The user runs the **replacement** script in §5A.3 when Docker is up |
| `apps/web/.env.production` is tracked (public `VITE_BASE_DOMAIN`) | Reported; tracking unchanged | Owner decision only if that value should ever become non-public (it is baked into the public bundle anyway) |
| Subdirectory `.env.production` files other than the root (e.g. `apps/api/`) | **Reviewed (§5A.6 Q1): no protection needed.** Nothing loads them; rules stay root-anchored | Re-evaluate only if a subdirectory starts loading `.env.production` |
| `/internal/check-tenant` reachable publicly via the apex (CF-035 residual §5B.8 #1) | Open; needs a `Caddyfile` or proxy decision | Restrict `/internal/*` at the proxy when the new host is set up |
| No reserved-subdomain list at registration (§5B.8 #2) | Open; separate defect | Owner decision on the reserved names, then a small registration validation change |
| CF-091 / CF-092 claim-before-send, plus the DB-backed RT-C3 / RT-HSEC05 (CF-022 bundle) | **Fixed at code level (§5M):** migration 018 `reminder_claims`; RT-C3 / RT-HSEC05 passed on disposable PostgreSQL and Redis | Merge; migration 018 runs with the normal tenant migrations; CF-022's next-day recovery check |
| `withLock` overlap after TTL expiry (no renewal; CF-022-FU1 residual §5H.6 #1) | Open; release is now owner-safe | Renewal (CF-040 / T-26, W6); CF-091's claim (§5M) now stops duplicate reminders if runs overlap; run-length bounds via CF-041 / CF-042 |
| CF-022-FU1 real-Redis check (Lua compare-and-delete, expiry overlap) | **Passed on a disposable Redis 7 (§5M)** | Confirm the production Redis allows `EVAL` |
| "never run concurrently" comments (route, job, job test) overstated | Open; comment-only | Approve a comment correction |
| CF-135: was GA ever compiled into a deployed bundle? (§5I.6 #1) | Open; **PV-03** | Inspect a deployed or production build artifact for a `G-…` id (read-only), when one is available |
| CF-135 / L6-02: Paymob redirect parameters in GA page views (§5I.6 #4, §5I.7 C) | **Fixed at code level (jsdom), §5I.8:** A (landing clean-up) plus B (page-view allowlist) | Real-browser check against an actual Paymob test-mode return, when approved |
| CF-135: the allowlist drops `utm_*` (§5I.8 F4) | Open; owner decision | Add validated `utm_*` to the page-view allowlist only if campaign tagging is used |
| **CF-085-FU1: under `v7_startTransition` (production), `GuestGuard` sent every fresh login to `/pos`** (§5I.8 D) | **CLOSED at code level (§5.10):** fix (§5.8) plus production-router and persisted-session tests | Real-browser verification (open validation item) |
| Stale comment in the CF-135 test `billing-return-login.test.tsx` (says `GuestGuard` "currently wins") | Open; comment-only (§5.8 remaining #1) | Approve a CF-135 test edit to update the comment and assert the destination |
| CF-135: reset page after a reload shows "invalid or expired" (§5I.7 B) | **Done (§5I.8):** recovery guidance plus links to `/forgot-password` and `/login`; the token is still in memory only | — |
| CF-135: service-worker cache key and browser history keep `?token=` locally (§5I.6 #3) | Open; local only | Decide whether the service worker should skip caching `/reset-password` navigations |
| CF-022 per-store rate limit (HSEC-05 recommendation; not in §8.2) | Open, not added | Decide whether it is required, and the limit |
| CF-044 stop grace | **Done in the repository 2026-10-21:** `stop_grace_period: 35s` on the app (drain budget 25 s); the "no deploys during 06:00–09:30" rule stays an operator rule | `docker-compose.prod.yml` |
| CF-025 POS error state | Deferred | The user's pending `POS.tsx` edits |
| CF-025 DB-backed "cashier completes a cash sale (201)" | **Passed locally (§5M)** | — |
| Designed `payment_methods:read` permission (accountant "sees fees") | W3 | The permission catalogue plus a role-data migration (needs a restore drill first, D-3) |
| Post-login redirect drops `?query` (CF-085 review, R3) | **Resolved by CF-085-FU1** (§5) | — |
| Logged-in user opening a reset link is sent to `/pos` and the token is dropped (`GuestGuard` on `/reset-password`; CF-085 review, R4) | **Open, deliberately unchanged** (per instruction) | A separate decision and task |
| Bare-domain login (`#s=` session hand-off) ignores the saved destination | Open observation (pre-existing; out of FU1 scope) | Only relevant when logging in on the apex; tenant e-mail links open on the tenant host |
| RT7-04 (Playwright) | Not added | The API-level equivalent passed (§5M); a browser run is still open |
| Phase 10 W1 test list includes "R-09 subset" | Roadmap discrepancy | R-09 is compression (CF-138, W8). Not added in W1 |
| CF-063 coupon-minimum base (§5L.3) | Implemented with the POS's base (Σ unit price × qty, before product discounts, coupon and tax) | Owner: confirm, or name another base (e.g. after product discounts, or incl. tax) |
| CF-106 invoicing states (§5L.5) | Only `cancelled` is refused | Owner: allow invoicing only from `ready` / `delivered`, as DB-36 recommends? |
| CF-079 import limits (§5K.1) | 2 MiB and 1,000 rows per CSV | Owner: confirm the limits |
| W5b database backstops (§5L.2) | Code-level guards; race tests RT-A* passed on disposable PostgreSQL (§5M) | Schedule T-01/T-02 cleanup and the T-03 restore drill before any CHECK / UNIQUE constraint |
| `CHECK (credit_balance >= 0)` (CF-011 backstop) vs tenant migration 016 | **Decided 2026-10-21: store credit cannot be negative** (migration 026; a customer's debt lives in installments, never in store credit; the code never allowed it) | Migration 016's comment allowed negatives. A store that already has a negative balance keeps the CHECK NOT VALID (still enforced for new writes) until cleaned up (`scripts/db/constraint-report.sql`). To allow customer debt in store credit instead, drop `chk_customer_credit_nonneg` |
| Early settlement (CF-067), 2026-10-21 | The full remaining scheduled amount, no interest rebate; installments are paid whole only (Phase 3 invariant), so there is no partial payment of one installment | `installment.service.ts` (`settleContract`); an interest rebate needs an owner rule |
| ETA cancellation (CF-058), 2026-10-21 | Never automatic: an `eta:manage` user clicks, gives a reason, one request is sent; failures return to `cancel_required` | `eta.cancel.ts`; production ETA still needs PV-16 |
| Process roles (CF-162), 2026-10-21 | Default `all` (today's single container); `api` + `worker` split is opt-in via the compose profile `split` | `PROCESS_ROLE`, `docker-compose.prod.yml` |
| Connection pooling (CF-052), 2026-10-21 | Transaction-mode pooling is refused at boot until every raw query is schema-qualified | `config-check.ts` (`poolerModeProblem`) |
| Redis memory policy (CF-046), 2026-10-21 | `noeviction` — a full Redis fails writes loudly instead of evicting queue keys; AOF every second | `docker-compose.prod.yml`; switch-over procedure in the runbook |
| Backup retention (CF-031), 2026-10-21 | Keep the newest 14 dumps locally (`BACKUP_KEEP`); an off-host copy is required, its storage and custody are the owner's | `scripts/db/backup.sh` |
| POS stock shown (2026-10-22) | The cashier's own branch; users without a branch see the store total | `product.routes.ts` (`/search`, `/barcode/:code`) |
| Split-payment fees (2026-10-22) | Each method's fee is on its own share, at its own rate; one fee bearer per sale (the invoice's), so the invoice fee fields and the ETA fee line stay one figure; a split may not exceed goods less credit and points | `invoice.service.ts` (`prepareSale`) |
| P&L VAT (2026-10-22) | `taxCollected` stays gross; `taxReversed`/`taxNet` added; VAT shown apart from profit on the Reports page | `report.service.ts` (`getProfitLoss`), `Reports.tsx` |
| Return-row backfill (2026-10-22) | Not needed: migration 020 never reached production; pre-020 rows use the legacy fallback | — |
| Coupon and VAT (CF-146, 2026-10-22) | A per-store setting, default after VAT (unchanged); each invoice records its mode, and returns and the ETA document follow the invoice | Settings → store data «خصم الكوبون»; `invoice.service.ts` (`priceSale`) |

---

## 7. Release-gate plan (2026-10-14; documentation only, no gate has been passed)

**Scope.**
- This plan restates prerequisites from the canonical sources: Phase 10 §4.5–§4.7, §6.4, §7 and §8; Phase 11 §9.2–§9.3.
- **Nothing here was executed.** No production, host, database, Redis or provider was accessed. No test, type-check or build was rerun for this entry.
- **All 26 release blockers remain uncleared.**

### 7.1 Gates

| Gate | What must be verified | Source | Who authorises or performs | What stays blocked until it is answered |
|---|---|---|---|---|
| **G-A: Host identity (W0-01)** | The SSH host keys at the production IP, matched out-of-band (the C-0 record: date and person); the hPanel reinstall and activity history; the stack state | Phase 11 §1 (line 17), §9.2 G-1; W0-01 (§3.5) | Owner, or an authorised operator. Not this audit | **Any production access.** 12 of the 15 BLOCKED PV checks (Phase 11 line 104), and therefore G-B, G-C and the host- or database-side containment steps (CT-1, CT-2, CT-4, CT-5, and the host part of CT-6). CT-3, CT-7 and CT-8 are procedural, tenant-side or communication actions and do not need the host |
| **G-B: Automated billing (PV-10)** | Whether renewal or dunning charge real cards: Phase 11 §8 step 6 plus the Paymob comparison, classified with Phase 11 §5.3. If billing is live or armed, a recorded C-3 decision and the C-4 window freeze | Phase 10 §4.5 (RB\* condition), §4.6 CT-1 / CT-2; Phase 11 PV-10 (line 119), §1 point 3, §9.2 G-4 | Operator, read-only (CT-1). **The owner decides** CT-2 / C-3 | **CF-006 … CF-010 stay conditional (RB\*).** Automated billing must **not** be assumed disabled: the workers start with the app process (Phase 11 §1 point 3). Also blocked: the start of W6 (its prerequisites include PV-10) |
| **G-C: Backups and restore (PV-04, CF-031, T-03)** | A fresh backup, an isolated restore with matching per-schema counts, and a recorded RPO / RTO | Phase 10 §4.6 CT-4, §4.7 (CF-031), §6.4 (backfill and constraint rows), W4 / W5 prerequisites; Phase 11 PV-04 (line 113), §9.2 G-3 | Operator; data custody for dumps decided by the owner (Phase 11 §9.3) | **CF-031** (blocked). Any production backfill or data migration: W4's fee data migration, W5's allocations and constraint validation, which affect **CF-003, CF-004, CF-011 … CF-016** |
| **G-D: Owner decisions (T-05, PV-21)** | Recorded owner decisions. **None is made here** | Phase 10 T-05 (line 587), W3–W6 prerequisites; Phase 11 PV-21 (line 130), §9.3 | Owner; a tax advisor where noted | The W3 role migration and branch authorisation (CF-005, CF-020, CF-021); W4 price-override policy (CF-001); W5 refund cap and installment cancellation (CF-003, CF-004, CF-012); W6 payment on a `CANCELLED` subscription and trial grace (CF-007, CF-010); CF-047 enforcement |
| **G-E: Outstanding acceptance tests** | The checks in §7.3 | Phase 10 §8.2 (P0 / P1 rows), §8.3, §4.6 / §4.7; this report §1.1 | Engineering, in disposable or staging environments. **Docker or any staging access needs explicit approval first** | §8 acceptance, and therefore release clearance, for **CF-022, CF-023, CF-025** (release blockers) and CF-035, CF-040, CF-048, CF-135 |
| **G-F: Remaining W1 work** | The open W1 findings in §7.4, each implemented only after its own approval | Phase 10 §7 W1 (lines 749–761), registry W1 rows | Owner approves each task; engineering implements | **W1 exit:** this includes "an alert proven to reach a person" (Phase 10 W1 tests; Phase 11 §9.2 note). Also blocked: W6's prerequisite "W1 observability", and the release of **CF-026** (release blocker) |
| **G-G: Integration and merge** | Review of the uncommitted worktree; split into reviewable units (Phase 10 W1 "one change per PR"); CI; **explicit owner approval** to stage and commit (W1 plan safeguard 9). Deployment additionally needs Phase 11 §9.2 **G-1 … G-7** | Phase 10 §7 W1 (risk, rollout); Phase 11 §9.1 ("May any W1 change be deployed? No") and §9.2 | Owner (approval); reviewer; operator for any deployment | **Every "merged" or "operationally verified" status.** All W1 fixes sit uncommitted on `claude/w1-safety-net` @ `7317c97`; nothing is merged or deployed |

### 7.2 Release-blocker register (Phase 10 §4.5)

**26 blockers, 0 cleared.**

| Blockers | Remediation status | Release status |
|---|---|---|
| **RB**: CF-001, 002, 003, 004, 005, 016, 017, 019, 020, 024, 027 | Open | Uncleared |
| **RB**: CF-011, 012, 013, 014, 015 | Fixed at code level; uncommitted (§5L.2) | **Uncleared.** RT-A1 … RT-A5 passed on disposable PostgreSQL (§5M, 20 trials each); CHECK / UNIQUE backstops (DDL) not added; not merged |
| **RB**: CF-021 | Partially fixed (§5K.2): the portal response no longer returns the card token or raw provider payloads | Uncleared: billing permissions on cancel / resume / portal (W3) not done; §8.2 criterion (line 953) not met |
| **RB**: CF-026 | Fixed at code level; uncommitted (§5J) | **Uncleared:** real-browser printing and the visual A4 check not done (RT7-03 done, §5M); not merged |
| **RB**: CF-022, CF-025 | Partially fixed (§1.1) | Uncleared: CF-022's next-day recovery criterion and CF-025's POS error state are not met; RT-C3, RT-HSEC05 and RT7-04 passed locally (§5M) |
| **RB**: CF-023 | Closed at code level by owner decision | **Uncleared:** §8.2 recovery criterion and RT6-M passed only locally (§5M); the rendered dialog test is not done; not merged |
| **RB\***: CF-006, 007, 008, 009, 010 | Open | **Uncleared and conditional:** blockers if automated billing is live. PV-10 is unanswered (G-B), and until then billing must stay disabled or be contained (Phase 10 §4.5) |

### 7.3 Outstanding acceptance checks (G-E)

Session 4 (2026-10-15, §5M) ran the disposable PostgreSQL / Redis checks; the parts marked **done locally** passed there. Nothing was run against staging or production, and nothing here clears a release blocker.

| CF | Outstanding check | Environment needed |
|---|---|---|
| CF-026 | **RT7-03 done locally (§5M).** Open: real-browser popup and bulk-print behaviour; visual A4 layout | A browser on a local or staging build |
| CF-022 | **Done:** RT-C3 / RT-HSEC05 (§5M); real BullMQ worker run and next-day recovery (§5N.16) | — |
| CF-023 | **Real-DB receipt send and RT6-M done locally (§5M).** Open: the rendered recipient-dialog test | Web component test |
| CF-025 | **RT7-04 done locally (§5M).** Open: the POS error state when a prerequisite query fails | `POS.tsx` (user edits pending) |
| CF-035 | §8.2 recovery: "a new tenant's certificate is issued"; PV-01 and PV-14 (§4.7); `/internal/*` restricted at the proxy | Staging Caddy with a staging CA; production facts through G-A |
| CF-040 | **Compare-and-delete against a real Redis done locally (§5M).** Open: lock renewal and the other T-26 parts (W6) | W6 implementation |
| CF-048 | The host-side CT-6 check (`.env.production` untracked and never committed **on the host**); a real Docker build-context check (the replacement script in §5A) | Production host through G-A; a local Docker build (outside the session-4 approval) |
| CF-135 | A real-browser check of the reset and Paymob-return flows with a dummy measurement id (no live GA); PV-03 (was GA compiled into a deployed bundle?); a decision on the service-worker cache key | A browser on a local or staging build; deployed-bundle facts through G-A |
| CF-043 | **Done locally (§5M):** `/readyz` 503 with PostgreSQL or Redis paused, `/livez` 200, 200 again after recovery. Open: a week of observation before gating deploys | Staging or production observation |
| CF-042 | **RT6-M done locally (§5M).** Open: PV-17 | Phase 11 PV-17 |
| CF-079, CF-113 | **Done locally (§5M):** product and customer CSV import on a real tenant schema; the statement export on a real schema (it found and fixed a `uuid = text` defect) | — |
| CF-157 | `/settings` at 375 × 812 on the worktree build: `scrollWidth === innerWidth` (baseline 431 px recorded in §5K.2) | A browser on a local build |
| CF-011 … CF-015, CF-070 … CF-075, CF-101 | **Done locally (§5M):** RT-A1 … RT-A5, the other W5b race tests and the W2 harness (20 trials, 0–20 ms stagger). Open: CHECK / UNIQUE constraints after T-01/T-02 cleanup and the T-03 restore drill (and the migration 016 conflict, §6) | Production cleanup first |
| CF-036, CF-063, CF-068, CF-064 | **Done locally (§5M):** a real-DB sale for each guard (loyalty redemption, coupon minimum, deactivated product, split validation) | — |
| CF-083 | A real 402 (suspended tenant) in a browser: the notice for staff, the billing tab for the owner | A browser on a local build with a suspended test tenant |

### 7.4 Remaining W1 work (G-F; status updated 2026-10-15, §5K)

| CF | Registry: sev · release | Status | Dependency or blocker |
|---|---|---|---|
| **CF-026** | P1 · **RB** | Fixed at code level; uncommitted (§5J) | Acceptance checks in §7.3; review and merge approval |
| CF-032 | P1 · PR | Open | Alert delivery needs a Sentry project or DSN and a named recipient |
| CF-033 | P1 · PR | Partially fixed (configuration; §5K.1) | Production value needs PV-01 (Phase 11 G-5) |
| CF-041 | P2 · POST | Partially fixed (Resend and idempotent ETA calls; §5K.3) | See §1.2 (ETA submit blocked by CF-058; Paymob part W6) |
| CF-042 | P2 · PR | Fixed at code level (§5K.1, §5K.3) | PV-17 (RT6-M passed locally, §5M) |
| CF-043 | P2 · PR | Fixed at code level, report-only (§5K.3) | Observe before gating (readiness 503 verified locally, §5M) |
| CF-044 | P2 · CT | Fixed in the repository (§5N.15) | Deploy the compose change on the new host |
| CF-047 | P2 · PR | Fixed at code level (§5N.15) | Set every variable of each feature that is used, or none of them |
| CF-050 | P2 · PR | Partially fixed (W1 label; §5K.3) | Streaming is W7 |
| CF-091, CF-092 | P3 · POST | Fixed at code level (§5M) | Merge |
| CF-093 | P3 · POST | Fixed at code level (§5K.3) | Merge |

---

## 8. Full registry status (167 canonical findings; reconciled 2026-10-19, sessions 5–6; updated 2026-10-21, §5N.15–§5N.16)

Generated from the Phase 10 §3.2 registry (IDs, severity, release class, wave and title are copied from it) and the status recorded in this report. Status words as in §1.1; "Not started" lists the exact blocker or prerequisite. Titles longer than 78 characters are shortened (…); the registry is authoritative.

| Status | Count |
|---|---|
| Fixed at code level (uncommitted) | 142 |
| Partially fixed (uncommitted) | 11 |
| Not started | 8 |
| Blocked | 2 |
| Deferred | 1 |
| No action required | 3 |
| **Total** | **167** |

| CF | Sev · release · wave | Title (registry) | Status | Outstanding / blocker |
|---|---|---|---|---|
| CF-001 | P0 · RB · W4 | Server accepts client-supplied sale and installment line prices | Fixed at code level | Server catalogue price; client unitPrice ignored (§5N.2); no override path (owner, §6) |
| CF-002 | P0 · RB · W4 | POS and installment screens show and collect amounts that differ from the r… | Fixed at code level | POST /invoices/quote + /installments/quote (one priceSale / priceContract); POS, installment form and receipt show the server figures (§5N.13) |
| CF-003 | P0 · RB · W5 | Refunds mis-computed: line discount subtracted twice, order-level discounts… | Fixed at code level | Refund = paid share (computeReturnRefund, §5N.2); real-DB w4-w5 passed |
| CF-004 | P0 · RB · W5 | Pending installment invoices can be cancelled or returned; approval revives… | Fixed at code level | Installment invoices cancelled/returned only via contract (§5N.2) |
| CF-005 | P0 · RB · W3 | Tenant settings, VAT, loyalty values, ETA credentials and branches writable… | Fixed at code level | settings:update on every write; GET subset without settings:read (§5N.1) |
| CF-006 | P0* · RB*,CT · W6 | Renewal/dunning charge the card again when the outcome is ambiguous or the… | Fixed at code level | Payment intents + UNKNOWN never re-charged (§5N.3); live Paymob behaviour PV-10 |
| CF-007 | P0* · RB*,CT · W6 | Billing jobs act on stale state: dunning charges paid or cancel-scheduled p… | Fixed at code level | Conditional lifecycle sweep (§5N.3) |
| CF-008 | P1 · RB* · W6 | Subscription payment applied without verifying amount, currency or capture;… | Fixed at code level | Amount/currency/capture verified before applying (§5N.3) |
| CF-009 | P1 · RB* · W6 | Webhook binds tenant and card token from unsigned fields (signed transactio… | Fixed at code level | Tenant/card bound from the signed intent; token only from signed TOKEN callback (§5N.3) |
| CF-010 | P1 · RB* · W6 | Subscription expiry depends on charging a card: unpaid trials and cardless… | Fixed at code level | One lifecycle rule with or without a card (§5N.3) |
| CF-011 | P1 · RB · W5 | Store credit spendable twice; a negative balance then becomes a negative di… | Fixed at code level | RT-A1 passed locally (§5M); CHECK (credit_balance ≥ 0) is DDL (T-01/T-02 + T-03) and conflicts with migration 016 (§6) |
| CF-012 | P1 · RB · W5 | Installment approve/reject are unconditional: duplicate schedules, double s… | Fixed at code level | RT-A2 passed locally (§5M); UNIQUE (contract_id, installment_number) is DDL |
| CF-013 | P1 · RB · W5 | Double cancel applies every reversal twice | Fixed at code level | RT-A3 passed locally (§5M); merge |
| CF-014 | P1 · RB · W5 | Concurrent returns, or return plus cancel, over-refund and over-restock | Fixed at code level | RT-A4 passed locally (§5M); returned / partially_returned status not recorded (reports depend on status) |
| CF-015 | P1 · RB · W5 | Purchase order received twice: received above ordered, supplier liability d… | Fixed at code level | RT-A5 passed locally (§5M); CHECK (received ≤ ordered) is DDL |
| CF-016 | P1 · RB · W5 | No idempotency on sales and other creates: retries, double submit, multi-ta… | Fixed at code level | Server operation keys + POS sends one Idempotency-Key per checkout attempt, reused on retry (§5N.13) |
| CF-017 | P1 · RB · W4 | Payment-fee vocabulary mismatch: seeded percentage fees compute as zero whi… | Fixed at code level | Seed writes percentage; tenant migration 023 normalises existing rows; client fee calculation removed (§5N.13) |
| CF-018 | P1 · PR · W7 | Profit & loss misstates profit (tax as revenue, work orders counted twice,… | Fixed at code level | P&L in SQL from recorded effects, one snapshot (§5N.4); real-DB w7 passed |
| CF-019 | P1 · RB · W7 | Day close and end-of-day totals do not match money received | Fixed at code level | Ledger-based day close (migration 020, §5N.4); real-DB w7 passed |
| CF-020 | P1 · RB · W3 | Coupon and customer-credit authority granted by broad permissions held by c… | Fixed at code level | Coupon permission alternatives (§5N.1) |
| CF-021 | P1 · RB · W3 | Billing status, portal, cancel and resume open to any employee; portal retu… | Fixed at code level | Credit adjust needs a financial permission (§5N.1) |
| CF-022 | P1 · RB,CT · W1 | A tenant route runs the all-tenant reminder cycle outside the job lock | Fixed at code level | Scoping + lock (§5G/§5H), RT-C3/RT-HSEC05 (§5M); real BullMQ worker run and next-day recovery verified (§5N.16); per-store rate limit is a separate open decision |
| CF-023 | P1 · RB · W1 | Emails interpolate unescaped tenant data; receipt email accepts any recipient | Fixed at code level | Rendered recipient dialog (real-DB send and RT6-M passed locally, §5M) |
| CF-024 | P1 · RB · W9 | Users cannot be deactivated or re-roled, and their sessions cannot be revoked | Fixed at code level | PATCH /users/:id deactivation/re-role revokes sessions (§5N.5) |
| CF-025 | P1 · RB · W1 | The seeded cashier role cannot complete any sale (payment methods require s… | Fixed at code level | Cashier permissions (§5C) + POS payment-method error state with retry (§5N.13) |
| CF-026 | P1 · RB · W1 | Invoice details, return dialog and A4 tax invoice read fields the API never… | Fixed at code level | Browser printing; visual A4 (RT7-03 done, §5M) |
| CF-027 | P1 · RB · W5 | Return dialog confirms without showing the refund amount; returned lines ca… | Fixed at code level | Return quote endpoint + dialog (§5N.2) |
| CF-028 | P1 · PR · W8 | A Redis outage hangs every tenant request; boot blocks without Redis | Fixed at code level | Redis command timeouts, cache-miss fallback, BullMQ client split (§5N.4) |
| CF-029 | P1 · PR · W8 | PostgreSQL connection budget exceeded and never reclaimed; new and evicted… | Fixed at code level | Connection budget + retired clients (§5N.4); production numbers PV-06/07 |
| CF-030 | P1 · PR · W7 | Reports and exports build whole datasets in the shared API process (multi-s… | Fixed at code level | Reports grouped/paged in SQL; streamed export (§5N.4) |
| CF-031 | P1 · PR,CT · W0 | No backup, restore or disaster-recovery mechanism; never tested | Fixed at code level | Backup (same-snapshot counts, checksum, retention) and isolated restore-check scripts, tested on a temporary server (§5N.15); production run waits for G-3 and an off-host store |
| CF-032 | P1 · PR · W1 | No monitoring, alerting or error tracking | Partially fixed (§5N.30: code wired, off until DSN) | Sentry DSN, a named recipient and an uptime monitor (owner) |
| CF-033 | P1 · PR · W1 | Rate limits and audit IPs keyed to the proxy address (no trustProxy) | Partially fixed | Production value needs PV-01 |
| CF-034 | P1 · PR · W10 | Unauthenticated, unthrottled tenant signup (each call creates a schema) | Fixed at code level | Per-IP + platform signup bounds, reserved names (§5N.6); email verification/CAPTCHA = product addition |
| CF-035 | P1 · PR · W1 | TLS-issuance ask endpoint approves any subdomain | Fixed at code level | Certificate issuance; PV-01/PV-14; /internal/* at the proxy |
| CF-036 | P2 · POST · W4 | Loyalty redemption arithmetic: discount not reduced to the floored points;… | Fixed at code level | Settings bounds and the cancel reversal belong to CF-005 / CF-066 |
| CF-037 | P2 · FG · W6 | Pending token charges treated as declines; recurring integration id and bil… | Fixed at code level | Lifecycle sweep (§5N.3) |
| CF-038 | P2 · FG · W6 | Provider refunds and voids ignored; FAILED-then-SUCCESS for one transaction… | Fixed at code level | Payment intents (§5N.3) |
| CF-039 | P2 · FG · W6 | No payment reconciliation; billing job records deleted | Fixed at code level | Payment intents (§5N.3) |
| CF-040 | P2 · FG · W6 | Redis lock used as a progress record: an orphaned lock turns crash recovery… | Fixed at code level | Lock renewal (RENEW script) + owner-safe release (§5N.3) |
| CF-041 | P2 · POST · W1 | Outbound HTTP calls (Paymob, ETA, Resend) have no timeouts (~300 s hangs) | Fixed at code level | Paymob and ETA submit bounded; ambiguous outcomes never retried (§5N.3, §5N.7) |
| CF-042 | P2 · PR · W1 | Resend failures are silent; dedupe rows and counters written for undelivere… | Fixed at code level | PV-17 (RT6-M passed locally, §5M) |
| CF-043 | P2 · PR · W1 | /health reports ok with PostgreSQL or Redis down or tenant migrations faile… | Fixed at code level | A week of observation (readiness 503 verified locally, §5M) |
| CF-044 | P2 · CT · W1 | Platform kills the app before its 25 s graceful shutdown completes | Fixed at code level | `stop_grace_period: 35s` in `docker-compose.prod.yml` (§5N.15); nothing deployed |
| CF-045 | P2 · POST · W10 | Release model: no immutable artifact or rollback; migrations and plan seed… | Partially fixed | CI image build+boot smoke, create-only plan seed, /readyz deploy check, runbook (§5N.6); registry/tag deploy = platform |
| CF-046 | P2 · POST · W10 | Redis is a single RDB-only store for sessions, queues, schedules and locks;… | Fixed at code level | Redis AOF everysec + noeviction in compose; safe switch-over in the runbook (§5N.15); nothing deployed |
| CF-047 | P2 · PR · W1 | Production boots without critical integration configuration | Fixed at code level | Production fail-fast on partly configured features; decision in §6.0 (§5N.15) |
| CF-048 | P2 · CT · W1 | Production secrets file is not git-ignored or docker-ignored | Fixed at code level | Host CT-6; real Docker context |
| CF-049 | P2 · POST · W8 | Invoice list aggregates every invoice item and sorts the whole table on eac… | Fixed at code level | Page-only item counts; list indexes (migration 021, §5N.4) |
| CF-050 | P2 · PR · W1 | Sales report and its Excel export silently contain only the latest 500 invo… | Fixed at code level | Streamed Excel export of every row (§5N.4) |
| CF-051 | P2 · POST · W8 | Password hashing runs on the event loop; concurrent logins stall every tenant | Fixed at code level | bcrypt in a worker-thread pool (§5N.4) |
| CF-052 | P2 · FG · W8 | Transaction-mode pooling would run unqualified raw SQL in another tenant's… | Fixed at code level | Transaction-mode pooler refused at boot (§5N.15); raw SQL still relies on the per-connection schema |
| CF-053 | P2 · POST · W10 | Tenant migration version bumped outside the DDL transaction; three files ca… | Fixed at code level | schema_version updated inside the file transaction (§5N.6); real-DB w10 passed |
| CF-054 | P2 · POST · W10 | A crash mid-provisioning leaves an orphan tenant that blocks re-registration | Fixed at code level | Stale PROVISIONING reclaimed (schema renamed, never dropped); activate+trial one tx (§5N.6); real-DB w10 passed |
| CF-055 | P2 · FG · W11 | ETA raw SQL references columns no migration creates | Fixed at code level | ETA pipeline on Prisma (§5N.7); real-DB w11 passed |
| CF-056 | P2 · FG · W11 | ETA raw SQL compares uuid columns with text parameters; the only entry rout… | Fixed at code level | No uncast raw SQL in ETA (§5N.7); real-DB w11 passed |
| CF-057 | P2 · FG · W11 | ETA document does not represent the sale | Partially fixed | Document from stored lines (§5N.7); credit notes for returns (§5N.31); real CAdES-BES signer, ETA JSON-schema validation, PV-16 preprod |
| CF-058 | P2 · FG · W11 | ETA outcomes misclassified; no per-invoice dedupe, state re-check or status… | Fixed at code level | Claim + outcome model + poll (§5N.7); manual ETA cancellation of `cancel_required` invoices (§5N.15); not exercised against ETA preprod (PV-16) |
| CF-059 | P2 · FG · W11 | ETA submissions are never enqueued automatically | Partially fixed | Outbox + auto-enqueue built, OFF unless ETA_AUTO_SUBMIT=true (D-18: after PV-16) |
| CF-060 | P2 · POST · W5 | Cancel does not reverse fee expense, external financing or ETA | Fixed at code level | Fee reversed; financing and ETA flagged for follow-up (§5N.8); real-DB w12 passed |
| CF-061 | P2 · POST · W4 | Product discounts unbounded; line subtotal not clamped | Fixed at code level | Merge with CF-062 |
| CF-062 | P2 · POST · W4 | Product discounts cannot be created from the UI (date string → 500) | Fixed at code level | UI "adding a discount lists it" test |
| CF-063 | P2 · POST · W4 | Coupon minimum enforced only in the browser | Fixed at code level | Base = Σ unit price × qty (the POS rule); owner may confirm a different base |
| CF-064 | P2 · POST · W5 | Split payments stored unvalidated and mis-reported | Fixed at code level | Allocation rows with per-allocation fees (migration 020) |
| CF-065 | P2 · POST · W5 | Customer credit and loyalty ledger lives in JSON audit rows (irreconcilable… | Fixed at code level | `customer_ledger` (migration 027) written with every change; reconciliation in the API and the drawer (§5N.15) |
| CF-066 | P2 · POST · W5 | Cancelling a sale after its earned points were spent drives loyalty negative | Fixed at code level | Loyalty never negative; shortfall recorded (§5N.2) |
| CF-067 | P2 · POST · W5 | Installment model gaps: no overdue or settlement states; invoice paid amoun… | Fixed at code level | Overdue, paid amount, row lock (§5N.8); early settlement + remaining amount / next due date (§5N.15) |
| CF-068 | P2 · POST · W4 | Deactivated products remain sellable via the API | Fixed at code level | Merge |
| CF-069 | P2 · POST · W7 | Historical values move (names, tax rate, pre-017 cost read live) | Fixed at code level | Product name stored on each line at sale; ETA uses the sale-time rate (§5N.7, §5N.14); pre-017 cost cannot be recovered (never recorded) |
| CF-070 | P2 · POST · W5 | Stock transfer approved twice moves stock twice | Fixed at code level | Race test passed locally (§5M); merge |
| CF-071 | P2 · POST · W5 | Concurrent receipts compute weighted-average cost from stale data | Fixed at code level | Race test passed locally (§5M); merge |
| CF-072 | P2 · POST · W5 | One work order can produce two invoices | Fixed at code level | Race test passed locally (§5M); merge |
| CF-073 | P2 · POST · W5 | Work-order payments lose updates and have no upper bound | Fixed at code level | Race test passed locally (§5M); merge |
| CF-074 | P2 · POST · W5 | Manual credit adjustment overwrites concurrent balance changes | Fixed at code level | Race test passed locally (§5M); merge |
| CF-075 | P2 · POST · W5 | Concurrent PO payments overpay the order | Fixed at code level | Race test passed locally (§5M); CHECK (paid ≤ total) is DDL |
| CF-076 | P2 · POST · W5 | Multi-line sales deadlock (locks in client order, no retry) | Fixed at code level | Bounded deadlock/serialization retry on sale/return/cancel (§5N.8) |
| CF-077 | P2 · POST · W6 | Admin plan change updates the tenant plan only, not the subscription | Fixed at code level | Admin plan change updates the subscription (§5N.3) |
| CF-078 | P2 · POST · W6 | Two suspension mechanisms; reminders still sent for cancelled or suspended… | Fixed at code level | Reminders skip suspended/cancelled stores (§5N.3) |
| CF-079 | P2 · POST · W12 | Imports unreachable (multipart parser not registered → 415) | Fixed at code level | Owner to confirm limits (real-schema import passed, §5M) |
| CF-080 | P2 · FG · W12 | Offline mode blocked by paused mutations; the queue replays under the next… | Fixed at code level | Offline selling declared unsupported (checkout disabled offline, cart kept); legacy queue sent explicitly with stable keys; cleared on logout/switch (§5N.13) |
| CF-081 | P2 · POST · W12 | Financial summaries stale after sales and returns (no mutation-driven inval… | Fixed at code level | Sale invalidates every sales summary; EOD dated keys, staleTime 0, "as of" + refresh (§5N.13) |
| CF-082 | P2 · POST · W12 | No business time zone: UTC 'today' in the UI, UTC date in invoice numbers,… | Fixed at code level | Store time zone everywhere incl. POS (§5N.8, §5N.13) |
| CF-083 | P2 · POST · W6 | Subscription states misrepresented: HTTP 402 unhandled; 'renews in 0 days'… | Fixed at code level | Period-ended-unpaid banner state (§5N.3) |
| CF-084 | P2 · PR · W12 | Printed tax invoice identifies the platform, not the store, and has no tax… | Fixed at code level | Store name, address, tax number on prints (§5N.8); legal requirement still to be confirmed |
| CF-085 | P2 · PR · W1 | Password-reset and checkout email links target routes that do not exist | Fixed at code level | E2E-EMAIL from a real e-mail |
| CF-086 | P3 · POST · W4 | Precision and presentation inconsistencies (JS-number paths, display roundi… | Fixed at code level | Server quote replaces client math (CF-002); remaining float money paths made decimal (credit cap, loyalty reversal, credit deduct, PO epsilon) (§5N.14) |
| CF-087 | P3 · POST · W6 | Decline and renewal counters conflated and set absolutely; thresholds hit v… | Fixed at code level | Lifecycle (§5N.3) |
| CF-088 | P3 · POST · W6 | Several subscriptions per tenant allowed; webhook findFirst unordered | Fixed at code level | Most recent subscription (§5N.3) |
| CF-089 | P3 · POST · W6 | Trial expiry has no per-row isolation and no retries | Fixed at code level | Per-row isolation (§5N.3) |
| CF-090 | P3 · POST · W6 | Webhook robustness: no type dispatch, malformed body → 500, hard-coded ifra… | Fixed at code level | Payment intents (§5N.3) |
| CF-091 | P3 · POST · W1 | Reminder dedupe is check-then-send (overlapping runs send twice) | Fixed at code level | Merge; migration 018 (additive) runs with tenant migrations |
| CF-092 | P3 · POST · W1 | Reminder sent for an installment paid during the cycle | Fixed at code level | Merge |
| CF-093 | P3 · POST · W1 | Job observability and retention insufficient for financial forensics | Fixed at code level | Merge |
| CF-094 | P3 · POST · W8 | Cron jobs and boot migrations walk every tenant serially through the reques… | Fixed at code level | Batch tenant clients (no LRU churn), paged reminder scan, (status, due_date) index (tenant 025) (§5N.14); per-tenant job fan-out not done |
| CF-095 | P3 · FG · W11 | ETA worker trusts schemaName from the job payload | Fixed at code level | Worker resolves the tenant from the master DB (§5N.7) |
| CF-096 | P3 · FG · W11 | New BullMQ Queue per ETA enqueue (heap and listener growth) | Fixed at code level | One ETA Queue per process (§5N.7) |
| CF-097 | P3 · FG · W11 | ETA configuration: environment dropped by settings PATCH, split environment… | Fixed at code level | Environment persisted, secrets validated, versioned ciphertext + key rotation (§5N.7) |
| CF-098 | P3 · POST · W8 | LRU eviction disconnects a tenant client mid-transaction | Fixed at code level | Evicted clients retired after a grace period (§5N.4) |
| CF-099 | P3 · POST · W8 | Default transaction limits, pool of 5, no database timeouts | Fixed at code level | Transaction limits, pool size, timeouts (§5N.4) |
| CF-100 | P3 · POST · W5 | approveContract uses the base client inside its transaction (two connection… | Fixed at code level | Merge |
| CF-101 | P3 · POST · W5 | The same installment row can be paid twice | Fixed at code level | Race test passed locally (§5M); merge |
| CF-102 | P3 · POST · W5 | CHECK constraints NOT VALID; no credit, loyalty, received or paid CHECKs | Fixed at code level | Migration 026: new CHECKs, guarded validation of all CHECKs; dirty stores keep NOT VALID + WARNING (§5N.15) |
| CF-103 | P3 · POST · W8 | Plan limits are count-then-create and counted on every create | Fixed at code level | Uncapped sentinel skips the count; capped checks held under a per-store lock until the response (R-11: 20 at cap−1 → 1) (§5N.14); unlocked if Redis is down |
| CF-104 | P3 · POST · W5 | Return restock with no stock row logs a movement that changed nothing | Fixed at code level | Merge |
| CF-105 | P3 · POST · W5 | Cancelling a work-order invoice never clears the work-order link | Fixed at code level | Invoice cancel releases the work order (§5N.8) |
| CF-106 | P3 · POST · W5 | A cancelled work order can still be invoiced | Fixed at code level | Invoice only from ready/delivered (delegated decision, §6) (§5N.8) |
| CF-107 | P3 · POST · W5 | Work-order invoices use settings VAT and SVC numbers, skip ETA and the invo… | Fixed at code level | Shared invoice sequence + ETA rule for service invoices; settings VAT kept for services (§5N.8) |
| CF-108 | P3 · POST · W8 | Tenant cache stale write-back after invalidation | Fixed at code level | Generation-checked tenant cache (§5N.4) |
| CF-109 | P3 · POST · W7 | Reports read several snapshots | Fixed at code level | Every report reads one REPEATABLE READ snapshot (§5N.14); the streamed Excel export is a separate read |
| CF-110 | P3 · POST · W10 | Migration sweep skips CANCELLED tenants; pending files computed before the… | Fixed at code level | CANCELLED migrated; pending read under the lock (§5N.6) |
| CF-111 | P3 · POST · W10 | Provisioning rollback leaves the Redis tenant cache and LRU client behind | Fixed at code level | Rollback forgets client + cache (§5N.6) |
| CF-112 | P3 · POST · W5 | installment_payments.payment_method_id exists in SQL but not in Prisma (nev… | Fixed at code level | payment_method_id in Prisma and written (§5N.2) |
| CF-113 | P3 · POST · W12 | Customer statement export queries a column that does not exist | Fixed at code level | Merge (real-schema run found and fixed uuid = text, §5M) |
| CF-114 | P3 · POST · W2 | Prisma tenant model differs from the SQL schema | Fixed at code level | Tenant model regenerated from a migrated schema (migrate diff empty; comments kept); opt-in drift test RT-D34 (§5N.14) |
| CF-115 | P3 · POST · W2 | tenant_settings singleton not enforced | Fixed at code level | Migration 026: singleton column + guarded unique index (§5N.15) |
| CF-116 | P3 · POST · W12 | Deletes that destroy history (coupons, admin audit cascade, pre-existing sc… | Fixed at code level | Admin delete deactivates; FK RESTRICT (master migration 20261019000000, §5N.8); real-DB w12 passed |
| CF-117 | P3 · POST · W9 | Refresh sessions: non-atomic rotation, no reuse detection, unlimited slidin… | Fixed at code level | Token families, atomic rotation, reuse revokes (§5N.5) |
| CF-118 | P3 · POST · W9 | Role and permission claims read from the JWT and never reloaded | Fixed at code level | Fresh claims from the user record (≤ 60 s, §5N.5) |
| CF-119 | P3 · POST · W9 | Password reset scans every session on the platform with one Redis round tri… | Fixed at code level | Per-user session registry (§5N.5) |
| CF-120 | P3 · POST · W3 | Permission model inconsistencies; UI offers actions the server refuses | Fixed at code level | Server permission model + Settings tabs (§5N.1) |
| CF-121 | P3 · POST · W3 | Plan entitlements not enforced; conflicting limits | Fixed at code level | Quota from plan column; seed max_users removed (§5N.1) |
| CF-122 | P3 · POST · W3 | Cost price and full subscription rows exposed to broad roles | Fixed at code level | Cost/redaction + admin detail strips card tokens (§5N.1) |
| CF-123 | P3 · POST · W3 | No branch-level authorization | Fixed at code level | Branch scope on reads and writes (§5N.1) |
| CF-124 | P3 · POST · W9 | Account enumeration via login timing | Fixed at code level | Merge |
| CF-125 | P3 · POST · W9 | URL-fragment session restored without verification | Fixed at code level | Cookie-based session hand-off (§5N.5) |
| CF-126 | P3 · POST · W9 | Cookie clearing omits the cookie domain | Fixed at code level | PV-18 browser check |
| CF-127 | P3 · POST · W9 | Refresh does not compare the stored tenantId with the resolved tenant | Fixed at code level | Merge |
| CF-128 | P3 · POST · W9 | Forgot-password counter keyed by email across tenants | Fixed at code level | Merge |
| CF-129 | P3 · POST · W9 | Admin refresh unthrottled | Fixed at code level | Merge |
| CF-130 | P3 · POST · W10 | Platform owner re-seeded and re-activated from environment variables at eve… | Fixed at code level | Owner bootstrap-only; OWNER_RESET_PASSWORD break-glass (§5N.6) |
| CF-131 | P3 · POST · W9 | Admin access token persisted in localStorage | Fixed at code level | Browser check of reload → refresh |
| CF-132 | P3 · POST · W1 | run-migrations admin route never completes | Fixed at code level | Staging call |
| CF-133 | P3 · POST · W12 | Unescaped document.write print sinks (CSP-mitigated) | Fixed at code level | POS end-of-day print escaped (§5N.13); PV-14 (CSP inherited by popups) still to observe |
| CF-134 | P3 · POST · W9 | Subdomain trust model amplifies any XSS | Fixed at code level | Origin subdomain bound to the store (§5N.5) |
| CF-135 | P3 · POST · W12 | Reset tokens and payment redirect parameters can reach analytics or logs | Partially fixed (browser check + SW cache key done, §5N.33) | PV-03 only |
| CF-136 | P3 · FG · W12 | R2 uploads: no type or size bound, empty-body checksum, one bucket for publ… | Partially fixed | Type+size signed, tenant prefix, checksum fix (§5N.8); public/private bucket split = infrastructure; upload UI wired (§5N.32), live R2 check pending |
| CF-137 | P3 · POST · W8 | Search uses leading-wildcard ILIKE across joins; invoice search truncates a… | Fixed at code level | pg_trgm (master migration) + trigram indexes (tenant 024); product search as per-column UNION; invoice search one paginated query (no 200 cap); POS aborts stale searches; R-07 on real PG (§5N.14) |
| CF-138 | P3 · POST · W8 | No response compression; SPA served by the API with max-age=0 | Fixed at code level | Asset cache headers + Caddy compression (§5N.4); Caddyfile not validated (no caddy binary) |
| CF-139 | P3 · POST · W7 | Stock report table renders every row; visible dashboards poll heavy endpoints | Fixed at code level | Stock report paged; dashboard polls reduced (§5N.4) |
| CF-140 | P3 · POST · W12 | New branches get no stock rows | Fixed at code level | Merge |
| CF-141 | P3 · POST · W12 | Low-stock filter applied after pagination | Fixed at code level | Merge |
| CF-142 | P3 · POST · W12 | Tenant emails stored un-normalised | Fixed at code level | Existing master rows not migrated (T-03) |
| CF-143 | P3 · POST · W12 | Signup response hard-codes a localhost login URL | Fixed at code level | Merge |
| CF-144 | P3 · POST · W2 | Installment math test re-implements the formula | Fixed at code level | Merge |
| CF-145 | P3 · POST · W12 | Minor financial items (Phase 3 FIN-24) | Fixed at code level | UTC date fixed by CF-082; sequence gaps accepted (PostgreSQL sequences, §6) |
| CF-146 | P3 · POST · W4 | VAT computed before the order-level coupon (tax rule unconfirmed) | Fixed (§5N.29: per-store setting, default unchanged) | Which value a store picks is the tax adviser's call |
| CF-147 | P3 · POST · W12 | Non-base currency amounts stored unconverted | Fixed at code level | Non-base currency sales refused until conversion exists (§5N.8) |
| CF-148 | P3 · POST · W10 | Master data-fix migrations hard-code one tenant | Fixed at code level | Guard test against tenant-specific migrations; historical files untouched (§5N.6) |
| CF-149 | P3 · POST · W10 | No migration_lock.toml | Fixed at code level | Merge |
| CF-150 | P3 · POST · W10 | Build reproducibility and supply-chain controls weak; Prisma CLI version ma… | Fixed at code level | pnpm/prisma/tsx pinned (§5N.6); image digests and Action SHAs pinned (§5N.15) |
| CF-151 | P3 · POST · W10 | Log retention and shipping not configured | Partially fixed | Log rotation + LOG_LEVEL (§5N.6); shipping = platform |
| CF-152 | P3 · POST · W10 | Railway restart policy gives up after three failures | Fixed at code level | Railway ALWAYS restart, /readyz (§5N.6); not exercised |
| CF-153 | P3 · POST · W10 | Frontend base domain baked at build time from a committed production file | Fixed at code level | VITE_BASE_DOMAIN build arg (§5N.6); not build-verified |
| CF-154 | P3 · POST · W10 | Auxiliary configs stale or unsafe if reused | Fixed at code level | Dev ports on 127.0.0.1; deploy.sh retired (§5N.6) |
| CF-155 | P3 · POST · W12 | Error mapping exposes raw codes; one unhandled rejection | Fixed at code level | List error states with retry; 44 mutation toasts carry the server message (guard test) (§5N.8, §5N.14) |
| CF-156 | P3 · POST · W12 | Money formatting inconsistent | Fixed at code level | POS amounts via Money / one currency label; EOD totals 2 dp (§5N.13) |
| CF-157 | P3 · POST · W12 | Responsive layout defects (Settings overflow, POS checkout below the fold) | Fixed at code level | Sticky mobile checkout bar (§5N.13); not re-measured in a real browser at 375 px |
| CF-158 | P3 · POST · W12 | Session expiry or a hung request loses the POS cart and form state | Fixed at code level | Re-login dialog instead of a redirect (requests retried) + POS draft + beforeunload (§5N.13, §5N.14); in-app navigation blocking for other forms not added (BrowserRouter has no blocker) |
| CF-159 | P3 · POST · W4 | Loyalty points can be earned but not redeemed from any screen | Fixed at code level | Loyalty redemption in the POS through the quote (§5N.13) |
| CF-160 | P3 · POST · W12 | Accessibility labelling gaps | Fixed at code level | jsx-a11y lint clean; no unnamed icon buttons (scan); POS / installment labels (§5N.13, §5N.14) |
| CF-161 | P3 · POST · W12 | Store VAT toggle and timezone settings have no effect | Fixed at code level | Time zone effective (CF-082); VAT toggle relabelled as service-invoice VAT (§5N.8) |
| CF-162 | Info · POST · W8 | One process runs HTTP, the SPA and all five workers | Fixed at code level | `PROCESS_ROLE` all/api/worker + optional worker service (§5N.15) |
| CF-163 | Info · POST · W7 | Dashboard caches today's revenue for 120 s without invalidation (acceptable… | Fixed at code level | Dashboard shows generatedAt (§5N.4) |
| CF-164 | Info · POST · — | One cost per variant across branches (weighted average is global) | No action required | Info, design observation; Phase 10 §7 "not scheduled (no action)" |
| CF-165 | Info · POST · W10 | Dockerfile comment says node, CMD runs tsx | Fixed at code level | Merge |
| CF-166 | Info · POST · — | Tenant resolved from host; header fallback on system hosts | No action required | Info; Phase 10 §7 "not scheduled (no action)" |
| CF-167 | Info · POST · — | Platform admins see tenant row counts only | No action required | Info; Phase 10 §7 "not scheduled (no action)" |

### 5N.17 Local commits (2026-10-21; the owner said "create the 15 stacked branches and commits in the worktree exactly as in the plan. Do not push or open PRs yet")

- The worktree changes are committed as 15 stacked branches `w1/01-tooling` … `w1/15-pos` (`fb15808` … `c5747cc`), on top of `main` = `7317c97`. The plan and the per-PR list are in `Hesba_W1_Commit_Plan.md`.
- Every intermediate state was type-checked and unit-tested before committing. Each commit holds exactly its planned files (15/15 verified), and the final branch type-checks.
- Nothing pushed, no PR opened. The original worktree branch `claude/w1-safety-net` still points at `7317c97`.
- PR 15 (POS) conflicts with `claude/ui-pos-merge-split` (`8846bce`) and with the owner's uncommitted POS edits in the main checkout. The owner reconciles it.
- Registry status unchanged: 2 not started / 7 partial / 155 fixed at code level / 3 no action. "Fixed at code level" now means "committed locally on the w1 stack, not merged".

### 5N.18 Merged into local `main` (2026-10-21; the owner said "merge all thing to main please")

- Local `main` was fast-forwarded from `7317c97` to `c5747cc` (= `w1/15-pos`): a linear history of the 15 commits, with no merge commit.
- **Not pushed.** `origin/main` is still `7317c97`. The repository has `railway.json`, and Railway normally deploys `main` on push. The Phase 11 gates forbid a production deploy, so pushing needs the owner's explicit decision.
- The main checkout (branch `claude/ui-pos-merge-split`, with uncommitted `POS.tsx` / `AppShell.tsx` edits) was not touched. Merging that branch into `main` will conflict in `POS.tsx`.

### 5N.19 Full-cycle trial on the merged code (2026-10-21; the owner said "شغل نجرب" then "test full cycle")

- **Environment:** local `main` = `c5747cc`, run from the worktree.
  - Temporary PostgreSQL and Redis on 127.0.0.1 in the scratchpad (Redis installed temporarily from Homebrew). API on `:3001`, web on `:5174`.
  - **No Paymob or Resend keys**, so nothing could be charged or e-mailed. ETA off.
  - A test store `w1-trial` (enterprise trial), an owner and a cashier. Their logins are in the git-ignored `.claude/local-trial-login.txt`.
- **Cycle run:** through the UI, plus the same API the UI calls:
  - settings (loyalty on);
  - product with 14% VAT;
  - supplier, then purchase order draft → approval → approved → received (stock 10, cost 600, supplier owed 6,000);
  - customer with 500 store credit;
  - POS sale: 2 units, 300 from credit, rest by card;
  - return of 1 unit to credit;
  - cash sale, then cancelled;
  - installment contract: quote → create → approve → pay #1 → early settlement through the new button;
  - cashier permission matrix;
  - P&L and day close, reconciled by hand from raw rows.
- **Passed:**
  - Server price, VAT and quote equal what was recorded. A client `unitPrice` is ignored.
  - Stock movements at every step.
  - The customer ledger reconciles after every step.
  - Loyalty earned and reversed.
  - Payment allocations.
  - Cancellation reverses stock and money.
  - Installment schedule, paid amount, and settlement (completed; 140 + 4 × 250 allocations).
  - Cashier: can sell; 403 on credit adjust, cancel, return, settings, products, settle and users.
  - Day close (cash 4,560, card 1,980, installments 1,140, total 7,680, credit −840).
  - COGS 3,600 (the restocked return is reversed).
  - Deep link restored after login.
  - The installment list now shows remaining amount and next due date.
- **Found:**
  1. **Fixed (uncommitted, worktree):** after a full page load, Suppliers, Expenses and Services said "not in your plan" even on enterprise.
     - Cause: the access token is not persisted, so `useMe` stayed disabled and nothing triggered the refresh; `FeatureGate` read "no data" as "no feature".
     - Already present before W1.
     - Fix: `useMe` / `useUsage` run whenever a session exists. `FeatureGate` stays silent until the plan is known, and shows a retryable error if `/me` fails.
     - Test `feature-gate-cold-load.test.tsx` (3); mutants M23–M24 caught; web 42 files / 268 tests pass.
  2. **Open — card fee base includes the store-credit part.** Fee = 1.75% × 2,280 = 39.90, but the card processed 1,980 (34.65). A customer-borne fee would overcharge the customer by the same share. (`invoice.service.ts` `preFeeTotal`.)
  3. **Open — the P&L under-reverses returns paid partly with store credit or points.**
     - `returns.amount` / `net_amount` hold only the part refunded in the chosen form (990 → 868.42 net). The credit share (150) also goes back to the customer, but is left out of the reversal.
     - Store credit is a way of paying (the sale books 2,000 of revenue), so returns should reverse 1,000 net + 140 VAT.
     - Net revenue and gross profit are overstated by 131.58 here. This is an incomplete CF-018 / CF-003 implementation.
  4. **Open — installment-sale invoices never get an invoice number.** Only POS sales and work orders call the sequence. Receipts print without a number, and ETA would refuse them (`invoice_number_missing`). Already present before W1.
  5. **Open (reporting) —** P&L "VAT collected" is gross (1,120): no deduction for cancelled or returned VAT, while real VAT is 840.
  6. **Cosmetic —**
     - the installment schedule shows dates as "212026/10/" (RTL bidi);
     - the invoice drawer labels the credit used as "الخصم" and lists a merchant-borne fee the customer didn't pay;
     - POS Enter on a single search result doesn't add it (ArrowDown + Enter does).
  7. **Policy question —** the seeded cashier role (`reports:read`) can open the P&L, including profit.

### 5N.20 Trial findings 2–4 fixed (2026-10-21; the owner said "fix findings 2, 3 and 4 test-first … then re-run the cycle checks")

Worktree, uncommitted, on top of `w1/15-pos` = local `main` `c5747cc`.

- **Finding 2 — the fee base** (`invoice.service.ts` `priceSale`):
  - The payment fee is now computed on what the method processes: goods + VAT − coupon − store credit − points.
  - Store credit and points pay for goods only, never for a fee.
  - Nothing processed means no fee at all, including fixed fees.
  - Tests: 5 new in `create-invoice.guards.test.ts`. Mutants M25–M28 caught (M26 needed the fixed-fee case, added).
  - **Known limit:** with a split payment, the second method's share is still in the primary method's fee base. Fixing that is circular when the customer bears the fee, so it is left open.
- **Finding 3 — P&L returns** (`refund.ts`, `returnInvoice`):
  - `computeReturnRefund` also returns `revenueNet` / `revenueTax`: the refund plus the credit and points shares (a coupon stays excluded).
  - The return row's `net_amount` / `tax_amount` now hold that reversal. `amount` still means "money refunded in the chosen form".
  - Tests: 3 new. Mutants M29–M31 caught.
  - **Not corrected:** return rows written before this fix keep their smaller net. A backfill needs item-level recomputation and is a follow-up.
- **Finding 4 — installment invoice numbers:**
  - New `shared/utils/invoice-number.ts` (`nextInvoiceNumber`), used by POS sales, work orders and, new, installment approval.
  - Tenant migration `028_number_installment_invoices.sql` numbers already-approved installment invoices, in creation order, with the store's local date. Rejected contracts are left alone. It is idempotent.
  - Tests: 2 unit tests. Mutants M32–M33 caught.
- **Real-database tests** (`w13`, now 8 tests):
  - fee 34.65 and return reversal 1,000 + 140;
  - approval numbers the invoice; 028 numbers an approved, unnumbered invoice and skips a rejected one.
  - Integration mutants IT-M8 (028 approved-only) and IT-M9 (return net), both caught.
- **Checks:**
  - API: `tsc`, lint (0 errors), 107 files / 852 tests, build — all pass.
  - Web: `tsc`, lint (0 errors), 42 files / 268 tests, build — all pass.
  - Database `tsc` passes.
  - Real DB with Redis: 17 files / 89 tests pass. `health-readiness` was skipped this run (it would freeze the trial app); it passed earlier today.
- **Cycle re-run on the trial stack** (the API reloaded and migrated the store to 028):
  - the earlier installment invoice got `INV-20261021-000007`;
  - a new card sale with 300 credit → fee 34.65;
  - a return → 990 refunded, reversal 1,000 + 140;
  - a new installment invoice: unnumbered before approval, `…000009` after;
  - P&L reconciles by hand: gross 3,331.58 = 8 × 400 + 131.58 left by the pre-fix return row; fees 74.55.

### 5N.21 Trial fixes committed (2026-10-21; the owner said "commit the trial fixes as a new commit on top of the stack and fast-forward local main. Don't push")

- Commit `80d020b` on `w1/16-trial-fixes` (parent `c5747cc`), 14 files. Local `main` fast-forwarded `c5747cc` → `80d020b`.
- **Not pushed:** `origin/main` is still `7317c97`.

### 5N.22 POS hands-on UI test (2026-10-21; the owner said "اعمل مده تيست ui لل pos", chose hands-on, merged main)

- **Setup:** local `main` `80d020b`; temporary PostgreSQL and Redis (Redis reinstalled temporarily); no Paymob or Resend keys.
- **Seeded store `pos-test`:**
  - 4 products: VAT, no VAT, stock 3, and stock 0 — all with barcodes;
  - a customer with 200 credit and 1,368 points;
  - coupon `TEST10`;
  - "فاليو" with a 3% fee paid by the customer;
  - a cashier.
- **Viewports:** 1280×800, 1280×1100 and 375×812.
- **Passed:**
  - search by Arabic name and SKU (Ctrl+K);
  - barcode add (Ctrl+B);
  - VAT per line;
  - coupon (case-insensitive);
  - credit + points + coupon together: due 415, exact; database, ledger and points all correct;
  - customer-paid fee: 41.04, due 1,409.04;
  - split payment recorded and allocated correctly;
  - the server refuses an out-of-stock sale with a clear toast and keeps the cart;
  - API down: the cart is kept; after the API returns, the quote recovers and the retry creates exactly one invoice;
  - the cashier's POS loads payment methods, and the menu is restricted;
  - mobile: sticky bottom total, no horizontal page overflow.
- **Found** (all were already there before W1 unless stated):
  1. **P1 — items added by barcode:**
     - "+" deletes the cart line, and the stock limit is never applied.
     - Cause: `GET /products/barcode/:code` returns `stock` as an array of branch rows, while search returns a number; POS computes `Math.min(qty+1, array)` = NaN, and the line is filtered out.
     - Fix: return the same shape as search (or normalise it in the POS).
  2. **P1 — layout:**
     - At 1280×800, once a customer with credit or points is attached, the payment-method card collapses to 2 px (a `flex-shrink` + `overflow-hidden` card inside the sticky scrolling column), so no payment method can be chosen and the sale can't be completed.
     - Comes from the sticky-panel change in PRs #29/#30.
     - Fix: `shrink-0` on the side-panel cards.
  3. **P1 — the POS day-close popup ignores split payments.**
     - It reads `/reports/sales` grouped by each invoice's primary method: cash 1,783 and Valu 1,409.04.
     - The ledger day close (`/reports/day-close`) is correct: cash 2,283 and Valu 909.04.
     - The drawer would count 500 "over". Fix: the popup uses the ledger day close.
  4. **P1 (scanner) — focus after a scan.** After a barcode scan, focus moves to the search box, so the next scan lands in search and is not added (Enter in search does not add). Fix: keep focus in the barcode field after a scan.
  5. **P2 — first login.** A first login always lands on `/settings` (onboarding), even for a cashier, who then gets "صلاحية غير كافية … settings". The message also shows the raw resource name. Fix: onboard only users with `settings:read`.
  6. **P2 — out of stock.** An item with stock 0 can be added to the cart (the server blocks it at checkout).
  7. **P2 — keyboard flow:**
     - Enter on the only search result does not add it;
     - the customer dialog does not focus its search field;
     - after "بيع جديد" focus is not back in search;
     - Ctrl+Enter is silent when no payment method is chosen.
  8. **P2 — network error toast.** The toast when the API is down ("فشل إنشاء الفاتورة") doesn't say whether the sale was saved.
  9. **P3 — mobile.** The cart table scrolls sideways, which hides the remove button; Ctrl hints are shown on phones.
  10. **P3 — stale session.** A saved session for a store that no longer exists stays on the POS with errors instead of returning to login.
  11. **P3 — multi-branch stock.** Available stock in the POS is the sum over all branches; the sale deducts only from this branch.
  12. **Known (from §5N.20) —** with a split payment, the primary method's fee is still on the full amount.
  13. **Tax question for CF-146 —** the coupon is taken after VAT (VAT on the pre-coupon amount).

### 5N.23 POS P1 fixes (2026-10-21; the owner said "fix the 4 P1 POS bugs test-first, verify them on the running test stack, then tear it down")

- **Commit:** `d08baa2` on `w1/17-pos-fixes`; local `main` fast-forwarded `80d020b` → `d08baa2`. **Not pushed:** `origin/main` is `7317c97`.
- **The four fixes** (§5N.22 items 1–4), each test-first:
  - `/products/barcode/:code` returns `stock` as a number (M34 caught).
  - After a scan, focus stays in the barcode field (M35 caught).
  - The day-close popup reads `/reports/day-close` and merges sales, installments and services per method (M36–M37 caught). `pos-sale-permissions` now lists `/reports/day-close`; the cashier holds `reports:read`.
  - The side panel uses `[&>*]:shrink-0`, so its cards keep their height and the column scrolls.
- **Verified on the running stack** (cashier session, 1280×800):
  - two scans in a row → quantity 2, focus still in the barcode field;
  - "+" → 3, then "الحد الأقصى" with "+" disabled;
  - with a customer, credit and points open, the payment card keeps 284 px and the column scrolls (681 / 873);
  - the popup shows cash 2,568 and Valu 909.04, the same as the ledger.
- **Checks:**
  - API: `tsc`, lint (0 errors), 853 tests, build — all pass.
  - Web: `tsc`, lint (0 errors), 271 tests, build — all pass.
- **Teardown:**
  - servers stopped;
  - temporary PostgreSQL and Redis data deleted;
  - `redis` + `openssl@4` uninstalled, plus the config files that install created; the Homebrew formula list is identical to before;
  - the main checkout's `launch.json` restored (`hesba-web` only);
  - the test login file deleted.
- **Still open from §5N.22:** P2/P3 items 5–13.

### 5N.24 Security and concurrency trial (2026-10-22; the owner said "جرب يلا")

- **Setup:** local `main` `d08baa2` on the temporary stack. Two fresh stores, `iso-a` and `iso-b`. Script-driven through the real API (the same calls the UI makes).
- **Isolation — 14/14 pass:**
  - Store A's token on store B → 403.
  - B's customer, invoice and product ids used through A (read, cancel, add credit, sell) → 404 / `variant_not_found`.
  - A's searches never return B's rows.
  - A store token on the platform-admin API → 403.
  - No token → 401.
  - A token with an edited payload (`schemaName` changed to B) → 401; an `alg:none` token → 401.
- **Role matrix — 0 mismatches:** 5 seeded roles × 22 routes. The answer is 403 exactly where the role's own permissions lack the right; routes that would change data were skipped for roles that are allowed.
- **Race — 20/20 rounds:** two cashiers buy the last unit at the same instant; exactly one wins (201), the other gets 400 "المخزون غير كافٍ", and stock ends at 0.
- **Found — minor:** a request whose `Origin` is not allowed is blocked (good), but the CORS callback throws a plain `Error`. The response is 500, and the log gets `unhandled_error` with a stack trace (`apps/api/src/index.ts` ~line 190), so a header anyone can send fills the error log or triggers alerts. Fix: refuse with a 403 error.

- **Fixed (2026-10-22):** the foreign-Origin refusal now answers 403 `origin_not_allowed` and logs no error (`config/cors-origin.ts`). Commit 9c4d005 on `w1/18-cors-403`; local `main` fast-forwarded; not pushed.

### 5N.25 Operations trial (2026-10-22; the owner said "كمل تجريب")

- **Setup:** local `main` `9c4d005` on the temporary stack; a fresh store `flow-three`; script-driven through the real API. **27/27 checks pass. No new defect.**
- **Multi-branch:**
  - a second branch;
  - a transfer moves nothing until approved, then 6 / 4; a second approval → 409;
  - an over-transfer → `insufficient_stock`; a rejected transfer moves nothing;
  - a branch-2 manager asking for branch-1 stock gets only branch-2 rows;
  - a branch-2 cashier selling from branch 1 → 403 `branch_forbidden`;
  - selling 5 when branch 2 holds 4 → refused, even though the store holds 10; selling 2 → branch 2 = 2, branch 1 untouched.
- **Services:**
  - invoicing before the order is ready → 409 `work_order_not_ready`;
  - an illegal status jump → `invalid_transition`;
  - when ready → invoiced as `SVC-…`, from the same number series as sales;
  - a second invoice → 409 `already_invoiced`.
- **Purchasing:**
  - a partial receive of 4/10 → `partially_received`, stock 14, average cost 117.14 (exact);
  - receiving 7 more when 6 are outstanding → 409 `qty_exceeds_outstanding`;
  - the last 6 → `received`;
  - supplier payments: an overpayment → 400 `overpayment`; paid in full at 1,600.
- **Expenses:** a pending expense stays out of the P&L; once approved, operating expenses rise by 150 and net profit falls by 150. Revenue 400 = 200 of sales + 200 of service.
- **CSV import:**
  - 2 rows created; a row without a price and a duplicate SKU are reported by row number and not imported;
  - imported stock lands;
  - a 1,001-row file is refused whole (413 `too_many_rows`).

### 5N.26 UX, settings, mobile and load trial (2026-10-22; the owner said "كمل يا باشا كل حاجه")

- **Setup:** local `main` `9c4d005`; a fresh store `ux-test`; browser + API.
- **Session expiry:**
  - With all refresh sessions revoked in Redis, the next reload's refresh → 401, and the re-auth dialog "انتهت الجلسة" opens with the e-mail pre-filled.
  - After the password, the same POS page returns with the cart intact (2 lines, 741).
  - Revoking only the `rt:user:*` index did not end the session — that key is an index, not the session.
- **ETA settings (no call to the Tax Authority):**
  - Saved credentials are never returned (only `…Set` flags) and are stored encrypted (`v1:…` ciphertext).
  - A too-short secret and a non-PEM certificate → 400.
  - "Test connection" was not pressed (it calls the real ETA).
- **Print template:** a saved template containing `<script>`, `onerror`, a `javascript:` link and an `<iframe>` renders in the preview with all four removed, the `<h1>` kept, and no injected code executed.
- **Mobile (375×812), 16 screens:**
  - no error states; tables scroll inside their own wrappers; the Settings tab bar scrolls by design.
  - **Found (P2):** Reports widens the whole page (layout width 603 px on a 375 px phone, page scrolled sideways). The tab row `<div className="flex gap-2">` (7 buttons) cannot wrap or scroll (`Reports.tsx` ~line 263). Fix: `overflow-x-auto` (as in Settings) or `flex-wrap`.
- **Load — 10,000 products inserted:**
  - medians: POS search 14–24 ms; barcode 7 ms; product list (first and last page, with search) 11–14 ms; stock report 31 ms; dashboard 13 ms (first call 200 ms); P&L 19 ms; sales report 15 ms; a 10-line POS quote 17 ms.
  - 200 searches, 20 at a time: about 300 req/s, median 58 ms, p95 103 ms, max 116 ms, all 200 OK.

### 5N.27 P2/P3 fixes (2026-10-22; the owner said "fix the remaining P2/P3 items … test-first, then verify and commit")

- **Commit:** `d4cd7c3` on `w1/19-pos-p2-fixes`; local `main` fast-forwarded. **Not pushed.**
- **Fixed — §5N.22 items 5–10 and the §5N.26 Reports item:**
  - First login: onboarding only for users who can update settings; `super_admin` has every permission (`lib/landing.ts`).
  - The POS refuses an out-of-stock add, with a message.
  - Enter adds a single search result.
  - The customer dialog autofocuses its search (the Modal now honours `data-autofocus`).
  - "بيع جديد" refocuses search.
  - Ctrl+Enter without a payment method says so.
  - When the server doesn't answer, the message says a retry of the same cart is safe (the Idempotency-Key is reused).
  - Reports: the tab row scrolls (no more 603 px layout on a 375 px phone).
  - Compact cart cells keep the remove button on screen; keyboard hints show on large screens only.
  - 404 `tenant_not_found` signs out to /login, without the re-auth dialog.
- **Checks:** mutants M39–M45 caught; web 285 tests, lint 0 errors, build pass.
- **Verified live:**
  - Reports layout 375; cart remove buttons on screen; no keyboard hints on the phone.
  - A new cashier's first login → /pos.
  - Enter added the single result; an out-of-stock add was refused; Ctrl+Enter answered "اختر طريقة الدفع أولاً".
  - A session pointed at a missing store → /login.
- **Not done (left as-is):**
  - multi-branch POS stock showing the sum over all branches (§5N.22 item 11) — the server still enforces branch stock;
  - the split-payment fee base (§5N.20);
  - the CF-146 tax question about the coupon and VAT.

### 5N.28 Money and stock follow-ups (2026-10-22; the owner said "كمل يا باشا اللي شايفه صح")

- **Commit:** `9e73506` on `w1/20-money-fixes`; local `main` fast-forwarded. **Not pushed** (origin/main is still `7317c97`).
- **Fixed:**
  - **POS stock per branch (§5N.22 item 11):**
    - `/products/search` and `/products/barcode/:code` now return the stock of the user's branch, which is the branch the sale leaves from.
    - Users without a branch (e.g. the owner) still see the store total.
  - **Split-payment fee base (§5N.20):**
    - Each method's fee is computed on its own share at its own rate.
    - One merchant fee-expense row is written per method, and allocations carry their fee.
    - A split is limited to what the methods process (goods less credit and points).
    - One sale still has one fee bearer, so the invoice fee fields and the ETA fee line stay a single figure (§6.0).
  - **P&L VAT:**
    - New fields: `taxReversed` (cancellations + returns, booked on their own date) and `taxNet`.
    - The Reports P&L now shows cancellations/returns, net revenue and payment fees. Before, net profit subtracted fees and returns that the page never showed.
    - VAT owed is shown apart, labelled as not part of profit.
- **No action — the backfill of old return rows:**
  - `net_amount`/`tax_amount` come from migration 020, which never reached production (origin/main ends at migration 017).
  - So no production row was written with the pre-fix net, and migration 029 is not needed.
  - Returns from before 020 keep the P&L's legacy fallback (`COALESCE(net_amount, amount)`).
- **Checks:**
  - API: 108 files / 862 tests. Web: 44 files / 286 tests. tsc clean on both; eslint clean on the changed files.
  - Real DB: temporary PostgreSQL 18 + Redis on loopback, 17 files / 89 tests pass (1 file skipped as before). Torn down afterwards; the Homebrew formula list is identical to before.
  - Mutants caught: primary fee base (unit), IT-M8 returns VAT, IT-M9 cancellations VAT.
- **Still open:** the CF-146 coupon-after-VAT tax question; the owner's POS reconcile; the push decision; the external items (Sentry DSN, ETA signer/PV-16, PV-01, bucket split, log shipping).

### 5N.29 CF-146 as a store setting (2026-10-22; the owner said "ممكن نخلي ده ديناميك … مش كل المستخدمين هيعملوا حوار الضرايب" and then "اه")

- **Commit:** `fec0e8a` on `w1/22-coupon-tax-mode`, on top of local `main` (`7a91d4b`). Local `main` has not moved. **Not pushed.**
- **What changed:** each store chooses where the order-level coupon sits.
  - **After VAT** — the existing behaviour, and the default, so no store changes by itself.
  - **Before VAT** — the coupon lowers the taxable amount.
- **Migration 029:**
  - `tenant_settings.coupon_before_tax` — the store's choice.
  - `invoices.coupon_before_tax` — the mode each sale was priced with.
  - `invoice_items.coupon_share` — the line's share of a before-VAT coupon.
- **Pricing (before VAT):**
  - The coupon is split over the lines by their amount; the last line takes the rounding rest.
  - Each line is taxed on what is left.
  - Money keeps 4 decimal places, as everywhere in the code.
- **Returns:** they follow the invoice's own line shares, so changing the setting later never touches past sales.
- **ETA:** a before-VAT coupon goes into each line's discount; only the rest is the after-tax extra discount.
- **Settings UI:** a "خصم الكوبون" select is always shown.
  - It is not hidden behind the VAT toggle, because that toggle covers work-order invoices only; product VAT comes from each product's rate.
- **Checks:**
  - API: 108 files / 870 tests. Web: 45 files / 287 tests. tsc clean on api, web and database.
  - Lint: 0 errors. Build: pass.
  - Real DB: 19 files, 0 failures — includes schema drift and the new `coupon-tax-mode` test. The migration-026 test's "latest version" expectation was updated from 28 to 29.
  - Mutants caught: IT-M10 to IT-M12, M-ETA, M-UI. The temporary PG and Redis were torn down; the Homebrew formula list is identical to before.
- **CF-146 status:** fixed as an owner setting. A tax adviser's answer now only decides which value a store picks.

### 5N.30 CF-032 error tracking wired (2026-10-22; the owner said "سطّب @sentry/node و@sentry/react، ووصّلهم … مع إخفاء البيانات الحساسة واختبارات، بحيث يشتغل أول ما أحط الـ DSN")

- **Commit:** `ddda4f2` on `w1/23-sentry`, on top of local `main` (`fec0e8a`). Local `main` has not moved. **Not pushed.**
- **Installed:** `@sentry/node` 8.55 (api) and `@sentry/react` 8.55 (web). The old `sentry.plugin.ts` was removed: the SDK was never installed, so that plugin never ran.
- **Reported once a DSN is set:**
  - every API response ≥ 500, tagged with the route template, method, status and store id; 4xx are not reported;
  - background jobs that failed for good, and worker errors;
  - browser render crashes (ErrorBoundary).
- **Privacy:**
  - No default PII, no local variables, no tracing or session replay.
  - Events lose request bodies, query strings, #fragments, cookies and all headers but a safe few.
  - E-mails and phone/card numbers are masked; secret-named fields are redacted everywhere.
  - Verified end to end with the real SDK against a loopback mock: the bytes on the wire carry no credential, body, query or customer data.
- **Setup:**
  - `SENTRY_DSN` and `VITE_SENTRY_DSN` (Dockerfile build args; the release defaults to the deployed commit).
  - CSP `connect-src` gets the browser DSN's ingest origin.
  - Owner steps are in `docs/operations/release-and-rollback.md` ("Error tracking and alerts"), including the `/readyz` uptime monitor.
- **Checks:**
  - API: 113 files / 891 tests. Web: 47 files / 293 tests. tsc and builds pass; eslint 0 errors.
  - Mutants caught: S-M2 to S-M7, and S-M1 via the unit scrub test. S-M1 is equivalent end to end: the SDK attaches no request data on that path.
- **Status:** CF-032 is partial. The code is done; still needed: the DSN, the alert recipient and the uptime monitor (the owner's accounts).

### 5N.31 CF-057 credit notes for returns + return VAT fix (2026-10-22; the owner said "اه ماشي ابدء")

- **Commit:** `cdb706d` on `w1/24-eta-credit-notes`, on top of local `main` (`ddda4f2`). Local `main` has not moved. **Not pushed.**
- **Credit notes (CF-057):**
  - **Migration 030:** `returns` gets its own ETA state; `eta_submissions` gets `return_id`.
  - **When a credit note is filed:** a return of a sale that is (or is being) filed is marked `pending`. It is filed only after ETA has **accepted** the sale, as document type "C" referencing the sale's uuid.
  - **What it contains:**
    - the returned units at the sale's own price, discount (incl. a before-VAT coupon share) and VAT;
    - the after-VAT coupon share as extra discount;
    - no fee line.
  - **Checks and handling:**
    - It must add up to what the return reversed.
    - Claim, outcome and poll handling are the same as for sales; the hourly sweep re-enqueues waiting credit notes.
    - Attempts are counted per document.
  - Off unless `ETA_AUTO_SUBMIT` is on, like sales.
- **Bug found and fixed (return VAT with an after-VAT coupon):**
  - A return reversed less VAT than the sale declared.
  - Example, full return of 2×100 + VAT 28 − coupon 10: VAT was 26.77 / net 191.23, now 28 / 190.
  - This affected the P&L VAT reversal and the returns' `tax_amount`. Migration 020 never reached production, so no production rows are affected.
- **Checks:**
  - API: 114 files / 901 tests; tsc and lint clean.
  - Real DB: 19 files / 92 tests (temporary PG + Redis, torn down; the formula list is identical to before).
  - Mutants CN-M1 to CN-M7 caught; CN-M2 survived at first, and a "submitted but not accepted → wait" assertion was added.
  - The migration-026 test now derives the latest migration number.
- **Still open on CF-057:** the real CAdES-BES signer, ETA JSON-schema validation, PV-16 preprod; no UI shows a return's ETA state yet.

### 5N.32 CF-136 image upload UI (2026-10-22; the owner said "كمّل في CF-136 واجهة رفع الصور")

- **Commit:** `c8dee2c` on `w1/25-upload-ui`, on top of local `main` (`cdb706d`). Local `main` has not moved. **Not pushed.**
- **Done:**
  - **Image field** in the create / edit product drawers:
    - the browser checks the file (JPEG / PNG / WebP, ≤ 5 MB — the same bounds the server signs);
    - it is PUT straight to R2 with the presigned URL, without cookies;
    - it is previewed and saved as `imageUrl`, and can be changed or removed.
  - **Where the image shows:** a thumbnail in the product list, and the image in the product details.
  - **Clear messages:** storage not configured, refused file, failed upload.
  - **Found and fixed:**
    - The CSP `connect-src` did not allow the R2 endpoint, so every browser upload would have been blocked. It now gets the account endpoint (a plain account id only).
    - `upload-url` needed `products:create` even to edit an image; it is now create OR update.
  - **Runbook:** the R2 variables and the bucket CORS policy.
- **Checks:**
  - API: 116 files / 906 tests. Web: 49 files / 304 tests. tsc, lint (0 errors) and build pass.
  - Mutants U-M1 to U-M7 caught.
  - **Not checked in a real browser against real R2** (no R2 account here).
- **Still open on CF-136:** the public/private bucket split (platform), and a live upload check once R2 is configured.

### 5N.33 CF-135 service-worker cache key + real-browser check (2026-10-23; the owner said "كمّل في CF-135 اختبار المتصفح")

- **Commit:** `c50fa2f` on `w1/26-cf135-browser`, on top of local `main` (`c8dee2c`). Local `main` has not moved. **Not pushed.**
- **Fixed (the §5I.6 #3 decision):**
  - The service worker cached each page's HTML under its full URL, so Cache Storage kept keys such as `/reset-password?token=…`.
  - Every route serves the same shell, so HTML is now stored under `/` only, and the offline fallback uses it.
  - The cache name moves to `hesba-shell-v5`, so the old entries are deleted on activation.
  - Tests first; mutants SW-M1 and SW-M2 caught.
- **Real-browser check** (production build served by the API; temporary PG/Redis; trial store; all torn down):
  - `/reset-password?token=…`: the address bar is `/reset-password` before render, the token is not in the page, and `history.state` holds no token.
  - With the service worker in control, Cache Storage holds only `/` plus hashed assets.
  - Paymob return `/settings?tab=billing&success=…&hmac=…&id=…&order=…`: the address bar becomes `?tab=billing`, none of the fields are in the page, and no cache key carries a query string.
- **Not done on purpose:**
  - GA page views were not exercised in the browser: a dummy measurement id would still load Google's script and send requests to Google. They stay covered by the jsdom tests (§5I.8).
  - The deployed GA state stays PV-03 (owner).
  - The browser's own history entry for the first navigation is outside the app's control (documented in §5I.6).
- **Checks:** web 50 files / 308 tests, build pass.
- **CF-135 status:** code and browser checks are done; only PV-03 is open (whether a deployed bundle ever had GA). It stays partial until PV-03 is answered.

### 5N.34 Owner checklist (2026-10-23; the owner said "جهّز ملف واحد فيه كل المطلوب مني مرتّب خطوة بخطوة")

- **New file:** `documents/audit/Hesba_Owner_Action_Checklist.md` (Arabic).
- **What it holds:** every item that needs the owner, in order:
  - **0 — security:** C-0 host identity, C-4 freeze, C-9 rotation if needed, repository private and secrets.
  - **1 — deploy gates G-1 … G-7:** backup + restore, billing live?, deployed commit, topology / `TRUST_PROXY`, environment presence incl. GA (PV-03), web state + rollback tag.
  - **2 — accounts:** Sentry + alerts + uptime, R2 + CORS + private bucket, ETA preprod + CAdES-BES signer, log shipping, tag deploys, Resend / Paymob.
  - **3 — decisions:** review §6.0, the coupon / VAT question for the tax adviser, the open PV-21 items.
  - **4 — the deploy itself:** 3 master + 13 tenant migrations.
  - **5 — after the deploy:** alert proven to reach a person, ETA preprod run, PV-18 devices, Node 20 EOL, PV-09 damage sizing.
- Local `main` = `c50fa2f`, 27 commits ahead of `origin/main` (`7317c97`). **Nothing pushed.**

### 5N.35 Items the code side could still close (2026-10-23; the owner said "خلص اي حاجه انت ممكن تاخد فيه مسوليه")

- **Commit:** `7b765e3` on `w1/28-owner-free-items`, on top of local `main` (`0dc7edb`). **Not pushed.**
- **Returns list:** shows each return's ETA credit-note state. Closes the "no UI" gap from §5N.31.
- **ETA pre-send check (CF-057):**
  - Before sending, the document's structure and arithmetic are checked.
  - A failing document is marked `failed` / `document_invalid`, with the list of problems, and is not sent.
  - Mutant V-M1 caught.
- **Node 22:** Dockerfile on `node:22-alpine` (digest looked up from Docker Hub), engines `>=22`, `.nvmrc`, CI and runbook notes updated.
  - **Not built locally** (no Docker); the CI build-and-boot job proves it.
  - Local tests already run on Node 23.
- **Checks:** API 117 files / 911 tests; web 52 files / 310 tests; build pass.
- **Owner checklist item 5.5 (Node 20):** done in code.
