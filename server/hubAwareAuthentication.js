import { hubManagedMapping } from "./hubManagedLink.js";

// The same production Tiquet authentication middleware, dependency-injected
// for staging JWT and signed entitlement integration testing.
export function createTiquetAuthentication({ jwt, jwtSecret, db, checkHubSubscription = null }) {
  return function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    const sessionCookie = (req.headers.cookie || "").split(";").map(x => x.trim())
      .find(x => x.startsWith("tiquet_session="));
    let cookieToken = null;
    try {
      cookieToken = sessionCookie ? decodeURIComponent(sessionCookie.slice("tiquet_session=".length)) : null;
    } catch {
      return res.status(401).json({ error: "Invalid session cookie" });
    }
    const token = bearer || cookieToken;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    jwt.verify(token, jwtSecret, async (err, user) => {
      if (err || !user?.id || !user?.account_id) {
        return res.status(403).json({ error: "Forbidden" });
      }
      try {
        const liveUser = await db.prepare(
          "SELECT id, hub_user_id FROM users WHERE id = ? AND account_id = ?"
        ).get(user.id, user.account_id);
        if (!liveUser) return res.status(401).json({ error: "Unauthorized" });
        const account = await db.prepare(
          "SELECT status, hub_organization_id FROM accounts WHERE id = ?"
        ).get(user.account_id);
        if (!account) return res.status(401).json({ error: "Account no longer exists" });
        if (account.status === "suspended") return res.status(402).json({
          error: "ACCOUNT_SUSPENDED",
          message: "This account has been suspended. Please contact support.",
        });
        if (checkHubSubscription) {
          const mapping = hubManagedMapping({
            accountOrganizationId: account.hub_organization_id,
            linkedUserId: liveUser.hub_user_id,
            tokenOrganizationId: user.hub_organization_id,
            tokenHubManaged: user.hub_managed,
          });
          // Enforcing subscriptions must not silently exempt an existing local
          // login with no Hub linkage. Staff migrate through Hub at cutover.
          if (!mapping.managed) return res.status(403).json({
            error: "Sign in through V79 Hub to continue using Tiquet.",
            code: "HUB_IDENTITY_REQUIRED",
          });
          if (mapping.managed) {
            if (!mapping.valid) return res.status(403).json({
              error: "Hub account mapping is incomplete or inconsistent.",
              code: "HUB_ENTITLEMENT_MAPPING_INVALID",
            });
            const allowed = await checkHubSubscription({
              organizationId: account.hub_organization_id,
              scopedUserId: liveUser.hub_user_id,
            });
            if (!allowed) return res.status(403).json({
              error: "V79 Hub subscription is inactive or unavailable.",
              code: "HUB_ENTITLEMENT_REVOKED",
            });
          }
        }
        req.user = user;
        req.accountId = user.account_id;
        return next();
      } catch {
        return res.status(503).json({
          error: "Tiquet authentication or entitlement verification unavailable.",
          code: "AUTHENTICATION_UNAVAILABLE",
        });
      }
    });
  };
}
