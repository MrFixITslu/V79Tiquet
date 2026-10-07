import crypto from "node:crypto";

const ORDER_PATH = "/api/billing/internal/order";
const STATUS_PATH = "/api/billing/internal/status";

function config() {
  return {
    baseUrl: String(process.env.V79_HUB_BILLING_URL || process.env.V79_HUB_INTERNAL_URL || "http://v79-hub:3040").replace(/\/$/, ""),
    secret: String(process.env.V79_TIQUET_BILLING_SECRET || ""),
  };
}

function sign(method, pathname, timestamp, body, secret) {
  const bodyHash = crypto.createHash("sha256").update(body).digest("hex");
  const canonical = [String(method).toUpperCase(), pathname, timestamp, bodyHash].join("\n");
  return crypto.createHmac("sha256", secret).update(canonical).digest("hex");
}

async function hubRequest(pathname, payload) {
  const { baseUrl, secret } = config();
  if (!/^https?:\/\//.test(baseUrl) || secret.length < 32) {
    const error = new Error("Tiquet billing is not configured.");
    error.code = "BILLING_NOT_CONFIGURED";
    throw error;
  }
  const body = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const response = await fetch(baseUrl + pathname, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-v79-service-id": "v79-tiquet-billing",
      "x-v79-timestamp": timestamp,
      "x-v79-signature": sign("POST", pathname, timestamp, body, secret),
    },
    body,
    signal: AbortSignal.timeout(8000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "V79 Billing request failed.");
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
}

export function tiquetBillingConfigured() {
  const { baseUrl, secret } = config();
  return /^https?:\/\//.test(baseUrl) && secret.length >= 32;
}


export function createTiquetBillingReturnToken(jobId, accountId, ttlMs = 24 * 60 * 60 * 1000) {
  const { secret } = config();
  if (secret.length < 32) throw new Error("Tiquet billing is not configured.");
  const payload = Buffer.from(JSON.stringify({
    jobId: String(jobId),
    accountId: String(accountId),
    exp: Date.now() + ttlMs,
  }), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
  return payload + "." + signature;
}

export function verifyTiquetBillingReturnToken(token) {
  const { secret } = config();
  const [payload, signature, extra] = String(token || "").split(".");
  if (secret.length < 32 || !payload || !signature || extra) return null;
  const expected = crypto.createHmac("sha256", secret).update(payload).digest();
  let actual;
  try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!decoded?.jobId || !decoded?.accountId || !Number.isFinite(decoded?.exp) || decoded.exp < Date.now()) return null;
    return { jobId: String(decoded.jobId), accountId: String(decoded.accountId) };
  } catch {
    return null;
  }
}

export async function createTiquetInvoiceOrder({
  hubOrganizationId,
  jobId,
  title,
  amount,
  currency,
  returnPath,
}) {
  return hubRequest(ORDER_PATH, {
    kind: "invoice",
    externalReference: jobId,
    subjectReference: jobId,
    organizationId: hubOrganizationId,
    merchantScope: "v79-owner",
    description: title,
    amount,
    currency,
    returnPath,
  });
}

export async function getTiquetOrderStatus(orderId) {
  return hubRequest(STATUS_PATH, { orderId });
}
