import { timingSafeEqual } from "node:crypto";
import { tokenFingerprint } from "./tokenRevocation.js";

// Client portal links are separate from staff Hub sessions. Their live socket
// must stop receiving job updates when a link expires, rotates, is revoked,
// or the owning account is suspended. Never retain the raw portal token.
export async function revalidateTiquetPortalSocket(socket, db, now = Date.now()) {
  if (socket?.role !== "client" || !db || !Number.isFinite(now)) return false;
  const record = socket.portalSession;
  if (!record || typeof record.jobId !== "string" || !record.jobId ||
      typeof record.accountId !== "string" || !record.accountId ||
      typeof record.tokenHash !== "string" || !/^[0-9a-f]{64}$/.test(record.tokenHash)) return false;
  try {
    const job = await db.prepare(
      "SELECT secureToken, secureTokenExpires, secureTokenRevokedAt, account_id FROM jobs WHERE id = ? AND account_id = ?"
    ).get(record.jobId, record.accountId);
    if (!job || String(job.account_id) !== record.accountId ||
        job.secureTokenRevokedAt != null ||
        typeof job.secureToken !== "string" || !/^[A-Za-z0-9_-]{32,180}$/.test(job.secureToken)) return false;
    const expiresAt = Date.parse(job.secureTokenExpires);
    if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;
    const original = Buffer.from(record.tokenHash, "hex");
    const current = Buffer.from(tokenFingerprint(job.secureToken), "hex");
    if (original.length !== 32 || !timingSafeEqual(original, current)) return false;
    const account = await db.prepare(
      "SELECT status FROM accounts WHERE id = ?"
    ).get(record.accountId);
    return account?.status === "active";
  } catch {
    // DB outage, missing schema or invalid timestamp deny rather than
    // allowing indefinitely cached portal sockets.
    return false;
  }
}
