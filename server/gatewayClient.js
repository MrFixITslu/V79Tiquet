import { v4 as uuidv4 } from 'uuid';
import { logger } from './logger.js';

// ── FFPRO2 Gateway ───────────────────────────────────────────────────────
// Tiquet records cash when a payment ledger entry is created. Each payment
// receives its own immutable event id so deposits, partial payments and final
// settlements can be retried independently without posting the full job value
// more than once.

const RETRY_DELAYS_MS = [2000, 8000];

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

  if (res.ok) return true;

  if (res.status >= 400 && res.status < 500) {
    const body = await res.json().catch(() => null);
    logger.warn(`[FFPRO Gateway] Rejected (HTTP ${res.status}): ${body?.error || 'no error detail'} — will not retry.`);
    return 'permanent-failure';
  }

  return 'pending';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function deliverPayload(payload, label) {
  if (!isConfigured()) return 'disabled';

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const result = await attemptDelivery(payload);
      if (result === true) return 'sent';
      if (result === 'permanent-failure') return 'permanent-failure';
    } catch (err) {
      logger.warn(`[FFPRO Gateway] ${label} attempt ${attempt + 1} failed: ${err.message}`);
    }
    if (attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }

  logger.warn(`[FFPRO Gateway] ${label} still pending after inline retries — periodic sweep will keep trying.`);
  return 'pending';
}

/**
 * Send one recorded customer payment to FFPRO. The amount is the payment
 * amount, not the overall job value. The payment id is exposed as the
 * paymentReference while the immutable ffproEventId drives idempotency.
 */
export async function sendPaymentEvent(payment, job, workspaceNumber, settings) {
  const payload = {
    eventId: payment.ffproEventId,
    workspaceNumber,
    jobId: job.id,
    jobTitle: job.title,
    amount: Number(payment.amount || 0),
    currency: (settings && settings.currency) || 'USD',
    paidAt: payment.receivedAt || payment.recordedAt || new Date().toISOString(),
    paymentReference: payment.reference || payment.id,
    customer: job.client ? { name: job.client } : undefined,
  };
  return deliverPayload(payload, `Payment ${payment.id}`);
}

/**
 * Backwards-compatible delivery for historical jobs that were already marked
 * pending by the pre-ledger implementation. New payment flows do not use this.
 */
export async function sendPaidEvent(job, workspaceNumber, settings) {
  const payload = {
    eventId: job.ffproEventId,
    workspaceNumber,
    jobId: job.id,
    jobTitle: job.title,
    amount: Number(job.amount || 0),
    currency: (settings && settings.currency) || 'USD',
    paidAt: new Date().toISOString(),
    paymentReference: job.id,
    customer: job.client ? { name: job.client } : undefined,
  };
  return deliverPayload(payload, `Legacy paid job ${job.id}`);
}

export function generateEventId() {
  return uuidv4();
}
