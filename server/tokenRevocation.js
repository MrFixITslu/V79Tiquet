import { createHash } from "node:crypto";

// Database-backed JWT revocation; shared by API middleware and staff WebSockets.
// Store only SHA-256 digests. Never log, persist or send the raw bearer/cookie.
export function tokenFingerprint(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function getRequestSessionTokens(req) {
  const tokens = [];
  const header = req.headers?.authorization || "";
  if (header.startsWith("Bearer ") && header.length > 7) tokens.push(header.slice(7));
  const rawCookie = (req.headers?.cookie || "").split(";").map(x => x.trim())
    .find(x => x.startsWith("tiquet_session="));
  if (rawCookie) {
    try {
      const cookieToken = decodeURIComponent(rawCookie.slice("tiquet_session=".length));
      if (cookieToken) tokens.push(cookieToken);
    } catch {
      // Malformed cookie is not a signed token; the logout handler clears it.
    }
  }
  return [...new Set(tokens)];
}

export async function isTokenFingerprintRevoked(db, fingerprint, nowSeconds = Math.floor(Date.now()/1000)) {
  if (!/^[a-f0-9]{64}$/.test(String(fingerprint || ""))) return true;
  const match = await db.prepare(
    "SELECT token_hash FROM revoked_auth_tokens WHERE token_hash = ? AND expires_at > ?"
  ).get(fingerprint, nowSeconds);
  return Boolean(match);
}

export async function isSignedSessionRevoked(db, token) {
  return isTokenFingerprintRevoked(db, tokenFingerprint(token));
}

// Called only from the explicit /api/auth/logout request.
// A verified token can belong to an older pre-jti session: fingerprint works
// without requiring a risky migration of existing user/account rows.
export async function revokeSignedRequestTokens({ req, jwt, jwtSecret, db }) {
  let revoked = 0;
  for (const token of getRequestSessionTokens(req)) {
    let claims;
    try { claims = jwt.verify(token, jwtSecret); }
    catch { continue; } // Never persist invalid or expired tokens.
    if (!claims?.id || !claims?.account_id ||
        !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(Date.now()/1000)) continue;
    await db.prepare(
      "INSERT INTO revoked_auth_tokens(token_hash, account_id, expires_at) VALUES (?, ?, ?) ON CONFLICT (token_hash) DO NOTHING"
    ).run(tokenFingerprint(token), String(claims.account_id), claims.exp);
    revoked++;
  }
  if (revoked) {
    // Expired digests are no longer relevant. Failure of optional pruning must
    // not turn a successfully revoked session back into an ambiguous logout.
    try {
      await db.prepare("DELETE FROM revoked_auth_tokens WHERE expires_at <= ?")
        .run(Math.floor(Date.now()/1000));
    } catch { /* safe to prune on a later logout */ }
  }
  return revoked;
}
