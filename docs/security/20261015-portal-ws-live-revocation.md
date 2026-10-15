# P1 Tiquet portal WebSocket revocation — stacked draft

**Commercial focus stays Hub + Tiquet. Source change only, no production release.** This stacks after the existing [session revocation PR #37](https://github.com/MrFixITslu/V79Tiquet/pull/37) and [staff Hub SSO parity PR #38](https://github.com/MrFixITslu/V79Tiquet/pull/38).

## Brainstorm → decision → REDTEAM

1. Keep client WebSocket link checked at connection only: rejected; an already-open room continues receiving status after portal link revoke/expiry.
2. Reuse staff Hub JWT revocation middleware for client sockets: rejected; portal links intentionally have a different scoped-token/tenant contract.
3. **Selected:** use the existing portal link and owning job/account records at handshake and every 15-second heartbeat, storing only a SHA-256 token fingerprint on the socket.

Threats: stolen or revoked portal links, token rotation, expired links, suspended accounts, deleted jobs, cross-tenant job selection, DB outages and raw bearer leakage. A new job lookup is scoped to both job ID and account ID. The token is compared via constant-time digest equality, never embedded in room broadcasts or error strings. Failure unsubscribes/closes the socket; no privileged action. Already queued messages before the heartbeat may have been delivered, so this is **bounded revocation latency, not instant global broadcast cancellation**.

## Changes

- `server/tiquetPortalSocketAccess.js`: pure async DB-backed verification of the socket's immutable scoped account, job, token fingerprint and expiration; compares to current stored link and active account. Any DB error or mismatch denies.
- `server/index.js`: bind derived portal scope, revalidate immediately before room subscription, recheck portal client sockets on every heartbeat. Staff sockets continue the inherited live Hub enforcement check; no weakening or reordering of roles.
- `tests/tiquetPortalSocketRevocation.test.js`: synthetic rotate, revoke, expire, tenant-map, missing records, suspension and DB-failure safety tests; no live DB.
- Separate nondeploying inherited CI workflow extended to run the new unit suite and syntax checks.

## Mandatory reviewer/release gates

- Independently inspect the **entire stacked cumulative Tiquet #37 → #38 → this PR**, not just new files. Review query and timing semantics in actual PG adapter.
- Test two real disposable tenants, portal-token rotate and revoke while WebSocket is open (client receives close in one heartbeat), remapped tenant, staff Hub expiry, copied JWT logout, DB failure, and long-lived high-cardinality socket load on an isolated test stack.
- Evaluate the portal-link HTTP endpoints too; no customer SSO/external rollout until explicit Hub + Tiquet beta release signoff, backup/rollback, session and security acceptance.
- This draft does not migrate accounts, change secrets, release schemas, or deploy anything.

**No claims of live Tiquet protections until actual installed runtime is independently checked.**
