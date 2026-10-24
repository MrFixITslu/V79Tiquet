# Tiquet Support Desk — Phase 3 Isolated Agent UX

**Date:** 2026-10-24  
**Branch:** feature/support-desk-phase1-20261024  
**Authorization:** isolated frontend engineering + synthetic backend integration ONLY

## Three implementation paths and REDTEAM

1. Rewrite existing Tiquet App / Sidebar: rejected. High risk to Hub SSO, job
   pipeline, payments, existing deep links and released UI.
2. Polish the old standalone HTML prototype: rejected. It would not validate
   actual Support Desk APIs and would confuse local state with durable data.
3. **Selected:** a separate React test workbench using the real, tenant-scoped
   Phase 1 Support API on a localhost-only synthetic Express/PostgreSQL fixture.

## Implemented

- src/support/SupportDeskSandbox.tsx: approved three-column desktop inbox,
  mobile ticket-list/conversation navigation, queues, search, ticket detail,
  status/priority editing, private notes, customer context, linked job UI,
  limited-page operational summary, mailbox status.
- src/support/sandboxApi.ts: typed HTTP adapter with optimistic If-Match
  updates, idempotency keys, explicit error statuses and cursor paging.
- src/support/supportDesk.css: responsive Vision79/Tiquet support styling.
- src/support/sandboxEntry.tsx: fails closed if hostname is not localhost.
- tests/support-ui/index.html and vite.config.ts: distinct Vite build/dev root
  on 127.0.0.1:4308 proxying to 127.0.0.1:3088.
- tests/support-ui/fixtureServer.mjs: restricted synthetic-only localhost HTTP
  API with disposable PostgreSQL, mock email, fake clients, jobs and messages.
- tests/support-ui/fixtureSmoke.mjs: verifies complete API flows and denies
  customer-visible outbound responses.
- tests/support-ui/contract.test.mjs: SSR, gated locality, typed API,
  conflict handling, idempotency and delivery-status wording contracts.
- server/support/router.js: additive GET of same-tenant linked job IDs;
  existing support authorization applies.
- Isolated branch GitHub Action runs React+Vite build, SSR/API checks,
  localhost fixture smoke, previous Phase 1/2 database contracts and
  baseline TypeScript + unit regression suite.

## REDTEAM controls

- **No real credentials or customer data.** Fixture requires test-only
  environment values, known localhost disposable DB and exact synthetic
  opt-in. Fake providers accept only .invalid addresses.
- **No production navigation changes.** The real App.tsx, Sidebar.tsx,
  auth flow, financial modules, jobs and deployment workflow remain untouched.
- **No email sending.** UI permits private notes only. Simulated outbound
  states are read-only; the Phase 1 public-send endpoint remains disabled.
- **No cross-tenant previews.** Routes use existing authenticated support
  scope in their injected fixture. The fixture HTTP identity header is for
  localhost tests ONLY and is never wired into the production server.
- **No unbounded ticket loads.** Server cursor pagination, 25 per page.
- **No misleading metrics.** Reports are explicitly labeled "loaded page
  only"; SLA targets are not yet calculated.
- **No fake delivery claims.** "Provider accepted" explicitly does not mean
  delivered. "Uncertain" is not automatically retried.
- **No HTML/script injection.** Text messages render as React text, not
  raw markup.
- **Customer context respects data boundary.** Only scoped support fields
  and in-conversation synthetic sender are shown; no unrestricted legacy
  client collection or other tenants' jobs are fetched.
- **Stale update recovery.** HTTP 412 displays error, reloads ticket,
  and does not silently overwrite a concurrent change.

## Scope and known gaps

- This is a **real React module against synthetic APIs**, not deployed or
  integrated into the live Tiquet application navigation.
- Agents are represented by hardcoded synthetic fixture identity agentA;
  Hub auth/role provisioning is outside this phase.
- Assignment UI is read-only pending a scoped team-directory endpoint.
- Customer profiles, formal SLA analytics and organization-wide reports
  require API contracts and separate authorization.
- Phase 1 messages endpoint supplies only the latest 25, and the UI
  announces the limit. Cursor pagination is not implemented for messages.
- Phase 2 mock email remains a standalone test component, not a worker
  with real provider credentials.
- Visual/browser interaction tests beyond build, server-rendered structure,
  API contracts and synthetic HTTP flows must be confirmed separately;
  do not equate rendering assertions with full end-to-end UX acceptance.

## Safety and next gate

Do NOT merge this branch into main, deploy to staging or production, execute
production database migrations, send real emails, connect mailbox providers,
create real Hub permissions, or expose the synthetic fixture online.

Once tests pass at the exact feature branch HEAD, Phase 3 is ready for
review. Phase 4 work requires a fresh, separately scoped authorization.
