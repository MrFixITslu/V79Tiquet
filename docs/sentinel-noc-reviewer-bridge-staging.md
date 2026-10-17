# V79 Sentinel → NOC independent human authorization (STAGING ONLY)

The Sentinel Tiquet route remains OFF by default. An independently signed
human approval is verified by Ed25519 public key. In addition, **every**
ticket.create and duplicate replay must pass TWO separate live authorities:

1. Hub machine-service entitlement for the exact Sentinel customer, owner
   organization, Tiquet account and dedicated V79 Sentinel Pilot client.
2. NOC currently active administrator status for the same approval UUID,
   approved time, organization, customer and ticket.create action.

`createSentinelNocApproverChecker` in
`server/sentinelNocApproverChecker.js` signs a no-cookie, no-JWT machine POST
to the NOC with HMAC-SHA256, 2-minute timestamp tolerance, HTTPS with
system-trusted certificate and no redirects, no cache and a 3.5-second
deadline. Misconfiguration, timeout, role revocation, invalid response or
missing callback denies live ticket creation.

Activation (requires separate owner change approval and tested private path):
- `V79_SENTINEL_INGEST_ENABLED=1`
- `V79_TIQUET_SENTINEL_HUB_CHECK_ENABLED=1` (existing Hub machine grant checker)
- `V79_TIQUET_SENTINEL_APPROVER_CHECK_ENABLED=1`
- `V79_SENTINEL_NOC_URL=<verified HTTPS PRIVATE NOC ORIGIN>`
- Prefer `V79_SENTINEL_NOC_SHARED_SECRET_FILE=/run/secrets/v79_sentinel_noc_reviewer` with a protected regular file readable only by the runtime owner (0400 or 0600). Do not disclose its contents in Docker environment listings. The legacy `V79_SENTINEL_NOC_SHARED_SECRET` string is still supported for existing staged tests but is not recommended for production; when a file is set, the service fails closed and never falls back to an environment secret if that file is unsafe or unavailable.
- independently provisioned Ed25519 APPROVAL **PUBLIC** key(s), precise
  customer / account / client mappings and existing Sentinel-Tiquet
  event-signature credentials.
- NOC owner-only `SENTINEL_APPROVER_SERVICE_SECRET_FILE` contains the
  same service credential; the private read-only status endpoint is now enabled on the Acer behind an HMAC-only, Tailscale Serve restricted gateway. No Tiquet ingestion is enabled.

NO Tiquet ingestion or Hub machine-grant settings above have been enabled in the live Tiquet container. Since the device-share and restricted private Tailscale Serve rollout, Dell host and actual Tiquet Docker container can reach the Acer private hostname through verified HTTPS. Acer SSH and NOC administration port remain inaccessible. Read-only NOC approver HMAC validation is live, but no Tiquet connector callback is deployed. Do not bypass TLS, open public routes, or enable dispatch.
Tests: 50/50 full Node suite and strict TypeScript check, 107/107 NOC suite prior to latest service activation, actual cross-runtime
Ed25519 event verification and actual signed Node-to-NOC ephemeral HTTP
service-bridge test passed. Final live PostgreSQL and transport tests remain
subject to release acceptance.
