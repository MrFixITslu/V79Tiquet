# V79Tiquet — Signed Sentinel ingestion integrated with current GitHub main (staging)

Date: 2026-10-10 AST. **NOT deployed; all live Sentinel event ingestion remains disabled.**

## Source and scope
- Immutable Sentinel implementation input: `550e32c58ab21743ddb8e3d45e402e004a89464a`, on `feature/sentinel-service-ingest-20261010`.
- Latest Tiquet main fetched before reconciliation: `1edae1033d349d0dc99e7cb5fadaf84c39018a33`, including the latest refresh/navigation fix and transitive dependency patches.
- Reconciled in separate Acer worktree `tiquet-sentinel-current-main-integration-20261010`. Git merge applied without conflicts, with all Sentinel signed-ingest, owner human approval, NOC machine approver, and Hub service-checker modules intact.
- No production environment, user credentials, ticket data, billing, other agents, migrations, or private network policy touched.

## Controls included (disabled by default)
- Signed, bounded, replay-resistant, tenant-scoped Sentinel incident event receiver.
- Distinct current-authorized Hub machine entitlement check, and separate NOC human-approver machine-status recheck (fail closed).
- Ed25519 human approval envelope binding the exact event hash and incident, NOC subject, tenant, client and action.
- Owner-scoped account/client mapping, idempotent receipts and PostgreSQL transaction locks.
- Approved incident recovery may add evidence; it never auto-closes a ticket.
- Independent machine HMAC secret-file custody with refusal of unsafe path/permissions; private approver gateway remains restricted to authenticated owner-only Tailscale HTTPS.
- No external customer onboarding or autonomous network remediation.

## Isolated verification evidence
- Current reconciled Tiquet JS suite **50/50 passed, zero failures/skips**.
- TypeScript lint and Vite production build passed; bundle-size advisory remains a performance task.
- Production dependency audit: **0 known vulnerabilities**.
- Dedicated disposable PostgreSQL 17 ingestion test **passed 1/1, zero failures/skips**. Verified one synthetic ticket, two idempotent receipts, one recovery note, ticket still open (no auto closure), and removed disposable PostgreSQL resources. Log: `/tmp/v79-sentinel-tiquet-rebased-pg-20261010.log`.
- Existing Hub entitlement integration has staged disabled-by-default owner machine grant controls in Hub draft PR #119; **NOT merged or deployed**.
- Read-only Dell test confirms live Tiquet public Sentinel ingestion returns HTTP 404; live container was healthy. HTTPS from Dell to Acer TLS verified, unsigned private approver POST denied. No Sentinel live tickets were created.

## Remaining hard gates
1. Owner provisions the **distinct machine HMAC service credential** locally using approved secret custody, without sharing secrets in chat or code; separate Edge and owner human approval keys remain distinct.
2. Review actual Ed25519 signature and incident evidence, active owner grant and current human approver status over the isolated private route, with explicit renewal/revocation and no public admin exposure.
3. Verify one reviewed additive PostgreSQL migration on disposable DB and an authenticated restore before any live migration.
4. Owner explicitly authorizes **one supervised internal test ticket**, not unattended dispatch; never select or change other clients.
5. **Independent security assessment and certification mandatory before ANY external/customer monitoring or onboarding.** Internal waiver is not certification.

Leave all production feature flags OFF until these are satisfied, and do not merge this staging branch into main based solely on test success.
