# Vision79 Tiquet — Phase 7 Pinned Hub Source, Localhost Integration Rehearsal

Date: 2026-10-24
Tiquet branch: feature/support-desk-phase1-20261024
Pinned Hub source: ee79ec9353ee4248eb8276fee2e6c3476b3af491 (main at review)
Authorization: synthetic, isolated source and nonproduction tests only. NO deployment, no main merge, no production data, no real email or provider API calls.

## Three architectures and REDTEAM

1. Repeat Phase 6's mocked Hub decision — rejected because it cannot exercise Hub's actual entitlement policies or HMAC request verifier.
2. Run entire live or external Hub/Tiquet environments — rejected because it violates the requested nonproduction-only scope; starting both full application stacks would require separate controlled configuration and add more failure modes.
3. Selected: Pin and independently check out exact public Hub source into GitHub Actions' temporary workspace. Import the REAL Hub modules for platform request signing/verification, entitlement decision, subscription access and Tiquet tenant provisioning. Exercise them through localhost HTTP against Tiquet's REAL signed-session and entitlement-client middleware with fake accounts and a disposable PostgreSQL instance.

## What is actually exercised

- Hub source modules: server/platform-contract.mjs, server/entitlement-validation.mjs, server/subscription-access.mjs, server/tiquet-provisioning.mjs (including their local dependencies).
- Tiquet source modules: server/hubAwareAuthentication.js and server/hubEntitlementRevalidation.js, plus test-purpose phase6AuthHarness, the scoped Support Desk and Phase 4 APIs.
- Genuine TCP/HTTP round trips at randomly allocated 127.0.0.1 ports. No outside endpoint. Signed service requests validated by Hub's HMAC verifier.
- Synthetic JWT bearer tokens; Tiquet's real signed-session middleware performs token checking, database-linked Hub identity checks, entitlement calls, and revocation.
- Separate synthetic organizations, current membership roles, trial/subscription state, and tenant mapping.
- Authorization boundaries: account and tenant isolation, membership role demotion, plan cancellation, membership revocation, mapping readiness, disabled Hub entitlement, forged request bodies/signatures and wrong-organization sessions.
- Hub's actual Tiquet provisioning identity/mapping functions reject org mismatch and account reuse across organizations.
- Phase 6 migration/rollback, Phase 5 local restore, 15K paging, browser accessibility and Phase 1–4 mock-mail regressions remain in the same CI.

## Extra safeguards

- Hub checkout pinned to immutable SHA; test refuses any other checkout.
- Test requires CI_SUPPORT_PAIRED_PINNED=1, CI_SUPPORT_SYNTHETIC=1, NODE_ENV=test, V79_SUPPORT_DESK_ENABLED=0, GITHUB_ACTIONS=true and exact localhost disposable PostgreSQL database name.
- Both HTTP listeners bind loopback-only ephemeral ports. No mock service can target remote Hub. All synthetic JWT/HMAC keys are hardcoded test-only strings.
- Do not upload or publish credentials, source checkout artifacts, any log of auth tokens, screenshots, or a runnable production configuration.
- App production route flags and the live Hub connector are unchanged.
- Chromium test port now uses its own ephemeral localhost allocation, preventing fixed-port conflicts on busy CI runners.
- Hub entitlements legitimately have bounded positive caching (up to 30 seconds in Tiquet). Recheck tests move a fake clock after expiration; this is NOT proof that subscription cancellation revokes cached access instantly.

## Meaningful limitations (release NO-GO)

- This tests genuine **Hub policy modules and Tiquet authentication middleware**, NOT a full running Hub web application or a real browser redirect from Hub /api/apps/tiquet/launch through Tiquet /api/platform/launch.
- One-time launch-ticket generation, expiration/replay and parent-session bound logout against the exact two current application builds are NOT established by this integration run.
- The Hub membership store and Tiquet database are synthetic and synchronized by test fixture code; production role provisioning and migration are not completed.
- The Hub/SSO status endpoint and websocket auth are not exercised in a full paired boot; live third-party auth providers are excluded.
- Production database migrations and rollback, encrypted off-host restore, controlled deploy and acceptance on representative hardware remain outside scope.

## Acceptance

Phase 7 contract/HTTP rehearsal PASS only if the exact feature-branch HEAD GitHub Actions run passes. Link the exact successful run in the sign-off. Never treat an earlier success as validation of a later edit.

Production commercial beta/release remains NO-GO. Main, live services, real data and customer emails stay untouched. The next approval boundary is a separately authorized complete paired Hub/Tiquet localhost-only full-application bootstrap and end-to-end synthetic launch/revoke test, with pinned source, disposable databases and no merge or deployment.
