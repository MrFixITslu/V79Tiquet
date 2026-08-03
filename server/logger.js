/**
 * server/logger.js — Structured audit and application logger
 *
 * Writes to:
 *   logs/app-YYYY-MM-DD.log   — general application events
 *   logs/audit-YYYY-MM-DD.log — security-sensitive audit trail
 *
 * In development: also prints to stdout with colours.
 * Logs are NEVER written to console in production to avoid leaking to pm2 stdout.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGS_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

const isProduction = process.env.NODE_ENV === 'production';

// ── Helpers ───────────────────────────────────────────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

const appLogPath  = () => path.join(LOGS_DIR, `app-${today()}.log`);
const auditLogPath = () => path.join(LOGS_DIR, `audit-${today()}.log`);

const write = (filePath, entry) => {
    const line = JSON.stringify(entry) + '\n';
    try {
        fs.appendFileSync(filePath, line);
    } catch (e) {
        // Last-resort: don't crash the app if logging fails
        process.stderr.write(`[LOGGER ERROR] ${e.message}\n`);
    }
};

const COLOURS = { error: '\x1b[31m', warn: '\x1b[33m', info: '\x1b[36m', audit: '\x1b[35m', reset: '\x1b[0m' };

const devPrint = (level, msg, meta) => {
    // In production, suppress routine info/warn noise from stdout (that's what
    // the file logs are for) — but errors must ALWAYS be visible in
    // `docker logs`, since that's often the only signal an operator has when
    // something crashes before the log directory is even readable.
    if (isProduction && level !== 'error') return;
    const c = COLOURS[level] || '';
    const r = COLOURS.reset;
    const metaStr = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
    process.stdout.write(`${c}[${level.toUpperCase()}]${r} ${msg}${metaStr}\n`);
};

// ── Public API ────────────────────────────────────────────────────────────────

const log = (level, msg, meta = {}) => {
    // Strip sensitive fields that should never appear in logs
    const safeMeta = { ...meta };
    for (const key of ['password', 'password_hash', 'token', 'twoFactorSecret', 'secret']) {
        if (safeMeta[key]) safeMeta[key] = '[REDACTED]';
    }

    const entry = {
        ts: new Date().toISOString(),
        level,
        msg,
        ...safeMeta,
    };

    write(appLogPath(), entry);
    devPrint(level, msg, safeMeta);
};

/**
 * audit() writes to the separate audit log AND the app log.
 * Use for all security-sensitive events:
 *   - Login success / failure
 *   - 2FA events
 *   - Account suspension / unsuspension
 *   - Super admin login / actions
 *   - Plan changes
 *   - File access denied
 */
const audit = (event, meta = {}) => {
    const safeMeta = { ...meta };
    for (const key of ['password', 'password_hash', 'token', 'twoFactorSecret', 'secret']) {
        if (safeMeta[key]) safeMeta[key] = '[REDACTED]';
    }

    const entry = {
        ts: new Date().toISOString(),
        level: 'audit',
        event,
        ...safeMeta,
    };

    write(auditLogPath(), entry);
    write(appLogPath(), entry);
    devPrint('audit', event, safeMeta);
};

/**
 * Purge logs older than `days` days. Call once at startup.
 */
const rotateLogs = (days = 30) => {
    try {
        const cutoff = Date.now() - days * 86_400_000;
        for (const file of fs.readdirSync(LOGS_DIR)) {
            const fp = path.join(LOGS_DIR, file);
            if (fs.statSync(fp).mtimeMs < cutoff) {
                fs.unlinkSync(fp);
                log('info', `Rotated old log: ${file}`);
            }
        }
    } catch(e) {
        process.stderr.write(`[LOG ROTATE ERROR] ${e.message}\n`);
    }
};

export const logger = { log, audit, rotateLogs, info: (m, meta) => log('info', m, meta), warn: (m, meta) => log('warn', m, meta), error: (m, meta) => log('error', m, meta) };
