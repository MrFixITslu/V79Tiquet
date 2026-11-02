-- P4 isolated candidate; apply only to disposable PostgreSQL test database.
-- Live schema migration is deferred until signed-session Phase 1 and owner release.
CREATE TABLE IF NOT EXISTS customer_portal_identities (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  client_id TEXT REFERENCES clients(id),
  token_hash TEXT,
  token_expires_at TIMESTAMPTZ,
  token_sent_at TIMESTAMPTZ,
  login_token_hash TEXT,
  login_expires_at TIMESTAMPTZ,
  login_sent_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id,email)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tiquet_customer_verify_token
  ON customer_portal_identities(token_hash) WHERE token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tiquet_customer_client_scope
  ON customer_portal_identities(account_id, client_id);
CREATE TABLE IF NOT EXISTS customer_portal_sessions (
  token_hash TEXT PRIMARY KEY,
  identity_id TEXT NOT NULL REFERENCES customer_portal_identities(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tiquet_customer_sessions_expire
  ON customer_portal_sessions(expires_at);
