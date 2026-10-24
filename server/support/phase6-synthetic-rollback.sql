-- DESTRUCTIVE in a DISPOSABLE TEST DATABASE ONLY. NEVER auto-run or deploy.
-- Reverse-order removal of exclusively support_* tables, NO CASCADE.
-- Guarded separately by tests/supportPhase6.migration.mjs and human approval.
DROP TABLE IF EXISTS support_hub_revoked_sessions;
DROP TABLE IF EXISTS support_hub_memberships;
DROP TABLE IF EXISTS support_hub_context;
DROP TABLE IF EXISTS support_agent_presence;
DROP TABLE IF EXISTS support_synthetic_alerts;
DROP TABLE IF EXISTS support_automation_receipts;
DROP TABLE IF EXISTS support_sla_records;
DROP TABLE IF EXISTS support_sla_policies;
DROP TABLE IF EXISTS support_outbox;
DROP TABLE IF EXISTS support_mail_ingest;
DROP TABLE IF EXISTS support_mail_references;
DROP TABLE IF EXISTS support_mail_participants;
DROP TABLE IF EXISTS support_mailboxes;
DROP TABLE IF EXISTS support_events;
DROP TABLE IF EXISTS support_ticket_links;
DROP TABLE IF EXISTS support_messages;
DROP TABLE IF EXISTS support_ticket_requests;
DROP TABLE IF EXISTS support_tickets;
