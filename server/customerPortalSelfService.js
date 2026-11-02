/**
 * Phase 4: internal customer registration and ticket self-service candidate.
 * Zero staff identity reuse. One owner-configured tenant; public feature OFF by default.
 * Database migration is explicit and separate. Not a live release.
 */
import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';

export const PORTAL_COOKIE = 'tiquet_customer_session';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const EMAIL_PATTERN = /^[^\s@<>]{1,64}@[^\s@<>]{1,190}$/;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i;
const IDEMPOTENCY_PATTERN = /^[a-zA-Z0-9_-]{16,128}$/;

export function portalHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
export function portalToken() {
  return crypto.randomBytes(32).toString('hex');
}
export function normalizeCustomerEmail(value) {
  if (typeof value !== 'string') return null;
  const result = value.trim().toLowerCase();
  return result.length <= 254 && EMAIL_PATTERN.test(result) ? result : null;
}
export function safePortalName(value) {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  return name.length >= 2 && name.length <= 100 && !/[<>\x00-\x1f]/.test(name) ? name : null;
}
export function safeTicketText(value, max) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length >= 3 && text.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text) ? text : null;
}
export function portalOriginAllowed(origin, expectedOrigin) {
  if (!origin || !expectedOrigin) return false;
  try {
    const given = new URL(origin), expected = new URL(expectedOrigin);
    return given.origin === expected.origin && given.username === '' && given.password === '';
  } catch {
    return false;
  }
}
function parseCustomerCookie(header) {
  const matching = String(header || '').split(';').map((x) => x.trim())
    .find((x) => x.startsWith(PORTAL_COOKIE + '='));
  const value = matching?.slice(PORTAL_COOKIE.length + 1);
  return value && TOKEN_PATTERN.test(value) ? value : null;
}
function cookieValue(token, secure = true) {
  return [
    PORTAL_COOKIE + '=' + token, 'Path=/api/customer', 'HttpOnly',
    'SameSite=Strict', secure ? 'Secure' : '', 'Max-Age=' + SESSION_TTL_SECONDS
  ].filter(Boolean).join('; ');
}
function cookieClear(secure = true) {
  return [
    PORTAL_COOKIE + '=', 'Path=/api/customer', 'HttpOnly', 'SameSite=Strict',
    secure ? 'Secure' : '', 'Max-Age=0'
  ].filter(Boolean).join('; ');
}

export function createCustomerPortalRouter({
  db, sendEmail, accountId, publicUrl, production = true, log = () => {}
}) {
  if (!db || typeof db.query !== 'function' || typeof db.transaction !== 'function') {
    throw new Error('Customer portal requires an initialized scoped database');
  }
  if (!accountId || !/^[a-zA-Z0-9_-]{8,128}$/.test(accountId)) {
    throw new Error('Customer portal needs an explicit V79_CUSTOMER_PORTAL_ACCOUNT_ID');
  }
  const site = new URL(publicUrl);
  if (production && (site.protocol !== 'https:' || !site.hostname.endsWith('.v79sl.com'))) {
    throw new Error('Customer portal URL must be approved HTTPS subdomain');
  }
  if (typeof sendEmail !== 'function') throw new Error('Email adapter required');
  const router = express.Router();
  const response = { message: 'If eligible, you will receive a verification email.' };
  const signupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: production ? 5 : 100,
    standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'Too many requests; please try again later' }) });
  const ticketLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: production ? 10 : 100,
    standardHeaders: 'draft-7', legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: 'Too many requests; please try again later' }) });
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
        !portalOriginAllowed(req.get('origin'), site.origin)) {
      return res.status(403).json({ error: 'Origin validation failed' });
    }
    next();
  });

  router.post('/register', signupLimiter, async (req, res) => {
    const name = safePortalName(req.body?.name);
    const email = normalizeCustomerEmail(req.body?.email);
    if (!name || !email || typeof req.body?.consent !== 'boolean' || !req.body.consent) {
      return res.status(400).json({ error: 'Name, valid email and service consent required' });
    }
    try {
      const token = portalToken(), hash = portalHash(token);
      const saved = await db.query(
        `INSERT INTO customer_portal_identities
          (id, account_id, email, full_name, token_hash, token_expires_at, token_sent_at)
        SELECT $1, a.id, $2, $3, $4, now() + interval '30 minutes', now()
          FROM accounts a WHERE a.id=$5 AND a.status='active'
        ON CONFLICT (account_id, email) DO UPDATE SET
          token_hash=EXCLUDED.token_hash, token_expires_at=EXCLUDED.token_expires_at,
          token_sent_at=now(), full_name=EXCLUDED.full_name
        WHERE customer_portal_identities.verified_at IS NULL
          AND customer_portal_identities.token_sent_at < now() - interval '10 minutes'
        RETURNING id`,
        [crypto.randomUUID(), email, name, hash, accountId]
      );
      if (saved.rowCount) {
        const url = new URL('/customer/verify', site);
        url.searchParams.set('token', token);
        const html = `<p>Verify your Tiquet customer account using this one-time link:</p><p><a href="${url.toString()}">Verify email</a></p><p>This link expires in 30 minutes. No appointment or payment has been made.</p>`;
        const sent = await sendEmail(email, 'Verify your Tiquet customer account', html);
        if (!sent?.success || sent?.skipped) log('customer-portal-email-delivery-unconfirmed');
      }
      return res.status(202).json(response);
    } catch {
      log('customer-portal-registration-error');
      return res.status(503).json({ error: 'Registration temporarily unavailable' });
    }
  });

  router.post('/verify', signupLimiter, async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
      return res.status(400).json({ error: 'Invalid verification link' });
    }
    try {
      const sessionToken = portalToken();
      const result = await db.transaction(async (tx) => {
        const selected = await tx.query(
          `SELECT * FROM customer_portal_identities
           WHERE token_hash=$1 AND account_id=$2 AND verified_at IS NULL
             AND token_expires_at>now() FOR UPDATE`, [portalHash(token), accountId]
        );
        const identity = selected.rows[0];
        if (!identity) return null;
        const eligible = await tx.query("SELECT id FROM accounts WHERE id=$1 AND status='active'", [accountId]);
        if (!eligible.rowCount) return null;
        let clientId = identity.client_id;
        if (!clientId) {
          const matched = await tx.query(
            "SELECT id FROM clients WHERE account_id=$1 AND lower(email)=$2 ORDER BY createdat LIMIT 1",
            [accountId, identity.email]
          );
          clientId = matched.rows[0]?.id;
        }
        if (!clientId) {
          clientId = crypto.randomUUID();
          await tx.query(
            `INSERT INTO clients (id,account_id,name,email,createdat,newsletteroptin,leadsource,leadstatus)
             VALUES ($1,$2,$3,$4,$5,0,'customer_portal','new')`,
            [clientId, accountId, identity.full_name, identity.email, new Date().toISOString()]
          );
        }
        await tx.query(
          `UPDATE customer_portal_identities SET verified_at=now(), client_id=$1,
             token_hash=NULL, token_expires_at=NULL WHERE id=$2 AND account_id=$3`,
          [clientId, identity.id, accountId]
        );
        await tx.query(
          `INSERT INTO customer_portal_sessions (token_hash,identity_id,account_id,expires_at)
           VALUES ($1,$2,$3,now() + interval '8 hours')`,
          [portalHash(sessionToken), identity.id, accountId]
        );
        return { name: identity.full_name, email: identity.email };
      })();
      if (!result) return res.status(400).json({ error: 'Verification link expired or already used' });
      res.set('Set-Cookie', cookieValue(sessionToken, production));
      // Welcome email is one-time after verification; never a pre-verification customer invite.
      try {
        const welcome = await sendEmail(result.email, 'Welcome to Tiquet customer service',
          '<p>Welcome to your customer portal. You can now submit service requests and follow their progress.</p><p>Requests are not confirmed appointments or charges.</p>');
        if (!welcome?.success || welcome?.skipped) log('customer-portal-welcome-unconfirmed');
      } catch { log('customer-portal-welcome-unconfirmed'); }
      // Not privileged: successfully verified address is sufficient for customer-only scope.
      return res.json({ verified: true, customer: result });
    } catch {
      log('customer-portal-verification-error');
      return res.status(503).json({ error: 'Verification temporarily unavailable' });
    }
  });

  // Returning customers use emailed one-time links, not staff passwords or Hub tokens.
  router.post('/request-login', signupLimiter, async (req, res) => {
    const email = normalizeCustomerEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: 'Valid email required' });
    try {
      const token = portalToken();
      const selected = await db.query(
        `UPDATE customer_portal_identities SET login_token_hash=$1,
           login_expires_at=now() + interval '15 minutes', login_sent_at=now()
         WHERE account_id=$2 AND email=$3 AND verified_at IS NOT NULL
           AND (login_sent_at IS NULL OR login_sent_at < now() - interval '10 minutes')
           AND EXISTS(SELECT 1 FROM accounts WHERE id=$2 AND status='active')
         RETURNING id`,
        [portalHash(token), accountId, email]
      );
      if (selected.rowCount) {
        const link = new URL('/customer/login', site);
        link.searchParams.set('token', token);
        const html = `<p>Use this single-use link to sign in to your Tiquet customer portal:</p>
          <p><a href="${link.toString()}">Sign in</a></p>
          <p>This link expires in 15 minutes. If you did not request it, ignore this email.</p>`;
        const sent = await sendEmail(email, 'Your Tiquet customer sign-in link', html);
        if (!sent?.success || sent?.skipped) log('customer-portal-login-email-unconfirmed');
      }
      return res.status(202).json(response);
    } catch {
      log('customer-portal-login-request-error');
      return res.status(503).json({ error: 'Sign-in temporarily unavailable' });
    }
  });
  router.post('/login', signupLimiter, async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) {
      return res.status(400).json({ error: 'Invalid sign-in link' });
    }
    try {
      const sessionToken = portalToken();
      const result = await db.transaction(async (tx) => {
        const found = await tx.query(
          `SELECT i.id, i.email, i.full_name, i.client_id FROM customer_portal_identities i
           JOIN accounts a ON a.id=i.account_id AND a.status='active'
           WHERE i.account_id=$1 AND i.login_token_hash=$2
             AND i.verified_at IS NOT NULL AND i.client_id IS NOT NULL
             AND i.login_expires_at>now() FOR UPDATE OF i`,
          [accountId, portalHash(token)]
        );
        const identity = found.rows[0];
        if (!identity) return null;
        await tx.query(
          `UPDATE customer_portal_identities SET login_token_hash=NULL,
            login_expires_at=NULL WHERE id=$1 AND account_id=$2`, [identity.id, accountId]
        );
        await tx.query(
          `INSERT INTO customer_portal_sessions (token_hash,identity_id,account_id,expires_at)
           VALUES ($1,$2,$3,now() + interval '8 hours')`,
          [portalHash(sessionToken), identity.id, accountId]
        );
        return { name: identity.full_name, email: identity.email };
      })();
      if (!result) return res.status(400).json({ error: 'Sign-in link expired or already used' });
      res.set('Set-Cookie', cookieValue(sessionToken, production));
      return res.json({ customer: result });
    } catch {
      log('customer-portal-login-error');
      return res.status(503).json({ error: 'Sign-in temporarily unavailable' });
    }
  });

  const requireCustomer = async (req, res, next) => {
    const token = parseCustomerCookie(req.headers.cookie);
    if (!token) return res.status(401).json({ error: 'Customer sign-in required' });
    try {
      const result = await db.query(
        `SELECT i.id, i.account_id, i.client_id, i.email, i.full_name
         FROM customer_portal_sessions s
         JOIN customer_portal_identities i ON i.id=s.identity_id AND i.account_id=s.account_id
         JOIN accounts a ON a.id=i.account_id AND a.status='active'
         WHERE s.token_hash=$1 AND s.account_id=$2 AND s.expires_at>now()
          AND i.verified_at IS NOT NULL AND i.client_id IS NOT NULL LIMIT 1`,
        [portalHash(token), accountId]
      );
      if (!result.rows[0]) return res.status(401).json({ error: 'Session expired' });
      req.customerPortal = { ...result.rows[0], sessionHash: portalHash(token) };
      return next();
    } catch {
      log('customer-portal-session-error');
      return res.status(503).json({ error: 'Customer session unavailable' });
    }
  };
  router.get('/me', requireCustomer, (req, res) => {
    const { full_name: name, email } = req.customerPortal;
    return res.json({ customer: { name, email } });
  });
  router.post('/logout', requireCustomer, async (req, res) => {
    try {
      await db.query('DELETE FROM customer_portal_sessions WHERE token_hash=$1 AND account_id=$2',
        [req.customerPortal.sessionHash, accountId]);
      res.set('Set-Cookie', cookieClear(production));
      return res.json({ success: true });
    } catch {
      return res.status(503).json({ error: 'Could not revoke customer session' });
    }
  });
  router.get('/tickets', requireCustomer, async (req, res) => {
    const owner = req.customerPortal;
    try {
      const rows = await db.query(
        `SELECT id,title,description,status,createdat
         FROM jobs WHERE account_id=$1 AND clientid=$2 ORDER BY createdat DESC LIMIT 100`,
        [owner.account_id, owner.client_id]
      );
      return res.json({ tickets: rows.rows });
    } catch {
      return res.status(503).json({ error: 'Tickets temporarily unavailable' });
    }
  });
  router.get('/tickets/:id', requireCustomer, async (req, res) => {
    const owner = req.customerPortal;
    if (!/^[a-f0-9-]{36}$/i.test(req.params.id)) return res.status(404).json({ error: 'Ticket not found' });
    try {
      const rows = await db.query(
        `SELECT id,title,description,status,createdat FROM jobs
         WHERE id=$1 AND account_id=$2 AND clientid=$3`,
        [req.params.id, owner.account_id, owner.client_id]
      );
      return rows.rows[0] ? res.json({ ticket: rows.rows[0] }) : res.status(404).json({ error: 'Ticket not found' });
    } catch {
      return res.status(503).json({ error: 'Tickets temporarily unavailable' });
    }
  });
  router.post('/tickets', ticketLimiter, requireCustomer, async (req, res) => {
    const title = safeTicketText(req.body?.title, 140);
    const description = safeTicketText(req.body?.description, 4000);
    const key = req.get('idempotency-key');
    if (!title || !description || !IDEMPOTENCY_PATTERN.test(key || '')) {
      return res.status(400).json({ error: 'Title, description and idempotency key required' });
    }
    const owner = req.customerPortal;
    try {
      const receipt = 'portal:' + portalHash(owner.id + ':' + key);
      const ticketId = crypto.randomUUID();
      await db.query(
        `INSERT INTO jobs (id,title,description,status,createdat,priority,client,clientemail,clientid,account_id,intakeeventid)
         VALUES ($1,$2,$3,'request',$4,'medium',$5,$6,$7,$8,$9)
         ON CONFLICT DO NOTHING`,
        [ticketId, title, description, new Date().toISOString(), owner.full_name,
         owner.email, owner.client_id, owner.account_id, receipt]
      );
      const existing = await db.query(
        `SELECT id,title,status,createdat FROM jobs
         WHERE account_id=$1 AND clientid=$2 AND intakeeventid=$3`,
        [owner.account_id, owner.client_id, receipt]
      );
      if (!existing.rows[0]) return res.status(409).json({ error: 'Ticket could not be saved' });
      return res.status(201).json({ ticket: existing.rows[0], scheduled: false });
    } catch {
      log('customer-portal-ticket-error');
      return res.status(503).json({ error: 'Ticket request temporarily unavailable' });
    }
  });
  return router;
}
