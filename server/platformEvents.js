import crypto from "node:crypto";
import { v4 as uuidv4 } from "uuid";
import db from "./db.js";
import { logger } from "./logger.js";

const MAX_BATCH = 25;
let flushing = false;

function config() {
  return {
    url: String(process.env.V79_HUB_EVENT_URL || "").trim(),
    secret: String(process.env.V79_HUB_EVENT_SECRET || "").trim(),
  };
}

export function platformEventsConfigured() {
  const { url, secret } = config();
  return Boolean(url && secret.length >= 32);
}

function signature(body, timestamp) {
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const canonical = ["POST", "/api/platform/events", timestamp, bodyHash].join("\n");
  return crypto.createHmac("sha256", config().secret).update(canonical).digest("hex");
}

async function deliver(event) {
  const { url } = config();
  if (!platformEventsConfigured()) return "disabled";
  const body = JSON.stringify(event);
  const timestamp = String(Date.now());
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-v79-service-id": "tiquet",
        "x-v79-timestamp": timestamp,
        "x-v79-signature": signature(body, timestamp),
      },
      body,
      signal: AbortSignal.timeout(7000),
    });
    if (response.ok) return "sent";
    if (response.status === 409 || response.status === 429 || response.status >= 500) return "pending";
    const detail = await response.json().catch(() => ({}));
    logger.warn(`[V79 Hub Events] Event rejected (HTTP ${response.status}): ${detail?.error || "unknown error"}`);
    return "failed";
  } catch (error) {
    logger.warn(`[V79 Hub Events] Delivery deferred: ${error?.message || error}`);
    return "pending";
  }
}

export async function queuePlatformEvent({
  accountId,
  type,
  subjectId,
  correlationId = null,
  payload = {},
  occurredAt = new Date().toISOString(),
  eventId = uuidv4(),
}) {
  if (!accountId || !type) return null;
  await db.prepare(`
    INSERT INTO platform_event_outbox
      (id, account_id, event_type, subject_id, correlation_id, occurred_at, payload_json, status, attempts, next_attempt_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
    ON CONFLICT DO NOTHING
  `).run(
    eventId,
    String(accountId),
    String(type),
    subjectId == null ? null : String(subjectId),
    correlationId == null ? null : String(correlationId),
    occurredAt,
    JSON.stringify(payload || {}),
    new Date().toISOString(),
    new Date().toISOString()
  );
  setImmediate(() => flushPlatformEvents().catch(err => logger.warn(`[V79 Hub Events] Flush failed: ${err.message}`)));
  return eventId;
}

export async function flushPlatformEvents() {
  if (flushing || !platformEventsConfigured()) return;
  flushing = true;
  try {
    const now = new Date().toISOString();
    const rows = await db.prepare(`
      SELECT id, account_id, event_type, subject_id, correlation_id, occurred_at, payload_json, attempts
      FROM platform_event_outbox
      WHERE status = 'pending' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
      ORDER BY created_at ASC
      LIMIT ${MAX_BATCH}
    `).all(now);

    for (const row of rows) {
      let payload = {};
      try { payload = JSON.parse(row.payload_json || "{}"); } catch {}
      const event = {
        id: row.id,
        type: row.event_type,
        version: 1,
        occurredAt: row.occurred_at,
        organizationRef: row.account_id,
        subjectId: row.subject_id || undefined,
        correlationId: row.correlation_id || undefined,
        payload,
      };
      const state = await deliver(event);
      if (state === "sent") {
        await db.prepare("UPDATE platform_event_outbox SET status='sent', sent_at=?, last_error=NULL WHERE id=?")
          .run(new Date().toISOString(), row.id);
      } else if (state === "failed") {
        await db.prepare("UPDATE platform_event_outbox SET status='failed', attempts=attempts+1, last_error=? WHERE id=?")
          .run("Permanent rejection from V79 Hub", row.id);
      } else if (state === "pending") {
        const attempts = Number(row.attempts || 0) + 1;
        const delayMs = Math.min(30 * 60 * 1000, Math.max(30 * 1000, 30 * 1000 * (2 ** Math.min(attempts - 1, 6))));
        await db.prepare("UPDATE platform_event_outbox SET attempts=?, next_attempt_at=?, last_error=? WHERE id=?")
          .run(attempts, new Date(Date.now() + delayMs).toISOString(), "Delivery deferred", row.id);
      }
    }
  } finally {
    flushing = false;
  }
}

export function startPlatformEventPump() {
  setInterval(() => {
    flushPlatformEvents().catch(err => logger.warn(`[V79 Hub Events] Periodic flush failed: ${err.message}`));
  }, 60 * 1000).unref();
  setTimeout(() => {
    flushPlatformEvents().catch(err => logger.warn(`[V79 Hub Events] Startup flush failed: ${err.message}`));
  }, 5000).unref();
}
