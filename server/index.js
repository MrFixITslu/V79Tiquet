import 'dotenv/config';
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer } from "ws";
import db, { dbDir, seedDefaultTemplatesForAccount } from "./db.js";
import { sendPortalLink, sendStatusUpdate, sendTemplated, renderEmailFromPlainTemplate } from "./email.js";
import { registerOAuthRoutes } from "./oauth.js";
import { v4 as uuidv4 } from "uuid";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import qrcode from "qrcode";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import compression from "compression";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import multer from "multer";
import { registerStripeRoutes } from "./stripe.js";
import { registerHealthCheck } from "./healthcheck.js";
import { logger } from "./logger.js";
import { 
    sanitizeString, 
    sanitizeObject, 
    isValidEmail, 
    isValidUUID, 
    isNonEmptyString,
    secureFilePath,
    validatePassword,
    badRequest 
} from "./security.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// This app always sits behind a reverse proxy (Nginx Proxy Manager) in
// production. Without this, req.ip resolves to NPM's internal container IP
// for every request — meaning every user shares one rate-limit bucket
// (so one noisy client can lock everyone else out of login) and every
// audit-log entry records the wrong IP. `1` = trust exactly one hop
// (the proxy directly in front of this container), which is correct for
// this topology and avoids the security risk of trusting arbitrary
// client-supplied X-Forwarded-For values.
app.set('trust proxy', 1);
const isProduction = process.env.NODE_ENV === "production";
const PORT = isProduction ? (process.env.PORT || 8080) : 3001;

registerHealthCheck(app);

// JWT secrets: strongly prefer an explicit JWT_SECRET / SUPER_ADMIN_JWT_SECRET
// in the environment (documented in env.example). If one isn't set in
// production, DO NOT crash the process — a crash-looping container is
// unreachable from the reverse proxy and just presents as a permanent 502
// with no useful error visible outside `docker logs`. Instead, generate a
// strong random secret once and persist it next to the database (inside the
// same Docker volume, so it survives restarts/redeploys) so sessions stay
// valid across restarts even if the operator forgot to set one explicitly.
function loadOrCreatePersistedSecret(envValue, filename, label) {
    if (envValue) return envValue;

    const secretPath = path.join(dbDir, filename);
    try {
        if (fs.existsSync(secretPath)) {
            return fs.readFileSync(secretPath, "utf8").trim();
        }
        const generated = crypto.randomBytes(64).toString("hex");
        fs.writeFileSync(secretPath, generated, { mode: 0o600 });
        console.warn(
            `[WARN] ${label} was not set — generated and persisted a random one at ${secretPath}. ` +
            `Set ${label} explicitly in your .env for a fully reproducible deploy (see env.example).`
        );
        return generated;
    } catch (e) {
        // If we can't even persist a generated secret (e.g. read-only volume),
        // that's a real configuration problem worth failing loudly on rather
        // than silently issuing a secret that changes every restart and logs
        // everyone out.
        console.error(`[FATAL] ${label} not set and could not persist a generated one at ${secretPath}: ${e.message}`);
        process.exit(1);
    }
}

const JWT_SECRET = isProduction
    ? loadOrCreatePersistedSecret(process.env.JWT_SECRET, ".jwt_secret", "JWT_SECRET")
    : (process.env.JWT_SECRET || 'dev_jwt_secret_v79_tickit');
const SA_JWT_SECRET = isProduction
    ? loadOrCreatePersistedSecret(process.env.SUPER_ADMIN_JWT_SECRET, ".sa_jwt_secret", "SUPER_ADMIN_JWT_SECRET")
    : (process.env.SUPER_ADMIN_JWT_SECRET || 'dev_sa_jwt_secret_v79_tickit');

// ── Real-time chat: WebSocket job-room registry ───────────────────────────
// Maps jobId -> Set of live ws connections subscribed to that job's chat.
// Populated in the wss "connection" handler set up near the bottom of this
// file (after both http.createServer and WebSocketServer exist), but the
// helpers live here so the REST message routes above can call them.
const jobSubscribers = new Map();

function subscribeToJob(jobId, ws) {
    if (!jobSubscribers.has(jobId)) jobSubscribers.set(jobId, new Set());
    jobSubscribers.get(jobId).add(ws);
}

function unsubscribeFromJob(jobId, ws) {
    const set = jobSubscribers.get(jobId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) jobSubscribers.delete(jobId);
}

function broadcastToJob(jobId, payload) {
    const set = jobSubscribers.get(jobId);
    if (!set || set.size === 0) return;
    const data = JSON.stringify(payload);
    for (const client of set) {
        if (client.readyState === client.OPEN) {
            client.send(data);
        }
    }
}

// ── Security Middleware ───────────────────────────────────────────────────

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            imgSrc: ["'self'", "data:", "https:", "http:"],
            fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            upgradeInsecureRequests: [],
        },
    }
}));

app.use(compression());

// Lockdown CORS to allowlist in production
const allowedOrigins = process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin) || !isProduction) {
            callback(null, true);
        } else {
            logger.warn(`CORS blocked request from origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true
}));

app.use(express.json({ limit: '1mb' }));

// ── Authentication Middleware (declared early — used before rate-limiter setup) ─

const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token == null) return res.status(401).json({ error: "Unauthorized" });

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ error: "Forbidden" });
        req.user = user;
        req.accountId = user.account_id;

        // ─── Suspension Check ─────────────────────────────────────────────
        try {
            const account = db.prepare("SELECT status FROM accounts WHERE id = ?").get(user.account_id);
            if (account && account.status === 'suspended') {
                return res.status(402).json({ error: "ACCOUNT_SUSPENDED", message: "This account has been suspended. Please contact support." });
            }
        } catch (e) {
            // Non-fatal: continue if accounts table check fails
        }

        next();
    });
};

// --- Super Admin Middleware ---
const superAdminMiddleware = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    jwt.verify(token, SA_JWT_SECRET, (err, decoded) => {
        if (err || !decoded.isSuperAdmin) return res.status(403).json({ error: "Forbidden: Super Admin access required" });
        req.superAdmin = decoded;
        next();
    });
};

// --- FILE REPOSITORY SETUP ---
const UPLOADS_ROOT = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOADS_ROOT)) fs.mkdirSync(UPLOADS_ROOT, { recursive: true });

// Business logos are a deliberate, narrow exception to "no unauthenticated
// static file serving": a logo has to render in a plain <img> tag (which
// can't send an Authorization header) and, eventually, in outbound emails —
// both audiences have no JWT at all. Everything else stays behind
// /api/files/:accountId/*. Kept in its own folder, own route, own strict
// filename whitelist so this exception can't be leveraged to reach anything
// else under UPLOADS_ROOT.
const PUBLIC_LOGOS_DIR = path.join(UPLOADS_ROOT, 'public-logos');
if (!fs.existsSync(PUBLIC_LOGOS_DIR)) fs.mkdirSync(PUBLIC_LOGOS_DIR, { recursive: true });

// Serve uploaded files statically ONLY IN DEVELOPMENT
if (!isProduction) {
    app.use('/uploads', express.static(UPLOADS_ROOT));
}

/**
 * SECURE FILE SERVING
 * All file access in production must go through this authenticated route.
 */
app.get('/api/files/:accountId/*', authenticateToken, (req, res) => {
    const { accountId } = req.params;
    const relativePath = req.params[0];

    // Auth parity check: token must match requested account's files
    if (req.accountId !== accountId) {
        logger.audit('file_access_denied', { 
            userId: req.user.id, 
            requestedAccountId: accountId, 
            actualAccountId: req.accountId 
        });
        return res.status(403).json({ error: "Access denied to this account's files" });
    }

    const safePath = secureFilePath(UPLOADS_ROOT, accountId, path.join(accountId, relativePath));
    if (!safePath || !fs.existsSync(safePath)) {
        return res.status(404).json({ error: "File not found" });
    }

    // Security: Only allow safe file types to be served
    const ext = path.extname(safePath).toLowerCase();
    const ALLOWED_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.ppt', '.pptx', '.json', '.txt', '.zip', '.mp4', '.mov'];
    if (!ALLOWED_EXTS.includes(ext)) {
        return res.status(403).json({ error: "File type not permitted" });
    }

    res.sendFile(safePath);
});

/**
 * Sanitize a string for use as a folder or file name component.
 */
const sanitizeForPath = (str) => (str || 'unknown').replace(/[^a-zA-Z0-9_\-. ]/g, '_').trim().slice(0, 60);

/**
 * Get the absolute path to a job's dedicated folder.
 * Pattern: uploads/<AccountId>/<ClientName>/<JobId>/
 */
const getJobFolder = (accountId, clientName, jobId) => {
    return path.join(UPLOADS_ROOT, sanitizeForPath(accountId), sanitizeForPath(clientName), jobId);
};

/**
 * Ensure the job's folder exists. Returns the folder path.
 */
const ensureJobFolder = (accountId, clientName, jobId) => {
    const folder = getJobFolder(accountId, clientName, jobId);
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    return folder;
};

/**
 * Append an entry to the project's audit log (project-log.json inside the job folder).
 */
const appendProjectLog = (accountId, clientName, jobId, entry) => {
    try {
        const folder = ensureJobFolder(accountId, clientName, jobId);
        const logPath = path.join(folder, 'project-log.json');
        let log = [];
        if (fs.existsSync(logPath)) {
            log = JSON.parse(fs.readFileSync(logPath, 'utf8'));
        }
        log.push({ ...entry, timestamp: new Date().toISOString() });
        fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
    } catch(e) {
        console.error('Log write error:', e.message);
    }
};

/**
 * Save/update the quote snapshot JSON inside the job folder.
 */
const saveQuoteSnapshot = (accountId, clientName, jobId, jobData) => {
    try {
        const folder = ensureJobFolder(accountId, clientName, jobId);
        fs.writeFileSync(path.join(folder, 'quote.json'), JSON.stringify(jobData, null, 2));
    } catch(e) {
        console.error('Quote snapshot error:', e.message);
    }
};

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, 
    max: 200, 
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests from this IP, please try again after 15 minutes." }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15, // Stricter for auth
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many login attempts, please try again after 15 minutes." }
});

const uploadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30, // 30 uploads per 15 mins
    standardHeaders: true,
    legacyHeaders: false,
});

app.use("/api/auth", authLimiter);
app.use("/api/", apiLimiter);

// --- AUTHENTICATION ROUTES ---
registerOAuthRoutes(app);  // Google + Apple OAuth

app.post("/api/auth/register", async (req, res) => {
    const { name, email, password, companyName } = sanitizeObject(req.body);
    if (!name || !email || !password || !companyName) {
        return badRequest(res, "All fields are required");
    }

    if (!isValidEmail(email)) return badRequest(res, "Invalid email format");
    
    const pwError = validatePassword(password);
    if (pwError) return badRequest(res, pwError);

    try {
        const existingUser = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
        if (existingUser) return badRequest(res, "Email already exists");

        const accountId = uuidv4();
        const userId = uuidv4();
        const hashedPassword = await bcrypt.hash(password, 12); // Increased rounds for production
        
        const registerTx = db.transaction(() => {
            db.prepare("INSERT INTO accounts (id, name, createdAt) VALUES (?, ?, ?)").run(accountId, companyName, new Date().toISOString());
            db.prepare("INSERT INTO users (id, name, email, role, password_hash, account_id) VALUES (?, ?, ?, ?, ?, ?)").run(userId, name, email, "Admin", hashedPassword, accountId);
            db.prepare("INSERT INTO settings (id, name, email, account_id) VALUES (?, ?, ?, ?)").run(uuidv4(), companyName, email, accountId);
        });
        registerTx();
        seedDefaultTemplatesForAccount(accountId);

        logger.audit('user_registered', { userId, email, accountId });

        const token = jwt.sign({ id: userId, email, account_id: accountId }, JWT_SECRET, { expiresIn: '8h' });
        res.status(201).json({ token, user: { id: userId, name, email, role: "Admin", account_id: accountId } });
    } catch (e) {
        logger.error(`Registration error: ${e.message}`);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.post("/api/auth/login", async (req, res) => {
    const { email, password } = sanitizeObject(req.body);
    if (!email || !password) return badRequest(res, "Email and password required");

    try {
        const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
        if (!user) {
            return res.status(400).json({ error: "Invalid credentials" });
        }
        // OAuth-only users have no password — direct them to the right login method
        if (!user.password_hash) {
            const provider = user.oauth_provider;
            const hint = provider ? ` Please sign in with ${provider.charAt(0).toUpperCase() + provider.slice(1)}.` : '';
            return res.status(400).json({ error: `This account uses social sign-in.${hint}` });
        }

        // --- Brute Force Protection ---
        if (user.locked_until && new Date(user.locked_until) > new Date()) {
            logger.audit('login_locked', { email });
            return res.status(423).json({ error: "Account locked due to too many failed attempts. Try again later." });
        }

        const validPassword = await bcrypt.compare(password, user.password_hash);
        
        if (!validPassword) {
            const attempts = (user.failed_login_attempts || 0) + 1;
            let lockedUntil = null;
            
            if (attempts >= 10) {
                // Lock for 15 minutes after 10 fails
                lockedUntil = new Date(Date.now() + 15 * 60000).toISOString();
                logger.audit('user_locked', { email, userId: user.id });
            }

            db.prepare("UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?")
              .run(attempts, lockedUntil, user.id);

            return res.status(400).json({ error: "Invalid credentials" });
        }

        // Success: Reset failed attempts
        db.prepare("UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = ?")
          .run(user.id);

        if (user.twoFactorEnabled === 1) {
            const tempToken = jwt.sign({ id: user.id, isTemp2FA: true }, JWT_SECRET, { expiresIn: '5m' });
            return res.json({ requires2FA: true, tempToken });
        }

        const token = jwt.sign({ id: user.id, email: user.email, account_id: user.account_id }, JWT_SECRET, { expiresIn: '8h' });
        
        logger.audit('login_success', { userId: user.id, email: user.email });

        // Strip sensitive data
        const { password_hash, twoFactorSecret, ...safeUser } = user;
        res.json({ token, user: safeUser });
    } catch (e) {
        logger.error(`Login error: ${e.message}`);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.post("/api/auth/login/2fa", (req, res) => {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) return res.status(400).json({ error: "Missing token or code" });

    jwt.verify(tempToken, JWT_SECRET, (err, decoded) => {
        if (err || !decoded.isTemp2FA) return res.status(403).json({ error: "Invalid or expired temporary token" });

        const user = db.prepare("SELECT * FROM users WHERE id = ?").get(decoded.id);
        if (!user || user.twoFactorEnabled !== 1 || !user.twoFactorSecret) {
            return res.status(400).json({ error: "2FA is not properly set up for this user" });
        }

        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token: code,
            window: 1
        });

        if (!verified) return res.status(400).json({ error: "Invalid 2FA code" });

        const token = jwt.sign({ id: user.id, email: user.email, account_id: user.account_id }, JWT_SECRET, { expiresIn: '1d' });
        delete user.password_hash;
        delete user.twoFactorSecret;
        res.json({ token, user });
    });
});

app.get("/api/auth/me", authenticateToken, (req, res) => {
    try {
        const user = db.prepare("SELECT id, name, email, role, account_id, twoFactorEnabled FROM users WHERE id = ? AND account_id = ?").get(req.user.id, req.accountId);
        if (!user) return res.status(404).json({ error: "User not found" });
        res.json(user);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// 2FA Setup endpoints
app.post("/api/auth/2fa/generate", authenticateToken, async (req, res) => {
    try {
        const secret = speakeasy.generateSecret({ name: `V79 Tiquet (${req.user.email})` });
        const dataUrl = await qrcode.toDataURL(secret.otpauth_url);
        
        db.prepare("UPDATE users SET twoFactorSecret = ? WHERE id = ?").run(secret.base32, req.user.id);
        
        res.json({ secret: secret.base32, qrCode: dataUrl });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.post("/api/auth/2fa/verify", authenticateToken, (req, res) => {
    const { code } = req.body;
    try {
        const user = db.prepare("SELECT twoFactorSecret FROM users WHERE id = ?").get(req.user.id);
        if (!user || !user.twoFactorSecret) return res.status(400).json({ error: "No 2FA secret found. Generate one first." });
        
        const verified = speakeasy.totp.verify({
            secret: user.twoFactorSecret,
            encoding: 'base32',
            token: code,
            window: 1
        });
        
        if (verified) {
            db.prepare("UPDATE users SET twoFactorEnabled = 1 WHERE id = ?").run(req.user.id);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: "Invalid validation code" });
        }
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.post("/api/auth/2fa/disable", authenticateToken, (req, res) => {
    try {
        db.prepare("UPDATE users SET twoFactorEnabled = 0, twoFactorSecret = NULL WHERE id = ?").run(req.user.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});


// Helpers for nested relations
const getJobTags = (jobId) => {
    return db.prepare("SELECT tag FROM job_tags WHERE job_id = ?").all(jobId).map(row => row.tag);
};

const getJobActivityLogs = (jobId) => {
    return db.prepare("SELECT * FROM activity_logs WHERE job_id = ? ORDER BY timestamp ASC").all(jobId);
};

const getJobMessages = (jobId) => {
    return db.prepare("SELECT * FROM job_messages WHERE job_id = ? ORDER BY timestamp ASC").all(jobId);
};

const createNotification = ({ userId, title, message, type, accountId }) => {
    try {
        db.prepare(`
            INSERT INTO notifications (id, user_id, title, message, type, createdAt, account_id, isRead)
            VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `).run(uuidv4(), userId, title, message, type, new Date().toISOString(), accountId);
    } catch (e) {
        console.error("Failed to create notification:", e.message);
    }
};

/**
 * Advanced Stage Transition Helper
 * Logs current timer, starts new timer, handles auto-assignment and notifications.
 */
const updateJobStage = (id, newStatus, accountId, userName = "System") => {
    const job = db.prepare("SELECT * FROM jobs WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!job) return null;

    let timeLogs = job.timeLogs ? JSON.parse(job.timeLogs) : [];
    const now = new Date().toISOString();

    // 1. Log previous timer segment if exists
    if (job.timerStartedAt) {
        const elapsed = (new Date(now).getTime() - new Date(job.timerStartedAt).getTime()) / (1000 * 60 * 60);
        if (elapsed > 0) {
            timeLogs.push({
                id: uuidv4(),
                employeeId: job.assignedTo || "unassigned",
                startTime: job.timerStartedAt,
                endTime: now,
                status: job.status
            });
        }
    }

    // 2. Automations: Stage Assignments
    let assignedTo = job.assignedTo;
    const stageAssignments = job.stageAssignments ? JSON.parse(job.stageAssignments) : {};
    if (stageAssignments[newStatus]) {
        assignedTo = stageAssignments[newStatus];
    }

    // 3. Status-specific logic: Stop timer if finished
    const isFinished = ['completed', 'paid'].includes(newStatus);
    const timerStartedAt = isFinished ? null : now;

    // 4. Update DB
    db.prepare(`
        UPDATE jobs SET 
            status = ?, 
            timeLogs = ?, 
            timerStartedAt = ?, 
            assignedTo = ?
        WHERE id = ? AND account_id = ?
    `).run(newStatus, JSON.stringify(timeLogs), timerStartedAt, assignedTo, id, accountId);

    // 5. Activity Log
    db.prepare("INSERT INTO activity_logs (id, job_id, action, timestamp, user, account_id) VALUES (?, ?, ?, ?, ?, ?)")
        .run(uuidv4(), id, `Stage advanced to ${newStatus}${assignedTo !== job.assignedTo ? ` and auto-assigned to ${assignedTo}` : ''}`, now, userName, accountId);

    // 6. Notifications
    if (assignedTo) {
        const userMatch = db.prepare("SELECT id FROM users WHERE name = ? AND account_id = ?").get(assignedTo, accountId);
        if (userMatch) {
            createNotification({
                userId: userMatch.id,
                title: assignedTo !== job.assignedTo ? "Job Assignment Update" : "Job Status Updated",
                message: assignedTo !== job.assignedTo 
                    ? `You have been auto-assigned to "${job.title}" for stage: ${newStatus}`
                    : `"${job.title}" is now: ${newStatus}`,
                type: assignedTo !== job.assignedTo ? "assignment" : "status_change",
                accountId
            });
        }
    }

    return { ...job, status: newStatus, timeLogs, timerStartedAt, assignedTo };
};

// --- API ROUTES (PROTECTED) ---

// Get all jobs
app.get("/api/jobs", authenticateToken, (req, res) => {
    try {
        const jobs = db.prepare("SELECT * FROM jobs WHERE account_id = ? ORDER BY createdAt DESC").all(req.accountId);
        
        const populatedJobs = jobs.map(job => ({
            ...job,
            tags: getJobTags(job.id),
            activityLog: getJobActivityLogs(job.id),
            lineItems: job.lineItems ? JSON.parse(job.lineItems) : [],
            deliverables: job.deliverables ? JSON.parse(job.deliverables) : [],
            timeLogs: job.timeLogs ? JSON.parse(job.timeLogs) : [],
            stageAssignments: job.stageAssignments ? JSON.parse(job.stageAssignments) : {}
        }));

        res.json(populatedJobs);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// Notifications
app.get("/api/notifications", authenticateToken, (req, res) => {
    try {
        const notifications = db.prepare("SELECT * FROM notifications WHERE (user_id = ? OR user_id IS NULL) AND account_id = ? ORDER BY createdAt DESC LIMIT 50")
            .all(req.user.id, req.accountId);
        res.json(notifications);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.put("/api/notifications/read", authenticateToken, (req, res) => {
    const { id } = req.body;
    try {
        if (id) {
            db.prepare("UPDATE notifications SET isRead = 1 WHERE id = ? AND account_id = ?").run(id, req.accountId);
        } else {
            db.prepare("UPDATE notifications SET isRead = 1 WHERE user_id = ? AND account_id = ?").run(req.user.id, req.accountId);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// Create a new job
app.post("/api/jobs", authenticateToken, (req, res) => {
    const { id: reqId, title, client, description, status, createdAt, dueDate, amount, priority, invoiceNotes, assignedTo, clientEmail, tags, activityLog, depositPaid, lineItems, deliverables, timerStartedAt, stageAssignments, timeLogs } = req.body;
    const id = reqId || uuidv4();
    const secureToken = uuidv4();

    try {
        const insertJob = db.prepare(`
            INSERT INTO jobs (id, title, client, description, status, createdAt, dueDate, amount, priority, invoiceNotes, assignedTo, clientEmail, secureToken, depositPaid, account_id, lineItems, deliverables, timerStartedAt, stageAssignments, timeLogs)
            VALUES (@id, @title, @client, @description, @status, @createdAt, @dueDate, @amount, @priority, @invoiceNotes, @assignedTo, @clientEmail, @secureToken, @depositPaid, @account_id, @lineItems, @deliverables, @timerStartedAt, @stageAssignments, @timeLogs)
        `);

        insertJob.run({ 
            id,
            title: title || 'Untitled Job',
            client: client || 'Unknown Client',
            description: description || null,
            status: status || 'request',
            createdAt: createdAt || new Date().toISOString(),
            dueDate: dueDate || null,
            amount: amount !== undefined ? (Number(amount) || 0) : 0,
            priority: priority || 'medium',
            invoiceNotes: invoiceNotes || null,
            assignedTo: assignedTo || null,
            clientEmail: clientEmail || null,
            secureToken, 
            depositPaid: depositPaid ? 1 : 0, 
            account_id: req.accountId,
            lineItems: lineItems ? JSON.stringify(lineItems) : null,
            deliverables: deliverables ? JSON.stringify(deliverables) : null,
            timerStartedAt: timerStartedAt || new Date().toISOString(), // Ensure timer ALWAYS starts
            stageAssignments: stageAssignments ? JSON.stringify(stageAssignments) : null,
            timeLogs: timeLogs ? (typeof timeLogs === 'string' ? timeLogs : JSON.stringify(timeLogs)) : "[]" // Default to empty array
        });

        if (tags && tags.length > 0) {
            const insertTag = db.prepare('INSERT INTO job_tags (job_id, tag, account_id) VALUES (?, ?, ?)');
            tags.forEach(tag => insertTag.run(id, tag, req.accountId));
        }

        if (activityLog && activityLog.length > 0) {
            const insertActivity = db.prepare('INSERT INTO activity_logs (id, job_id, action, timestamp, user, account_id) VALUES (@id, @job_id, @action, @timestamp, @user, @account_id)');
            activityLog.forEach(log => insertActivity.run({ ...log, job_id: id, account_id: req.accountId }));
        }

        // Auto-create/update client profile
        if (client) {
            const existingClient = db.prepare("SELECT id FROM clients WHERE name = ? AND account_id = ?").get(client, req.accountId);
            if (existingClient) {
                if (clientEmail) db.prepare("UPDATE clients SET email = ? WHERE id = ?").run(clientEmail, existingClient.id);
            } else {
                db.prepare("INSERT INTO clients (id, name, email, phone, company, notes, createdAt, account_id) VALUES (?, ?, ?, NULL, NULL, NULL, ?, ?)").run(uuidv4(), client, clientEmail || null, new Date().toISOString(), req.accountId);
            }
        }

        // --- AUTO-CREATE FILE REPOSITORY FOLDER ---
        try {
            const jobFolder = ensureJobFolder(req.accountId, client || 'unknown', id);
            // Write a README so the folder is clearly labelled
            const readme = `# Project: ${title}\nClient: ${client}\nJob ID: ${id}\nCreated: ${new Date().toISOString()}\n\nThis folder contains all files, quotes, invoices, and logs for this project.\n`;
            fs.writeFileSync(path.join(jobFolder, 'README.md'), readme);
            // Seed initial project log
            appendProjectLog(req.accountId, client || 'unknown', id, {
                type: 'job_created',
                action: 'Job created',
                user: req.user?.email || 'System',
                details: { title, client, status, amount }
            });
        } catch(folderErr) {
            console.error('Could not create job folder:', folderErr.message);
            // Non-fatal — don't block job creation
        }

        // --- NOTIFICATION ---
        if (assignedTo) {
            const assignedUser = db.prepare("SELECT id FROM users WHERE name = ? AND account_id = ?").get(assignedTo, req.accountId);
            if (assignedUser) {
                createNotification({
                    userId: assignedUser.id,
                    title: "New Job Assigned",
                    message: `You have been assigned to: ${title}`,
                    type: "assignment",
                    accountId: req.accountId
                });
            }
        }

        const newJob = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
        res.status(201).json({
            ...newJob,
            tags: getJobTags(id),
            activityLog: getJobActivityLogs(id),
            lineItems: newJob.lineItems ? JSON.parse(newJob.lineItems) : [],
            deliverables: newJob.deliverables ? JSON.parse(newJob.deliverables) : [],
            timeLogs: newJob.timeLogs ? JSON.parse(newJob.timeLogs) : [],
            stageAssignments: newJob.stageAssignments ? JSON.parse(newJob.stageAssignments) : {}
        });
    } catch (error) {
        console.error("POST /api/jobs error:", error);
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// Update a job
// ---------------------------------------------------------------------
// Public intake endpoint — used by the VISION79 website's contact form
// (website2026) to open a job here automatically when someone clicks
// "Send My Request". This is the only route in the app that is reachable
// without a logged-in user, so it is deliberately locked down harder than
// the rest of the API:
//   - a shared secret header (X-Intake-Secret) instead of a JWT
//   - a tight, dedicated rate limit (separate from the general apiLimiter)
//   - strict input validation/sanitisation before anything touches the DB
//   - the target account is fixed by server config (INTAKE_ACCOUNT_ID),
//     never chosen by the caller, so a compromised secret can only create
//     jobs in that one account, not read/write anything else.
// ---------------------------------------------------------------------
const intakeLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20, // 20 intake submissions per hour per IP is plenty for a contact form
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later or contact us directly." }
});

const requireIntakeSecret = (req, res, next) => {
    const configuredSecret = process.env.INTAKE_SECRET;
    if (!configuredSecret) {
        logger.error("[Intake] INTAKE_SECRET is not configured — rejecting all intake requests.");
        return res.status(503).json({ error: "Intake is not configured." });
    }
    const provided = req.headers["x-intake-secret"];
    if (
        typeof provided !== "string" ||
        provided.length !== configuredSecret.length ||
        !crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(configuredSecret))
    ) {
        return res.status(401).json({ error: "Unauthorized." });
    }
    next();
};

app.post("/api/public/intake", intakeLimiter, requireIntakeSecret, (req, res) => {
    const accountId = process.env.INTAKE_ACCOUNT_ID || "default_account";
    const body = sanitizeObject(req.body || {});
    const { name, company, email, phone, employees, biggestChallenge, message, source } = body;

    if (!isNonEmptyString(name, 200)) return badRequest(res, "name is required.");
    if (!isNonEmptyString(company, 200)) return badRequest(res, "company is required.");
    if (!isValidEmail(email)) return badRequest(res, "A valid email is required.");

    const id = uuidv4();
    const secureToken = uuidv4();
    const title = `Website Inquiry — ${company}`.slice(0, 300);

    const descriptionParts = [];
    if (message) descriptionParts.push(message.trim());
    if (biggestChallenge) descriptionParts.push(`Biggest challenge: ${biggestChallenge}`);
    if (employees) descriptionParts.push(`Company size: ${employees} employees`);
    if (phone) descriptionParts.push(`Phone: ${phone}`);
    descriptionParts.push(`Submitted via ${source || "website2026"} contact form.`);
    const description = descriptionParts.join("\n\n").slice(0, 5000);

    try {
        db.prepare(`
            INSERT INTO jobs (id, title, client, description, status, createdAt, priority, clientEmail, secureToken, depositPaid, account_id, timerStartedAt, timeLogs)
            VALUES (@id, @title, @client, @description, @status, @createdAt, @priority, @clientEmail, @secureToken, 0, @account_id, @timerStartedAt, '[]')
        `).run({
            id,
            title,
            client: name,
            description,
            status: "request",
            createdAt: new Date().toISOString(),
            priority: "medium",
            clientEmail: email,
            secureToken,
            account_id: accountId,
            timerStartedAt: new Date().toISOString()
        });

        const insertTag = db.prepare('INSERT INTO job_tags (job_id, tag, account_id) VALUES (?, ?, ?)');
        insertTag.run(id, "Website Lead", accountId);

        const insertActivity = db.prepare('INSERT INTO activity_logs (id, job_id, action, timestamp, user, account_id) VALUES (@id, @job_id, @action, @timestamp, @user, @account_id)');
        insertActivity.run({
            id: uuidv4(),
            job_id: id,
            action: "Job created from website contact form",
            timestamp: new Date().toISOString(),
            user: "Website Intake",
            account_id: accountId
        });

        // Auto-create/update client profile, same behavior as the authenticated job-creation route
        const existingClient = db.prepare("SELECT id FROM clients WHERE name = ? AND account_id = ?").get(name, accountId);
        if (existingClient) {
            db.prepare("UPDATE clients SET email = ? WHERE id = ?").run(email, existingClient.id);
        } else {
            db.prepare("INSERT INTO clients (id, name, email, phone, company, notes, createdAt, account_id) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)")
                .run(uuidv4(), name, email, phone || null, company, new Date().toISOString(), accountId);
        }

        try {
            const jobFolder = ensureJobFolder(accountId, name, id);
            fs.writeFileSync(path.join(jobFolder, 'README.md'), `# Project: ${title}\nClient: ${name}\nJob ID: ${id}\nCreated: ${new Date().toISOString()}\n\nThis folder contains all files, quotes, invoices, and logs for this project.\n`);
        } catch (folderErr) {
            console.error('Could not create job folder for intake job:', folderErr.message);
        }

        logger.info(`[Intake] Job ${id} created from website contact form for account ${accountId}`);
        res.status(201).json({ success: true, jobId: id });
    } catch (error) {
        console.error("[Intake] Failed to create job:", error);
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.put("/api/jobs/:id", authenticateToken, async (req, res) => {
    const { id } = req.params;
    const { title, client, description, status, dueDate, amount, priority, invoiceNotes, assignedTo, clientEmail, tags, activityLog, depositPaid, quoteApproved, lineItems, deliverables, timerStartedAt, stageAssignments, timeLogs } = req.body;

    try {
        const existingJob = db.prepare("SELECT * FROM jobs WHERE id = ? AND account_id = ?").get(id, req.accountId);
        if (!existingJob) return res.status(404).json({ error: "Job not found" });

        // BLOCK manual PAID transition
        if (status === 'paid' && existingJob.status !== 'paid') {
            return res.status(403).json({ error: "Job status cannot be manually moved to 'Paid'. This occurs automatically upon payment confirmation." });
        }

        const statusChanged = status && existingJob.status !== status;
        let finalStatus = status || existingJob.status;
        let finalAssignedTo = assignedTo !== undefined ? assignedTo : existingJob.assignedTo;
        let finalTimerStartedAt = timerStartedAt !== undefined ? timerStartedAt : existingJob.timerStartedAt;
        let finalTimeLogs = timeLogs !== undefined ? timeLogs : existingJob.timeLogs;

        // AUTO-ADVANCE: If in 'request' and now assigned, move to 'estimation'
        if (finalStatus === 'request' && finalAssignedTo && !existingJob.assignedTo) {
             finalStatus = 'estimation';
             console.log(`AUTO-ADVANCE: Job ${id} assigned to ${finalAssignedTo}. Moving to 'estimation'.`);
        }

        // AUTOMATION: If status changed (either manually or via auto-advance)
        if (finalStatus !== existingJob.status) {
            const result = updateJobStage(id, finalStatus, req.accountId, req.user?.email || "User");
            if (result) {
                finalAssignedTo = result.assignedTo;
                finalTimerStartedAt = result.timerStartedAt;
                finalTimeLogs = result.timeLogs;
            }
        }

        const updateJob = db.prepare(`
            UPDATE jobs SET 
                title = @title, client = @client, description = @description, status = @status, 
                dueDate = @dueDate, amount = @amount, priority = @priority, invoiceNotes = @invoiceNotes, 
                assignedTo = @assignedTo, clientEmail = @clientEmail, depositPaid = @depositPaid,
                quoteApproved = COALESCE(@quoteApproved, quoteApproved),
                lineItems = @lineItems, deliverables = @deliverables, timerStartedAt = @timerStartedAt,
                stageAssignments = @stageAssignments, timeLogs = @timeLogs
            WHERE id = @id AND account_id = @account_id
        `);

        updateJob.run({ 
            id,
            title: title !== undefined ? title : existingJob.title,
            client: client !== undefined ? client : existingJob.client,
            description: description !== undefined ? description : (existingJob.description || null),
            status: finalStatus,
            dueDate: dueDate !== undefined ? dueDate : (existingJob.dueDate || null),
            amount: amount !== undefined ? (Number(amount) || 0) : (existingJob.amount || 0),
            priority: priority !== undefined ? priority : (existingJob.priority || 'medium'),
            invoiceNotes: invoiceNotes !== undefined ? invoiceNotes : (existingJob.invoiceNotes || null), 
            assignedTo: finalAssignedTo !== undefined ? finalAssignedTo : (existingJob.assignedTo || null),
            clientEmail: clientEmail !== undefined ? clientEmail : (existingJob.clientEmail || null), 
            depositPaid: depositPaid !== undefined ? (depositPaid ? 1 : 0) : (existingJob.depositPaid ? 1 : 0), 
            quoteApproved: quoteApproved !== undefined ? (quoteApproved ? 1 : 0) : (existingJob.quoteApproved ? 1 : 0),
            account_id: req.accountId,
            lineItems: lineItems !== undefined ? (lineItems ? JSON.stringify(lineItems) : null) : (existingJob.lineItems || null),
            deliverables: deliverables !== undefined ? (deliverables ? JSON.stringify(deliverables) : null) : (existingJob.deliverables || null),
            timerStartedAt: finalTimerStartedAt !== undefined ? finalTimerStartedAt : (existingJob.timerStartedAt || null),
            stageAssignments: stageAssignments !== undefined ? (stageAssignments ? JSON.stringify(stageAssignments) : null) : (existingJob.stageAssignments || null),
            timeLogs: finalTimeLogs !== undefined ? (typeof finalTimeLogs === 'string' ? finalTimeLogs : JSON.stringify(finalTimeLogs)) : (existingJob.timeLogs || "[]")
        });

        if (tags) {
            db.prepare('DELETE FROM job_tags WHERE job_id = ? AND account_id = ?').run(id, req.accountId);
            const insertTag = db.prepare('INSERT INTO job_tags (job_id, tag, account_id) VALUES (?, ?, ?)');
            tags.forEach(tag => insertTag.run(id, tag, req.accountId));
        }

        if (activityLog && activityLog.length > 0) {
            const insertActivity = db.prepare('INSERT OR IGNORE INTO activity_logs (id, job_id, action, timestamp, user, account_id) VALUES (@id, @job_id, @action, @timestamp, @user, @account_id)');
            activityLog.forEach(log => insertActivity.run({ ...log, job_id: id, account_id: req.accountId }));
        }

        const recipientEmail = clientEmail || existingJob?.clientEmail;
        const jobTitle = title || existingJob?.title;
        const token = existingJob?.secureToken;

        if (statusChanged && recipientEmail && token) {
            sendStatusUpdate(recipientEmail, jobTitle, status, token)
                .then(r => console.log(`📧 Status update email ${r.success ? 'sent' : 'failed'} to ${recipientEmail}`))
                .catch(e => console.error('Email error:', e));
        }

        // --- NOTIFICATION ---
        // (Handled by updateJobStage for status/assignment changes)

        const updatedJob = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
        res.json({
            ...updatedJob,
            tags: getJobTags(id),
            activityLog: getJobActivityLogs(id),
            lineItems: updatedJob.lineItems ? JSON.parse(updatedJob.lineItems) : [],
            deliverables: updatedJob.deliverables ? JSON.parse(updatedJob.deliverables) : [],
            timeLogs: updatedJob.timeLogs ? JSON.parse(updatedJob.timeLogs) : [],
            stageAssignments: updatedJob.stageAssignments ? JSON.parse(updatedJob.stageAssignments) : {}
        });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});


// Send portal link email
app.post("/api/jobs/:id/send-portal", authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const job = db.prepare("SELECT * FROM jobs WHERE id = ? AND account_id = ?").get(id, req.accountId);
        if (!job) return res.status(404).json({ error: "Job not found" });
        if (!job.clientEmail) return res.status(400).json({ error: "Client does not have an email address" });

        const result = await sendPortalLink(job.clientEmail, job.title, job.secureToken);

        if (result.success) {
            res.json({ success: true, previewUrl: result.previewUrl });
        } else {
            res.status(500).json({ error: result.error || "Failed to send email" });
        }
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// Send Quote workflow email
app.post("/api/jobs/:id/send-quote", authenticateToken, async (req, res) => {
    const { id } = req.params;
    try {
        const job = db.prepare("SELECT * FROM jobs WHERE id = ? AND account_id = ?").get(id, req.accountId);
        if (!job) return res.status(404).json({ error: "Job not found" });
        if (!job.clientEmail) return res.status(400).json({ error: "Client does not have an email address" });

        // Update status to estimation if it was request
        if(job.status === "request") {
            db.prepare("UPDATE jobs SET status = 'estimation' WHERE id = ?").run(id);
        }

        // We can reuse sendPortalLink for now, or imagine adapting it to explicitly say "Quote Approval"
        const result = await sendPortalLink(job.clientEmail, `Quote Ready: ${job.title}`, job.secureToken);

        if (result.success) {
            db.prepare("INSERT INTO activity_logs (id, job_id, action, timestamp, user, account_id) VALUES (?, ?, ?, ?, ?, ?)")
                .run(uuidv4(), job.id, "Quote link sent to client", new Date().toISOString(), req.user.email, req.accountId);
            res.json({ success: true, previewUrl: result.previewUrl });
        } else {
            res.status(500).json({ error: result.error || "Failed to send quote email" });
        }
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// Get business settings
app.get("/api/settings", authenticateToken, (req, res) => {
    try {
        const settings = db.prepare("SELECT * FROM settings WHERE account_id = ? LIMIT 1").get(req.accountId);
        res.json(settings || {});
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// Update business settings
app.put("/api/settings", authenticateToken, (req, res) => {
    const { name, address, email, phone, logoUrl, website, paymentTerms, currency, taxRate } = sanitizeObject(req.body);
    try {
        const existing = db.prepare("SELECT id FROM settings WHERE account_id = ?").get(req.accountId);
        if (existing) {
            db.prepare(`
                UPDATE settings 
                SET name = ?, address = ?, email = ?, phone = ?, logoUrl = ?, website = ?, paymentTerms = ?, currency = ?, taxRate = ? 
                WHERE account_id = ?
            `).run(name, address, email, phone, logoUrl, website, paymentTerms, currency, taxRate, req.accountId);
        } else {
            db.prepare(`
                INSERT INTO settings (id, name, address, email, phone, logoUrl, website, paymentTerms, currency, taxRate, account_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(uuidv4(), name, address, email, phone, logoUrl, website, paymentTerms, currency, taxRate, req.accountId);
        }

        res.json(db.prepare("SELECT * FROM settings WHERE account_id = ?").get(req.accountId));
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// --- Business logo upload (public read — see PUBLIC_LOGOS_DIR comment above) ---

const ALLOWED_LOGO_MIME_TO_EXT = {
    'image/png': '.png',
    'image/jpeg': '.jpg',
    'image/webp': '.webp',
    'image/gif': '.gif',
};

const logoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!ALLOWED_LOGO_MIME_TO_EXT[file.mimetype]) {
            return cb(new Error('Logo must be a PNG, JPEG, WEBP, or GIF image'));
        }
        cb(null, true);
    },
});

app.post("/api/settings/logo", authenticateToken, uploadLimiter, (req, res) => {
    logoUpload.single('logo')(req, res, (err) => {
        if (err) return badRequest(res, err.message || 'Upload failed');
        if (!req.file) return badRequest(res, 'No logo file provided');

        try {
            const ext = ALLOWED_LOGO_MIME_TO_EXT[req.file.mimetype];
            const filename = `${req.accountId}${ext}`;

            // Remove any previous logo for this account, including under a
            // different extension than the new upload, so old files don't
            // pile up in a publicly-servable folder.
            for (const oldExt of Object.values(ALLOWED_LOGO_MIME_TO_EXT)) {
                const oldPath = path.join(PUBLIC_LOGOS_DIR, `${req.accountId}${oldExt}`);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            }

            fs.writeFileSync(path.join(PUBLIC_LOGOS_DIR, filename), req.file.buffer);

            const logoUrl = `/public/logos/${filename}?v=${Date.now()}`;
            const existing = db.prepare("SELECT id FROM settings WHERE account_id = ?").get(req.accountId);
            if (existing) {
                db.prepare("UPDATE settings SET logoUrl = ? WHERE account_id = ?").run(logoUrl, req.accountId);
            } else {
                db.prepare("INSERT INTO settings (id, logoUrl, account_id) VALUES (?, ?, ?)").run(uuidv4(), logoUrl, req.accountId);
            }

            res.json(db.prepare("SELECT * FROM settings WHERE account_id = ?").get(req.accountId));
        } catch (error) {
            res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
        }
    });
});

// Public, unauthenticated — see PUBLIC_LOGOS_DIR comment above for why this
// one route is a deliberate exception. Filename is strictly whitelisted
// (accountId + one of exactly four extensions) so it can only ever resolve
// inside PUBLIC_LOGOS_DIR — no path traversal surface.
const LOGO_FILENAME_RE = /^[a-zA-Z0-9-]+\.(png|jpe?g|webp|gif)$/;
app.get("/public/logos/:filename", (req, res) => {
    const { filename } = req.params;
    if (!LOGO_FILENAME_RE.test(filename)) return res.status(400).end();
    const filePath = path.join(PUBLIC_LOGOS_DIR, filename);
    if (!fs.existsSync(filePath)) return res.status(404).end();
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    res.sendFile(filePath);
});

// Get all employees
app.get("/api/employees", authenticateToken, (req, res) => {
    try {
        const employees = db.prepare("SELECT * FROM employees WHERE account_id = ?").all(req.accountId);
        res.json(employees.map(e => ({ ...e, timeCards: e.timeCards ? JSON.parse(e.timeCards) : [] })));
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// Create an employee. Accepts an optional client-supplied id so the frontend
// (which generates ids locally for optimistic UI) stays in sync with what's
// actually persisted, rather than drifting from a server-generated id.
app.post("/api/employees", authenticateToken, (req, res) => {
    const body = sanitizeObject(req.body);
    const { name, role, salary, hourlyRate, hoursWorked, workerType, paymentMethod, status } = body;
    if (!name || !role || !workerType || !paymentMethod) return badRequest(res, "Missing required employee fields");
    try {
        const id = isNonEmptyString(req.body.id) && isValidUUID(req.body.id) ? req.body.id : uuidv4();
        db.prepare(`
            INSERT INTO employees (id, name, role, salary, hourlyRate, hoursWorked, workerType, paymentMethod, status, isCheckedIn, account_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
        `).run(id, name, role, salary || 0, hourlyRate || null, hoursWorked || 0, workerType, paymentMethod, status || "active", req.accountId);
        const created = db.prepare("SELECT * FROM employees WHERE id = ?").get(id);
        res.status(201).json({ ...created, timeCards: [] });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// Update an employee — also used to append time cards (client sends full
// timeCards array; server stores it as JSON since sqlite has no array type).
app.put("/api/employees/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    const body = sanitizeObject(req.body);
    const { name, role, salary, hourlyRate, hoursWorked, workerType, paymentMethod, status, isCheckedIn, lastCheckIn } = body;
    try {
        const timeCardsJson = Array.isArray(req.body.timeCards) ? JSON.stringify(req.body.timeCards) : undefined;
        const existing = db.prepare("SELECT * FROM employees WHERE id = ? AND account_id = ?").get(id, req.accountId);
        if (!existing) return res.status(404).json({ error: "Employee not found" });

        db.prepare(`
            UPDATE employees SET name = ?, role = ?, salary = ?, hourlyRate = ?, hoursWorked = ?,
              workerType = ?, paymentMethod = ?, status = ?, isCheckedIn = ?, lastCheckIn = ?,
              timeCards = COALESCE(?, timeCards)
            WHERE id = ? AND account_id = ?
        `).run(
            name ?? existing.name, role ?? existing.role, salary ?? existing.salary,
            hourlyRate ?? existing.hourlyRate, hoursWorked ?? existing.hoursWorked,
            workerType ?? existing.workerType, paymentMethod ?? existing.paymentMethod,
            status ?? existing.status, isCheckedIn ?? existing.isCheckedIn, lastCheckIn ?? existing.lastCheckIn,
            timeCardsJson, id, req.accountId
        );
        const updated = db.prepare("SELECT * FROM employees WHERE id = ?").get(id);
        res.json({ ...updated, timeCards: updated.timeCards ? JSON.parse(updated.timeCards) : [] });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.delete("/api/employees/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    try {
        const result = db.prepare("DELETE FROM employees WHERE id = ? AND account_id = ?").run(id, req.accountId);
        if (result.changes === 0) return res.status(404).json({ error: "Employee not found" });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// --- Payroll records ---
app.get("/api/payroll", authenticateToken, (req, res) => {
    try {
        const records = db.prepare("SELECT * FROM payroll_records WHERE account_id = ? ORDER BY date DESC").all(req.accountId);
        res.json(records);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.post("/api/payroll", authenticateToken, (req, res) => {
    const body = sanitizeObject(req.body);
    const { employeeId, employeeName, amount, date, status } = body;
    if (!employeeId || !employeeName || amount == null || !date) return badRequest(res, "Missing required payroll fields");
    try {
        const employee = db.prepare("SELECT id FROM employees WHERE id = ? AND account_id = ?").get(employeeId, req.accountId);
        if (!employee) return badRequest(res, "Unknown employee");

        const id = isNonEmptyString(req.body.id) && isValidUUID(req.body.id) ? req.body.id : uuidv4();
        db.prepare(`
            INSERT INTO payroll_records (id, employeeId, employeeName, amount, date, status, account_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(id, employeeId, employeeName, amount, date, status || "pending", req.accountId);

        logger.audit('payroll_record_created', { accountId: req.accountId, employeeId, amount });
        const created = db.prepare("SELECT * FROM payroll_records WHERE id = ?").get(id);
        res.status(201).json(created);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.put("/api/payroll/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    const { status } = sanitizeObject(req.body);
    try {
        const result = db.prepare("UPDATE payroll_records SET status = ? WHERE id = ? AND account_id = ?")
            .run(status, id, req.accountId);
        if (result.changes === 0) return res.status(404).json({ error: "Payroll record not found" });
        logger.audit('payroll_record_updated', { accountId: req.accountId, id, status });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// --- Team user management (distinct from /api/auth/*: these are teammates
// within the current account, managed by an Admin) ---
app.get("/api/users", authenticateToken, (req, res) => {
    try {
        const users = db.prepare("SELECT id, name, email, role, permissions FROM users WHERE account_id = ?").all(req.accountId);
        res.json(users.map(u => ({ ...u, permissions: u.permissions ? JSON.parse(u.permissions) : [] })));
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// Invite a new teammate: creates a real login account with a random temporary
// password, emailed to them, and forces a password change on first login.
app.post("/api/users", authenticateToken, async (req, res) => {
    const { name, email, role, permissions } = sanitizeObject(req.body);
    if (!name || !email || !role) return badRequest(res, "Name, email, and role are required");
    if (!isValidEmail(email)) return badRequest(res, "Invalid email format");
    try {
        const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
        if (existing) return badRequest(res, "A user with that email already exists");

        const tempPassword = crypto.randomBytes(9).toString("base64url");
        const hashedPassword = await bcrypt.hash(tempPassword, 12);
        const id = uuidv4();

        db.prepare(`
            INSERT INTO users (id, name, email, role, password_hash, permissions, must_change_password, account_id)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        `).run(id, name, email, role, hashedPassword, JSON.stringify(Array.isArray(permissions) ? permissions : []), req.accountId);

        try {
            await sendStatusUpdate({
                to: email,
                subject: "You've been invited to V79 TIQUET",
                text: `Hi ${name},\n\nYou've been added as a "${role}" on your team's V79 TIQUET workspace.\n\nSign in at your workspace URL with:\n  Email: ${email}\n  Temporary password: ${tempPassword}\n\nYou'll be asked to set a new password on first login.`
            });
        } catch (mailErr) {
            logger.error(`Failed to send invite email to ${email}: ${mailErr.message}`);
        }

        logger.audit('user_invited', { accountId: req.accountId, invitedEmail: email, role });
        res.status(201).json({ id, name, email, role, permissions: permissions || [] });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.put("/api/users/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    const { name, role, permissions } = sanitizeObject(req.body);
    try {
        const existing = db.prepare("SELECT * FROM users WHERE id = ? AND account_id = ?").get(id, req.accountId);
        if (!existing) return res.status(404).json({ error: "User not found" });

        db.prepare("UPDATE users SET name = ?, role = ?, permissions = ? WHERE id = ? AND account_id = ?")
            .run(name ?? existing.name, role ?? existing.role, JSON.stringify(Array.isArray(permissions) ? permissions : []), id, req.accountId);

        logger.audit('user_updated', { accountId: req.accountId, userId: id });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.delete("/api/users/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    if (id === req.user.id) return badRequest(res, "You cannot remove your own account");
    try {
        const result = db.prepare("DELETE FROM users WHERE id = ? AND account_id = ?").run(id, req.accountId);
        if (result.changes === 0) return res.status(404).json({ error: "User not found" });
        logger.audit('user_removed', { accountId: req.accountId, userId: id });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// --- General file repository (not tied to a specific job) ---
const generalUpload = multer({
    dest: path.join(UPLOADS_ROOT, "general"),
    limits: { fileSize: 50 * 1024 * 1024 }
});

app.get("/api/files", authenticateToken, (req, res) => {
    try {
        const files = db.prepare("SELECT * FROM files WHERE account_id = ? ORDER BY uploadedAt DESC").all(req.accountId);
        res.json(files);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.post("/api/files", authenticateToken, uploadLimiter, generalUpload.array("files", 20), (req, res) => {
    try {
        const uploaded = (req.files || []).map(f => {
            const id = uuidv4();
            const record = {
                id,
                name: f.originalname,
                size: f.size,
                type: f.mimetype,
                uploadedAt: new Date().toISOString(),
                uploadedBy: req.user.email,
                jobId: null,
                account_id: req.accountId,
                storedName: f.filename
            };
            db.prepare(`
                INSERT INTO files (id, name, size, type, uploadedAt, uploadedBy, jobId, account_id)
                VALUES (@id, @name, @size, @type, @uploadedAt, @uploadedBy, @jobId, @account_id)
            `).run(record);
            fs.renameSync(f.path, path.join(path.dirname(f.path), id));
            return record;
        });
        res.status(201).json(uploaded);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.get("/api/files/:id/download", authenticateToken, (req, res) => {
    const { id } = req.params;
    try {
        const file = db.prepare("SELECT * FROM files WHERE id = ? AND account_id = ?").get(id, req.accountId);
        if (!file) return res.status(404).json({ error: "File not found" });
        const storedPath = path.join(UPLOADS_ROOT, "general", id);
        if (!fs.existsSync(storedPath)) return res.status(404).json({ error: "File content missing on disk" });
        res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.name)}"`);
        res.setHeader("Content-Type", file.type || "application/octet-stream");
        fs.createReadStream(storedPath).pipe(res);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.delete("/api/files/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    try {
        const file = db.prepare("SELECT * FROM files WHERE id = ? AND account_id = ?").get(id, req.accountId);
        if (!file) return res.status(404).json({ error: "File not found" });
        db.prepare("DELETE FROM files WHERE id = ? AND account_id = ?").run(id, req.accountId);
        const storedPath = path.join(UPLOADS_ROOT, "general", id);
        if (fs.existsSync(storedPath)) fs.unlinkSync(storedPath);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// Get all clients with job summary
app.get("/api/clients", authenticateToken, (req, res) => {
    try {
        const clients = db.prepare("SELECT * FROM clients WHERE account_id = ? ORDER BY name ASC").all(req.accountId);
        const clientsWithStats = clients.map(c => {
            const jobs = db.prepare("SELECT id, title, status, amount, createdAt, dueDate, priority, assignedTo FROM jobs WHERE client = ? AND account_id = ?").all(c.name, req.accountId);
            const totalRevenue = jobs.reduce((sum, j) => sum + (j.amount || 0), 0);
            const activeJobs = jobs.filter(j => !['completed', 'invoiced'].includes(j.status)).length;
            return { ...c, jobs, totalJobs: jobs.length, activeJobs, totalRevenue };
        });
        res.json(clientsWithStats);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// Public URL for the company's main marketing site — included in the welcome
// email. Distinct from APP_BASE_URL, which is this app's own portal domain.
const COMPANY_WEBSITE_URL = process.env.COMPANY_WEBSITE_URL || 'https://v79sl.duckdns.org';
const APP_BASE_URL_FOR_TEMPLATES = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

// Renders and sends the account's 'welcome' template to a newly-created
// client. Fire-and-forget by design (see call sites) — a slow or failed SMTP
// send must never block or fail client creation itself.
function optInButtonHtml(optInLink) {
    return `<a href="${optInLink}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:14px 28px;border-radius:6px;text-decoration:none;font-weight:600;font-size:15px">Yes, send me the newsletter</a>`;
}

async function sendWelcomeEmailForClient(client, accountId) {
    const template = db.prepare("SELECT * FROM email_templates WHERE account_id = ? AND type = 'welcome'").get(accountId);
    if (!template || !template.subject || !template.body) return { success: false, error: 'No welcome template configured' };

    const settings = db.prepare("SELECT * FROM settings WHERE account_id = ?").get(accountId);
    const optInLink = `${APP_BASE_URL_FOR_TEMPLATES}/api/newsletter/confirm/${client.newsletterOptInToken}`;
    const vars = {
        client_name: client.name || '',
        company_name: settings?.name || '',
        company_address: settings?.address || '',
        company_phone: settings?.phone || '',
        company_email: settings?.email || '',
        site_url: settings?.website || COMPANY_WEBSITE_URL,
        opt_in_link: optInLink,
    };

    const { subject, html } = renderEmailFromPlainTemplate(template.subject, template.body, vars, {
        ctaHtml: optInButtonHtml(optInLink),
    });
    return sendTemplated(client.email, subject, html);
}

// Create a new client
app.post("/api/clients", authenticateToken, async (req, res) => {
    const { name, company, email, phone, address, industryId } = sanitizeObject(req.body);
    if (!name || !email) return badRequest(res, "Name and email are required");
    if (!isValidEmail(email)) return badRequest(res, "Invalid email format");

    try {
        const id = isNonEmptyString(req.body.id) ? String(req.body.id).slice(0, 64) : uuidv4();
        const createdAt = new Date().toISOString();
        const newsletterOptInToken = uuidv4();
        db.prepare(
            "INSERT INTO clients (id, name, company, email, phone, address, industryId, newsletterOptInToken, newsletterOptIn, createdAt, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)"
        ).run(id, name, company || null, email, phone || null, address || null, industryId || null, newsletterOptInToken, createdAt, req.accountId);

        const newClient = db.prepare("SELECT * FROM clients WHERE id = ?").get(id);

        // Awaited, not fire-and-forget: this was previously "fire and
        // forget with a console.log", which meant a failed or skipped
        // welcome email (e.g. SMTP not configured) was invisible to the
        // admin — client creation always looked like it fully succeeded
        // even when no email went anywhere. A single email is small enough
        // to safely await (unlike the newsletter broadcast, which can be
        // hundreds) — worst case this adds a second or two to client
        // creation, not a real cost.
        let welcomeEmail = { sent: false, skipped: false, error: null };
        try {
            const result = await sendWelcomeEmailForClient(newClient, req.accountId);
            welcomeEmail = { sent: !!result.success && !result.skipped, skipped: !!result.skipped, error: result.error || null };
            console.log(`📧 Welcome email ${result.skipped ? 'skipped (SMTP not configured)' : result.success ? 'sent' : 'failed'} to ${newClient.email}`);
        } catch (e) {
            welcomeEmail = { sent: false, skipped: false, error: e.message };
            console.error('Welcome email error:', e);
        }

        res.status(201).json({ ...newClient, jobs: [], totalJobs: 0, activeJobs: 0, totalRevenue: 0, welcomeEmail });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// Update client contact info
app.put("/api/clients/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    const { name, phone, company, notes, email, address, industryId } = sanitizeObject(req.body);
    if (!isNonEmptyString(name)) return badRequest(res, "Name is required");
    if (email && !isValidEmail(email)) return badRequest(res, "Invalid email format");
    try {
        const result = db.prepare(
            "UPDATE clients SET name = ?, phone = ?, company = ?, notes = ?, email = ?, address = ?, industryId = ? WHERE id = ? AND account_id = ?"
        ).run(name, phone || null, company || null, notes || null, email || null, address || null, industryId || null, id, req.accountId);
        if (result.changes === 0) return res.status(404).json({ error: "Client not found" });
        res.json(db.prepare("SELECT * FROM clients WHERE id = ?").get(id));
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// Delete a client
app.delete("/api/clients/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    try {
        const result = db.prepare("DELETE FROM clients WHERE id = ? AND account_id = ?").run(id, req.accountId);
        if (result.changes === 0) return res.status(404).json({ error: "Client not found" });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// ── Industries (editable dropdown for client grouping) ─────────────────────────

app.get("/api/industries", authenticateToken, (req, res) => {
    try {
        const rows = db.prepare("SELECT * FROM industries WHERE account_id = ? ORDER BY name ASC").all(req.accountId);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.post("/api/industries", authenticateToken, (req, res) => {
    const { name } = sanitizeObject(req.body);
    if (!isNonEmptyString(name)) return badRequest(res, "Industry name is required");
    try {
        const id = uuidv4();
        db.prepare("INSERT INTO industries (id, name, account_id) VALUES (?, ?, ?)").run(id, name.slice(0, 120), req.accountId);
        res.status(201).json(db.prepare("SELECT * FROM industries WHERE id = ?").get(id));
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.put("/api/industries/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    const { name } = sanitizeObject(req.body);
    if (!isNonEmptyString(name)) return badRequest(res, "Industry name is required");
    try {
        const result = db.prepare("UPDATE industries SET name = ? WHERE id = ? AND account_id = ?").run(name.slice(0, 120), id, req.accountId);
        if (result.changes === 0) return res.status(404).json({ error: "Industry not found" });
        res.json(db.prepare("SELECT * FROM industries WHERE id = ?").get(id));
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.delete("/api/industries/:id", authenticateToken, (req, res) => {
    const { id } = req.params;
    try {
        // Clients referencing this industry just fall back to "no industry"
        // rather than blocking the delete — there's no FK constraint forcing
        // either choice, so this is the friendlier default for an admin
        // cleaning up their list.
        db.prepare("UPDATE clients SET industryId = NULL WHERE industryId = ? AND account_id = ?").run(id, req.accountId);
        const result = db.prepare("DELETE FROM industries WHERE id = ? AND account_id = ?").run(id, req.accountId);
        if (result.changes === 0) return res.status(404).json({ error: "Industry not found" });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// ── Email templates (welcome + newsletter, admin-editable) ─────────────────────

const VALID_TEMPLATE_TYPES = new Set(['welcome', 'newsletter']);

app.get("/api/templates", authenticateToken, (req, res) => {
    try {
        const rows = db.prepare("SELECT type, subject, body, updatedAt FROM email_templates WHERE account_id = ?").all(req.accountId);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.put("/api/templates/:type", authenticateToken, (req, res) => {
    const { type } = req.params;
    if (!VALID_TEMPLATE_TYPES.has(type)) return badRequest(res, "Unknown template type");

    // Plain text — deliberately NOT HTML-sanitized or tag-stripped. There's
    // no HTML-injection surface to defend against here at all: this string
    // is escaped exactly once, at send time (plainTextToHtml in email.js),
    // so raw '<'/'>' characters the admin types stay as literal text instead
    // of being misread as markup and stripped.
    const subject = String(req.body?.subject ?? '').slice(0, 300);
    const body = String(req.body?.body ?? '').slice(0, 20000);

    try {
        const existing = db.prepare("SELECT id FROM email_templates WHERE account_id = ? AND type = ?").get(req.accountId, type);
        const updatedAt = new Date().toISOString();
        if (existing) {
            db.prepare("UPDATE email_templates SET subject = ?, body = ?, updatedAt = ? WHERE id = ?")
                .run(subject, body, updatedAt, existing.id);
        } else {
            db.prepare("INSERT INTO email_templates (id, type, subject, body, updatedAt, account_id) VALUES (?, ?, ?, ?, ?, ?)")
                .run(uuidv4(), type, subject, body, updatedAt, req.accountId);
        }
        res.json(db.prepare("SELECT type, subject, body, updatedAt FROM email_templates WHERE account_id = ? AND type = ?").get(req.accountId, type));
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.post("/api/templates/:type/test", authenticateToken, async (req, res) => {
    const { type } = req.params;
    if (!VALID_TEMPLATE_TYPES.has(type)) return badRequest(res, "Unknown template type");
    try {
        const template = db.prepare("SELECT * FROM email_templates WHERE account_id = ? AND type = ?").get(req.accountId, type);
        if (!template || !template.subject || !template.body) return badRequest(res, "Template is empty — add content before sending a test");

        const settings = db.prepare("SELECT * FROM settings WHERE account_id = ?").get(req.accountId);
        const testTo = req.user?.email;
        if (!testTo) return badRequest(res, "No email on your account to send the test to");

        const optInLink = `${APP_BASE_URL_FOR_TEMPLATES}/api/newsletter/confirm/test-token`;
        const vars = {
            client_name: 'Test Recipient',
            company_name: settings?.name || '',
            company_address: settings?.address || '',
            company_phone: settings?.phone || '',
            company_email: settings?.email || '',
            site_url: settings?.website || COMPANY_WEBSITE_URL,
            opt_in_link: optInLink,
        };
        const { subject, html } = renderEmailFromPlainTemplate(template.subject, template.body, vars, {
            ctaHtml: type === 'welcome' ? optInButtonHtml(optInLink) : null,
        });
        const result = await sendTemplated(testTo, `[TEST] ${subject}`, html);
        res.json({ success: result.success, error: result.error });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// ── Newsletter opt-in confirmation (public — reached from an emailed link) ────

const newsletterConfirmLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

app.get("/api/newsletter/confirm/:token", newsletterConfirmLimiter, (req, res) => {
    const { token } = req.params;
    const confirmationPage = (message) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Newsletter Subscription</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh">
  <div style="background:#ffffff;border-radius:8px;box-shadow:0 2px 8px rgba(0,0,0,.08);padding:40px;max-width:420px;text-align:center">
    <p style="color:#1e293b;font-size:16px;line-height:1.6;margin:0">${escapeHtmlForConfirmPage(message)}</p>
  </div>
</body></html>`;

    try {
        if (!isValidUUID(token)) return res.status(400).send(confirmationPage("This confirmation link isn't valid."));
        const client = db.prepare("SELECT id, newsletterOptIn FROM clients WHERE newsletterOptInToken = ?").get(token);
        if (!client) return res.status(404).send(confirmationPage("This confirmation link isn't valid."));

        if (!client.newsletterOptIn) {
            db.prepare("UPDATE clients SET newsletterOptIn = 1, newsletterOptedInAt = ? WHERE id = ?")
                .run(new Date().toISOString(), client.id);
        }
        res.send(confirmationPage("You're subscribed! Thanks for signing up for our newsletter."));
    } catch (error) {
        res.status(500).send(confirmationPage("Something went wrong confirming your subscription. Please try again later."));
    }
});

function escapeHtmlForConfirmPage(str) {
    return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Newsletter broadcast ────────────────────────────────────────────────────────

app.get("/api/newsletter/sends", authenticateToken, (req, res) => {
    try {
        const rows = db.prepare("SELECT id, industryId, subject, recipientCount, sentAt, sentBy FROM newsletter_sends WHERE account_id = ? ORDER BY sentAt DESC LIMIT 50").all(req.accountId);
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.post("/api/newsletter/broadcast", authenticateToken, (req, res) => {
    const { industryId } = req.body || {};
    try {
        const template = db.prepare("SELECT * FROM email_templates WHERE account_id = ? AND type = 'newsletter'").get(req.accountId);
        if (!template || !template.subject || !template.body) {
            return badRequest(res, "Your newsletter template is empty — add content in Settings before broadcasting");
        }

        const recipients = industryId
            ? db.prepare("SELECT * FROM clients WHERE account_id = ? AND newsletterOptIn = 1 AND email IS NOT NULL AND email != '' AND industryId = ?").all(req.accountId, industryId)
            : db.prepare("SELECT * FROM clients WHERE account_id = ? AND newsletterOptIn = 1 AND email IS NOT NULL AND email != ''").all(req.accountId);

        if (recipients.length === 0) {
            return badRequest(res, "No opted-in clients match that group");
        }

        const settings = db.prepare("SELECT * FROM settings WHERE account_id = ?").get(req.accountId);
        const sendId = uuidv4();
        const sentAt = new Date().toISOString();

        // Respond immediately with the recipient count; the actual sends
        // happen after the response, sequentially with a short delay between
        // each — there's no email queue in this app, and awaiting hundreds
        // of SMTP round-trips inside the HTTP request would time out the
        // request for no benefit to the admin waiting on it.
        res.status(202).json({ started: true, recipientCount: recipients.length });

        (async () => {
            let lastRenderedSubject = template.subject;
            for (const client of recipients) {
                const vars = {
                    client_name: client.name || '',
                    company_name: settings?.name || '',
                    company_address: settings?.address || '',
                    company_phone: settings?.phone || '',
                    company_email: settings?.email || '',
                    site_url: settings?.website || COMPANY_WEBSITE_URL,
                };
                const { subject, html } = renderEmailFromPlainTemplate(template.subject, template.body, vars);
                lastRenderedSubject = subject;
                try {
                    await sendTemplated(client.email, subject, html);
                } catch (e) {
                    console.error(`Newsletter send failed for ${client.email}:`, e.message);
                }
                await new Promise(r => setTimeout(r, 250));
            }

            try {
                db.prepare(
                    "INSERT INTO newsletter_sends (id, industryId, subject, contentSnapshot, recipientCount, sentAt, sentBy, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
                ).run(sendId, industryId || null, lastRenderedSubject, template.body, recipients.length, sentAt, req.user?.email || null, req.accountId);
                logger.audit('newsletter_broadcast', { accountId: req.accountId, industryId: industryId || null, recipientCount: recipients.length, sentBy: req.user?.email });
            } catch (e) {
                console.error('Failed to log newsletter send:', e.message);
            }
        })();
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// Job Messages (Chat)
app.get("/api/jobs/:id/messages", authenticateToken, (req, res) => {
    try {
        // SECURITY: verify the job belongs to the caller's account before returning messages
        const job = db.prepare("SELECT id FROM jobs WHERE id = ? AND account_id = ?").get(req.params.id, req.accountId);
        if (!job) return res.status(404).json({ error: "Job not found" });

        const messages = getJobMessages(req.params.id);
        res.json(messages);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.post("/api/jobs/:id/messages", authenticateToken, (req, res) => {
    const { id: jobId } = req.params;
    const { sender, content } = req.body;
    const id = uuidv4();
    const timestamp = new Date().toISOString();

    try {
        // SECURITY: verify the job belongs to the caller's account before writing a message to it
        const job = db.prepare("SELECT client FROM jobs WHERE id = ? AND account_id = ?").get(jobId, req.accountId);
        if (!job) return res.status(404).json({ error: "Job not found" });

        db.prepare("INSERT INTO job_messages (id, job_id, sender, content, timestamp, account_id) VALUES (?, ?, ?, ?, ?, ?)")
            .run(id, jobId, sender, content, timestamp, req.accountId);

        // Append to project log
        appendProjectLog(req.accountId, job.client, jobId, {
            type: 'message',
            action: `Message sent by ${sender}`,
            user: sender,
            details: { content: (content || '').slice(0, 200) }
        });

        const message = { id, jobId, sender, content, timestamp };
        broadcastToJob(jobId, { type: "message", message });

        res.status(201).json(message);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// --- FILE REPOSITORY ENDPOINTS ---

// Dynamic multer storage — destination is set per-job folder
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        try {
            const job = db.prepare("SELECT client, account_id FROM jobs WHERE id = ? AND account_id = ?").get(req.params.id, req.accountId);
            if (!job) return cb(new Error('Job not found'), null);
            const folder = ensureJobFolder(req.accountId, job.client, req.params.id);
            cb(null, folder);
        } catch(e) { cb(e, null); }
    },
    filename: (req, file, cb) => {
        // Prefix with timestamp to avoid collisions, preserve original name
        const safe = file.originalname.replace(/[^a-zA-Z0-9_.\-]/g, '_');
        cb(null, `${Date.now()}-${safe}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
});

// POST /api/jobs/:id/files  — upload one or many files into the job folder
app.post("/api/jobs/:id/files", authenticateToken, uploadLimiter, upload.array('files', 20), (req, res) => {
    const { id: jobId } = req.params;
    try {
        if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

        const job = db.prepare("SELECT client FROM jobs WHERE id = ? AND account_id = ?").get(jobId, req.accountId);
        const uploaded = req.files.map(f => ({
            name: f.originalname,
            filename: f.filename,
            size: f.size,
            mimetype: f.mimetype,
            url: `/api/files/${sanitizeForPath(req.accountId)}/${sanitizeForPath(job?.client || 'unknown')}/${jobId}/${f.filename}`,
            uploadedAt: new Date().toISOString()
        }));

        // Log the upload
        if (job) {
            appendProjectLog(req.accountId, job.client, jobId, {
                type: 'file_upload',
                action: `${req.files.length} file(s) uploaded`,
                user: req.user?.email || 'Team',
                details: { files: uploaded.map(f => f.name) }
            });
        }

        res.status(201).json({ success: true, files: uploaded });
    } catch(error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// GET /api/jobs/:id/files  — list all files in the job folder
app.get("/api/jobs/:id/files", authenticateToken, (req, res) => {
    const { id: jobId } = req.params;
    try {
        const job = db.prepare("SELECT client FROM jobs WHERE id = ? AND account_id = ?").get(jobId, req.accountId);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const folder = getJobFolder(req.accountId, job.client, jobId);
        if (!fs.existsSync(folder)) return res.json({ files: [], log: [] });

        const entries = fs.readdirSync(folder, { withFileTypes: true })
            .filter(e => e.isFile() && e.name !== 'project-log.json')
            .map(e => {
                const stat = fs.statSync(path.join(folder, e.name));
                return {
                    filename: e.name,
                    // Original name: strip leading timestamp prefix if present
                    name: e.name.replace(/^\d+-/, ''),
                    size: stat.size,
                    uploadedAt: stat.mtime.toISOString(),
                    url: `/api/files/${sanitizeForPath(req.accountId)}/${sanitizeForPath(job.client)}/${jobId}/${e.name}`
                };
            });

        // Also read project log
        const logPath = path.join(folder, 'project-log.json');
        const log = fs.existsSync(logPath) ? JSON.parse(fs.readFileSync(logPath, 'utf8')) : [];

        res.json({ files: entries, log });
    } catch(error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

// DELETE /api/jobs/:id/files/:filename  — delete a specific file from the job folder
app.delete("/api/jobs/:id/files/:filename", authenticateToken, (req, res) => {
    const { id: jobId, filename } = req.params;
    try {
        const job = db.prepare("SELECT client FROM jobs WHERE id = ? AND account_id = ?").get(jobId, req.accountId);
        if (!job) return res.status(404).json({ error: 'Job not found' });

        const folder = getJobFolder(req.accountId, job.client, jobId);
        const filePath = path.join(folder, filename);

        // Security: ensure file is inside the job folder (prevent path traversal)
        if (!filePath.startsWith(folder)) return res.status(403).json({ error: 'Forbidden' });
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

        fs.unlinkSync(filePath);
        appendProjectLog(req.accountId, job.client, jobId, {
            type: 'file_deleted',
            action: `File deleted: ${filename}`,
            user: req.user?.email || 'Team',
        });
        res.json({ success: true });
    } catch(error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});


// --- CLIENT PORTAL PUBLIC SECURE ROUTES ---

// Helper to get settings for a public portal
const getSettingsForPortal = (accountId) => {
    return db.prepare("SELECT * FROM settings WHERE account_id = ? LIMIT 1").get(accountId) || {};
}

// Secure endpoint for client portal
app.get("/api/portal/:token", (req, res) => {
    const { token } = req.params;
    try {
        const job = db.prepare("SELECT * FROM jobs WHERE secureToken = ?").get(token);
        if (!job) return res.status(404).json({ error: "Invalid link" });

        const populatedJob = {
            ...job,
            activityLog: getJobActivityLogs(job.id),
            messages: getJobMessages(job.id),
            lineItems: job.lineItems ? JSON.parse(job.lineItems) : [],
            deliverables: job.deliverables ? JSON.parse(job.deliverables) : [],
            timeLogs: job.timeLogs ? JSON.parse(job.timeLogs) : [],
            stageAssignments: job.stageAssignments ? JSON.parse(job.stageAssignments) : {},
            timerStartedAt: job.timerStartedAt
        };
        const settings = getSettingsForPortal(job.account_id);
        res.json({ job: populatedJob, settings });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.post("/api/portal/:token/approve-quote", (req, res) => {
    const { token } = req.params;
    try {
        const job = db.prepare("SELECT id, account_id FROM jobs WHERE secureToken = ?").get(token);
        if (!job) return res.status(404).json({ error: "Invalid link" });

        // Automate stage transition to 'in-progress'
        updateJobStage(job.id, 'in-progress', job.account_id, 'Client Portal');

        db.prepare("UPDATE jobs SET quoteApproved = 1 WHERE id = ?").run(job.id);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.post("/api/portal/:token/pay-deposit", (req, res) => {
    const { token } = req.params;
    try {
        const job = db.prepare("SELECT id, account_id FROM jobs WHERE secureToken = ?").get(token);
        if (!job) return res.status(404).json({ error: "Invalid link" });

        db.prepare("UPDATE jobs SET depositPaid = 1 WHERE id = ?").run(job.id);
        db.prepare("INSERT INTO activity_logs (id, job_id, action, timestamp, user, account_id) VALUES (?, ?, ?, ?, ?, ?)")
            .run(uuidv4(), job.id, "30% Deposit paid via portal", new Date().toISOString(), "Client", job.account_id);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.post("/api/portal/:token/pay-final", (req, res) => {
    const { token } = req.params;
    try {
        const job = db.prepare("SELECT id, account_id FROM jobs WHERE secureToken = ?").get(token);
        if (!job) return res.status(404).json({ error: "Invalid link" });

        // Automate stage transition to 'paid' (this will stop the timer)
        updateJobStage(job.id, 'paid', job.account_id, 'Client Portal');

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});

app.post("/api/portal/:token/messages", (req, res) => {
    const { token } = req.params;
    const { content } = req.body;
    // SECURITY: this is a public, unauthenticated endpoint reachable by anyone with the
    // portal link. Never trust a caller-supplied `sender` here — force it to "Client" so
    // the portal cannot be used to spoof staff messages in the thread.
    const sender = "Client";
    try {
        if (!content || typeof content !== "string" || !content.trim()) {
            return res.status(400).json({ error: "Message content is required" });
        }
        const job = db.prepare("SELECT id, account_id, client FROM jobs WHERE secureToken = ?").get(token);
        if (!job) return res.status(404).json({ error: "Invalid link" });

        const id = uuidv4();
        const timestamp = new Date().toISOString();
        const trimmedContent = content.trim().slice(0, 2000);
        db.prepare("INSERT INTO job_messages (id, job_id, sender, content, timestamp, account_id) VALUES (?, ?, ?, ?, ?, ?)")
            .run(id, job.id, sender, trimmedContent, timestamp, job.account_id);

        appendProjectLog(job.account_id, job.client, job.id, {
            type: 'message',
            action: `Message sent by ${sender}`,
            user: sender,
            details: { content: trimmedContent.slice(0, 200) }
        });

        const message = { id, jobId: job.id, sender, content: trimmedContent, timestamp };
        broadcastToJob(job.id, { type: "message", message });

        res.status(201).json(message);
    } catch (error) {
        res.status(500).json({ error: isProduction ? "Internal Server Error" : error.message });
    }
});


// ══════════════════════════════════════════════════════════════════════════════
// SUPER ADMIN ROUTES
// ══════════════════════════════════════════════════════════════════════════════

const saLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });

// POST /api/superadmin/login
app.post('/api/superadmin/login', saLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const admin = db.prepare("SELECT * FROM super_admins WHERE email = ?").get(email);
        if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
        const valid = await bcrypt.compare(password, admin.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: admin.id, email: admin.email, isSuperAdmin: true }, SA_JWT_SECRET, { expiresIn: '8h' });
        res.json({ token, admin: { id: admin.id, email: admin.email } });
    } catch (e) {
        res.status(500).json({ error: isProduction ? 'Internal Server Error' : e.message });
    }
});

// GET /api/superadmin/stats
app.get('/api/superadmin/stats', superAdminMiddleware, (req, res) => {
    try {
        const totalAccounts = db.prepare("SELECT count(*) as c FROM accounts").get().c;
        const activeAccounts = db.prepare("SELECT count(*) as c FROM accounts WHERE status = 'active'").get().c;
        const suspendedAccounts = db.prepare("SELECT count(*) as c FROM accounts WHERE status = 'suspended'").get().c;
        const totalUsers = db.prepare("SELECT count(*) as c FROM users").get().c;
        const totalJobs = db.prepare("SELECT count(*) as c FROM jobs").get().c;
        const activeSubs = db.prepare("SELECT count(*) as c FROM subscriptions WHERE status = 'active'").get().c;
        const trialSubs = db.prepare("SELECT count(*) as c FROM subscriptions WHERE status = 'trialing'").get().c;
        const canceledSubs = db.prepare("SELECT count(*) as c FROM subscriptions WHERE status = 'canceled'").get().c;
        // MRR: sum plan prices for active subscriptions
        const planPrices = { starter: 29, pro: 79, enterprise: 199, trial: 0 };
        const activePlans = db.prepare("SELECT plan, count(*) as c FROM subscriptions WHERE status = 'active' GROUP BY plan").all();
        const mrr = activePlans.reduce((sum, row) => sum + (planPrices[row.plan] || 0) * row.c, 0);
        const newSignups30d = db.prepare("SELECT count(*) as c FROM accounts WHERE createdAt >= datetime('now', '-30 days')").get().c;

        res.json({ totalAccounts, activeAccounts, suspendedAccounts, totalUsers, totalJobs, activeSubs, trialSubs, canceledSubs, mrr, newSignups30d });
    } catch (e) {
        res.status(500).json({ error: isProduction ? 'Internal Server Error' : e.message });
    }
});

// GET /api/superadmin/accounts
app.get('/api/superadmin/accounts', superAdminMiddleware, (req, res) => {
    try {
        const accounts = db.prepare("SELECT * FROM accounts ORDER BY createdAt DESC").all();
        const enriched = accounts.map(acc => {
            const sub = db.prepare("SELECT * FROM subscriptions WHERE account_id = ? ORDER BY createdAt DESC LIMIT 1").get(acc.id);
            const userCount = db.prepare("SELECT count(*) as c FROM users WHERE account_id = ?").get(acc.id).c;
            const jobCount = db.prepare("SELECT count(*) as c FROM jobs WHERE account_id = ?").get(acc.id).c;
            const settings = db.prepare("SELECT name, email, logoUrl FROM settings WHERE account_id = ? LIMIT 1").get(acc.id);
            return { ...acc, subscription: sub || null, userCount, jobCount, settings: settings || {} };
        });
        res.json(enriched);
    } catch (e) {
        res.status(500).json({ error: isProduction ? 'Internal Server Error' : e.message });
    }
});

// GET /api/superadmin/accounts/:id
app.get('/api/superadmin/accounts/:id', superAdminMiddleware, (req, res) => {
    try {
        const acc = db.prepare("SELECT * FROM accounts WHERE id = ?").get(req.params.id);
        if (!acc) return res.status(404).json({ error: 'Account not found' });
        const sub = db.prepare("SELECT * FROM subscriptions WHERE account_id = ? ORDER BY createdAt DESC LIMIT 1").get(acc.id);
        const users = db.prepare("SELECT id, name, email, role, twoFactorEnabled FROM users WHERE account_id = ?").all(acc.id);
        const jobs = db.prepare("SELECT id, title, status, amount, createdAt FROM jobs WHERE account_id = ? ORDER BY createdAt DESC LIMIT 20").all(acc.id);
        const settings = db.prepare("SELECT * FROM settings WHERE account_id = ? LIMIT 1").get(acc.id);
        res.json({ ...acc, subscription: sub || null, users, recentJobs: jobs, settings: settings || {} });
    } catch (e) {
        res.status(500).json({ error: isProduction ? 'Internal Server Error' : e.message });
    }
});

// PUT /api/superadmin/accounts/:id/suspend
app.put('/api/superadmin/accounts/:id/suspend', superAdminMiddleware, (req, res) => {
    try {
        db.prepare("UPDATE accounts SET status = 'suspended', suspendedAt = ? WHERE id = ?").run(new Date().toISOString(), req.params.id);
        res.json({ success: true, message: 'Account suspended' });
    } catch (e) {
        res.status(500).json({ error: isProduction ? 'Internal Server Error' : e.message });
    }
});

// PUT /api/superadmin/accounts/:id/unsuspend
app.put('/api/superadmin/accounts/:id/unsuspend', superAdminMiddleware, (req, res) => {
    try {
        db.prepare("UPDATE accounts SET status = 'active', suspendedAt = NULL WHERE id = ?").run(req.params.id);
        res.json({ success: true, message: 'Account unsuspended' });
    } catch (e) {
        res.status(500).json({ error: isProduction ? 'Internal Server Error' : e.message });
    }
});

// DELETE /api/superadmin/accounts/:id
app.delete('/api/superadmin/accounts/:id', superAdminMiddleware, (req, res) => {
    const { id } = req.params;
    if (id === 'default_account') return res.status(403).json({ error: 'Cannot delete the default account' });
    try {
        const tables = ['jobs', 'job_tags', 'activity_logs', 'employees', 'users', 'user_permissions', 'files', 'clients', 'job_messages', 'notifications', 'settings', 'subscriptions'];
        db.transaction(() => {
            for (const t of tables) {
                try { db.prepare(`DELETE FROM ${t} WHERE account_id = ?`).run(id); } catch(e) {}
            }
            db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
        })();
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: isProduction ? 'Internal Server Error' : e.message });
    }
});

// GET /api/superadmin/subscriptions
app.get('/api/superadmin/subscriptions', superAdminMiddleware, (req, res) => {
    try {
        const subs = db.prepare("SELECT s.*, a.name as accountName, a.status as accountStatus FROM subscriptions s LEFT JOIN accounts a ON s.account_id = a.id ORDER BY s.createdAt DESC").all();
        res.json(subs);
    } catch (e) {
        res.status(500).json({ error: isProduction ? 'Internal Server Error' : e.message });
    }
});

// PUT /api/superadmin/accounts/:id/change-plan
app.put('/api/superadmin/accounts/:id/change-plan', superAdminMiddleware, (req, res) => {
    const { plan } = req.body;
    const validPlans = ['trial', 'starter', 'pro', 'enterprise'];
    if (!validPlans.includes(plan)) return res.status(400).json({ error: 'Invalid plan' });
    try {
        db.prepare("UPDATE accounts SET plan = ? WHERE id = ?").run(plan, req.params.id);
        db.prepare("UPDATE subscriptions SET plan = ? WHERE account_id = ?").run(plan, req.params.id);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: isProduction ? 'Internal Server Error' : e.message });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// STRIPE ROUTES
// ══════════════════════════════════════════════════════════════════════════════
// stripe.js is currently a SIMULATED billing layer (see comment at top of that
// file) — no real card ever gets charged. V79 TIQUET's UI doesn't call any of
// these endpoints, so rather than leave a fake checkout/subscription API
// reachable in production (which would violate "no simulated data"), it's
// off unless a real STRIPE_SECRET_KEY is configured. Wiring real Stripe is a
// separate follow-up task — swap the SIMULATED blocks in server/stripe.js for
// actual stripe-node SDK calls, then this will register automatically.
if (process.env.STRIPE_SECRET_KEY) {
  registerStripeRoutes(app, authenticateToken);
} else if (!isProduction) {
  registerStripeRoutes(app, authenticateToken);
  logger.warn("Stripe routes registered in SIMULATED mode (dev only, no STRIPE_SECRET_KEY set).");
}

// Serve static frontend files in production
if (isProduction) {
    app.use(express.static(path.join(__dirname, '../dist')));
    // Only fall back to the SPA shell for real page routes. Without the
    // /api exclusion here, any unmatched /api/* request (typo'd endpoint,
    // stale frontend build calling a removed route, etc.) would silently
    // return a 200 HTML page instead of a 404 — masking real API errors
    // as if they succeeded.
    app.get(/^(?!\/api\/).*/, (req, res) => {
        res.sendFile(path.join(__dirname, '../dist/index.html'));
    });
    app.use('/api', (req, res) => {
        res.status(404).json({ error: 'Not found' });
    });
}

// ── Global error handler ──────────────────────────────────────────────────
// Without this, errors passed via next(err) — e.g. the cors() middleware's
// callback(new Error('Not allowed by CORS')) — fall through to Express's
// default error handler, which returns a bare 500 with no useful body. That
// masks real CORS/config problems as generic server errors. Catch them here
// and respond with the correct status code instead.
app.use((err, req, res, next) => {
    if (err && err.message === 'Not allowed by CORS') {
        logger.warn(`CORS rejection for ${req.method} ${req.originalUrl} — Origin: ${req.headers.origin}`);
        return res.status(403).json({ error: 'Not allowed by CORS' });
    }
    logger.error(`Unhandled error on ${req.method} ${req.originalUrl}: ${err && err.stack ? err.stack : err}`);
    res.status(500).json({ error: isProduction ? 'Internal Server Error' : (err && err.message) });
});

// Purge logs older than 30 days on startup
logger.rotateLogs(30);

const server = http.createServer(app);

// ── Real-time chat WebSocket endpoint ─────────────────────────────────────
// Two ways to authenticate a connection, mirroring the REST auth model:
//   - Client portal: ?token=<job.secureToken>            (no login — the link IS the credential)
//   - Staff:          ?jobId=<id>&auth=<jwt>              (must belong to the job's account)
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws, req) => {
    try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const portalToken = url.searchParams.get("token");
        const jobIdParam = url.searchParams.get("jobId");
        const authParam = url.searchParams.get("auth");

        let jobId = null;

        if (portalToken) {
            const job = db.prepare("SELECT id FROM jobs WHERE secureToken = ?").get(portalToken);
            if (!job) { ws.close(4004, "Invalid link"); return; }
            jobId = job.id;
            ws.role = "client";
        } else if (jobIdParam && authParam) {
            let decoded;
            try {
                decoded = jwt.verify(authParam, JWT_SECRET);
            } catch (e) {
                ws.close(4001, "Unauthorized");
                return;
            }
            const job = db.prepare("SELECT id FROM jobs WHERE id = ? AND account_id = ?").get(jobIdParam, decoded.account_id);
            if (!job) { ws.close(4003, "Forbidden"); return; }
            jobId = job.id;
            ws.role = "staff";
        } else {
            ws.close(4000, "Missing credentials");
            return;
        }

        ws.jobId = jobId;
        ws.isAlive = true;
        subscribeToJob(jobId, ws);

        ws.on("pong", () => { ws.isAlive = true; });
        ws.on("close", () => unsubscribeFromJob(jobId, ws));
        ws.on("error", () => unsubscribeFromJob(jobId, ws));
    } catch (e) {
        try { ws.close(1011, "Server error"); } catch (_) { /* noop */ }
    }
});

// Drop dead connections (e.g. laptop sleep, dropped wifi) every 30s
const wsHeartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            unsubscribeFromJob(ws.jobId, ws);
            return ws.terminate();
        }
        ws.isAlive = false;
        ws.ping();
    });
}, 30000);
wss.on("close", () => clearInterval(wsHeartbeat));

server.listen(PORT, '0.0.0.0', () => {
    logger.info(`Backend server running on port ${PORT} in ${isProduction ? 'production' : 'development'} mode (HTTP + WS)`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use.`);
        process.exit(1);
    } else {
        logger.error(`Server error: ${err.message}`);
    }
});
