# حِسبة (Hesba) — Phase 10: Final Cross-Phase Consolidation & Remediation Roadmap

| Item | Value |
|---|---|
| Date | 2026-10-13 |
| Code under review | branch `claude/ui-pos-merge-split` @ `8846bce`; the pre-existing uncommitted edits (`apps/web/src/components/layout/AppShell.tsx`, `apps/web/src/pages/pos/POS.tsx`) and untracked `documents/` are preserved and are the same tree every phase audited |
| Inputs | The ten reports in `documents/audit/` (Phases 1, 2, 3, 4, 4.5, 5, 6, 7, 8, 9), read in full for their finding, correction, unverified, cross-phase and remediation sections; selected code lines re-checked (§12.3) |
| Mode | Consolidation and planning only. No application source, test, migration, configuration, dependency or deployment file was modified. No production access. Nothing was executed against any database or service in this phase |
| ID scheme | Canonical findings **CF-001 … CF-167** (this report). Every original ID (FIN-, HSEC-, DB-, BG-, INT-, UX-, INFRA-, PERF-, Phase 1 observation IDs, …) is preserved and traced (§3, §12). Root causes keep Phase 4.5's **RC-01 … RC-11**; this phase adds **RC-12 … RC-14** (§5). Production-verification items are **PV-01 … PV-22** (§9); remediation tasks are **T-xx**; waves are **W0 … W12** |
| Severity notation | P0 / P1 / P2 / P3 / Info. **P0\*** = P0 *if* the affected feature (automated card billing) is live in production; otherwise P1 and a feature gate. Rubric in §4.1 |

---

## 1. Executive summary and overall readiness assessment

### 1.1 Readiness verdict

**Hesba is not ready for a production release, and this audit cannot declare it production-safe.** That conclusion does not depend on any assumption about production: five P0 defects are confirmed in code at `8846bce`, three of them reproduced at runtime, and each is reachable through normal use by an ordinary tenant employee. Whether the platform is *already* causing harm in production depends on facts no phase could see (live topology, which features are enabled, existing data damage, backups). §9 gives a read-only way to establish each one.

### 1.2 What the nine audit phases add up to

The ten reports contain **309 finding-class identifiers** (findings, likely and potential items, and Phase 1 observations), **62 unverified-item identifiers**, 10 verified security controls, 8 attack-path chains and 25 documentation discrepancies. After merging aliases and re-confirmations they reduce to **167 canonical findings**:

| Severity (reassessed) | Count | Of which runtime-confirmed | Release class (primary) |
|---|---|---|---|
| **P0** | 5 | 3 | all release blockers |
| **P0\*** (deployment-conditional) | 2 | 2 | blockers if automated card billing is live |
| **P1** | 28 | 19 | 16 release blockers, 3 conditional blockers, 9 pre-release requirements |
| **P2** | 50 | 34 | 11 feature gates, 6 pre-release requirements, 2 containment items, 31 post-release |
| **P3** | 76 | 20 | 4 feature gates, 72 post-release |
| **Info** | 6 | 0 | post-release / no action |

Two earlier findings are **rejected** (FIN-23; the FIN-20 "last two installments" sub-claim), two umbrella IDs were **split** by Phase 4.5 (FIN-07, FIN-08), and 9 earlier statements were **corrected** in scope (§4.4). Every original ID is accounted for (§12.1: 309 / 309).

### 1.3 The P0 and P0\* defects

| CF | Defect | Original IDs | Evidence |
|---|---|---|---|
| CF-001 | The server prices sales and installment contracts from the **client's** `unitPrice` | FIN-05, HSEC-02, F-01 | code (`invoice.service.ts:209`, `installment.service.ts:166`); the installment form exposes an editable price (Phase 7) |
| CF-002 | The POS shows and collects a different amount than the server records (**950.00 shown vs 976.00 recorded**; no VAT line on the receipt) | FIN-01, UX-01 | runtime (Phase 7 E3–E7) |
| CF-003 | Refunds are computed wrongly (line discount subtracted twice, order-level discounts ignored): **926.00 refunded for a 976.00 sale** | FIN-02, F-04, UX-L02 | code + runtime (Phase 7 E10) |
| CF-004 | Pending installment invoices can be cancelled or returned, and approval revives cancelled invoices — **phantom stock and unearned credit** | DB-01, FIN-03, FIN-04 | runtime (Phase 4 S11, S11b); direct UI path (Phase 7) |
| CF-005 | Any authenticated user can change VAT, loyalty values, ETA credentials and branches | HSEC-01, A-04, Z-01 | code (`index.ts:258-428` guards) |
| CF-006 | Renewal and dunning **charge a card again** after an ambiguous outcome or a failed post-charge write (2 charges, 1 record in every reproduced case) | BG-01, FIN-L1, DB-L01, FIN-P3, HSEC-27, L5-01 | runtime (Phase 5 S-F, X3, X5, X6; Phase 6 B, B2, J1, J2, H2) |
| CF-007 | Billing jobs act on stale state: dunning charges **already-paid or cancel-scheduled** periods; expiry overwrites payments | BG-03, DB-08, DB-19, DB-L03, DB-25, FIN-P7, L5-05, L5-06 | runtime (Phase 4 B4/B6/B7; Phase 5 S-A…S-H; Phase 6 F2, G) |

CF-006 and CF-007 are raised from P1 to **P0\***: they take customers' money twice. The deploy model makes the trigger routine — Docker kills the app before its 25 s drain (INFRA-04, observed at 3.1 s). Whether automated card billing is live is unknown (INFRA-07: production boots without Paymob; L6-01: the token-charge integration may not work at all). §4.2 explains the conditional rating.

### 1.4 Where the risk concentrates

| Root cause | High-severity canonical findings (P0, P0\*, P1) | Examples |
|---|---|---|
| RC-01 ad-hoc concurrency control | 6 | CF-007, CF-011…CF-015 |
| RC-10 authorization opt-in per route | 5 | CF-005, CF-020, CF-021, CF-022, CF-025 |
| RC-03 financial effects not recorded | 4 | CF-003, CF-018, CF-019, CF-027 |
| RC-02 implicit, multi-writer state model | 2 | CF-004 (with RC-03), CF-010 |
| RC-04 server doesn't own pricing | 3 | CF-001, CF-002, CF-017 |
| RC-06 no payment intent / outcome model | 3 | CF-006, CF-008, CF-009 |
| RC-08 unbounded waits and shared resources | 3 | CF-028, CF-029, CF-030 |
| Independent | 4 | CF-023, CF-033, CF-034, CF-035 |

The ordering matches Phase 4.5's conclusion, now extended with Phases 5–9. **Five root causes (RC-01, RC-03, RC-04, RC-06, RC-10) are the primary cause of 21 of the 35 P0/P0\*/P1 findings**; adding RC-02 and RC-08 brings it to 26. The other nine are spread over RC-05, RC-09, RC-11, RC-12, RC-13 and four independent defects (counts are by primary root cause, computed from the registry).

### 1.5 The plan in one paragraph

**W0** verifies the production facts and contains what can be contained without code. **W1** ships a safety net and fifteen small, independent fixes. **W2–W3** build the enablers and default-deny authorization. **W4–W5** remove the P0 money defects and the P1 races. **W6** rebuilds SaaS billing around a per-period payment intent; it is a release blocker only if card billing is live. **W7–W12** handle reporting, capacity, identity, lifecycle and recovery, ETA enablement and front-end hygiene. Waves are small enough to review and roll back one at a time (§7), and the true prerequisites are listed in §6. Do not start these before their prerequisite:

- **PgBouncer transaction pooling**, until all 24 raw-SQL sites are schema-qualified. Otherwise a raw query can run in another tenant's schema (CF-052).
- **Database constraint validation and data backfills**, until existing damage is measured and a restore has been rehearsed.
- **ETA auto-submission**, until the three ETA blockers are fixed.
- **Paymob call timeouts**, until a timeout can be recorded as an *unknown* outcome rather than a retryable failure.

### 1.6 What would justify a release decision

All of the following, with recorded evidence:

- the §4.5 release-blocker list closed by the §8 acceptance tests;
- the W0 verification results in hand (PV-01 … PV-10);
- a restore drill completed with a measured RPO/RTO;
- alerts proven to reach a person;
- for each residual risk in §10, a named owner who accepted it in writing.

Local benchmarks from Phase 9 are **not** production limits and must not be quoted as such.

---

## 2. Inventory of all phase reports

### 2.1 Reports read

| Phase | File (`documents/audit/`) | Date | Lines / H2 sections | Method | Runtime harness | IDs defined |
|---|---|---|---|---|---|---|
| 1 Discovery | `Hesba_Phase1_Discovery_Report.md` | 2026-10-08 | 864 / 23 | static discovery; two route-wiring reproductions | — | 79 observation IDs (§23.1, plus D-03a/b/c); 25 documentation discrepancies (§20); risk areas (§22) are priorities, not findings |
| 2 Security | `Hesba_Phase2_Security_Audit.md` | 2026-10-08 | 735 / 24 | static + library source; 2 reproductions | — | HSEC-01…29 (17 confirmed, 4 likely, 8 potential); U-01…12; controls C-01…10; attack paths AP-1…8 |
| 3 Financial | `Hesba_Phase3_Financial_Integrity_Audit.md` | 2026-10-08 | 1,016 / 35 | static + calculation script over the real pure helpers | calc script | FIN-01…24; FIN-L1…L3; FIN-P1…P9; U-01…09 |
| 4 Database / concurrency | `Hesba_Phase4_Database_Concurrency_Audit.md` | 2026-10-08 | 2,027 / 40 | runtime race harness | throwaway PostgreSQL 18.3: S1–S20, B1–B8, M1–M6, P1–P4 | DB-01…38; L-01…10, P-01…10, U-01…07 (renamed DB-L, DB-P, DB-U by Phase 4.5) |
| 4.5 Root causes | `Hesba_Phase4.5_Root_Cause_Consolidation.md` | 2026-10-08 | 1,388 / 35 | consolidation of Phases 1–4; static re-verification | inherited | RC-01…11; NEW-01; UV-01…10; 136 canonical findings + 2 corrections |
| 5 Background jobs | `Hesba_Phase5_Background_Jobs_Audit.md` | 2026-10-08 | 1,332 / 44 | real BullMQ workers, mock Paymob/Resend | PostgreSQL 16 + Redis 7 | BG-01…15; L5-01…06; P5-P01…04; U5-01…07 |
| 6 Integrations | `Hesba_Phase6_External_Integrations_Audit.md` | 2026-10-08 | 1,034 / 30 | provider mocks, signed webhooks, local presign | PostgreSQL 16 + Redis 7 | INT-01…09; L6-01…05; P6-P01…06; U6-01…10 |
| 7 Frontend / UX | `Hesba_Phase7_Frontend_UX_Audit.md` | 2026-10-12 | 709 / 17 | rendered flows on the real web build + API | PostgreSQL + Redis + Vite | UX-01…17; UX-L01…04; UX-P01…02; UX-U01…03 |
| 8 Infrastructure | `Hesba_Phase8_Infrastructure_Deployment_Audit.md` | 2026-10-12 | 620 / 18 | static config + dependency-failure runs | throwaway containers | INFRA-01…16; INFRA-L01…03; INFRA-P01…03; INFRA-U01…04 |
| 9 Performance | `Hesba_Phase9_Performance_Scalability_Audit.md` | 2026-10-12 | 783 / 18 | bounded local benchmarks, EXPLAIN | PostgreSQL 16 + Redis 7, synthetic 100k-invoice tenant | PERF-01…13; R-01…15 (tests) |

All ten reports describe the same commit. Phase 4.5 recorded that the two modified UI files predate every phase, so no phase audited a different tree.

### 2.2 Missing reports and incomplete evidence

| Gap | Effect on this consolidation |
|---|---|
| **No production evidence in any phase** (by design) | Every severity is about the code at `8846bce`. Exposure in production — whether a defect is live, how often it triggers, whether damage exists — is **unknown** until §9 is run |
| **Out-of-series audits not in `documents/audit/`.** The project memory notes record a 2026-06 seven-stage audit (including a fixed critical cross-tenant break, HESBA-SEC-01) and a 2026-09 remediation round with open PRs (#2 ETA payload, #4 password policy) | Not read and not used as evidence. Phase 2 C-01 and Phase 4.5 invariant #38 independently confirm that token↔tenant binding is enforced at `8846bce`, which is consistent with HESBA-SEC-01 being fixed. The open-PR status is PV-22 |
| **Phase 1 discovery IDs are observations, not findings** | Every Phase 1 ID that Phase 4.5 did not already merge is retained as its own canonical finding when it describes a defect, or as Info when it describes design (§3) |
| **Phase 4.5's "205 identifiers" cannot be reproduced exactly.** It counted documentation discrepancies and sub-IDs in a way its report does not list | Phase 10 recounted mechanically (§12.1). Every ID either report names is accounted for; the difference is in counting rules, not in coverage |
| **No rendered check of the 60,000-row stock table; no real devices, cold-cache IO, Paymob or ETA sandbox** (Phases 7–9 declarations) | Client-side impact of CF-139, provider behaviour (U5/U6 items) and cold-cache query times stay unverified |
| **Phase 2 attack paths AP-1…AP-8 and the "Top 10" lists** | Chains and summaries of existing findings, not new findings; used for prioritisation only |

---

## 3. Canonical finding registry

### 3.1 How the registry was built

1. **Start from Phase 4.5.** Its 136 canonical findings (Phases 1–4) were parsed from its §3 table together with every alias, severity and root cause.
2. **Attach Phases 5–9.** Each new ID was read in its own report and either:
   - merged into an existing finding, when that report itself says it confirms, refines or is the same defect as an earlier ID (e.g. BG-01 → FIN-L1; PERF-01 → DB-20; UX-01 → FIN-01; INT-04 → FIN-16), or
   - kept as a new canonical finding.
3. **Merge rule.** Two IDs are merged only when they describe the same mechanism in the same code path and are closed by the same change. Similar symptoms alone were never grounds for a merge (§3.3 lists the deliberate separations).
4. **Root and symptoms.** In each row the **bold** ID is the root defect, kept in its earliest or most fundamental formulation. The other IDs are its downstream symptoms, re-confirmations, UI manifestations or aliases.
5. **Mechanical check.** A script verified that each of the 309 finding-class IDs maps to exactly one canonical finding, or is recorded as split or rejected (§12.1).

**Columns:**
- **Prior sev (root):** the severity the earlier phases gave the root ID. `ᵃ` means the value was inherited through a Phase 4.5 alias.
- **Evidence:**
  - **RT**: reproduced at runtime in at least one phase (local harness);
  - **ST**: confirmed in code;
  - **LK**: likely;
  - **PO**: potential;
  - **OB**: design observation;
  - **+ENV**: production exposure depends on deployment facts (§9).
- **Release:**
  - **RB**: release blocker;
  - **RB\***: release blocker if the feature (automated card billing) is live in production, otherwise a feature gate;
  - **PR**: pre-release requirement (fix, or verify and accept, before release);
  - **CT**: containment needed now (§7, W0/W1);
  - **FG**: feature gate (blocks enabling a feature that is not core to release: automated billing, ETA, uploads, offline mode, PgBouncer);
  - **POST**: post-release.
- **Wave:** see §7.

### 3.2 Registry

| CF | Sev | Title | Root ID → symptoms / aliases | Reports | Prior sev (root) | Evidence | Root cause | Release | Wave |
|---|---|---|---|---|---|---|---|---|---|
| CF-001 | P0 | Server accepts client-supplied sale and installment line prices | **FIN-05** → HSEC-02, F-01 | P1, P2, P3 | P0 | ST | RC-04 | RB | W4 |
| CF-002 | P0 | POS and installment screens show and collect amounts that differ from the recorded invoice (no VAT line) | **FIN-01** → UX-01 | P3, P7 | P0 | RT | RC-04 | RB | W4 |
| CF-003 | P0 | Refunds mis-computed: line discount subtracted twice, order-level discounts ignored | **FIN-02** → F-04, UX-L02 | P1, P3, P7 | P0 | RT | RC-03 | RB | W5 |
| CF-004 | P0 | Pending installment invoices can be cancelled or returned; approval revives cancelled invoices (phantom stock, unearned credit) | **DB-01** → FIN-03, FIN-04 | P3, P4 | P0 | RT | RC-02,RC-03,RC-01 | RB | W5 |
| CF-005 | P0 | Tenant settings, VAT, loyalty values, ETA credentials and branches writable by any authenticated user | **HSEC-01** → A-04, Z-01 | P1, P2 | P0 | ST | RC-10 | RB | W3 |
| CF-006 | P0* | Renewal/dunning charge the card again when the outcome is ambiguous or the post-charge write fails | **BG-01** → FIN-L1, DB-L01, FIN-P3, HSEC-27, L5-01 | P2, P3, P4, P5 | P1 | RT+ENV | RC-06,RC-05,RC-08 | RB*,CT | W6 |
| CF-007 | P0* | Billing jobs act on stale state: dunning charges paid or cancel-scheduled periods; expiry and sweeps overwrite payments and admin actions | **BG-03** → DB-08, DB-19, DB-L03, DB-25, FIN-P7, L5-05, L5-06 | P3, P4, P5 | P1 | RT+ENV | RC-01,RC-02,RC-06 | RB*,CT | W6 |
| CF-008 | P1 | Subscription payment applied without verifying amount, currency or capture; rows store requested, not reported, values | **FIN-17** → B-01, B-04, FIN-L2, FIN-P6, INT-05 | P1, P3, P6 | P1 | RT | RC-06 | RB* | W6 |
| CF-009 | P1 | Webhook binds tenant and card token from unsigned fields (signed transaction can be re-addressed) | **HSEC-21** → L6-03 | P2, P6 | P1 | RT+LK | RC-06 | RB* | W6 |
| CF-010 | P1 | Subscription expiry depends on charging a card: unpaid trials and cardless ACTIVE subscriptions never expire or get blocked | **FIN-16** → HSEC-08, J-06, INT-04 | P1, P2, P3, P6 | P1 | RT+ENV | RC-02 | RB* | W6 |
| CF-011 | P1 | Store credit spendable twice; a negative balance then becomes a negative discount | **DB-02** → F-02, DB-P10 | P1, P4 | P1 | RT | RC-01 | RB | W5 |
| CF-012 | P1 | Installment approve/reject are unconditional: duplicate schedules, double stock decrement, lost reject | **DB-03** → IN-02, DB-04 | P1, P4 | P1 | RT | RC-01,RC-02 | RB | W5 |
| CF-013 | P1 | Double cancel applies every reversal twice | **DB-05** | P4 | P1 | RT | RC-01 | RB | W5 |
| CF-014 | P1 | Concurrent returns, or return plus cancel, over-refund and over-restock | **DB-06** | P4 | P1 | RT | RC-01 | RB | W5 |
| CF-015 | P1 | Purchase order received twice: received above ordered, supplier liability doubled | **DB-07** → PO-01 | P1, P4 | P1 | RT | RC-01 | RB | W5 |
| CF-016 | P1 | No idempotency on sales and other creates: retries, double submit, multi-tab and offline replay duplicate | **DB-10** → FIN-09, W-08, DB-L04, UX-14, UX-L04 | P1, P3, P4, P7 | P1 | RT | RC-05 | RB | W5 |
| CF-017 | P1 | Payment-fee vocabulary mismatch: seeded percentage fees compute as zero while the POS shows a fee | **FIN-06** → T-05 | P1, P3 | P1 | RT | RC-04,RC-09 | RB | W4 |
| CF-018 | P1 | Profit & loss misstates profit (tax as revenue, work orders counted twice, COGS not reversed) | **FIN-10** → WO-03 | P1, P3 | P1 | ST | RC-03 | PR | W7 |
| CF-019 | P1 | Day close and end-of-day totals do not match money received | **FIN-11** | P3 | P1 | RT | RC-03 | RB | W7 |
| CF-020 | P1 | Coupon and customer-credit authority granted by broad permissions held by cashiers | **HSEC-03** | P2 | P1 | ST | RC-10 | RB | W3 |
| CF-021 | P1 | Billing status, portal, cancel and resume open to any employee; portal returns the card token | **HSEC-04** → B-06 | P1, P2 | P1 | ST | RC-10 | RB | W3 |
| CF-022 | P1 | A tenant route runs the all-tenant reminder cycle outside the job lock | **HSEC-05** → J-08 | P1, P2 | P1 | RT | RC-10,RC-05 | RB,CT | W1 |
| CF-023 | P1 | Emails interpolate unescaped tenant data; receipt email accepts any recipient | **HSEC-06** → AU-10, INT-07 | P1, P2, P6 | P1 | RT | IND | RB | W1 |
| CF-024 | P1 | Users cannot be deactivated or re-roled, and their sessions cannot be revoked | **HSEC-07** → W-07 | P1, P2 | P1 | ST | RC-11 | RB | W9 |
| CF-025 | P1 | The seeded cashier role cannot complete any sale (payment methods require settings:read) | **UX-03** → T-06 | P1, P7 | P1 | RT | RC-10 | RB | W1 |
| CF-026 | P1 | Invoice details, return dialog and A4 tax invoice read fields the API never returns (blank names, NaN totals) | **UX-02** | P7 | P1 | RT | RC-09 | RB | W1 |
| CF-027 | P1 | Return dialog confirms without showing the refund amount; returned lines can be selected again | **UX-04** | P7 | P1 | RT | RC-03,RC-04 | RB | W5 |
| CF-028 | P1 | A Redis outage hangs every tenant request; boot blocks without Redis | **DB-09** → HSEC-28, BG-09 | P2, P4, P5 | P1 | RT+ENV | RC-08 | PR | W8 |
| CF-029 | P1 | PostgreSQL connection budget exceeded and never reclaimed; new and evicted tenants then fail | **PERF-01** → DB-20, INFRA-09 | P4, P8, P9 | P1 | RT+ENV | RC-08 | PR | W8 |
| CF-030 | P1 | Reports and exports build whole datasets in the shared API process (multi-second stalls for all tenants, GB-scale memory) | **PERF-02** | P9 | P1 | RT+ENV | RC-08 | PR | W7 |
| CF-031 | P1 | No backup, restore or disaster-recovery mechanism; never tested | **INFRA-01** | P8 | P1 | ST+ENV | RC-13 | PR,CT | W0 |
| CF-032 | P1 | No monitoring, alerting or error tracking | **INFRA-02** → A-08 | P1, P8 | P1 | ST+ENV | RC-12 | PR | W1 |
| CF-033 | P1 | Rate limits and audit IPs keyed to the proxy address (no trustProxy) | **HSEC-18** → INFRA-10 | P2, P8 | P1 | LK+ENV | IND | PR | W1 |
| CF-034 | P1 | Unauthenticated, unthrottled tenant signup (each call creates a schema) | **HSEC-19** → T-01 | P1, P2 | P1 | LK | IND,RC-07 | PR | W10 |
| CF-035 | P1 | TLS-issuance ask endpoint approves any subdomain | **HSEC-20** → A-02, INFRA-P03 | P1, P2, P8 | P1 | LK+ENV | IND | PR | W1 |
| CF-036 | P2 | Loyalty redemption arithmetic: discount not reduced to the floored points; 0-point redemption allowed | **FIN-12** | P3 | P1 | ST | IND,RC-04 | POST | W4 |
| CF-037 | P2 | Pending token charges treated as declines; recurring integration id and billing data likely wrong for token charges | **FIN-L3** → L6-01, P5-P04 | P3, P5, P6 | P2 | LK+ENV | RC-06 | FG | W6 |
| CF-038 | P2 | Provider refunds and voids ignored; FAILED-then-SUCCESS for one transaction drops the payment | **B-03** → DB-P01 | P1, P4 | P2 | RT | RC-06 | FG | W6 |
| CF-039 | P2 | No payment reconciliation; billing job records deleted | **BG-11** | P5 | P2 | ST | RC-06 | FG | W6 |
| CF-040 | P2 | Redis lock used as a progress record: an orphaned lock turns crash recovery into a no-op; owner-less release; ticks re-execute | **BG-02** → DB-L07, J-07, BG-10 | P1, P4, P5 | P2 | RT | RC-07 | FG | W6 |
| CF-041 | P2 | Outbound HTTP calls (Paymob, ETA, Resend) have no timeouts (~300 s hangs) | **BG-04** → B-07 | P1, P5 | P2 | RT | RC-08 | POST | W1 |
| CF-042 | P2 | Resend failures are silent; dedupe rows and counters written for undelivered email | **BG-05** → P6-P06 | P5, P6 | P2 | RT | IND | PR | W1 |
| CF-043 | P2 | /health reports ok with PostgreSQL or Redis down or tenant migrations failed; it is the deploy gate | **INFRA-03** → A-07, INFRA-L03 | P1, P8 | P2 | RT | RC-12,RC-07 | PR | W1 |
| CF-044 | P2 | Platform kills the app before its 25 s graceful shutdown completes | **INFRA-04** | P8 | P2 | RT | RC-08 | CT | W1 |
| CF-045 | P2 | Release model: no immutable artifact or rollback; migrations and plan seed at boot; traffic before tenant migrations; old and new run side by side | **INFRA-05** → D-06, DB-L02, INFRA-L01, INFRA-P02 | P1, P4, P8 | P2 | ST | RC-07 | POST | W10 |
| CF-046 | P2 | Redis is a single RDB-only store for sessions, queues, schedules and locks; schedules are not self-healing | **INFRA-06** → INFRA-L02, BG-12, P5-P01 | P5, P8 | P2 | RT | RC-13 | POST | W10 |
| CF-047 | P2 | Production boots without critical integration configuration | **INFRA-07** | P8 | P2 | RT | IND | PR | W1 |
| CF-048 | P2 | Production secrets file is not git-ignored or docker-ignored | **INFRA-08** | P8 | P2 | ST | IND | CT | W1 |
| CF-049 | P2 | Invoice list aggregates every invoice item and sorts the whole table on each page view | **PERF-05** | P9 | P2 | RT | RC-08 | POST | W8 |
| CF-050 | P2 | Sales report and its Excel export silently contain only the latest 500 invoices | **PERF-03** | P9 | P2 | RT | RC-03 | PR | W1 |
| CF-051 | P2 | Password hashing runs on the event loop; concurrent logins stall every tenant | **PERF-04** | P9 | P2 | RT | RC-08 | POST | W8 |
| CF-052 | P2 | Transaction-mode pooling would run unqualified raw SQL in another tenant's schema | **PERF-11** | P9 | P2 | PO | RC-08,RC-09 | FG | W8 |
| CF-053 | P2 | Tenant migration version bumped outside the DDL transaction; three files cannot be re-run | **DB-21** → D-05 | P1, P4 | P2 | RT | RC-07 | POST | W10 |
| CF-054 | P2 | A crash mid-provisioning leaves an orphan tenant that blocks re-registration | **DB-22** | P4 | P2 | RT | RC-07 | POST | W10 |
| CF-055 | P2 | ETA raw SQL references columns no migration creates | **DB-23** → E-01 | P1, P4 | P2 | RT | RC-09 | FG | W11 |
| CF-056 | P2 | ETA raw SQL compares uuid columns with text parameters; the only entry route fails before enqueuing | **INT-01** | P6 | P2 | RT | RC-09 | FG | W11 |
| CF-057 | P2 | ETA document does not represent the sale | **INT-02** | P6 | P2 | RT | RC-03,RC-09 | FG | W11 |
| CF-058 | P2 | ETA outcomes misclassified; no per-invoice dedupe, state re-check or status sync | **INT-03** → BG-08, DB-P09, FIN-P5, L6-05, P6-P02 | P3, P4, P5, P6 | P2 | RT | RC-05,RC-02 | FG | W11 |
| CF-059 | P2 | ETA submissions are never enqueued automatically | **E-02** | P1 | P2 | ST | IND | FG | W11 |
| CF-060 | P2 | Cancel does not reverse fee expense, external financing or ETA | **F-05** | P1 | P2 | ST | RC-03 | POST | W5 |
| CF-061 | P2 | Product discounts unbounded; line subtotal not clamped | **FIN-13** | P3 | P2 | ST | IND | POST | W4 |
| CF-062 | P2 | Product discounts cannot be created from the UI (date string → 500) | **UX-09** | P7 | P2 | RT | RC-09 | POST | W4 |
| CF-063 | P2 | Coupon minimum enforced only in the browser | **FIN-14** | P3 | P2 | ST | RC-04 | POST | W4 |
| CF-064 | P2 | Split payments stored unvalidated and mis-reported | **FIN-15** | P3 | P2 | ST | RC-03,RC-04 | POST | W5 |
| CF-065 | P2 | Customer credit and loyalty ledger lives in JSON audit rows (irreconcilable; cancel scans the history) | **FIN-19** → F-03, DB-30 | P1, P3, P4 | P2 | RT | RC-03 | POST | W5 |
| CF-066 | P2 | Cancelling a sale after its earned points were spent drives loyalty negative | **DB-17** | P4 | P2 | RT | RC-03,RC-01 | POST | W5 |
| CF-067 | P2 | Installment model gaps: no overdue or settlement states; invoice paid amount frozen at the down payment | **FIN-20** → IN-04, IN-03 | P1, P3 | P2 | ST | RC-02 | POST | W5 |
| CF-068 | P2 | Deactivated products remain sellable via the API | **FIN-21** | P3 | P2 | ST | IND | POST | W4 |
| CF-069 | P2 | Historical values move (names, tax rate, pre-017 cost read live) | **FIN-22** | P3 | P2 | ST | RC-03 | POST | W7 |
| CF-070 | P2 | Stock transfer approved twice moves stock twice | **DB-11** → S-07 | P1, P4 | P2 | RT | RC-01 | POST | W5 |
| CF-071 | P2 | Concurrent receipts compute weighted-average cost from stale data | **DB-12** | P4 | P2 | RT | RC-01 | POST | W5 |
| CF-072 | P2 | One work order can produce two invoices | **DB-13** | P4 | P2 | RT | RC-01 | POST | W5 |
| CF-073 | P2 | Work-order payments lose updates and have no upper bound | **DB-14** | P4 | P2 | RT | RC-01 | POST | W5 |
| CF-074 | P2 | Manual credit adjustment overwrites concurrent balance changes | **DB-15** → CU-01 | P1, P4 | P2 | RT | RC-01 | POST | W5 |
| CF-075 | P2 | Concurrent PO payments overpay the order | **DB-16** | P4 | P2 | RT | RC-01 | POST | W5 |
| CF-076 | P2 | Multi-line sales deadlock (locks in client order, no retry) | **DB-18** → DB-L09 | P4 | P2 | RT | RC-01 | POST | W5 |
| CF-077 | P2 | Admin plan change updates the tenant plan only, not the subscription | **P-04** | P1 | P2 | ST | RC-02 | POST | W6 |
| CF-078 | P2 | Two suspension mechanisms; reminders still sent for cancelled or suspended tenants | **P-05** → BG-07 | P1, P5 | P2 | RT | RC-02 | POST | W6 |
| CF-079 | P2 | Imports unreachable (multipart parser not registered → 415) | **S-03** | P1 | P2 | RT | IND | POST | W12 |
| CF-080 | P2 | Offline mode blocked by paused mutations; the queue replays under the next user | **UX-05** | P7 | P2 | RT | RC-05 | FG | W12 |
| CF-081 | P2 | Financial summaries stale after sales and returns (no mutation-driven invalidation) | **UX-06** | P7 | P2 | RT | IND | POST | W12 |
| CF-082 | P2 | No business time zone: UTC 'today' in the UI, UTC date in invoice numbers, reminder window on process TZ | **UX-07** → BG-14, DB-38 | P4, P5, P7 | P2 | RT | RC-14 | POST | W12 |
| CF-083 | P2 | Subscription states misrepresented: HTTP 402 unhandled; 'renews in 0 days' banner | **UX-08** | P7 | P2 | RT | IND | POST | W6 |
| CF-084 | P2 | Printed tax invoice identifies the platform, not the store, and has no tax registration number | **UX-L01** | P7 | P2 | LK | IND | PR | W12 |
| CF-085 | P2 | Password-reset and checkout email links target routes that do not exist | **HSEC-15** → AU-11 | P1, P2 | P3 | RT | IND | PR | W1 |
| CF-086 | P3 | Precision and presentation inconsistencies (JS-number paths, display rounding, mixed discount components) | **FIN-18** → F-07 | P1, P3 | P2 | ST | RC-04,RC-03 | POST | W4 |
| CF-087 | P3 | Decline and renewal counters conflated and set absolutely; thresholds hit valid trials | **DB-37** → B-05, DB-24, P5-P03 | P1, P4, P5 | P3 | RT | RC-02,RC-01 | POST | W6 |
| CF-088 | P3 | Several subscriptions per tenant allowed; webhook findFirst unordered | **DB-P02** → B-02, D-01, FIN-P4, P5-P02, P6-P05 | P1, P3, P4, P5, P6 | P3 | PO | RC-02 | POST | W6 |
| CF-089 | P3 | Trial expiry has no per-row isolation and no retries | **BG-13** | P5 | P3 | ST | RC-07 | POST | W6 |
| CF-090 | P3 | Webhook robustness: no type dispatch, malformed body → 500, hard-coded iframe host | **INT-08** → P6-P01 | P6 | P3 | RT | IND | POST | W6 |
| CF-091 | P3 | Reminder dedupe is check-then-send (overlapping runs send twice) | **DB-26** | P4 | P3 | RT | RC-05 | POST | W1 |
| CF-092 | P3 | Reminder sent for an installment paid during the cycle | **BG-06** | P5 | P3 | RT | RC-01 | POST | W1 |
| CF-093 | P3 | Job observability and retention insufficient for financial forensics | **BG-15** | P5 | P3 | ST | RC-12 | POST | W1 |
| CF-094 | P3 | Cron jobs and boot migrations walk every tenant serially through the request LRU | **PERF-12** → L5-04 | P5, P9 | P3 | PO | RC-08 | POST | W8 |
| CF-095 | P3 | ETA worker trusts schemaName from the job payload | **L5-02** | P5 | P3 | LK | IND | FG | W11 |
| CF-096 | P3 | New BullMQ Queue per ETA enqueue (heap and listener growth) | **L5-03** | P5 | P3 | RT | IND | FG | W11 |
| CF-097 | P3 | ETA configuration: environment dropped by settings PATCH, split environment logic, unvalidated secrets, unversioned key | **E-07** → INT-09, P6-P03 | P1, P6 | P3 | ST | RC-09 | FG | W11 |
| CF-098 | P3 | LRU eviction disconnects a tenant client mid-transaction | **DB-29** → C-03 | P1, P4 | P3 | RT | RC-08 | POST | W8 |
| CF-099 | P3 | Default transaction limits, pool of 5, no database timeouts | **DB-31** → FIN-P9 | P3, P4 | P3 | RT | RC-08 | POST | W8 |
| CF-100 | P3 | approveContract uses the base client inside its transaction (two connections per approval) | **DB-28** → DB-P08 | P4 | P3 | RT | IND | POST | W5 |
| CF-101 | P3 | The same installment row can be paid twice | **DB-27** | P4 | P3 | RT | RC-01 | POST | W5 |
| CF-102 | P3 | CHECK constraints NOT VALID; no credit, loyalty, received or paid CHECKs | **D-04** → FIN-P8 | P1, P3 | P3 | ST | RC-01 | POST | W5 |
| CF-103 | P3 | Plan limits are count-then-create and counted on every create | **DB-L08** → PERF-10 | P4, P9 | P3 | LK | RC-01 | POST | W8 |
| CF-104 | P3 | Return restock with no stock row logs a movement that changed nothing | **DB-P06** | P4 | P3 | PO | RC-03 | POST | W5 |
| CF-105 | P3 | Cancelling a work-order invoice never clears the work-order link | **NEW-01** | P4.5 | P3 | ST | RC-02 | POST | W5 |
| CF-106 | P3 | A cancelled work order can still be invoiced | **DB-36** | P4 | P3 | ST | RC-02 | POST | W5 |
| CF-107 | P3 | Work-order invoices use settings VAT and SVC numbers, skip ETA and the invoice limit | **WO-02** | P1 | P3 | ST | IND | POST | W5 |
| CF-108 | P3 | Tenant cache stale write-back after invalidation | **DB-L05** | P4 | P3 | LK | IND | POST | W8 |
| CF-109 | P3 | Reports read several snapshots | **DB-P05** | P4 | P3 | PO | IND | POST | W7 |
| CF-110 | P3 | Migration sweep skips CANCELLED tenants; pending files computed before the lock | **DB-L10** → DB-P03 | P4 | P3 | LK | RC-07 | POST | W10 |
| CF-111 | P3 | Provisioning rollback leaves the Redis tenant cache and LRU client behind | **DB-P07** | P4 | P3 | PO | RC-07 | POST | W10 |
| CF-112 | P3 | installment_payments.payment_method_id exists in SQL but not in Prisma (never written) | **DB-32** → D-03a | P1, P4 | P3 | RT | RC-09 | POST | W5 |
| CF-113 | P3 | Customer statement export queries a column that does not exist | **DB-33** → CU-03 | P1, P4 | P3 | RT | RC-09 | POST | W12 |
| CF-114 | P3 | Prisma tenant model differs from the SQL schema | **DB-34** → D-03, D-03b, D-03c | P1, P4 | P3 | RT | RC-09 | POST | W2 |
| CF-115 | P3 | tenant_settings singleton not enforced | **DB-P04** | P4 | P3 | PO | RC-09 | POST | W2 |
| CF-116 | P3 | Deletes that destroy history (coupons, admin audit cascade, pre-existing schema drop) | **DB-35** | P4 | P3 | ST | IND | POST | W12 |
| CF-117 | P3 | Refresh sessions: non-atomic rotation, no reuse detection, unlimited sliding lifetime | **HSEC-10** → DB-L06 | P2, P4 | P3 | ST | RC-11 | POST | W9 |
| CF-118 | P3 | Role and permission claims read from the JWT and never reloaded | **M-02** | P1 | P3 | ST | RC-11 | POST | W9 |
| CF-119 | P3 | Password reset scans every session on the platform with one Redis round trip per key | **PERF-07** | P9 | P3 | RT | RC-11 | POST | W9 |
| CF-120 | P3 | Permission model inconsistencies; UI offers actions the server refuses | **HSEC-12** → Z-02, F-06, UX-10 | P1, P2, P7 | P3 | RT | RC-10 | POST | W3 |
| CF-121 | P3 | Plan entitlements not enforced; conflicting limits | **HSEC-13** → Z-03, Z-04 | P1, P2 | P3 | ST | RC-10 | POST | W3 |
| CF-122 | P3 | Cost price and full subscription rows exposed to broad roles | **HSEC-14** → S-05, P-03 | P1, P2 | P3 | ST | RC-10 | POST | W3 |
| CF-123 | P3 | No branch-level authorization | **HSEC-26** | P2 | P3 | PO | RC-10 | POST | W3 |
| CF-124 | P3 | Account enumeration via login timing | **HSEC-09** | P2 | P3 | ST | IND | POST | W9 |
| CF-125 | P3 | URL-fragment session restored without verification | **HSEC-11** → W-03 | P1, P2 | P3 | ST | IND | POST | W9 |
| CF-126 | P3 | Cookie clearing omits the cookie domain | **HSEC-17** → AU-03 | P1, P2 | P3 | ST | IND | POST | W9 |
| CF-127 | P3 | Refresh does not compare the stored tenantId with the resolved tenant | **AU-02** | P1 | P3 | OB | IND | POST | W9 |
| CF-128 | P3 | Forgot-password counter keyed by email across tenants | **AU-05** | P1 | P3 | ST | IND | POST | W9 |
| CF-129 | P3 | Admin refresh unthrottled | **P-01** | P1 | P3 | ST | IND | POST | W9 |
| CF-130 | P3 | Platform owner re-seeded and re-activated from environment variables at every boot | **P-07** → INFRA-11 | P1, P8 | P3 | ST | IND | POST | W10 |
| CF-131 | P3 | Admin access token persisted in localStorage | **HSEC-24** → W-04 | P1, P2 | P3 | PO | IND | POST | W9 |
| CF-132 | P3 | run-migrations admin route never completes | **HSEC-16** → P-02 | P1, P2 | P3 | RT | IND | POST | W1 |
| CF-133 | P3 | Unescaped document.write print sinks (CSP-mitigated) | **HSEC-22** → W-06 | P1, P2 | P3 | PO | IND | POST | W12 |
| CF-134 | P3 | Subdomain trust model amplifies any XSS | **HSEC-23** | P2 | P3 | PO | IND | POST | W9 |
| CF-135 | P3 | Reset tokens and payment redirect parameters can reach analytics or logs | **HSEC-25** → L6-02 | P2, P6 | P3 | PO+ENV | IND | POST | W12 |
| CF-136 | P3 | R2 uploads: no type or size bound, empty-body checksum, one bucket for public and private data, permanent public URLs | **HSEC-29** → CU-02, S-02, INT-06, L6-04, P6-P04 | P1, P2, P6 | P3 | RT | IND | FG | W12 |
| CF-137 | P3 | Search uses leading-wildcard ILIKE across joins; invoice search truncates at 200 matches | **PERF-06** | P9 | P3 | RT | RC-08 | POST | W8 |
| CF-138 | P3 | No response compression; SPA served by the API with max-age=0 | **PERF-08** | P9 | P3 | ST | RC-08 | POST | W8 |
| CF-139 | P3 | Stock report table renders every row; visible dashboards poll heavy endpoints | **PERF-09** | P9 | P3 | ST | RC-08 | POST | W7 |
| CF-140 | P3 | New branches get no stock rows | **S-01** | P1 | P3 | ST | IND | POST | W12 |
| CF-141 | P3 | Low-stock filter applied after pagination | **S-09** | P1 | P3 | ST | IND | POST | W12 |
| CF-142 | P3 | Tenant emails stored un-normalised | **T-03** | P1 | P3 | ST | IND | POST | W12 |
| CF-143 | P3 | Signup response hard-codes a localhost login URL | **T-04** | P1 | P3 | ST | IND | POST | W12 |
| CF-144 | P3 | Installment math test re-implements the formula | **IN-05** | P1 | P3 | ST | IND | POST | W2 |
| CF-145 | P3 | Minor financial items (Phase 3 FIN-24) | **FIN-24** | P3 | P3 | ST | IND | POST | W12 |
| CF-146 | P3 | VAT computed before the order-level coupon (tax rule unconfirmed) | **FIN-P1** | P3 | P3 | PO | IND | POST | W4 |
| CF-147 | P3 | Non-base currency amounts stored unconverted | **FIN-P2** | P3 | P3 | PO | IND | POST | W12 |
| CF-148 | P3 | Master data-fix migrations hard-code one tenant | **D-07** | P1 | P3 | ST | IND | POST | W10 |
| CF-149 | P3 | No migration_lock.toml | **D-08** | P1 | P3 | ST | IND | POST | W10 |
| CF-150 | P3 | Build reproducibility and supply-chain controls weak; Prisma CLI version may drift | **INFRA-12** → INFRA-P01 | P8 | P3 | ST | IND | POST | W10 |
| CF-151 | P3 | Log retention and shipping not configured | **INFRA-13** | P8 | P3 | ST | RC-12 | POST | W10 |
| CF-152 | P3 | Railway restart policy gives up after three failures | **INFRA-14** | P8 | P3 | ST+ENV | IND | POST | W10 |
| CF-153 | P3 | Frontend base domain baked at build time from a committed production file | **INFRA-15** | P8 | P3 | ST | IND | POST | W10 |
| CF-154 | P3 | Auxiliary configs stale or unsafe if reused | **INFRA-16** | P8 | P3 | ST | IND | POST | W10 |
| CF-155 | P3 | Error mapping exposes raw codes; one unhandled rejection | **UX-11** | P7 | P3 | RT | RC-09 | POST | W12 |
| CF-156 | P3 | Money formatting inconsistent | **UX-12** | P7 | P3 | RT | IND | POST | W12 |
| CF-157 | P3 | Responsive layout defects (Settings overflow, POS checkout below the fold) | **UX-13** | P7 | P3 | RT | IND | POST | W12 |
| CF-158 | P3 | Session expiry or a hung request loses the POS cart and form state | **UX-15** → UX-P02 | P7 | P3 | ST | IND | POST | W12 |
| CF-159 | P3 | Loyalty points can be earned but not redeemed from any screen | **UX-16** | P7 | P3 | ST | IND | POST | W4 |
| CF-160 | P3 | Accessibility labelling gaps | **UX-17** → UX-P01 | P7 | P3 | ST | IND | POST | W12 |
| CF-161 | P3 | Store VAT toggle and timezone settings have no effect | **UX-L03** | P7 | P3 | LK | RC-14 | POST | W12 |
| CF-162 | Info | One process runs HTTP, the SPA and all five workers | **A-01** | P1 | P3 | OB | RC-08 | POST | W8 |
| CF-163 | Info | Dashboard caches today's revenue for 120 s without invalidation (acceptable if labelled) | **PERF-13** | P9 | Info | ST | IND | POST | W7 |
| CF-164 | Info | One cost per variant across branches (weighted average is global) | **S-08** | P1 | P3 | OB | IND | POST | — |
| CF-165 | Info | Dockerfile comment says node, CMD runs tsx | **I-01** | P1 | INFO | ST | IND | POST | W10 |
| CF-166 | Info | Tenant resolved from host; header fallback on system hosts | **M-01** | P1 | INFO | OB | IND | POST | — |
| CF-167 | Info | Platform admins see tenant row counts only | **P-06** | P1 | INFO | OB | IND | POST | — |

### 3.3 Merge decisions that differ from, or extend, Phase 4.5

| Decision | IDs | Basis |
|---|---|---|
| Later-phase re-confirmations merged into the earlier root | BG-01 → FIN-L1 (+DB-L01, FIN-P3, HSEC-27); BG-03 → DB-19, DB-L03 (+DB-08, DB-25); UX-01 → FIN-01; INT-04 → FIN-16; PERF-01 → DB-20 (+INFRA-09); BG-04 → B-07; BG-09 → DB-09; INT-07 → HSEC-06; INFRA-10 → HSEC-18; INFRA-P03 → HSEC-20; INFRA-03 → A-07 (+INFRA-L03); INFRA-02 → A-08 | each later report states the merge itself: Phase 5 §37.1/§37.3; Phase 6 §21.1/§25; Phase 7 §1, §10; Phase 8 §13–14; Phase 9 §12 |
| **The root is the later ID** where the later phase found the broader mechanism | BG-01 is the root of CF-006 (FIN-L1 was the likely half); BG-03 of CF-007; PERF-01 of CF-029; INFRA-02 of CF-032; INFRA-03 of CF-043; INFRA-05 of CF-045 | the later phase reproduced the full chain at runtime |
| DB-08 (dunning selection) merged into CF-007 instead of standing alone | DB-08, DB-19, DB-25, DB-L03, FIN-P7, L5-05, L5-06 | Phase 5 §37.4: DB-08 is a symptom of RC-06 + RC-01, and "fixing only the selection predicate would still leave S-B and S-D1 open" |
| Pool self-deadlock merged into its cause | DB-P08 → DB-28 (CF-100) | Phase 4 §35 P-08: the second connection comes from the base client (DB-28) |
| Negative-discount path merged into credit double-spend | DB-P10 → DB-02 (CF-011) | Phase 4 DB-02 impact text names P-10 as the consequence of the negative balance |
| Lock-as-progress-record family | BG-02 (root), DB-L07, J-07, BG-10 (CF-040) | Phase 5 §41 #4 closes BG-02, DB-L07 and BG-10 with one change |
| Business time zone | UX-07 (root), BG-14, DB-38 (CF-082); UX-L03 separate (CF-161) | Phase 7 §14 #7 closes UX-07 and DB-38 with one tenant-timezone utility; BG-14 is the same process-TZ dependence (Phase 5) |
| Idempotency, UI angle | UX-14, UX-L04 → DB-10 (CF-016) | Phase 7 §1 root-cause list: UX-14 is RC-05 |
| **Reassigned alias** T-06: Phase 4.5 put it under HSEC-12 | T-06 → UX-03 (CF-025) | Phase 7 §13 raised the exact T-06 defect (cashier can't list payment methods) to P1 at runtime; HSEC-12 keeps the other inconsistencies |
| **Primary placement of split aliases** | IN-03 → CF-067 (FIN-20); D-03a → CF-112 (DB-32); F-06 → CF-120 (HSEC-12; its branchId half is CF-123); F-03 → CF-065 (with DB-30); FIN-P3 and HSEC-27 → CF-006 (their lock half is CF-040) | Phase 4.5 §4 split these across rows; one primary home per ID keeps traceability unambiguous, and the related CF is named here |
| Observation reclassified | S-08 (P3 OB → Info, CF-164) | a design choice (one weighted-average cost per variant); no defect claimed in any phase |

**Kept separate on purpose** (same workflow, different root causes or fixes):
- **CF-004 vs CF-012:** *which* transition is legal (RC-02) vs making it happen once (RC-01). This is Phase 4.5's separation.
- **CF-022 vs CF-091:** cross-tenant authorization vs check-then-send deduplication.
- **CF-036 vs CF-066:** redemption arithmetic vs reversal.
- **CF-003 vs CF-027:** the server formula vs the UI that never shows the amount. CF-027 also covers re-selectable returned lines and raw errors.
- **CF-055 vs CF-056:** missing columns vs uuid = text. Phase 6 shows INT-01 fails independently of DB-23.
- **CF-008 vs CF-009:** amount verification vs tenant binding. One change closes both, but they are different defects with different impact.
- **CF-061 vs CF-062:** validation vs the UI crash. They are co-requisites (§6).
- **CF-029 vs CF-052:** the connection problem vs the hazard in its most common fix.

---

## 4. Severity reassessment and release-blocker list

### 4.1 Rubric

Severity is assessed on the **code at `8846bce`**, weighing:
- financial loss or misstatement;
- tenant isolation;
- security;
- data integrity;
- recoverability;
- service availability;
- user-visible correctness.

Exposure in production is recorded separately (**+ENV**). An unverified deployment fact never *raises* a severity silently; where it could, the finding is marked conditional.

| Severity | Criterion |
|---|---|
| **P0** | Confirmed defect that, in normal use by an ordinary user or employee, loses or misstates money, crosses a tenant boundary, or lets any user change financially or legally relevant configuration |
| **P0\*** | P0 conditions met once a specific feature is live in production (here: automated card billing). Until that is verified the item is handled as P1 plus a feature gate, and containment is still required |
| **P1** | Confirmed or likely defect with significant financial, security, availability or core-workflow impact that needs concurrency, a failure, an insider or a deployment condition to trigger; or a missing operational capability (backups, monitoring) that makes other failures unrecoverable or invisible |
| **P2** | Bounded financial or availability impact, an incorrect but non-core workflow, or a blocker for a feature that is not live (ETA, uploads, offline) |
| **P3** | Hygiene, hardening, latent or low-impact defects |
| **Info** | Design observations; no action required beyond awareness |

Merged findings take the severity of their root, and never less than the highest severity any merged ID was given unless §4.2 says otherwise. This is Phase 4.5's rule, kept.

### 4.2 Severity changes made in this phase

| CF | IDs | Prior | Phase 10 | Evidence-based reason |
|---|---|---|---|---|
| CF-006 | BG-01, FIN-L1 … | P1 | **P0\*** | Two charges and one record in **every** reproduced ambiguous outcome (Phase 5 S-F, X3, X5, X6; Phase 6 B, B2, J1, J2, H2). The trigger is routine: Docker kills the app before its drain (INFRA-04), so a deploy during a cycle is enough. Customer money is taken twice. Conditional on automated card billing being live (PV-10), because INFRA-07 shows production can boot without Paymob and L6-01 suggests token charges may not work at all |
| CF-007 | BG-03, DB-08, DB-19 … | P1 | **P0\*** | Dunning charges periods that are already paid or cancel-scheduled (Phase 4 B4, B7; Phase 5 S-B, S-D1…S-D3; Phase 6 G); trial expiry overwrites a fresh payment and then leads to a second charge (Phase 5 S-A). Same condition as CF-006 |
| CF-036 | FIN-12 | P1 | **P2** | The redemption arithmetic is wrong, but loyalty can't be redeemed from any screen (UX-16, Phase 7), and Phase 3 rated it LOW with default settings. The remaining exposure is API-only and bounded by the 50 % cap. It rises again if a redemption UI ships (dependency in §6) |
| CF-085 | HSEC-15, AU-11 | P3 | **P2** | Phases 6 and 7 confirmed that the e-mailed `/reset?token=` link lands on the catch-all route, so **password reset by e-mail is impossible** for every user. That is account recovery broken platform-wide, not a cosmetic link |
| CF-086 | FIN-18, F-07 | P2 | **P3** | Phase 3 calc §9: the JS-number paths are absorbed by 4-dp rounding and change no financial outcome, except loyalty earning (handled with CF-036). What remains is presentation and the mixed storage of discount components |
| CF-164 | S-08 | P3 (OB) | **Info** | A design choice (one global weighted-average cost); no phase claims a defect |

**Reviewed and deliberately not changed:**
- **CF-001** (client prices): exploitable today through the installment form's editable price (Phase 7), and through the API by any user with `invoices:create`.
- **CF-005** (settings authorization): insider-only, but any cashier can change VAT and loyalty values that every sale uses.
- **CF-018** (P&L): stays P1, but is a pre-release requirement rather than a blocker. It misstates; it does not move money.
- **CF-028**, **CF-029**, **CF-030**: P1 with +ENV. The mechanisms are confirmed locally, the production thresholds are unknown, and Phase 9's numbers are not production limits.
- **CF-031** (no backups): P1, and P0\* in effect if PV-04 shows the provider has no backups either.
- **CF-033 … CF-035**: P1 as likely; each needs a deployment fact (PV-01, PV-14) to confirm.
- **INT-04** (inside CF-010): becomes P1 on its own if U6-01 shows Paymob's callback never carries the card token.

### 4.3 Conflicts between reports and how they were resolved

| # | Conflict | Sources | Resolution | Status |
|---|---|---|---|---|
| 1 | **Fix connection exhaustion with PgBouncer in transaction mode** vs **transaction mode runs unqualified raw SQL under another tenant's `search_path`** | for: `apps/api/src/config/database.ts:11-15` comment; Phase 4.5 RC-08 design (3) "or PgBouncer in transaction mode"; Phase 8 §15 #9 "a pooler". Against: Phase 9 PERF-11 (24 unqualified raw-SQL sites; the 5.22 engine sets `search_path` per connection) and Phase 4.5's own caveat (the migration runner's session advisory lock) | Transaction pooling is allowed **only after** raw SQL is schema-qualified (or scoped with `SET LOCAL`) **and** the migration lock no longer needs a pinned session. Both pieces of evidence are in the reports; nothing supports the unconditional recommendation | **Resolved** (§6 T-18) |
| 2 | Presigned upload "content type pinned in the signature" vs "only `host` is signed" | Phase 2 §14 (static) vs Phase 6 §10 (runtime, installed SDK) | Runtime evidence wins; HSEC-29 corrected | Resolved |
| 3 | FIN-01 "excludes VAT **and product discounts**" vs product discounts cannot be created from the UI | Phase 3 vs Phase 7 §13 | The VAT part alone is P0 and runtime-confirmed. The product-discount part arises only from data created outside the UI. It becomes reachable when CF-062 is fixed, which is why CF-061/062 are co-requisites | Resolved |
| 4 | "The POS UI never edits prices" vs the installment form exposes an editable unit price | Phase 2 §5.2 vs Phase 7 §13 (`Installments.tsx:449`) | Phase 7 is correct; CF-001 has a direct UI path | Resolved |
| 5 | Cashier cannot list payment methods: unrated functional note vs P1 | Phase 2 §5.1 vs Phase 7 UX-03 | Runtime confirms that a cashier cannot sell at all; P1 (CF-025) | Resolved |
| 6 | Re-charge risk P1 (FIN-L1) vs P2 (DB-L01) | Phase 3 vs Phase 4 | Phase 4.5 normalised it to P1; Phase 5 confirmed it; Phase 10 rates it P0\* (§4.2) | Resolved |
| 7 | DB-19 P2 vs P1 | Phase 4 vs Phase 5 §37.3 | Phase 5 shows the chain continues into a second charge; P1, absorbed into CF-007 | Resolved |
| 8 | "Money passes through JS numbers" (risk) vs "harmless except loyalty earning" | Phase 1 F-07 vs Phase 3 calc §9 | Phase 3's calculation evidence wins (CF-086 P3) | Resolved |
| 9 | FIN-12 P1 vs bounded exposure | Phase 3 / 4.5 vs Phase 7 UX-16 | P2 (§4.2) | Resolved |
| 10 | HSEC-15 LOW vs runtime "reset impossible" | Phase 2 vs Phases 6, 7 | P2 (§4.2) | Resolved |
| 11 | INT-04 P2 vs "P1 if U6-01" | Phase 6 | Needs the Paymob callback contents | **Open** (PV-10) |
| 12 | INFRA-01 P1 vs possible P0 | Phase 8 (no backups in the repo; provider snapshots unknown) | Needs the provider console | **Open** (PV-04) |
| 13 | Docker stop timeout 10 s (documented) vs 3.1 s (observed) | Phase 8 | Both are shorter than the 25 s drain, so the conclusion stands. The production value is unknown | Open (PV-01) |
| 14 | Phase 4 harness PostgreSQL 18.3 vs production PostgreSQL 16 | Phase 4 U-06 | Phases 5–9 reproduced the key effects on PostgreSQL 16. The race windows remain local lower bounds | Partly resolved (PV-19) |
| 15 | Phase 4.5's "205 identifiers" vs Phase 10's mechanical count | Phase 4.5 §1 vs §12.1 | A counting-rule difference (documentation discrepancies and sub-IDs). No ID named in any report is unaccounted for | Resolved |

### 4.4 Corrections, rejections and deliberate exclusions carried forward

| Type | Item | Source | Effect |
|---|---|---|---|
| **Rejected** | FIN-23 "WAC treats zero cost as unset" | Phase 4.5 §31 #1 (`cost.test.ts:10-13` asserts the behaviour) | not a defect; a product question at most |
| **Rejected** | FIN-20 sub-claim "last two installments paid concurrently leave the contract active" | Phase 4 §31 (S5b, 20/20) | removed; the rest of FIN-20 stands (CF-067) |
| **Split** | FIN-07 → DB-03, DB-05, DB-06, DB-07, DB-11, DB-13; FIN-08 → DB-02, DB-14, DB-15, DB-16, DB-24 | Phase 4.5 §4 | traced through the split IDs (§12) |
| Corrected (scope) | HSEC-29: the content type is not pinned | Phase 6 §25 | CF-136 |
| Corrected (scope) | F-07: the float paths are harmless except loyalty earning | Phase 3 §31 | CF-086 |
| Corrected (scope) | HSEC-03: the float aspect of the credit adjustment is harmless; the lost update stands | Phase 3 §31 | CF-074 |
| Corrected (scope) | Phase 1 §8.15 "POS preview; server authoritative" understates that the POS figure is what the customer is asked to pay | Phase 3 §31 | CF-002 |
| Corrected (scope) | Phase 1 §9 "cancel → increment" restores stock that never left for pending installment invoices | Phase 3 §31 | CF-004 |
| Corrected (scope) | FIN-01's product-discount half is unreachable through the UI today | Phase 7 §13 | CF-002 |
| Corrected (scope) | HSEC-02 framing (installment form has an editable price) | Phase 7 §13 | CF-001 |
| Corrected (scope) | Phase 2 cashier payment-method note raised to P1 | Phase 7 §13 | CF-025 |
| Corrected (scope) | A double transfer happens only when the source holds ≥ 2× the quantity; otherwise the CHECK returns a raw 23514 as HTTP 500 | Phase 4 §31 | CF-070 |
| Upgraded (confidence) | HSEC-28, C-03, U-09, E-01, CU-03 → confirmed (Phase 4); FIN-L1, DB-L03 → confirmed (Phase 5); L5-01, FIN-P6 → mechanism confirmed (Phase 6); L5-03 → measured (Phase 9); DB-20 → persistent saturation measured (Phase 9) | as listed | no new IDs |
| Excluded (no defect) | cross-tenant TanStack cache leak, service-worker API caching, axios replay of POSTs, modal focus, `lib/print.ts` escaping, phone-width invoice table | Phase 7 §13 | not carried |
| Verified controls | C-01 … C-10 (JWT↔tenant binding, HS-only JWT, escalation guard, no mass assignment, reset token design, webhook HMAC fail-closed and idempotent, no hash exposure, literal routing, CSP) | Phase 2 §24 | regression-guard tests in §8.4 |

### 4.5 Release blockers (must be fixed and pass §8 before any production release)

| CF | Sev | Defect | Wave |
|---|---|---|---|
| CF-001 | P0 | client-supplied prices | W4 |
| CF-002 | P0 | POS amount ≠ recorded total | W4 |
| CF-003 | P0 | refund formula | W5 |
| CF-004 | P0 | pending installment invoice cancel/return; revival | W5 |
| CF-005 | P0 | settings/VAT/ETA credentials writable by anyone | W3 |
| CF-011 | P1 | store-credit double spend | W5 |
| CF-012 | P1 | installment approve/reject races | W5 |
| CF-013 | P1 | double cancel | W5 |
| CF-014 | P1 | concurrent returns | W5 |
| CF-015 | P1 | PO double receive | W5 |
| CF-016 | P1 | no idempotency on creates | W5 |
| CF-017 | P1 | fee vocabulary | W4 |
| CF-019 | P1 | day close ≠ money received | W7 |
| CF-020 | P1 | coupon/credit authority | W3 |
| CF-021 | P1 | billing actions by any employee; card token exposed | W3 |
| CF-022 | P1 | all-tenant reminder trigger | W1 |
| CF-023 | P1 | unescaped e-mail relay | W1 |
| CF-024 | P1 | no user deactivation or session revocation | W9 |
| CF-025 | P1 | cashier cannot sell | W1 |
| CF-026 | P1 | invoice detail / A4 tax invoice show blanks and NaN | W1 |
| CF-027 | P1 | return confirmed without the refund amount | W5 |

**Conditional blockers (RB\*): blockers if automated card billing is live (PV-10); otherwise automated billing must stay disabled until they pass.**

| CF | Defect | Wave |
|---|---|---|
| CF-006 | re-charge on ambiguous outcome or post-charge failure | W6 |
| CF-007 | jobs charge paid or cancel-scheduled periods; overwrite payments | W6 |
| CF-008 | amount, currency and capture not verified | W6 |
| CF-009 | webhook tenant binding from unsigned fields | W6 |
| CF-010 | expiry depends on a card token | W6 |

### 4.6 Immediate containment (no fix assumed; each action is conditional on what W0 finds)

| # | Action | For | Condition and safety |
|---|---|---|---|
| CT-1 | Establish whether renewal/dunning are charging real cards: recent `payment_attempts`, the Paymob dashboard, configured integration ids | CF-006, CF-007 | read-only (PV-10) |
| CT-2 | **If** CT-1 shows live card charging: an owner decision to pause the renewal and dunning repeatables (or run them under manual review) and reconcile the last 90 days against Paymob, until W6 lands | CF-006, CF-007, CF-008 | an operational decision, not an audit action. Pausing stops revenue collection as well as double charges; that trade-off is the owner's |
| CT-3 | No deploys or restarts during the 06:00–09:00 billing windows (Phase 8 §15 #4) until CF-044 and CF-006 are fixed | CF-006, CF-040, CF-044 | procedural |
| CT-4 | Take a backup now and restore it into an isolated instance; record the time taken and the row counts per tenant schema | CF-031 | read-only on production (a dump), with the restore elsewhere |
| CT-5 | Run Phase 4 §38's detection queries read-only to size existing damage (negative balances, duplicate schedules, over-receipts, double cancels, phantom restocks, double charges, orphan tenants) | CF-004, CF-011 … CF-015, CF-054 | read-only (PV-09); results drive the cleanup scripts that must precede constraints (§6 T-02) |
| CT-6 | Move `.env.production` out of the repository working tree on the host, or add it to `.gitignore` / `.dockerignore`; confirm it was never committed | CF-048 | a host and config change by the operator; read-only check first: `git log --all -- .env.production` |
| CT-7 | Restrict who holds an account that can reach the settings, billing and coupon routes (review tenant users and roles) until W3 | CF-005, CF-020, CF-021 | tenant-side administration; no code |
| CT-8 | Tell tenants not to use the cashier role for selling until W1 (CF-025); use a role that holds `settings:read` | CF-025 | communication |

### 4.7 Pre-release requirements (verify, fix or formally accept before release)

| CF | Requirement |
|---|---|
| CF-018 | Fix P&L, or label it as not reliable for decisions until W7 |
| CF-028, CF-029, CF-030 | Verify PV-06, PV-07 and PV-12, then either fix (W8/W7) or accept with a named owner and an alert on the failure signal |
| CF-031 | Backups with a completed restore drill and a recorded RPO/RTO |
| CF-032 | Error tracking plus alerts on 5xx, failed jobs, billing-cycle completion, PostgreSQL connections, Redis memory and event-loop lag |
| CF-033, CF-035 | Verify the proxy topology and the TLS-issuance limits (PV-01, PV-14); fix if confirmed |
| CF-034 | Signup throttling, or an explicit risk acceptance |
| CF-042, CF-043, CF-047, CF-050, CF-084, CF-085 | Silent e-mail loss, a misleading health signal, unvalidated production config, a truncated export, the tax-invoice identity (legal check) and broken reset links: each fixed, or visibly disclosed to tenants |

**Feature gates (FG): do not enable these features until the listed CFs pass.**
- **Automated card billing:** CF-006 … CF-010, CF-037 … CF-040.
- **ETA e-invoicing:** CF-055 … CF-059, CF-095 … CF-097.
- **File uploads UI:** CF-136.
- **Offline POS:** CF-080 (after CF-016).
- **PgBouncer transaction pooling:** CF-052.

**Post-release:** the remaining 109 canonical findings are scheduled in W7–W12 by risk and dependency (§7).

### 4.8 Confirmed defects vs deployment-dependent risks

| Class | Canonical findings |
|---|---|
| **Confirmed defect, independent of deployment** (code or runtime) | CF-001 … CF-005, CF-011 … CF-027, plus every CF with evidence RT or ST and no +ENV |
| **Confirmed mechanism; production exposure depends on facts in §9** | CF-006, CF-007, CF-010 (billing live? callback contents?), CF-009 (mechanism confirmed; the payer-redirect precondition is likely, L6-03), CF-028 (Redis reliability), CF-029 (max_connections, tenant count), CF-030 (data volumes, memory limit), CF-031 (provider backups), CF-032 (external monitoring), CF-152 (is Railway in use?) |
| **Likely; needs a deployment or provider fact to confirm** | CF-033 (proxy topology), CF-034, CF-035 (Caddy and CA limits), CF-037 (integration ids, pending semantics), CF-084 (legal requirement), CF-095, CF-103, CF-108, CF-110, CF-161; CF-135 is potential and deployment-dependent (GA build flag, Resend key) |
| **Potential / hypothesis** | CF-052, CF-088, CF-094, CF-104, CF-109, CF-111, CF-115, CF-123, CF-131, CF-133, CF-134, CF-146, CF-147 |

---

## 5. Root-cause map

### 5.1 Root causes used

RC-01 … RC-11 are Phase 4.5's, unchanged in substance; Phases 5–9 confirmed every one of them and added refinements. **RC-12 … RC-14 are new in this phase.** Each new one is supported by findings from at least two phases that share a single missing capability and a single fix.

| RC | Statement | Basis | Refinement from Phases 5–9 |
|---|---|---|---|
| RC-01 | **Ad-hoc concurrency control**: a guard is read outside the write; unconditional or absolute updates; no lock ordering or retry | Phase 4.5 §5 | Phase 5: jobs show the same stale-list-then-unconditional-write shape (BG-03, BG-06) |
| RC-02 | **Implicit, multi-writer state model**: blacklist status checks, several writers per status, no cross-entity rules | Phase 4.5 §5 | Phase 6: subscription expiry exists only as a side effect of charging (INT-04) |
| RC-03 | **Financial effects not recorded as first-class entries**; reversals, refunds and reports recompute | Phase 4.5 §5 | Phase 6: the ETA document is built from a partial projection (INT-02); Phase 9: reports aggregate in JS over whole histories (PERF-02/03) |
| RC-04 | **The server doesn't own monetary calculation** | Phase 4.5 §5 | Phase 7: the POS, receipt and installment preview render client math (UX-01) |
| RC-05 | **No durable idempotency boundary** | Phase 4.5 §5 | Phase 5: ETA jobs (BG-08); Phase 7: an asynchronous double-submit guard (UX-14) |
| RC-06 | **No server-side payment intent** — refined by Phase 6 to **"no payment intent and no provider outcome model"**: unknown outcomes are not a state, and provider results are not compared with expectations | Phase 4.5 §5; Phase 6 §26 C1 | BG-01, BG-11, INT-05, L6-01 |
| RC-07 | **Multi-step lifecycle without a durable step record** — refined by Phase 5: **a Redis lock is used as a substitute for a progress record** | Phase 4.5 §5; Phase 5 §37.4 | BG-02, BG-10, BG-13; INFRA-05 (migrations at boot) |
| RC-08 | **Unbounded waits and shared resources**: no timeouts and no capacity budget | Phase 4.5 §5 | Phase 5 BG-04; Phase 9: one event loop, heap and connection budget for all tenants (PERF-01/02/04) |
| RC-09 | **No single schema contract** (SQL vs Prisma vs raw SQL; and front end vs API) | Phase 4.5 §5 | Phase 6 INT-01 (uuid vs text); Phase 7 UX-02, UX-09, UX-11 (API/UI field contract) |
| RC-10 | **Authorization opt-in per route** | Phase 4.5 §5 | Phase 7: role and UI gating inconsistent (UX-03, UX-10) |
| RC-11 | **No per-user session registry** | Phase 4.5 §5 | Phase 9: the reset sweep scans every session (PERF-07) |
| **RC-12** | **No observability.** No error tracking, metrics, alerts or job forensics; the health signal is static | INFRA-02, A-08 (Phase 8 / Phase 1); BG-15 (Phase 5); INFRA-03 (Phase 8); INFRA-13 | Phase 8 §1: "none of the confirmed Phase 5–7 failures would page anyone" |
| **RC-13** | **No recovery capability for durable state.** No database backup or restore; Redis is RDB-only and carries sessions, queues and schedules | INFRA-01, INFRA-06 (Phase 8); BG-12 (Phase 5); INFRA-L02 | one fix family: backup/PITR, a restore drill, persistent Redis and self-healing schedules (Phase 8 §15 #1, #7; Phase 5 §41 #8) |
| **RC-14** | **No business time zone.** The client and server use UTC or the process TZ for business days | UX-07 (Phase 7), BG-14 (Phase 5), DB-38 (Phase 4), UX-L03 (timezone setting never read) | one fix: a tenant-timezone date utility on client and server (Phase 7 §14 #7) |

**Groupings considered and not adopted (insufficient evidence):**
- A separate "background-job race" root cause. Phase 4.5 cluster E and Phase 5 §37.4 both conclude that job defects are RC-01, RC-02, RC-06 and RC-07 under at-least-once execution.
- A single "frontend" root cause. UX-06 (no mutation-driven invalidation) and UX-08 (no 402 handling) have no shared mechanism with each other or with the backend clusters, so they stay independent.
- A "configuration management" root cause for INFRA-07, -08, -12, -14, -15, -16. Phase 8 treats them as separate defects with separate fixes.
- Phase 6's C6 (e-mail results ignored, content unescaped) and C7 (storage left to SDK defaults) are explicitly independent in Phase 6 §26 and stay IND.

### 5.2 Map: canonical findings per root cause (primary attribution; computed from the registry)

| Root cause | P0 | P0* | P1 | P2 | P3 | Info | Total (primary) | High-severity CFs (primary) | Secondary contributor to |
|---|---|---|---|---|---|---|---|---|---|
| RC-01 | · | 1 | 5 | 7 | 4 | · | 17 | CF-007, CF-011, CF-012, CF-013, CF-014, CF-015 | CF-004, CF-066, CF-087 |
| RC-02 | 1 | · | 1 | 3 | 4 | · | 9 | CF-004, CF-010 | CF-007, CF-012, CF-058 |
| RC-03 | 1 | · | 3 | 7 | 1 | · | 12 | CF-003, CF-018, CF-019, CF-027 | CF-004, CF-086 |
| RC-04 | 2 | · | 1 | 1 | 1 | · | 5 | CF-001, CF-002, CF-017 | CF-027, CF-036, CF-064 |
| RC-05 | · | · | 1 | 2 | 1 | · | 4 | CF-016 | CF-006, CF-022 |
| RC-06 | · | 1 | 2 | 3 | · | · | 6 | CF-006, CF-008, CF-009 | CF-007 |
| RC-07 | · | · | · | 4 | 3 | · | 7 | — | CF-034, CF-043 |
| RC-08 | · | · | 3 | 5 | 6 | 1 | 15 | CF-028, CF-029, CF-030 | CF-006 |
| RC-09 | · | · | 1 | 3 | 6 | · | 10 | CF-026 | CF-017, CF-052, CF-057 |
| RC-10 | 1 | · | 4 | · | 4 | · | 9 | CF-005, CF-020, CF-021, CF-022, CF-025 | — |
| RC-11 | · | · | 1 | · | 3 | · | 4 | CF-024 | — |
| RC-12 | · | · | 1 | 1 | 2 | · | 4 | CF-032 | — |
| RC-13 | · | · | 1 | 1 | · | · | 2 | CF-031 | — |
| RC-14 | · | · | · | 1 | 1 | · | 2 | — | — |
| IND | · | · | 4 | 12 | 40 | 5 | 61 | CF-023, CF-033, CF-034, CF-035 | — |

### 5.3 What the map shows

1. **The money P0s are ownership defects, not race defects.** CF-001 and CF-002 (RC-04), CF-003 (RC-03) and CF-004 (RC-02 + RC-03) happen in a single request with no concurrency at all. Phase 4.5 reached the same conclusion. Phases 7 and 9 add nothing that changes it.
2. **RC-01 is the largest block of P1s.** It accounts for 6 high-severity findings and 17 in total, and one primitive set closes all of them. It also drives one P0\*: CF-007's stale-list writes.
3. **RC-10 is the cheapest high-severity root cause.** One P0 and four P1s fall to default-deny route registration.
4. **RC-06 is the money risk outside the POS.** All five conditional blockers (CF-006 … CF-010) sit on it or on RC-02's subscription half.
5. **RC-08's high-severity findings are availability, and they are environment-dependent** (CF-028 … CF-030). Their fixes carry correctness hazards: tenant isolation through pooling (CF-052) and in-flight transactions (CF-098).
6. **RC-12 and RC-13 do not cause defects; they decide whether a defect is noticed and recoverable.** That is why they come first in the plan even though they "fix" nothing.
7. **61 independent findings** are mostly P3 hygiene. The four high-severity ones (CF-023 e-mail relay; CF-033, CF-034, CF-035 edge abuse controls) are small, isolated fixes and go to W1/W10.

---

## 6. Remediation dependency graph

### 6.1 Remediation tasks

| Task | Scope | Canonical findings | Wave |
|---|---|---|---|
| T-01 | Production verification and damage sizing (read-only) | PV-01 … PV-10; CT-1, CT-5 | W0 |
| T-02 | Cleanup scripts for the damage T-01 finds (run by the owner) | CF-004, CF-011 … CF-015, CF-054 | W0→W5 |
| T-03 | Backup, off-site copy and a restore drill | CF-031 | W0 |
| T-04 | Observability baseline: error tracking, alerts, readiness probe, job logging | CF-032, CF-043, CF-093 | W1 |
| T-05 | Owner decisions (PV-21) | inputs to T-10, T-11, T-13, T-16, T-24, T-32 | W0 |
| T-06 | W1 isolated fixes | CF-022, CF-023, CF-025, CF-026, CF-033, CF-035, CF-041 (ETA/Resend part), CF-042, CF-044, CF-047, CF-048, CF-050 (label), CF-085, CF-091, CF-092, CF-132 | W1 |
| T-07 | RC-01 primitives (`transition`, `adjust`, `lockParent`, ordered locks + retry) and the race harness in CI | enabler | W2 |
| T-08 | RC-09 schema-contract CI (`migrate diff`, raw-SQL `EXPLAIN`, regenerated tenant model) | CF-114, CF-115, CF-144; enabler | W2 |
| T-09 | RC-05 `operation_keys` primitive (server side) | enabler | W2 |
| T-10 | RC-10 default-deny route registration, permission catalogue, role migration | CF-005, CF-020, CF-021, CF-120 … CF-123 | W3 |
| T-11 | RC-04 shared pricing module; server ignores the client price; fee vocabulary data migration | CF-001, CF-017, CF-036, CF-061, CF-062, CF-063, CF-068, CF-086, CF-146, CF-159 | W4 |
| T-12 | POS, receipt and installment preview render the server quote | CF-002 | W4 |
| T-13 | RC-03 minimal: typed effect columns, payment allocations, reversal from `stock_movements`, backfill | CF-003, CF-060, CF-064, CF-065, CF-066, CF-104, CF-112 | W5 |
| T-14 | RC-02 invoice ↔ contract ↔ work-order lifecycle owner | CF-004, CF-012, CF-067, CF-100, CF-105, CF-106, CF-107 | W5 |
| T-15 | RC-01 applied to every writer, plus CHECK/UNIQUE backstops | CF-011, CF-013, CF-014, CF-015, CF-070 … CF-076, CF-101, CF-102 | W5 |
| T-16 | Idempotency end to end (POS key per cart, stored with queued sales) | CF-016 | W5 |
| T-17 | Return UI with refund preview and remaining quantity | CF-027 | W5 |
| T-18 | Schema-qualify the 24 raw-SQL sites; migration lock that does not need a pinned session | CF-052 | W8 |
| T-19 | Optional PgBouncer transaction pooling | CF-029 (structural) | W8 |
| T-20 | Connection budget and reclamation: idle lifetime, LRU sweep with idle grace, non-superuser role, DB timeouts | CF-029, CF-098, CF-099 | W8 |
| T-21 | Redis connection split, timeouts, cache fallback, fast 503 | CF-028 | W8 |
| T-22 | Per-period payment intent, outcome classification (`UNKNOWN`), provider inquiry | CF-006, CF-037, CF-039 | W6 |
| T-23 | Webhook settles the intent; amount, currency, capture and signed-order binding | CF-008, CF-009, CF-038, CF-090 | W6 |
| T-24 | Subscription lifecycle owner: conditional job writes, token-independent expiry, separate counters, plan link | CF-007, CF-010, CF-077, CF-078, CF-083, CF-087, CF-088, CF-089 | W6 |
| T-25 | Paymob call timeouts that record `UNKNOWN` | CF-041 (Paymob part) | W6 |
| T-26 | Lock semantics (compare-and-delete, renewal) or per-subscription child jobs; self-healing schedules | CF-040, CF-046 (schedules) | W6 |
| T-27 | Reports from recorded effects; SQL aggregation; paginated and streamed exports | CF-018, CF-019, CF-030, CF-050, CF-069, CF-109, CF-139, CF-163 | W7 |
| T-28 | Per-user session registry with token families | CF-024, CF-117, CF-118, CF-119 | W9 |
| T-29 | Provisioning step record, version-in-transaction migrations, readiness gating, release pipeline, signup throttling | CF-034, CF-045, CF-053, CF-054, CF-110, CF-111 | W10 |
| T-30 | ETA: SQL fixes, document from recorded effects, submission identity, configuration, outbox and auto-enqueue | CF-055 … CF-059, CF-095 … CF-097 | W11 |
| T-31 | Capacity fixes: invoice-list index and page-only counts, hashing off the event loop, compression, search, batch walks, limit counts | CF-049, CF-051, CF-094, CF-103, CF-137, CF-138 | W8 |
| T-32 | Front-end correctness and hygiene, business time zone | CF-081, CF-082, CF-084, CF-155 … CF-161 | W12 |
| T-33 | Persistent Redis and full disaster recovery (PITR) | CF-031, CF-046 | W10 |

### 6.2 Dependency edges

**Types:**
- **HARD**: the target is wrong or unsafe without the source.
- **CO-REQ**: the two ship together.
- **ROLLOUT**: the code can be written, but must not reach production first.
- **DESIGN-INPUT**: an owner decision or provider fact is needed to design the target.
- **SOFT**: a sequencing benefit only.

| # | From → To | Type | Why the dependency exists | Evidence |
|---|---|---|---|---|
| D-1 | T-07 → T-14, T-15, T-24 | HARD | lifecycle owners and guarded writes are built on `transition()` / `adjust()` / `lockParent()` | Phase 4.5 §8 (RC-02 design), §27 rule 1 |
| D-2 | T-01 + T-02 → T-15 (constraint validation) | HARD | rows already violating the new CHECK/UNIQUE constraints make validation fail; cleanup comes first | Phase 4.5 §9 RC-01 risks; §27 Wave 3 |
| D-3 | T-03 → T-11 (fee data migration), T-13 (backfill), T-15 (validation), T-30 (any ETA DDL) | ROLLOUT | every production data change needs a proven restore; none exists today | INFRA-01 (Phase 8) |
| D-4 | T-05 → T-11, T-13, T-24, T-10, T-16, T-32 | DESIGN-INPUT | price override, refund cap, payment on a `CANCELLED` subscription, trial grace, branch authorization, offline keep or remove, tax on order discounts and invoice identity are not documented anywhere | Phase 4.5 §19 "not documented"; UV-06; Phase 3 U-04, U-05 |
| D-5 | T-11 → T-12 | HARD | the POS can render only a total the server computes | Phase 7 §14 #1 |
| D-6 | T-13 → T-17 | HARD | the dialog must show the corrected refund | Phase 7 §14 #2 |
| D-7 | T-13 → T-27 | HARD | day close and P&L are derived from allocations and recorded movements | Phase 4.5 §8 RC-03 |
| D-8 | T-13 + T-11 → T-30 (document builder) | HARD | the ETA document must come from recorded line effects and server prices | Phase 6 §27 E2; §25 (FIN-05 propagates into ETA) |
| D-9 | T-14 ⇄ T-13 | CO-REQ | fixing cancel legality without reversing what was recorded (or vice versa) leaves two contradictory definitions of "what the sale did" | Phase 4.5 §29 |
| D-10 | T-09 → T-16 → CF-080 (offline rebuild) | HARD | the key must exist end to end; a client-only or server-only half doesn't help | Phase 4.5 §29 (idempotency) |
| D-11 | T-22 → T-23, T-24, T-25, CF-038, CF-039 | HARD | the webhook binds to an intent; expiry needs "paid for this period"; a timeout needs an `UNKNOWN` state; refunds and reconciliation need a record | Phase 6 §27 P2, P3, P4, L6; Phase 5 §37.4 |
| D-12 | PV-10 (Paymob sandbox: U6-01, U6-02, U6-04, U5-02) → T-22 | DESIGN-INPUT | the `UNKNOWN` resolution path depends on whether an inquiry API exists and on callback contents | Phase 6 §27 P1 ("depends on U6-04") |
| D-13 | T-22 ⇄ T-24 | CO-REQ | the subscription state machine is one model; patching the dunning predicate alone leaves the other paths | Phase 4.5 §29; Phase 5 §37.4 |
| D-14 | **T-25 must not precede T-22** | HARD | a Paymob timeout without an `UNKNOWN` state becomes "transient" and is retried with a new order id, which turns hangs into faster re-charges | Phase 5 §41 #3; Phase 6 §27 P4 |
| D-15 | T-22 → fan-out of billing jobs (CF-094 part of T-31) | HARD | fanning out per tenant multiplies the re-charge risk until charges are idempotent | Phase 9 §15 #10 |
| D-16 | T-08 → T-30 | HARD | without the CI contract each SQL fix is unverified and the next drift is invisible | Phase 4.5 §29 |
| D-17 | T-30 SQL fixes (CF-055, CF-056) → T-30 outcome and identity work (CF-058) | HARD | outcome handling cannot be exercised while every job fails before reaching ETA | Phase 5 §37.1 (BG-08 "moot while DB-23 stands"); Phase 6 §8 |
| D-18 | CF-057 + CF-058 fixed + outbox → CF-059 auto-enqueue | HARD | auto-submitting a wrong document, with no dedupe, multiplies tax-authority errors | Phase 4.5 §26; Phase 6 §27 |
| D-19 | **T-18 → T-19** | HARD | transaction pooling plus unqualified raw SQL → cross-tenant queries; the session advisory lock also breaks | PERF-11 (Phase 9); Phase 4.5 RC-08 risks |
| D-20 | CF-098 (idle-grace disposal) → T-20 (LRU sweep) | HARD | reclaiming idle clients must not `$disconnect` one with an open transaction | Phase 9 §15 #1; DB-29 |
| D-21 | T-04 → production rollout of T-15, T-20, T-22, T-23, T-24 | ROLLOUT | these change money paths and the connection model; without alerts a regression is as invisible as today's defects | Phase 8 §1 (INFRA-02) |
| D-22 | CF-061 ⇄ CF-062 | CO-REQ | fixing the discount UI makes unbounded discounts reachable from the UI | §4.3 #3 |
| D-23 | CF-036 → any loyalty redemption UI (CF-159) | HARD | the UI would expose the wrong arithmetic to every cashier | §4.2 |
| D-24 | T-21 internal | CO-REQ | fail-fast Redis without a DB fallback turns hangs into outages | Phase 4.5 §29 (availability budget) |
| D-25 | CF-018 (P&L definition) ⇄ CF-030 (SQL aggregation) | CO-REQ | otherwise the aggregation is written twice, and the SQL must reproduce the corrected rule | Phase 9 PERF-02 correctness constraint |
| D-26 | T-28 → CF-119 | SOFT | the per-user session set is the structure the reset sweep needs | Phase 9 PERF-07; Phase 4.5 RC-11 |
| D-27 | T-10 → CF-120 (UI gating), permanent form of CF-025 | SOFT | the UI follows the permission catalogue | Phase 4.5 §8 RC-10 risks |
| D-28 | T-24 → CF-083 banner states | SOFT | generic 402 handling can ship earlier; the "period ended unpaid" state needs T-24 | Phase 7 §14 #5 |
| D-29 | CT-3 + CF-044 → fewer CF-006 triggers | SOFT (containment) | shorter exposure window; not a fix | Phase 8 INFRA-04 |
| D-30 | T-29 ⇄ release pipeline (CF-045) | CO-REQ | migrations become a release step only when versions commit with their DDL and readiness gates traffic | Phase 8 §15 #6; Phase 4.5 §10 RC-07 |

### 6.3 Graph

```
                         T-05 owner decisions ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ (design input to T-10/11/13/16/24/32)
T-01 verify ──► T-02 cleanup ──────────────────────────────┐
T-03 backup+restore drill ─────────(rollout gate)──────────┼──► T-11 fee migration, T-13 backfill, T-15 constraints
T-04 observability ────────────────(rollout gate)──────────┼──► T-15, T-20, T-22/23/24 in production
                                                           │
T-07 RC-01 primitives ──┬──► T-15 guarded writes ◄─────────┘
                        ├──► T-14 invoice lifecycle ◄══► T-13 recorded effects ──┬──► T-17 return UI
                        │                                                        ├──► T-27 reports ◄══► CF-030 aggregation
                        └──► T-24 subscription lifecycle ◄══► T-22 payment intent ──┬──► T-23 webhook binding
                                                                                    ├──► T-25 Paymob timeouts (NOT before T-22)
                                                                                    └──► billing fan-out (T-31 part)
T-11 pricing ──► T-12 POS quote;   T-11 + T-13 ──► T-30 ETA document
T-09 op keys ──► T-16 idempotency ──► CF-080 offline rebuild
T-08 schema CI ──► T-30 ETA: SQL fixes ──► outcome/identity ──► outbox + auto-enqueue
T-18 qualify raw SQL + session-free migration lock ──► T-19 PgBouncer (transaction mode)
CF-098 idle-grace disposal ──► T-20 connection reclamation
Independent / parallel: T-06 W1 fixes · T-10 authorization · T-21 Redis · T-28 sessions · T-31 index/hash/compression · T-32 front end · T-33 DR
```

`──►` HARD or ROLLOUT · `◄══►` CO-REQ · `─ ─` DESIGN-INPUT

### 6.4 Do not start until …

| Do not start | Until | Why |
|---|---|---|
| PgBouncer in **transaction** mode (T-19) | T-18 is done and R-12 (two-tenant interleaving through the pooler, §8.3) passes | cross-tenant raw SQL (CF-052) |
| Validating CHECK/UNIQUE constraints in production | T-01/T-02 have cleaned existing violations, and T-03 has a proven restore | the migration fails, or the cleanup is irreversible |
| Any production backfill or data migration (allocations, fee vocabulary) | T-03 restore drill completed | INFRA-01 |
| Paymob call timeouts (T-25) | T-22 intent with an `UNKNOWN` state | D-14 |
| Fanning out billing jobs per tenant | T-22 | D-15 |
| ETA auto-enqueue (CF-059) | CF-055 … CF-058 fixed, an outbox in place, and preprod acceptance (PV-16) | D-18 |
| Offline POS re-enable (CF-080) | T-09 + T-16 | D-10 |
| LRU idle sweep (T-20) | CF-098 | D-20 |
| A loyalty redemption UI | CF-036 | D-23 |
| Shipping the product-discount UI fix (CF-062) | CF-061 validation, in the same change | D-22 |

### 6.5 The PgBouncer transaction-pooling risk

| Fact | Source | Status |
|---|---|---|
| Tenant isolation for Prisma **model** queries comes from schema-qualified SQL (`"tenant_x"."invoices"`) | Phase 9 §5.6 (captured SQL) | confirmed |
| **Raw** SQL (`$queryRaw*` / `$executeRaw*`, 24 sites in `apps/api/src`) is unqualified and relies on the connection's `search_path`, e.g. `invoice.service.ts:41-48` | Phase 1 §7.5; Phase 9 §5.6 | confirmed (static) |
| The Prisma 5.22 engine applies the tenant schema with `SET search_path = "<schema>"` per physical connection | Phase 9 E15 (engine binary strings) | code-derived |
| In transaction mode, PgBouncer hands one server connection to different clients between transactions; session state set by one client (a `search_path`) is seen by the next | PgBouncer semantics as described in Phase 9 §5.6 | **not executed** (no pooler in the repo) |
| The migration runner's session-level advisory lock needs a pinned session | Phase 4.5 §9 RC-08 risks (`migrate-tenants.ts:76`) | confirmed (static) |

**Assessment.** A raw query from tenant A can execute with tenant B's `search_path`. That is a cross-tenant read or write on the search, ETA and migration paths, and it would be a **P0 isolation break the day it is deployed**. Session-mode pooling avoids the hazard but saves few connections.

**Recommended order:**
1. **T-20.** Bounded pools with idle reclamation. This may be enough once PV-06 and PV-12 give the real tenant counts.
2. **T-18, only if pooling is still needed.** Schema-qualify every raw statement, or run each inside a transaction that issues `SET LOCAL search_path`. Move the migration runner to a direct connection, or to `pg_advisory_xact_lock`. Set `pgbouncer=true`.
3. **T-19.** Only after R-12 passes.

### 6.6 What can run in parallel

- **W0** (T-01, T-03, T-05) has no code dependency and starts immediately.
- **W1** (T-04, T-06) is a set of independent small changes, each reviewable alone.
- **W2 and W3** run in parallel: T-07, T-08 and T-09 are enablers, and T-10 needs only the branch-authorization decision from T-05.
- **W8 items with no correctness coupling** can go any time after W1: the invoice-list index, hashing off the event loop, compression and the Redis split.
- **T-28** (sessions), **T-32** (front-end hygiene) and **T-33** (Redis persistence, PITR) are independent of the money waves.
- **W11** (ETA) is entirely off the release path unless the business decides to enable ETA.

---

## 7. Implementation waves and scope boundaries

**Principles:**
- Each wave is a set of small, separately reviewable pull requests that can be validated together.
- No wave mixes a money-path change with an unrelated refactor.
- Every wave lists its rollback.
- "Modules" are the code areas the source reports name; this report changes none of them.
- Waves are ordered by risk and dependency, not by calendar. Effort is not estimated, because no report measured team capacity.

### W0 — Verify and contain (no application code)

| Field | Content |
|---|---|
| Objectives | Replace assumptions with facts (§9); size existing damage; prove recoverability; decide on billing exposure; collect owner decisions |
| Canonical findings | CF-031 (backup and restore drill); containment for CF-006, CF-007, CF-008 (CT-1/CT-2), CF-044 (CT-3), CF-048 (CT-6), CF-005/020/021 (CT-7), CF-025 (CT-8); damage sizing for CF-004, CF-011 … CF-015, CF-054 (CT-5) |
| Modules | none (operations, read-only SQL, provider dashboards) |
| Prerequisites | operator access (not available to this audit) |
| Risk | low, if the checks stay read-only; CT-2 (pausing billing) is a business trade-off for the owner |
| Tests / evidence | PV-01 … PV-10 recorded with dates; restore drill RPO/RTO; detection-query results per tenant |
| Rollout | n/a |
| Rollback | resume paused repeatables; no data changed |
| Exit criteria | PV-01 … PV-10 answered; restore drill passed; damage list and cleanup scripts drafted (not run); PV-21 decisions recorded |

### W1 — Safety net and isolated fixes

| Field | Content |
|---|---|
| Objectives | See failures; stop the cheapest high-impact defects; remove routine triggers of the billing re-charge |
| Canonical findings | CF-032, CF-043, CF-093 (observability, readiness, job logging); CF-044 (stop grace), CF-048 (secrets file), CF-047 (fail-fast config); CF-022 + CF-091 + CF-092 (reminder route under tenant scope and the lock, claim-before-send); CF-023 (escape templates, restrict recipients); CF-042 (check Resend results, with **no** naive retry-on-error: Phase 6 P6-P06); CF-085 (correct e-mail link routes); CF-025 (POS roles can read payment methods; interim until W3); CF-026 (invoice-detail DTO and A4 print); CF-050 (label the sales export "latest 500 of N" until W7 streams it); CF-041 (timeouts for **ETA and Resend calls only**; the Paymob part waits for W6, D-14); CF-033 (trustProxy matched to the PV-01 topology); CF-035 (TLS ask checks that the tenant exists); CF-132 (run-migrations guard) |
| Modules | observability plugin, `index.ts` (health/readiness, trustProxy, check-tenant), `docker-compose.prod.yml` (stop grace), `.gitignore` / `.dockerignore`, `email.ts`, `installment.routes.ts` + reminders job, payment-methods route permission, invoices drawer / `print.ts` / invoice-detail response, `admin.routes.ts:890` |
| Prerequisites | PV-01 for CF-033; none for the rest |
| Risk | low, one change per PR. Readiness gating can block deploys if mis-configured (start in report-only mode) |
| Tests | RT-C3 and RT-HSEC05 (reminders); RT6-M (Resend); RT7-03, RT7-04; R-09 subset; an alert test that fires in staging and reaches a person; readiness returns 503 with PostgreSQL or Redis stopped (Phase 8 E5 inverted) |
| Rollout | feature by feature; observability first; readiness as a separate deploy gate once observed for a week |
| Rollback | each change reverts independently; config changes are re-applied from the previous compose file |

### W2 — Enablers

| Field | Content |
|---|---|
| Objectives | Build the primitives every correctness wave needs; turn the existing harnesses into CI |
| Canonical findings | enabler for W4 – W6; directly CF-114, CF-115, CF-144 |
| Modules | new domain helpers (`transition`, `adjust`, `lockParent`, ordered-lock retry); `operation_keys` table (tenant migration); CI: scratch-schema migrate + `prisma migrate diff` + raw-SQL `EXPLAIN`; the Phase 4/5/6 harnesses as CI suites |
| Prerequisites | none |
| Risk | low (additive); the first `migrate diff` (722 lines, Phase 4.5) needs manual review |
| Tests | primitive unit tests + race tests (20 trials per case); CI red on any schema drift |
| Rollout | merged behind no flag; nothing calls the primitives yet |
| Rollback | revert; no data written |

### W3 — Default-deny authorization (parallel with W2)

| Field | Content |
|---|---|
| Objectives | Close the settings P0 and the permission P1s with one mechanism |
| Canonical findings | CF-005, CF-020, CF-021 (and drop the card token from the portal response), CF-120, CF-121, CF-122, CF-123 (branch scope only if T-05 decides it); permanent form of CF-025 |
| Modules | tenant route registration in `index.ts`, `billing.routes.ts`, `coupon.routes.ts`, `customer.routes.ts`, the role seed, a permission catalogue shared by the UI |
| Prerequisites | T-05 (branch authorization); a role-migration plan for existing custom roles |
| Risk | medium: existing custom roles lose implicit access (Phase 4.5 RC-10 risks) |
| Tests | RT-J1 route inventory (every tenant route declares a permission; a snapshot of the route → permission map); a role matrix per seeded role; RT7-11; the portal response has no card token |
| Rollout | ship the catalogue and migration with a log-only mode first (log what would be denied), then enforce |
| Rollback | flip to log-only; the role migration is additive (keep old grants until enforce is stable) |

### W4 — Server-owned pricing

| Field | Content |
|---|---|
| Objectives | One calculation for the POS and the server; the server never trusts a client price |
| Canonical findings | CF-001, CF-002, CF-017 (data migration `percent` → `percentage` plus a CHECK), CF-036, CF-061 + CF-062 (together), CF-063, CF-068, CF-086, CF-146 (after a tax-advisor decision), CF-159 (redemption UI only after CF-036) |
| Modules | `packages/shared` (pricing, enums), `invoice.service.ts`, `installment.service.ts`, `fee.ts`, `loyalty.ts`, `POS.tsx`, `Installments.tsx`, product-discount routes |
| Prerequisites | W2 (schema CI for shared enums); T-05 (price-override policy); T-03 before the fee data migration |
| Risk | high user visibility (totals change to the correct figures; offline carts priced from a cache need re-validation); Phase 4.5 RC-04 risks |
| Tests | RT-E1 parity matrix; RT7-01, RT7-02; RT7-10 with bound checks; a mismatched client price is ignored or rejected; seeded methods yield 1.75 % / 3 % |
| Rollout | quote endpoint first (shadow-compare the client total against the server total and log the differences); then the POS renders the server quote; then the server ignores `unitPrice` |
| Rollback | the UI can fall back to showing the server's post-sale total; the data migration is reversible only from backup (hence T-03) |

### W5 — Sales reversals, invoice lifecycle, guarded writes, idempotency

Split into three reviewable sub-waves that share W2's primitives.

| Field | W5a reversals and lifecycle | W5b guarded writes | W5c idempotency |
|---|---|---|---|
| Objectives | reverse exactly what was recorded; one owner for invoice ↔ contract ↔ work-order status | every check-then-write becomes a conditional write, with DB backstops | one effect per operation key |
| Canonical findings | CF-003, CF-004, CF-012, CF-027, CF-060, CF-064, CF-065, CF-066, CF-067, CF-100, CF-104, CF-105, CF-106, CF-107, CF-112 | CF-011, CF-013, CF-014, CF-015, CF-070 … CF-076, CF-101, CF-102 | CF-016 |
| Modules | `invoice.service.ts` (create/cancel/return), `installment.service.ts`, `workOrder.routes.ts`, new allocations table and effect columns, `Invoices.tsx` return dialog | `invoice.service.ts`, `installment.service.ts`, `po.routes.ts`, `stock.service.ts`, `workOrder.routes.ts`, `customer.routes.ts`, tenant migration (CHECK/UNIQUE) | `invoice.routes.ts` and other create routes, `POS.tsx` (key per cart and offline queue) |
| Prerequisites | W2; T-05 (refund cap; installment cancellation policy); T-03 (backfill) | W2; T-01/T-02 cleanup before constraint validation; T-03 | W2 (`operation_keys`) |
| Risk | report figures change (they were wrong); historical invoices need an approximate allocation backfill (Phase 4.5 RC-03) | duplicates that were silently accepted become 409s that the UI must show | key retention; replayed responses must stay tenant-scoped |
| Tests | RT-D1, RT-A3, RT-A4, RT-A2 (legality cases), RT-A6, RT7-05 | RT-A1 … RT-A7 (20 trials each), invariant queries from Phase 4 §38 after every test | RT-B1, RT-B2, RT7-15 |
| Rollout | allocations written first (dual-write), then reversals read them; lifecycle rules enforced with clear 409 messages | one call site per PR; constraints added `NOT VALID`, validated after cleanup | server accepts keys first, then the POS sends them |
| Rollback | revert code; allocation rows are additive and can be ignored | revert per call site; drop or leave constraints `NOT VALID` | revert; the keys table is additive |

### W6 — SaaS billing: payment intent and subscription lifecycle

Release blocker only if card billing is live (RB\*); otherwise this wave is the gate for enabling it.

| Field | W6a intent, outcome and webhook | W6b subscription lifecycle and jobs |
|---|---|---|
| Objectives | every charge is recorded before it happens; unknown outcomes are a state; the webhook settles a known intent | one owner for subscription status; jobs act only if the state still allows it; expiry does not need a card |
| Canonical findings | CF-006, CF-008, CF-009, CF-037, CF-038, CF-039, CF-090; Paymob part of CF-041 (after the intent) | CF-007, CF-010, CF-040, CF-077, CF-078, CF-083, CF-087, CF-088, CF-089 |
| Modules | master `subscription_payments` table, `billing.service.ts`, `paymob.client.ts`, `paymob.webhook.ts`, `renewal.job.ts`, `dunning.job.ts`, reconciliation job | `billing.service.ts`, `billing.routes.ts`, `trial-expiry.job.ts`, `admin.routes.ts` subscription actions, `shared/utils/lock.ts`, `tenant.middleware.ts` (gate), `SubscriptionBanner.tsx`, `api/client.ts` (402) |
| Prerequisites | W2; PV-10 (Paymob sandbox: U6-01, U6-02, U6-04, U5-02); W1 observability (billing alerts); T-05 (policy for a payment on a `CANCELLED` subscription) | W6a (D-11, D-13); T-05 (trial grace, suspension policy) |
| Risk | payments in flight at cut-over; legacy Paymob semantics (pending / 3-DS, token callbacks) | visible behaviour changes: expired trials restricted; paid subscriptions no longer dunned |
| Tests | RT6-B, RT6-C, RT6-K, RT6-L, RT6-H2, RT6-I, RT6-W5, RT-BG01, RT-B3, RT-B4 | RT6-G, RT6-F, RT6-T, RT-BG03a … e, RT-C1, RT-C2, RT7-09 |
| Rollout | intent table and dual-write first; the webhook binds via the intent once every new checkout has one; the jobs switch last; run the reconciliation daily from the first day | conditional writes first (pure safety); lifecycle rules with policy flags |
| Rollback | jobs can be paused (CT-2); the intent table is additive; the webhook falls back to its current dedupe | per-rule flags; revert per job |

### W7 — Reporting correctness and report capacity

| Field | Content |
|---|---|
| Objectives | Reports and day close reflect money actually received; heavy reports stop stalling other tenants |
| Canonical findings | CF-018, CF-019, CF-030 (with CF-018, D-25), CF-050 (stream the full export), CF-069, CF-109, CF-139, CF-163 (label only) |
| Modules | `report.service.ts`, `report.routes.ts`, `excel.ts` (streaming writer), `Reports.tsx`, `Dashboard.tsx`, `DayClose.tsx` |
| Prerequisites | W5a allocations (D-7) |
| Risk | figures change; Excel export moves to streaming or a background job |
| Tests | RT-D2 (P&L and day close equal a hand-built ledger for a fixture month); R-02, R-03, R-04 (Phase 9); RT7-07 |
| Rollout | new report queries shadow-compared with the old ones on fixtures, then switched; per-tenant report concurrency limit and `statement_timeout` added with the switch |
| Rollback | old report endpoints kept behind a flag for one release |

### W8 — Availability, connection budget and capacity

| Field | Content |
|---|---|
| Objectives | Bounded waits; connections that come back; no single request that stalls the platform |
| Canonical findings | CF-028, CF-029, CF-098 (first), CF-099, CF-049, CF-051, CF-094 (billing fan-out only after W6a), CF-103, CF-108, CF-137, CF-138, CF-162; CF-052 before any transaction-mode pooler (T-18 → T-19) |
| Modules | `config/redis.ts`, `config/database.ts`, `packages/database/src/prisma.ts`, `limit.middleware.ts`, `password.ts`, `invoice.service.ts` list, `product.routes.ts` search, Caddyfile, the 24 raw-SQL sites (T-18) |
| Prerequisites | PV-06, PV-07, PV-12 (real limits and sizes); W1 observability; CF-098 before the LRU sweep |
| Risk | fail-fast Redis without a cache fallback creates outages (D-24); pool changes need load verification |
| Tests | R-01, R-05, R-06, R-07, R-09, R-11, R-12, R-13 (Phase 9); RT-G1, RT-G2, RT-G3 (Phase 4.5) |
| Rollout | configuration changes one at a time, each observed under alerting; the index migration built concurrently per tenant schema |
| Rollback | config revert; the index can be dropped |

### W9 — Identity and sessions

| Field | Content |
|---|---|
| Objectives | Users can be offboarded; sessions can be revoked; claims reload |
| Canonical findings | CF-024, CF-117, CF-118, CF-119, CF-124, CF-125, CF-126, CF-127, CF-128, CF-129, CF-131, CF-134 |
| Modules | `auth.service.ts`, `auth.routes.ts`, `auth.middleware.ts`, admin auth store, web auth bootstrap (`main.tsx`) |
| Prerequisites | none hard; W3 (catalogue) for re-role semantics |
| Risk | a one-time logout when session storage changes |
| Tests | RT-K1; deactivation → refresh 401 and access token rejected after the cache TTL; concurrent refresh → one succeeds; R-08 (reset sweep) |
| Rollout | dual-read old and new session keys for one refresh lifetime |
| Rollback | keep the old key reader for one release |

### W10 — Lifecycle, release and recovery

| Field | Content |
|---|---|
| Objectives | Crash-safe provisioning and migrations; an immutable, rollback-able release; durable Redis |
| Canonical findings | CF-034, CF-045, CF-046, CF-053, CF-054, CF-110, CF-111, CF-130, CF-148, CF-149, CF-150, CF-151, CF-152, CF-153, CF-154, CF-165; DR completion (CF-031 PITR, T-33) |
| Modules | `tenant.service.ts`, `migrate-tenants.ts`, `index.ts` startup, Dockerfile, CI image build, compose / Railway config, master seed, Redis configuration |
| Prerequisites | W1 readiness; T-03 |
| Risk | release-process change; startup ordering |
| Tests | RT-F1, RT-F2; restore drill repeated with PITR; schedules re-assert after a Redis flush (Phase 5 BG-12 scenario) |
| Rollout | CI-built images tagged by commit; migrations as a separate release step; readiness gates traffic |
| Rollback | previous image tag; down-migrations are not planned (Phase 8), so rollback relies on backward-compatible migrations plus restore |

### W11 — ETA enablement (feature gate; off the release path)

| Field | Content |
|---|---|
| Objectives | Make ETA correct before anyone turns it on |
| Canonical findings | CF-055, CF-056 (first), CF-057, CF-058, CF-095, CF-096, CF-097; CF-059 last (outbox + auto-enqueue) |
| Modules | `eta-submission.job.ts`, `eta.routes.ts`, the ETA payload builder and signer, ETA settings in `index.ts`, tenant migrations if columns are added |
| Prerequisites | W2 schema CI (D-16); W4 + W5a (D-8); PV-16 (ETA preprod acceptance); T-03 for any DDL |
| Risk | tax-authority rejections; a wrong document submitted is a legal record |
| Tests | RT6-ETA1, RT6-ETA2, RT6-ETA3; preprod submissions for plain / line-discount / coupon + credit invoices (synthetic data) |
| Rollout | per-tenant enablement flag; manual resubmit only until CF-058 passes; auto-enqueue last |
| Rollback | disable the flag; nothing auto-submits |

### W12 — Front-end correctness and hygiene

| Field | Content |
|---|---|
| Objectives | Correct dates, fresh summaries, readable errors, accessible UI; the remaining hygiene |
| Canonical findings | CF-079, CF-080 (offline: rebuild after W5c, or remove; T-05), CF-081, CF-082, CF-084 (after a legal check), CF-113, CF-116, CF-133, CF-135, CF-136 (before any upload UI), CF-140, CF-141, CF-142, CF-143, CF-145, CF-147, CF-155 … CF-158, CF-160, CF-161 |
| Modules | web pages and `lib/*` (dates, money, errors, print), `api/client.ts`, customer statement route, coupon delete, `config/r2.ts`, GA page-view filter |
| Prerequisites | W5c for CF-080; T-05 decisions for CF-080 and CF-084 |
| Risk | low per item |
| Tests | RT7-06 … RT7-16; RT6-R2 for uploads |
| Rollout | independent PRs |
| Rollback | per PR |

**Not scheduled:** CF-164, CF-166, CF-167 (Info; no action). CF-162 (single process) is addressed indirectly by W7/W8, which bound what one request can consume; splitting workers into their own process is reconsidered only if W8 metrics show a need. CF-163 (dashboard cache) gets a "last updated" label in W7 and nothing more.

---

## 8. Regression and acceptance criteria

### 8.1 Test environment rules (from every phase's harness)

- **Disposable infrastructure only:** a throwaway PostgreSQL 16 and Redis 7 on loopback.
- **A loopback-only network guard:** `globalThis.fetch` throws for non-loopback hosts.
- **Every `.env` key overridden explicitly.**
- **Provider mocks** for Paymob, Resend and ETA, recording calls.
- **The real routes and workers** (`fastify.inject`, real BullMQ workers).
- **Assertions on durable outcomes:**
  - database rows;
  - charges and submissions recorded by the mocks;
  - e-mails delivered by the mock.
- **Races** run 20 trials per case (Phase 4.5 §28), followed by the Phase 4 §38 invariant queries.
- **Every test asserts both directions:** the failure path (the defect can no longer occur) and recovery (the system returns to a correct, usable state after the failure).

### 8.2 Acceptance criteria for P0, P0\* and P1 canonical findings

| CF | Acceptance criterion (measurable) | Failure path tested | Recovery verified | Source tests |
|---|---|---|---|---|
| CF-001 | A sale or contract with a tampered `unitPrice` is priced from the catalog, or rejected, unless an override permission is held and audited; 0 of N tampered requests change the price | API request with a lowered price | an override with permission is recorded in the audit log | RT-E1; Phase 3 FIN-05 vector |
| CF-002 | For a taxed, discounted, couponed cart, the amount shown = persisted `total_amount` to the cent; the receipt lines sum to it; installment preview = server `monthly_amount` | cart matrix (tax × discount × coupon × fee bearer) | a POS reload shows the same server quote | RT7-01, RT7-02, RT-E1 |
| CF-003 | Refund = the recorded net paid share of the returned lines (coupon, credit, loyalty and line discount applied once); the 976 → 926 fixture refunds the correct figure | return with line + order discounts | a second return refunds only the remainder | RT-D1, RT-A4, RT7-05 |
| CF-004 | Cancelling or returning a `pending` installment invoice → 409; approving a cancelled invoice → 409; restock 0 and credit 0 for invoices that never shipped | cancel, return and approve sequences | the legal path (cancel the contract, then the invoice) completes once | RT-D1, RT-A2 (legality cases) |
| CF-005 | Every settings, ETA-credential, branch and currency route requires a declared permission; a cashier gets 403 | route inventory + role matrix | an authorised owner still updates settings | RT-J1 |
| CF-006 | Exactly **1** gateway charge and 1 intent per subscription period across: lost response, 504, HTML 200, 200 without `order`, DB failure after the charge, SIGKILL mid-cycle, lock-TTL overlap | each fault injected after the mock charges | the next run resolves `UNKNOWN` by inquiry and either records the charge or retries safely; the subscription ends `ACTIVE` with the correct period | RT6-B, RT6-C, RT6-K, RT6-L, RT6-H2, RT-BG01, RT-B3 |
| CF-007 | No charge for a period already paid or cancel-scheduled; trial expiry ∥ payment → `ACTIVE`; admin cancel during dunning stays `CANCELLED` | S-A, S-B, S-D1 … S-D3, S-H, F2, G replayed | a late payment for a cancelled subscription is flagged for refund, not applied | RT6-G, RT6-F, RT-BG03a … e, RT-C1, RT-C2 |
| CF-008 | A success with a wrong amount, currency or capture state does not activate or extend; the stored row reflects the provider's values | mock pay 100 USD; signed webhook 100 USD | the intent stays pending and an alert fires | RT6-I, RT-B4 |
| CF-009 | A signed transaction re-addressed to tenant B changes nothing on B (status, period, token) | W5/W6 re-addressing replay | A's own intent settles correctly | RT6-W5 |
| CF-010 | A subscription past its period end and grace with no successful payment leaves `ACTIVE`/`TRIALING` per policy, with or without a card token; the gate enforces it | cardless `ACTIVE`; expired unpaid trial | a payment restores access in one transition | RT6-T, RT7-09 |
| CF-011 | Two sales spending 700 each from 1,000 credit → one succeeds, the other 409/400; balance never < 0; `CHECK (credit_balance >= 0)` holds | 20 concurrent trials | the balance reconciles to the ledger after the test | RT-A1 |
| CF-012 | Two approvals, or approve ∥ reject → exactly one transition; 3 schedule rows; stock decremented once; `UNIQUE (contract_id, installment_number)` | 20 trials, 0–20 ms stagger | the loser receives 409 and the contract is in a legal state | RT-A2 |
| CF-013 | Two cancels → effects reversed once (stock, credit, coupon count) | 20 trials | the second cancel → 409 | RT-A3 |
| CF-014 | Σ returned ≤ sold; return ∥ cancel → one wins | 20 trials | the loser → 409; refund total ≤ paid | RT-A4 |
| CF-015 | Received ≤ ordered; supplier liability counted once; WAC equals the serial result | 20 trials, two "receive all" | the second receipt → 409 | RT-A5 |
| CF-016 | Same key, sequential or concurrent → 1 invoice, and the second response = the first; two tabs replaying a queue → 1 invoice per key; double click → 1 POST | retry after a lost response; offline replay | the replay after recovery posts once, under the original cashier | RT-B1, RT-B2, RT7-15, RT7-06 |
| CF-017 | Seeded card and valU methods compute 1.75 % / 3 %; the POS preview equals the server fee; a `fee_type` CHECK rejects unknown values | seeded tenant sale with each method | the data migration is idempotent on re-run | RT-E1; Phase 3 calc §1 |
| CF-018 | P&L for a fixture month equals a hand-built ledger (tax excluded from revenue; work orders once; COGS from `cost_at_sale`) | fixture with VAT, WO, returns, split tender | the report re-runs identically (one snapshot) | RT-D2 |
| CF-019 | Day close per method = Σ allocations received that business day; refunds included; EOD reopened after a sale includes it | sale, refund, split, installment payment in one day | — | RT-D2, RT7-07 |
| CF-020 | Coupon create/edit and credit adjust need their own permissions; the seeded cashier is denied | role matrix | a manager with the permission succeeds | RT-J1 |
| CF-021 | Billing cancel/resume/portal need a billing permission; the portal response has no card token | role matrix; response snapshot | the owner can still cancel and resume | RT-J1 |
| CF-022 | The reminder trigger touches only the caller's tenant, runs under the job lock, and sends one e-mail per payment per day | cron ∥ manual trigger from tenant A | a re-run the next day sends again | RT-C3, RT-HSEC05 |
| CF-023 | Interpolated values are HTML-escaped in every template; receipt recipients are limited to the customer's address on file (or a permissioned override) | injection payloads in the store name and notes | legitimate receipts still deliver | Phase 2 HSEC-06 test, RT6-M |
| CF-024 | A deactivated user's refresh fails at once and their access token is rejected within the claim-cache TTL; a password change revokes other sessions | deactivate during an active session | reactivation allows a new login | RT-K1 |
| CF-025 | The seeded cashier completes a cash sale (201); if a POS prerequisite query fails, the POS shows an error state | cashier login → sale | — | RT7-04 |
| CF-026 | The drawer shows product name, SKU and a 2-dp line amount; the A4 tax invoice has no `NaN` / `ليس رقمًا` and no blank item names | recorded fixture of the real API response | — | RT7-03 |
| CF-027 | The dialog shows the refund before confirmation, equal to `returns.amount`; reopening shows remaining quantity 0 | full return, then reopen | an error shows a mapped Arabic message | RT7-05 |
| CF-028 | With Redis stopped, tenant requests answer (DB fallback) or return 503 within 1 s; workers do not block boot; recovery is automatic when Redis returns | Redis stopped during load | requests succeed again within the reconnect window, with no duplicate effects | RT-G1; Phase 5 X1 |
| CF-029 | After a burst across N tenants (N above today's failing point), zero `P2037`; backends ≤ budget after the idle window; a new signup succeeds | B5 burst (31 tenants × 8 × 5) | the idle connections are reclaimed without aborting any transaction | R-01, RT-G2, RT-G3 |
| CF-030 | All-time P&L, stock and 365-day sales at 200k items: p95 within the agreed budget; RSS delta < 150 MB; event-loop lag max < 100 ms; small-tenant p99 < 50 ms while they run | B2/B3 replay | after a cancelled export, memory returns to baseline | R-02, R-03 |
| CF-031 | A restore of the latest backup into an isolated instance completes; row counts per tenant schema match; RPO and RTO recorded and accepted by the owner | deliberate loss in staging (drop a tenant schema) | the restored tenant serves reads and writes | Phase 8 checklist #3–4 |
| CF-032 | A synthetic 5xx spike, a failed billing job, a stalled cycle (> 26 h), PostgreSQL connections > 80 % and Redis down each page a named person within the agreed time | staging fault injection | the alert auto-resolves when the fault clears | Phase 8 checklist #12 |
| CF-033 | `request.ip` is the client address behind the proxy; per-IP limits are independent across clients; spoofed `X-Forwarded-For` from non-proxy hosts is ignored | two clients behind the proxy | — | Phase 2 HSEC-18 test |
| CF-034 | Signup is rate-limited (and verified per policy); abandoned `PROVISIONING` tenants are reaped | 100 rapid signups | reaped identifiers become reusable | RT-F1 + throttle test |
| CF-035 | The TLS ask endpoint returns 200 only for existing, active tenants | random subdomain requests | a new tenant's certificate is issued | Phase 2 HSEC-20 test |

### 8.3 Cross-phase end-to-end suites

| Suite | Flow | Must hold at the end |
|---|---|---|
| **E2E-POS** | cashier logs in → scans and searches → coupon + credit + loyalty + VAT + fee → pays with a split → receipt → EOD → day close | shown total = recorded total = receipt total; stock −qty once; credit and points move once; one fee expense; EOD and day close include the sale per method |
| **E2E-REFUND** | the same sale → partial return → second partial return → attempt to cancel | refunds = recorded net shares; cancel refused after returns; stock and credit restored once; EOD shows the refunds |
| **E2E-INSTALLMENTS** | installment sale (pending) → cancel attempt (refused) → approve → pay rows (one twice concurrently) → complete; a second contract rejected | no phantom stock; schedule sums to the total; a row is paid once; the down payment and each payment are allocations with a method; reminders only for due, unpaid rows of active contracts in active tenants |
| **E2E-SUBSCRIPTION** | trial → checkout success (signed) → renewal at period end (mock success) → renewal with a lost response → dunning with a decline → payment during dunning → cancel at period end → expiry | one charge per period; `UNKNOWN` resolved; no charge after cancel; status follows the transition table; banners match the states; the 402 page for suspended tenants |
| **E2E-ETA** (only before enabling ETA) | invoice with a product line + service line + discounts → submit → duplicate → cancel → status sync | document totals = invoice; one submission per invoice; `submissionUUID` stored; cancelled invoices not submitted; permanent errors not retried |
| **E2E-EMAIL** | receipt, reset, trial reminders, installment reminders with the mock returning 200 / 500 / 429 / reset | delivered once; failures surfaced and not recorded as sent; reset link opens the reset page; no unescaped markup |
| **E2E-ISOLATION** | tenants A and B: token for A with B's host/header; job payload naming B; reminder trigger from A; webhook re-addressing; **pooler interleaving** (if a pooler is introduced) | zero rows read or written across tenants (`R-12`, `RT6-W5`, Phase 2 C-01 binding test) |
| **E2E-RESTORE** | full backup → drop a tenant schema and a master table in staging → restore → replay | data back to the backup point; RPO/RTO within target |
| **E2E-ALERT** | inject: worker stall, billing cycle skipped, 5xx burst, connection saturation, Redis loss | each pages within its target and clears on recovery |

### 8.4 Regression guards and performance gates

- **Guards that pass today and must keep passing:**
  - duplicate webhook delivery (Phase 6 D, E);
  - two jobs with the lock held (H1);
  - a definite decline (A);
  - sale stock, coupon and loyalty redemption race-safety (Phase 4 S2–S4);
  - password-reset single use;
  - token↔tenant binding (`authenticate.tenant-binding.test.ts`);
  - Phase 2 controls C-01 … C-10;
  - the bundle budget R-15;
  - the write-path guard R-14.
- **Performance gates** (Phase 9 §16): relative to a stored baseline on the same runner class, never against Phase 9's absolute numbers. Gates: R-01 … R-13, plus `EXPLAIN` plan assertions (no `GroupAggregate` over `invoice_items` on the invoice list; index scans for search).

---

## 9. Production verification checklist

None of these checks was run by any phase, including this one. Each is **read-only**: it observes state and changes nothing. They are for the operator, with their own access. Secrets are checked for *presence* only (print `set` / `unset`, never values). The **Source IDs** column consumes every unverified-item ID from earlier phases (§12.2).

| PV | Unknown | Why it matters (CF) | Safe read-only verification | Source IDs |
|---|---|---|---|---|
| PV-01 | **Hosting topology:** VPS compose or Railway; replica count; proxy chain and the effective `request.ip`; stop timeout | CF-006, CF-033, CF-044, CF-045, CF-152; every worker runs on every replica (L5-01) | DNS lookup and response headers (`Server: Caddy` vs the Railway edge); on the host `docker inspect hesba_app --format '{{.Config.StopTimeout}}'` and `docker compose config --no-interpolate`; the Railway service settings page; one request's logged `ip` vs the client address | INFRA-U01, P2:U-01, P2:U-10, P3:U-09, U5-05 (replicas), UV-04 (part) |
| PV-02 | **Deployed code version** vs the audited `8846bce` | every CF (which defects are actually deployed) | `git -C <deploy dir> rev-parse HEAD` and `git status --porcelain` on the host (read-only); the image creation time; the Railway deployment commit | — (new) |
| PV-03 | **Deployed environment variables** (presence only): Paymob keys and integration ids, `RESEND_API_KEY`, R2, `APP_ENCRYPTION_KEY`, `APP_BASE_DOMAIN`, `VITE_GA_MEASUREMENT_ID` in the web build, `NODE_OPTIONS` | CF-037, CF-047, CF-135, CF-010, CF-006 | `sh -c 'for v in …; do [ -n "$(printenv $v)" ] && echo "$v set" \|\| echo "$v unset"; done'` inside the app container; grep the built bundle for a `G-` measurement id | P2:U-02, P2:U-03, U6-08, UX-U03 (part), UV-09 (part) |
| PV-04 | **Backups and restore:** provider snapshots, PITR, off-site copy, last restore | CF-031 (P1 vs P0\*) | provider console (Railway / VPS host) read-only; list the backup target and the newest timestamp; then the restore drill **into an isolated instance** (CT-4) | INFRA-U02 |
| PV-05 | **Monitoring outside the repository** (uptime pings, provider alerts) | CF-032 | provider and monitoring consoles; ask who receives alerts today; trigger a test alert only in staging | INFRA-U03 |
| PV-06 | **PostgreSQL limits and roles:** `max_connections`, `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout`, whether the app role is a superuser, peak `pg_stat_activity` | CF-029, CF-099, CF-052 | `SHOW max_connections; SHOW statement_timeout; …`; `SELECT rolsuper FROM pg_roles WHERE rolname = current_user;`; `SELECT count(*) FROM pg_stat_activity` at peak (read-only queries) | P4:U-04 (DB-U04), P2:U-09, UV-04 |
| PV-07 | **Redis configuration:** persistence, `maxmemory` and policy, auth, exposure | CF-028, CF-046 | `redis-cli CONFIG GET appendonly`, `save`, `maxmemory-policy`; `INFO persistence`; repeatables present (`--scan --pattern 'bull:*:repeat*'`); no orphan `lock:*` keys outside cycle windows | P2:U-11, UV-04, U5-05 (part) |
| PV-08 | **Tenant schema state:** `schema_version` distribution; migrations 016/017 present; the ETA columns the code expects; rows violating the NOT VALID CHECKs | CF-055, CF-102, CF-053 | `SELECT schema_version, count(*) FROM tenants GROUP BY 1`; `information_schema.columns` per tenant; `SELECT … WHERE NOT (check expression)` counts | UV-01, P3:U-01, P4:U-01 (DB-U01), U6-10 |
| PV-09 | **Existing damage from confirmed defects:** negative credit or loyalty, duplicate schedules, over-receipts, double cancels, phantom restocks, double charges, orphan `PROVISIONING` tenants | CF-004, CF-011 … CF-015, CF-006, CF-054 | Phase 4 §38 detection queries (read-only, per tenant schema); Paymob dashboard vs `payment_attempts` for 90 days | UV-02, P4:U-02 (DB-U02) |
| PV-10 | **Billing in reality:** are renewal/dunning charging cards; Paymob recurring integration id; transaction callback URL; does the callback carry `obj.token`; is there an inquiry API; is a duplicate `merchant_order_id` rejected; `pending` frequency; are empty billing fields accepted | CF-006 … CF-010, CF-037 (RB\* decision; design input D-12) | recent `payment_attempts` rows and Paymob dashboard (read-only); integration settings page; then the **Paymob sandbox** with a test card and a throwaway callback receiver | U5-01, U5-02, U5-04, U5-06, U6-01, U6-02, U6-03, U6-04, UV-03, P2:U-05, P3:U-03, P4:U-03 (DB-U03) |
| PV-11 | **Feature usage:** tax rates ≠ 0, product discounts, coupons, loyalty, installments, split tender, edited seed payment methods, ETA-enabled tenants | exposure of CF-002, CF-003, CF-017, CF-036, CF-064; ETA urgency | aggregate counts per tenant schema (read-only) | UV-07, P3:U-02, P3:U-08 |
| PV-12 | **Scale:** active tenant count, rows per tenant (invoices, items, variants × branches), request rates, peak concurrent users, login waves | CF-029, CF-030, CF-049, CF-051, CF-137 (Phase 9 limits are not production limits) | row counts per schema; access-log aggregates; provider metrics | UV-05, P3:U-06, Phase 9 §11.4 items 3–4 |
| PV-13 | **Host resources:** CPU, memory and container memory limit, disk, container TZ, Node heap limit | CF-030, CF-082, CF-051 | `docker stats --no-stream`, `df -h`, `date` and `TZ` inside the container, `node -e "console.log(v8.getHeapStatistics().heap_size_limit)"` | INFRA-U04, UX-U03 (TZ), Phase 9 §11.4 items 1, 8 |
| PV-14 | **Edge:** wildcard DNS; certificate validity; Caddy on-demand limits and ACME account; CSP actually served and inherited by popups | CF-035, CF-133, CF-134 | DNS lookup; `caddy list-certificates` or the provider console; response headers of the SPA and a print popup in a test browser | P2:U-06, P2:U-07, P2:U-08, UV-09 (part) |
| PV-15 | **R2 bucket:** public or private, CORS, CRC32 checksum support | CF-136 | Cloudflare dashboard (read-only) | P2:U-04, U6-07 |
| PV-16 | **ETA provider behaviour:** acceptance of the current payload and signature; resubmission inside and after the 10-minute window | CF-057, CF-058 (gate for W11) | ETA **preprod** with synthetic invoices and a test certificate | U5-03, U6-05, U6-06 |
| PV-17 | **Resend:** account rate limits, bounce handling, idempotency header support | CF-042 | Resend dashboard and docs; sandbox | U5-07, U6-09 |
| PV-18 | **Browsers and devices:** Safari/iOS date inputs, `navigator.onLine`, 80 mm printers, screen readers; cross-subdomain refresh-cookie behaviour; `clearCookie` without domain | CF-080, CF-157, CF-160, CF-126, CF-134 | manual test matrix on staging | UX-U01, UX-U02, P2:U-12 |
| PV-19 | **PostgreSQL version and latency:** production version; app↔DB and app↔Redis RTT | race-window size (CF-011 … CF-015); CF-119 reset latency | `SELECT version()`; a timed `SELECT 1` from the app container | UV-10, P4:U-06, P4:U-07 |
| PV-20 | **Checkout offered to `ACTIVE` subscriptions in the UI** | CF-007 frequency | UI walkthrough on staging | UV-08, P4:U-05 |
| PV-21 | **Owner decisions** (not verification, but blocking design): price override; refund ≤ paid; work-order paid ≤ total; one active subscription per tenant; payment on a `CANCELLED` subscription; trial grace and suspension; branch-level authorization; offline mode keep or remove; tax on order-level discounts; tax-invoice identity requirements; cashier collect-before or collect-after | D-4 (T-10, T-11, T-13, T-16, T-24, T-32) | written decisions from the owner, plus a tax advisor where noted | UV-06, P3:U-04, P3:U-05, P3:U-07; Phase 4.5 §19 "not documented" |
| PV-22 | **Out-of-series work:** status of PRs referenced in project notes (#2 ETA payload "do not merge without preprod", #4 password policy) and whether anything from the 2026-06 / 2026-09 audits is deployed but not on this branch | CF-057, CF-026; confirms PV-02 | `gh pr view` / repository UI (read-only) | — (project notes, not an audit report) |

---

## 10. Residual risks and risk-acceptance requirements

### 10.1 Residual risk after each wave

| After | Still open (high-severity) | New or shifted risk introduced by the wave | Evidence needed before relying on the wave |
|---|---|---|---|
| W0 | every defect; but exposure is now known, and damage and recoverability are measured | CT-2, if chosen, stops revenue collection along with double charges | PV-01 … PV-10 records; restore drill report; damage counts |
| W1 | all P0s; CF-006 … CF-021, CF-024, CF-027 … CF-031, CF-034 | readiness gating can block deploys; Resend error checks must not retry blindly (duplicate e-mails, P6-P06) | alert test evidence; readiness observed for a week before gating |
| W2 + W3 | CF-001 … CF-004, CF-006 … CF-019, CF-024, CF-027 … CF-031, CF-034 | custom roles may lose access (log-only period first) | RT-J1 snapshot; role-matrix results; log-only deny report reviewed |
| W4 | CF-003, CF-004, CF-006 … CF-016, CF-018, CF-019, CF-024, CF-027 … CF-031, CF-034 | totals change for tenants (they were wrong); offline carts need re-pricing on sync | RT-E1 parity; RT7-01/02 green; shadow-compare log shows no unexplained differences |
| W5 | CF-006 … CF-010, CF-018, CF-019, CF-024, CF-028 … CF-031, CF-034 | backfilled allocations for historical invoices are approximate (flagged); new 409s must be explained in the UI | RT-A1 … RT-A7 and RT-D1 green; the Phase 4 §38 invariants return 0 rows on a copy of production after cleanup |
| W6 | (billing) only what PV-10 leaves unknown; CF-018, CF-019, CF-024, CF-028 … CF-031, CF-034 | cut-over of payments in flight; policy changes visible to tenants | RT6-* and RT-BG* green; a reconciliation run against the Paymob sandbox with zero unmatched charges |
| W7 | CF-024, CF-028, CF-029, CF-031, CF-034 | report figures change; exports move to streaming or a background job | RT-D2 fixture ledger; R-02/R-03 within budget on a copy-sized dataset |
| W8 | CF-024, CF-031, CF-034 (and CF-052 if a pooler is wanted) | pool and Redis fail-fast changes can create outages if mis-tuned | R-01, RT-G1 … G3 on staging with production-like limits (PV-06, PV-12) |
| W9 | CF-031, CF-034 | a one-time logout | RT-K1 green |
| W10 | none of the listed high-severity CFs; P2/P3 hygiene remains | a release-process change | RT-F1/F2; a second restore drill with PITR |
| W11 / W12 | feature-gated items only | ETA legal exposure once enabled | preprod acceptance; RT6-ETA1 … 3 |

Even after W10, the following stay unproven by code alone:
- real Paymob and ETA behaviour (PV-10, PV-16);
- production capacity (PV-12);
- device behaviour (PV-18);
- legal requirements for the printed tax invoice (CF-084).

They must be verified, or accepted, explicitly.

### 10.2 Evidence required before a release decision

A release decision is justified only when all of the following are documented:

1. **Every release blocker in §4.5 is closed:** its §8.2 criterion passes in CI, and the run is linked.
2. **The RB\* billing items** are either closed, or automated card billing is verified disabled (PV-10) and stays disabled behind the W6 gate.
3. **PV-01 … PV-10 are answered**, with dates and the person who checked them.
4. **A restore drill has passed** (PV-04, CF-031), with RPO/RTO accepted by the owner.
5. **Alerts are proven to reach a person** (CF-032, E2E-ALERT).
6. **Existing damage (PV-09) is quantified**, cleaned with backup-protected scripts, and re-checked with the invariant queries.
7. **Each pre-release requirement in §4.7** is either fixed or carries a signed risk acceptance (§10.3).
8. **The deployed commit is the tested commit** (PV-02).

### 10.3 Risk-acceptance record (one per accepted residual risk)

| Field | Required content |
|---|---|
| Risk | CF ID(s) and the exact residual behaviour |
| Exposure | the measured or verified facts from §9 that bound it (not assumptions) |
| Compensating control | an alert, a manual check, a feature flag, or a disclosure to tenants |
| Owner | a named person with authority over the affected money, data or tenants |
| Expiry | a date or a trigger (e.g. tenant count > N) when the acceptance must be revisited |
| Evidence | links to the PV records and test runs |

Risks that **cannot** be accepted by this procedure: any P0 (CF-001 … CF-005) and any RB\* item while the feature is live. These must be fixed or the feature disabled.

**This report does not, and cannot, state that Hesba is production-safe.** It states what must be true, and how to show it, before anyone can.

---

## 11. Findings needing further investigation

| # | Question | Why it is open | How to investigate (read-only, or a sandbox) | Affects |
|---|---|---|---|---|
| I-1 | Does Paymob's transaction callback carry `obj.token`? | decides whether INT-04 hits every customer (CF-010 → P1 on its own) | Paymob sandbox (PV-10) | CF-010 |
| I-2 | Is there a `transaction_inquiry` API on `accept.paymob.com`? | it is the preferred way to resolve `UNKNOWN` outcomes | Paymob Egypt API reference / sandbox | CF-006 design (D-12) |
| I-3 | Do token charges run under the correct (recurring) integration id? | L6-01: recurring charges may fail or come back `pending`, which would make CF-037 the common case | integration settings (read-only) + sandbox | CF-037, CF-006 |
| I-4 | Can a payer actually win the race to re-address a signed redirect payload? | the HSEC-21 precondition is LIKELY (L6-03) | sandbox timing test with a throwaway receiver | CF-009 |
| I-5 | **The whole `/api/auth/` prefix is exempt from the suspension gate**, including user and role management and audit logs (Phase 1 doc discrepancy #16) | no phase assigned it a finding ID. **Re-checked statically in this phase:** `SUBSCRIPTION_EXEMPT_PREFIXES = ['/api/auth/', '/api/billing/']` (`tenant.middleware.ts:11`) is applied at `:87-88`, and `GET/POST /users`, `GET /roles` and `GET /audit-logs` are registered under `/api/auth` (`auth.routes.ts:309,337,383,612`). Not exercised at runtime; business impact (whether a suspended store may manage users) undecided | runtime check with a suspended tenant on a local harness; owner decision on the intended scope | candidate new finding (RC-02 / RC-10); likely P3 |
| I-6 | Day close "by payment method **and cashier**" (Phase 1 doc #7) and contract "rejected" vs `cancelled` naming (doc #8) | documented behaviour differs from the code; no phase rated it | owner decision: update the docs or the code | CF-019 scope; CF-067 |
| I-7 | Legal content of the Egyptian tax invoice (store identity, tax registration number) | UX-L01 is likely, not verified | tax advisor | CF-084 |
| I-8 | Tax treatment of order-level discounts | FIN-P1 depends on the applicable rule | tax advisor | CF-146 |
| I-9 | Real-device rendering of the 60,000-row stock table and of POS search | not executed (host safety) | staging with a copy-sized synthetic dataset on a low-end device | CF-139, CF-157 |
| I-10 | Cold-cache query behaviour and production RTT | all plans ran warm, on loopback | staging with production-like storage (PV-19) | CF-049, CF-137, race windows |
| I-11 | PgBouncer transaction-mode behaviour with Prisma 5.22 and `pgbouncer=true` | PERF-11 is static (no pooler in the repository) | R-12 interleaving test on a disposable stack before any adoption | CF-052, CF-029 |
| I-12 | Whether any tenant already has more than one subscription row | decides whether CF-088 is latent or live | read-only count per tenant (PV-09) | CF-088 |
| I-13 | Out-of-series PR #2 (ETA payload) and the 2026-06 / 2026-09 remediation rounds | referenced in project notes only; not part of this audit series | PV-22 | CF-057, CF-026 |
| I-14 | Phase 4.5's "205 identifiers" count | its counting rules for documentation items and sub-IDs are not listed | none needed for coverage (§12.1); noted for the record | — |
| I-15 | Node heap limit and container memory in production | determines whether CF-030 ends in an OOM kill of the only process | PV-13 | CF-030, CF-162 |

---

## 12. Evidence ledger and traceability matrix

### 12.1 Coverage check (mechanical)

The script `reg_data.py` / `check.py` (session scratchpad, deleted after this phase) enumerated every finding-class ID that each report defines:
- Phase 1: the §23.1 ledger plus D-03a/b/c;
- HSEC-01…29; FIN-01…24, FIN-L1…3, FIN-P1…9;
- DB-01…38, DB-L01…10, DB-P01…10; NEW-01;
- BG-01…15, L5-01…06, P5-P01…04;
- INT-01…09, L6-01…05, P6-P01…06;
- UX-01…17, UX-L01…04, UX-P01…02;
- INFRA-01…16, INFRA-L01…03, INFRA-P01…03;
- PERF-01…13.

It then checked them against the registry.

| Disposition | IDs |
|---|---|
| **Retained** as the root of a canonical finding | 167 |
| **Merged** into a canonical finding as a symptom, alias, re-confirmation or UI manifestation | 139 |
| **Split** (umbrella IDs; Phase 4.5) | 2 (FIN-07, FIN-08) |
| **Rejected** | 1 ID (FIN-23) + 1 sub-claim (FIN-20 "last two installments"; FIN-20 itself retained) |
| **Total accounted for** | **309 / 309**; 0 missing, 0 duplicated, 0 unexpected |

**Corrected** items (§4.4) keep their IDs and are retained or merged with the corrected scope. **Unverified** items have their own ID series and are mapped to PV items in §12.3.

### 12.2 Traceability matrix: original ID → canonical finding


**Phase 1 observations (§23.1)** (82 IDs)

| ID | → | ID | → | ID | → | ID | → |
|---|---|---|---|---|---|---|---|
| A-01 | CF-162 | A-02 | CF-035 | A-04 | CF-005 | A-07 | CF-043 |
| A-08 | CF-032 | AU-02 | CF-127 | AU-03 | CF-126 | AU-05 | CF-128 |
| AU-10 | CF-023 | AU-11 | CF-085 | B-01 | CF-008 | B-02 | CF-088 |
| B-03 | CF-038 | B-04 | CF-008 | B-05 | CF-087 | B-06 | CF-021 |
| B-07 | CF-041 | C-03 | CF-098 | CU-01 | CF-074 | CU-02 | CF-136 |
| CU-03 | CF-113 | D-01 | CF-088 | D-03 | CF-114 | D-03a | CF-112 |
| D-03b | CF-114 | D-03c | CF-114 | D-04 | CF-102 | D-05 | CF-053 |
| D-06 | CF-045 | D-07 | CF-148 | D-08 | CF-149 | E-01 | CF-055 |
| E-02 | CF-059 | E-07 | CF-097 | F-01 | CF-001 | F-02 | CF-011 |
| F-03 | CF-065 | F-04 | CF-003 | F-05 | CF-060 | F-06 | CF-120 |
| F-07 | CF-086 | I-01 | CF-165 | IN-02 | CF-012 | IN-03 | CF-067 |
| IN-04 | CF-067 | IN-05 | CF-144 | J-06 | CF-010 | J-07 | CF-040 |
| J-08 | CF-022 | M-01 | CF-166 | M-02 | CF-118 | P-01 | CF-129 |
| P-02 | CF-132 | P-03 | CF-122 | P-04 | CF-077 | P-05 | CF-078 |
| P-06 | CF-167 | P-07 | CF-130 | PO-01 | CF-015 | S-01 | CF-140 |
| S-02 | CF-136 | S-03 | CF-079 | S-05 | CF-122 | S-07 | CF-070 |
| S-08 | CF-164 | S-09 | CF-141 | T-01 | CF-034 | T-03 | CF-142 |
| T-04 | CF-143 | T-05 | CF-017 | T-06 | CF-025 | W-03 | CF-125 |
| W-04 | CF-131 | W-06 | CF-133 | W-07 | CF-024 | W-08 | CF-016 |
| WO-02 | CF-107 | WO-03 | CF-018 | Z-01 | CF-005 | Z-02 | CF-120 |
| Z-03 | CF-121 | Z-04 | CF-121 |  |  |  |  |

**Phase 2 HSEC** (29 IDs)

| ID | → | ID | → | ID | → | ID | → |
|---|---|---|---|---|---|---|---|
| HSEC-01 | CF-005 | HSEC-02 | CF-001 | HSEC-03 | CF-020 | HSEC-04 | CF-021 |
| HSEC-05 | CF-022 | HSEC-06 | CF-023 | HSEC-07 | CF-024 | HSEC-08 | CF-010 |
| HSEC-09 | CF-124 | HSEC-10 | CF-117 | HSEC-11 | CF-125 | HSEC-12 | CF-120 |
| HSEC-13 | CF-121 | HSEC-14 | CF-122 | HSEC-15 | CF-085 | HSEC-16 | CF-132 |
| HSEC-17 | CF-126 | HSEC-18 | CF-033 | HSEC-19 | CF-034 | HSEC-20 | CF-035 |
| HSEC-21 | CF-009 | HSEC-22 | CF-133 | HSEC-23 | CF-134 | HSEC-24 | CF-131 |
| HSEC-25 | CF-135 | HSEC-26 | CF-123 | HSEC-27 | CF-006 | HSEC-28 | CF-028 |
| HSEC-29 | CF-136 |  |  |  |  |  |  |

**Phase 3 FIN** (24 IDs)

| ID | → | ID | → | ID | → | ID | → |
|---|---|---|---|---|---|---|---|
| FIN-01 | CF-002 | FIN-02 | CF-003 | FIN-03 | CF-004 | FIN-04 | CF-004 |
| FIN-05 | CF-001 | FIN-06 | CF-017 | FIN-07 | split → CF-012, CF-013, CF-014, CF-015, CF-070, CF-072 | FIN-08 | split → CF-011, CF-073, CF-074, CF-075, CF-087 |
| FIN-09 | CF-016 | FIN-10 | CF-018 | FIN-11 | CF-019 | FIN-12 | CF-036 |
| FIN-13 | CF-061 | FIN-14 | CF-063 | FIN-15 | CF-064 | FIN-16 | CF-010 |
| FIN-17 | CF-008 | FIN-18 | CF-086 | FIN-19 | CF-065 | FIN-20 | CF-067 |
| FIN-21 | CF-068 | FIN-22 | CF-069 | FIN-23 | **rejected** (§4.4) | FIN-24 | CF-145 |

**Phase 3 FIN-L / FIN-P** (12 IDs)

| ID | → | ID | → | ID | → | ID | → |
|---|---|---|---|---|---|---|---|
| FIN-L1 | CF-006 | FIN-L2 | CF-008 | FIN-L3 | CF-037 | FIN-P1 | CF-146 |
| FIN-P2 | CF-147 | FIN-P3 | CF-006 | FIN-P4 | CF-088 | FIN-P5 | CF-058 |
| FIN-P6 | CF-008 | FIN-P7 | CF-007 | FIN-P8 | CF-102 | FIN-P9 | CF-099 |

**Phase 4 DB** (38 IDs)

| ID | → | ID | → | ID | → | ID | → |
|---|---|---|---|---|---|---|---|
| DB-01 | CF-004 | DB-02 | CF-011 | DB-03 | CF-012 | DB-04 | CF-012 |
| DB-05 | CF-013 | DB-06 | CF-014 | DB-07 | CF-015 | DB-08 | CF-007 |
| DB-09 | CF-028 | DB-10 | CF-016 | DB-11 | CF-070 | DB-12 | CF-071 |
| DB-13 | CF-072 | DB-14 | CF-073 | DB-15 | CF-074 | DB-16 | CF-075 |
| DB-17 | CF-066 | DB-18 | CF-076 | DB-19 | CF-007 | DB-20 | CF-029 |
| DB-21 | CF-053 | DB-22 | CF-054 | DB-23 | CF-055 | DB-24 | CF-087 |
| DB-25 | CF-007 | DB-26 | CF-091 | DB-27 | CF-101 | DB-28 | CF-100 |
| DB-29 | CF-098 | DB-30 | CF-065 | DB-31 | CF-099 | DB-32 | CF-112 |
| DB-33 | CF-113 | DB-34 | CF-114 | DB-35 | CF-116 | DB-36 | CF-106 |
| DB-37 | CF-087 | DB-38 | CF-082 |  |  |  |  |

**Phase 4 DB-L / DB-P (L-xx / P-xx)** (20 IDs)

| ID | → | ID | → | ID | → | ID | → |
|---|---|---|---|---|---|---|---|
| DB-L01 | CF-006 | DB-L02 | CF-045 | DB-L03 | CF-007 | DB-L04 | CF-016 |
| DB-L05 | CF-108 | DB-L06 | CF-117 | DB-L07 | CF-040 | DB-L08 | CF-103 |
| DB-L09 | CF-076 | DB-L10 | CF-110 | DB-P01 | CF-038 | DB-P02 | CF-088 |
| DB-P03 | CF-110 | DB-P04 | CF-115 | DB-P05 | CF-109 | DB-P06 | CF-104 |
| DB-P07 | CF-111 | DB-P08 | CF-100 | DB-P09 | CF-058 | DB-P10 | CF-011 |

**Phase 4.5** (1 IDs)

| ID | → | ID | → | ID | → | ID | → |
|---|---|---|---|---|---|---|---|
| NEW-01 | CF-105 |  |  |  |  |  |  |

**Phase 5** (25 IDs)

| ID | → | ID | → | ID | → | ID | → |
|---|---|---|---|---|---|---|---|
| BG-01 | CF-006 | BG-02 | CF-040 | BG-03 | CF-007 | BG-04 | CF-041 |
| BG-05 | CF-042 | BG-06 | CF-092 | BG-07 | CF-078 | BG-08 | CF-058 |
| BG-09 | CF-028 | BG-10 | CF-040 | BG-11 | CF-039 | BG-12 | CF-046 |
| BG-13 | CF-089 | BG-14 | CF-082 | BG-15 | CF-093 | L5-01 | CF-006 |
| L5-02 | CF-095 | L5-03 | CF-096 | L5-04 | CF-094 | L5-05 | CF-007 |
| L5-06 | CF-007 | P5-P01 | CF-046 | P5-P02 | CF-088 | P5-P03 | CF-087 |
| P5-P04 | CF-037 |  |  |  |  |  |  |

**Phase 6** (20 IDs)

| ID | → | ID | → | ID | → | ID | → |
|---|---|---|---|---|---|---|---|
| INT-01 | CF-056 | INT-02 | CF-057 | INT-03 | CF-058 | INT-04 | CF-010 |
| INT-05 | CF-008 | INT-06 | CF-136 | INT-07 | CF-023 | INT-08 | CF-090 |
| INT-09 | CF-097 | L6-01 | CF-037 | L6-02 | CF-135 | L6-03 | CF-009 |
| L6-04 | CF-136 | L6-05 | CF-058 | P6-P01 | CF-090 | P6-P02 | CF-058 |
| P6-P03 | CF-097 | P6-P04 | CF-136 | P6-P05 | CF-088 | P6-P06 | CF-042 |

**Phase 7** (23 IDs)

| ID | → | ID | → | ID | → | ID | → |
|---|---|---|---|---|---|---|---|
| UX-01 | CF-002 | UX-02 | CF-026 | UX-03 | CF-025 | UX-04 | CF-027 |
| UX-05 | CF-080 | UX-06 | CF-081 | UX-07 | CF-082 | UX-08 | CF-083 |
| UX-09 | CF-062 | UX-10 | CF-120 | UX-11 | CF-155 | UX-12 | CF-156 |
| UX-13 | CF-157 | UX-14 | CF-016 | UX-15 | CF-158 | UX-16 | CF-159 |
| UX-17 | CF-160 | UX-L01 | CF-084 | UX-L02 | CF-003 | UX-L03 | CF-161 |
| UX-L04 | CF-016 | UX-P01 | CF-160 | UX-P02 | CF-158 |  |  |

**Phase 8** (22 IDs)

| ID | → | ID | → | ID | → | ID | → |
|---|---|---|---|---|---|---|---|
| INFRA-01 | CF-031 | INFRA-02 | CF-032 | INFRA-03 | CF-043 | INFRA-04 | CF-044 |
| INFRA-05 | CF-045 | INFRA-06 | CF-046 | INFRA-07 | CF-047 | INFRA-08 | CF-048 |
| INFRA-09 | CF-029 | INFRA-10 | CF-033 | INFRA-11 | CF-130 | INFRA-12 | CF-150 |
| INFRA-13 | CF-151 | INFRA-14 | CF-152 | INFRA-15 | CF-153 | INFRA-16 | CF-154 |
| INFRA-L01 | CF-045 | INFRA-L02 | CF-046 | INFRA-L03 | CF-043 | INFRA-P01 | CF-150 |
| INFRA-P02 | CF-045 | INFRA-P03 | CF-035 |  |  |  |  |

**Phase 9** (13 IDs)

| ID | → | ID | → | ID | → | ID | → |
|---|---|---|---|---|---|---|---|
| PERF-01 | CF-029 | PERF-02 | CF-030 | PERF-03 | CF-050 | PERF-04 | CF-051 |
| PERF-05 | CF-049 | PERF-06 | CF-137 | PERF-07 | CF-119 | PERF-08 | CF-138 |
| PERF-09 | CF-139 | PERF-10 | CF-103 | PERF-11 | CF-052 | PERF-12 | CF-094 |
| PERF-13 | CF-163 |  |  |  |  |  |  |


### 12.3 Other identifier families

| Family | IDs | Disposition |
|---|---|---|
| Unverified items | P2:U-01…12; P3:U-01…09; DB-U01…07 (Phase 4 U-01…07); UV-01…10; U5-01…07; U6-01…10; UX-U01…03; INFRA-U01…04 (62) | all mapped to PV-01 … PV-22 (§9, "Source IDs" column); Phase 9's unnumbered unknowns map to PV-12, PV-13 and PV-19 |
| Root causes | RC-01…RC-11 (Phase 4.5) | retained in §5; RC-12 … RC-14 added |
| Phase 1 documentation discrepancies | doc #1 → CF-059; #2 → CF-055 (and CF-057 signing); #3 → CF-086; #4 → CF-136; #5 → CF-079; #6 → CF-113; #7, #8 → I-6 (documentation or code decision); #9, #25 → CF-017; #10 → CF-121; #11 → CF-131; #12 → CF-133; #13 → CF-165; #14, #18, #19, #20 → documentation only (update the docs; #20's hashing claim also relates to CF-051); #15 → CF-090; #16 → **I-5 (open)**; #17 → CF-107; #21 → CF-114; #22 → CF-018; #23 → CF-087; #24 → CF-035 | all 25 accounted for |
| Phase 2 verified controls | C-01 … C-10 | regression guards (§8.4) |
| Phase 2 attack paths | AP-1 → CF-001, CF-020, CF-005 · AP-2 → CF-021, CF-005 · AP-3 → CF-024, CF-117 · AP-4 → CF-034, CF-022, CF-023, CF-035 · AP-5 → CF-033 · AP-6 → CF-010, CF-121 · AP-7 → CF-133, CF-134, CF-131 · AP-8 → CF-009 | chains of existing findings; used for prioritisation |
| Phase 2 cross-reference labels | A-05, AU-01, AU-07, AU-09 (cited only beside controls C-10, C-02, C-04 and HSEC-10) | reference labels, not findings; AU-07 → CF-117 via HSEC-10 |
| Test identifiers | RT-A1…K1 (Phase 4.5), RT-BG01/03a–e and RT-HSEC05 (Phase 5), RT6-* (Phase 6), RT7-01…16 (Phase 7), R-01…15 (Phase 9) | reused as acceptance tests in §8 |
| Runtime scenario IDs | S1–S20, B1–B8, M1–M6, P1–P4 (Phase 4); S-A…S-I, X1–X9, R1–R5 (Phase 5); A–L, W1–W6, I1–I2 (Phase 6); E1–E22 (Phase 7); E1–E9 (Phase 8); B1–B8, E1–E22 (Phase 9) | cited as evidence; unchanged |

### 12.4 Evidence ledger for the P0, P0\* and P1 canonical findings

| CF | Primary evidence (source report and section) | Runtime scenarios |
|---|---|---|
| CF-001 | Phase 3 FIN-05; Phase 2 HSEC-02; Phase 4.5 E45-02; Phase 7 §13 (`Installments.tsx:449`) | Phase 3 calc vectors |
| CF-002 | Phase 3 FIN-01; Phase 4.5 E45-04; Phase 7 UX-01 | Phase 7 E3–E7, E19 |
| CF-003 | Phase 3 FIN-02; Phase 4.5 E45-03; Phase 7 UX-04 / UX-L02 | Phase 7 E10 |
| CF-004 | Phase 4 DB-01; Phase 3 FIN-03/04; Phase 7 §10 (UI path) | Phase 4 S11, S11b |
| CF-005 | Phase 2 HSEC-01; Phase 4.5 E45-01 | static |
| CF-006 | Phase 5 BG-01 §37; Phase 6 §21 (BG-01 refined); Phase 8 INFRA-04 | Phase 5 S-F, X3, X5, X6; Phase 6 B, B2, J1, J2, K, L, H2 |
| CF-007 | Phase 5 BG-03; Phase 4 DB-08, DB-19; Phase 6 §25 | Phase 4 B4, B6, B7; Phase 5 S-A, S-B, S-D1…S-D3, S-H; Phase 6 F2, G |
| CF-008 | Phase 3 FIN-17; Phase 6 §21 (FIN-17 runtime), INT-05 | Phase 6 I1, I2, W3 |
| CF-009 | Phase 2 HSEC-21; Phase 6 §13, L6-03 | Phase 6 W5, W6 |
| CF-010 | Phase 3 FIN-16; Phase 6 INT-04; Phase 7 UX-08 | Phase 4 B6; Phase 6 (INT-04 runtime); Phase 7 E16 |
| CF-011 … CF-015 | Phase 4 DB-02 … DB-07 | Phase 4 S1, S6–S10, S12, S13, S13b |
| CF-016 | Phase 4 DB-10; Phase 3 FIN-09; Phase 7 UX-14 | Phase 7 E20 |
| CF-017 | Phase 3 FIN-06; Phase 4.5 E45-05; Phase 7 §10 | Phase 7 (fee shown 17.50, recorded 0) |
| CF-018, CF-019 | Phase 3 FIN-10, FIN-11; Phase 4.5 E45-07, E45-08 | Phase 7 E18 (EOD) |
| CF-020, CF-021 | Phase 2 HSEC-03, HSEC-04; Phase 4.5 E45-09, E45-10 | static |
| CF-022 | Phase 2 HSEC-05; Phase 4.5 E45-11 | Phase 5 R1, R3; Phase 4 B8 |
| CF-023 | Phase 2 HSEC-06; Phase 6 INT-07 | Phase 6 (3 templates) |
| CF-024 | Phase 2 HSEC-07; Phase 4.5 E45-12 | static |
| CF-025 … CF-027 | Phase 7 UX-03, UX-02, UX-04 | Phase 7 E14, E8–E10, E10–E11 |
| CF-028 | Phase 4 DB-09; Phase 5 BG-09; Phase 8 INFRA-03 E5 | Phase 4 Redis experiment; Phase 5 X1 |
| CF-029 | Phase 9 PERF-01; Phase 4 DB-20 | Phase 4 P4-run; Phase 9 B5 |
| CF-030 | Phase 9 PERF-02 | Phase 9 B2, B3 |
| CF-031, CF-032 | Phase 8 INFRA-01, INFRA-02 | static |
| CF-033 … CF-035 | Phase 2 HSEC-18, HSEC-19, HSEC-20; Phase 8 INFRA-10 | static (likely) |

### 12.5 Code references re-verified in this phase

This phase re-read only the lines it cites itself; every other claim rests on the source report named in §12.4. All references below resolve in the working tree at `8846bce`, within file length, and the cited line contains the claimed code. A script resolved each `path:line` against `git ls-files` and printed the line for review.

| Reference | Content confirmed |
|---|---|
| `invoice.service.ts:209`, `installment.service.ts:166` | `const unitPrice = toDecimal(item.unitPrice)` (client price) |
| `Installments.tsx:449` | editable "سعر الوحدة" unit-price input on the installment form |
| `index.ts:258-428` | settings and related routes registered with `[authenticate]` only (first: `sub.get('/api/settings', …)`) |
| `apps/api/src/config/database.ts:11-15` | the PgBouncer "transaction pooling" recommendation comment |
| `invoice.service.ts:41-48` | unqualified raw SQL (`$queryRawUnsafe` on `invoices`) |
| `migrate-tenants.ts:76` | session advisory lock `pg_try_advisory_lock` |
| `admin.routes.ts:890` | `run-migrations` with `[requireOwner]` (the bare factory, HSEC-16) |
| `cost.test.ts:10-13` | test asserting the zero-cost WAC behaviour (FIN-23 rejection) |
| `tenant.middleware.ts:11,88` | `SUBSCRIPTION_EXEMPT_PREFIXES = ['/api/auth/', '/api/billing/']` and its use |
| `auth.routes.ts:309,337,383,612` | `/users`, `/roles`, `/audit-logs` under the exempt prefix (I-5) |

---

## 13. Audit declaration

| Statement | Status |
|---|---|
| Application source, tests, migrations, configuration, dependencies, deployment files modified | **No.** The only file written to the repository is this report. `git status` before and after: the same two pre-existing modified UI files and untracked `documents/` |
| Uncommitted changes preserved | **Yes** (`AppShell.tsx`, `POS.tsx` untouched) |
| Production or shared systems accessed | **No.** No database, Redis, provider or host was contacted in this phase. No command was executed against any service |
| Destructive operations | **None** |
| Fixes implemented | **None.** This is a plan, not an implementation |
| Severity labels trusted blindly | **No.** §4.2 changes six ratings with evidence and records the ratings reviewed and deliberately kept (11 canonical findings). §4.3 lists 15 conflicts and their resolution status |
| Original IDs discarded | **No.** 309 / 309 finding-class IDs, 62 unverified IDs, 25 documentation discrepancies, controls, attack paths and RC IDs are all traced (§12) |
| External provider features assumed absent because the repository lacks them | **No.** Paymob inquiry, recurring integration, callback contents, ETA behaviour, Resend idempotency, R2 settings and provider backups are recorded as unknowns with verification steps (PV-04, PV-10, PV-15 … PV-17) |
| Runtime vs static separated | **Yes:** evidence column in §3, §4.8, §12.4 |
| Benchmarks presented as production limits | **No.** Phase 9's numbers are referenced only as local measurements (§1.6, §8.4, §11) |
| Invented report contents, results, production conditions or dependencies | **No.** Every dependency in §6.2 cites its source report section; the dependencies Phase 10 itself derives (D-22, D-23) are marked with their §4 basis |
| Cited paths and line numbers verified | **Yes** for every reference this report cites (§12.5: 12 distinct references, 0 failures); references inside earlier reports were validated by those phases |
| Temporary files | session scratchpad only (`phase10/`: registry data, coverage and generator scripts, intermediate tables), deleted after the report was written |
| Production-safety claim | **None made.** Hesba is assessed as **not ready for release** at `8846bce`; §10.2 lists the evidence a release decision requires |

*End of Phase 10. Consolidation and planning only; no fix was implemented.*
