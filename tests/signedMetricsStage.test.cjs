// Isolated PR-only staging test. Requires a disposable PostgreSQL test service,
// a launched real Tiquet HTTP API, and a per-run ephemeral Ed25519 key.
const assert = require("node:assert/strict");
const { createHash, createHmac, generateKeyPairSync, randomUUID, verify: verifyEd25519 } = require("node:crypto");
const { readFileSync } = require("node:fs");

const base = "http://127.0.0.1:3000";
const platformSecret = String(process.env.V79_PLATFORM_SHARED_SECRET || "");
const publicKeyPath = String(process.env.V79_TIQUET_CI_PUBLIC_KEY_FILE || "");
assert.ok(platformSecret.length >= 32);
assert.ok(publicKeyPath.startsWith("/"));
const publicKey = readFileSync(publicKeyPath, "utf8");
const alternativePublicKey = generateKeyPairSync("ed25519").publicKey;
let assertionCount = 0;

function check(value, expected, description) {
  assert.deepEqual(value, expected, description);
  assertionCount++;
}
function signedHeaders(method, pathname, timestamp = String(Date.now())) {
  const canonical = [
    method, pathname, timestamp,
    createHash("sha256").update("").digest("hex"),
  ].join("\n");
  return {
    "accept": "application/json",
    "x-v79-service-id": "v79-hub",
    "x-v79-timestamp": timestamp,
    "x-v79-signature": createHmac("sha256", platformSecret).update(canonical).digest("hex"),
  };
}
async function request(pathname, { method = "GET", body, headers } = {}) {
  const response = await fetch(base + pathname, {
    method, redirect: "manual",
    headers: { ...signedHeaders(method, pathname), ...headers,
      ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}
function canonicalSourceEnvelope(payload) {
  // Independent canonical encoding, reviewed against Hub's canonical verifier.
  // Do not call the Tiquet signing helper in this HTTP end-to-end test.
  const keys = ["schema", "source", "organizationId", "requestId", "observedAt", "expiresAt", "metrics"];
  check(Object.keys(payload).sort(), [...keys].sort(), "Exact signed payload fields");
  const metrics = [...payload.metrics].sort((a,b) => a.key.localeCompare(b.key));
  return JSON.stringify({
    schema: payload.schema, source: payload.source,
    organizationId: payload.organizationId, requestId: payload.requestId.toLowerCase(),
    observedAt: payload.observedAt, expiresAt: payload.expiresAt, metrics,
  });
}
function verifySourceEnvelope(raw) {
  assert.ok(raw && typeof raw === "object" && !Array.isArray(raw));
  check(Object.keys(raw).sort(), ["payload","signature"], "Only payload and signature are returned");
  const canonical = canonicalSourceEnvelope(raw.payload);
  const rawSignature = Buffer.from(raw.signature, "base64url");
  check(rawSignature.length, 64, "Ed25519 detached signature length");
  const isValid = verifyEd25519(null, Buffer.from(canonical, "utf8"), publicKey, rawSignature);
  check(isValid, true, "Real Tiquet response signed by staged source key");
  check(verifyEd25519(null, Buffer.from(canonical, "utf8"), alternativePublicKey, rawSignature),
    false, "Untrusted public key cannot authenticate Tiquet's response");
  return canonical;
}
async function provision(organizationId, letter) {
  const payload = {
    organization: { id: organizationId, name: "Synthetic Tiquet " + letter, slug: "signed-stage-" + letter.toLowerCase() },
    user: {
      id: "synthetic-hub-user-" + letter.toLowerCase() + "-001",
      email: "signed-stage-" + letter.toLowerCase() + "@example.test",
      name: "Synthetic Owner " + letter,
    },
    role: "owner", plan: "hub",
  };
  const result = await request("/api/platform/provision", { method: "POST", body: payload });
  check(result.response.status, 200, "Synthetic tenant provisioning only in CI");
  check(result.payload?.organizationId, organizationId, "Provisioned tenant binds exact Hub ID");
  return result;
}
async function main() {
  const a = "synthetic-signed-stage-a";
  const b = "synthetic-signed-stage-b";
  const accountA = await provision(a, "A");
  const accountB = await provision(b, "B");
  assert.notEqual(accountA.payload.accountId, accountB.payload.accountId);
  assertionCount++;
  const before = await request("/api/platform/summary/" + a);
  check(before.response.status, 200, "Read-only initial summary is available");

  const requestA = randomUUID(), requestB = randomUUID();
  const pathA = `/api/platform/agent/signed-metrics/${a}/${requestA}`;
  const pathB = `/api/platform/agent/signed-metrics/${b}/${requestB}`;

  const anonymous = await fetch(base + pathA, { redirect: "manual" });
  check(anonymous.status, 401, "Unsigned HTTP GET is denied");
  const badHmac = await request(pathA, { headers: { "x-v79-signature": "0".repeat(64) } });
  check(badHmac.response.status, 401, "Forged platform caller HMAC is denied");
  const expired = await request(pathA, {
    headers: signedHeaders("GET", pathA, String(Date.now() - 3600_000)),
  });
  check(expired.response.status, 401, "Expired platform request timestamp is denied");

  const gotA = await request(pathA);
  check(gotA.response.status, 200, "Source signer GET succeeds against isolated real app and database");
  check(gotA.response.headers.get("cache-control"), "no-store", "Signed response cannot be cached");
  const rawA = gotA.payload;
  const canonicalA = verifySourceEnvelope(rawA);
  check(rawA.payload.source, "tiquet", "Signed source identity");
  check(rawA.payload.organizationId, a, "Signed organisation identity");
  check(rawA.payload.requestId, requestA, "Fresh Hub nonce is signed");
  check(rawA.payload.schema, "v79-source-metrics-v1", "Source schema version");
  check(rawA.payload.metrics.map(metric => metric.key).sort(),
    ["clients", "jobs", "teamMembers", "unreadNotifications", "jobValueTotal"].sort(),
    "Only five aggregate metric keys are signed");
  for (const metric of rawA.payload.metrics) {
    assert.equal(typeof metric.value, "number");
    assert.ok(Number.isFinite(metric.value));
    check(Object.keys(metric).sort(), ["key", "value"], "Metric cannot carry PII or extra properties");
  }
  assertionCount += rawA.payload.metrics.length * 2;
  const since = Date.parse(rawA.payload.observedAt);
  const until = Date.parse(rawA.payload.expiresAt);
  assert.ok(since > Date.now() - 300_000 && since < Date.now() + 30_000);
  assert.ok(until > Date.now() && until - since <= 120_000);
  assertionCount += 2;

  const gotB = await request(pathB);
  check(gotB.response.status, 200, "Independent synthetic tenant signs its own response");
  verifySourceEnvelope(gotB.payload);
  check(gotB.payload.payload.organizationId, b, "Cross-tenant response has different signed tenant");
  const forgedA = { ...rawA.payload, organizationId: b };
  const changedCanonical = canonicalSourceEnvelope(forgedA);
  check(verifyEd25519(null, Buffer.from(changedCanonical), publicKey,
    Buffer.from(rawA.signature, "base64url")), false, "Captured A signature cannot impersonate B");
  const alteredA = {
    ...rawA.payload,
    metrics: rawA.payload.metrics.map(item =>
      item.key === "jobs" ? { ...item, value: item.value + 1 } : item),
  };
  check(verifyEd25519(null, Buffer.from(canonicalSourceEnvelope(alteredA)), publicKey,
    Buffer.from(rawA.signature,"base64url")), false, "Signed aggregate cannot be modified");

  const unknown = await request("/api/platform/agent/signed-metrics/synthetic-unknown-tenant/" + randomUUID());
  check(unknown.response.status, 404, "Unprovisioned tenant fails without data disclosure");
  const invalidNonce = await request("/api/platform/agent/signed-metrics/" + a + "/not-a-uuid");
  check(invalidNonce.response.status, 400, "Invalid request nonce fails");
  const rejectedPost = await request(pathA, { method: "POST", body: { execute: true } });
  check(rejectedPost.response.status !== 200, true, "No write-enabled route exists at the signed metric path");

  const after = await request("/api/platform/summary/" + a);
  check(after.response.status, 200, "Read-only follow-up summary remains available");
  check(after.payload.metrics, before.payload.metrics,
    "All tenant business aggregates unchanged by signed-read probes");
  check(canonicalA.includes("synthetic-signed-stage-a"), true,
    "Signed envelope is explicitly tenant-bound");
  console.log("REAL_TIQUET_SIGNED_STAGE_PASS assertions=" + assertionCount);
  console.log("SOURCE_KEY_EPHEMERAL; NETWORK_LOCAL_ONLY; TEST_DATABASE_ONLY; NO_DEPLOYMENT");
}
main().catch(err => {
  console.error("REAL_TIQUET_SIGNED_STAGE_FAILED: " + err.message);
  process.exitCode = 1;
});
