# Tiquet Support Desk — Phase 5 Synthetic Beta-Readiness Review

Date: 2026-10-24
Branch: feature/support-desk-phase1-20261024
Authority: isolated synthetic engineering, testing and safe fixes only.
Explicitly prohibited: merge, deployment, production/customer data, live email.

## Architecture / REDTEAM: top three approaches

1. Static source review: REJECTED, insufficient runtime assurance.
2. Production/staging scans: REJECTED, violates authorized isolation.
3. SELECTED: disposable PostgreSQL 16, localhost-only synthetic APIs and
   React browser tests, bounded performance, local logical backup/restore.

Adversarial cases considered:
- IDOR and cross-tenant access to tickets, notes, SLA, links, presence.
- SQL injection, overposted account IDs, forged Origin and Host.
- Duplicate mail, unverified sender, uncertain delivery and false send claims.
- Duplicate automation, stale ETag, ticket collision and replays.
- DST, holidays, and false SLA success on late accepted responses.
- React subject injection and a browser-only accessibility failure.
- Database backup loss / missing foreign keys during restoration.

## Implemented safe corrections

Security:
- Synthetic fixture denies unapproved Host and Origin, blocks rebinding,
  sends no-store, nosniff and DENY framing headers.
- Tests use raw HTTP forged-Host to avoid undici/fetch Host normalization;
  malicious Origin, SQL-injection string, forbidden overposted tenant and
  outbound public-send rejection are verified through localhost API.
- React browser displays an injected-looking synthetic subject as plain
  text; no executable IMG element is generated.
- Prior tenant isolation and permission test suites run on every branch CI.
- Fixture-only header identity is NOT a production authentication system.

SLA:
- Late first response or late resolution remains breached, not falsely met.
- Synthetic first-response accepted event uses outbox updated_at where a
  matching accepted outbox exists instead of the initial queue timestamp.
- No real-provider acceptance semantics are claimed.

Accessibility and E2E:
- Modal handles Escape and Tab-cycle; focus returns to the New Ticket trigger.
- Skip-to-content link added.
- Local Chrome tests desktop/mobile navigation, SLA/alert screens, response
  indicators, viewport overflow, keyboard, synthetic ticket creation,
  private-note persistence, and HTML-as-text handling.
- Chromium accessibility-tree check rejects unnamed exposed interactive
  elements. This is not a full independent WCAG 2.2 AA audit.

Performance:
- Synthetic dedicated perfA tenant with 15,000 tickets.
- 60 sequential HTTP pages of 25 tickets; unique IDs, no tenant leakage.
- Search injection and unbounded limit refusal checked.
- Observed one completed CI p95: 4.8 ms (runner-specific, not production SLO).

Recovery:
- Exact localhost disposable database guards; test mode only.
- PostgreSQL pg_dump custom format and pg_restore to an entirely separate
  disposable database. Row count, FK and tenant-scoped ticket ID verification.
- Temp dump and restored DB deleted; no production migrations/images/volumes.
- Not evidence of encrypted off-host, point-in-time or production restores.

## Acceptance links
Branch: https://github.com/MrFixITslu/V79Tiquet/tree/feature/support-desk-phase1-20261024
CI workflow: https://github.com/MrFixITslu/V79Tiquet/actions/workflows/support-phase1-synthetic.yml

A completed PASS requires CI success on the exact current feature-branch HEAD.
Earlier successes are not final evidence for later code changes.

## Release verdict
Synthetic engineering: PASS only when exact-head CI succeeds.
Commercial beta / staging / production: NO-GO.

Blocking work needing separate owner approval:
P0. Hub SSO and support entitlements; removal of all fixture-only headers
from any release; real provider authentication, MIME/threading validation,
privacy/data lifecycle, real send/receive verification, production-schema
migration/rollback and off-host complete-app restore.
P0. Authorized replica integration/security tests for legacy jobs, invoices,
payments, customer portal and billing; pinned release/rollback approval.
P1. Team assignment UI, tenant-aware SLA configuration, message pagination,
full reports, notification UX, knowledge base and customer-facing support.
P1. Independent WCAG 2.2 AA accessibility and representative infrastructure
performance/capacity testing, with full human customer beta acceptance.

This phase does not authorize any of the blocking tasks above. Main, live
services, production database and real customer messages remain untouched.
