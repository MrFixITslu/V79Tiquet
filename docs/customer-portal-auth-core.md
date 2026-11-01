# Tiquet customer-auth foundation — isolated, not deployed

This module is a **policy kernel**, not a customer portal. It has no database writes, SMTP sending, route handler, frontend or production flag. It must remain inactive until issue #50's tenant/session integration, migration and UI are reviewed.

## Design rationale /REDTEAM
- Existing `/api/portal/:token` is a **job-scoped bearer link**, not an identity credential. Never exchange that token for customer or staff sessions.
- A separate customer session is opaque, random, SHA-256-hashed at rest, short-lived, HTTP-only, Secure, SameSite=Lax and host-only. It never confers staff/HUB access.
- Email verification tokens are independent, random, SHA-256-hashed and valid for 15 minutes. The database must **atomically consume** one verification token (conditional update) before creating a customer session, or race/replay becomes possible.
- The business/account ID must come from a verified server-side business invitation or dedicated tenant route. **Never** pass untrusted `req.body.accountId` to the helpers as if it were trusted.
- Every ticket read/write must use a DB query scoped by **both** `account_id` and `clientId`. `customerOwnsTicket` is a defence-in-depth policy only; it is not a replacement for an account-scoped SQL query.
- Use a generic acknowledgement for unknown/registered email addresses and rate-limit by IP, account destination and normalised email. Prevent notification storms, CSRF and link-prefetch token consumption; use a confirmation POST after the email link GET.
- Tenant-branded welcome emails must be idempotent, sent after committed verification and respect notification/marketing consent separately.
- Customer sessions are stored and revoked independently of staff JWT and Hub MFA. Fail closed for missing, revoked, mismatched, expired or unverified identity.

## New isolated files
- `server/customerPortalAuthPolicy.js` — pure helpers for email/name validation, verification-token checks, customer session issuance, secure cookie and account+customer ticket ownership.
- `tests/customerPortalAuthPolicy.test.js` — ten new Node built-in tests. Do not change live `server/index.js` until schemas, cross-tenant negative tests and session revocation are ready.

## Release gates
1. Dedicated relational tables for verification, customer identity, sessions and ticket linkage; indexes, TTL and single-use atomic consumption.
2. Verified tenant routing; account sign-up abuse protection and nonce-safe email links.
3. API and UI with full negative tenant tests and actual SMTP integration.
4. Owner browser acceptance, current Tiquet Hub-session security PR reconciliation, encrypted DB backup/recovery, guarded rollout and rollback.
5. No merge/deploy or public paid signup until these gates pass.
