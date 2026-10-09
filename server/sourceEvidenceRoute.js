import fs from "node:fs";
import path from "node:path";
import { signTiquetReadOnlyMetrics } from "./sourceEvidenceSigner.js";

// Fixed read-only source-evidence handler. Dependency injection permits fully
// synthetic HTTP integration tests without touching real Tiquet databases.
export function createTiquetSignedEvidenceHandler({
  db, enabled = () => process.env.V79_TIQUET_SIGNED_EVIDENCE_ENABLED === "1",
  signingKeyFile = () => process.env.V79_TIQUET_EVIDENCE_SIGNING_KEY_FILE || "",
  now = () => new Date(),
} = {}) {
  if (!db || typeof db.prepare !== "function") throw new Error("Tiquet read-only DB adapter required.");
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (!enabled()) return res.status(404).json({ error: "Signed evidence is not enabled." });
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
    const keyFile = String(signingKeyFile());
    if (!keyFile || !path.isAbsolute(keyFile)) {
      return res.status(503).json({ error: "Tiquet source signing key is not configured." });
    }
    try {
      const keyStat = fs.lstatSync(keyFile);
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
      const signed = signTiquetReadOnlyMetrics({
        organizationId, requestId, metrics, privateKeyPem: fs.readFileSync(keyFile, "utf8"), now: now(),
      });
      return res.json({ ...signed, executionEnabled: false });
    } catch (error) {
      console.error("[platform] signed evidence unavailable:", error?.name || "Error");
      return res.status(503).json({ error: "Tiquet signed evidence could not be produced." });
    }
  };
}
