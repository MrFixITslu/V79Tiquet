import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createHubEntitlementChecker } from "../server/hubEntitlementRevalidation.js";

const secret = "test-product-service-secret-minimum-32-characters";
const product = "tiquet";
const subject = { organizationId: "customer-org", scopedUserId: "scoped-user" };

test("signed exact application identity and 30s bounded cache", async () => {
  let current = 1_800_000_000_000, calls = 0;
  const transport = async (url, options) => {
    calls += 1;
    assert.equal(new URL(url).pathname, "/api/platform/entitlement/check");
    assert.equal(options.headers["x-v79-service-id"], "v79-" + product);
    const digest = createHash("sha256").update(options.body).digest("hex");
    const canonical = ["POST", "/api/platform/entitlement/check", options.headers["x-v79-timestamp"], digest].join("\n");
    const expected = createHmac("sha256", secret).update(canonical).digest("hex");
    assert.equal(options.headers["x-v79-signature"], expected);
    assert.deepEqual(JSON.parse(options.body), { product, ...subject });
    return { ok: true, json: async () => ({ allowed: true, validForSeconds: 90 }) };
  };
  const check = createHubEntitlementChecker({ product, hubUrl: "http://hub.internal:3040", secret, now: () => current, transport });
  assert.equal(await check(subject), true);
  current += 29_000;
  assert.equal(await check(subject), true);
  assert.equal(calls, 1);
  current += 1000;
  assert.equal(await check(subject), true);
  assert.equal(calls, 2);
});
test("failed Hub checks, missing identity and revoked entitlements deny", async () => {
  const transport = async () => ({ ok: true, json: async () => ({ allowed: false, validForSeconds: 30 }) });
  const check = createHubEntitlementChecker({ product, hubUrl: "http://hub.internal:3040", secret, transport });
  assert.equal(await check(subject), false);
  assert.equal(await check({ ...subject, scopedUserId: "" }), false);
  const offline = createHubEntitlementChecker({ product, hubUrl: "http://hub.internal:3040", secret, transport: async () => { throw new Error("offline"); } });
  assert.equal(await offline(subject), false);
});
test("weak secret is never accepted", () => {
  assert.throws(() => createHubEntitlementChecker({ product, hubUrl: "http://hub", secret: "short" }), /securely configured/);
});
