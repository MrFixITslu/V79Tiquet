/**
 * server/oauth.js — Google & Apple OAuth route handlers
 *
 * Google flow (popup / ID-token):
 *   Frontend (@react-oauth/google) → credential (ID token)
 *   → POST /api/auth/google { credential }
 *   → verify with google-auth-library
 *   → return { token, user }
 *
 * Apple flow (redirect):
 *   Frontend (Apple JS SDK) → Apple auth page → POST /api/auth/apple/callback
 *   → verify identity token with apple-signin-auth
 *   → redirect to frontend: /?oauth_token=<jwt>&oauth_name=<name>
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID          — from Google Cloud Console (OAuth 2.0 Web client)
 *   APPLE_CLIENT_ID           — Apple Service ID (e.g. com.yourcompany.tickit.web)
 *   APPLE_TEAM_ID             — Apple Developer Team ID (10-char string)
 *   APPLE_KEY_ID              — Key ID of the Sign in with Apple private key
 *   APPLE_PRIVATE_KEY         — Contents of the .p8 file (newlines as \n)
 *   APP_BASE_URL              — e.g. https://your-domain.com
 */

import jwt           from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import appleSignin   from 'apple-signin-auth';
import { v4 as uuidv4 } from 'uuid';
import db            from './db.js';
import { seedDefaultTemplatesForAccount } from './db.js';
import { logger }    from './logger.js';

const APPLE_ID       = process.env.APPLE_CLIENT_ID;
const FACEBOOK_ID    = process.env.FACEBOOK_APP_ID;
const FACEBOOK_SECRET= process.env.FACEBOOK_APP_SECRET;
const APP_BASE_URL   = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

function getGoogleClientId() {
    return (process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '').trim();
}

function getGoogleClient() {
    const id = getGoogleClientId();
    return id ? new OAuth2Client(id) : null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Sanitise a plain string — strip leading/trailing whitespace, limit length.
 */
function safeStr(val, max = 255) {
    return String(val ?? '').trim().slice(0, max);
}

/**
 * Find an existing user by OAuth identity or email.
 * If no user is found, auto-create a new account + Admin user.
 *
 * @returns {object} users row
 */
async function findOrCreateOAuthUser(provider, oauthId, email, displayName) {
    const safeProvider = safeStr(provider, 20);
    const safeOauthId  = safeStr(oauthId,  255);
    const safeEmail    = safeStr(email,     254).toLowerCase();
    const safeName     = safeStr(displayName, 100) || safeEmail.split('@')[0];

    // 1 — Match by existing OAuth identity (returning user)
    const byOauth = await db
        .prepare("SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?")
        .get(safeProvider, safeOauthId);
    if (byOauth) return byOauth;

    // 2 — Match by email: link OAuth to an existing password account
    const byEmail = await db.prepare("SELECT * FROM users WHERE email = ?").get(safeEmail);
    if (byEmail) {
        await db.prepare("UPDATE users SET oauth_provider = ?, oauth_id = ? WHERE id = ?")
          .run(safeProvider, safeOauthId, byEmail.id);
        return { ...byEmail, oauth_provider: safeProvider, oauth_id: safeOauthId };
    }

    // 3 — New user: auto-create an isolated tenant account
    const accountId   = uuidv4();
    const userId      = uuidv4();
    const companyName = `${safeName}'s Workspace`;
    const now         = new Date().toISOString();

    await db.prepare("INSERT INTO accounts (id, name, createdAt) VALUES (?, ?, ?)")
      .run(accountId, companyName, now);
    await db.prepare(
        "INSERT INTO users (id, name, email, role, oauth_provider, oauth_id, account_id, failed_login_attempts) " +
        "VALUES (?, ?, ?, 'Admin', ?, ?, ?, 0)"
    ).run(userId, safeName, safeEmail, safeProvider, safeOauthId, accountId);
    await db.prepare("INSERT INTO settings (id, name, email, account_id) VALUES (?, ?, ?, ?)")
      .run(uuidv4(), companyName, safeEmail, accountId);

    await seedDefaultTemplatesForAccount(accountId);

    logger.audit('oauth_user_created', { provider: safeProvider, userId, email: safeEmail, accountId });
    return await db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

/**
 * Check account suspension, mint a JWT, return the standard auth payload.
 */
async function buildAuthResponse(user, jwtSecret) {
    const account = await db.prepare("SELECT status FROM accounts WHERE id = ?").get(user.account_id);
    if (account?.status === 'suspended') {
        return { suspended: true };
    }
    const token = jwt.sign(
        { id: user.id, email: user.email, account_id: user.account_id },
        jwtSecret,
        { expiresIn: '8h' }
    );
    return {
        suspended: false,
        token,
        user: {
            id:         user.id,
            name:       user.name,
            email:      user.email,
            role:       user.role,
            account_id: user.account_id,
        },
    };
}

// ── Route Registration ────────────────────────────────────────────────────────

// `jwtSecret` MUST be the same secret index.js's `authenticateToken` verifies
// against. Previously this module resolved its own JWT_SECRET independently
// (`process.env.JWT_SECRET || 'dev_jwt_secret_v79_tickit'`), which only
// matched index.js's secret when JWT_SECRET was explicitly set in the
// environment. If it was left unset in production, index.js generates and
// persists a strong random secret (see loadOrCreatePersistedSecret) while
// this file silently fell back to the hardcoded dev string — so tokens
// issued via Google/Apple/Facebook login would be signed with a different,
// publicly-known secret than the one verifying them: OAuth logins would
// fail signature verification, and (worse) anyone could forge a valid OAuth
// session token using the well-known default string. Passing the resolved
// secret in from index.js closes both problems.
export function registerOAuthRoutes(app, jwtSecret) {

    // ── Google ────────────────────────────────────────────────────────────────
    /**
     * POST /api/auth/google
     * Body: { credential: "<Google ID token from @react-oauth/google>" }
     * Returns: { token, user }
     */
    app.post('/api/auth/google', async (req, res) => {
        const credential = safeStr(req.body?.credential, 8192);
        if (!credential) return res.status(400).json({ error: 'Missing credential' });

        const activeGoogleId = getGoogleClientId();
        const client = getGoogleClient();
        if (!activeGoogleId || !client) {
            return res.status(503).json({
                error: 'Google login is not configured on this server. Please configure GOOGLE_CLIENT_ID in your environment.'
            });
        }

        try {
            const ticket = await client.verifyIdToken({
                idToken:  credential,
                audience: activeGoogleId,
            });
            const payload = ticket.getPayload();
            const { sub: googleId, email, name, email_verified, picture } = payload || {};

            if (!email_verified) {
                return res.status(400).json({ error: 'Your Google email address is not verified' });
            }
            if (!email) {
                return res.status(400).json({ error: 'No email address returned from Google' });
            }

            const user   = await findOrCreateOAuthUser('google', googleId, email, name);
            const result = await buildAuthResponse(user, jwtSecret);

            if (result.suspended) {
                return res.status(402).json({ error: 'ACCOUNT_SUSPENDED', message: 'Account suspended. Contact support.' });
            }

            logger.audit('oauth_login', { provider: 'google', userId: user.id });
            res.json({
                token: result.token,
                user: {
                    ...result.user,
                    photoUrl: picture || null,
                }
            });

        } catch (err) {
            logger.error('Google OAuth verification failed', { error: err.message });
            res.status(401).json({ error: 'Invalid or expired Google credential' });
        }
    });

    // ── Apple — callback (receives form POST from Apple) ──────────────────────
    /**
     * POST /api/auth/apple/callback
     *
     * Apple POSTs here after user authenticates. Fields:
     *   id_token  — JWT identity token (always present)
     *   code      — authorization code (always present)
     *   user      — JSON string with name/email (FIRST login only)
     *   state     — echoed state parameter
     *
     * After verification we redirect the browser to:
     *   APP_BASE_URL/?oauth_token=<jwt>   (success)
     *   APP_BASE_URL/?oauth_error=<code>  (failure)
     */
    app.post('/api/auth/apple/callback', async (req, res) => {
        const id_token  = safeStr(req.body?.id_token  ?? '', 8192);
        const userParam = safeStr(req.body?.user      ?? '', 1024);

        if (!id_token) {
            return res.redirect(`${APP_BASE_URL}/?oauth_error=missing_token`);
        }
        if (!APPLE_ID) {
            return res.redirect(`${APP_BASE_URL}/?oauth_error=not_configured`);
        }

        try {
            const applePayload = await appleSignin.verifyIdToken(id_token, {
                audience:         APPLE_ID,
                ignoreExpiration: false,
            });

            const { sub: appleId, email } = applePayload;

            // Apple only provides name on the VERY FIRST sign-in
            let displayName = '';
            if (userParam) {
                try {
                    const parsed = JSON.parse(userParam);
                    const fn = safeStr(parsed?.name?.firstName ?? '');
                    const ln = safeStr(parsed?.name?.lastName  ?? '');
                    displayName = [fn, ln].filter(Boolean).join(' ');
                } catch { /* ignore parse errors */ }
            }

            // Apple private relay: sub@privaterelay.appleid.com as fallback
            const resolvedEmail = email || `${appleId}@privaterelay.appleid.com`;

            const user   = await findOrCreateOAuthUser('apple', appleId, resolvedEmail, displayName);
            const result = await buildAuthResponse(user, jwtSecret);

            if (result.suspended) {
                return res.redirect(`${APP_BASE_URL}/?oauth_error=suspended`);
            }

            logger.audit('oauth_login', { provider: 'apple', userId: user.id });

            // Redirect to SPA with JWT — the React app reads ?oauth_token on mount
            const params = new URLSearchParams({
                oauth_token: result.token,
                oauth_name:  result.user.name,
            });
            res.redirect(`${APP_BASE_URL}/?${params.toString()}`);

        } catch (err) {
            logger.error('Apple OAuth verification failed', { error: err.message });
            res.redirect(`${APP_BASE_URL}/?oauth_error=invalid_token`);
        }
    });

    // ── Apple — config endpoint (frontend reads this to initialise the SDK) ───
    /**
     * GET /api/auth/apple/config
     * Returns the Apple OAuth params the frontend needs.
     * clientId and redirectUri are public-safe.
     */
    app.get('/api/auth/apple/config', (_req, res) => {
        res.json({
            clientId:    APPLE_ID   || null,
            redirectUri: `${APP_BASE_URL}/api/auth/apple/callback`,
            scope:       'name email',
            configured:  !!APPLE_ID,
        });
    });

    // ── Google — config endpoint (frontend reads GOOGLE_CLIENT_ID) ────────────
    /**
     * GET /api/auth/google/config
     * Returns the Google Client ID (safe to expose publicly).
     */
    app.get('/api/auth/google/config', (_req, res) => {
        const activeGoogleId = getGoogleClientId();
        res.json({
            clientId:   activeGoogleId || null,
            configured: !!activeGoogleId,
            domain:     'tiquet.v79sl.com',
        });
    });

    // ── Facebook — callback ───────────────────────────────────────────────────
    /**
     * POST /api/auth/facebook
     * Body: { accessToken: "<Facebook access token>" }
     * Returns: { token, user }
     */
    app.post('/api/auth/facebook', async (req, res) => {
        const accessToken = safeStr(req.body?.accessToken, 8192);
        if (!accessToken) return res.status(400).json({ error: 'Missing access token' });

        if (!FACEBOOK_ID) {
            return res.status(503).json({ error: 'Facebook login is not configured on this server' });
        }

        try {
            // Verify token and get user info from Facebook Graph API
            const fbRes = await fetch(`https://graph.facebook.com/me?fields=id,name,email&access_token=${accessToken}`);
            const fbData = await fbRes.json();
            
            if (fbData.error) {
                return res.status(401).json({ error: 'Invalid or expired Facebook credential' });
            }

            const { id: fbId, email, name } = fbData;
            
            if (!email) {
                return res.status(400).json({ error: 'No email address returned from Facebook' });
            }

            const user   = await findOrCreateOAuthUser('facebook', fbId, email, name);
            const result = await buildAuthResponse(user, jwtSecret);

            if (result.suspended) {
                return res.status(402).json({ error: 'ACCOUNT_SUSPENDED', message: 'Account suspended. Contact support.' });
            }

            logger.audit('oauth_login', { provider: 'facebook', userId: user.id });
            res.json({ token: result.token, user: result.user });

        } catch (err) {
            logger.error('Facebook OAuth verification failed', { error: err.message });
            res.status(500).json({ error: 'Failed to verify Facebook login' });
        }
    });

    // ── Facebook — config endpoint ────────────────────────────────────────────
    /**
     * GET /api/auth/facebook/config
     */
    app.get('/api/auth/facebook/config', (_req, res) => {
        res.json({
            appId:      FACEBOOK_ID || null,
            configured: !!FACEBOOK_ID,
        });
    });
}
