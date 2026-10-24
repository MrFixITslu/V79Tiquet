# Vision79 Tiquet Support Desk — Phase 2 synthetic mail engineering

Date: 2026-10-24
Branch: feature/support-desk-phase1-20261024
Baseline main: 2c4d652cab2f7e434706ce8d884d504b7d5818ea

## Authority and hard boundaries
Approved: build and test mocked inbound email, threading, outbox, retries and delivery states
on the existing isolated branch with synthetic data only.
NOT authorized: merge, deploy, production DB access, real SMTP/IMAP/Graph/Gmail,
real mailbox credentials, actual email sending, customer traffic or billing.
The Phase 2 engine has NO production mount, exposed API route or background scheduler.
The Phase 2 schema is NOT included in automatic startup migrations.
All addresses must end in the reserved unroutable .invalid TLD.

## Three options evaluated, REDTEAM conclusion
1. In-memory queue: rejected, crashes can lose accepted messages.
2. Redis/worker deployment: rejected, adds new infrastructure and failure modes.
3. PostgreSQL transactional ingest receipts + durable outbox: selected.

## Implemented
- server/support/mail-schema.sql: scoped synthetic mailboxes, participants,
  RFC reference mapping, deduplication receipts, outgoing queue and indexes.
- server/support/mailContracts.js: synthetic-only runtime gate, mailbox/address
  validation, message IDs, idempotency keys, trusted mock-sender metadata.
- server/support/syntheticMail.js: explicit injected synthetic provider (no
  network transport), transactional inbound ingest, RFC-ID threading,
  strict participant validation, outbound queue and state transitions.
- server/support/permissions.js: explicit support.reply grant. Existing support
  permissions still enforced by Phase 1 and are unchanged for real accounts.
- tests/supportPhase2.test.js and tests/supportPhase2.integration.mjs:
  disposable PostgreSQL fixtures and fault-injected fake provider.
- .github/workflows/support-phase1-synthetic.yml: additional Phase 2 steps in
  existing isolated branch workflow; no image, artifact, SSH, secrets, SMTP,
  deployment or production migration.

## Threading and security decisions
- An inbound message is claimed atomically by tenant, mailbox, provider UID
  and RFC Message-ID. Same immutable payload is replay-safe; mismatched
  identity conflicts. Concurrency is serialized by PostgreSQL unique keys.
- Threading uses exact References IDs within the same account+mailbox. Subjects
  never authorize a ticket join. Ambiguous references are rejected.
- Only an already registered participant can append inbound mail to a ticket.
  Unknown senders start a separate support ticket, never exposing history.
- Input must be marked authenticated by the synthetic provider. THIS IS NOT
  production SPF/DKIM/DMARC validation; real provider integrations require a
  separate threat review and trusted verification layer.
- A new outgoing recipient must already be an authorized ticket participant.
  Enqueue requires the actor's support.reply capability and ticket visibility.
- Outbound Idempotency-Key and message creation happen in one transaction.
- Actor and tenant are never inferred from an untrusted email header.

## Delivery outcomes
- queued: committed to the local database, not sent.
- sending: one worker owns a leased job; concurrent claim uses SKIP LOCKED.
- accepted: mock provider signaled acceptance; NOT proof of inbox delivery.
- queued after retryable_failure: retry with exponential backoff.
- failed: permanent failure or retry limit reached (three attempts).
- uncertain: mock transport exception / lost confirmation / expired lease.
  Never automatically resend an uncertain item.
- Manual mock-only reconciliation requires an explicit synthetic proof string;
  it cannot silently requeue or emit real mail.
- A real provider must document exactly what an acknowledgement guarantees.

## Tests / release gates
The isolated workflow first executes Phase 1 unit and synthetic PostgreSQL
regressions, then Phase 2 validation, then existing TypeScript and app unit tests.
Phase 2 covers: repeated schema application, provider UID + Message-ID
deduplication, concurrent duplicate imports, verified-sender gate, auto-reply
blocking, tenant and mailbox separation, participant isolation, bad References,
authorization, idempotent outbound replies, restart durability (new service
instance sharing DB), accepted/failed/uncertain transitions, exponential retry,
three-attempt cap, manual reconciliation, dead-worker lease recovery, and
concurrent queue workers.

Recheck the exact branch HEAD GitHub Actions result before calling all gates PASS.

## Known unfinished work (not approved or executed)
- Provider-independent MIME parsing, body/attachment sanitization and real
  sender authentication need a separate, security-reviewed integration.
- Real SMTP/IMAP or Gmail/Graph adapters are neither included nor authorized.
- No DNS/SPF/DKIM/DMARC integration or deliverability checks are present.
- No customer portal or production authenticated public-send endpoint.
- No UI, dashboard, SLA automation, mail status notifications or Hub role changes.
- No production migration, disaster recovery simulation or high-scale resource
  benchmarks for new mail tables.
- No real mail is transmitted or consumed. Test-only fake accepted != delivered.

## Approval and release hold
Do not merge to main, deploy or connect external providers without new,
specific owner authorization. Phase 3 agent UX integration can be designed
and built in isolation only with its own approval.
