import { hubManagedMapping } from "./hubManagedLink.js";

// Authenticate each staff WebSocket beyond its initial JWT/job check.
// Customer portal links follow separate secureToken access rules.
export async function authorizeTiquetStaffSocket({ decoded, db, checkHubSubscription }) {
  const deny = { allowed: false };
  if (!decoded?.id || !decoded?.account_id ||
      !Number.isFinite(Number(decoded.exp)) || Number(decoded.exp) <= Date.now()/1000) return deny;
  try {
    const user = await db.prepare(
      "SELECT id, hub_user_id FROM users WHERE id = ? AND account_id = ?"
    ).get(decoded.id, decoded.account_id);
    if (!user) return deny;
    const account = await db.prepare(
      "SELECT status, hub_organization_id FROM accounts WHERE id = ?"
    ).get(decoded.account_id);
    if (!account || account.status !== "active") return deny;
    const link = hubManagedMapping({
      accountOrganizationId: account.hub_organization_id,
      linkedUserId: user.hub_user_id,
      tokenOrganizationId: decoded.hub_organization_id,
      tokenHubManaged: decoded.hub_managed,
    });
    let hubIdentity = null;
    if (checkHubSubscription && link.managed) {
      if (!link.valid) return deny;
      hubIdentity = {
        organizationId: account.hub_organization_id,
        scopedUserId: user.hub_user_id,
      };
      if (!(await checkHubSubscription(hubIdentity))) return deny;
    }
    return {
      allowed: true,
      hubIdentity,
      jwtExpiresAt: Number(decoded.exp) * 1000,
    };
  } catch { return deny; }
}

export async function revalidateTiquetStaffSocket(socket, checkHubSubscription, now = Date.now()) {
  if (socket.role !== "staff") return true;
  if (!Number.isFinite(socket.jwtExpiresAt) || now >= socket.jwtExpiresAt) return false;
  if (!checkHubSubscription || !socket.hubIdentity) return true;
  try { return await checkHubSubscription(socket.hubIdentity) === true; }
  catch { return false; }
}
