-- =====================================================================
-- Tiquet PostgreSQL Schema
-- Migration from SQLite to PostgreSQL 16
-- =====================================================================

-- 1. Accounts (Tenants)
CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    status TEXT DEFAULT 'active',
    plan TEXT DEFAULT 'trial',
    suspendedAt TEXT,
    trialEndsAt TEXT,
    stripeCustomerId TEXT
);

-- 2. Users
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL,
    failed_login_attempts INTEGER DEFAULT 0,
    locked_until TEXT,
    password_hash TEXT,
    twoFactorSecret TEXT,
    twoFactorEnabled INTEGER DEFAULT 0,
    oauth_provider TEXT,
    oauth_id TEXT,
    reset_token_hash TEXT,
    reset_token_expires TEXT,
    account_id TEXT DEFAULT 'default_account',
    permissions TEXT,
    must_change_password INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_users_account ON users(account_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users(oauth_provider, oauth_id) WHERE oauth_provider IS NOT NULL;

-- 3. User Permissions
CREATE TABLE IF NOT EXISTS user_permissions (
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT,
    account_id TEXT DEFAULT 'default_account'
);

-- 4. Jobs (Tickets)
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    client TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    dueDate TEXT,
    amount DOUBLE PRECISION,
    priority TEXT NOT NULL,
    invoiceNotes TEXT,
    assignedTo TEXT,
    clientEmail TEXT,
    secureToken TEXT,
    depositPaid INTEGER DEFAULT 0,
    timerStartedAt TEXT,
    stageAssignments TEXT,
    timeLogs TEXT,
    quoteApproved INTEGER DEFAULT 0,
    lineItems TEXT,
    deliverables TEXT,
    ffproSyncStatus TEXT,
    ffproEventId TEXT,
    intakeEventId TEXT,
    account_id TEXT DEFAULT 'default_account'
);
CREATE INDEX IF NOT EXISTS idx_jobs_account ON jobs(account_id);
CREATE INDEX IF NOT EXISTS idx_jobs_ffpro_sync_status ON jobs(ffproSyncStatus) WHERE ffproSyncStatus = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_intake_event ON jobs(intakeEventId) WHERE intakeEventId IS NOT NULL;

-- 5. Job Tags
CREATE TABLE IF NOT EXISTS job_tags (
    job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
    tag TEXT,
    account_id TEXT DEFAULT 'default_account'
);

-- 6. Activity Logs
CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    "user" TEXT NOT NULL,
    account_id TEXT DEFAULT 'default_account'
);

-- 7. Job Messages
CREATE TABLE IF NOT EXISTS job_messages (
    id TEXT PRIMARY KEY,
    job_id TEXT REFERENCES jobs(id) ON DELETE CASCADE,
    sender TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    account_id TEXT DEFAULT 'default_account'
);

-- 8. Employees
CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    salary DOUBLE PRECISION,
    hourlyRate DOUBLE PRECISION,
    hoursWorked DOUBLE PRECISION,
    workerType TEXT NOT NULL,
    paymentMethod TEXT NOT NULL,
    status TEXT NOT NULL,
    isCheckedIn INTEGER DEFAULT 0,
    lastCheckIn TEXT,
    account_id TEXT DEFAULT 'default_account',
    timeCards TEXT
);
CREATE INDEX IF NOT EXISTS idx_employees_account ON employees(account_id);

-- 9. Payroll Records
CREATE TABLE IF NOT EXISTS payroll_records (
    id TEXT PRIMARY KEY,
    employeeId TEXT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    employeeName TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    account_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_payroll_account ON payroll_records(account_id);

-- 10. Files
CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    size BIGINT NOT NULL,
    type TEXT NOT NULL,
    uploadedAt TEXT NOT NULL,
    uploadedBy TEXT NOT NULL,
    jobId TEXT,
    account_id TEXT DEFAULT 'default_account'
);

-- 11. Settings
CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    name TEXT,
    address TEXT,
    email TEXT,
    phone TEXT,
    logoUrl TEXT,
    paymentTerms TEXT,
    currency TEXT,
    taxRate DOUBLE PRECISION,
    website TEXT,
    account_id TEXT DEFAULT 'default_account'
);

-- 12. Clients
CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    notes TEXT,
    createdAt TEXT NOT NULL,
    address TEXT,
    industryId TEXT,
    newsletterOptIn INTEGER DEFAULT 0,
    newsletterOptInToken TEXT,
    newsletterOptedInAt TEXT,
    leadSource TEXT,
    leadStatus TEXT,
    account_id TEXT DEFAULT 'default_account'
);
CREATE INDEX IF NOT EXISTS idx_clients_account ON clients(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_newsletter_token ON clients(newsletterOptInToken) WHERE newsletterOptInToken IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_email_account ON clients(account_id, email);

-- 13. Industries
CREATE TABLE IF NOT EXISTS industries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    account_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_industries_account ON industries(account_id);

-- 14. Email Templates
CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    subject TEXT DEFAULT '',
    body TEXT DEFAULT '',
    htmlbody TEXT,
    updatedAt TEXT NOT NULL,
    account_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_account_type ON email_templates(account_id, type);
ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS htmlbody TEXT;
ALTER TABLE email_templates ALTER COLUMN body DROP NOT NULL;
ALTER TABLE email_templates ALTER COLUMN body SET DEFAULT '';
ALTER TABLE email_templates ALTER COLUMN subject DROP NOT NULL;
ALTER TABLE email_templates ALTER COLUMN subject SET DEFAULT '';

-- 15. Newsletter Sends
CREATE TABLE IF NOT EXISTS newsletter_sends (
    id TEXT PRIMARY KEY,
    industryId TEXT,
    subject TEXT NOT NULL,
    contentSnapshot TEXT NOT NULL,
    recipientCount INTEGER NOT NULL DEFAULT 0,
    sentAt TEXT NOT NULL,
    sentBy TEXT,
    account_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_newsletter_sends_account ON newsletter_sends(account_id);

-- 16. Notifications
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL,
    isRead INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    account_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_account ON notifications(account_id);

-- 17. Subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    stripe_subscription_id TEXT,
    stripe_customer_id TEXT,
    status TEXT NOT NULL DEFAULT 'trialing',
    plan TEXT NOT NULL DEFAULT 'trial',
    current_period_end TEXT,
    canceled_at TEXT,
    createdAt TEXT NOT NULL
);

-- 18. Super Admins
CREATE TABLE IF NOT EXISTS super_admins (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    createdAt TEXT NOT NULL
);


-- 19. V79 Hub cross-product event outbox
CREATE TABLE IF NOT EXISTS platform_event_outbox (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    subject_id TEXT,
    correlation_id TEXT,
    occurred_at TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error TEXT,
    sent_at TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_platform_event_outbox_pending
    ON platform_event_outbox(status, next_attempt_at, created_at);


-- 20. V79 Hub managed identity links
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS hub_organization_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_hub_organization
  ON accounts(hub_organization_id) WHERE hub_organization_id IS NOT NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS hub_user_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_hub_user
  ON users(hub_user_id) WHERE hub_user_id IS NOT NULL;
