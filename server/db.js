/**
 * server/db.js — PostgreSQL Database Layer for V79Tiquet
 *
 * Fully replaces SQLite (better-sqlite3) with PostgreSQL 16 (pg).
 * Features:
 * - Connection pooling via pg.Pool
 * - Environment configuration (DATABASE_URL or discrete credentials)
 * - Safe parameterised queries ($1, $2, ...)
 * - Automatic schema migration and verification
 * - Seamless camelCase mapping for existing data models
 * - Clean async API: db.prepare(sql).get/all/run, db.query, db.exec, db.transaction
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { runMigration } from '../scripts/migrate-sqlite-to-pg.js';

const { Pool } = pg;

// Parse PostgreSQL BIGINT (type 20) as JavaScript numbers
pg.types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));

export const dbDir = path.resolve('data');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

// Mapping of PostgreSQL lowercase column names back to original camelCase model names
const CAMEL_MAP = {
  createdat: 'createdAt',
  duedate: 'dueDate',
  clientemail: 'clientEmail',
  securetoken: 'secureToken',
  depositpaid: 'depositPaid',
  timerstartedat: 'timerStartedAt',
  stageassignments: 'stageAssignments',
  timelogs: 'timeLogs',
  quoteapproved: 'quoteApproved',
  lineitems: 'lineItems',
  ffprosyncstatus: 'ffproSyncStatus',
  ffproeventid: 'ffproEventId',
  intakeeventid: 'intakeEventId',
  isread: 'isRead',
  uploadedat: 'uploadedAt',
  uploadedby: 'uploadedBy',
  jobid: 'jobId',
  logourl: 'logoUrl',
  paymentterms: 'paymentTerms',
  taxrate: 'taxRate',
  twofactorsecret: 'twoFactorSecret',
  twofactorenabled: 'twoFactorEnabled',
  hourlyrate: 'hourlyRate',
  hoursworked: 'hoursWorked',
  workertype: 'workerType',
  paymentmethod: 'paymentMethod',
  ischeckedin: 'isCheckedIn',
  lastcheckin: 'lastCheckIn',
  timecards: 'timeCards',
  industryid: 'industryId',
  newsletteroptin: 'newsletterOptIn',
  newsletteroptintoken: 'newsletterOptInToken',
  newsletteroptedinat: 'newsletterOptedInAt',
  leadsource: 'leadSource',
  leadstatus: 'leadStatus',
  updatedat: 'updatedAt',
  contentsnapshot: 'contentSnapshot',
  recipientcount: 'recipientCount',
  sentat: 'sentAt',
  sentby: 'sentBy',
  employeeid: 'employeeId',
  employeename: 'employeeName',
  suspendedat: 'suspendedAt',
  trialendsat: 'trialEndsAt',
  stripecustomerid: 'stripeCustomerId'
};

function normalizeRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = v;
    const camel = CAMEL_MAP[k.toLowerCase()];
    if (camel && camel !== k) {
      out[camel] = v;
    }
  }
  return out;
}

function getPgConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    };
  }
  return {
    host: process.env.DB_HOST || 'tiquet-postgres',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'tiquet',
    user: process.env.DB_USER || 'tiquet_app',
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  };
}

let poolInstance = null;
let isReadyPromise = null;

async function createPool() {
  const config = getPgConfig();
  const pool = new Pool(config);

  try {
    const client = await pool.connect();
    client.release();
    console.log(`[DB] Connected to PostgreSQL at ${config.host || 'connection string'}`);
    return pool;
  } catch (err) {
    if (process.env.NODE_ENV === 'production') {
      console.error('[DB] FATAL: Could not connect to PostgreSQL server in production:', err.message);
      throw err;
    }

    console.warn(`[DB] PostgreSQL not reachable at ${config.host || 'DATABASE_URL'} (${err.message}).`);
    console.warn('[DB] Initialising in-memory PostgreSQL 16 instance for development/test environment...');
    const { newDb } = await import('pg-mem');
    const memDb = newDb();
    const memPg = memDb.adapters.createPg();
    return new memPg.Pool();
  }
}

export function convertSql(sql, params) {
  let paramIndex = 1;
  let converted = sql.replace(/\?/g, () => `$${paramIndex++}`);

  // Transform SQLite datetime('now', ...) to PostgreSQL INTERVAL
  converted = converted.replace(/datetime\('now',\s*'(-?\d+)\s*(days?|hours?|minutes?|seconds?)'\)/gi, (_, num, unit) => {
    const abs = Math.abs(parseInt(num, 10));
    const sign = parseInt(num, 10) < 0 ? '-' : '+';
    return `(NOW() ${sign} INTERVAL '${abs} ${unit}')`;
  });
  converted = converted.replace(/datetime\('now'\)/gi, 'NOW()');

  // Transform INSERT OR IGNORE INTO ... to ON CONFLICT DO NOTHING
  if (/INSERT\s+OR\s+IGNORE\s+INTO/i.test(converted)) {
    converted = converted.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');
    if (!/ON\s+CONFLICT/i.test(converted)) {
      converted += ' ON CONFLICT DO NOTHING';
    }
  }

  // Transform INSERT OR REPLACE INTO settings ...
  if (/INSERT\s+OR\s+REPLACE\s+INTO\s+settings/i.test(converted)) {
    converted = converted.replace(/INSERT\s+OR\s+REPLACE\s+INTO\s+settings/i, 'INSERT INTO settings');
    if (!/ON\s+CONFLICT/i.test(converted)) {
      converted += ` ON CONFLICT (id) DO UPDATE SET 
        name = EXCLUDED.name, 
        address = EXCLUDED.address, 
        email = EXCLUDED.email, 
        phone = EXCLUDED.phone, 
        logoUrl = EXCLUDED.logoUrl, 
        paymentTerms = EXCLUDED.paymentTerms, 
        currency = EXCLUDED.currency, 
        taxRate = EXCLUDED.taxRate, 
        website = EXCLUDED.website`;
    }
  }

  // Support @named parameters
  if (params.length === 1 && params[0] !== null && typeof params[0] === 'object' && !Array.isArray(params[0])) {
    const obj = params[0];
    const actualParams = [];
    converted = converted.replace(/@([a-zA-Z0-9_]+)/g, (_, varName) => {
      actualParams.push(obj[varName] !== undefined ? obj[varName] : null);
      return `$${actualParams.length}`;
    });
    return { sql: converted, params: actualParams };
  }

  return { sql: converted, params };
}

export async function initDb() {
  if (!poolInstance) {
    poolInstance = await createPool();
  }

  // 1. Run schema DDL
  const schemaPath = path.resolve('server/schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await poolInstance.query(schemaSql);
  }

  // 2. Ensure default account exists
  await poolInstance.query(
    'INSERT INTO accounts (id, name, createdAt) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
    ['default_account', 'Default Account', new Date().toISOString()]
  );

  // 3. Check if SQLite data needs to be migrated
  let sqliteCandidate = process.env.DATABASE_PATH
    || (fs.existsSync(path.resolve('data/data.db')) ? path.resolve('data/data.db') : path.resolve('data.db'));

  if (!fs.existsSync(sqliteCandidate) && fs.existsSync(`${sqliteCandidate}.migrated`)) {
    sqliteCandidate = `${sqliteCandidate}.migrated`;
  }

  if (sqliteCandidate && fs.existsSync(sqliteCandidate)) {
    const jobsCountRes = await poolInstance.query('SELECT count(*) as c FROM jobs');
    const jobsCount = parseInt(jobsCountRes.rows[0].c, 10);
    if (jobsCount === 0) {
      console.log(`[DB] Found SQLite database at ${sqliteCandidate} and empty PostgreSQL jobs table. Initiating migration...`);
      try {
        await runMigration({ pool: poolInstance, sqlitePath: sqliteCandidate, archiveSqlite: false });
        console.log('[DB] Migration completed successfully.');
      } catch (migErr) {
        console.error('[DB] Migration error:', migErr.message);
      }
    }
  }

  // 4. Seed super admin from environment if configured
  const saEmail = process.env.SUPER_ADMIN_EMAIL;
  const saPassword = process.env.SUPER_ADMIN_PASSWORD;
  if (saEmail && saPassword) {
    try {
      const saRes = await poolInstance.query('SELECT id FROM super_admins WHERE email = $1', [saEmail]);
      if (saRes.rows.length === 0) {
        const saHash = bcrypt.hashSync(saPassword, 12);
        await poolInstance.query(
          'INSERT INTO super_admins (id, email, password_hash, createdAt) VALUES ($1, $2, $3, $4)',
          [uuidv4(), saEmail, saHash, new Date().toISOString()]
        );
        console.log(`[DB] Super admin seeded: ${saEmail}`);
      }
    } catch (e) {
      console.error('[DB] Super admin seed error:', e.message);
    }
  }

  // 5. Seed default email templates
  try {
    const accs = await poolInstance.query('SELECT id FROM accounts');
    for (const acc of accs.rows) {
      await seedDefaultTemplatesForAccount(acc.id);
    }
  } catch (e) {
    console.error('[DB] Template seed error:', e.message);
  }

  return poolInstance;
}

export function ensureDbReady() {
  if (!isReadyPromise) {
    isReadyPromise = initDb();
  }
  return isReadyPromise;
}

// Immediately initiate DB ready promise
ensureDbReady().catch(err => console.error('[DB] initDb failure:', err));

const DEFAULT_WELCOME_SUBJECT = 'Welcome to {{company_name}}!';
const DEFAULT_WELCOME_BODY = `Welcome, {{client_name}}!

Thank you for choosing {{company_name}}. We're glad to have you with us.

Learn more about us at {{site_url}}.`;

export async function seedDefaultTemplatesForAccount(accountId, existingPool = null) {
  try {
    const pool = existingPool || poolInstance || await ensureDbReady();
    const hasWelcome = await pool.query(
      "SELECT id FROM email_templates WHERE account_id = $1 AND type = 'welcome'",
      [accountId]
    );
    if (hasWelcome.rows.length === 0) {
      await pool.query(
        `INSERT INTO email_templates (id, type, subject, body, updatedAt, account_id)
         VALUES ($1, 'welcome', $2, $3, $4, $5)`,
        [uuidv4(), DEFAULT_WELCOME_SUBJECT, DEFAULT_WELCOME_BODY, new Date().toISOString(), accountId]
      );
    }

    const hasNewsletter = await pool.query(
      "SELECT id FROM email_templates WHERE account_id = $1 AND type = 'newsletter'",
      [accountId]
    );
    if (hasNewsletter.rows.length === 0) {
      await pool.query(
        `INSERT INTO email_templates (id, type, subject, body, updatedAt, account_id)
         VALUES ($1, 'newsletter', '', '', $2, $3)`,
        [uuidv4(), new Date().toISOString(), accountId]
      );
    }
  } catch (e) {
    console.error('[DB] Email template seed error:', e.message);
  }
}

// Database wrapper interface compatible with both prepared statements and async execution
const db = {
  prepare(sql) {
    return {
      async get(...params) {
        const pool = await ensureDbReady();
        const converted = convertSql(sql, params);
        const res = await pool.query(converted.sql, converted.params);
        return res.rows.length > 0 ? normalizeRow(res.rows[0]) : undefined;
      },
      async all(...params) {
        const pool = await ensureDbReady();
        const converted = convertSql(sql, params);
        const res = await pool.query(converted.sql, converted.params);
        return res.rows.map(normalizeRow);
      },
      async run(...params) {
        const pool = await ensureDbReady();
        const converted = convertSql(sql, params);
        const res = await pool.query(converted.sql, converted.params);
        return {
          changes: res.rowCount || 0,
          lastInsertRowid: null
        };
      }
    };
  },

  async query(sql, params = []) {
    const pool = await ensureDbReady();
    const converted = convertSql(sql, params);
    const res = await pool.query(converted.sql, converted.params);
    return {
      ...res,
      rows: res.rows.map(normalizeRow)
    };
  },

  async exec(sql) {
    const pool = await ensureDbReady();
    return await pool.query(sql);
  },

  async transaction(fn) {
    return async (...args) => {
      const pool = await ensureDbReady();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(...args);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    };
  },

  get pool() {
    return poolInstance;
  }
};

export default db;
