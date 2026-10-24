import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import fs from "node:fs/promises";
import pg from "pg";
import jwt from "jsonwebtoken";
import express from "express";
import {createServer} from "node:http";
import {createPhase6SyntheticHubAuth} from "../server/support/phase6AuthHarness.js";
import {createSupportRouter} from "../server/support/router.js";
import {createPhase4Router} from "../server/support/phase4Router.js";
import {createPhase4Service} from "../server/support/phase4Service.js";
// These are the ACTUAL pinned Hub modules checked out by GitHub Actions.
// No Hub production servers or credentials are accessed.
import {verifyPlatformRequest,signPlatformRequest} from "../phase7-hub-source/server/platform-contract.mjs";
import {validateProductEntitlement} from "../phase7-hub-source/server/entitlement-validation.mjs";
import {beginTrial} from "../phase7-hub-source/server/subscription-access.mjs";
import {tiquetTenantLaunchReady,activateTiquetTenantMapping} from "../phase7-hub-source/server/tiquet-provisioning.mjs";
const u=new URL(process.env.DATABASE_URL||"postgresql://invalid/invalid");
if(process.env.NODE_ENV!=="test"||process.env.CI_SUPPORT_SYNTHETIC!=="1"||
 process.env.V79_SUPPORT_DESK_ENABLED!=="0"||u.hostname!=="127.0.0.1"||
 u.pathname!=="/tiquet_support_test"||process.env.CI_SUPPORT_PAIRED_PINNED!=="1"||
 process.env.GITHUB_ACTIONS!=="true")
 throw Error("PHASE7_PINNED_HUB_DISPOSABLE_ONLY");
const expectedHubSha="ee79ec9353ee4248eb8276fee2e6c3476b3af491";
const revision=(await fs.readFile("phase7-hub-source/.git/HEAD","utf8")).trim();
assert.equal(revision,expectedHubSha,"CI must checkout exactly pinned Hub commit");
const pool=new pg.Pool({connectionString:u.toString(),max:5});
const db={
 query:(s,v)=>pool.query(s,v),
 transaction:fn=>async()=>{const c=await pool.connect();
  try{await c.query("BEGIN");const result=await fn({query:(s,v)=>c.query(s,v)});
   await c.query("COMMIT");return result;
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 }
};
const secret="PHASE7-SYNTHETIC-JWT-NOT-LIVE-"+("A".repeat(50));
const serviceSecret="PHASE7-SYNTHETIC-HUB-SERVICE-SECRET-"+("B".repeat(50));
let clock=Date.now(),hubServer,appServer,hubBase,appBase,auth,hubChecks=0;
const ownerOrgId="p7-internal-owner";
const scoped=new Map(),enabled=new Map(),hubStore={
 organizations:[{id:"p7orgA",status:"active"},{id:"p7orgB",status:"active"}],
 memberships:[
  {userId:"p7-owner-A",organizationId:"p7orgA",status:"active",role:"owner"},
  {userId:"p7-viewer-A",organizationId:"p7orgA",status:"active",role:"viewer"},
  {userId:"p7-owner-B",organizationId:"p7orgB",status:"active",role:"owner"}
 ],
 organizationPlans:[],
 appEntitlements:[
  {organizationId:"p7orgA",appId:"app-tiquet",enabled:true},
  {organizationId:"p7orgB",appId:"app-tiquet",enabled:true}
 ],
 appTenantMappings:[
  {organizationId:"p7orgA",appId:"app-tiquet",status:"active",externalTenantId:"p7A",externalOwnerId:"p7ownerA"},
  {organizationId:"p7orgB",appId:"app-tiquet",status:"active",externalTenantId:"p7B",externalOwnerId:"p7ownerB"}
 ]
};
const lookup=[
 ["p7ownerA","p7A","p7orgA","p7-owner-A","owner"],
 ["p7viewerA","p7A","p7orgA","p7-viewer-A","viewer"],
 ["p7ownerB","p7B","p7orgB","p7-owner-B","owner"]
];
for(const [id,,org,hubId] of lookup){
 const ident="scoped-"+createHash("sha256").update(org+":"+hubId).digest("hex").slice(0,24);
 scoped.set(org+":"+hubId,ident);enabled.set(org+":"+ident,true);
}
hubStore.organizationPlans=[
 {organizationId:"p7orgA",...beginTrial(clock-60000)},
 {organizationId:"p7orgB",...beginTrial(clock-60000)}
];
function evaluateHub(body){
 return validateProductEntitlement(hubStore,{
  ...body,ownerOrganizationId:ownerOrgId,now:clock,
  resolveScopedUserId:(hubId,org)=>scoped.get(org+":"+hubId),
  memberCanAccessApp:m=>m.status==="active",
  roleEligible:(_product,role)=>["owner","manager","staff","viewer"].includes(role),
  tenantReady:(_product,org)=>{
   const m=hubStore.appTenantMappings.find(x=>x.organizationId===org&&x.appId==="app-tiquet");
   return !!m&&m.status==="active"&&!!m.externalTenantId&&!!m.externalOwnerId;
  }
 });
}
async function fetchTiquet(url,token,options={}){
 const r=await fetch(appBase+"/api/support/staff"+url,{
  method:options.method||"GET",
  headers:{...(token?{Authorization:"Bearer "+token}:{}),...(options.headers||{})},
  body:options.body?JSON.stringify(options.body):undefined,redirect:"manual",
  signal:AbortSignal.timeout(4000)});
 return {status:r.status,body:await r.json().catch(()=>({}))};
}
test.before(async()=>{
 const hubApp=express();
 hubApp.disable("x-powered-by");
 hubApp.post("/api/platform/entitlement/check",express.raw({type:"application/json",limit:"8kb"}),(req,res)=>{
  const body=req.body.toString("utf8");
  if(req.headers.host!==new URL(hubBase).host)
   return res.status(403).json({allowed:false});
  if(req.get("x-v79-service-id")!=="v79-tiquet"||
    !verifyPlatformRequest({method:"POST",pathname:req.path,
      timestamp:req.get("x-v79-timestamp"),signature:req.get("x-v79-signature"),
      body,secret:serviceSecret}))
   return res.status(401).json({allowed:false,validForSeconds:0});
  hubChecks++;
  const data=JSON.parse(body);
  if(data.product!=="tiquet"||typeof data.organizationId!=="string"||
    typeof data.scopedUserId!=="string")
   return res.status(400).json({allowed:false,validForSeconds:0});
  res.set("Cache-Control","no-store");res.json(evaluateHub(data));
 });
 hubServer=createServer(hubApp);
 await new Promise(ok=>hubServer.listen(0,"127.0.0.1",ok));
 hubBase="http://127.0.0.1:"+hubServer.address().port;
 for(const row of await Promise.all([
  fs.readFile("server/support/schema.sql","utf8"),
  fs.readFile("server/support/phase4-schema.sql","utf8"),
  fs.readFile("server/support/phase6-hub-schema.sql","utf8")
 ]))await pool.query(row);
 for(const [user,account,org,hubId,role] of lookup){
  await pool.query("INSERT INTO accounts(id) VALUES($1) ON CONFLICT DO NOTHING",[account]);
  await pool.query("INSERT INTO users(id,account_id,role,permissions) VALUES($1,$2,'Member','[]') ON CONFLICT DO NOTHING",[user,account]);
  await pool.query("INSERT INTO support_hub_context(account_id,hub_organization_id,status) VALUES($1,$2,'active') ON CONFLICT DO NOTHING",[account,org]);
  await pool.query("INSERT INTO support_hub_memberships(account_id,user_id,hub_organization_id,hub_user_id,hub_role) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
   [account,user,org,scoped.get(org+":"+hubId),role]);
 }
 await pool.query("INSERT INTO support_sla_policies(account_id,timezone) VALUES"+
  "('p7A','America/St_Lucia'),('p7B','America/St_Lucia') ON CONFLICT DO NOTHING");
 auth=createPhase6SyntheticHubAuth({db,secret,signatureSecret:serviceSecret,
  entitlements:enabled,clock:()=>clock,hubUrl:hubBase,httpTransport:fetch});
 const tiquetApp=express();tiquetApp.use(express.json({limit:"12kb"}));
 const p4=createPhase4Service({db});
 const x={db,authenticateToken:auth.authenticateToken,resolveCapabilities:auth.resolveCapabilities};
 tiquetApp.use("/api/support/staff/phase4",createPhase4Router({...x,service:p4}));
 tiquetApp.use("/api/support/staff",createSupportRouter({...x,phase4Hooks:p4}));
 appServer=createServer(tiquetApp);
 await new Promise(ok=>appServer.listen(0,"127.0.0.1",ok));
 appBase="http://127.0.0.1:"+appServer.address().port;
});
test.after(async()=>{
 if(appServer)await new Promise(ok=>appServer.close(ok));
 if(hubServer)await new Promise(ok=>hubServer.close(ok));
 await pool.end();
});
const token=(who,acc,org)=>auth.issue({id:who,accountId:acc,org});
test("pinned actual Hub modules and real Tiquet signed sessions meet over loopback HTTP",async()=>{
 const a=token("p7ownerA","p7A","p7orgA");
 const b=token("p7ownerB","p7B","p7orgB");
 assert.equal((await fetchTiquet("/tickets",a)).status,200);
 assert.equal((await fetchTiquet("/tickets",b)).status,200);
 assert.ok(hubChecks>=2);
 const create=await fetchTiquet("/tickets",a,{method:"POST",
  headers:{"Content-Type":"application/json","Idempotency-Key":"p7_source_0001"},
  body:{subject:"Cross-app synthetic support ticket"}});
 assert.equal(create.status,201);
 assert.equal((await fetchTiquet("/tickets/"+create.body.id,b)).status,404);
 assert.equal((await fetchTiquet("/tickets",a)).body.items[0].accountId,"p7A");
 assert.equal((await fetchTiquet("/tickets",a.slice(0,-1)+"x")).status,403);
});
test("Hub HMAC signature, body and timestamp binding reject tampering",async()=>{
 const endpoint=hubBase+"/api/platform/entitlement/check";
 const body=JSON.stringify({product:"tiquet",organizationId:"p7orgA",
  scopedUserId:scoped.get("p7orgA:p7-owner-A")});
 const time=String(Date.now());
 const make=(contents,stamp,signature)=>{
  return fetch(endpoint,{method:"POST",headers:{"content-type":"application/json",
   "x-v79-service-id":"v79-tiquet","x-v79-timestamp":stamp,
   "x-v79-signature":signature},body:contents});
 };
 const signature=signPlatformRequest({method:"POST",
  pathname:"/api/platform/entitlement/check",timestamp:time,body,secret:serviceSecret});
 assert.equal((await make(body,time,signature)).status,200);
 assert.equal((await make(body.replace("p7orgA","p7orgB"),time,signature)).status,401);
 assert.equal((await make(body,String(Date.now()-600000),signature)).status,401);
 const altered=(signature[0]==="a"?"b":"a")+signature.slice(1);
 assert.equal((await make(body,time,altered)).status,401);
});
test("Hub plan, membership, mapping and entitlement changes revoke access after bounded cache",async()=>{
 const a=token("p7ownerA","p7A","p7orgA");
 assert.equal((await fetchTiquet("/tickets",a)).status,200);
 const plan=hubStore.organizationPlans.find(x=>x.organizationId==="p7orgA");
 plan.status="cancelled";clock+=31000;
 assert.equal((await fetchTiquet("/tickets",a)).status,403);
 plan.status="trial";clock+=31000;
 assert.equal((await fetchTiquet("/tickets",a)).status,200);
 const member=hubStore.memberships.find(x=>x.userId==="p7-owner-A");
 member.status="revoked";clock+=31000;
 assert.equal((await fetchTiquet("/tickets",a)).status,403);
 member.status="active";clock+=31000;
 assert.equal((await fetchTiquet("/tickets",a)).status,200);
 const mapping=hubStore.appTenantMappings[0];
 mapping.status="pending";clock+=31000;
 assert.equal((await fetchTiquet("/tickets",a)).status,403);
 mapping.status="active";clock+=31000;
 assert.equal((await fetchTiquet("/tickets",a)).status,200);
});
test("pinned Hub provisioning mappings agree with synthetic Tiquet account and reject misbinding",()=>{
 assert.equal(tiquetTenantLaunchReady(hubStore,"p7orgA",ownerOrgId),true);
 assert.equal(tiquetTenantLaunchReady(hubStore,"p7orgB",ownerOrgId),true);
 const next=activateTiquetTenantMapping({...hubStore,auditEvents:[]},
  "p7orgA","p7orgA","p7A","p7ownerA","p7ownerA");
 const match=next.appTenantMappings.find(x=>x.organizationId==="p7orgA");
 assert.equal(match.externalTenantId,"p7A");
 assert.equal(match.externalOwnerId,"p7ownerA");
 assert.throws(()=>activateTiquetTenantMapping({...hubStore,auditEvents:[]},
  "p7orgA","p7orgB","p7A","p7ownerA","p7ownerA"),/organization identity mismatch/);
 assert.throws(()=>activateTiquetTenantMapping({...hubStore,auditEvents:[]},
  "p7orgA","p7orgA","p7B","p7ownerA","p7ownerA"),/conflicts/);
});
test("role demotion, wrong organization, revocation and unrelated tenant survive",async()=>{
 const a=token("p7ownerA","p7A","p7orgA");
 const b=token("p7ownerB","p7B","p7orgB");
 assert.equal((await fetchTiquet("/tickets",a)).status,200);
 const viewer=token("p7viewerA","p7A","p7orgA");
 const deny=await fetchTiquet("/tickets",viewer,{method:"POST",
  headers:{"Content-Type":"application/json","Idempotency-Key":"p7_viewer_01"},
  body:{subject:"Must not create"}});
 assert.equal(deny.status,403);
 await pool.query("UPDATE support_hub_memberships SET hub_role='viewer' WHERE user_id='p7ownerA'");
 const attempt=await fetchTiquet("/tickets",a,{method:"POST",
  headers:{"Content-Type":"application/json","Idempotency-Key":"p7_demoted_01"},
  body:{subject:"Demoted member cannot create"}});
 assert.equal(attempt.status,403);
 await pool.query("UPDATE support_hub_memberships SET hub_role='owner' WHERE user_id='p7ownerA'");
 assert.equal((await fetchTiquet("/tickets",token("p7ownerA","p7A","p7orgB"))).status,403);
 await auth.revoke({token:a,accountId:"p7A"});
 assert.equal((await fetchTiquet("/tickets",a)).status,401);
 assert.equal((await fetchTiquet("/tickets",b)).status,200);
});
console.log("SUPPORT_P7_PINNED_REAL_HUB_MODULES_AND_LOOPBACK_SSO_TESTS=EXECUTED");
