# Vision79 Tiquet — Phase 1 Isolated Engineering Receipt

Date: 2026-10-24
Repository: MrFixITslu/V79Tiquet
Branch: feature/support-desk-phase1-20261024
Base main commit: 2c4d652cab2f7e434706ce8d884d504b7d5818ea

## Authority / release hold
Owner approved source-code changes only on an isolated feature branch, with synthetic tests.
NO merge to main. NO production or staging deployment. NO production data.
NO real emails, customer accounts, payments, customer portals, or AI inference.
No GitHub production workflow was edited or executed by this work.

## Three candidate approaches and REDTEAM
- Mutate existing jobs: rejected, risks job/payment state.
- Separate standalone helpdesk: rejected, extra auth/maintenance burden.
- Add modular Support Desk with separate schema and locked-off runtime flag: selected.

## Implemented, isolated
- Support-specific additive SQL schema in server/support/schema.sql.
- Separate tickets and messages, events, idempotency keys and job link table.
- Support-only routes in server/support/router.js:
  GET/POST /api/support/staff/tickets;
  GET/PATCH /api/support/staff/tickets/:id;
  GET/POST /api/support/staff/tickets/:id/messages;
  POST /api/support/staff/tickets/:id/links.
- Tenant predicates on every ticket/message query.
- Explicit support.* permissions; all-ticket access only with Admin or
  explicit support.view.all. Other permitted staff access tickets they created
  or to which they are assigned, enforced on reads and writes.
- Ticket state transition rules, If-Match version-based conditional updates,
  idempotent creation and private internal notes.
- Same-tenant links to existing jobs, without changing job stage or payment.
- Exact microsecond cursor pagination with 25 default/100 maximum page size.
- Synthetic-only mount guarded by NODE_ENV=test, CI_SUPPORT_SYNTHETIC=1,
  V79_SUPPORT_DESK_ENABLED=1 and a localhost tiquet_support_test DB URI.
  Dynamic imports ensure normal and production startup never load this module.

## Deliberately NOT enabled
- The new SQL is NOT added to the existing server's startup migration.
- Production Support Desk endpoints remain unavailable.
- New public replies return OUTBOUND_NOT_ENABLED; no email worker, SMTP,
  IMAP, webhook, notifications or customer-facing support portal exists.
- New support frontend is not integrated with the current UI.
- No automatic conversion of legacy jobs or job messages.
- No support ticket access through existing job portal tokens.
- SLA, collaboration sockets, attachments, KB, reporting and AI are future work.

## Verification
- GitHub Actions: .github/workflows/support-phase1-synthetic.yml.
- Disposable PostgreSQL 16 at localhost, synthetic fixture users/clients/jobs,
  no production secrets, no outbound provider.
- Tests: contracts/permission units, idempotency (including concurrent retry),
  object/tenant boundaries, conditional updates, internal note isolation,
  same-tenant job references, pagination over 10,000 synthetic tickets,
  microsecond cursor precision, schema applied twice and existing unit/lint.
- Existing P1 tenant-file production-mode CI was rerun after dynamic-import fix.
- CI results must be checked at the HEAD commit before claiming Phase 1 PASS.

## Known limitations / future hard gates
1. No actual Hub-driven support role permission provisioning yet. Only explicit
   grants in synthetic fixtures were exercised; Hub entitlements are unchanged.
2. Support job/client relationships are verified on API paths; database-level
   composite FKs to legacy tables need migration review before commercial release.
3. Current message-list prototype returns bounded first page only. Implement
   safe message cursors before high-volume rollout.
4. No production schema migration/rollback rehearsal. Current migration test
   covers only a synthetic fresh database and repeat application.
5. Synthetic 10k query is a functional bound test, not a measured p95 latency
   or system-wide resource stress test.
6. The design OpenAPI includes future routes not yet implemented: do not
   claim the entire proposed contract is live.

## Next authorization
Completion of Phase 1 does not authorize Phase 2 mail integration, merging,
deployment, customer beta, real mailbox tests or sending messages.
Require separate approval for the next bounded engineering scope.
