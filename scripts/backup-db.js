import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DATABASE_PATH || (fs.existsSync(path.resolve('data/data.db')) ? path.resolve('data/data.db') : path.resolve('data.db'));
const BACKUP_DIR = path.resolve('data/backups');

console.log(`[Backup] Checking database at: ${DB_PATH}`);

if (!fs.existsSync(DB_PATH)) {
  console.log(`[Backup] Database file not found at ${DB_PATH}. Creating empty placeholder.`);
  const parent = path.dirname(DB_PATH);
  if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
  fs.writeFileSync(DB_PATH, '');
}

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = path.join(BACKUP_DIR, `tiquet-db-backup-${timestamp}.db`);

fs.copyFileSync(DB_PATH, backupPath);
console.log(`[Backup] Database backed up successfully to: ${backupPath}`);

// Rotate backups, keeping last 10
const backups = fs.readdirSync(BACKUP_DIR)
  .filter(f => f.startsWith('tiquet-db-backup-'))
  .map(f => path.join(BACKUP_DIR, f))
  .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);

if (backups.length > 10) {
  const toDelete = backups.slice(10);
  for (const file of toDelete) {
    fs.unlinkSync(file);
    console.log(`[Backup] Pruned old backup: ${path.basename(file)}`);
  }
}
