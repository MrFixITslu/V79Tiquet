# Tiquet → Hub original-source signed metrics (Phase 2C pilot)

**9 October 2026 — draft development only; disabled by default. Do not deploy or enable on production without a separately reviewed coordinated release.**

## Implementation

New read-only endpoint after the existing Hub platform HMAC authentication:

`GET /api/platform/agent/signed-metrics/:organizationId/:requestId`

Hub creates a new UUIDv4 request ID and signs the **exact GET pathname** using the existing platform caller contract. Tiquet requires:
- `x-v79-service-id: v79-hub` and valid timestamp/HMAC signed request.
- Explicit `V79_TIQUET_SIGNED_METRICS_ENABLED=1`, otherwise HTTP 503, no data read.
- A dedicated Ed25519 **private key file** mounted under `/run/secrets/`. Neither the old platform HMAC secret nor Hub signing key may serve as this key.
- Exact Hub organisation ID mapping to one Tiquet account via `accounts.hub_organization_id`. No account-ID alias or default-tenant fallback. Suspended/unavailable tenants produce no metrics.
- A valid UUIDv4 bound into the HMAC-signed path and returned source Ed25519 payload.

The app reads only aggregate `COUNT` and `SUM` queries scoped to the mapped Tiquet account. The signed v1 envelope permits only **clients, jobs, teamMembers, unreadNotifications and jobValueTotal** as finite numeric metrics. All payloads use the same canonical property order and metrics-key sorting as Hub's `server/source-metric-signature.mjs`. The signature signs the complete canonical JSON, including source, tenant, fresh request ID, observedAt and a 90-second expiration.

**No** client name, ticket description, user/contact email, invoice, amount for an individual transaction, message, attachment, access token or raw customer row is returned. A verified signature does not prove that a metric is truthful if Tiquet itself is compromised.

## Coordinated staging plan (NOT executed)

1. Keep both repos on their own draft feature branches. Let CI run with synthetic Ed25519 key pairs only.
2. Review tenant lookup and current `isRead` schema on an isolated staging copy; do not run setup/migrations on the beta system.
3. Generate a fresh dedicated Ed25519 key on an authorised secure staging host. Store the private PEM in a restricted Tiquet-only Docker secret under `/run/secrets/`; configure only the corresponding **public** PEM (base64-encoded) in the Hub environment. Record key custody and rotation procedures separately. **Do not commit either private key or credentials.**
4. Enable `V79_TIQUET_SIGNED_METRICS_ENABLED=1` in the isolated Tiquet staging instance and `V79_TIQUET_SIGNED_METRICS_ENABLED=1` in the isolated Hub staging instance.
5. Using an MFA-verified founder session, fetch Hub `GET /api/agent/sources/tiquet/metrics` and verify fresh Tiquet aggregates, exact tenant/nonce binding, disabled execution status, and safe `unavailable` state on missing app/key/network/tenant.
6. Run wrong-organisation, expired, forged, oversized-response, cross-tenant and read-only method tests. Verify **zero** downstream modifications and no model consumption of unvalidated envelopes.
7. Only after staging, original-source signing review, key escrow and founder acceptance may deployment be separately authorised. Source metrics remain read-only; Phase 3A planning approvals do not dispatch actions.

## Current non-production status

- Signer and route are **committed to a feature branch only**.
- Feature flag defaults **OFF**.
- No private key is configured, generated, committed, emailed or inserted into beta.
- This route does not make Tiquet tickets or account changes.
- Hub's matching disabled-by-default verifier is in draft PR #103.
- This is only the first original-source signed evidence component. Agent investigation source-signed attribution, audit retention and safe multi-Hub staging remain separate gates.
