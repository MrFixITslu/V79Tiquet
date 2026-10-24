-- Isolated Phase 6 synthetic Hub context. No existing tables modified.
-- Never included in production startup migrations. No real identities or secrets.
CREATE TABLE IF NOT EXISTS support_hub_context(
 account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
 hub_organization_id TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL CHECK(status IN ('active','suspended','pending','cancelled'))
);
CREATE TABLE IF NOT EXISTS support_hub_memberships(
 account_id TEXT NOT NULL,
 user_id TEXT NOT NULL,
 hub_organization_id TEXT NOT NULL,
 hub_user_id TEXT NOT NULL,
 hub_role TEXT NOT NULL CHECK(hub_role IN ('owner','manager','staff','viewer')),
 PRIMARY KEY(account_id,user_id),
 UNIQUE(account_id,hub_user_id),
 FOREIGN KEY(account_id) REFERENCES support_hub_context(account_id) ON DELETE CASCADE,
 FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS support_hub_membership_org_idx
 ON support_hub_memberships(account_id,hub_organization_id,hub_user_id);
CREATE TABLE IF NOT EXISTS support_hub_revoked_sessions(
 token_hash TEXT PRIMARY KEY CHECK(length(token_hash)=64),
 account_id TEXT NOT NULL REFERENCES support_hub_context(account_id) ON DELETE CASCADE,
 expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS support_hub_revoked_expiry_idx ON support_hub_revoked_sessions(expires_at);
