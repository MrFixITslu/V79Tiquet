import test from "node:test";
import assert from "node:assert/strict";
import { createTiquetBillingReturnToken, tiquetBillingConfigured, verifyTiquetBillingReturnToken } from "./billingClient.js";

const originalSecret = process.env.V79_TIQUET_BILLING_SECRET;
const originalUrl = process.env.V79_HUB_BILLING_URL;

test.after(() => {
  if (originalSecret === undefined) delete process.env.V79_TIQUET_BILLING_SECRET;
  else process.env.V79_TIQUET_BILLING_SECRET = originalSecret;
  if (originalUrl === undefined) delete process.env.V79_HUB_BILLING_URL;
  else process.env.V79_HUB_BILLING_URL = originalUrl;
});

test("billing configuration requires a strong service secret", () => {
  process.env.V79_HUB_BILLING_URL = "http://v79-hub:3040";
  process.env.V79_TIQUET_BILLING_SECRET = "short";
  assert.equal(tiquetBillingConfigured(), false);
  process.env.V79_TIQUET_BILLING_SECRET = "0123456789abcdef0123456789abcdef";
  assert.equal(tiquetBillingConfigured(), true);
});

test("signed return tokens bind the Tiquet job and account without exposing the portal bearer token", () => {
  process.env.V79_TIQUET_BILLING_SECRET = "0123456789abcdef0123456789abcdef";
  const token = createTiquetBillingReturnToken("job-123", "account-456");
  const decoded = verifyTiquetBillingReturnToken(token);
  assert.deepEqual(decoded, { jobId: "job-123", accountId: "account-456" });
  assert.equal(token.includes("portal-secret"), false);
});

test("tampered return tokens are rejected", () => {
  process.env.V79_TIQUET_BILLING_SECRET = "0123456789abcdef0123456789abcdef";
  const token = createTiquetBillingReturnToken("job-123", "account-456");
  const [payload, signature] = token.split(".");
  const tampered = payload.slice(0, -1) + (payload.endsWith("A") ? "B" : "A") + "." + signature;
  assert.equal(verifyTiquetBillingReturnToken(tampered), null);
});
