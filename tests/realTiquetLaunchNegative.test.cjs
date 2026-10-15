"use strict";
// Safe on disposable CI Tiquet only. Never point this test at a live host.
const assert = require("node:assert/strict");

const target = process.env.TIQUET_TEST_BASE_URL;
const expectedHub = "https://hub.example.test";
if (target !== "http://127.0.0.1:3000" ||
    process.env.NODE_ENV !== "test" ||
    process.env.V79_HUB_PUBLIC_URL !== expectedHub ||
    process.env.V79_HUB_INTERNAL_URL !== "http://127.0.0.1:9" ||
    process.env.V79_ALLOW_LEGACY_AUTH !== "0") {
  throw Error("REFUSING_NON_ISOLATED_TIQUET_TEST");
}
const base = new URL(target);
const request = async (route, options={}) => fetch(new URL(route,base),{
  redirect:"manual",signal:AbortSignal.timeout(5000),...options,
});
const assertNoSession = response => {
  const cookies = response.headers.get("set-cookie") || "";
  assert.doesNotMatch(cookies,/tiquet_session=[A-Za-z0-9._-]{20,}/);
};

(async()=>{
  // A05: direct start always points to the fixed Hub login, never arbitrary return hosts.
  for (const route of [
    "/api/platform/start",
    "/api/platform/start?return=https%3A%2F%2Fevil.example%2Fsteal"
  ]) {
    const response=await request(route);
    assert.equal(response.status,302);
    assertNoSession(response);
    const url=new URL(response.headers.get("location"));
    assert.equal(url.origin,expectedHub);
    assert.equal(url.searchParams.get("return"),"tiquet");
    assert.equal(url.searchParams.has("ticket"),false);
  }
  // No ticket or malformed ticket cannot mint a managed cookie.
  for (const route of [
    "/api/platform/launch",
    "/api/platform/launch?ticket=short",
    "/api/platform/launch?ticket=%2e%2e%2fetc%2fpasswd",
    "/api/platform/launch?ticket="+"a".repeat(181)
  ]) {
    const response=await request(route);
    assert.equal(response.status,400,route);
    assertNoSession(response);
  }
  // A structurally valid, invented ticket is rejected when synthetic Hub is unavailable.
  // No genuine ticket, online Hub service or production SSO session is accessed.
  const randomFixture="synthetic_denied_hub_ticket_"+("Q".repeat(32));
  const denied=await request("/api/platform/launch?ticket="+randomFixture);
  assert.equal(denied.status,302);
  assertNoSession(denied);
  const redir=new URL(denied.headers.get("location"));
  assert.equal(redir.origin,expectedHub);
  assert.equal(redir.searchParams.get("return"),"tiquet");
  assert.equal(redir.searchParams.get("error"),"launch_denied");
  assert.equal(redir.searchParams.has("ticket"),false);
  // Protected application records stay inaccessible in a fresh anonymous request.
  for (const route of ["/api/clients","/api/jobs"]) {
    const response=await request(route);
    assert.equal(response.status,401,route);
    assertNoSession(response);
  }
  console.log("PASS: live API binary under isolated CI denied unsafe launch/direct access");
})().catch(error=>{
  console.error("FAIL: isolated Tiquet launch/direct-access contract:",error.message);
  process.exitCode=1;
});
