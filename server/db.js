import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';

// Resolve DB path - check if data/data.db exists first
const defaultDbPath = fs.existsSync(path.resolve('data/data.db')) ? 'data/data.db' : 'data.db';
const dbPath = process.env.TEST_DB || process.env.DATABASE_PATH || defaultDbPath;

// Ensure parent directory exists
export const dbDir = path.dirname(path.resolve(dbPath));
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

let db;
try {
  db = new Database(dbPath);
} catch (e) {
  // Always print to stderr, even in production — this must never be silent.
  // Common causes: DATABASE_PATH directory not writable by the container's
  // runtime user (e.g. a Docker named volume still owned by root from a
  // previous version of the image), or a missing/misconfigured volume mount.
  console.error(`[FATAL] Could not open database at "${dbPath}": ${e.message}`);
  console.error(`[FATAL] Check that the directory is writable by the container's runtime user (id -u).`);
  process.exit(1);
}

db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 10000');
db.pragma('foreign_keys = ON');
db.pragma('secure_delete = ON');

// Safe column addition helper
function safeAddColumn(table, columnDef) {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (e) {
    // Column already exists or table issue
  }
}

// Initial Core Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    client TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    dueDate TEXT,
    amount REAL,
    priority TEXT NOT NULL,
    invoiceNotes TEXT,
    assignedTo TEXT,
    clientEmail TEXT,
    secureToken TEXT,
    depositPaid INTEGER DEFAULT 0,
    timerStartedAt TEXT,
    stageAssignments TEXT,
    timeLogs TEXT
  );

  CREATE TABLE IF NOT EXISTS job_tags (
    job_id TEXT,
    tag TEXT,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS activity_logs (
    id TEXT PRIMARY KEY,
    job_id TEXT,
    action TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    user TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    role TEXT NOT NULL,
    salary REAL,
    hourlyRate REAL,
    hoursWorked REAL,
    workerType TEXT NOT NULL,
    paymentMethod TEXT NOT NULL,
    status TEXT NOT NULL,
    isCheckedIn INTEGER DEFAULT 0,
    lastCheckIn TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL
  );
  
  CREATE TABLE IF NOT EXISTS user_permissions (
    user_id TEXT,
    permission TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    size INTEGER NOT NULL,
    type TEXT NOT NULL,
    uploadedAt TEXT NOT NULL,
    uploadedBy TEXT NOT NULL,
    jobId TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    name TEXT,
    address TEXT,
    email TEXT,
    phone TEXT,
    logoUrl TEXT,
    paymentTerms TEXT,
    currency TEXT,
    taxRate REAL
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    company TEXT,
    notes TEXT,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS industries (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    account_id TEXT
  );

  CREATE TABLE IF NOT EXISTS email_templates (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    updatedAt TEXT NOT NULL,
    account_id TEXT
  );

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

  CREATE TABLE IF NOT EXISTS payroll_records (
    id TEXT PRIMARY KEY,
    employeeId TEXT NOT NULL,
    employeeName TEXT NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    account_id TEXT,
    FOREIGN KEY(employeeId) REFERENCES employees(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS job_messages (
    id TEXT PRIMARY KEY,
    job_id TEXT,
    sender TEXT NOT NULL,
    content TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT NOT NULL,
    isRead INTEGER DEFAULT 0,
    createdAt TEXT NOT NULL,
    account_id TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    stripe_subscription_id TEXT,
    stripe_customer_id TEXT,
    status TEXT NOT NULL DEFAULT 'trialing',
    plan TEXT NOT NULL DEFAULT 'trial',
    current_period_end TEXT,
    canceled_at TEXT,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS super_admins (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`);

// Insert default account
try {
  db.exec(`INSERT OR IGNORE INTO accounts (id, name, createdAt) VALUES ('default_account', 'Default Account', CURRENT_TIMESTAMP)`);
} catch (e) {}

// Safe Column Migrations
safeAddColumn('jobs', 'depositPaid INTEGER DEFAULT 0');
safeAddColumn('jobs', 'quoteApproved INTEGER DEFAULT 0');
safeAddColumn('jobs', 'lineItems TEXT');
safeAddColumn('jobs', 'deliverables TEXT');
safeAddColumn('jobs', 'timerStartedAt TEXT');
safeAddColumn('jobs', 'stageAssignments TEXT');
safeAddColumn('jobs', 'timeLogs TEXT');

safeAddColumn('users', 'failed_login_attempts INTEGER DEFAULT 0');
safeAddColumn('users', 'locked_until TEXT');
safeAddColumn('users', 'password_hash TEXT');
safeAddColumn('users', 'twoFactorSecret TEXT');
safeAddColumn('users', 'twoFactorEnabled INTEGER DEFAULT 0');
safeAddColumn('users', 'oauth_provider TEXT');
safeAddColumn('users', 'oauth_id TEXT');

safeAddColumn('clients', 'address TEXT');
safeAddColumn('settings', 'address TEXT');
safeAddColumn('settings', 'website TEXT');

safeAddColumn('clients', 'industryId TEXT');
safeAddColumn('clients', 'newsletterOptIn INTEGER DEFAULT 0');
safeAddColumn('clients', 'newsletterOptInToken TEXT');
safeAddColumn('clients', 'newsletterOptedInAt TEXT');

// Upgrade path from an earlier deploy of this feature, which stored the
// template as raw HTML in an `htmlBody` column. Templates are now plain
// text (rendered into HTML at send time — see email.js), stored in `body`.
safeAddColumn('email_templates', 'body TEXT');
try {
    db.exec(`UPDATE email_templates SET body = htmlBody WHERE (body IS NULL OR body = '') AND htmlBody IS NOT NULL AND htmlBody != ''`);
} catch (e) {
    // htmlBody column doesn't exist on a fresh install — nothing to migrate
}

safeAddColumn('accounts', 'status TEXT DEFAULT \'active\'');
safeAddColumn('accounts', 'plan TEXT DEFAULT \'trial\'');
safeAddColumn('accounts', 'suspendedAt TEXT');
safeAddColumn('accounts', 'trialEndsAt TEXT');
safeAddColumn('accounts', 'stripeCustomerId TEXT');

// Add account_id to tables for multi-tenancy
const tenantTables = ['jobs', 'job_tags', 'activity_logs', 'employees', 'users', 'user_permissions', 'files', 'clients', 'job_messages', 'settings', 'payroll_records', 'industries', 'email_templates', 'newsletter_sends'];
for (const table of tenantTables) {
  safeAddColumn(table, "account_id TEXT DEFAULT 'default_account'");
}

safeAddColumn('employees', 'timeCards TEXT');
safeAddColumn('users', 'permissions TEXT');
safeAddColumn('users', 'must_change_password INTEGER DEFAULT 0');

// Production Indexes
try {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_jobs_account ON jobs(account_id);
    CREATE INDEX IF NOT EXISTS idx_users_account ON users(account_id);
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_account ON notifications(account_id);
    CREATE INDEX IF NOT EXISTS idx_clients_account ON clients(account_id);
    CREATE INDEX IF NOT EXISTS idx_employees_account ON employees(account_id);
    CREATE INDEX IF NOT EXISTS idx_payroll_account ON payroll_records(account_id);
    CREATE INDEX IF NOT EXISTS idx_industries_account ON industries(account_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_templates_account_type ON email_templates(account_id, type);
    CREATE INDEX IF NOT EXISTS idx_newsletter_sends_account ON newsletter_sends(account_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_newsletter_token ON clients(newsletterOptInToken) WHERE newsletterOptInToken IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_oauth ON users (oauth_provider, oauth_id) WHERE oauth_provider IS NOT NULL;
  `);
} catch (e) {
  console.warn("Index creation warning:", e.message);
}

// Super Admin Seed from env
const saEmail    = process.env.SUPER_ADMIN_EMAIL;
const saPassword = process.env.SUPER_ADMIN_PASSWORD;

if (saEmail && saPassword) {
  try {
    const existingSA = db.prepare("SELECT id FROM super_admins WHERE email = ?").get(saEmail);
    if (!existingSA) {
      const saHash = bcrypt.hashSync(saPassword, 12);
      db.prepare("INSERT INTO super_admins (id, email, password_hash, createdAt) VALUES (?, ?, ?, ?)")
        .run(uuidv4(), saEmail, saHash, new Date().toISOString());
      console.log(`✅ Super admin seeded: ${saEmail}`);
    }
  } catch (e) {
    console.error("Super admin seed error:", e.message);
  }
}

// Seed trial subscriptions
try {
  const trialDays = parseInt(process.env.TRIAL_DAYS || '14');
  const allAccounts = db.prepare("SELECT id, createdAt FROM accounts").all();
  for (const acc of allAccounts) {
    const hasSub = db.prepare("SELECT id FROM subscriptions WHERE account_id = ?").get(acc.id);
    if (!hasSub) {
      const rawCreated = acc.createdAt ? new Date(acc.createdAt).getTime() : Date.now();
      const validCreated = isNaN(rawCreated) ? Date.now() : rawCreated;
      const trialEnd = new Date(validCreated + trialDays * 24 * 60 * 60 * 1000).toISOString();
      db.prepare("INSERT INTO subscriptions (id, account_id, status, plan, current_period_end, createdAt) VALUES (?, ?, 'trialing', 'trial', ?, ?)")
        .run(uuidv4(), acc.id, trialEnd, new Date().toISOString());
      db.prepare("UPDATE accounts SET plan = 'trial', trialEndsAt = ? WHERE id = ?").run(trialEnd, acc.id);
    }
  }
} catch (e) {
  console.error("Subscription seed error:", e.message);
}

// Seed Demo Data if empty and allowed
try {
  const jobsCount = db.prepare('SELECT count(*) as count FROM jobs').get() || { count: 0 };
  const allowSeed = process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_DATA === 'true';
  if (jobsCount.count === 0 && allowSeed) {
    console.log("Seeding database with initial data...");

    const insertJob = db.prepare(`
      INSERT INTO jobs (id, title, client, description, status, createdAt, dueDate, amount, priority, invoiceNotes, assignedTo, clientEmail, secureToken, depositPaid, account_id)
      VALUES (@id, @title, @client, @description, @status, @createdAt, @dueDate, @amount, @priority, @invoiceNotes, @assignedTo, @clientEmail, @secureToken, @depositPaid, 'default_account')
    `);

    const insertActivityLog = db.prepare(`
      INSERT INTO activity_logs (id, job_id, action, timestamp, user, account_id)
      VALUES (@id, @job_id, @action, @timestamp, @user, 'default_account')
    `);

    const insertTag = db.prepare('INSERT INTO job_tags (job_id, tag, account_id) VALUES (?, ?, \'default_account\')');

    const insertEmployee = db.prepare(`
      INSERT INTO employees (id, name, role, salary, hourlyRate, hoursWorked, workerType, paymentMethod, status, isCheckedIn, lastCheckIn, account_id)
      VALUES (@id, @name, @role, @salary, @hourlyRate, @hoursWorked, @workerType, @paymentMethod, @status, @isCheckedIn, @lastCheckIn, 'default_account')
    `);

    const insertUser = db.prepare('INSERT INTO users (id, name, email, role, password_hash, account_id) VALUES (@id, @name, @email, @role, @password_hash, \'default_account\')');
    const insertPermission = db.prepare('INSERT INTO user_permissions (user_id, permission, account_id) VALUES (?, ?, \'default_account\')');

    const insertFile = db.prepare(`
      INSERT INTO files (id, name, size, type, uploadedAt, uploadedBy, jobId, account_id)
      VALUES (@id, @name, @size, @type, @uploadedAt, @uploadedBy, @jobId, 'default_account')
    `);

    const insertSettings = db.prepare(`
      INSERT OR REPLACE INTO settings (id, name, address, email, phone, logoUrl, paymentTerms, currency, taxRate, account_id)
      VALUES ('1', @name, @address, @email, @phone, @logoUrl, @paymentTerms, @currency, @taxRate, 'default_account')
    `);

    const seedTransaction = db.transaction(() => {
      const job1Id = "1";
      insertJob.run({
        id: job1Id, title: "Website Redesign", client: "Acme Corp", description: "Complete overhaul of the corporate website including new branding and e-commerce integration.", status: "request", createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), dueDate: new Date(Date.now() + 86400000 * 10).toISOString(), amount: 15000, priority: "high", invoiceNotes: null, assignedTo: "Alice Smith", clientEmail: "client@acme.com", secureToken: uuidv4(), depositPaid: 0
      });
      insertTag.run(job1Id, 'design');
      insertTag.run(job1Id, 'web');
      insertActivityLog.run({ id: "l1", job_id: job1Id, action: "Job request created", timestamp: new Date(Date.now() - 86400000 * 2).toISOString(), user: "System" });

      const job2Id = "2";
      insertJob.run({
        id: job2Id, title: "SEO Audit", client: "TechStart Inc", description: "Comprehensive SEO audit and keyword research for Q3 marketing push.", status: "estimation", createdAt: new Date(Date.now() - 86400000 * 5).toISOString(), dueDate: new Date(Date.now() + 86400000 * 3).toISOString(), amount: null, priority: "medium", invoiceNotes: null, assignedTo: "Bob Jones", clientEmail: "tech@techstart.com", secureToken: uuidv4(), depositPaid: 0
      });
      insertTag.run(job2Id, 'marketing');
      insertTag.run(job2Id, 'seo');
      insertActivityLog.run({ id: "l2", job_id: job2Id, action: "Job request created", timestamp: new Date(Date.now() - 86400000 * 5).toISOString(), user: "System" });
      insertActivityLog.run({ id: "l3", job_id: job2Id, action: "Moved from request to estimation", timestamp: new Date(Date.now() - 86400000 * 4).toISOString(), user: "Alice Smith" });

      const job3Id = "3";
      insertJob.run({
        id: job3Id, title: "Mobile App MVP", client: "Fitness Plus", description: "React Native mobile app MVP with user authentication and basic workout tracking.", status: "in-progress", createdAt: new Date(Date.now() - 86400000 * 14).toISOString(), dueDate: new Date(Date.now() + 86400000 * 30).toISOString(), amount: 25000, priority: "high", invoiceNotes: null, assignedTo: "Charlie Brown", clientEmail: "fit@fitnessplus.com", secureToken: uuidv4(), depositPaid: 1
      });
      insertTag.run(job3Id, 'mobile');
      insertTag.run(job3Id, 'app');
      insertActivityLog.run({ id: "l4", job_id: job3Id, action: "Job request created", timestamp: new Date(Date.now() - 86400000 * 14).toISOString(), user: "System" });
      insertActivityLog.run({ id: "l5", job_id: job3Id, action: "Moved from request to in-progress", timestamp: new Date(Date.now() - 86400000 * 12).toISOString(), user: "Bob Jones" });

      const job4Id = "4";
      insertJob.run({
        id: job4Id, title: "Logo Design", client: "Fresh Bakery", description: "New logo design and brand guidelines for local bakery chain.", status: "review", createdAt: new Date(Date.now() - 86400000 * 20).toISOString(), dueDate: new Date(Date.now() - 86400000 * 1).toISOString(), amount: 2500, priority: "low", invoiceNotes: null, assignedTo: "Dana White", clientEmail: "bake@freshbakery.com", secureToken: uuidv4(), depositPaid: 1
      });
      insertTag.run(job4Id, 'branding');
      insertTag.run(job4Id, 'logo');
      insertActivityLog.run({ id: "l6", job_id: job4Id, action: "Job request created", timestamp: new Date(Date.now() - 86400000 * 20).toISOString(), user: "System" });

      const job5Id = "5";
      insertJob.run({
        id: job5Id, title: "Q2 Marketing Campaign", client: "Global Retail", description: "Social media ad creatives and landing page design for Q2 campaign.", status: "invoiced", createdAt: new Date(Date.now() - 86400000 * 45).toISOString(), dueDate: null, amount: 8500, priority: "medium", invoiceNotes: "1. Project Delivery: Q2 Marketing Campaign - $8500", assignedTo: "Alice Smith", clientEmail: "global@retail.com", secureToken: uuidv4(), depositPaid: 1
      });
      insertTag.run(job5Id, 'marketing');
      insertTag.run(job5Id, 'ads');
      insertActivityLog.run({ id: "l7", job_id: job5Id, action: "Job request created", timestamp: new Date(Date.now() - 86400000 * 45).toISOString(), user: "System" });

      insertEmployee.run({ id: "e1", name: "Alice Smith", role: "Senior Designer", salary: 5000, hourlyRate: null, hoursWorked: null, workerType: "salary", paymentMethod: "Bank Transfer", status: "active", isCheckedIn: 0, lastCheckIn: null });
      insertEmployee.run({ id: "e2", name: "Bob Jones", role: "Project Manager", salary: 4500, hourlyRate: null, hoursWorked: null, workerType: "salary", paymentMethod: "Bank Transfer", status: "active", isCheckedIn: 0, lastCheckIn: null });
      insertEmployee.run({ id: "e3", name: "Charlie Brown", role: "Developer", salary: 6000, hourlyRate: null, hoursWorked: null, workerType: "salary", paymentMethod: "PayPal", status: "active", isCheckedIn: 0, lastCheckIn: null });

      insertUser.run({ id: "u1", name: "John Doe", email: "john@example.com", role: "Admin", password_hash: "$2b$10$szwsqdFs7AFwmEPci8Gd4.kgSdRQY6Wu17Yj1QmB9afeuPkqtYlPm" });
      ['dashboard', 'jobs', 'new-request', 'payroll', 'invoices', 'users', 'files'].forEach(p => insertPermission.run("u1", p));

      insertUser.run({ id: "u2", name: "Alice Smith", email: "alice@example.com", role: "Manager", password_hash: null });
      ['dashboard', 'jobs', 'new-request', 'files'].forEach(p => insertPermission.run("u2", p));

      insertFile.run({ id: "f1", name: "Brand_Guidelines_2024.pdf", size: 2500000, type: "application/pdf", uploadedAt: new Date(Date.now() - 86400000 * 3).toISOString(), uploadedBy: "John Doe", jobId: null });
      insertFile.run({ id: "f2", name: "Logo_Assets.zip", size: 15000000, type: "application/zip", uploadedAt: new Date(Date.now() - 86400000 * 5).toISOString(), uploadedBy: "Alice Smith", jobId: null });

      insertSettings.run({ name: "V79 Tiquet Demo Co.", address: "123 Creative Plaza, Design District, NY 10001", email: "billing@example.com", phone: "+1 (555) 000-1234", logoUrl: "https://picsum.photos/200/100?random=1", paymentTerms: "Please make payment within 30 days of receiving this invoice.", currency: "USD", taxRate: 0 });
    });

    seedTransaction();
    console.log("Database seeded successfully.");
  }
} catch (e) {
  console.error("Database seed check error:", e.message);
}

// Seed default email templates (welcome + blank newsletter) per account.
// Plain text — the header, footer, and (for the welcome email) the opt-in
// button are fixed chrome added automatically at send time by
// wrapEmailShell(), not something stored here. See server/email.js.
const DEFAULT_WELCOME_SUBJECT = 'Welcome to {{company_name}}!';
const DEFAULT_WELCOME_BODY = `Welcome, {{client_name}}!

Thank you for choosing {{company_name}}. We're glad to have you with us.

Learn more about us at {{site_url}}.`;

const insertTemplate = db.prepare(`
  INSERT INTO email_templates (id, type, subject, body, updatedAt, account_id)
  VALUES (@id, @type, @subject, @body, @updatedAt, @account_id)
`);

// Exported so account-creation code paths (register, OAuth signup) can seed
// a brand-new account's templates immediately instead of waiting for the
// next server boot's catch-up loop below.
export function seedDefaultTemplatesForAccount(accountId) {
  try {
    const hasWelcome = db.prepare("SELECT id FROM email_templates WHERE account_id = ? AND type = 'welcome'").get(accountId);
    if (!hasWelcome) {
      insertTemplate.run({
        id: uuidv4(), type: 'welcome', subject: DEFAULT_WELCOME_SUBJECT,
        body: DEFAULT_WELCOME_BODY, updatedAt: new Date().toISOString(), account_id: accountId
      });
    }
    const hasNewsletter = db.prepare("SELECT id FROM email_templates WHERE account_id = ? AND type = 'newsletter'").get(accountId);
    if (!hasNewsletter) {
      insertTemplate.run({
        id: uuidv4(), type: 'newsletter', subject: '',
        body: '', updatedAt: new Date().toISOString(), account_id: accountId
      });
    }
  } catch (e) {
    console.error("Email template seed error:", e.message);
  }
}

try {
  const allAccountsForTemplates = db.prepare("SELECT id FROM accounts").all();
  for (const acc of allAccountsForTemplates) {
    seedDefaultTemplatesForAccount(acc.id);
  }
} catch (e) {
  console.error("Email template seed error:", e.message);
}

export default db;
