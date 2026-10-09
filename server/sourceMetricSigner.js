import { createPrivateKey, sign as ed25519Sign } from "node:crypto";

// Review alongside V79 Hub's server/source-metric-signature.mjs.
// Only a fixed set of Tiquet aggregate counters can be signed; no customer,
// ticket, personnel, email, bank or message records are eligible.
const ALLOWED_KEYS = Object.freeze([
  "clients", "jobs", "teamMembers", "jobValueTotal", "unreadNotifications",
]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORGANIZATION = /^[A-Za-z0-9_-]{6,96}$/;

function exactTime(value) {
  return typeof value === "string" && ISO_UTC.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(Date.parse(value)).toISOString() === value;
}

export function canonicalTiquetSourceMetricPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      Object.keys(payload).sort().join("|") !==
        ["schema","source","organizationId","requestId","observedAt","expiresAt","metrics"].sort().join("|") ||
      payload.schema !== "v79-source-metrics-v1" || payload.source !== "tiquet" ||
      !ORGANIZATION.test(payload.organizationId) || !UUID_V4.test(payload.requestId) ||
      !exactTime(payload.observedAt) || !exactTime(payload.expiresAt) ||
      !Array.isArray(payload.metrics) || payload.metrics.length < 1 || payload.metrics.length > ALLOWED_KEYS.length) {
    return null;
  }
  const seen = new Set();
  const metrics = [];
  for (const item of payload.metrics) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        Object.keys(item).sort().join("|") !== "key|value" ||
        !ALLOWED_KEYS.includes(item.key) || seen.has(item.key) ||
        typeof item.value !== "number" || !Number.isFinite(item.value) ||
        Math.abs(item.value) > 1e12) return null;
    seen.add(item.key);
    metrics.push({ key: item.key, value: item.value });
  }
  metrics.sort((a, b) => a.key.localeCompare(b.key));
  return JSON.stringify({
    schema: payload.schema, source: payload.source,
    organizationId: payload.organizationId,
    requestId: payload.requestId.toLowerCase(),
    observedAt: payload.observedAt, expiresAt: payload.expiresAt, metrics,
  });
}

export function signTiquetAggregateSnapshot({
  organizationId, requestId, metrics, privateKey, now = new Date(),
} = {}) {
  if (!ORGANIZATION.test(organizationId) || !UUID_V4.test(requestId) ||
      !(now instanceof Date) || !Number.isFinite(+now) ||
      !metrics || typeof metrics !== "object" || Array.isArray(metrics) ||
      typeof privateKey !== "string" || !privateKey.trim()) {
    throw new Error("Tiquet source metric signing unavailable.");
  }
  // Never accept/serialize a mutable caller-defined field list.
  if (Object.keys(metrics).sort().join("|") !== [...ALLOWED_KEYS].sort().join("|")) {
    throw new Error("Tiquet source metrics do not match the approved schema.");
  }
  const payload = {
    schema: "v79-source-metrics-v1",
    source: "tiquet",
    organizationId,
    requestId: requestId.toLowerCase(),
    observedAt: now.toISOString(),
    expiresAt: new Date(+now + 90_000).toISOString(),
    metrics: ALLOWED_KEYS.map(key => ({ key, value: metrics[key] })),
  };
  const canonical = canonicalTiquetSourceMetricPayload(payload);
  if (!canonical) throw new Error("Tiquet source metric signing payload invalid.");
  let key;
  try {
    key = createPrivateKey(privateKey);
  } catch {
    throw new Error("Tiquet source signing key is unavailable.");
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("Tiquet source signing key must be Ed25519.");
  }
  const signature = ed25519Sign(null, Buffer.from(canonical, "utf8"), key).toString("base64url");
  return { payload, signature };
}
