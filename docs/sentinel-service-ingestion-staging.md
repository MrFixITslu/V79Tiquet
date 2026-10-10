# Sentinel → V79Tiquet service ingestion: isolated staging ONLY

**Status: NOT DEPLOYED; flag OFF by default.** Branch: `feature/sentinel-service-ingest-20261010`.

A dedicated `POST /api/integrations/sentinel/v1/events` service route is separate from user-JWT `/api/jobs`. Its request parser uses the existing Express raw body verifier. It never generates a portal token, sends email, charges or invoices, and never automatically closes work orders. Sentinel owns the incident; Tiquet owns the technician job.

## Configuration (do not enable in production yet)
- `V79_SENTINEL_INGEST_ENABLED` must explicitly equal `1`; otherwise the endpoint responds 404.
- `V79_SENTINEL_LINKS_JSON` must list approved customer UUID, exact Hub organization ID, Tiquet account ID and pre-existing client ID, a **unique randomly generated secret of at least 48 bytes**, and `enabled:true`. Do not store secrets in Git.
- A transaction checks the active Tiquet account's `hub_organization_id` and verifies the client belongs to that account. No name/email/domain matching.
- An additional `authorizeService` callback must explicitly confirm a **live Hub service entitlement** for the exact service, customer, organization, account, client, and action, on every request, including replays. Without that callback, the route returns HTTP 503 and cannot write tickets **even if an operator sets the feature flag to 1**. The live Hub service checker is not yet implemented/wired; test callbacks are synthetic only.

## Signature
Headers: `x-v79-service-id: v79-sentinel`, `x-v79-sentinel-customer` UUID, `x-v79-timestamp` (Unix seconds, within 5 minutes), `x-v79-signature` (lowercase hex HMAC-SHA256). Signing input: POST, newline, exact endpoint path, newline, timestamp, newline, lowercase SHA256 of raw JSON bytes. Body limit 12 KiB. Browser origins, cookies and user tokens rejected. TLS mandatory when `NODE_ENV=production`.

Events require `source:v79-sentinel`, `classification:PRODUCTION_VERIFIED`, correct tenant IDs, UUID event/incident identities, stable idempotency/correlation keys, and `ticket.create` or `ticket.add_recovery_evidence`. The current mock generator emits `SIMULATED_ONLY`, which is rejected by this route. No production-qualified signed publisher has been deployed.

## Durability and safety
PostgreSQL tables `sentinel_incident_jobs` and `sentinel_ingest_events` record stable incident-to-job links and receipts. A per-incident advisory transaction lock ensures serial processing; duplicate delivery returns the original job, conflicting replays fail. Creates a `request` job without a secure portal token or financial action. Recovery only sets an internal evidence marker and activity entry; technician must close the job.

## Release gates (remain on HOLD)
1. **Verified on disposable PostgreSQL 17:** full Tiquet schema creation and signed HTTP ticket opening, eight simultaneous idempotent retries, rejected cross-tenant/changed payload, recovery evidence and no auto-closure. **Still pending:** forced process crash/recovery, durable outbox delivery, long-lived restore rehearsal and production failover.
2. Independently verified Hub customer entitlement/service-identity mapping and active subscription/revocation checks; dedicated key rotation.
3. Sender from *verified* Sentinel evidence, signed bounded outbox delivery, backoff/retry and monitoring.
4. Independently reviewed immutable commit, backup+restore test, controlled maintenance and server access restrictions.
5. Explicit single-tenant pilot approval, production flags default-OFF, staged rollout and rollback rehearsal.

Only an isolated Acer worktree was changed; no live users, Tiquet tickets, production databases, payment systems, mail routes, or Hub sessions were touched.

## October 10 isolated Acer evidence
- Final `npm test`: **36/36 passed**, 0 failed, 0 skipped (includes fail-closed absent entitlement authority, revoked entitlement and replay revocation).
- `npm run lint`: passed after explicit TypeScript Node type scope in this branch.
- `npm run build`: passed; existing Vite large-chunk advisory remains.
- `node --test tests/sentinelIngressPostgres.integration.mjs` rerun with verified local PostgreSQL **17.11** runtime: **1/1 passed** on disposable private-socket database; one job, two receipts, eight simultaneous retries, safe recovery and no auto-closure. The test stops and removes its temporary PG server and data.
- Hub disposable JSON **and PostgreSQL 17** auth/MFA/QA lifecycle independently passed, 2 of 2, zero skips (separate isolated Hub checkout).
- The old mock simulator and source remains separate, sending `SIMULATED_ONLY`. It cannot cause real Tiquet jobs.
