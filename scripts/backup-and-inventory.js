/**
 * scripts/backup-and-inventory.js
 *
 * Phase 1, items 6–9 of the production stabilization plan:
 *   - Full, verified backup of the SQLite DB (WAL-safe, not a raw file copy)
 *   - Full backup of the uploads directory
 *   - A record-count inventory across every table (for later migration
 *     validation — this is the "before" side of the before/after comparison)
 *   - Basic data-quality checks (orphaned rows) — reported only, nothing
 *     is deleted automatically
 *
 * Usage (from inside the running container, or locally with the same env):
 *   node scripts/backup-and-inventory.js
 *
 * Or one-shot against the live container without shelling in:
 *   docker exec v79-tiquet-manager node scripts/backup-and-inventory.js
 *
 * Output:
 *   data/backups/tiquet-db-backup-<timestamp>.db   (verified SQLite snapshot)
 *   data/backups/uploads-backup-<timestamp>.tar.gz (uploads snapshot)
 *   data/backups/inventory-<timestamp>.json        (counts + data-quality report)
 *
 * Keeps the last 10 of each. Safe to run against a live, in-use database —
 * does not lock out the running application.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const DB_PATH = process.env.DATABASE_PATH
  || (fs.existsSync(path.resolve('data/data.db')) ? path.resolve('data/data.db') : path.resolve('data.db'));
const UPLOADS_DIR = process.env.UPLOADS_PATH || path.resolve('uploads');
const BACKUP_DIR = path.resolve('data/backups');
const KEEP = 10;

if (!fs.existsSync(DB_PATH)) {
  console.error(`[Backup] FATAL: database not found at ${DB_PATH}. Aborting — refusing to create a fake backup.`);
  process.exit(1);
}

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const dbBackupPath = path.join(BACKUP_DIR, `tiquet-db-backup-${timestamp}.db`);
const uploadsBackupPath = path.join(BACKUP_DIR, `uploads-backup-${timestamp}.tar.gz`);
const inventoryPath = path.join(BACKUP_DIR, `inventory-${timestamp}.json`);

console.log(`[Backup] Source DB: ${DB_PATH}`);
console.log(`[Backup] Uploads dir: ${UPLOADS_DIR}`);

// ── 1. Open the LIVE database read-only. We never touch the live file. ─────
const liveDb = new Database(DB_PATH, { readonly: true, fileMustExist: true });

// ── 2. Safe, online snapshot via better-sqlite3's native backup API. ───────
// This is WAL-aware and consistent even while the app keeps writing — unlike
// a raw fs.copyFileSync(), which can copy a torn/incomplete state if data is
// still sitting in the -wal file and hasn't been checkpointed yet.
console.log('[Backup] Taking WAL-safe snapshot...');
await liveDb.backup(dbBackupPath);
console.log(`[Backup] Snapshot written: ${dbBackupPath}`);

// ── 3. Verify the backup by opening it fresh and running an integrity check.
const verifyDb = new Database(dbBackupPath, { readonly: true, fileMustExist: true });
const integrity = verifyDb.pragma('integrity_check');
const integrityOk = integrity.length === 1 && integrity[0].integrity_check === 'ok';
if (!integrityOk) {
  console.error('[Backup] FATAL: backup failed integrity_check:', integrity);
  process.exit(1);
}
console.log('[Backup] Backup integrity_check: ok');

// ── 4. Uploads archive. ─────────────────────────────────────────────────────
let uploadsFileCount = 0;
let uploadsBytes = 0;
if (fs.existsSync(UPLOADS_DIR)) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else { uploadsFileCount++; uploadsBytes += fs.statSync(full).size; }
    }
  };
  walk(UPLOADS_DIR);
  execSync(`tar -czf "${uploadsBackupPath}" -C "${path.dirname(UPLOADS_DIR)}" "${path.basename(UPLOADS_DIR)}"`);
  console.log(`[Backup] Uploads archived: ${uploadsBackupPath} (${uploadsFileCount} files, ${uploadsBytes} bytes)`);
} else {
  console.log('[Backup] No uploads directory found — skipping uploads archive.');
}

// ── 5. Data inventory: row counts per table (the "before" snapshot for the
// eventual SQLite-vs-PostgreSQL validation step). ──────────────────────────
const tables = verifyDb.prepare(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
).all().map(r => r.name);

const counts = {};
for (const t of tables) {
  try {
    counts[t] = verifyDb.prepare(`SELECT COUNT(*) as c FROM "${t}"`).get().c;
  } catch (e) {
    counts[t] = `ERROR: ${e.message}`;
  }
}

// ── 6. Data-quality checks — report only, never auto-delete. ───────────────
const issues = {};

function safeQuery(label, sql) {
  try {
    const rows = verifyDb.prepare(sql).all();
    if (rows.length > 0) issues[label] = rows;
  } catch (e) {
    issues[label] = `check skipped (${e.message})`;
  }
}

// Orphaned foreign-key style references (tables use TEXT ids, not real FKs
// for account_id, so these must be checked manually rather than relying on
// PRAGMA foreign_key_check, which only covers declared FK columns).
safeQuery('jobs_with_missing_account', `
  SELECT id, title, account_id FROM jobs
  WHERE account_id IS NOT NULL AND account_id NOT IN (SELECT id FROM accounts)`);
safeQuery('users_with_missing_account', `
  SELECT id, email, account_id FROM users
  WHERE account_id IS NOT NULL AND account_id NOT IN (SELECT id FROM accounts)`);
safeQuery('clients_with_missing_account', `
  SELECT id, name, account_id FROM clients
  WHERE account_id IS NOT NULL AND account_id NOT IN (SELECT id FROM accounts)`);
safeQuery('files_with_missing_job', `
  SELECT id, name, jobId FROM files
  WHERE jobId IS NOT NULL AND jobId NOT IN (SELECT id FROM jobs)`);
safeQuery('activity_logs_orphaned', `
  SELECT id, job_id FROM activity_logs
  WHERE job_id IS NOT NULL AND job_id NOT IN (SELECT id FROM jobs)`);
safeQuery('notifications_orphaned_user', `
  SELECT id, user_id FROM notifications
  WHERE user_id IS NOT NULL AND user_id NOT IN (SELECT id FROM users)`);
safeQuery('duplicate_user_emails', `
  SELECT email, COUNT(*) as c FROM users GROUP BY email HAVING c > 1`);
safeQuery('jobs_invalid_timestamps', `
  SELECT id, createdAt FROM jobs WHERE createdAt IS NULL OR createdAt = ''`);

// Declared foreign keys (job_tags, payroll_records, user_permissions, etc.)
const fkViolations = verifyDb.pragma('foreign_key_check');
if (fkViolations.length > 0) issues['declared_foreign_key_violations'] = fkViolations;

const report = {
  timestamp,
  source_db_path: DB_PATH,
  db_backup_path: dbBackupPath,
  db_backup_integrity: integrityOk ? 'ok' : 'FAILED',
  uploads_backup_path: fs.existsSync(uploadsBackupPath) ? uploadsBackupPath : null,
  uploads_file_count: uploadsFileCount,
  uploads_bytes: uploadsBytes,
  row_counts: counts,
  data_quality_issues: issues,
  issue_count: Object.keys(issues).length
};

fs.writeFileSync(inventoryPath, JSON.stringify(report, null, 2));
console.log(`[Backup] Inventory report written: ${inventoryPath}`);
console.log('[Backup] Row counts:', JSON.stringify(counts, null, 2));
if (Object.keys(issues).length > 0) {
  console.warn(`[Backup] WARNING: ${Object.keys(issues).length} data-quality issue categories found — see report. Nothing was deleted.`);
} else {
  console.log('[Backup] No data-quality issues detected.');
}

verifyDb.close();
liveDb.close();

// ── 7. Rotate old backups/reports, keep last 10 of each. ───────────────────
function rotate(prefix) {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith(prefix))
    .map(f => path.join(BACKUP_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  for (const f of files.slice(KEEP)) {
    fs.unlinkSync(f);
    console.log(`[Backup] Pruned old file: ${path.basename(f)}`);
  }
}
rotate('tiquet-db-backup-');
rotate('uploads-backup-');
rotate('inventory-');

console.log('[Backup] Done.');
