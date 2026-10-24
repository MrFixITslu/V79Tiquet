-- Phase 4: synthetic-only schema. NEVER added to normal Tiquet migrations.
CREATE TABLE IF NOT EXISTS support_sla_policies(
 account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
 timezone TEXT NOT NULL DEFAULT 'America/St_Lucia',
 start_minute INTEGER NOT NULL DEFAULT 540 CHECK(start_minute BETWEEN 0 AND 1439),
 end_minute INTEGER NOT NULL DEFAULT 1020 CHECK(end_minute BETWEEN 1 AND 1440),
 weekdays JSONB NOT NULL DEFAULT '["Mon","Tue","Wed","Thu","Fri"]',
 holidays JSONB NOT NULL DEFAULT '[]',
 CHECK(end_minute>start_minute)
);
CREATE TABLE IF NOT EXISTS support_sla_records(
 account_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 first_response_due TIMESTAMPTZ NOT NULL,
 resolution_due TIMESTAMPTZ NOT NULL,
 first_response_at TIMESTAMPTZ,
 resolved_at TIMESTAMPTZ,
 paused_at TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,ticket_id),
 FOREIGN KEY(account_id,ticket_id) REFERENCES support_tickets(account_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS support_automation_receipts(
 account_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 rule_id TEXT NOT NULL CHECK(rule_id IN ('critical_unassigned','first_response_breach','resolution_breach')),
 id TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,ticket_id,rule_id),
 UNIQUE(id),
 FOREIGN KEY(account_id,ticket_id) REFERENCES support_tickets(account_id,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS support_synthetic_alerts(
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 rule_id TEXT NOT NULL,
 body TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(account_id,ticket_id) REFERENCES support_tickets(account_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS support_synthetic_alerts_by_ticket
 ON support_synthetic_alerts(account_id,ticket_id,created_at DESC);
CREATE TABLE IF NOT EXISTS support_agent_presence(
 account_id TEXT NOT NULL,
 ticket_id TEXT NOT NULL,
 actor_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('viewing','drafting')),
 ticket_version INTEGER NOT NULL CHECK(ticket_version>0),
 expires_at TIMESTAMPTZ NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 PRIMARY KEY(account_id,ticket_id,actor_id),
 FOREIGN KEY(account_id,ticket_id) REFERENCES support_tickets(account_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS support_agent_presence_expiry ON support_agent_presence(expires_at);
