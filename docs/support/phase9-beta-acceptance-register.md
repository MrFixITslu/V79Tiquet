# Vision79 Tiquet — Phase 9 final beta acceptance register

Date: 2026-10-24
Tiquet branch: feature/support-desk-phase1-20261024
Pinned Hub source: ee79ec9353ee4248eb8276fee2e6c3476b3af491

**Decision: synthetic engineering passes only with green exact-head CI. Commercial beta remains NO-GO.**

## Three options / REDTEAM
1. Static checklists alone: rejected, cannot establish image correctness or restore.
2. Production host/config/volume inspection: rejected, not authorized and risky.
3. Selected: synthetic cross-app CI with pinned source, detached OCI image builds, Compose rendering, complete disposable PostgreSQL backup/restore, fake Hub JSON/upload hash checking and explicit blocker register.

Threats tested/reviewed: forged signed sessions, parent Hub logout, replay, cross-tenant jobs and invoice state, mismatched feature flags, stale auth grants, Node image drift, leaked synthetic test identities, destructive SQL rollback, backup corruption, secrets in CI, unexpected public ports, remote services, and uncontrolled email/payment actions.

## Verified scope
- Hub and Tiquet image builds on isolated GitHub Actions runner, Node 22 for both. Runtime versions and Tiquet non-root user inspected. Image was never pushed, signed for production or deployed.
- Tiquet image excludes synthetic Hub-auth fixture files, disposable SQL rollback, and tests while retaining actual runtime server and frontend.
- Tiquet Compose rendered with its entitlement/session flags OFF and ON using dummy credentials; no container started by this check, no exposed ports.
- Earlier Phase 8 full paired app SSO, replay, global logout, WebSocket close, isolation and job/invoice-stage checks remain under regression.
- Existing Phase 6 additive schema repeat + rollback keeps unrelated paid job records. Phase 5/9 restore full disposable PostgreSQL and separately fabricated Hub JSON/uploads; hash/tamper detection passed. **Cross-store atomicity and off-host restore are not proven.**
- No production credentials, data, environments, Docker volumes, email, payment providers or live endpoint access.

Evidence:
- Baseline and restore workflow: https://github.com/MrFixITslu/V79Tiquet/actions/workflows/support-phase1-synthetic.yml
- Detached image build workflow: https://github.com/MrFixITslu/V79Tiquet/actions/workflows/support-phase9-image.yml
- Pinned paired-app Phase 8: https://github.com/MrFixITslu/V79Tiquet/actions/runs/40118305993
- Feature branch: https://github.com/MrFixITslu/V79Tiquet/tree/feature/support-desk-phase1-20261024

**Important:** use successful CI at the exact final branch commit. Earlier runs do not validate later changes.

## P0 release blockers (priority order)
1. Hub source supports V79_HUB_TIQUET_SESSION_BINDING, but Hub's checked-in Compose does not explicitly pass it. Owner must separately authorize safe default-OFF Hub feature-branch amendment; no change to Hub was made in Phase 9.
2. Coordinated release flag activation requires all three: Hub V79_HUB_TIQUET_SESSION_BINDING=1; Tiquet V79_ENTITLEMENT_RECHECK_ENABLED=1 and V79_TIQUET_SESSION_BINDING_ENABLED=1. Tested branch defaults all Tiquet flags OFF. No live config parity has been checked; do not activate unilaterally.
3. Authorize a read-only, no-secrets live configuration / backup identity audit. Freeze image digests, env parity, storage/network/port mappings, MFA/cookie/CSRF, entitlement and rollback gates before deployment. Do not infer live parity from synthetic Compose.
4. Complete an encrypted off-host backup and disconnected restoration of an authorized sanitized complete Hub + Tiquet application snapshot (database, uploads, Hub state), measuring RPO and RTO. Current synthetic snapshots are not an atomic multi-store production restore.
5. Approve a dedicated production-compatible additive migration plan, full restore safety net and rollback. **Never run phase6-synthetic-rollback.sql against a live database.**
6. Validate authorized replica identity provisioning, full customer permissions, job/payment/invoice integrity, and realistic RAM/disk/performance. Synthetic invoice-stage tests are not real billing-provider evidence.
7. Independently approve real email/WiPay provider testing, privacy/consent, transactional idempotency, and message safety before any customer workflow.

P1: formal WCAG 2.2 AA audit, SLA operations UI, customer onboarding/help content and tenant-based performance targets.

## Owner acceptance checklist
- [x] REDTEAM and immutable source baseline
- [x] Phase 8 full paired synthetic app tests, replay and logout
- [x] Isolated Node 22 image builds without publishing
- [x] Source-based Tiquet flags parity, Compose OFF/ON rendering
- [x] Disposable complete database and fake Hub/upload restore with tamper checks
- [x] Synthetic auth and rollback code excluded from release image
- [ ] Approved Hub Compose feature-branch change (default OFF)
- [ ] Authorized read-only live evidence, no real secret values
- [ ] Encrypted off-host complete restore with measured recovery
- [ ] Authorized cross-app nonproduction release rehearsal
- [ ] Immutable release digests, guarded rollback and owner sign-off
- [ ] Separate merge authorization and separate live deployment authorization

## Hard stop
Main branches unchanged. No merge, deployment, production access, real mail/payment, customer data, real migration or live backups. No implied release GO.

**Next decision:** a single coordinated release-gates-only approval: isolated Hub Compose amendment, explicitly authorized read-only release evidence inventory and sanitized off-host complete-app restore. Live rollout remains separately gated.
