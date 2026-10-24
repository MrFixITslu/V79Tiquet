-- PHASE 1: additive schema, synthetic/disposable PostgreSQL only.
-- Never applied by normal Tiquet startup or to production.
CREATE TABLE IF NOT EXISTS support_tickets (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
 subject TEXT NOT NULL CHECK (char_length(subject) BETWEEN 3 AND 200),
 client_id TEXT,
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','open','waiting_customer','resolved','closed')),
 priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical')),
 assigned_to TEXT,
 created_by TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 1 CHECK(version > 0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(account_id,id)
);
CREATE INDEX IF NOT EXISTS support_tickets_queue_idx ON support_tickets(account_id,status,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS support_tickets_assignee_idx ON support_tickets(account_id,assigned_to,updated_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS support_ticket_requests (
 account_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 idem_key TEXT NOT NULL,
 body_hash TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,actor_id,idem_key),
 FOREIGN KEY(account_id,ticket_id) REFERENCES support_tickets(account_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE IF NOT EXISTS support_messages (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 visibility TEXT NOT NULL CHECK(visibility IN ('internal','public')),
 channel TEXT NOT NULL CHECK(channel IN ('manual','portal','email')),
 direction TEXT NOT NULL CHECK(direction IN ('internal','inbound','outbound')),
 delivery_state TEXT NOT NULL CHECK(delivery_state IN ('not_applicable','queued','sending','accepted','failed','uncertain','cancelled')),
 body TEXT NOT NULL CHECK(char_length(body) BETWEEN 1 AND 10000),
 idem_key TEXT NOT NULL,
 body_hash TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,ticket_id) REFERENCES support_tickets(account_id,id) ON DELETE CASCADE,
 UNIQUE(account_id,ticket_id,actor_id,idem_key)
);
CREATE INDEX IF NOT EXISTS support_messages_page_idx ON support_messages(account_id,ticket_id,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS support_ticket_links (
 account_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 job_id TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,ticket_id,job_id),
 FOREIGN KEY(account_id,ticket_id) REFERENCES support_tickets(account_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS support_events (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 event_type TEXT NOT NULL,
 details JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,ticket_id) REFERENCES support_tickets(account_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS support_events_ticket_idx ON support_events(account_id,ticket_id,created_at DESC);
