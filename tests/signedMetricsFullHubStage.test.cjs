// CI-only, two-running-application staging verification.
// Production endpoints, credentials, volumes, email, billing and customer
// records must NEVER be used by this test.
const assert = require("node:assert/strict");
const { createHash, createHmac, randomUUID } = require("node:crypto");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

const tiquetBase = "http://127.0.0.1:3000";
const hubBase = "http://127.0.0.1:3900";
const platformSecret = String(process.env.V79_PLATFORM_SHARED_SECRET || "");
const stagePassword = String(process.env.V79_HUB_ADMIN_PASSWORD || "");
if (process.env.V79_HUB_STORE_BACKEND !== "json" ||
    process.env.V79_REQUIRE_ADMIN_MFA !== "1" ||
    process.env.V79_TIQUET_SIGNED_METRICS_ENABLED !== "1" ||
    process.env.V79_TIQUET_STAGE_JOINT_TEST !== "1" ||
    process.env.V79_TIQUET_SOURCE_ED25519_KEY_FILE !== "/run/secrets/ci-only-tiquet-source.pem" ||
    stagePassword !== "ci-only-stage-owner-password-20261009" ||
    platformSecret !== "synthetic_stage_platform_0123456789abcdef0123456789abcdef") {
  throw Error("Refusing non-isolated or incompletely configured Hub+Tiquet staging run.");
}
const hubTotpModule = String(process.env.V79_TIQUET_CI_HUB_TOTP_PATH || "");
if (!hubTotpModule.startsWith("hub-source-stage/")) {
  throw Error("Hub MFA TOTP helper must be checked out from pinned development commit.");
}
let count = 0;
function equal(value, target, label) { assert.deepEqual(value, target, label); count++; }
async function request(base, pathname, { method="GET", headers={}, body }={}) {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(base + pathname, {
    method, redirect:"manual",
    headers:{ ...headers, ...(payload !== undefined ? {"content-type":"application/json"}:{}) },
    body:payload,
  });
  return { response, json: await response.json().catch(() => null) };
}
function signedHeaders(pathname, method, bodyText) {
  const timestamp = String(Date.now());
  const digest = createHash("sha256").update(bodyText).digest("hex");
  const canonical = [method, pathname, timestamp, digest].join("\n");
  return {
    "x-v79-service-id":"v79-hub",
    "x-v79-timestamp":timestamp,
    "x-v79-signature":createHmac("sha256", platformSecret).update(canonical).digest("hex"),
  };
}
async function platformRequest(pathname, { method="GET", body }={}) {
  const data = body === undefined ? "" : JSON.stringify(body);
  const response = await fetch(tiquetBase + pathname, {
    method, redirect:"manual",
    headers:{...signedHeaders(pathname, method, data),
      ...(body === undefined?{}:{"content-type":"application/json"})},
    body:body === undefined?undefined:data,
  });
  return { response, json:await response.json().catch(()=>null) };
}
async function main() {
  const { totpCode } = await import(pathToFileURL(resolve(hubTotpModule)).href);
  const check = await Promise.all([
    request(tiquetBase, "/health"),
    request(hubBase, "/api/health"),
  ]);
  equal(check[0].response.status,200,"Disposable Tiquet API running");
  equal(check[1].response.status,200,"Disposable Hub API running");

  const anonymous = await request(hubBase, "/api/agent/sources/tiquet/metrics");
  equal(anonymous.response.status,401,"Signed evidence is never readable without a Hub session");
  const initialInbox = await request(hubBase,"/api/agent/proposals");
  equal(initialInbox.response.status,401,"Proposal review requires Hub authentication");

  const login = await request(hubBase,"/api/auth/login",{
    method:"POST", body:{username:"admin",password:stagePassword},
  });
  equal(login.response.status,202,"Founder login requires MFA");
  equal(login.response.headers.get("set-cookie"),null,"Password-only step cannot issue owner cookie");
  equal(login.json.mfaRequired,true,"MFA challenge required");
  equal(login.json.setupRequired,true,"CI-only Hub user needs first-time TOTP");
  assert.match(login.json.secret,/^[A-Z2-7]+$/);count++;
  const bad = await request(hubBase, "/api/auth/mfa/complete-login", {
    method:"POST",body:{challengeId:login.json.challengeId,code:"bad-code"},
  });
  equal(bad.response.status,401,"Invalid MFA must not create a session");
  equal(bad.response.headers.get("set-cookie"),null,"Invalid MFA sets no cookie");

  const complete = await request(hubBase,"/api/auth/mfa/complete-login",{
    method:"POST",
    body:{challengeId:login.json.challengeId,code:totpCode(login.json.secret)},
  });
  equal(complete.response.status,200,"CI founder completes actual MFA challenge");
  equal(complete.json.user?.mfaEnabled,true,"Founder MFA is enabled");
  const rawCookie=String(complete.response.headers.get("set-cookie")||"");
  assert.match(rawCookie,/^v79_hub_session=/);count++;
  const cookie=rawCookie.split(";")[0];
  const organizationId=complete.json.organization?.id;
  assert.match(organizationId,/^[A-Za-z0-9_-]{6,96}$/);count++;

  // Signed GET before tenant provision fails closed as unavailable.
  const missing=await request(hubBase,"/api/agent/sources/tiquet/metrics",{
    headers:{cookie},
  });
  equal(missing.response.status,503,"Absent source tenant is unavailable, never mapped to default");
  equal(missing.json.status,"unavailable","Unknown is not a fabricated zero metric");

  // ONLY synthetic app provisioning in the disposable PostgreSQL container.
  const stagingTenant={
    organization:{id:organizationId,name:"Synthetic Founder Staging",
      slug:"synthetic-founder-staging"},
    user:{id:"ci-only-stage-founder-user",email:"ci-stage-owner@example.test",
      name:"Synthetic Founder"},
    role:"owner",plan:"hub",
  };
  const provision=await platformRequest("/api/platform/provision", {
    method:"POST",body:stagingTenant,
  });
  equal(provision.response.status,200,"CI-only synthetic Tiquet tenant provisioned");
  equal(provision.json.organizationId,organizationId,"Tiquet maps exact Hub organisation");

  const sourceBefore=await platformRequest("/api/platform/summary/"+organizationId);
  equal(sourceBefore.response.status,200,"Tenant-bound source summary is readable");
  const verified=await request(hubBase,"/api/agent/sources/tiquet/metrics",{
    headers:{cookie},
  });
  equal(verified.response.status,200,"Full running Hub verifies running Tiquet source signature");
  equal(verified.response.headers.get("cache-control"),"no-store","No cache for signed evidence");
  equal(verified.json.status,"available","Source is available only after signature verification");
  equal(verified.json.provenance,"source_signed","Hub labels genuinely verified provenance");
  equal(verified.json.source,"tiquet","Correct signed source");
  equal(verified.json.executionEnabled,false,"Signed evidence cannot enable execution");
  equal(verified.json.metrics.length,5,"Only five fixed aggregate counters returned");
  for(const key of ["organizationId","requestId","signature","payload","privateKey",
    "email","customerName","ticketContent"]) {
    equal(Object.hasOwn(verified.json,key),false,"Hub strips private signed-source field "+key);
  }
  const beforeMetrics=sourceBefore.json.metrics;
  for (const metric of verified.json.metrics) {
    equal(metric.value,beforeMetrics[metric.key],"Signed counter matches same-tenant source: "+metric.key);
  }

  const list=await request(hubBase,"/api/agent/proposals",{headers:{cookie}});
  equal(list.response.status,200,"Founder MFA session grants decision-only inbox");
  equal(list.json.executionEnabled,false,"Inbox never enables agent execution");
  const form={
    operation:"draft_support_reply",targetSystem:"tiquet",
    summary:"Review synthetic support queue in the staging environment",
    rationale:"Review verified aggregate support metrics before a human-only support planning decision.",
    idempotencyKey:"ci-only-plan-"+randomUUID().replaceAll("-",""),
  };
  const created=await request(hubBase,"/api/agent/proposals",{
    method:"POST",headers:{cookie,origin:hubBase},body:form,
  });
  equal(created.response.status,201,"MFA-authenticated planning proposal created in isolated Hub store");
  equal(created.json.proposal.executionStatus,"disabled","Proposal cannot dispatch");
  equal(created.json.proposal.evidenceVerification,"unverified",
    "Source-signed GET never silently upgrades independent planner evidence");
  const decision=await request(hubBase,
    "/api/agent/proposals/"+created.json.proposal.id+"/decision",{
      method:"POST",headers:{cookie,origin:hubBase},
      body:{decision:"approve",expectedRevision:1},
    });
  equal(decision.response.status,200,"Founder approves planning-only proposal");
  equal(decision.json.proposal.status,"approved","Review decision recorded");
  equal(decision.json.proposal.executionStatus,"disabled","Approval cannot dispatch downstream");
  equal(decision.json.executionEnabled,false,"Execution remains disabled globally");

  const sourceAfter=await platformRequest("/api/platform/summary/"+organizationId);
  equal(sourceAfter.response.status,200,"Signed GET and approval left app reachable");
  equal(sourceAfter.json.metrics,sourceBefore.json.metrics,
    "No Tiquet aggregate changes from Hub source read or approval decision");
  const audit=await request(hubBase,"/api/agent/approval-audit-checkpoint",{
    headers:{cookie},
  });
  equal(audit.response.status,200,"MFA-only audit checkpoint remains valid");
  equal(audit.json.count,2,"Proposal creation and decision both integrity logged");
  equal(audit.json.independentRetentionConfigured,false,
    "Independent audit anchoring not falsely claimed");

  const index = await fetch(hubBase + "/", {redirect:"manual"});
  equal(index.status,200,"Hub built frontend served during isolated staging");
  const html = await index.text();
  assert.match(html,/<(?:div|main)[^>]+id=["']root["']/i);count++;

  console.log("FULL_HUB_TIQUET_STAGING_PASS assertions="+count);
  console.log("MFA_REQUIRED; VERIFIED_ORIGINAL_SOURCE; APPROVAL_DECISION_ONLY");
  console.log("RUNNER_ONLY; TWO_REAL_APPS; DISPOSABLE_POSTGRES; NO_PRODUCTION_SECRETS");
}
main().catch(err => {
  console.error("FULL_HUB_TIQUET_STAGING_FAILED: "+err.message);
  process.exitCode=1;
});
