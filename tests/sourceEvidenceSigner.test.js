import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify as verifyEd25519 } from "node:crypto";
import { canonicalTiquetSourceMetrics, signTiquetReadOnlyMetrics } from "../server/sourceEvidenceSigner.js";

const organizationId = "ci-owner-org";
const requestId = "01234567-89ab-4cde-8000-0123456789ab";
const now = new Date("2026-10-09T12:00:00.000Z");
const metrics = {
  clients: 3, jobs: 8, teamMembers: 2, jobValueTotal: 187.25, unreadNotifications: 1,
};
const keys = generateKeyPairSync("ed25519");
const privateKeyPem = keys.privateKey.export({ type: "pkcs8", format: "pem" });

const create = (args = {}) => signTiquetReadOnlyMetrics({
  organizationId, requestId, metrics, privateKeyPem, now, ...args,
});

test("Tiquet produces a deterministic numeric-only Ed25519 payload, compatible with Hub contract", () => {
  const signed = create();
  assert.equal(signed.algorithm, "ed25519");
  assert.equal(signed.payload.source, "tiquet");
  assert.equal(signed.payload.schema, "v79-source-metrics-v1");
  assert.equal(signed.payload.observedAt, now.toISOString());
  assert.equal(signed.payload.expiresAt, "2026-10-09T12:02:00.000Z");
  assert.equal(signed.payload.metrics.length, 5);
  assert.equal("clientEmail" in signed.payload, false);
  assert.equal("rawTicket" in signed.payload, false);
  assert.equal(signed.signature.length, 86);

  const canonical = canonicalTiquetSourceMetrics(signed.payload);
  const expected = JSON.stringify({
    schema: "v79-source-metrics-v1", source: "tiquet",
    organizationId, requestId,
    observedAt: "2026-10-09T12:00:00.000Z",
    expiresAt: "2026-10-09T12:02:00.000Z",
    metrics: [
      { key: "clients", value: 3 },
      { key: "jobValueTotal", value: 187.25 },
      { key: "jobs", value: 8 },
      { key: "teamMembers", value: 2 },
      { key: "unreadNotifications", value: 1 },
    ],
  });
  assert.equal(canonical, expected, "stable golden canonical bytes for cross-repository compatibility");
  assert.equal(verifyEd25519(null, Buffer.from(canonical, "utf8"), keys.publicKey,
    Buffer.from(signed.signature, "base64url")), true);
  assert.equal(verifyEd25519(null, Buffer.from(canonical.replace("187.25", "999.99"), "utf8"),
    keys.publicKey, Buffer.from(signed.signature, "base64url")), false);
});

test("invalid private keys, tenant data, nonce and unsafe aggregate metrics fail closed", () => {
  const invalid = [
    { organizationId: "person@example.invalid" },
    { requestId: "not-a-v4-id" },
    { metrics: { ...metrics, clientEmail: 1 } },
    { metrics: { ...metrics, clients: -1 } },
    { metrics: { ...metrics, jobs: 1.2 } },
    { metrics: { ...metrics, unreadNotifications: "2" } },
    { metrics: { ...metrics, jobValueTotal: Number.NaN } },
    { metrics: { ...metrics, jobValueTotal: 1e15 } },
    { metrics: { clients: 3 } },
    { privateKeyPem: "" },
  ];
  for (const change of invalid) {
    assert.throws(() => create(change), /evidence|Ed25519|aggregate/i);
  }
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(() => create({
    privateKeyPem: rsa.privateKey.export({ type: "pkcs8", format: "pem" }),
  }), /Ed25519/);
});

test("source-signed evidence rejects schema drift and duplicate metrics before signing", () => {
  const signed = create();
  const payload = structuredClone(signed.payload);
  assert.ok(canonicalTiquetSourceMetrics(payload));
  assert.equal(canonicalTiquetSourceMetrics({ ...payload, customerName: "Unsafe" }), null);
  assert.equal(canonicalTiquetSourceMetrics({ ...payload, source: "marketing" }), null);
  assert.equal(canonicalTiquetSourceMetrics({ ...payload, requestId: "invalid" }), null);
  assert.equal(canonicalTiquetSourceMetrics({ ...payload, metrics: [
    payload.metrics[0], payload.metrics[0], ...payload.metrics.slice(2),
  ] }), null);
  assert.equal(canonicalTiquetSourceMetrics({ ...payload, metrics: [
    ...payload.metrics.slice(0,4), { key: "ticketBody", value: 1 },
  ] }), null);
});
