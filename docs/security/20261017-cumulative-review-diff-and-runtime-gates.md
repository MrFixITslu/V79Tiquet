# P1 cumulative Tiquet independent reviewer handoff — 17 October 2026

**Candidate:** draft PR #40 https://github.com/MrFixITslu/V79Tiquet/pull/40.
**Contains:** PR #37 durable explicit session revocation, #38 staff WebSocket Hub entitlement parity, #39 portal WebSocket token rotation/revocation checks, plus fail-closed stalled-check and nondeployment regressions.
**Release state:** NOT MERGED, NOT DEPLOYED, customer beta and paid access NO-GO.

## What is demonstrated

- Actual source module + synthetic local HTTP/disposable PostgreSQL tests reject copied Tiquet JWT after explicit Tiquet logout, support token-fingerprint revocation, and fail closed when database checks are unavailable. They do not prove that Hub-only logout globally invalidates already issued Tiquet sessions.
- Synthetic Hub-linked staff-socket tests reject stale/unlinked identities when entitlement enforcement is on. Effective production configuration still needs independent review.
- Actual portal-guard module with disposable PostgreSQL and real synthetic WebSocket clients denies access after token rotation/revocation/expiry, suspended account and cross-tenant scope.
- Source-level 30-second bound protects existing room subscriptions from a permanently hung Hub/DB authorization promise on a 15-second heartbeat. This remains a draft change, not production protection.
- Release-HOLD regression verifies that the current Tiquet CI does not create delivery bundles, publish containers or SSH-deploy. It is not proof that no separate deployment route exists.
- Previous founder original-image two-organization SSO and ticket replay tests remain historical PASS, but apply to the older pinned images rather than this cumulative candidate.

## Independent review checklist

1. **Logout scope and user experience.** Explicit Tiquet logout revokes submitted Tiquet cookie/bearer tokens. Separate Hub-only logout does not establish global Tiquet single logout for an already-issued JWT (up to 30-minute expiry). Require a deliberate customer policy or a separately reviewed coordinated revocation solution.
2. **Effective final config.** Confirm V79_ENTITLEMENT_RECHECK_ENABLED=1; V79_ALLOW_LEGACY_AUTH=0; correct internal Hub URL and secret-file references (never values); correct database schema and fail-closed Hub outages.
3. **Socket revocation latency.** Review 15-second recheck, 30-second hung-check termination, account suspension, job ownership, portal token rotation, and source's synchronous room broadcast. Do not claim instantaneous zero-message revocation. Consider event-loop stalls and high load.
4. **Durable schema/restart.** Verify revoked_auth_tokens additive schema on isolated restored PostgreSQL, multi-worker visibility, invalidation after restart, DB outage and rollback behaviors.
5. **Changed-code tenant negative scenarios.** Verify signed launch-ticket replay denial; cross-tenant read/write and WebSocket denial; active portal/staff revocation; cookie/bearer copied JWT expiry/logout; and legacy login refusal in an isolated final-image two-tenant test. Preserve historical unchanged-image evidence instead of repeating broad tests.
6. **Exact release and recovery.** Match final source/image SHAs, all 13 ordered Hub Compose inputs, WiPay/price and owner-MFA parity; finish current 14 encrypted archive PG17/PG16 validation and full isolated Hub/Tiquet backup restore-to-boot and rollback. Never recapture unless the prior archives are independently shown unusable.
7. **Independent signoff.** Record reviewer identity, exact candidate SHA and controls reviewed, risk/severity, repro receipts, accepted residual risk, and explicit founder Tier B/Tier C decision.

## Exact review entry points

- server/tokenRevocation.js and server/hubAwareAuthentication.js (explicit signed session logout)
- server/tiquetSocketAccess.js and server/tiquetPortalSocketAccess.js (staff/portal authorization)
- server/tiquetSocketHeartbeatGuard.js and tests/tiquetSocketHeartbeatGuard.test.js (hanging check fail closed)
- tests/p1ReleaseHoldContract.test.js and .github/workflows/v79-ci-cd.yml (protect release HOLD)
- .github/workflows/tiquet-p1-cumulative-security-review.yml (real modules with synthetic, nondeploying PostgreSQL and WebSocket acceptance)

No production data, credentials, payments, agents, containers or customer accounts were changed by this source-only handoff.
