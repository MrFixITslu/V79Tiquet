import crypto from "crypto";
import { websiteTicketReference, isWebsiteEvent } from "./websiteCustomerWorkflow.js";

// Durable, tenant-scoped acknowledgement queue. Pre-existing website jobs have
// NULL ack status and are never retrospectively emailed during a deployment.
export function createWebsiteAcknowledgementService({ db, send, logger, accountId, clock = () => Date.now() }) {
  const MAX_ATTEMPTS = 8;
  const nowISO = () => new Date(clock()).toISOString();
  async function process(jobId) {
    const now = nowISO();
    const stale = new Date(clock() - 5 * 60_000).toISOString();
    const job = await db.prepare([
      "UPDATE jobs SET websiteAckStatus = 'sending',",
      "websiteAckLeaseAt = ?, websiteAckAttempts = COALESCE(websiteAckAttempts, 0) + 1",
      "WHERE id = ? AND account_id = ? AND intakeEventId IS NOT NULL",
      "AND COALESCE(websiteAckAttempts,0) < ?",
      "AND (websiteAckRetryAt IS NULL OR websiteAckRetryAt <= ?)",
      "AND (websiteAckStatus IN ('queued','failed')",
      " OR (websiteAckStatus = 'sending' AND websiteAckLeaseAt < ?))",
      "RETURNING *"
    ].join(" ")).get(now, jobId, accountId, MAX_ATTEMPTS, now, stale);
    if (!job) return { accepted: false, skipped: true };
    let errorMessage = "Acknowledgement email was not accepted by SMTP.";
    try {
      if (!isWebsiteEvent(job.intakeEventId) || !job.clientEmail || !job.secureToken ||
          !job.secureTokenExpires || new Date(job.secureTokenExpires).getTime() <= clock()) {
        errorMessage = "Ticket email or tracking link is invalid.";
      } else {
        const result = await send({
          to: job.clientEmail, customerName: job.client, title: job.title,
          requestSummary: job.description || "",
          reference: websiteTicketReference(job.id), portalToken: job.secureToken
        });
        if (result.success && !result.skipped) {
          const sentAt = nowISO();
          await db.prepare([
            "UPDATE jobs SET websiteAckStatus = 'sent', websiteAckSentAt = ?,",
            "websiteAckError = NULL, websiteAckLeaseAt = NULL, websiteAckRetryAt = NULL",
            "WHERE id = ? AND account_id = ? AND websiteAckLeaseAt = ?"
          ].join(" ")).run(sentAt, job.id, accountId, now);
          // Audit errors must never turn a successfully accepted email into a
          // failed delivery, as that would cause a duplicate send on retry.
          try {
            await db.prepare(
              'INSERT INTO activity_logs (id, job_id, action, timestamp, "user", account_id) VALUES (?, ?, ?, ?, ?, ?)'
            ).run(crypto.randomUUID(), job.id,
              "Customer acknowledgement accepted by SMTP (" + websiteTicketReference(job.id) + ")",
              sentAt, "Tiquet System", accountId);
          } catch (auditError) {
            logger.error("Acknowledgement accepted but audit event failed", { jobId: job.id, error: auditError.message });
          }
          return { accepted: true, reference: websiteTicketReference(job.id) };
        }
        errorMessage = result.skipped ? "Email service not configured." :
          String(result.error || errorMessage).slice(0, 250);
      }
    } catch (error) {
      errorMessage = String(error?.message || "Email service unavailable.").slice(0, 250);
    }
    const interval = Math.min(60 * 60_000, 60_000 * 2 ** Math.min(Number(job.websiteAckAttempts || 1), 6));
    await db.prepare([
      "UPDATE jobs SET websiteAckStatus = 'failed', websiteAckError = ?,",
      "websiteAckRetryAt = ?, websiteAckLeaseAt = NULL",
      "WHERE id = ? AND account_id = ? AND websiteAckLeaseAt = ?"
    ].join(" ")).run(errorMessage, new Date(clock() + interval).toISOString(), job.id, accountId, now);
    logger.warn("Website ticket acknowledgement pending retry", {
      jobId: job.id, accountId, attempts: job.websiteAckAttempts
    });
    return { accepted: false, retryScheduled: true };
  }
  async function sweep() {
    if (!accountId) return 0;
    const now = nowISO();
    const stale = new Date(clock() - 5 * 60_000).toISOString();
    const pending = await db.prepare([
      "SELECT id FROM jobs WHERE account_id = ? AND intakeEventId IS NOT NULL",
      "AND COALESCE(websiteAckAttempts,0) < ?",
      "AND (websiteAckRetryAt IS NULL OR websiteAckRetryAt <= ?)",
      "AND (websiteAckStatus IN ('queued','failed')",
      " OR (websiteAckStatus = 'sending' AND websiteAckLeaseAt < ?))",
      "ORDER BY createdAt ASC LIMIT 12"
    ].join(" ")).all(accountId, MAX_ATTEMPTS, now, stale);
    for (const row of pending) await process(row.id);
    return pending.length;
  }
  function start() {
    void sweep().catch(error => logger.error("Website ticket receipt sweep failed", { error: error.message }));
    const interval = setInterval(() => {
      void sweep().catch(error => logger.error("Website ticket receipt sweep failed", { error: error.message }));
    }, 60_000);
    interval.unref();
    return () => clearInterval(interval);
  }
  return { process, sweep, start };
}
