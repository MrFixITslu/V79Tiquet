import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';

// ── FFPRO2 Gateway ───────────────────────────────────────────────────────
// Sends a "job marked PAID" event to FFPRO2, where it's recorded as income
// under V79D — Vision79 Digital. Deliberately isolated from the payment
// confirmation flow itself: a job's payment in V79Tiquet must always
// succeed and stay successful even if FFPRO2 is completely unreachable —
// nothing in here is allowed to throw back into that flow.
//
// Delivery model: a job is marked 'pending' in the DB (see server/db.js,
// jobs.ffproSyncStatus) the instant it's paid — before any network call —
// so the record survives a crash mid-delivery. sendPaidEvent() below then
// tries a few times with backoff inline (covers the common "FFPRO2 was
// mid-restart for a few seconds" case without making the client wait
// long), and if all of those fail, the periodic sweep in index.js will
// keep retrying it until it succeeds. Every attempt reuses the SAME
// eventId, so FFPRO2's idempotency check on (jobId + eventId) means however
// many times this gets retried, at most one income transaction is created.

const RETRY_DELAYS_MS = [2000, 8000]; // 2 inline retries after the first attempt

function isConfigured() {
  return !!(process.env.FFPRO_GATEWAY_URL && process.env.FFPRO_GATEWAY_SECRET);
}

async function attemptDelivery(payload) {
  const url = `${process.env.FFPRO_GATEWAY_URL.replace(/\/$/, '')}/api/gateway/webhooks/tiquet/paid`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gateway-Secret': process.env.FFPRO_GATEWAY_SECRET,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });

  if (res.ok) {
    return true;
  }
  // 400/401/404 are not going to succeed on retry (bad payload, bad secret,
  // or the workspace isn't connected/enabled on the FFPRO2 side) — log once
  // clearly and stop, rather than retrying something that can't work.
  if (res.status >= 400 && res.status < 500) {
    const body = await res.json().catch(() => null);
    logger.warn(`[FFPRO Gateway] Rejected (HTTP ${res.status}): ${body?.error || 'no error detail'} — will not retry.`);
    return 'permanent-failure';
  }
  // 5xx / anything else: treat as transient, worth retrying.
  return false;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Fires the paid-job event for a job. Never throws — the caller (the
 * payment confirmation route) must succeed regardless of the outcome here.
 * Returns true if delivered (or permanently rejected — nothing more to do),
 * false if it should be left 'pending' for the periodic sweep to retry.
 */
export async function sendPaidEvent(job, workspaceNumber, settings) {
  if (!isConfigured()) {
    // Gateway not set up on this Tiquet server at all — nothing to do, and
    // not an error; most deployments won't have this configured.
    return true;
  }

  const payload = {
    eventId: job.ffproEventId,
    workspaceNumber,
    jobId: job.id,
    jobTitle: job.title,
    amount: job.amount,
    currency: (settings && settings.currency) || 'USD',
    paidAt: new Date().toISOString(),
    paymentReference: job.id,
    customer: job.client ? { name: job.client } : undefined,
  };

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await attemptDelivery(payload);
      if (result === true || result === 'permanent-failure') {
        return true;
      }
    } catch (err) {
      logger.warn(`[FFPRO Gateway] Delivery attempt ${attempt + 1} failed: ${err.message}`);
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  logger.warn(`[FFPRO Gateway] Job ${job.id} still pending delivery after inline retries — periodic sweep will keep trying.`);
  return false;
}

export function generateEventId() {
  return uuidv4();
}
