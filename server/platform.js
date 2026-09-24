import express from "express";
import crypto from "node:crypto";
import db from "./db.js";

const router = express.Router();
const MAX_SKEW_MS = 5 * 60 * 1000;

function canonicalMessage(req, timestamp) {
  const pathname = new URL(req.originalUrl, "http://v79.internal").pathname;
  const bodyHash = crypto.createHash("sha256").update("").digest("hex");
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

    const [clientsRow, jobsRow, statusRows, teamRow, unreadRow] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM clients WHERE account_id = ?").get(accountId),
      db.prepare("SELECT COUNT(*) AS count FROM jobs WHERE account_id = ?").get(accountId),
      db.prepare("SELECT status, COUNT(*) AS count FROM jobs WHERE account_id = ? GROUP BY status ORDER BY status").all(accountId),
      db.prepare("SELECT COUNT(*) AS count FROM users WHERE account_id = ?").get(accountId),
      db.prepare("SELECT COUNT(*) AS count FROM notifications WHERE account_id = ? AND isRead = 0").get(accountId),
    ]);

    const amountRow = await db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS total FROM jobs WHERE account_id = ? AND amount IS NOT NULL"
    ).get(accountId);

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

export default router;
