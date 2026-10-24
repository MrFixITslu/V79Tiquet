# Tiquet Phase 4 — Isolated SLA, Automations & Agent Collaboration

Date: 2026-10-24
Branch: feature/support-desk-phase1-20261024
Scope: fully synthetic engineering; no merge, deployment, real data or email.

## REDTEAM and architecture decision
Three paths:
1. Frontend-only clocks and collision badges — rejected because they are
   neither authoritative nor restart-safe.
2. New scheduler and collaboration microservices — rejected for cost and
   operational burden.
3. Selected: additive Postgres SLA policy/records, durable deduped internal
   rule receipts, agent presence with expiring leases, and server-side
   optimistic ticket versions. Localhost-only React workbench reads them.

Risks and safeguards:
- Timezone/DST/holidays: use IANA timezones and deterministic UTC minute
  iteration; explicit weekday/calendar validation.
- Customer waiting: pauses *resolution*, not first-response obligations;
  paused business minutes extend the due time on resume in the same ticket
  update transaction.
- Non-human replies: automatic acknowledgements, drafts and email not yet
  accepted do not satisfy the first-response target.
- Duplicate alerts: unique tenant/ticket/rule receipts, created in the same
  DB transaction as each synthetic internal alert.
- Agent collisions: 90-second presence with ticket-version check on
  heartbeat; existing If-Match prevents stale ticket PATCH operations.
- Cross-account leakage: all SLA, alerts and presence operations scope by
  tenant, existing support permission grants and ticket ownership.
- False service claims: no actual notifications, email delivery, automated
  customer messaging or synthetic-to-production bridge.
- Replay/restart: Postgres persists policy, SLA rows and automation receipts;
  transient presence naturally expires.

## Implemented artifacts
- server/support/businessHours.js — configurable business calendar,
  holiday checks, DST-aware deadlines and SLA-state calculations.
- server/support/phase4-schema.sql — synthetic support_sla_policies,
  support_sla_records, support_automation_receipts,
  support_synthetic_alerts and support_agent_presence tables.
- server/support/phase4Service.js — lifecycle hooks, accepted human-response
  recognition, rule evaluation and expiring scoped presence.
- server/support/phase4Router.js — authenticated, scoped read/evaluate/
  heartbeat endpoints for the synthetic fixture only.
- server/support/router.js — optional SLA lifecycle hook only when injected
  by synthetic fixture; unchanged when not supplied.
- tests/supportPhase4.test.js and tests/supportPhase4.integration.mjs —
  synthetic unit and local PostgreSQL scenarios.
- tests/support-ui/fixtureServer.mjs — mock-only Phase 4 API mount.
- src/support/sandboxApi.ts, SupportDeskSandbox.tsx — synthetic SLA display,
  internal rule evaluation, collaborator presence and stale revision warning.
- tests/support-ui/browserSmoke.mjs — local Chrome desktop and mobile
  navigation acceptance, only when Chrome available. No cloud browser,
  test-data upload or remote URLs.

## Rule templates
- critical_unassigned — critical and unassigned open ticket
- first_response_breach — no accepted human first response by deadline
- resolution_breach — unresolved and not paused beyond deadline

Each may generate ONE internal synthetic receipt per ticket and rule.
Evaluation requires explicit all-ticket access; no scheduled unattended
worker, customer email or external notification is enabled.

## Tests / acceptance
Run the isolated branch's GitHub Actions workflow. It checks:
- IANA DST spring/fall, holiday/weekend rollover and invalid calendars.
- Policies and deadlines tied to synthetic ticket creation.
- Atomic pause/resume and reopened-ticket state.
- Human vs auto vs queued first-response qualification.
- Tenant/permission isolation and duplicate-rule concurrency.
- 90-second agent lease expiration, stale-version rejection.
- Existing Phase 1/2 regression, 10k ticket paging and mock mail.
- React Vite build, SSR/API contract, localhost synthetic HTTP smoke.
- Chrome desktop/mobile navigation when local Chrome exists.
Report browser success separately; SSR alone is NOT browser acceptance.

## Known gaps and release hold
- Synthetic app only. Main Tiquet navigation, Hub permissions, production DB
  and production migration have NOT been changed by Phase 4.
- Hardcoded policy targets, limited daily non-overnight shifts, no
  configurable enterprise calendars or regional holiday feed yet.
- The rule engine runs only on explicit synthetic evaluation, not a
  scheduled production service.
- Presence is advisory, not a lock. Atomic If-Match remains authoritative.
- No production mail, external customer notification, real provider
  authentication or payment change.
- Full cross-version migration, service-job security hardening, load and
  disaster recovery rehearsals and live permission provisioning still need
  independent approval and validation.

## Release
NO merge to main. NO deployment. NO production/real customer access.
A separately authorized next phase is required before any live beta,
real mailbox connection or production migration.
