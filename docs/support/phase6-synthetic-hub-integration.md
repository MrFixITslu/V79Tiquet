# Tiquet Phase 6: Synthetic Hub SSO and Migration Readiness

Date: 2026-10-24
Branch: feature/support-desk-phase1-20261024
Approval scope: isolated synthetic development and tests only.

## Three designs and REDTEAM

1. A second Support Desk login was rejected: duplicate identity and revocation risks.
2. Client-supplied role/organization headers were rejected: spoofing and cross-tenant access risks.
3. Selected: reuse production Tiquet Hub-aware JWT and HMAC entitlement logic against an entirely synthetic PostgreSQL fixture and an in-process mock Hub transport. Derive permissions from the current synthetic Hub membership record on every request, not from stored legacy Admin roles or JWT role claims.

## Code and safety

- server/support/phase6HubPolicy.js: least-privilege owner, manager, staff and viewer mapping. Unknown roles denied.
- server/support/phase6AuthHarness.js: existing Tiquet signed-session/revocation middleware, strictly test-purpose JWTs, and production HMAC entitlement checker with a fake local transport. No network Hub requests.
- server/support/phase6-hub-schema.sql: support-prefixed synthetic Hub organizations, memberships and hashed-token revocation tables. No changes to legacy finance or customer schemas.
- server/support/router.js and phase4Router.js: optional capability resolver for synthetic integrations. Default runtime behavior remains unchanged.
- tests/supportPhase6.hub.integration.mjs: tests bad/expired or forged issuer, wrong organization/account, suspended accounts, revoked sessions, revoked entitlements, role demotion, cross-tenant scope, cookie and bearer auth, and Phase 4 authorization.
- tests/supportPhase6.migration.mjs: creates a second disposable database, applies all support schemas twice, rolls them back, proves legacy accounts/users/clients/jobs and the paid job remain unchanged, reapplies and rolls back again.
- server/support/phase6-synthetic-rollback.sql: reverse-order explicit support-only DROP TABLE statements. No CASCADE and never approved for production.
- tests/supportPhase6.sourceGuard.mjs: CI asserts the production app is not importing Phase 6 test modules or performing legacy-table rollback.
- .github/workflows/support-phase1-synthetic.yml: tests run in GitHub Actions using localhost PostgreSQL with no production secrets, mail services, image deployment, SSH or remote API access.

## REDTEAM limits

- The mock Hub response is NOT proof of live Hub authorization or availability.
- Hub permissions are not yet provisioned by real Hub roles. This phase uses synthetic membership data only.
- The existing entitlement checker caches a successful result for up to 30 seconds; the synthetic test uses a one-second TTL and moves a fake clock forward. Commercial revocation latency must be explicitly approved.
- A future nonproduction browser acceptance must validate cookie flags, CSRF, SSO/MFA, and organization-switching end to end.
- Test-only identity shims must never be included in production deployments.
- Existing live jobs, invoicing, payment processing, file access and customer portals have not been integrated or tested with a real release candidate.
- Local schema rollback is NOT a production migration plan; a production-compatible additive migration and full off-host restore require their own approval.

## Acceptance verdict

PHASE 6 synthetic engineering: PASS only when the exact feature branch HEAD CI passes.
COMMERCIAL BETA / PRODUCTION: NO-GO.
Main, live containers, production DB, real customer data and real email are untouched.

Separate owner approvals will be necessary for real Hub provisioning, nonproduction cross-app integration, database migration/rollback on an authorized replica, release artifacts and any later deployment.
