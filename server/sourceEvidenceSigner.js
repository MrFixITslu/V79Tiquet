import { createPrivateKey, sign as signEd25519 } from "node:crypto";

// Phase 2C pilot. This module signs only aggregate numeric counters. It must
// never sign ticket text, client names, contacts, file contents or credentials.
const METRIC_KEYS = Object.freeze([
  "clients", "jobs", "teamMembers", "jobValueTotal", "unreadNotifications",
]);
const EXPECTED_FIELDS = Object.freeze([
  "schema", "source", "organizationId", "requestId", "observedAt", "expiresAt", "metrics",
]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validTime(text) {
  if (typeof text !== "string" || !UTC_ISO.test(text)) return false;
  const ms = Date.parse(text);
  return Number.isFinite(ms) && new Date(ms).toISOString() === text;
}

export function canonicalTiquetSourceMetrics(payload) {
  if (!record(payload) ||
      Object.keys(payload).sort().join("|") !== [...EXPECTED_FIELDS].sort().join("|") ||
      payload.schema !== "v79-source-metrics-v1" || payload.source !== "tiquet" ||
      typeof payload.organizationId !== "string" ||
      !/^[A-Za-z0-9_-]{6,96}$/.test(payload.organizationId) ||
      typeof payload.requestId !== "string" || !UUID_V4.test(payload.requestId) ||
      !validTime(payload.observedAt) || !validTime(payload.expiresAt) ||
      !Array.isArray(payload.metrics) || payload.metrics.length !== METRIC_KEYS.length) return null;
  const known = new Set(METRIC_KEYS), seen = new Set(), metrics = [];
  for (const item of payload.metrics) {
    if (!record(item) || Object.keys(item).sort().join("|") !== "key|value" ||
        typeof item.key !== "string" || !known.has(item.key) || seen.has(item.key) ||
        typeof item.value !== "number" || !Number.isFinite(item.value) ||
        Math.abs(item.value) > 1e12) return null;
    if (item.key !== "jobValueTotal" &&
        (!Number.isSafeInteger(item.value) || item.value < 0)) return null;
    seen.add(item.key);
    metrics.push({ key: item.key, value: item.value });
  }
  metrics.sort((a,b) => a.key.localeCompare(b.key));
  return JSON.stringify({
    schema: payload.schema, source: payload.source,
    organizationId: payload.organizationId, requestId: payload.requestId.toLowerCase(),
    observedAt: payload.observedAt, expiresAt: payload.expiresAt, metrics,
  });
}

export function signTiquetReadOnlyMetrics({
  organizationId, requestId, metrics, privateKeyPem, now = new Date(),
} = {}) {
  if (!record(metrics) || Object.keys(metrics).sort().join("|") !==
      [...METRIC_KEYS].sort().join("|") ||
      !Number.isFinite(+now)) throw new Error("Invalid aggregate evidence request.");
  const observedAt = now.toISOString();
  const payload = {
    schema: "v79-source-metrics-v1", source: "tiquet", organizationId, requestId,
    observedAt, expiresAt: new Date(+now + 120_000).toISOString(),
    metrics: METRIC_KEYS.map(key => ({ key, value: metrics[key] })),
  };
  const canonical = canonicalTiquetSourceMetrics(payload);
  if (!canonical || typeof privateKeyPem !== "string" || !privateKeyPem.trim()) {
    throw new Error("Tiquet evidence signing is not configured.");
  }
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Ed25519 key required.");
  const signature = signEd25519(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64url");
  return { payload, signature, algorithm: "ed25519" };
}
