# P1 Tiquet staff WebSocket Hub entitlement parity

**Status:** stacked isolated security candidate, NOT deployed. The parent [Tiquet PR #37](https://github.com/MrFixITslu/V79Tiquet/pull/37) remains DRAFT / independent review HOLD.

## Three approaches and REDTEAM
1. Keep admitting legacy staff WebSockets while protected HTTP demands Hub SSO: rejected; a legacy signed staff JWT can access chat after the HTTP migration policy was enabled.
2. Reject all staff WebSockets: rejected; disrupts legitimate scoped Tiquet staff support.
3. **Selected:** when an actual Hub entitlement checker is configured, deny a staff WebSocket without a valid linked Hub organization and user mapping, and recheck this on heartbeat. Retain old local-only behavior when Hub enforcement is deliberately disabled.

The staff WebSocket transport does not pass through Express HTTP authentication. On inherited PR #37, authorizeTiquetStaffSocket checked the linked Hub identity **only when link.managed was true**. When a JWT and local rows were all unlinked, Hub subscription check was skipped but access granted. The heartbeat similarly permitted an unlinked socket when the local account remained active. This diverged from createTiquetAuthentication, which explicitly denies unmanaged identities when Hub subscription enforcement is enabled.

## Changes
- Narrow condition-only fix in server/tiquetSocketAccess.js; the real Hub checker must run on properly linked staff, and must not be skipped on a legacy identity when configured. No new roles, secrets, migrations, login paths, customer routes, ticket mutations or deployment changes.
- tests/tiquetStaffSocketParity.test.js contains synthetic allow/deny regressions for Hub enforcement, linked identity, mismatch, suspension, legacy mode explicitly without checker, DB outage and heartbeat transitions.
- Nondeploying, scoped GitHub CI tests the new and inherited staff-socket/logout security cases. Existing PR #37 tests remain authoritative for copied JWT revocation.

## Remaining security gates
- Reviewer must assess the inherited PR #37 entire cumulative diff (logout, DB-backed denylist, current user and account checks, WebSocket revalidation, live schema and rollback) and this narrowly stacked change. The current tests are not independent signoff.
- Verify deployed Hub entitlement configuration actually supplies a checker; if disabled, legacy staff behavior is intentionally preserved for internal compatibility and **cannot** be used to claim Hub-only customer beta.
- Customer portal secure-link sockets follow a separate access policy; their post-connection revocation/freshness must also receive independent acceptance. This PR changes **only staff WebSocket scope**.
- No commercial rollout until two-tenant integration/replay, migration/recovery, DB outage fail-closed, actual browser QA and founder release approval.
