# Phase 2C — Tiquet source-signed metrics pilot

**Status: code-review-only draft. Disabled by default. Do not merge or deploy.**

## What is included
A new internal `POST /api/platform/evidence/signed` route behind the existing Hub-to-Tiquet HMAC authentication middleware. It reads **only five tenant-scoped numeric aggregates**—client count, job count, team member count, unread notification count, and total job value—and signs the strictly canonical `v79-source-metrics-v1` envelope using an application-owned **Ed25519** private key. It returns `executionEnabled:false` and never reads ticket bodies, contact details or file attachments.

The route returns HTTP 404 by default. It is **not enabled** by a general platform shared secret alone. Additional prerequisites are a separate reviewed flag and a root-protected private signing key file, plus the matching application public key configured in V79 Hub. None are currently configured for release.

## End-to-end authorization and freshness contract
1. Hub sends a short-lived, server-minted **UUIDv4 request ID** and the Hub organisation ID using the existing HMAC authenticated service-to-service POST. The request must contain only `organizationId` and `requestId`.
2. Tiquet resolves an **exact** `accounts.hub_organization_id` match; absent/suspended or non-Hub accounts cannot return signed data. The five parameterized SQL aggregates read only rows under that account's internal ID.
3. Tiquet builds a 120-second-valid UTF-8 canonical payload, rejects arbitrary fields/strings or nonfinite/out-of-bound numbers, and signs it with the source's Ed25519 key. The signing key is **never** sent to Hub; the output contains no contact details or ticket contents.
4. Hub's independently reviewed `server/source-metric-signature.mjs` uses a separately configured **public** Ed25519 key to verify the originating source, timestamp, tenant, request ID and metric allowlist. It emits only bounded numerical facts to the AI ledger, never signatures, IDs or source text.
5. Invalid, expired, incorrectly signed or missing metrics must be shown as **unavailable**, never zero. Source signature proves that Tiquet signed the reported numbers, not that the counters are substantively correct.
6. Plan-only approval remains owner/MFA scoped. Signing an aggregate does **not** grant write permissions.

## Development and test gates
- `tests/sourceEvidenceSigner.test.js` uses newly generated **synthetic keys in process memory** and verifies a golden canonical byte vector plus bad tenant/nonce/schema, secrets, malformed metrics and altered signed payload.
- Existing platform provisioning isolation test adds **disabled-by-default, unsigned and bad-HMAC** request assertions for the new endpoint.
- Before any production release, add an isolated enabled-route integration test with a test-only secure private key file and synthetic Hub tenant/database. Verify tenant crossover, key mode, suspended account, no-write DB traffic and request rate limit.
- Document Ed25519 key issuance/rotation/revocation via protected secrets mount, application-specific public key pinning, safe rollout, expiry/replay cache if required, and a read-only feature-flag rollback.
- Deploy **Tiquet source signing separately**, then wire Hub verification under a separately reviewed default-off flag, and only after that consider relabelling valid source data as `source_signed`.
- Retain strict production change control; no merge to `main` (which may deploy), no credentials or customer data committed to Git, no billing, outbound emails or autonomous agent actions.

**Current security disposition:** This feature is preparatory and OFF. It does not close Phase 2C source-authentication requirements, which need an authenticated end-to-end acceptance test and explicit release approval.
