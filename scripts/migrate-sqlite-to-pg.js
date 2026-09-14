/**
 * scripts/migrate-sqlite-to-pg.js
 *
 * Safe, transactional migration from SQLite to PostgreSQL 16 for V79Tiquet.
 *
 * Steps:
 * 1. Safe backup of SQLite database (WAL-aware)
 * 2. Connect to PostgreSQL (DATABASE_URL or discrete credentials)
 * 3. Apply schema migrations idempotently (server/schema.sql)
 * 4. Migrate existing data in dependency order inside a single transaction
 * 5. Validate row counts before and after migration
 * 6. Roll back immediately if validation fails
 * 7. Produce a detailed migration report
 * 8. Archive the original SQLite database as a backup
 */

import fs from 'fs';
import path from 'path';
import pg from 'pg';
const { Pool } = pg;

const DB_PATH = process.env.DATABASE_PATH
  || (fs.existsSync(path.resolve('data/data.db')) ? path.resolve('data/data.db') : path.resolve('data.db'));

const BACKUP_DIR = path.resolve('data/backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

function getPgConfig() {
  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL };
  }
  return {
    host: process.env.DB_HOST || 'tiquet-postgres',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'tiquet',
    user: process.env.DB_USER || 'tiquet_app',
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  };
}

export async function runMigration(options = {}) {
  const pool = options.pool || new Pool(getPgConfig());
  const sqlitePath = options.sqlitePath || DB_PATH;
  const shouldArchiveSqlite = options.archiveSqlite !== false;

  console.log('=== Starting SQLite to PostgreSQL Migration ===');
  console.log(`[Migration] Source SQLite database: ${sqlitePath}`);

  if (!fs.existsSync(sqlitePath)) {
    console.log(`[Migration] No SQLite database found at ${sqlitePath}. Nothing to migrate.`);
    return { success: true, migrated: false, reason: 'Source database does not exist' };
  }

  // 1. Open SQLite database
  const { default: Database } = await import('better-sqlite3');
  const sqlite = new Database(sqlitePath, { readonly: true });

  // Verify SQLite integrity
  const integrity = sqlite.pragma('integrity_check');
  if (!integrity || integrity[0]?.integrity_check !== 'ok') {
    throw new Error(`[Migration] FATAL: Source SQLite database failed integrity check: ${JSON.stringify(integrity)}`);
  }
  console.log('[Migration] Source SQLite database integrity: OK');

  // 2. Safe WAL snapshot before touching anything
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const preBackupPath = path.join(BACKUP_DIR, `tiquet-db-backup-pre-migration-${timestamp}.db`);
  console.log(`[Migration] Backing up SQLite to ${preBackupPath}...`);
  await sqlite.backup(preBackupPath);
  console.log('[Migration] Backup complete.');

  // 3. Connect to PostgreSQL
  const client = await pool.connect();
  console.log('[Migration] Connected to PostgreSQL.');

  try {
    // 4. Apply schema DDL if not already applied
    const tblCheck = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    if (tblCheck.rows.length === 0) {
      console.log('[Migration] Initialising PostgreSQL schema from server/schema.sql...');
      const schemaSql = fs.readFileSync(path.resolve('server/schema.sql'), 'utf8');
      await client.query(schemaSql);
      console.log('[Migration] Schema initialisation complete.');
    } else {
      console.log('[Migration] PostgreSQL schema already present, running column integrity checks...');
    }

    try {
      await client.query('ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS htmlbody TEXT;');
      await client.query('ALTER TABLE email_templates ALTER COLUMN body DROP NOT NULL;');
      await client.query('ALTER TABLE email_templates ALTER COLUMN body SET DEFAULT \'\';');
      await client.query('ALTER TABLE email_templates ALTER COLUMN subject DROP NOT NULL;');
      await client.query('ALTER TABLE email_templates ALTER COLUMN subject SET DEFAULT \'\';');
    } catch (e) {
      // Ignored if pg-mem or already applied
    }
    console.log('[Migration] Schema verification complete.');

    // 5. Read all table row counts from SQLite
    const tableOrder = [
      'accounts',
      'users',
      'user_permissions',
      'jobs',
      'job_tags',
      'activity_logs',
      'job_messages',
      'employees',
      'payroll_records',
      'files',
      'settings',
      'clients',
      'industries',
      'email_templates',
      'newsletter_sends',
      'notifications',
      'subscriptions',
      'super_admins'
    ];

    const sourceCounts = {};
    for (const table of tableOrder) {
      try {
        const count = sqlite.prepare(`SELECT COUNT(*) as c FROM "${table}"`).get().c;
        sourceCounts[table] = count;
      } catch (err) {
        sourceCounts[table] = 0;
      }
    }

    console.log('[Migration] Source SQLite row counts:');
    for (const [table, count] of Object.entries(sourceCounts)) {
      console.log(`  - ${table.padEnd(20)}: ${count} rows`);
    }

    // 6. Begin transaction for data migration
    console.log('[Migration] Beginning PostgreSQL migration transaction...');
    await client.query('BEGIN');

    const migratedCounts = {};

    for (const table of tableOrder) {
      let rows = [];
      try {
        rows = sqlite.prepare(`SELECT * FROM "${table}"`).all();
      } catch (e) {
        console.log(`[Migration] Table "${table}" not found in SQLite, skipping.`);
        migratedCounts[table] = 0;
        continue;
      }

      if (rows.length === 0) {
        migratedCounts[table] = 0;
        continue;
      }

      console.log(`[Migration] Migrating ${rows.length} rows for table "${table}"...`);

      // 1. Inspect PostgreSQL columns for this table
      const pgColsRes = await client.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1
      `, [table]);
      const existingPgCols = new Set(pgColsRes.rows.map(r => r.column_name.toLowerCase()));

      // 2. Ensure all SQLite columns exist in PostgreSQL
      if (rows.length > 0) {
        const sampleKeys = Object.keys(rows[0]);
        for (const col of sampleKeys) {
          const lower = col.toLowerCase();
          if (!existingPgCols.has(lower)) {
            console.log(`[Migration] Adding missing column "${lower}" to PostgreSQL table "${table}"...`);
            await client.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${lower}" TEXT`);
            existingPgCols.add(lower);
          }
        }
      }

      // 3. Migrate each row safely
      for (const row of rows) {
        // Special case for email_templates: synchronize body and htmlbody/htmlBody, guarantee non-null
        if (table === 'email_templates') {
          const bodyVal = row.body ?? row.htmlbody ?? row.htmlBody ?? '';
          const htmlVal = row.htmlbody ?? row.htmlBody ?? row.body ?? '';
          row.body = bodyVal;
          row.htmlbody = htmlVal;
          if (row.htmlBody !== undefined) row.htmlBody = htmlVal;
          if (row.subject === undefined || row.subject === null) row.subject = '';
        }

        const rawKeys = Object.keys(row);
        if (rawKeys.length === 0) continue;

        // Map column names to lowercase and escape reserved keyword "user"
        const cols = [];
        const values = [];
        const seenCols = new Set();

        for (const k of rawKeys) {
          const lower = k.toLowerCase();
          if (seenCols.has(lower)) continue; // Avoid duplicate columns if SQLite had both htmlBody and htmlbody
          seenCols.add(lower);

          cols.push(lower === 'user' ? '"user"' : lower);
          let val = row[k];
          if (table === 'email_templates') {
            if (lower === 'body' && (val === null || val === undefined)) {
              val = row.htmlbody || row.htmlBody || '';
            }
            if (lower === 'htmlbody' && (val === null || val === undefined)) {
              val = row.body || '';
            }
          }
          values.push(val);
        }

        const quotedCols = cols.join(', ');
        const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');

        // Build conflict handling
        let insertSql = `INSERT INTO "${table}" (${quotedCols}) VALUES (${placeholders})`;
        if (row.id !== undefined) {
          insertSql += ` ON CONFLICT (id) DO NOTHING`;
        } else if (table === 'job_tags' || table === 'user_permissions') {
          insertSql += ``;
        }

        await client.query(insertSql, values);
      }

      // Verify row count in PostgreSQL
      const pgCountRes = await client.query(`SELECT COUNT(*) as c FROM "${table}"`);
      const pgCount = parseInt(pgCountRes.rows[0].c, 10);
      migratedCounts[table] = pgCount;

      if (pgCount < sourceCounts[table]) {
        throw new Error(`Validation failed for "${table}": SQLite had ${sourceCounts[table]}, but PostgreSQL has ${pgCount}`);
      }
    }

    // Commit transaction
    await client.query('COMMIT');
    console.log('[Migration] PostgreSQL transaction committed successfully!');

    // 7. Write migration summary
    const summary = {
      timestamp: new Date().toISOString(),
      source_db: sqlitePath,
      backup_file: preBackupPath,
      source_counts: sourceCounts,
      migrated_counts: migratedCounts,
      validation: 'PASSED'
    };

    const summaryPath = path.join(BACKUP_DIR, `migration-summary-${timestamp}.json`);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    console.log(`[Migration] Migration report written to ${summaryPath}`);

    // 8. Safely archive SQLite file so it is not accidentally modified
    sqlite.close();

    if (shouldArchiveSqlite && fs.existsSync(sqlitePath)) {
      const archivePath = `${sqlitePath}.migrated`;
      try {
        fs.renameSync(sqlitePath, archivePath);
        console.log(`[Migration] Renamed source database to ${archivePath} for backward safety.`);
      } catch (err) {
        console.log(`[Migration] Could not rename ${sqlitePath}: ${err.message}. Preserving as is.`);
      }
    }

    return {
      success: true,
      migrated: true,
      summary
    };
  } catch (err) {
    console.error('[Migration] ERROR occurred during migration. Rolling back transaction...', err.message);
    try {
      await client.query('ROLLBACK');
      console.log('[Migration] Rollback complete. No partial data committed to PostgreSQL.');
    } catch (rbErr) {
      console.error('[Migration] Rollback failed:', rbErr.message);
    }
    sqlite.close();
    throw err;
  } finally {
    client.release();
    if (!options.pool) {
      await pool.end();
    }
  }
}

// Allow direct CLI execution
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve('scripts/migrate-sqlite-to-pg.js')) {
  runMigration()
    .then((res) => {
      console.log('Migration finished:', res);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}
