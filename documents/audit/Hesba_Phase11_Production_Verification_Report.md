# حِسبة (Hesba) — Phase 11: W0 Production Verification and Containment Planning

| Item | Value |
|---|---|
| Date | 2026-10-13 |
| Scope | **W0 only** of the Phase 10 roadmap (`Hesba_Phase10_Final_Consolidation_Roadmap.md` §7 W0): production checks PV-01 … PV-22 (§9), containment CT-1 … CT-8 (§4.6), the open item I-5 (§11). No remediation wave was started |
| Code baseline | branch `claude/ui-pos-merge-split` @ `8846bce` (`main` = `7317c97` = `8846bce~1`). The two pre-existing uncommitted UI edits and the untracked `documents/` folder were left untouched |
| Evidence window | 2026-10-13 **09:17:36Z – 09:46Z** (UTC), all from the auditor's workstation. The production-facing probes ran at 09:18–09:28; the GitHub deployment recount ran at ≈09:45 |
| Mode | Read-only. No session was opened on the production host, database or Redis. No Paymob, ETA, Resend, R2, Railway or Hostinger console was accessed. Nothing that changes state was executed anywhere (§2.2 lists every external command) |
| Status vocabulary | **VERIFIED**, **NOT VERIFIED**, **BLOCKED**, **NOT APPLICABLE** (defined in §3.1). Local or static evidence is labelled as such and is never counted as production verification |
| New IDs | Observations from this phase are **W0-01 … W0-08** (§3.5). They are proposals for the Phase 10 registry, which this report does not edit |

---

## 1. Bottom line

1. **Production could not be verified, and the attempt found an urgent anomaly (W0-01).** The machine answering SSH at the production IP presents **three new host keys** (ED25519, RSA and ECDSA). None of them matches the keys this workstation recorded for that IP. The SSH client refused to connect, and the check was not bypassed. At the same time **ports 80 and 443 accepted no TCP connection** (W0-02), so the web application was unreachable from here. Possible explanations are an OS reinstall or rebuild of the VPS, a different machine now holding the IP, or interception. This audit cannot tell which one it is. **Nobody should log into that host with a password until an operator has matched the fingerprints through the Hostinger console** (§7, C-0). Project notes say the database tunnel uses `root` with password authentication, and a password typed into an impostor host would be captured.
2. **Results of the 22 checks:**
   - **1 VERIFIED:** PV-22.
   - **3 NOT VERIFIED, with partial facts:** PV-01, PV-05, PV-14.
   - **15 BLOCKED.**
   - **3 NOT APPLICABLE:** PV-18, PV-20, PV-21.

   **None of PV-01 … PV-10 is answered**, and those ten answers are the W0 exit criterion.
3. **Whether automated card billing is live is UNKNOWN.** The billing workers start whenever the app process starts and do not need the web edge, so the outage on 80/443 does **not** show that billing stopped. CF-006 and CF-007 therefore stay **P0\* unresolved**. As Phase 10 §4.1 requires, they are handled as P1 plus a feature gate, and containment is still needed.
4. **Whether existing financial damage exists is UNKNOWN.** There is also a new and more basic question. If the host was reinstalled, the production database may no longer exist unless a provider backup does. **PV-04 (backups) is now the first data question**, ahead of damage sizing.
5. **I-5 is confirmed statically (W0-06).** A tenant whose latest subscription is `SUSPENDED` or `CANCELLED` can still:
   - log in;
   - list and create users;
   - list, create, edit and delete roles;
   - read the full audit log.

   Refresh is blocked, but a fresh login works. Non-auth routes return 402. Proposed severity: **P3** (§6).
6. **W1 readiness:** W1 **implementation** (code, review, CI, disposable stacks) may begin, except CF-033, which waits for PV-01. **No W1 production deployment** should happen until gates G-1 … G-7 are met (§9).
7. **Nothing was modified.** This file is the only file written (§12).

---

## 2. Access and method

### 2.1 Access identified

| Resource | Access available to this audit | How it was established (UTC) |
|---|---|---|
| Local clone of `azmiradi97/storify` | full read; all 8 remote heads present locally | `git ls-remote` + `git cat-file -e` (≈09:28Z) |
| GitHub repository metadata | read, through the operator's GitHub CLI session | `gh repo view`, deployments API, PR API (≈09:20–09:25Z) |
| Public DNS / WHOIS | yes | `dig`, `whois` (09:17:51Z, 09:28:31Z) |
| Public HTTP(S) of production | **no TCP connection** on 80 or 443 | `curl` (09:18:15Z with 15 s; 09:19:55Z with 30 s) |
| SSH to the production host | a key exists locally (no passphrase), but the **SSH client refused the host** because its key changed. Password authentication was not attempted; entering a password is outside this audit's rules | `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes … true` (09:23:26Z) |
| Production PostgreSQL / Redis | **none.** The repository compose publishes no DB or Redis port. Project notes say the database is reached only through an SSH tunnel; 5432 and 6379 were closed from here | TCP probe (09:19:21Z) |
| Railway | CLI installed, **not logged in** (`Unauthorized`) | `railway whoami`, `railway status` (≈09:21Z) |
| Hostinger hPanel, Paymob, Resend, Cloudflare R2, ETA, Sentry or other monitoring consoles | **none** available to this audit; not attempted | — |
| Certificate Transparency | crt.sh returned **502** twice and timed out once. CertSpotter's free endpoint returned `[]`, which is inconclusive | 09:24:43Z – 09:26:21Z |

### 2.2 Every command that touched something outside the local repository

| # | UTC | Target | What was done | Effect on the target |
|---|---|---|---|---|
| 1 | 09:17:51 | public DNS | A / CNAME / AAAA / NS / MX / TXT lookups for the apex, `www`, `api`, `app`, `admin` and one never-created random label | none |
| 2 | 09:18:15, 09:19:55 | `hesbaapp.com:443/80` | `GET /`, `/health`, `/internal/check-tenant` on the **apex only**. Both handlers are pure reads (`index.ts:166-191`) | none: no TCP connection was established |
| 3 | 09:19:21 | `72.61.163.235` | TCP connect probe to 22, 80, 443, 5432, 6379; controls: `example.com`, `api.github.com` (both HTTP 200) | none |
| 4 | 09:19:55 | `72.61.163.235:22` | read the SSH banner (no authentication) | a connection log line at most |
| 5 | 09:23:26 | `root@72.61.163.235` | key-only, `BatchMode=yes`, `StrictHostKeyChecking=yes`, remote command `true` | refused by the **client** before authentication (host-key mismatch) |
| 6 | 09:23:46 | `72.61.163.235:22` | `ssh-keyscan` (public host keys) | none |
| 7 | ≈09:20–09:25; recount ≈09:45 | GitHub API | repo metadata, environments, all 84 deployment records and their statuses, PR #2 / #4, open and merged PR lists | none |
| 8 | ≈09:21 | Railway API | `railway whoami`, `railway status` | none (`Unauthorized`) |
| 9 | 09:24:43 – 09:26:21 | crt.sh, CertSpotter | certificate-log queries for the public domain (aggregates only; no names printed) | none |
| 10 | 09:28:31 | DNS / WHOIS | reverse DNS of the IP; WHOIS of the IP and the domain | none |

### 2.3 Deliberately not done

- **No HTTPS request to any subdomain other than the apex.** The wildcard site uses Caddy on-demand TLS. Its ask endpoint approves any label (CF-035, `index.ts:186-191`), so a request to an unissued subdomain would make production request a certificate from the CA. That is a state change, and it uses up CA rate limits.
- **No acceptance of the changed host key.** No `StrictHostKeyChecking=no`, no password authentication, and no other way around the mismatch.
- **No authenticated API call, and no tenant or admin login.**
- **No provider console through any browser session** (the operator's Chrome sessions included).
- **No local harness run presented as production evidence.** I-5 rests on static evidence only.
- **Scratch files** (three API responses: one empty list and two 502 pages) were written to the session scratchpad outside the repository and **deleted** before this report was written.

---

## 3. PV-01 … PV-22 results

### 3.1 Status definitions

| Status | Meaning |
|---|---|
| **VERIFIED** | The check, or its decisive part, ran against the real system or its authoritative record. Evidence and a UTC time are given |
| **NOT VERIFIED** | Attempted. Some facts were established, but the question stays open |
| **BLOCKED** | Cannot be run with the access available, or running it would break a W0 rule (no state change, no Paymob/ETA requests, no password entry) |
| **NOT APPLICABLE** | Not a production verification: an owner decision, or a staging or device test. Deferred to the wave that owns it |

### 3.2 Summary

| Status | Count | PVs |
|---|---|---|
| VERIFIED | 1 | PV-22 |
| NOT VERIFIED (partial facts) | 3 | PV-01, PV-05, PV-14 |
| BLOCKED | 15 | PV-02, PV-03, PV-04, PV-06, PV-07, PV-08, PV-09, PV-10, PV-11, PV-12, PV-13, PV-15, PV-16, PV-17, PV-19 |
| NOT APPLICABLE | 3 | PV-18, PV-20, PV-21 |
| **Total** | **22** | |

**W0 exit criterion (Phase 10 §7 W0): "PV-01 … PV-10 answered." Result: 0 of 10.**

The root cause of 12 of the 15 BLOCKED results is W0-01. Every check that needs the host, the database or Redis goes through the SSH host, and its identity is currently unverified. The other three are PV-15 and PV-17, which need provider consoles, and PV-16, which W0 rules prohibit.

### 3.3 Results

| PV | Unknown (Phase 10 §9) | Status | Evidence (UTC) | Limitations | Unresolved, and the next read-only step (§8 step) |
|---|---|---|---|---|---|
| PV-01 | Hosting topology: VPS or Railway; replicas; proxy chain and `request.ip`; stop timeout | **NOT VERIFIED** | **DNS (09:17:51):**<br>• `hesbaapp.com` A `72.61.163.235`; `www` CNAME → apex;<br>• `api`, `app`, `admin` and a never-created random label all resolve to the same IP (wildcard);<br>• no AAAA record.<br>**Provider (09:28:31):**<br>• reverse DNS `srv1933246.hstgr.cloud` (a Hostinger VPS);<br>• NS `apollo`/`athena.dns-parking.com`;<br>• registrar Hostinger; domain created 2026-05-20.<br>**Railway (GitHub deployments API):**<br>• 84 deployment records in total;<br>• env `storify / production` (created by `railway-app[bot]`): 43 records, 2026-05-16 → 2026-05-23. 37 are **inactive**, the newest being `240fb96` (2026-05-20). 6 are **failure**, including the newest four (`e68d20a`, `b67cb1c`, `61f9adc`, `027fa0d`, all 2026-05-23);<br>• env `production` (created from a personal account, not a bot): 41 records, 2026-05-16 → 2026-05-18, **all failure** (newest `bf8a489`);<br>• no record is currently `success`, and DNS does not point at Railway.<br>**Ports (09:19:21):** 22 open; 80, 443, 5432 and 6379 accepted no connection (80/443 retried with 30 s at 09:19:55).<br>**SSH banner:** `OpenSSH_10.0p2 Debian-7+deb13u4` | A single vantage point. It cannot separate a host firewall, a stopped Caddy and a decommissioned stack. Replicas, proxy chain, the effective `request.ip` and `StopTimeout` all need the host. Production logs at `warn` level (`index.ts:44`), so the Phase 10 method "one request's logged `ip`" will not work; §8 step 8 uses `audit_logs.ip` instead | Is the Hesba stack running at all, and does anything serve the domain from somewhere else? Resolve W0-01 first (step 1), then steps 2–3 |
| PV-02 | Deployed commit vs `8846bce` | **BLOCKED** | **Only facts available:**<br>• the last Railway attempt was `027fa0d` (2026-05-23, **failed**), 61 commits behind `8846bce`;<br>• the last Railway deployment that did not fail was `240fb96` (2026-05-20), now inactive;<br>• CI (`.github/workflows/ci.yml`) has no deploy job: type-check, lint, test and build only. VPS deploys therefore leave no record on GitHub | The VPS commit is visible only on the host | `git -C <deploy dir> rev-parse HEAD`, run on the host. Project notes give the deploy dir as `/opt/hesba` (unverified). Step 3 |
| PV-03 | Deployed environment variables (presence only) | **BLOCKED** | Static only: `PAYMOB_*`, `RESEND_API_KEY`, `R2_*` and `APP_ENCRYPTION_KEY` are optional in `config/env.ts`, so presence must be checked on the host. **Added check (W0-03):** the repository is public, and its docs contain example JWT secret values. Production must be shown not to use them | needs the app container | Presence loop and placeholder comparison, printing booleans only. Step 4 |
| PV-04 | Backups and restore | **BLOCKED** | No Hostinger console access. The repository has no backup configuration (Phase 8 INFRA-01), but that does not show the provider has none. **W0-01 raises the stakes:** if the VPS was reinstalled, the `postgres_data` volume may be gone | needs hPanel and the host | hPanel → VPS → Backups / Snapshots (list, newest timestamp); `docker volume ls`; then CT-4. Steps 1, 2, 7 |
| PV-05 | Monitoring outside the repository | **NOT VERIFIED** | The GitHub repository holds only the CI workflow: no uptime or scheduled checks, and no deploy hooks. Sentry activates only if `SENTRY_DSN` is set (`sentry.plugin.ts:10`); that is unknown | External monitors (Hostinger, UptimeRobot, Sentry) are not visible to this audit | **De-facto alert test:** if 80/443 are down for every user (W0-02), has anyone been alerted? If nobody was, that is production evidence for CF-032. Owner to answer. Step 1 |
| PV-06 | PostgreSQL limits, roles, peak connections | **BLOCKED** | — | needs a database session | Step 5 |
| PV-07 | Redis persistence, `maxmemory`, auth, schedules, orphan locks | **BLOCKED** | Static: queues `renewal`, `dunning`, `trial-expiry`, `installment-reminders`, `eta-submissions`; lock keys `lock:*` (`shared/utils/lock.ts:16`) | needs Redis | Step 5 |
| PV-08 | Tenant schema versions; NOT VALID CHECK violations; ETA columns | **BLOCKED** | `/health` would expose the migration status (`index.ts:166-183`), but it was unreachable. The latest tenant migration in the repository is `017_cost_at_sale.sql` | needs a database session | Step 8, on the restored copy |
| PV-09 | Existing damage | **BLOCKED** | — (§5) | needs a database session and the Paymob dashboard | Steps 6 and 8 |
| PV-10 | Billing in reality | **BLOCKED** | Static preconditions only (§5.1). **New fact (W0-04):** every payment attempt is written with `attempt_type = 'initial'` (`billing.service.ts:153,233`). This covers renewal and dunning, so the database **cannot** tell job charges from checkout charges, and CF-006 can leave a charge with no row at all. **The Paymob dashboard is the only authoritative source** | needs the database and the Paymob dashboard. The sandbox part (U6-01, U6-02, U6-04, U5-02) is a Paymob request and is prohibited in W0 | Step 6 |
| PV-11 | Feature usage | **BLOCKED** | — | needs a database session | Step 8 |
| PV-12 | Scale | **BLOCKED** | — | needs a database session and access logs | Step 8 |
| PV-13 | Host resources, container TZ, Node heap | **BLOCKED** | Static: neither the Dockerfile nor `docker-compose.prod.yml` sets `TZ`. If the host does not override it, the cron times below run in **UTC** | needs the host | Step 3 |
| PV-14 | Edge: wildcard DNS, certificates, Caddy limits, CSP served | **NOT VERIFIED** | **VERIFIED part:** wildcard DNS (a random, never-created label resolves to the host). **Not verified:**<br>• certificates: 443 unreachable; crt.sh 502 / timeout; CertSpotter `[]`, which is inconclusive;<br>• the CSP actually served;<br>• Caddy on-demand limits.<br>Static: `check-tenant` returns 200 for any `*.APP_BASE_DOMAIN` label (`index.ts:189`) | Random-subdomain HTTPS was **deliberately not attempted** (§2.3) | `caddy list-certificates` or `ls` of `caddy_data` on the host; header check once the apex answers. Step 3 |
| PV-15 | R2 bucket | **BLOCKED** | — | Cloudflare console not available | Cloudflare dashboard, read-only |
| PV-16 | ETA preprod behaviour | **BLOCKED** | — | W0 rules forbid ETA requests; needs ETA preprod and a test certificate. This is the W11 gate | Defer to W11 |
| PV-17 | Resend | **BLOCKED** | — | Resend console not available | Resend dashboard, read-only |
| PV-18 | Browsers and devices | **NOT APPLICABLE** | — | a staging device matrix, not production | Defer to W9 / W12 |
| PV-19 | PostgreSQL version; app↔DB and app↔Redis RTT | **BLOCKED** | The repository compose pins `postgres:16-alpine` and `redis:7-alpine` (static; the deployed images are unverified) | needs the host | Steps 3, 5 |
| PV-20 | Checkout offered to `ACTIVE` subscriptions | **NOT APPLICABLE** (staging walkthrough) | **Static, not production (W0-07):**<br>• the billing UI shows checkout only when `needsPayment`, i.e. TRIALING, PAST_DUE, SUSPENDED or CANCELLED (`Settings.tsx:389-390, 444`), so **not** to ACTIVE;<br>• `POST /api/billing/checkout` has **no subscription-status guard**, only `billing:create` (`billing.routes.ts:65-68`);<br>• the UI therefore invites checkout in **PAST_DUE and SUSPENDED**, exactly the states in which dunning may also charge the saved card (CF-007 overlap) | static only | Staging walkthrough; W6 |
| PV-21 | Owner decisions | **NOT APPLICABLE** (decisions) | None recorded (§9.3 lists them) | — | Owner, plus a tax advisor where noted |
| PV-22 | Out-of-series PRs; is unmerged work deployed | **VERIFIED** (≈09:24, GitHub API) | • **PR #2** "ETA-01: reconcile e-invoice payload…": **OPEN, not merged**; head `claude/eta-01-preprod` @ `3819976`; last updated 2026-09-08.<br>• **PR #4** "SEC-03 follow-up…": **MERGED** 2026-09-09T16:04:24Z.<br>• **PR #31** (this branch, `8846bce`): **OPEN**.<br>• `main` = `7317c97` (PR #30 merged 2026-09-11) | Whether any of this is deployed depends on PV-02 | — |

### 3.4 Supplementary checks (not numbered PVs)

| # | Check | Status | Evidence | Limitation |
|---|---|---|---|---|
| S-1 | CT-6 read-only check: was `.env.production` ever committed? | **VERIFIED for the repository**; NOT VERIFIED on the host | `git log --all` over all 8 remote heads (the branch tips match `ls-remote`):<br>• a **root `.env.production` was never committed**;<br>• the only tracked env file is `apps/web/.env.production` (added in `f75aea6`, 2026-07-10). It holds one public build variable, `VITE_BASE_DOMAIN`.<br>CF-048 is **statically confirmed**:<br>• `.gitignore` covers `.env`, `.env.local` and `.env.*.local`, but **not** `.env.production`;<br>• `.dockerignore` covers only `**/.env` and `**/.env.local` | The host working tree and the built image are unverified (§8 step 4) |
| S-2 | Repository visibility | **VERIFIED: PUBLIC** (`gh repo view`) | `azmiradi97/storify` is public | — |
| S-3 | Secret-shaped strings in the git history (names only; values never printed) | **VERIFIED: no live secrets found by the patterns used** | 9 hits in 8 files across 5 commits, all placeholders or non-secrets:<br>• `.env.example` JWT values begin `change…`;<br>• the `documents/Claude_Code/*` JWT examples contain placeholder words;<br>• R2 and `APP_ENCRYPTION_KEY` examples are empty;<br>• `Settings.tsx` holds the input placeholder text `-----BEGIN PRIVATE KEY-----`, not key material;<br>• one skill reference file has an example database URL.<br>No Paymob- or Resend-shaped key and no private-key material | Pattern-based, not a full scanner (e.g. gitleaks), so absence is **not proven** |
| S-4 | Static I-5 analysis | done | §6 | static only |

### 3.5 New observations from W0 (proposed for the Phase 10 registry)

| ID | Observation | Evidence | Status | Proposed treatment |
|---|---|---|---|---|
| **W0-01** | **The production host's SSH identity changed.** All three host keys differ from those recorded for `72.61.163.235`. | **Recorded:**<br>• ED25519 `SHA256:zvjy+rFxk77S0FANZE0tfLYnaVNArEc+ypz7X8rbsEQ`<br>• RSA `SHA256:ib3ksiQL99TQ/SwU/u8R+R6GYboEGrfqm2lFxDb7ClA`<br>• ECDSA `SHA256:rKRi7oAKZfFWcE1vOZVZvptDYDNRGl+HTdnc6x1BRok`<br>**Presented at 09:23:46:**<br>• ED25519 `SHA256:eqUsbStihfg6wct6zudsnhjMnNpW0wXvMy/7NQ0hTWM`<br>• RSA `SHA256:g3OFvqcVI+xr245DXdeX8sDoSsK3+JK0eU9EDtvUFuw`<br>• ECDSA `SHA256:es2t0FIdau+cCcLi+nHoVGmtVXDXd94XeyvWhu173zQ`<br>`known_hosts` was last modified 2026-09-26, so the old keys were recorded on or before that date. Host-key fingerprints are public, not secrets | VERIFIED (the mismatch). The cause is NOT VERIFIED | **Operational incident candidate, priority 1 for W0.** Possible causes: (a) an OS reinstall or rebuild; (b) a different machine on the IP; (c) interception. Consequences: every host check is blocked; **data loss** if (a) happened without a backup; **credential capture** if anyone logs in with a password without verifying. C-0 (§7) |
| **W0-02** | **The production web edge was unreachable from the audit vantage point.** 80 and 443 accepted no TCP connection, while 22 did and general egress worked | §3.3 PV-01 (09:18:15, 09:19:21, 09:19:55) | VERIFIED for this vantage point and time only | If this holds for everyone, **no tenant can use Hesba now**. Owner to confirm from another network or a monitor. Do **not** restart or redeploy to "fix" it before C-0 and C-1 (§7, C-4) |
| **W0-03** | **The repository is public.** Every value in its docs is public, and an accidental commit of the host's `.env.production` (not git-ignored, CF-048) would publish production secrets | S-1, S-2, S-3 | VERIFIED | Raises the priority of CF-048 (W1) and adds a check that production JWT secrets are not the documented examples (PV-03 add-on, §8 step 4) |
| **W0-04** | **Payment attempts are indistinguishable by origin.** Checkout, renewal and dunning all write `attempt_type = 'initial'` | `billing.service.ts:153, 233`; `renewal.job.ts:5` and `dunning.job.ts:5` import those writers | VERIFIED (static) | Damage sizing for CF-006/CF-007 cannot rely on the database. Reconcile against the Paymob dashboard. Fold into CF-039 / T-22 (W6) |
| **W0-05** | **Billing workers start independently of the web edge and of Paymob configuration.** All five workers start, and four repeatables are registered, on every boot | `index.ts:500-508`; cron `0 6` (trial-expiry), `0 7` (renewal), `0 8` (dunning), `0 9` (reminders), in the process TZ | VERIFIED (static) | W0-02 does **not** show that billing stopped. Removing the repeatables from Redis would be undone at the next boot. Only a queue-level pause, which no code resumes, would last, and it must be rehearsed first (§7, C-3) |
| **W0-06** | I-5 confirmed: subscription suspension does not cover `/api/auth/*` user, role and audit-log routes | §6 | VERIFIED (static) | Candidate finding, **P3**, RC-02 / RC-10. W3 (route registration) or W6 (lifecycle policy) |
| **W0-07** | The checkout route has no subscription-status guard. The UI invites checkout in PAST_DUE and SUSPENDED while dunning may also charge | §3.3 PV-20 | VERIFIED (static) | Merge into CF-007 (W6); frequency input for PV-20 |
| **W0-08** | Production logs at `warn`, so request IPs are not logged | `index.ts:44` | VERIFIED (static) | The PV-01 `request.ip` check must use `audit_logs.ip` (§8 step 8) or a staging probe |

---

## 4. Production architecture and deployment facts

Only what was established is stated as fact. Everything else is marked.

| Fact | Status | Evidence |
|---|---|---|
| Public entry points: `hesbaapp.com`, `www` (CNAME) and the wildcard `*.hesbaapp.com` resolve to **one IPv4, `72.61.163.235`**; there is no IPv6 | **VERIFIED** | DNS, 09:17:51 |
| Provider: a **Hostinger VPS** (`srv1933246.hstgr.cloud`). DNS hosted at Hostinger; registrar Hostinger; domain created 2026-05-20 | **VERIFIED** | rDNS / WHOIS, 09:28:31 |
| The machine **currently** at that IP runs Debian 13 (`OpenSSH_10.0p2 Debian-7+deb13u4`) | **VERIFIED** for the machine now at the IP. W0-01 means it may not be the machine recorded before | banner, 09:19:55 |
| Railway hosted "storify / production" from 2026-05-16 to 2026-05-23: 43 records, 37 inactive and 6 failed. The newest non-failed deployment is `240fb96` (2026-05-20), and every later one failed. A second environment, `production`, has 41 records, all failed (2026-05-16 → 2026-05-18). No deployment is active, and DNS does not point at Railway | **VERIFIED** (history). The current Railway project state is NOT VERIFIED (no Railway login) | GitHub deployments API. CF-152 (Railway restart policy) probably does not apply to the live path; pending PV-01 |
| Intended VPS deployment, per the repository: `docker-compose.prod.yml` runs four services:<br>• `postgres:16-alpine`, with no published port;<br>• `redis:7-alpine` with `--requirepass`, no published port;<br>• `app`, built **on the host** from `Dockerfile`, with `env_file: .env.production`;<br>• `caddy:2-alpine` on 80/443, with on-demand TLS for the wildcard. | **Repository fact (static).** Production NOT VERIFIED | `docker-compose.prod.yml`, `Caddyfile` |
| The host compose has drifted from the repository at least once. Project notes record a host-side edit that publishes Postgres on `127.0.0.1:5432`; the repository file does not have it | **NOT VERIFIED** today (project notes, not an audit report) | step 3 compares the two |
| CI/CD: GitHub Actions **CI only** (type-check, lint, test, build) on pushes to `main` / `claude/*` and on PRs. **No deploy job**, so VPS deployments are manual | **VERIFIED** | `.github/workflows/ci.yml`; deployments API |
| Deployed commit | **NOT VERIFIED** (BLOCKED) | PV-02 |
| Background work: one process runs HTTP and all five workers. Cron in the process TZ: trial-expiry 06:00, renewal 07:00, dunning 08:00, reminders 09:00. No `TZ` is set in the image or compose, so this is **UTC unless the host overrides it**. At UTC+3, which Egypt observes on 2026-10-13, that is 09:00–12:00 local time | **VERIFIED (static)**; container TZ NOT VERIFIED | `index.ts:500-508`; `*.job.ts` repeat patterns |
| Reachability at 09:18–09:20: SSH reachable; **80/443 not reachable** from the audit vantage point | **VERIFIED** for that vantage point and time | W0-02 |

---

## 5. Live billing exposure and possible existing damage

### 5.1 What has to be true for a card to be charged automatically (static, `8846bce`)

1. **The app process runs.** Workers start on every boot (`index.ts:500-508`). They need **neither Caddy nor ports 80/443**, so a down web edge stops new checkouts but not renewal or dunning.
2. **Redis is reachable.** The repeatables live in BullMQ.
3. **Paymob credentials are configured.** `PAYMOB_API_KEY` and `PAYMOB_INTEGRATION_ID_CARD` are optional in `env.ts:39-44`, and `paymob.client.ts:42,83` uses them.
4. **At least one subscription can be charged:**
   - renewal needs `status = 'ACTIVE'`, `current_period_end <= now()`, a non-null `provider_card_token`, `cancel_at_period_end = false` and `failed_attempts = 0` (`renewal.job.ts:76-83`);
   - dunning selects `ACTIVE`, `PAST_DUE` or `SUSPENDED` with a token (`dunning.job.ts:76`).
5. **A token exists only after a successful Paymob checkout whose callback carried one.** Whether it does is I-1 / U6-01, still unknown.

The decisive evidence is therefore:
- the count of subscriptions holding a token, by status;
- payment attempts per day for the last 90–120 days;
- **the Paymob dashboard**, which W0-04 makes the only authoritative source.

None of it was accessible.

### 5.2 Assessment from accessible evidence

| Question | Assessment | Basis |
|---|---|---|
| Is automated card billing live? | **UNKNOWN** | No database, Redis, environment or Paymob access (§3.3 PV-03, PV-07, PV-10) |
| Does W0-02 (web down) mean billing stopped? | **No** | W0-05. Only if the **app container** is stopped, or the host was rebuilt without the stack being redeployed, did billing stop |
| Severity handling of CF-006 / CF-007 | **Unchanged:** P0\* conditional. Handled as P1 plus the automated-billing feature gate, with **containment still required** (Phase 10 §4.1, §4.5) | PV-10 is unanswered |
| Have customers already been double-charged (CF-006), or charged for paid or cancel-scheduled periods (CF-007)? | **UNKNOWN** | Needs Paymob vs database reconciliation. The database alone undercounts, because CF-006 can produce a charge with no row and W0-04 makes rows indistinguishable by origin |
| Store-level financial damage: VAT not collected at the POS (CF-002), refunds mis-computed (CF-003), phantom stock (CF-004), negative balances, duplicate schedules and over-receipts (CF-011 … CF-015) | **UNKNOWN** | Needs the Phase 4 §38 detection queries, preferably on a **restored copy** (§8 step 8) |
| Has production data been lost? | **UNKNOWN, and newly plausible** | W0-01 (a). Determining this comes **before** damage sizing: damage cannot be measured in data that no longer exists, and cleaned data cannot be restored without a backup |

### 5.3 How the evidence would change the decision

| Evidence (operator, §8) | Conclusion | Consequence |
|---|---|---|
| No subscription holds a token, **and** the Paymob dashboard shows no token or recurring charges in 90 days | Automated card billing is **not live** | CF-006 … CF-010 stay RB\* / feature gate (W6). CT-2 is not triggered. Keep billing gated until W6 passes |
| Tokens exist, but there are no charges in 90 days | Billing is **armed but idle**: charges start the moment a period ends | Decide on C-3 **before** the next period end. Find the nearest `current_period_end` among tokenised `ACTIVE` subscriptions (§8 step 6) |
| Token or recurring charges appear in Paymob, or `SUCCESS` / `FAILED` rows cluster at the 07:00 / 08:00 container-TZ hours | Billing **is live** | CF-006 and CF-007 are **P0**. Owner decision on C-3 (pause), 90-day reconciliation (CT-2). W6 becomes a release blocker |
| More than one `SUCCESS` per subscription per month, or Paymob charges with no matching row | **Possible double charges** | Owner decision on customer remediation. Refunds and contact are outside W0 and need owner authorisation |
| The host was reinstalled and **no** provider backup exists | **Data loss** | An incident outside the remediation plan. Every wave's rollout gate (D-3) becomes unmeetable until a new baseline exists |

---

## 6. I-5: does the suspension gate exemption reach users, roles and audit logs?

**Method:** static evidence only, as the brief requires. Nothing was run against production or a local harness.

### 6.1 Evidence

| # | Fact | Location |
|---|---|---|
| 1 | `SUBSCRIPTION_EXEMPT_PREFIXES = ['/api/auth/', '/api/billing/']` | `tenant.middleware.ts:11` |
| 2 | The exemption is a prefix test on the raw `request.url`: `SUBSCRIPTION_EXEMPT_PREFIXES.some((p) => request.url.startsWith(p))` | `tenant.middleware.ts:88` |
| 3 | For non-exempt routes, the latest subscription status `SUSPENDED` or `CANCELLED` → **402** (cached 30 s) | `tenant.middleware.ts:89-113` |
| 4 | A tenant whose **tenant** status is not `ACTIVE` (admin suspension, `admin.routes.ts:295`) gets **404 on every route, `/api/auth/*` included** | `tenant.middleware.ts:77-82` |
| 5 | Auth routes are registered under `/api/auth` inside the tenant-middleware scope | `index.ts:239-240` |
| 6 | `POST /login` has **no subscription check** | `auth.routes.ts:48-88` |
| 7 | `POST /refresh` **does** refuse `SUSPENDED` / `CANCELLED`: 402, the token is invalidated and the cookie cleared. Its comment states the intent: "otherwise a SUSPENDED/CANCELLED tenant can extend its session indefinitely" | `auth.routes.ts:112-130` |
| 8 | Exempt as a result:<br>• `GET /users` (`users:read`) and `POST /users` (`users:create` + plan limit);<br>• `GET /roles` (any authenticated user);<br>• `POST /roles`, `PATCH /roles/:id`, `DELETE /roles/:id` (`users:update`);<br>• `PATCH /me/password`;<br>• `GET /me`, `GET /me/usage`;<br>• `GET /audit-logs` (`users:read`, paginated over the whole tenant audit history) | `auth.routes.ts:237, 280, 309, 337, 383, 398-400, 469-471, 532-534, 577, 612` |
| 9 | Access tokens live **15 minutes** by default; login is rate-limited to 10 per minute | `env.ts:24`; `auth.routes.ts:49` |
| 10 | The router cannot be used to reach **non-auth** routes through the exempt prefix: `find-my-way@8.2.2` does not remove dot segments and does not decode `%2F` (`lib/url-sanitizer.js`); routing is case-sensitive; no `ignoreTrailingSlash` / `ignoreDuplicateSlashes` options are set | `node_modules/.pnpm/find-my-way@8.2.2/…/url-sanitizer.js:4-73`; Fastify 4.29.1; `index.ts` sets no router options |
| 11 | The web client has no 402 handling (no match for `402` / `subscription_inactive` in `apps/web/src`) | consistent with CF-083 |

### 6.2 Conclusion

**Confirmed (static).** When a tenant's latest subscription is `SUSPENDED` or `CANCELLED` and the tenant row is still `ACTIVE`, its users can still:
- log in, as often as needed. Each login gives a 15-minute access token. Refresh is refused, but a fresh login replaces it;
- list users, and create users up to the plan limit;
- list, create, edit and delete custom roles;
- read the tenant's **entire audit log**. Because of CF-065 the audit log also holds the customer-credit and loyalty ledger;
- change their own password, and read `/me` and `/me/usage`.

Every other tenant route (sales, stock, reports, customers, settings, and so on) returns 402. Admin-level tenant suspension blocks everything, `/api/auth/*` included.

The gate cannot be stretched to non-auth routes through path tricks (evidence #10). This is static reasoning; it is not a test.

### 6.3 Impact and proposed severity: **P3** (candidate finding W0-06)

- **No money moves, and no tenant boundary is crossed.** All data reached is the tenant's own.
- The refresh-route comment shows the exemption is wider than intended. The login exemption ("so users can still log in to pay") silently brings user, role and audit-log management with it.
- **Business impact depends on owner policy** (PV-21). Should a suspended or cancelled store keep read access to its own history, a data-portability question? Should it be able to create accounts while unpaid?
- **Root causes:** RC-02 (subscription state model) and RC-10 (opt-in authorisation by route).

### 6.4 Recommended handling (no change made)

1. Record the policy decision under PV-21.
2. Replace the prefix list with an allow-list of **exact** routes needed while suspended: login, logout, me, me/usage, billing. Do it in W3 (default-deny route registration, T-10) or W6 (subscription lifecycle, T-24).
3. Add a regression test: with the subscription `SUSPENDED`, `GET /api/auth/audit-logs` and `POST /api/auth/users` return 402, while login and billing still work.
4. A runtime check on a disposable local stack is still outstanding. It belongs to that wave's tests, not to production verification.

---

## 7. Containment recommendations (prioritised; **none was executed in this phase**)

Each item keeps the Phase 10 CT ID it extends. Two items (C-0, C-9) are new because of W0-01. "Operator" means a person with authorised access to the Hostinger account, the host, the database and the Paymob account. "Owner" means the person accountable for the business, its money and its tenants.

### 7.1 Overview

| Priority | ID | Action | Phase 10 link | Kind | Executed in W0 |
|---|---|---|---|---|---|
| 1 | **C-0** | Verify the host's identity and history through the Hostinger console before anyone logs in | new (W0-01) | read-only | **No** |
| 2 | **C-4** | Change freeze: no deploy, restart, rebuild, `docker compose up` or OS action on production until C-0 and C-1 are done. After that, none during the billing window | CT-3, extended | procedural | **No** |
| 3 | **C-1** | Establish whether the production data and any provider backup exist. Then take a fresh backup and restore it into an **isolated** instance | CT-4, PV-04 | read-only on production; writes only off-host | **No** |
| 4 | **C-2** | Establish whether automated card billing is live: database counts plus the Paymob dashboard | CT-1, PV-10 | read-only | **No** |
| 5 | **C-3** | **Conditional:** pause the `renewal` and `dunning` queues, or keep them under manual review, until W6 | CT-2 | **state-changing**; owner decision | **No** |
| 6 | **C-9** | **Conditional:** if C-0 shows an unexplained identity change, treat it as a compromise and rotate credentials | new (W0-01) | **state-changing**; owner decision | **No** |
| 7 | **C-6** | Secrets hygiene: confirm `.env.production` on the host is untracked, uncommitted and outside images; confirm production JWT secrets are not the documented examples | CT-6, W0-03 | read-only check, then a W1 code change | **No** |
| 8 | **C-5** | Size existing damage with the Phase 4 §38 queries, **on the restored copy** | CT-5, PV-09 | read-only (copy) | **No** |
| 9 | **C-7** | Owner-led review of who holds settings, billing and coupon capability in each tenant | CT-7 | tenant-side administration | **No** |
| 10 | **C-8** | Tell tenants not to sell with the seeded cashier role until W1 (CF-025) | CT-8 | communication | **No** |
| 11 | **C-10** | Decide **how and when** to restore web availability (W0-02) | new (W0-02) | **state-changing**; owner decision | **No** |
| — | I-5 | No containment needed (P3, own data only). Policy decision under PV-21 | I-5 | — | — |

### 7.2 Details

| ID | Trigger condition | Expected benefit | Risk | Reversibility | Required authorisation | Exact verification **before** execution |
|---|---|---|---|---|---|---|
| **C-0** Verify host identity | **Now.** W0-01 was observed at 09:23:26Z | • Prevents typing the root password into an impostor host.<br>• Establishes whether the VPS was rebuilt, and when.<br>• Unblocks 12 PVs | None. The provider console's browser terminal and the activity log are read-only | n/a | Holder of the Hostinger account (owner or operator) | In hPanel → VPS:<br>1. Read the OS, the **reinstall / activity history**, and the snapshot and backup list.<br>2. In the provider's browser terminal: `for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$f"; done`.<br>3. Compare with the **presented** (new) fingerprints in W0-01 (§3.5).<br>**Console matches the presented keys, and a reinstall or rebuild by an authorised person explains it:** update `known_hosts` deliberately, then proceed with §8.<br>**Console matches the presented keys, but nothing explains the change; or the console does not match the presented keys** (a different machine answered): go to C-9 |
| **C-4** Change freeze | **Now**, until C-0 and C-1 are complete. After that, permanently during the billing window (06:00–09:30 in the container TZ) until CF-044 and CF-006 are fixed | • Every container start runs `prisma migrate deploy` plus the master seed, and the app runs tenant migrations at boot (`Dockerfile:88`; `index.ts:484`, CF-045). A restart before a backup applies **irreversible** schema changes.<br>• A stop during a cycle can produce CF-006 double charges (INFRA-04: killed at 3.1 s against a 25 s drain) | Prolongs W0-02 (the outage) if the web edge is really down for users | Fully reversible (procedural) | Owner | Confirm who can deploy (all host and Hostinger users), and announce the freeze to them |
| **C-1** Data existence, backup, restore drill | After C-0 confirms the host | • Answers PV-04 and the data-loss question (§5.2).<br>• Creates the restore point that D-3 needs before **any** later data change | • `pg_dump` loads production and holds `ACCESS SHARE` locks, which blocks DDL, including boot migrations.<br>• Writing the dump to the host disk can **fill the disk**.<br>• The dump holds every tenant's personal data and `provider_card_token` values.<br>• **Never start the Hesba API or workers against the restored copy with production environment variables:** its renewal and dunning workers would charge real cards | • The dump is a read on production.<br>• The restore lives elsewhere and can be deleted | Owner (data custody), operator (execution) | • `df -h` on the host, and `SELECT pg_size_pretty(pg_database_size('hesba_master'))`; free space at least 2× the database size, or stream the dump off-host.<br>• Run outside the billing window.<br>• Destination encrypted and access-limited; retention agreed.<br>• Restore target: a **bare** PostgreSQL 16 with no Hesba app attached and no outbound credentials |
| **C-2** Is billing live? | After C-0 | Decides between P0 and P1 for CF-006 … CF-010 and whether C-3 is needed (§5.3) | • Low; the queries are small and touch master tables only.<br>• `provider_response` holds payment data: **do not select it**, count only | n/a | Operator (database + Paymob read-only) | Run §8 step 6 in a `BEGIN READ ONLY` transaction. In Paymob: list transactions for the last 90 days, filtered to token, recurring or MOTO charges and the configured integration ids. Record counts per day only |
| **C-3** Pause renewal and dunning | **Only if** C-2 shows live or armed billing, **and** the owner chooses safety over collection | Stops new CF-006 / CF-007 charges until W6 | • **Revenue collection stops.** Subscriptions past period end stay `ACTIVE` unpaid, because expiry depends on a charge (CF-010).<br>• Trial expiry and reminders keep running.<br>• **Resuming catches up on every overdue period at once**: renewal selects `current_period_end <= now()`. That is the CF-007 stale-state pattern at scale.<br>• Removing the repeatable jobs from Redis does **not** last, because each boot re-registers them (`index.ts:502-508`, W0-05) | • A queue-level pause is reversible with a resume.<br>• No code calls pause or resume (verified by search). A pause should therefore last across app restarts; the rehearsal must confirm this. It does **not** last across Redis data loss (RDB-only, CF-046) | **Owner** (business trade-off) plus the operator | • Rehearse the pause and resume on a **disposable** stack with the same BullMQ version, and confirm the repeatable does not run while paused.<br>• Production: no cycle in progress (no `lock:*` keys; outside the window).<br>• Queue names confirmed (`bull:renewal:*`, `bull:dunning:*`).<br>• After: no new token charges in Paymob at the next 07:00 / 08:00.<br>• **Before any resume:** reconcile, and list the subscriptions that would be charged |
| **C-9** Credential rotation after a suspected compromise | C-0 finds a host-key change with **no** explained reinstall, or a different machine | Limits damage from a possible intrusion or impersonation | • Rotating JWT secrets logs every user out.<br>• Rotating `APP_ENCRYPTION_KEY` / `ETA_ENCRYPTION_KEY` **without re-encrypting** stored ETA credentials makes them unreadable.<br>• Paymob key and HMAC rotation must be coordinated with the dashboard, or webhooks fail closed | Mostly irreversible (new secrets) | Owner | • Inventory of every secret in `.env.production` (names only).<br>• A re-encryption plan for encrypted columns.<br>• A Paymob coordination plan.<br>• Use the provider console only; no password SSH |
| **C-6** Secrets hygiene | After C-0 | Closes the public-repository path for production secrets (W0-03, CF-048) | None for the checks. The `.gitignore` / `.dockerignore` change is a W1 code change | n/a (checks) | Operator (checks); W1 PR review (code) | §8 step 4. Booleans only; never print a value |
| **C-5** Damage sizing | After C-1's restore succeeds | • Answers PV-09 and PV-11.<br>• Produces the cleanup list that must precede constraint validation (D-2) | The copy holds personal data (same custody as C-1). The shared report carries **counts only** | n/a (read-only) | Owner (data custody) | Run on the restored copy, not production; §8 step 8 |
| **C-7** Access review | After C-2 | Reduces CF-005, CF-020 and CF-021 exposure until W3 | Tenants may lose convenience | Reversible by tenant admins | Owner; tenant owners act | Operator aggregate: for each role holding a `settings`, `billing` or `coupons` write permission, the number of active users holding it (counts per tenant in a restricted worksheet) |
| **C-8** Cashier guidance | Any time | Stops cashiers getting stuck at the POS (CF-025) | Wider roles grant more (CF-005); pair it with C-7 | n/a | Owner | None |
| **C-10** Restore web availability | Only if the owner confirms W0-02 affects users, **and** C-0 and C-1 are done | Tenants can work again | • A redeploy runs boot migrations (CF-045).<br>• Deploying `8846bce` ships every P0 in §4.5, including the ones already live.<br>• Restarting in the billing window risks CF-006 | Not reversible after migrations, unless restored from C-1 | Owner | • PV-02: is the deployed commit known, and is the diff to the candidate reviewed?<br>• C-1 backup exists.<br>• Outside the billing window.<br>• Preferably **restart the existing image** rather than build a new tree |

---

## 8. Minimum read-only checks for an authorised operator

Production access was not available to this audit. The steps below are the **minimum** an authorised operator must run to close W0. Run them in this order: each step unblocks the next.

### 8.0 Ground rules (all steps)

- **Read-only database work:**
  - every SQL session starts with `BEGIN READ ONLY;` and ends with `ROLLBACK;`;
  - never select `provider_card_token`, `provider_response`, password hashes, e-mail addresses or names;
  - print **counts and dates**.
- **Restricted worksheet:** per-tenant results go into a restricted worksheet. The shared W0 record holds totals and the **number** of affected tenants only.
- **Secrets:** print `set` / `unset` or `match` / `no match`. Never print a value, and never paste one into a ticket or chat.
- **No restarts, no `docker compose up`, no deploys** (C-4). Stay outside **06:00–09:30 in the container TZ** (step 3 tells you the TZ).
- **Recording:** for each step, record the UTC time, the person, and the command output (redacted). The roadmap requires this (Phase 10 §10.2 #3).

### 8.1 Steps

**Step 1: host identity, history and backups (C-0, PV-04, PV-05). Hostinger hPanel and the provider's browser terminal only. No SSH yet.**

```sh
for f in /etc/ssh/ssh_host_*_key.pub; do ssh-keygen -lf "$f"; done
date -u; uptime; head -3 /etc/os-release
```

- Compare with the six fingerprints in W0-01 (§3.5).
- In hPanel, record:
  - the VPS OS-reinstall and activity history;
  - the snapshot and backup list, with the **newest timestamp** and whether backups are automatic;
  - any provider monitoring or alert settings.
- **Owner question:** has anyone received an alert, or a customer report, about W0-02?

**Step 2: stack state (host, read-only).** Proceed over SSH only after step 1 shows a match.

```sh
docker ps -a --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.CreatedAt}}'
docker volume ls --format '{{.Name}}' | grep -E 'postgres_data|redis_data|caddy_data'
ss -ltn | awk 'NR==1 || /:(22|80|443|5432|6379) /'
(command -v ufw >/dev/null && ufw status) ; nft list ruleset 2>/dev/null | grep -cE 'dport (80|443)'
crontab -l 2>/dev/null; ls /etc/cron.d 2>/dev/null; systemctl list-timers --all 2>/dev/null | head -15
```

Expected record:
- whether `hesba_app`, `hesba_postgres`, `hesba_redis` and `hesba_caddy` exist and are running;
- whether the data volumes exist;
- why 80/443 are closed (W0-02): no listener, or a firewall;
- any backup cron or timer.

**Step 3: topology, deployed version, resources, edge (PV-01, PV-02, PV-13, PV-14, PV-19).**

```sh
D=$(docker inspect hesba_app --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'); echo "deploy dir: $D"
git -C "$D" rev-parse HEAD; git -C "$D" log -1 --format='%h %ci %s'; git -C "$D" status --porcelain | wc -l
git -C "$D" diff --stat HEAD -- docker-compose.prod.yml Caddyfile Dockerfile      # host drift vs its own checkout
git -C "$D" merge-base --is-ancestor HEAD 8846bce && echo "deployed commit is an ancestor of 8846bce" || echo "NOT an ancestor of 8846bce"
docker inspect hesba_app --format 'StopTimeout={{.Config.StopTimeout}} Created={{.Created}} RestartCount={{.RestartCount}}'
docker image inspect --format 'ImageCreated={{.Created}}' "$(docker inspect hesba_app --format '{{.Image}}')"
docker ps --filter name=hesba_app -q | wc -l                                     # replica count
docker exec hesba_app sh -c 'date; echo "TZ=${TZ:-unset}"; node -e "console.log(require(\"v8\").getHeapStatistics().heap_size_limit)"'
docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}'; nproc; free -m; df -h / /var/lib/docker
docker exec hesba_postgres psql -U postgres -Atc 'SELECT version()'
docker exec hesba_caddy sh -c 'find /data/caddy/certificates -name "*.crt" | wc -l; find /data/caddy/certificates -name "*.crt" -mtime -30 | wc -l'   # counts only: names are tenant-identifying
```

- If the merge-base check fails because `8846bce` is not in the host's clone, run `git -C "$D" fetch --dry-run` only. Do **not** pull.
- Compare the certificate count with the tenant count from step 6. Many more certificates than tenants is production evidence for CF-035.

**Step 4: environment presence and secrets hygiene (PV-03, C-6, W0-03).**

```sh
docker exec hesba_app sh -c 'for v in APP_BASE_DOMAIN FRONTEND_URL PAYMOB_API_KEY PAYMOB_HMAC_SECRET PAYMOB_INTEGRATION_ID_CARD PAYMOB_INTEGRATION_ID_WALLET PAYMOB_IFRAME_ID RESEND_API_KEY EMAIL_FROM R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME APP_ENCRYPTION_KEY ETA_ENCRYPTION_KEY SENTRY_DSN NODE_OPTIONS TZ; do eval "x=\${$v:-}"; [ -n "$x" ] && echo "$v set" || echo "$v unset"; done; echo "NODE_ENV=$NODE_ENV"'
docker exec hesba_app sh -c 'echo "$DATABASE_MASTER_URL" | sed -E "s#^[a-z]+://([^:/@]+).*#db user: \1#"'      # user name only
for v in JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do s=$(docker exec hesba_app printenv "$v"); [ ${#s} -ge 32 ] && echo "$v length ok" || echo "$v SHORT"; git -C "$D" log --all -p 2>/dev/null | grep -qF -- "$s" && echo "$v FOUND IN REPOSITORY HISTORY" || echo "$v not in repository"; unset s; done
git -C "$D" check-ignore -q .env.production && echo ".env.production ignored" || echo ".env.production NOT ignored"
git -C "$D" ls-files --error-unmatch .env.production >/dev/null 2>&1 && echo "TRACKED" || echo "untracked"
git -C "$D" log --all --format=%h -- .env.production | wc -l                      # CT-6: expected 0
stat -c '%a %U' "$D/.env.production"                                               # expected 600 root (or stricter)
```

**Step 5: database and Redis configuration (PV-06, PV-07).**

```sh
docker exec -i hesba_postgres psql -U postgres -d hesba_master -At <<'SQL'
BEGIN READ ONLY;
SELECT name, setting FROM pg_settings WHERE name IN ('max_connections','statement_timeout','lock_timeout','idle_in_transaction_session_timeout','TimeZone');
SELECT rolname, rolsuper FROM pg_roles WHERE rolname = current_user;
SELECT coalesce(state,'(none)'), count(*) FROM pg_stat_activity GROUP BY 1;
ROLLBACK;
SQL
docker exec -it hesba_redis redis-cli      # then: AUTH <from your secret store>
#   CONFIG GET appendonly | CONFIG GET save | CONFIG GET maxmemory | CONFIG GET maxmemory-policy
#   INFO persistence
#   SCAN 0 MATCH bull:*:repeat* COUNT 1000   (repeat until the cursor returns 0; expect renewal, dunning, trial-expiry, installment-reminders)
#   SCAN 0 MATCH lock:* COUNT 1000           (outside the window: expect none)
#   HGETALL bull:renewal:meta  /  HGETALL bull:dunning:meta   (is a pause flag present?)
```

- Do **not** run `CONFIG GET requirepass`, `KEYS *`, or any write command.
- Check `pg_stat_activity` again at peak business hours for the PV-06 peak value.

**Step 6: is billing live? (PV-10, C-2, the master part of PV-09).**

```sql
BEGIN READ ONLY;
-- 6a subscriptions and stored tokens (counts only)
SELECT status, count(*) AS subs, count(provider_card_token) AS with_token,
       count(*) FILTER (WHERE cancel_at_period_end) AS cancel_scheduled,
       count(*) FILTER (WHERE failed_attempts > 0) AS with_failures
  FROM public.subscriptions GROUP BY status ORDER BY status;
-- 6b when renewal would next charge (renewal.job.ts:76-83 selection)
SELECT min(current_period_end) AS next_due, count(*) FILTER (WHERE current_period_end <= now()) AS due_now
  FROM public.subscriptions
 WHERE status = 'ACTIVE' AND provider_card_token IS NOT NULL AND NOT cancel_at_period_end AND failed_attempts = 0;
-- 6c attempts per day, last 120 days (every writer records attempt_type = 'initial': W0-04)
SELECT attempted_at::date AS day, status, count(*), sum(amount)
  FROM public.payment_attempts WHERE attempted_at > now() - interval '120 days' GROUP BY 1, 2 ORDER BY 1, 2;
-- 6d attempts by hour: clusters at the renewal/dunning hours indicate job charges
SELECT extract(hour FROM attempted_at)::int AS hour, status, count(*)
  FROM public.payment_attempts WHERE attempted_at > now() - interval '120 days' GROUP BY 1, 2 ORDER BY 1, 2;
-- 6e possible double charges (Phase 4 §38), as a count
SELECT count(*) FROM (SELECT subscription_id, date_trunc('month', attempted_at)
  FROM public.payment_attempts WHERE status = 'SUCCESS' GROUP BY 1, 2 HAVING count(*) > 1) t;
-- 6f dunning targets already paid or cancel-scheduled (DB-08 / CF-007), as a count
SELECT count(*) FROM public.subscriptions
 WHERE status IN ('ACTIVE','PAST_DUE','SUSPENDED') AND failed_attempts > 0 AND provider_card_token IS NOT NULL
   AND (current_period_end > now() OR cancel_at_period_end);
-- 6g tenants with more than one subscription (I-12 / CF-088)
SELECT count(*) FROM (SELECT tenant_id FROM public.subscriptions GROUP BY 1 HAVING count(*) > 1) t;
-- 6h tenants by status; orphan provisioning (DB-22 / CF-054)
SELECT status, count(*) FROM public.tenants GROUP BY 1;
SELECT count(*) FROM public.tenants WHERE status = 'PROVISIONING' AND created_at < now() - interval '1 hour';
ROLLBACK;
```

- Compare `attempted_at` hours with the container TZ from step 3. Prisma stores UTC.
- **Paymob dashboard, read-only:**
  1. Count transactions over the last 90 days per day, split by card-token / recurring / MOTO versus iframe card payments, plus refunds and voids.
  2. Note the integration ids configured for token charges (I-3).
  3. Compare the per-day `SUCCESS` counts from 6c with Paymob.

  A Paymob charge with no matching row is a CF-006 candidate. Record its transaction id **only** in the restricted worksheet.
- **Do not** use the Paymob sandbox or make any API call in W0.

**Step 7: fresh backup and isolated restore drill (CT-4, PV-04, C-1). Requires the owner's authorisation for data custody.**

```sh
# from the operator's machine, streaming off-host so the production disk cannot fill; destination must be encrypted
ssh root@<verified-host> "docker exec hesba_postgres pg_dump -U postgres -Fc hesba_master" > hesba_master_$(date -u +%Y%m%dT%H%MZ).dump
# isolated restore: bare PostgreSQL, no network, NO Hesba app or workers attached (they would charge real cards)
docker run -d --name w0-restore --network none -e POSTGRES_PASSWORD=local-only postgres:16-alpine
docker cp hesba_master_*.dump w0-restore:/tmp/h.dump
time docker exec w0-restore pg_restore -U postgres -d postgres --create /tmp/h.dump
```

- Record the dump's start and end time, its size, and the restore duration. These are the RPO and RTO inputs.
- Compare exact counts on both sides:
  - master: `tenants`, `subscriptions`, `payment_attempts`;
  - each tenant schema: `invoices`, `invoice_items`, `customers`, `stock_movements`, `audit_logs`.

  Production counts run in a `READ ONLY` transaction, outside the window.
- Delete the copy according to the agreed retention.

**Step 8: damage sizing, schema state, feature usage and scale, on the restored copy (PV-08, PV-09, PV-11, PV-12, CT-5, C-5).**

```sh
docker exec -i w0-restore sh <<'SH'
for s in $(psql -U postgres -d hesba_master -Atc "SELECT schema_name FROM public.tenants ORDER BY 1"); do
  psql -U postgres -d hesba_master -At -c "SET search_path = \"$s\";
    SELECT '$s',
      (SELECT count(*) FROM customers WHERE credit_balance < 0),
      (SELECT count(*) FROM customers WHERE loyalty_points < 0),
      (SELECT count(*) FROM (SELECT 1 FROM installment_payments GROUP BY contract_id, installment_number HAVING count(*) > 1) t),
      (SELECT count(*) FROM purchase_order_items WHERE received_quantity > quantity),
      (SELECT count(*) FROM purchase_orders WHERE paid_amount > total_amount),
      (SELECT count(*) FROM (SELECT 1 FROM audit_logs WHERE entity = 'invoice' AND action = 'cancel' GROUP BY entity_id HAVING count(*) > 1) t),
      (SELECT count(*) FROM stock WHERE quantity < 0 OR min_quantity < 0),
      (SELECT count(*) FILTER (WHERE ip << '10.0.0.0/8' OR ip << '172.16.0.0/12' OR ip << '192.168.0.0/16') || '/' || count(ip)
         FROM audit_logs WHERE created_at > now() - interval '30 days');"
done
SH
```

- Wrap each remaining Phase 4 §38 query as `SELECT count(*) FROM (<query>) q` and add it to the loop: over-returns, cancelled pending installment invoices, transfers moved twice, work orders invoiced twice.
- The last column is private-address audit IPs / all audit IPs over 30 days. If every IP is private, CF-033 is confirmed in production (the proxy address is recorded as the client).
- **PV-08:**
  - `SELECT schema_version, count(*) FROM public.tenants GROUP BY 1;` (latest in the repository: 17);
  - count unvalidated CHECK constraints per schema, from `pg_constraint` where `NOT convalidated`;
  - check the ETA columns named in Phase 4 DB-23.
- **PV-11 / PV-12:** per-schema counts of invoices with tax greater than zero, product discounts, coupons used, loyalty movements, installment contracts, split payments, ETA-enabled settings and rows per main table.

**Step 9: record and decide.**

1. Fill §3.3 with the outputs. Re-classify each PV; it is VERIFIED only with evidence.
2. Apply the §5.3 decision table.
3. The owner records the PV-21 decisions (§9.3).
4. Hand back for a **W0 close-out addendum**. That addendum, not this report, is what can satisfy the W0 exit criteria.

---

## 9. Readiness decision

### 9.1 Decision

| Question | Decision | Basis |
|---|---|---|
| Is W0 complete? | **No** | Phase 10 §7 W0 exit criteria, all four unmet:<br>• PV-01 … PV-10 answered: 0 / 10;<br>• restore drill passed: no;<br>• damage list and cleanup scripts drafted: no;<br>• PV-21 decisions recorded: no |
| May W1 **implementation** begin? | **Yes, conditionally:** code, PR review, CI, and tests on disposable stacks | Phase 10 §6.6: W1 is a set of independent small changes, and its only listed prerequisite is PV-01, for CF-033. **CF-033 (trustProxy) waits for PV-01.** CF-044's stop-grace value should be checked against the step 3 `StopTimeout` before merging. Nothing in W1 implementation touches production |
| May any W1 change be **deployed to production**? | **No**, until G-1 … G-7 are met | • The target host's identity and state are unknown (W0-01, W0-02).<br>• The deployed commit is unknown (PV-02), so a deploy of `8846bce` would ship an unknown diff (at least 61 commits beyond the last recorded deployment).<br>• Every container start runs migrations (CF-045), and no restore point exists (PV-04).<br>• Billing liveness is unknown (PV-10), and a restart during a cycle can double-charge (CF-006, CF-044) |

### 9.2 Gates before the first W1 production deployment

| Gate | Required evidence | Closes |
|---|---|---|
| **G-1** | C-0 record: fingerprint match with the date and the person; hPanel reinstall and activity history; step 2 stack state | W0-01 |
| **G-2** | The deployed commit (step 3), and a **reviewed diff** from it to the W1 release candidate, including every master and tenant migration that would run at boot | PV-02 |
| **G-3** | A fresh backup, plus an isolated restore with matching per-schema counts and a recorded RPO/RTO (step 7) | PV-04, CT-4, Phase 10 D-3 |
| **G-4** | Step 6 and the Paymob comparison, classified with §5.3. If billing is live or armed: a C-3 decision recorded and the C-4 window freeze in force | PV-10, CT-1/CT-2 |
| **G-5** | Topology, proxy chain, replica count and `StopTimeout` (step 3), and the audit-IP evidence (step 8) | PV-01 (CF-033, CF-044 values) |
| **G-6** | Environment presence, JWT secrets not the documented examples, and `.env.production` untracked and never committed on the host (step 4) | PV-03, C-6, W0-03 |
| **G-7** | The owner's statement on W0-02: is production serving users? The W1 deployment must not double as an outage fix that skips G-1 … G-3. A rollback point must exist: tag the current image before building, because the host builds images in place (CF-045) | W0-02, C-10 |

W1's own exit still requires **an alert proven to reach a person** (Phase 10 W1 tests, CF-032).

### 9.3 Owner decisions still open (PV-21, plus this phase)

- **From Phase 10 PV-21:**
  - price override;
  - refund ≤ amount paid;
  - work-order paid ≤ total;
  - one active subscription per tenant;
  - a payment on a `CANCELLED` subscription;
  - trial grace and suspension policy;
  - branch-level authorisation;
  - keep or remove offline mode;
  - tax on order-level discounts (tax advisor);
  - tax-invoice identity requirements (tax advisor);
  - whether cashiers collect before or after recording.
- **New from W0:**
  - **I-5 scope:** what may a suspended or cancelled tenant still do? Reading its own history, managing users?
  - **C-3:** pause billing or keep collecting, if billing turns out to be live;
  - **C-10:** whether, when and how to restore web availability;
  - **data custody** for production dumps and the restored copy (C-1, C-5).

---

## 10. Next step (exact, tied to the Phase 10 dependencies)

1. **Today:** the Hostinger account holder runs **§8 step 1 (C-0)** in the provider console and records two things: the fingerprint comparison against W0-01, and the reinstall and backup history. **C-4 (change freeze)** is announced at the same time.
   - *Unblocks:* PV-01 … PV-13 and PV-19, which is the whole of T-01's scope.
2. **Then steps 2–6.** These answer PV-01, PV-02, PV-03, PV-06, PV-07 and PV-10.
   - PV-10 is the RB\* decision for CF-006 … CF-010 and design input **D-12 → T-22** (W6).
3. **Then step 7, the restore drill.** This is **T-03**, and it closes the **D-3** rollout gate for T-11 (fee data migration), T-13 (backfill), T-15 (constraint validation) and T-30 (ETA DDL).
4. **Then step 8, on the restored copy.** This is **T-01 → T-02 (D-2)**: the damage list and draft cleanup scripts. The scripts are drafted only; none is run.
5. **Return the outputs for a W0 close-out addendum.** The owner then:
   - applies §5.3 (whether to trigger CT-2);
   - records the §9.3 decisions (T-05, D-4).
6. **In parallel, with no production contact,** W1 implementation may start: T-04 (observability) and T-06 (isolated fixes, except CF-033).

---

## 11. Notes for the Phase 10 roadmap (recorded here; the roadmap itself was not edited)

| Phase 10 item | Note from W0 |
|---|---|
| §9 PV-22 | Answered (VERIFIED, §3.3) |
| §2.2, §4.8 "live platform unknown"; CF-152 | Production DNS points to a Hostinger VPS. No Railway deployment is active: the newest non-failed one is `240fb96` (2026-05-20), and the four after it, on 2026-05-23, failed. CF-152 (Railway restart policy) is likely not applicable to the live path, pending PV-01 |
| §11 I-5 | Confirmed statically. Proposed **W0-06, P3**, RC-02 / RC-10, W3 or W6 (§6) |
| §4.6 CT-2 | Mechanism: removing the repeatables does not last, because they are re-registered at every boot. Use a queue-level pause, rehearsed first, and reconcile before resuming (§7 C-3) |
| §4.6 CT-3 | Cron times are 06:00 / 07:00 / 08:00 / 09:00 in the **process TZ**, unset in the image, so likely UTC. Confirm in step 3 and express the window in that TZ |
| §4.6 CT-5 | Prefer running the detection queries on the **restored copy** from CT-4: no production load, and it validates the restore at the same time |
| §4.6 CT-6 / CF-048 | Statically, the image copies only `packages/` and `apps/` (`Dockerfile:19-20`), so a root `.env.production` would not reach the image layers. The exposure is the **git** path, made more serious by the public repository (W0-03) |
| §9 PV-01 method | Production logs at `warn`, so request IPs are not logged (W0-08). Use `audit_logs.ip` (§8 step 8) |
| §9 PV-10 / CT-1 | Payment rows carry no origin (W0-04). The Paymob dashboard is authoritative |
| Phase 8 §16 #10 | `caddy list-certificates` is not, to this audit's knowledge, a Caddy v2 CLI subcommand. Step 3 counts certificate files instead |
| §10.2 #8 "the deployed commit is the tested commit" | Cannot be assessed until PV-02 is answered |

---

## 12. Declaration

| Statement | Status |
|---|---|
| Files changed | **One file created:** `documents/audit/Hesba_Phase11_Production_Verification_Report.md` (untracked, inside the already-untracked `documents/audit/`). No other file was created, modified or deleted in the repository. `git status --porcelain` shows the same entries before and after: ` M apps/web/src/components/layout/AppShell.tsx`, ` M apps/web/src/pages/pos/POS.tsx`, `?? documents/Hesba_Project_Overview.md`, `?? documents/audit/` |
| Application source, configuration, dependencies, migrations, Phase 10 roadmap | **Not modified** |
| **Production state modified** | **No.** Specifically, none of the following was done:<br>• opening a database or Redis session;<br>• opening a host session (the SSH client refused before authentication);<br>• a deploy, restart or migration;<br>• a billing job, charge, refund or subscription change;<br>• an e-mail;<br>• a Paymob, ETA, Resend or R2 request;<br>• a settings change;<br>• a request that could trigger certificate issuance.<br>The only traffic to the production IP was:<br>• TCP connect attempts (80 and 443 never connected);<br>• one SSH banner read and one key scan;<br>• one SSH attempt rejected by the client. These may appear in host connection logs |
| Other external systems | Read-only queries to public DNS, WHOIS, the GitHub API (repository, deployments, PRs), the Railway API (unauthorised), crt.sh and CertSpotter |
| Secrets | **None printed or recorded.** Environment values were never read. Secret-shaped strings in git history were classified by name, prefix and length only. The host-key fingerprints in §3.5 are public keys, not secrets |
| Tenant and customer data | **None accessed.** No tenant subdomain names were printed: certificate queries were aggregated, and the only DNS label tested was random |
| Local tests presented as production verification | **None.** Static evidence is labelled as static throughout |
| Temporary files | Three files in the session scratchpad, outside the repository (one empty JSON list, two HTTP 502 pages): **deleted**. The tool harness also kept one task-output file, outside the repository, from a backgrounded deployment-count command. A pipeline mistake doubled every count in it (82 / 12 / 74). The report uses the corrected parallel recount (41 / 6 / 37 = 84), which matches the independent checks: 84 records, 47 `failure` and 37 `inactive`. The file holds no secrets |
| Checks claimed as passed without being executed | **None.** Only PV-22 and the supplementary checks S-1 … S-3 are VERIFIED, each with its evidence |

*End of Phase 11 (W0). Verification and containment planning only. No containment action and no remediation was executed.*
