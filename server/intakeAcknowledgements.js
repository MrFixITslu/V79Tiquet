/**
 * Website enquiry acknowledgement outbox.
 *
 * A real job is created before we enqueue. The email contains a reference
 * number, not a portal bearer token or private job description.
 *
 * Crucially a claimed "sending" item is never automatically retried:
 * SMTP may have accepted the message before the process lost its reply.
 * This avoids silently mailing customers twice after crashes.
 */
export function createIntakeAcknowledgements({
  db, send, render, deliveryConfigured, enabled,
  now = () => new Date(), log = { warn: () => {} },
}) {
  if (!db || typeof send !== "function" || typeof render !== "function")
    throw new Error("Acknowledgement dependencies missing");

  async function enqueue(accountId, jobId) {
    if (!enabled()) return "disabled";
    if (!accountId || !jobId) throw new Error("Missing acknowledgement identity");
    await db.prepare(`
      INSERT INTO v79_intake_ack_outbox
        (account_id,job_id,status,created_at)
      VALUES (?,?,'pending',?)
      ON CONFLICT (account_id,job_id) DO NOTHING
    `).run(accountId,jobId,now().toISOString());
    const row = await db.prepare(`
      SELECT status FROM v79_intake_ack_outbox
       WHERE account_id = ? AND job_id = ?
    `).get(accountId,jobId);
    return row?.status || "unavailable";
  }

  async function processBatch(limit=5) {
    if (!enabled()) return { status:"disabled", processed:0 };
    if (!deliveryConfigured())
      return { status:"smtp_not_configured", processed:0 };
    if (!Number.isInteger(limit) || limit<1 || limit>20)
      throw new Error("Invalid acknowledgement batch limit");
    let sent=0, review=0, claimedCount=0;
    for (let index=0;index<limit;index++) {
      // Atomic PostgreSQL claim. SKIP LOCKED works across worker processes.
      // Never reclaim 'sending' automatically (outcome may be ambiguous).
      const claim=await db.prepare(`
        UPDATE v79_intake_ack_outbox
           SET status='sending',claimed_at=?
         WHERE (account_id,job_id) IN (
           SELECT account_id,job_id FROM v79_intake_ack_outbox
            WHERE status='pending' ORDER BY created_at,job_id
            FOR UPDATE SKIP LOCKED LIMIT 1
         ) RETURNING account_id,job_id
      `).get(now().toISOString());
      if (!claim) break;
      claimedCount++;
      try {
        const job=await db.prepare(`
          SELECT j.id,j.client,j.clientEmail,s.name AS company_name,
                 s.email AS company_email,s.phone AS company_phone,
                 s.address AS company_address
            FROM jobs j LEFT JOIN settings s ON s.account_id=j.account_id
           WHERE j.id = ? AND j.account_id = ?
           ORDER BY s.id LIMIT 1
        `).get(claim.job_id,claim.account_id);
        if (!job || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(job.clientEmail || ""))
          throw new Error("recipient_unavailable");
        const ticketRef="V79-"+String(job.id).slice(0,8).toUpperCase();
        const message=render(
          "We have received your enquiry — {{ticket_ref}}",
          "Hello {{client_name}},\n\nThank you for contacting {{company_name}}. We have received your request and will contact you to confirm the details before any work begins.\n\nYour reference: {{ticket_ref}}\n\nPlease quote this reference when you contact our team. This acknowledgement does not mean work has been approved or a payment is due.\n\nRegards,\n{{company_name}}",
          {
            client_name:job.client || "Customer",
            company_name:job.company_name || "V79 Digital",
            company_email:job.company_email || "",
            company_phone:job.company_phone || "",
            company_address:job.company_address || "",
            ticket_ref:ticketRef,
          },
        );
        const result=await send(job.clientEmail,message.subject,message.html);
        // The mail helper can return success:true,skipped:true when SMTP is
        // absent. A skipped email MUST NEVER be marked as delivered.
        if (!result?.success || result?.skipped) throw new Error("delivery_unconfirmed");
        await db.prepare(`
          UPDATE v79_intake_ack_outbox
             SET status='sent',sent_at=?,error_code=NULL
           WHERE account_id=? AND job_id=? AND status='sending'
        `).run(now().toISOString(),claim.account_id,claim.job_id);
        sent++;
      } catch {
        // Ambiguous provider results are permanently held for human review,
        // not automatically replayed. Avoid leaking addresses and SMTP detail.
        try {
          await db.prepare(`
            UPDATE v79_intake_ack_outbox
               SET status='requires_review',error_code='delivery_unconfirmed'
             WHERE account_id=? AND job_id=? AND status='sending'
          `).run(claim.account_id,claim.job_id);
        } catch {
          log.warn("[Intake Acknowledgement] Uncertain delivery state; operator review required");
        }
        review++;
      }
    }
    return {status:"processed",claimed:claimedCount,sent,requiresReview:review};
  }
  return Object.freeze({enqueue,processBatch});
}
