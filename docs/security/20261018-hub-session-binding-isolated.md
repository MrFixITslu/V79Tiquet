# P1 Hub-bound Tiquet sessions — isolated implementation candidate (18 October 2026)

**SOURCE ONLY / DRAFT / FEATURE DISABLED BY DEFAULT / NO MERGE / NO DEPLOY / CUSTOMER NO-GO.**

Source bases: Hub `df1046151a02dd27db746a2ec5b928f03dcb9b1d`; Tiquet `7da53ebb71530366168bd72a7efd52b57d34a23c`.
This branch is coordinated with isolated Hub branch `feature/p1-session-lineage-hub-isolated-20261018`.

## Three options and REDTEAM decision

1. Browser call to `/api/auth/logout` for each app — rejected due to per-origin cookie rules, missing tabs and failed calls.
2. Server-to-server durable revocation queue — attractive for performance, but requires reliable delivery, new schema/worker and backfill before safe use. Defer.
3. **First controlled prototype: exact Hub session lineage + signed, uncached status check** using Hub's already-durable session store. The Tiquet session carries only a non-bearer SHA-256 Hub session reference; Tiquet sends a signed request to Hub for each HTTP authorization and staff WebSocket heartbeat. No newly created revocation table is needed. Hub logout deletes the referenced session durably, and the next Tiquet check fails closed. **Chosen for isolated test only.**

## Feature gates — BOTH required for isolated acceptance

- Hub: `V79_HUB_TIQUET_SESSION_BINDING=1`.
- Tiquet: `V79_TIQUET_SESSION_BINDING_ENABLED=1` plus existing `V79_ENTITLEMENT_RECHECK_ENABLED=1`.
- Default (no flags): original runtime and token behavior unchanged.
- When enabled, older Tiquet JWTs without an exact bound Hub session reference are rejected; no silent legacy bypass.

## Threats and limitations

- Signed check is HMAC-bound to a fixed Hub endpoint, product service ID and identity scope; it does not transmit Hub browser credentials. The SHA-256 session reference is not itself an access token.
- HTTP checks are uncached, so **Hub outage or invalid status fails closed**, adding ~one internal RPC per protected HTTP request. Staff WS heartbeat rechecks, so closure is bounded by heartbeat execution rather than instantaneous.
- Performance, high request concurrency, on-prem reliability, provider outage behavior and resource consumption are **not approved**; per-request RPC may be inappropriate for production without a later durable signed back-channel version.
- An old JWT issued before the feature is enabled loses access in that mode, potentially signing existing users out. Migration/logout UX and phased deployment are not approved.
- No claims about portal-link WS: that uses its independent scoped-token revocation policy.
- Hub source must authorize matching organization/member/product at status time. Cross-tenant request, missing Hub session, unsigned request, wrong HMAC or any timeout denies.
- Exact production OCI/source parity and independent encrypted restored-stack rollback remain unverified.

## Tests

- `tests/hubSessionStatus.test.js`: pure signature, strict failure, HTTP middleware and staff WS handshake/heartbeat checks.
- Separate paired two-repo full-stack test required before candidate can be considered integration-validated. Record source SHAs and never use live cookies or accounts.

**No production release authorization.** No database migration, billing/WiPay, Sentinel, MFA, privileged agents, Docker, Compose or production credentials changed.
