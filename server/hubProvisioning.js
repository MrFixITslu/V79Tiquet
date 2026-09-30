import db, { seedDefaultTemplatesForAccount } from "./db.js";
import { v4 as uuidv4 } from "uuid";
import { resolveLegacyAccount, assertHubUserAccount } from "./legacyAccountLink.js";
import { tiquetAccessForHubRole } from "./hubTeamAccess.js";

export async function provisionHubIdentity(hubSession) {
  const now = new Date().toISOString();
  const hubOrgId = String(hubSession?.organization?.id || "").trim();
  const hubUserId = String(hubSession?.user?.id || "").trim();
  const organizationName = String(hubSession?.organization?.name || "").trim();
  const email = String(hubSession?.user?.email || "").trim().toLowerCase();
  const userName = String(hubSession?.user?.name || email.split("@")[0] || "").trim();
  const access = tiquetAccessForHubRole(hubSession?.role);
  const localRole = access.localRole;
  const permissionsJson = access.permissions ? JSON.stringify(access.permissions) : null;

  if (
    !/^[A-Za-z0-9._:@-]{8,180}$/.test(hubOrgId) ||
    !/^[A-Za-z0-9._:@-]{8,180}$/.test(hubUserId) ||
    !organizationName ||
    organizationName.length > 180 ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
    !userName ||
    userName.length > 180
  ) {
    throw new Error("Invalid V79 Hub Tiquet identity.");
  }

  let accountId;
  let userId;

  const tx = db.transaction(async txDb => {
    let account = await txDb.prepare(
      "SELECT id, name, hub_organization_id FROM accounts WHERE hub_organization_id = ? LIMIT 1"
    ).get(hubOrgId);

    if (!account && hubSession.role === "owner") {
      const candidates = await txDb.prepare(`
        SELECT DISTINCT a.id, a.name, a.hub_organization_id
        FROM users u
        JOIN accounts a ON a.id = u.account_id
        WHERE LOWER(u.email) = LOWER(?) AND u.role = 'Admin'
          AND a.hub_organization_id IS NULL
        LIMIT 2
      `).all(email);
      account = resolveLegacyAccount(candidates, hubOrgId);
      if (account) {
        await txDb.prepare("UPDATE accounts SET hub_organization_id = ? WHERE id = ?").run(hubOrgId, account.id);
      }
    }

    if (!account && hubSession.role !== "owner") {
      throw new Error("Tiquet workspace must be provisioned by its Hub owner before team access.");
    }

    if (!account) {
      accountId = uuidv4();
      await txDb.prepare(`
        INSERT INTO accounts (id, name, createdAt, status, plan, hub_organization_id)
        VALUES (?, ?, ?, 'active', ?, ?)
      `).run(accountId, organizationName, now, hubSession.plan || "hub", hubOrgId);
      await txDb.prepare("INSERT INTO settings (id, name, email, account_id) VALUES (?, ?, ?, ?)")
        .run(uuidv4(), organizationName, email, accountId);
    } else {
      accountId = account.id;
      await txDb.prepare("UPDATE accounts SET name = ?, status = 'active', plan = ?, hub_organization_id = ? WHERE id = ?")
        .run(organizationName, hubSession.plan || "hub", hubOrgId, accountId);
      const settings = await txDb.prepare("SELECT id FROM settings WHERE account_id = ? LIMIT 1").get(accountId);
      if (!settings) {
        await txDb.prepare("INSERT INTO settings (id, name, email, account_id) VALUES (?, ?, ?, ?)")
          .run(uuidv4(), organizationName, email, accountId);
      }
    }

    let user = await txDb.prepare("SELECT * FROM users WHERE hub_user_id = ? LIMIT 1").get(hubUserId);
    if (!user) {
      user = await txDb.prepare("SELECT * FROM users WHERE LOWER(email) = LOWER(?) AND account_id = ? LIMIT 1")
        .get(email, accountId);
    }
    assertHubUserAccount(user, accountId, hubUserId);

    if (!user) {
      userId = uuidv4();
      await txDb.prepare(`
        INSERT INTO users
          (id, name, email, role, password_hash, oauth_provider, oauth_id, account_id, permissions, must_change_password, hub_user_id)
        VALUES (?, ?, ?, ?, NULL, 'v79-hub', ?, ?, ?, 0, ?)
      `).run(
        userId,
        userName,
        email,
        localRole,
        hubUserId,
        accountId,
        permissionsJson,
        hubUserId
      );
    } else {
      userId = user.id;
      await txDb.prepare(`
        UPDATE users
        SET name = ?, email = ?, role = ?, permissions = ?, account_id = ?, hub_user_id = ?, oauth_provider = 'v79-hub', oauth_id = ?
        WHERE id = ?
      `).run(userName, email, localRole, permissionsJson, accountId, hubUserId, hubUserId, userId);
    }
  });

  await tx();
  await seedDefaultTemplatesForAccount(accountId);
  return { accountId, userId, email, role: localRole, permissions: access.permissions, hubOrganizationId: hubOrgId, hubUserId };
}
