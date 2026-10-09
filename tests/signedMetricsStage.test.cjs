// Isolated PR-only staging test. Requires a disposable PostgreSQL test service,
// a launched real Tiquet HTTP API, and a per-run ephemeral Ed25519 key.
const assert = require("node:assert/strict");
const { createHash, createHmac, generateKeyPairSync, randomUUID, verify: verifyEd25519 } = require("node:crypto");
const { readFileSync, writeFileSync, renameSync } = require("node:fs");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

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
function signedHeaders(method, pathname, timestamp = String(Date.now()), serializedBody = "") {
  const canonical = [
    method, pathname, timestamp,
    createHash("sha256").update(serializedBody).digest("hex"),
  ].join("\n");
  return {
    "accept": "application/json",
    "x-v79-service-id": "v79-hub",
    "x-v79-timestamp": timestamp,
    "x-v79-signature": createHmac("sha256", platformSecret).update(canonical).digest("hex"),
  };
}
async function request(pathname, { method = "GET", body, headers } = {}) {
  const serializedBody = body !== undefined ? JSON.stringify(body) : "";
  const response = await fetch(base + pathname, {
    method, redirect: "manual",
    headers: { ...signedHeaders(method, pathname, String(Date.now()), serializedBody), ...headers,
      ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body !== undefined ? serializedBody : undefined,
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

  // Cross-repository acceptance: use the actual Hub verifier from an exact
  // pinned, previously passing commit against the running real Tiquet API.
  const readerPath = String(process.env.V79_TIQUET_CI_HUB_READER_PATH || "");
  const contractPath = String(process.env.V79_TIQUET_CI_HUB_PLATFORM_CONTRACT_PATH || "");
  assert.ok(readerPath.startsWith("hub-source-stage/") && contractPath.startsWith("hub-source-stage/"));
  const hubReader = await import(pathToFileURL(resolve(readerPath)).href);
  const hubContract = await import(pathToFileURL(resolve(contractPath)).href);
  const options = {
    enabled:true, organizationId:a, publicKey, platformSecret, baseUrl:base,
    signPlatformRequest:hubContract.signPlatformRequest,
  };
  const confirmed = await hubReader.readSignedTiquetMetrics(options);
  check(confirmed.status, "available",
    "Pinned Hub reader verifies original Tiquet HTTP Ed25519 response");
  check(confirmed.provenance, "source_signed", "Only verified source gains signed provenance");
  check(confirmed.executionEnabled, false, "Verified evidence never enables execution");
  check(confirmed.metrics.length, 5, "Hub receives only signed five-counter aggregate");
  check(confirmed.metrics.find(x => x.key === "teamMembers")?.value,
    before.payload.metrics.teamMembers, "Hub output matches isolated source account");
  for (const key of ["organizationId","requestId","signature","payload","privateKey"]) {
    check(Object.hasOwn(confirmed,key), false, "Hub output does not expose protected " + key);
  }
  const rejectedForeignKey = await hubReader.readSignedTiquetMetrics({
    ...options, publicKey: alternativePublicKey.export({format:"pem",type:"spki"}),
  });
  check(rejectedForeignKey.status,"unavailable",
    "Hub rejects valid Tiquet HTTP response signed by a different trusted-key identity");
  check("metrics" in rejectedForeignKey,false,
    "Invalid source identity does not fabricate a zero-value metric");
  const unknownHubScope = await hubReader.readSignedTiquetMetrics({
    ...options, organizationId:"synthetic-nonexistent-tenant",
  });
  check(unknownHubScope.status,"unavailable",
    "Unknown signed Hub scope never falls back to another account");

  // Key-rotation safety rehearsal: atomic replacement of this job's
  // ephemeral signing identity only. A stale Hub public key must fail closed.
  const signingKeyPath = String(process.env.V79_TIQUET_SOURCE_ED25519_KEY_FILE || "");
  assert.equal(signingKeyPath, "/run/secrets/ci-only-tiquet-source.pem",
    "A key rotation test is only permitted against the CI-only source path");
  const rotation = generateKeyPairSync("ed25519");
  const rotatedPublic = rotation.publicKey.export({format:"pem",type:"spki"});
  const nextPath = signingKeyPath + ".ci-next";
  writeFileSync(nextPath,
    rotation.privateKey.export({format:"pem",type:"pkcs8"}),
    {flag:"wx",mode:0o600});
  renameSync(nextPath, signingKeyPath);
  const afterRotation = await request(pathA);
  check(afterRotation.response.status,200,
    "Disposable Tiquet signer continues read-only serving after key rotation");
  const rotatedCanonical = canonicalSourceEnvelope(afterRotation.payload.payload);
  const rotatedSignature = Buffer.from(afterRotation.payload.signature,"base64url");
  check(verifyEd25519(null,Buffer.from(rotatedCanonical),rotatedPublic,rotatedSignature),
    true,"New CI-only Ed25519 signer authenticates source data");
  check(verifyEd25519(null,Buffer.from(rotatedCanonical),publicKey,rotatedSignature),
    false,"Retired source verification key no longer authenticates new envelopes");
  const oldHubConfig = await hubReader.readSignedTiquetMetrics(options);
  check(oldHubConfig.status,"unavailable",
    "Hub must fail closed after source rotation until trusted public key is updated");
  check("metrics" in oldHubConfig,false,
    "Hub must not invent replacement metrics while source key has rotated");
  const newHubConfig = await hubReader.readSignedTiquetMetrics({
    ...options,publicKey:rotatedPublic,
  });
  check(newHubConfig.status,"available",
    "New trusted Hub public key verifies rotated source after controlled update");
  check(newHubConfig.executionEnabled,false,
    "Key rotation cannot enable action execution");

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
