# Phase 4 — Tiquet customer self-service (DEVELOPMENT ONLY)

## Product flow
- Customer signs up with name, email and explicit service-email consent.
- One-time 30-minute email verification establishes a **customer-only** HttpOnly session.
- Returning customers request a new 15-minute passwordless email sign-in link.
- Customer may view only their own client-bound tickets, submit service requests, see customer-visible job messages and send replay-safe service messages. Staff-private agent drafts are never exposed.
- New service requests remain `request`, never paid or scheduled. Messages never change prices, staff roles or appointments.
- Existing staff Hub MFA, staff roles, staff cookies, job-token portal, WiPay, and current client workflows are unchanged.
- New SPA route: `/customer`; emailed links: `/customer/verify?token=...`, `/customer/login?token=...`.

## Feature flag contract
This feature is completely OFF by default:
- Backend `V79_CUSTOMER_PORTAL_ENABLED=1` to mount only `/api/customer`.
- Backend `V79_CUSTOMER_PORTAL_ACCOUNT_ID` must be the **full, trusted** server-side account id for the single controlled V79 pilot; browser input cannot set it.
- Backend `V79_CUSTOMER_PORTAL_PUBLIC_URL=https://tiquet.v79sl.com`.
- Frontend compile-time `VITE_CUSTOMER_PORTAL_ENABLED=1` enables the customer UI route. It is not an authorization switch; the backend owns that.
- Dedicated additive database migration: `server/customerPortalSelfService.schema.sql`, **NOT applied to production**.

## Independent synthetic validation completed
- Build: `npm run build` PASS.
- Types: `npx tsc --noEmit` PASS.
- Synthetic PostgreSQL 16 with actual baseline `server/schema.sql` + candidate migration, UNIX socket and `listen_addresses=''`: PASS. The Acer-only operator harness is retained privately at `~/V79-Recovery-Checkpoints/phase4-customer-portal-full-schema-test-20261101.sh`, not shipped as a nonportable repo script. Portable GitHub Actions PostgreSQL workflow runs the same code/security contract.
- Happy paths: create account, verify email, new ticket and ticket details, customer-visible conversation read/write, duplicate ticket/message idempotency, returning user login, logout.
- Negative paths: wrong origin, no customer session, staff cookie not accepted, expired/replayed link contract, no business-id acceptance, direct other-client ticket 404, tenant-B cookie cannot read tenant-A, forged status/amount ignored.
- All tests isolated; no live customers, payments, email, DB mutations or new Docker containers.

## Threat model / REDTEAM remaining before release
- No role or subscription field accepted from customers.
- Per-IP signup/request-login and ticket rate limits are enabled in production; distributed abuse protection and account-based resend throttles should be independently evaluated.
- Email send result is not yet a durable provider receipt; app reports generic acceptance to avoid email enumeration.
- Registration link and sign-in link data should not be logged; set app HTTPS Referrer-Policy, redact URL tokens from reverse-proxy logs, ensure no analytics/referrer leakage.
- Need real deliverability, sanitized templates, privacy/retention policy, deletion/data export, bounce handling, email verification failure UX, support intake notifications.
- Check stale/expired link and logout on actual deployed app and against DB outage; verify all routes use server account and client identity.
- Add browser/mobile automated journey and accessibility review; then two-customer-two-tenant pilot.
- Signed Tiquet session PRs #44/#49 and Phase 1 acceptance must be reconciled first. Do not merge this standalone draft or apply migration until exact deployed source+rollback+owner approval.
- Preserve current Hub staff MFA and current job-token portal.
- No paid activation; WiPay remains pending and is not referenced by this feature.
