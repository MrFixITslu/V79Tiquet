import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, verify as verifyEd25519 } from "node:crypto";
import {
  canonicalTiquetSourceMetricPayload, signTiquetAggregateSnapshot,
} from "../server/sourceMetricSigner.js";

const pair = generateKeyPairSync("ed25519");
const privateKey = pair.privateKey.export({ format: "pem", type: "pkcs8" });
const now = new Date("2026-10-09T12:00:00.000Z");
const input = {
  organizationId: "synthetic-owner-org",
  requestId: "01234567-89ab-4cde-8000-0123456789ab",
  now, privateKey,
  metrics: { clients: 3, jobs: 4, teamMembers: 2, unreadNotifications: 0, jobValueTotal: 1250 },
};

test("Tiquet only signs exact read-only aggregate metrics with stable Hub-compatible encoding", () => {
  const { payload, signature } = signTiquetAggregateSnapshot(input);
  assert.equal(payload.source, "tiquet");
  assert.equal(payload.organizationId, input.organizationId);
  assert.equal(payload.requestId, input.requestId);
  assert.equal(payload.expiresAt, "2026-10-09T12:01:30.000Z");
  assert.equal(payload.metrics.length, 5);
  assert.equal(payload.metrics.some(x => x.key === "unreadNotifications" && x.value === 0), true);
  assert.equal(payload.metrics.some(x => /email|password|token/i.test(x.key)), false);
  const canonical = canonicalTiquetSourceMetricPayload(payload);
  assert.equal(verifyEd25519(null, Buffer.from(canonical), pair.publicKey, Buffer.from(signature,"base64url")),true);
  assert.equal("privateKey" in payload, false);
  assert.equal("accountId" in payload, false);
  assert.equal("signature" in payload, false);
});

test("Tiquet source signer rejects arbitrary and missing metrics, PII, bad identity or unauthorised keys", () => {
  const variations = [
    { metrics: { ...input.metrics, customerEmail: 1 } },
    { metrics: { clients: 1 } },
    { metrics: { ...input.metrics, jobs: "4" } },
    { metrics: { ...input.metrics, clients: NaN } },
    { metrics: { ...input.metrics, clients: 1e13 } },
    { organizationId: "not a tenant" },
    { requestId: "attacker-nonce" },
    { privateKey: "" },
    { now: new Date(NaN) },
  ];
  for(const changed of variations) {
    assert.throws(() => signTiquetAggregateSnapshot({ ...input, ...changed }));
  }
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(() => signTiquetAggregateSnapshot({
    ...input, privateKey: rsa.privateKey.export({ format:"pem", type:"pkcs8" }),
  }));
});

test("any changed, cross-tenant or unapproved source envelope breaks signature", () => {
  const { payload, signature } = signTiquetAggregateSnapshot(input);
  const originalSignature = Buffer.from(signature,"base64url");
  const altered = [
    { ...payload, organizationId:"other-org" },
    { ...payload, metrics: payload.metrics.map(x => x.key === "jobs" ? {...x,value:9} : x) },
    { ...payload, requestId:"12345678-89ab-4cde-8000-0123456789ab" },
  ];
  for(const value of altered) {
    assert.equal(verifyEd25519(null, Buffer.from(canonicalTiquetSourceMetricPayload(value)), pair.publicKey, originalSignature), false);
  }
  assert.equal(canonicalTiquetSourceMetricPayload({
    ...payload, metrics: [...payload.metrics, { key:"ticketContent", value:1 }],
  }),null);
  const reordered={...payload,metrics:payload.metrics.toReversed()};
  assert.equal(canonicalTiquetSourceMetricPayload(reordered),canonicalTiquetSourceMetricPayload(payload));
});

test("Tiquet signer enforces exact canonical source contract fields", () => {
  const { payload } = signTiquetAggregateSnapshot(input);
  assert.equal(canonicalTiquetSourceMetricPayload({...payload, customerName:"synthetic client"}), null);
  assert.equal(canonicalTiquetSourceMetricPayload({...payload, metrics:[...payload.metrics, payload.metrics[0]]}), null);
  assert.equal(canonicalTiquetSourceMetricPayload({...payload, schema:"v79-unsafe-execute"}), null);
  assert.equal(canonicalTiquetSourceMetricPayload({...payload, observedAt:"tomorrow"}), null);
});
