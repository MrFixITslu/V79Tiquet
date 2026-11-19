import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isApprovedWebsiteConversion } from "../server/websiteIntakeContract.js";
const eventId = "v79-crm-12345678-1234-4abc-8abc-123456789abc";
test("accepts approved website conversion", () => assert.equal(isApprovedWebsiteConversion({ source: "website-crm-approved", eventId }), true));
test("rejects ordinary website inquiry", () => assert.equal(isApprovedWebsiteConversion({ source: "website2026", eventId }), false));
test("rejects missing or invalid conversion IDs", () => {
  for (const id of [undefined, null, "", "contact-123", "v79-crm-invalid", 42, {}, eventId+"x"]) assert.equal(isApprovedWebsiteConversion({source:"website-crm-approved", eventId:id}), false);
});
test("rejects missing or malformed envelopes", () => {
  for (const body of [undefined, null, [], "approved", 1, {}, {eventId}]) assert.equal(isApprovedWebsiteConversion(body), false);
});
test("authentication and conversion guard precede database writes", () => {
  const source = readFileSync(new URL("../server/index.js", import.meta.url), "utf8");
  const start = source.indexOf('app.post("/api/public/intake", intakeLimiter, requireIntakeSecret, async (req, res) => {');
  assert.ok(start >= 0);
  const handler = source.slice(start);
  assert.ok(handler.indexOf("isApprovedWebsiteConversion(req.body)") < handler.indexOf("db.prepare("));
  assert.match(handler, /status\(422\)/);
});
test("Hub help retains its distinct creation path", () => {
  const source = readFileSync(new URL("../server/hubHelpSupport.js",import.meta.url),"utf8");
  assert.match(source,/hub-help:/);
  assert.match(source,/INSERT INTO jobs/);
});
