import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { consumeHubLaunchTicket } from "../server/hubAccess.js";

// All tests use a mocked fetch; no real Hub, browser session, user, DB or provider calls.
const secret = "synthetic-only-ci-launch-secret-32-plus-chars";
const baseUrl = "http://127.0.0.1:65530";
const ticket = "ci-synthetic-launch-token-not-live-000001";

function configure(t, {url=baseUrl, key=secret}={}) {
  const vars = ["V79_HUB_INTERNAL_URL", "V79_TIQUET_LAUNCH_SECRET"];
  const original = Object.fromEntries(vars.map(k=>[k, process.env[k]]));
  process.env.V79_HUB_INTERNAL_URL = url;
  process.env.V79_TIQUET_LAUNCH_SECRET = key;
  t.after(()=>{
    for(const k of vars) {
      if(original[k]===undefined) delete process.env[k];
      else process.env[k]=original[k];
    }
  });
}
function httpResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status,
    json: async()=>payload };
}
const granted = {
  entitlement: {product:"tiquet",enabled:true},
  organization:{id:"org-synthetic"},
  user:{id:"user-synthetic"}
};

test("valid ticket consumes only signed exact Hub endpoint and intended product", async t => {
  configure(t);
  let calls=0;
  t.mock.method(globalThis, "fetch", async (url, opts)=>{
    calls++;
    assert.equal(String(url), baseUrl+"/api/platform/session/consume");
    assert.equal(opts.method,"POST");
    assert.equal(opts.headers["x-v79-service-id"],"v79-tiquet");
    assert.match(opts.headers["x-v79-timestamp"],/^[0-9]{13}$/);
    assert.equal(JSON.parse(opts.body).ticket,ticket);
    assert.equal(JSON.parse(opts.body).product,"tiquet");
    const digest=createHash("sha256").update(opts.body).digest("hex");
    const payload=[
      "POST","/api/platform/session/consume",
      opts.headers["x-v79-timestamp"],digest
    ].join("\n");
    const actualSignature=createHmac("sha256",secret).update(payload).digest("hex");
    assert.equal(opts.headers["x-v79-signature"],actualSignature);
    assert.ok(opts.signal);
    return httpResponse(200,granted);
  });
  assert.deepEqual(await consumeHubLaunchTicket(ticket),granted);
  assert.equal(calls,1);
});

test("missing internal Hub URL fails before network call", async t => {
  configure(t,{url:""});
  const stub=t.mock.method(globalThis,"fetch",async()=>{throw Error("network call unexpected");});
  await assert.rejects(consumeHubLaunchTicket(ticket),/V79_HUB_INTERNAL_URL/);
  assert.equal(stub.mock.callCount(),0);
});

test("weak launch secret fails before network call", async t => {
  configure(t,{key:"too-short"});
  const stub=t.mock.method(globalThis,"fetch",async()=>{throw Error("network call unexpected");});
  await assert.rejects(consumeHubLaunchTicket(ticket),/at least 32/);
  assert.equal(stub.mock.callCount(),0);
});

test("Hub rejection of consumed, expired and wrong-org tickets never returns identity", async t => {
  configure(t);
  for (const {status,error} of [
    {status:409,error:"Ticket already consumed"},
    {status:410,error:"Ticket expired"},
    {status:403,error:"Wrong organization"}
  ]) {
    t.mock.method(globalThis,"fetch",async()=>httpResponse(status,{error}));
    await assert.rejects(consumeHubLaunchTicket(ticket),new RegExp(error));
    t.mock.restoreAll();
  }
  // Only verifies Tiquet propagation of Hub-denied responses, NOT Hub one-time semantics.
});

test("non-Tiquet and disabled entitlements fail closed", async t => {
  configure(t);
  for(const entitlement of [
    {product:"pos",enabled:true},
    {product:"tiquet",enabled:false},
    null,
    {}
  ]) {
    t.mock.method(globalThis,"fetch",async()=>httpResponse(200,{entitlement}));
    await assert.rejects(consumeHubLaunchTicket(ticket),/entitlement was not granted/);
    t.mock.restoreAll();
  }
});

test("Hub server outage and malformed JSON never yield a valid Tiquet identity", async t => {
  configure(t);
  t.mock.method(globalThis,"fetch",async()=>{throw new Error("simulated network unavailable");});
  await assert.rejects(consumeHubLaunchTicket(ticket),/simulated network unavailable/);
  t.mock.restoreAll();
  t.mock.method(globalThis,"fetch",async()=>({
    ok:true,status:200,json:async()=>{throw SyntaxError("synthetic bad JSON");}
  }));
  await assert.rejects(consumeHubLaunchTicket(ticket),/entitlement was not granted/);
});
