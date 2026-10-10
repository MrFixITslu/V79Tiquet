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
- `V79_SENTINEL_NOC_SHARED_SECRET=<separately provisioned secret>`
- independently provisioned Ed25519 APPROVAL **PUBLIC** key(s), precise
  customer / account / client mappings and existing Sentinel-Tiquet
  event-signature credentials.
- NOC owner-only `SENTINEL_APPROVER_SERVICE_SECRET_FILE` contains the
  same service credential; its private endpoint is separately default off.

NO settings above have been enabled on the live Tiquet container. The
Dell currently does not resolve the existing Acer tailnet NOC hostname;
do not bypass TLS, open public routes, or enable dispatch.
Tests: 47/47 full Node suite, 104/104 full NOC suite, actual cross-runtime
Ed25519 event verification and actual signed Node-to-NOC ephemeral HTTP
service-bridge test passed. Final live PostgreSQL and transport tests remain
subject to release acceptance.
