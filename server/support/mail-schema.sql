-- Phase 2 synthetic email system. Additive disposable schema; NOT part of runtime migration.
-- No provider credentials or network transports. Mailbox addresses use example.invalid.
CREATE TABLE IF NOT EXISTS support_mailboxes (
 id TEXT NOT NULL,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 address TEXT NOT NULL,
 active BOOLEAN NOT NULL DEFAULT true,
 PRIMARY KEY(account_id,id),
 UNIQUE(account_id,address)
);
CREATE TABLE IF NOT EXISTS support_mail_participants (
 account_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 email TEXT NOT NULL,
 PRIMARY KEY(account_id,ticket_id,email),
 FOREIGN KEY(account_id,ticket_id) REFERENCES support_tickets(account_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS support_mail_references (
 account_id TEXT NOT NULL,
 mailbox_id TEXT NOT NULL,
 rfc_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 PRIMARY KEY(account_id,mailbox_id,rfc_id),
 FOREIGN KEY(account_id,mailbox_id) REFERENCES support_mailboxes(account_id,id),
 FOREIGN KEY(account_id,ticket_id) REFERENCES support_tickets(account_id,id)
);
CREATE INDEX IF NOT EXISTS support_mail_references_ticket_idx
 ON support_mail_references(account_id,ticket_id);
-- Existing Phase 1 messages need a scoped composite key for tenant-safe references.
CREATE UNIQUE INDEX IF NOT EXISTS support_messages_triplet_unique
 ON support_messages(account_id,ticket_id,id);
CREATE TABLE IF NOT EXISTS support_mail_ingest (
 account_id TEXT NOT NULL,
 mailbox_id TEXT NOT NULL,
 provider_uid TEXT NOT NULL,
 rfc_id TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 ticket_id TEXT,
 message_id TEXT,
 received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,mailbox_id,provider_uid),
 UNIQUE(account_id,mailbox_id,rfc_id),
 FOREIGN KEY(account_id,mailbox_id) REFERENCES support_mailboxes(account_id,id),
 FOREIGN KEY(account_id,ticket_id) REFERENCES support_tickets(account_id,id),
 FOREIGN KEY(account_id,ticket_id,message_id) REFERENCES support_messages(account_id,ticket_id,id)
);
CREATE TABLE IF NOT EXISTS support_outbox (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 mailbox_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 message_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 idem_key TEXT NOT NULL,
 payload_hash TEXT NOT NULL,
 recipient TEXT NOT NULL,
 rfc_id TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'queued'
   CHECK(state IN ('queued','sending','accepted','failed','uncertain')),
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
 next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 lease_token TEXT,
 lease_until TIMESTAMPTZ,
 provider_receipt TEXT,
 error_code TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(account_id,actor_id,idem_key),
 UNIQUE(account_id,mailbox_id,rfc_id),
 FOREIGN KEY(account_id,mailbox_id) REFERENCES support_mailboxes(account_id,id),
 FOREIGN KEY(account_id,ticket_id) REFERENCES support_tickets(account_id,id),
 FOREIGN KEY(account_id,ticket_id,message_id) REFERENCES support_messages(account_id,ticket_id,id)
);
CREATE INDEX IF NOT EXISTS support_outbox_due_idx
 ON support_outbox(state,next_attempt_at,id) WHERE state='queued';
CREATE INDEX IF NOT EXISTS support_outbox_lease_idx
 ON support_outbox(state,lease_until) WHERE state='sending';
