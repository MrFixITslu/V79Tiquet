import express from "express";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { signTiquetReadOnlyMetrics } from "./sourceEvidenceSigner.js";
import db from "./db.js";
import { provisionHubIdentity } from "./hubProvisioning.js";
import { hubTeamRoles } from "./hubTeamAccess.js";

const router = express.Router();
const MAX_SKEW_MS = 5 * 60 * 1000;

function canonicalMessage(req, timestamp) {
  const pathname = new URL(req.originalUrl, "http://v79.internal").pathname;
  const body = ["GET", "HEAD"].includes(req.method.toUpperCase())
    ? ""
    : (req.rawBody?.toString("utf8") || JSON.stringify(req.body ?? {}));
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  return [req.method.toUpperCase(), pathname, String(timestamp), bodyHash].join("\n");
}

function safeEqualHex(a, b) {
  try {
    const left = Buffer.from(String(a), "hex");
    const right = Buffer.from(String(b), "hex");
    return left.length === right.length && crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function verifyPlatformRequest(req, res, next) {
  const secret = String(process.env.V79_PLATFORM_SHARED_SECRET || "");
  const timestamp = req.get("x-v79-timestamp");
  const signature = req.get("x-v79-signature");
  const serviceId = req.get("x-v79-service-id");

  if (secret.length < 32) {
    return res.status(503).json({ error: "V79 platform integration is not configured." });
  }
  if (serviceId !== "v79-hub" || !timestamp || !signature) {
    return res.status(401).json({ error: "Invalid V79 platform credentials." });
  }

  const when = Number(timestamp);
  if (!Number.isFinite(when) || Math.abs(Date.now() - when) > MAX_SKEW_MS) {
    return res.status(401).json({ error: "Expired V79 platform request." });
  }

  const expected = crypto
    .createHmac("sha256", secret)
    .update(canonicalMessage(req, timestamp))
    .digest("hex");

  if (!safeEqualHex(expected, signature)) {
    return res.status(401).json({ error: "Invalid V79 platform signature." });
  }
  next();
}

router.use(verifyPlatformRequest);

// Optional, strictly read-only Phase 2C evidence pilot. The platform request
// MUST first pass the existing Hub service HMAC middleware. Nothing is signed
// unless a distinct Ed25519 source private-key file is configured.
router.post("/evidence/signed", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (process.env.V79_TIQUET_SIGNED_EVIDENCE_ENABLED !== "1") {
    return res.status(404).json({ error: "Signed evidence is not enabled." });
  }
  const input = req.body;
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      Object.keys(input).sort().join("|") !== "organizationId|requestId") {
    return res.status(400).json({ error: "Invalid signed evidence request." });
  }
  const { organizationId, requestId } = input;
  if (typeof organizationId !== "string" || !/^[A-Za-z0-9_-]{6,96}$/.test(organizationId) ||
      typeof requestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return res.status(400).json({ error: "Invalid signed evidence subject." });
  }
  const keyFile = String(process.env.V79_TIQUET_EVIDENCE_SIGNING_KEY_FILE || "");
  if (!keyFile || !path.isAbsolute(keyFile)) {
    return res.status(503).json({ error: "Tiquet source signing key is not configured." });
  }
  try {
    const keyStat = fs.lstatSync(keyFile);
    // Refuse symlinks and group/world-readable signing keys. Keep the source
    // application's private signing key outside the repository and data DB.
    if (!keyStat.isFile() || (keyStat.mode & 0o077) !== 0 ||
        (typeof process.getuid === "function" && keyStat.uid !== process.getuid())) {
      return res.status(503).json({ error: "Tiquet source signing key permissions are unsafe." });
    }
    const account = await db.prepare(
      "SELECT id, status, hub_organization_id FROM accounts WHERE hub_organization_id = ? LIMIT 1"
    ).get(organizationId);
    if (!account || account.hub_organization_id !== organizationId) {
      return res.status(404).json({ error: "Hub-managed Tiquet workspace not found." });
    }
    if (account.status === "suspended") {
      return res.status(403).json({ error: "Suspended Tiquet workspace." });
    }
    const accountId = account.id;
    const [clients, jobs, members, unread, total] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM clients WHERE account_id = ?").get(accountId),
      db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE account_id = ?").get(accountId),
      db.prepare("SELECT COUNT(*) AS count FROM users WHERE account_id = ?").get(accountId),
      db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE account_id = ? AND isRead = 0").get(accountId),
      db.prepare("SELECT COALESCE(SUM(amount), 0) AS total FROM jobs WHERE account_id = ? AND amount IS NOT NULL").get(accountId),
    ]);
    const count = row => Number(row?.count);
    const metrics = {
      clients: count(clients), jobs: count(jobs), teamMembers: count(members),
      unreadNotifications: count(unread), jobValueTotal: Number(total?.total),
    };
    if (Object.values(metrics).some(value => !Number.isFinite(value))) {
      return res.status(503).json({ error: "Tiquet aggregate evidence is unavailable." });
    }
    const privateKeyPem = fs.readFileSync(keyFile, "utf8");
    const signed = signTiquetReadOnlyMetrics({ organizationId, requestId, metrics, privateKeyPem });
    return res.json({ ...signed, executionEnabled: false });
  } catch (error) {
    console.error("[platform] signed evidence unavailable:", error?.name || "Error");
    return res.status(503).json({ error: "Tiquet signed evidence could not be produced." });
  }
});

router.post("/provision", async (req, res) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const organization = body.organization && typeof body.organization === "object" && !Array.isArray(body.organization)
    ? body.organization : {};
  const user = body.user && typeof body.user === "object" && !Array.isArray(body.user) ? body.user : {};
  const organizationId = String(organization.id || "").trim();
  const organizationName = String(organization.name || "").trim();
  const organizationSlug = String(organization.slug || "").trim();
  const hubUserId = String(user.id || "").trim();
  const email = String(user.email || "").trim().toLowerCase();
  const name = String(user.name || email.split("@")[0] || "").trim();

  if (
    body.role !== "owner" ||
    !/^[A-Za-z0-9._:@-]{8,180}$/.test(organizationId) ||
    organizationName.length < 1 || organizationName.length > 180 ||
    !/^[a-z0-9][a-z0-9-]{0,99}$/.test(organizationSlug) ||
    !/^[A-Za-z0-9._:@-]{8,180}$/.test(hubUserId) ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
    name.length < 1 || name.length > 180
  ) {
    return res.status(400).json({ error: "Invalid Tiquet provisioning request." });
  }

  try {
    const local = await provisionHubIdentity({
      organization: { id: organizationId, name: organizationName, slug: organizationSlug },
      user: { id: hubUserId, email, name },
      role: "owner",
      plan: body.plan || "hub",
      entitlement: { product: "tiquet", enabled: true, access: "owner" },
    });

    if (local.hubOrganizationId !== organizationId || local.hubUserId !== hubUserId) {
      throw new Error("Tiquet provisioned identity mismatch.");
    }

    res.setHeader("Cache-Control", "no-store");
    return res.json({
      provisioned: true,
      organizationId,
      ownerHubUserId: hubUserId,
      accountId: local.accountId,
      userId: local.userId,
    });
  } catch (error) {
    console.warn("[platform] Tiquet provisioning denied:", error?.message || error);
    return res.status(409).json({ error: "Tiquet workspace provisioning could not be completed." });
  }
});

router.post("/members/provision", async (req, res) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const organization = body.organization && typeof body.organization === "object" && !Array.isArray(body.organization)
    ? body.organization : {};
  const user = body.user && typeof body.user === "object" && !Array.isArray(body.user) ? body.user : {};
  const organizationId = String(organization.id || "").trim();
  const organizationName = String(organization.name || "").trim();
  const organizationSlug = String(organization.slug || "").trim();
  const hubUserId = String(user.id || "").trim();
  const email = String(user.email || "").trim().toLowerCase();
  const name = String(user.name || email.split("@")[0] || "").trim();
  const role = String(body.role || "").trim();

  if (
    !hubTeamRoles.includes(role) ||
    !/^[A-Za-z0-9._:@-]{8,180}$/.test(organizationId) ||
    organizationName.length < 1 || organizationName.length > 180 ||
    !/^[a-z0-9][a-z0-9-]{0,99}$/.test(organizationSlug) ||
    !/^[A-Za-z0-9._:@-]{8,180}$/.test(hubUserId) ||
    !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
    name.length < 1 || name.length > 180
  ) {
    return res.status(400).json({ error: "Invalid Tiquet team provisioning request." });
  }

  try {
    const local = await provisionHubIdentity({
      organization: { id: organizationId, name: organizationName, slug: organizationSlug },
      user: { id: hubUserId, email, name },
      role,
      plan: body.plan || "hub",
      entitlement: { product: "tiquet", enabled: true, access: "team" },
    });

    if (
      local.hubOrganizationId !== organizationId ||
      local.hubUserId !== hubUserId ||
      local.role !== "Member" ||
      !Array.isArray(local.permissions)
    ) {
      throw new Error("Tiquet team identity mismatch.");
    }

    res.setHeader("Cache-Control", "no-store");
    return res.json({
      provisioned: true,
      organizationId,
      hubUserId,
      accountId: local.accountId,
      userId: local.userId,
      localRole: local.role,
      permissions: local.permissions,
    });
  } catch (error) {
    console.warn("[platform] Tiquet team provisioning denied:", error?.message || error);
    return res.status(409).json({ error: "Tiquet team workspace provisioning could not be completed." });
  }
});

router.post("/members/deprovision", async (req, res) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const organizationId = String(body.organizationId || "").trim();
  const user = body.user && typeof body.user === "object" && !Array.isArray(body.user) ? body.user : {};
  const hubUserId = String(user.id || "").trim();

  if (
    !/^[A-Za-z0-9._:@-]{8,180}$/.test(organizationId) ||
    !/^[A-Za-z0-9._:@-]{8,180}$/.test(hubUserId)
  ) {
    return res.status(400).json({ error: "Invalid Tiquet team deprovisioning request." });
  }

  try {
    const account = await db.prepare(
      "SELECT id FROM accounts WHERE hub_organization_id = ? LIMIT 1"
    ).get(organizationId);
    if (!account) {
      return res.status(409).json({ error: "Tiquet workspace is not provisioned." });
    }

    const member = await db.prepare(
      "SELECT id, role, oauth_provider, hub_user_id FROM users WHERE account_id = ? AND hub_user_id = ? LIMIT 1"
    ).get(account.id, hubUserId);

    if (!member) {
      res.setHeader("Cache-Control", "no-store");
      return res.json({ deprovisioned: true, organizationId, hubUserId, alreadyAbsent: true });
    }
    if (member.role === "Admin") {
      return res.status(409).json({ error: "Tiquet owner/admin identity cannot be deprovisioned through the Hub team endpoint." });
    }
    if (member.oauth_provider !== "v79-hub" || member.hub_user_id !== hubUserId) {
      return res.status(409).json({ error: "Tiquet member is not a Hub-managed team identity." });
    }

    await db.prepare(
      "DELETE FROM users WHERE id = ? AND account_id = ? AND hub_user_id = ? AND role <> 'Admin'"
    ).run(member.id, account.id, hubUserId);

    res.setHeader("Cache-Control", "no-store");
    return res.json({ deprovisioned: true, organizationId, hubUserId, userId: member.id });
  } catch (error) {
    console.warn("[platform] Tiquet team deprovisioning denied:", error?.message || error);
    return res.status(409).json({ error: "Tiquet team member could not be deprovisioned." });
  }
});

router.get("/summary/:accountId", async (req, res) => {
  const accountId = String(req.params.accountId || "").trim();
  if (!/^[A-Za-z0-9._:@-]{1,180}$/.test(accountId)) {
    return res.status(400).json({ error: "Invalid account identifier." });
  }

  try {
    const account = await db.prepare(
      "SELECT id, name, status, plan, createdAt, hub_organization_id FROM accounts WHERE id = ? OR hub_organization_id = ? LIMIT 1"
    ).get(accountId, accountId);
    if (!account) return res.status(404).json({ error: "Tiquet account not found." });
    // The requested subject can be the Hub organisation ID; data rows use Tiquet's account ID.
    const resolvedAccountId = account.id;

    const [clientsRow, jobsRow, statusRows, teamRow, unreadRow] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM clients WHERE account_id = ?").get(resolvedAccountId),
      db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE account_id = ?").get(resolvedAccountId),
      db.prepare("SELECT status, COUNT(*) AS count FROM jobs WHERE account_id = ? GROUP BY status ORDER BY status").all(resolvedAccountId),
      db.prepare("SELECT COUNT(*) AS count FROM users WHERE account_id = ?").get(resolvedAccountId),
      db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE account_id = ? AND isRead = 0").get(resolvedAccountId),
    ]);

    const amountRow = await db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM jobs WHERE account_id = ? AND amount IS NOT NULL"
    ).get(resolvedAccountId);

    res.json({
      product: "tiquet",
      subjectId: account.id,
      account: {
        name: account.name,
        status: account.status || "active",
        plan: account.plan || "trial",
        createdAt: account.createdAt || null,
      },
      metrics: {
        clients: Number(clientsRow?.count || 0),
        jobs: Number(jobsRow?.count || 0),
        teamMembers: Number(teamRow?.count || 0),
        unreadNotifications: Number(unreadRow?.count || 0),
        jobValueTotal: Number(amountRow?.total || 0),
        jobsByStatus: Object.fromEntries((statusRows || []).map(row => [String(row.status), Number(row.count || 0)])),
      },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[platform] summary failed:", error?.message || error);
    res.status(500).json({ error: "Unable to build Tiquet platform summary." });
  }
});


function validAccountId(value) {
  return /^[A-Za-z0-9._:@-]{1,180}$/.test(String(value || "").trim());
}

router.get("/admin/stats", async (_req, res) => {
  try {
    const [accounts, active, suspended, users, jobs, activeSubs, trialSubs, canceledSubs, new30] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS c FROM accounts").get(),
      db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE status = 'active'").get(),
      db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE status = 'suspended'").get(),
      db.prepare("SELECT COUNT(*) AS c FROM users").get(),
      db.prepare("SELECT COUNT(*) AS c FROM jobs").get(),
      db.prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'active'").get(),
      db.prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'trialing'").get(),
      db.prepare("SELECT COUNT(*) AS c FROM subscriptions WHERE status = 'canceled'").get(),
      db.prepare("SELECT COUNT(*) AS c FROM accounts WHERE createdAt >= ?").get(new Date(Date.now() - 30 * 86400000).toISOString()),
    ]);

    const planPrices = { starter: 29, pro: 79, enterprise: 199, trial: 0 };
    const plans = await db.prepare("SELECT plan, COUNT(*) AS c FROM subscriptions WHERE status = 'active' GROUP BY plan").all();
    const mrr = (plans || []).reduce((sum, row) => sum + (planPrices[row.plan] || 0) * Number(row.c || 0), 0);

    res.json({
      totalAccounts: Number(accounts?.c || 0),
      activeAccounts: Number(active?.c || 0),
      suspendedAccounts: Number(suspended?.c || 0),
      totalUsers: Number(users?.c || 0),
      totalJobs: Number(jobs?.c || 0),
      activeSubscriptions: Number(activeSubs?.c || 0),
      trialSubscriptions: Number(trialSubs?.c || 0),
      canceledSubscriptions: Number(canceledSubs?.c || 0),
      estimatedMrrUsd: mrr,
      newAccounts30d: Number(new30?.c || 0),
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[platform-admin] stats failed:", error?.message || error);
    res.status(500).json({ error: "Unable to build Tiquet platform statistics." });
  }
});

router.get("/admin/accounts", async (_req, res) => {
  try {
    const accounts = await db.prepare(
      "SELECT id, name, status, plan, createdAt, suspendedAt, hub_organization_id FROM accounts ORDER BY createdAt DESC"
    ).all();

    const rows = await Promise.all((accounts || []).map(async account => {
      const [subscription, users, jobs] = await Promise.all([
        db.prepare("SELECT status, plan, current_period_end, createdAt FROM subscriptions WHERE account_id = ? ORDER BY createdAt DESC LIMIT 1").get(account.id),
        db.prepare("SELECT COUNT(*) AS c FROM users WHERE account_id = ?").get(account.id),
        db.prepare("SELECT COUNT(*) AS c FROM jobs WHERE account_id = ?").get(account.id),
      ]);
      return {
        id: account.id,
        name: account.name,
        status: account.status || "active",
        plan: account.plan || subscription?.plan || "trial",
        createdAt: account.createdAt || null,
        suspendedAt: account.suspendedAt || null,
        hubOrganizationId: account.hub_organization_id || null,
        userCount: Number(users?.c || 0),
        jobCount: Number(jobs?.c || 0),
        subscription: subscription ? {
          status: subscription.status || null,
          plan: subscription.plan || null,
          currentPeriodEnd: subscription.current_period_end || null,
        } : null,
      };
    }));

    res.json(rows);
  } catch (error) {
    console.error("[platform-admin] accounts failed:", error?.message || error);
    res.status(500).json({ error: "Unable to list Tiquet platform accounts." });
  }
});

router.put("/admin/accounts/:id/suspend", async (req, res) => {
  const id=String(req.params.id || "").trim();
  if (!validAccountId(id)) return res.status(400).json({ error: "Invalid account identifier." });
  if (id === "default_account") return res.status(403).json({ error: "The default account cannot be suspended." });
  try {
    const result=await db.prepare("UPDATE accounts SET status = 'suspended', suspendedAt = ? WHERE id = ?").run(new Date().toISOString(), id);
    if (!result?.changes) return res.status(404).json({ error: "Account not found." });
    res.json({ success:true, status:"suspended" });
  } catch (error) {
    console.error("[platform-admin] suspend failed:", error?.message || error);
    res.status(500).json({ error: "Unable to suspend Tiquet account." });
  }
});

router.put("/admin/accounts/:id/unsuspend", async (req, res) => {
  const id=String(req.params.id || "").trim();
  if (!validAccountId(id)) return res.status(400).json({ error: "Invalid account identifier." });
  try {
    const result=await db.prepare("UPDATE accounts SET status = 'active', suspendedAt = NULL WHERE id = ?").run(id);
    if (!result?.changes) return res.status(404).json({ error: "Account not found." });
    res.json({ success:true, status:"active" });
  } catch (error) {
    console.error("[platform-admin] unsuspend failed:", error?.message || error);
    res.status(500).json({ error: "Unable to unsuspend Tiquet account." });
  }
});

router.put("/admin/accounts/:id/plan/:plan", async (req, res) => {
  const id=String(req.params.id || "").trim();
  const plan=String(req.params.plan || "").trim().toLowerCase();
  if (!validAccountId(id)) return res.status(400).json({ error: "Invalid account identifier." });
  if (!["trial","starter","pro","enterprise"].includes(plan)) return res.status(400).json({ error: "Invalid plan." });
  try {
    const result=await db.prepare("UPDATE accounts SET plan = ? WHERE id = ?").run(plan, id);
    if (!result?.changes) return res.status(404).json({ error: "Account not found." });
    await db.prepare("UPDATE subscriptions SET plan = ? WHERE account_id = ?").run(plan, id);
    res.json({ success:true, plan });
  } catch (error) {
    console.error("[platform-admin] plan change failed:", error?.message || error);
    res.status(500).json({ error: "Unable to change Tiquet plan." });
  }
});

export default router;
