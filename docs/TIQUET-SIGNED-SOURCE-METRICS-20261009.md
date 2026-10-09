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

## Isolated cross-app staging evidence (passed; no production deployment)

**[PR-only staging run #3](https://github.com/MrFixITslu/V79Tiquet/actions/runs/37954249289) passed 68 assertions** on the exact Tiquet code commit `9520dacea3fe11547e5af7faf86c3ad25f091eb1`. An isolated GitHub Actions Ubuntu runner launched **the real Tiquet HTTP API** against its own temporary PostgreSQL 16 container, temporarily enabled the source-signing flag **only inside that runner**, generated a fresh test-only Ed25519 key under `/run/secrets/`, and used two provisioned **synthetic** business tenants to verify HMAC caller authentication, request expiry, tenant separation, no extra customer fields, valid signatures, spoofed signatures/changed metrics, unknown tenants and unchanged business summaries after reads.

Critically, the staging workflow checked out **the actual Hub reader and signing contract** from previously green, exact commit `411aaf5655a0860918d33373cc6f995a81339b92`. It called that reader against the *real running Tiquet endpoint*, proving the received Tiquet signature is accepted only with the trusted public key, rejects an untrusted key, and fails closed for an unknown tenant. All assertions succeeded; temporary test keys and app process were cleaned up. The workflow holds only repository read permission, has no production deployment or image-publishing steps, and does not use beta credentials or DB volumes.

This is a successful **PR-hosted real HTTP + database + actual Hub verifier rehearsal**, **not** a complete running Hub browser/session/MFA staging deployment or production key custody test. The separate default-off Hub UI panel remains subject to its own PR CI and founder browser/UAT.

## Remaining coordinated release plan (NOT yet completed)

1. **DONE for synthetic PR staging:** separate draft branches, real HTTP + temporary PostgreSQL test, generated temporary keys, and pinned-Hub verification.
2. **DONE for synthetic PR staging:** route and exact organisation mapping verified against isolated PostgreSQL test tenants. A separate security review and a complete Hub browser test remain open.
3. **OPEN for real release:** securely provision a dedicated long-lived Ed25519 app key on an authorised staging host, mount the private PEM only in Tiquet, configure only public PEM in Hub, and review key custody, escrow, rotation and recovery. The disposable CI key does **not** satisfy this.
4. **OPEN for full multi-service staging:** the Tiquet test process had its flag enabled only in disposable CI; run the full Hub application with its independent flag enabled and a genuine owner MFA session in a separately protected staging environment.
5. Using an MFA-verified founder session, fetch Hub `GET /api/agent/sources/tiquet/metrics` and verify fresh Tiquet aggregates, exact tenant/nonce binding, disabled execution status, and safe `unavailable` state on missing app/key/network/tenant.
6. **PARTIALLY DONE:** synthetic negative checks and read-only aggregate comparisons passed. Isolated real-Hub runtime, outbound write denial, source-key rotation and browser visual acceptance remain open.
7. Only after staging, original-source signing review, key escrow and founder acceptance may deployment be separately authorised. Source metrics remain read-only; Phase 3A planning approvals do not dispatch actions.

## Current non-production status

- Signer and route are **committed to a feature branch only**.
- Feature flag defaults **OFF**.
- A disposable CI-only signing key was generated and deleted during successful tests. **No signing key is configured, committed, emailed or inserted into beta/production.**
- This route does not make Tiquet tickets or account changes.
- Hub's matching disabled-by-default verifier and separate founder-facing, read-only evidence panel are in draft PR #103.
- This is only the first original-source signed evidence component. Agent investigation source-signed attribution, audit retention and safe multi-Hub staging remain separate gates.
