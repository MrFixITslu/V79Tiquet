import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import pg from "pg";
import express from "express";
import jwt from "jsonwebtoken";
import {createServer} from "node:http";
import {createSupportRouter} from "../server/support/router.js";
import {createPhase4Router} from "../server/support/phase4Router.js";
import {createPhase4Service} from "../server/support/phase4Service.js";
import {createPhase6SyntheticHubAuth} from "../server/support/phase6AuthHarness.js";
import {grantsForHubRole} from "../server/support/phase6HubPolicy.js";

const uri=new URL(process.env.DATABASE_URL||"postgres://invalid/invalid");
if(process.env.CI_SUPPORT_SYNTHETIC!=="1"||process.env.NODE_ENV!=="test"||
 process.env.V79_SUPPORT_DESK_ENABLED!=="0"||
 uri.hostname!=="127.0.0.1"||uri.pathname!=="/tiquet_support_test")
 throw Error("PHASE6_HUB_ONLY_ON_LOCAL_DISPOSABLE_DB");
const pool=new pg.Pool({connectionString:uri.toString(),max:5});
const db={
 query:(s,v)=>pool.query(s,v),
 transaction:fn=>async()=>{
  const c=await pool.connect();
  try{await c.query("BEGIN");const result=await fn({query:(s,v)=>c.query(s,v)});
   await c.query("COMMIT");return result;
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 }
};
let now=Date.now(),server,base,auth;
const entitlements=new Map();
const secret="PHASE6-LOCAL-JWT-ONLY-NOT-PRODUCTION-"+("J".repeat(45));
const signatureSecret="PHASE6-LOCAL-HMAC-ONLY-NOT-PRODUCTION-"+("H".repeat(45));
const req=async(path,token,method="GET",body,options={})=>{
 const headers={"Content-Type":"application/json",...(token?{"Authorization":"Bearer "+token}:{}),...options};
 const resp=await fetch(base+"/api/support/staff"+path,{
  method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 const json=await resp.json().catch(()=>({}));
 return {status:resp.status,body:json,etag:resp.headers.get("etag")};
};
const token=(who,account="hub6A",org="org6A",roleClaim="Admin")=>
 auth.issue({id:who,accountId:account,org,roleClaim});
const resetTime=()=>{now+=2200;};
test.before(async()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../server/support");
 await pool.query("CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY)");
 await pool.query("CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,account_id TEXT,role TEXT,permissions TEXT)");
 await pool.query("CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,account_id TEXT)");
 await pool.query("CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,account_id TEXT,status TEXT,amount INTEGER)");
 await pool.query(await fs.readFile(path.join(root,"schema.sql"),"utf8"));
 await pool.query(await fs.readFile(path.join(root,"phase4-schema.sql"),"utf8"));
 const hubSql=await fs.readFile(path.join(root,"phase6-hub-schema.sql"),"utf8");
 await pool.query(hubSql);await pool.query(hubSql);
 await pool.query("INSERT INTO accounts(id) VALUES('hub6A'),('hub6B') ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO support_sla_policies(account_id,timezone) "+
  "VALUES('hub6A','America/St_Lucia'),('hub6B','America/St_Lucia') ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO users(id,account_id,role,permissions) VALUES"+
  "('hub6owner','hub6A','Member','[]'),"+
  "('hub6manager','hub6A','Member','[]'),"+
  "('hub6staff','hub6A','Admin','[\"support.view.all\"]'),"+
  "('hub6viewer','hub6A','Admin','[\"support.view.all\"]'),"+
  "('hub6foreign','hub6B','Admin','[]') ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO support_hub_context(account_id,hub_organization_id,status) VALUES"+
  "('hub6A','org6A','active'),('hub6B','org6B','active') ON CONFLICT DO NOTHING");
 for(const [uid,acc,org,hubUid,role] of [
  ["hub6owner","hub6A","org6A","h-owner","owner"],
  ["hub6manager","hub6A","org6A","h-manager","manager"],
  ["hub6staff","hub6A","org6A","h-staff","staff"],
  ["hub6viewer","hub6A","org6A","h-viewer","viewer"],
  ["hub6foreign","hub6B","org6B","h-foreign","owner"]
 ]){
  await pool.query("INSERT INTO support_hub_memberships "+
   "(user_id,account_id,hub_organization_id,hub_user_id,hub_role) VALUES($1,$2,$3,$4,$5) "+
   "ON CONFLICT DO NOTHING",[uid,acc,org,hubUid,role]);
  entitlements.set(org+":"+hubUid,true);
 }
 auth=createPhase6SyntheticHubAuth({
  db,secret,signatureSecret,entitlements,clock:()=>now});
 const phase4=createPhase4Service({db});
 const app=express();
 app.disable("x-powered-by");
 app.use(express.json({limit:"12kb"}));
 // The SSO simulator accepts only loopback HTTP and blocks cross-origin writes.
 app.use((request,response,next)=>{
  const origin=request.headers.origin;
  if(origin!==undefined&&origin!=="http://127.0.0.1:4090")
   return response.status(403).json({code:"ORIGIN_BLOCKED"});
  next();
 });
 const shared={db,authenticateToken:auth.authenticateToken,
  resolveCapabilities:auth.resolveCapabilities};
 app.use("/api/support/staff/phase4",createPhase4Router({...shared,service:phase4}));
 app.use("/api/support/staff",createSupportRouter({...shared,phase4Hooks:phase4}));
 server=createServer(app);
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 base="http://127.0.0.1:"+server.address().port;
});
test.after(async()=>{
 if(server)await new Promise(resolve=>server.close(resolve));
 await pool.end();
});
test("synthetic Hub role mapping is least privilege and fails for unknown roles",()=>{
 assert.equal(grantsForHubRole("owner").role,"Admin");
 assert.equal(grantsForHubRole("viewer").permissions.includes("support.view.all"),false);
 assert.equal(grantsForHubRole("staff").permissions.includes("support.view.all"),false);
 assert.equal(grantsForHubRole("manager").permissions.includes("support.view.all"),true);
 assert.equal(grantsForHubRole("manager").permissions.includes("support.reply"),false);
 assert.throws(()=>grantsForHubRole("superadmin"),/HUB_ROLE_UNSUPPORTED/);
});
test("same production Hub-aware auth validates JWT, signed HMAC and exact entitlement scope",async()=>{
 const startCalls=auth.hubCalls();
 const unauthorized=await req("/tickets");
 assert.equal(unauthorized.status,401);
 const expired=jwt.sign({id:"hub6owner",account_id:"hub6A",
  hub_organization_id:"org6A",hub_managed:true,exp:Math.floor(Date.now()/1000)-20},
  secret,{algorithm:"HS256",issuer:"tiquet-phase6-synthetic",
   audience:"tiquet-support-sandbox"});
 assert.equal((await req("/tickets",expired)).status,403);
 const noOrg=jwt.sign({id:"hub6owner",account_id:"hub6A",hub_managed:true},
  secret,{algorithm:"HS256",issuer:"tiquet-phase6-synthetic",
   audience:"tiquet-support-sandbox",expiresIn:"15m"});
 assert.equal((await req("/tickets",noOrg)).status,403);
 const issuerWrong=jwt.sign({id:"hub6owner",account_id:"hub6A",
  hub_organization_id:"org6A",hub_managed:true},
  secret,{algorithm:"HS256",issuer:"another-application",audience:"tiquet-support-sandbox"});
 assert.equal((await req("/tickets",issuerWrong)).status,403);
 const forged="eyJhbGciOiJub25lIn0.eyJpZCI6Imh1YjZvd25lciJ9.";
 assert.equal((await req("/tickets",forged)).status,403);
 const wrongOrg=token("hub6owner","hub6A","org6B");
 assert.equal((await req("/tickets",wrongOrg)).status,403);
 const wrongTenant=token("hub6owner","hub6B","org6B");
 assert.equal((await req("/tickets",wrongTenant)).status,401);
 const valid=token("hub6owner");
 const result=await req("/tickets",valid);
 assert.equal(result.status,200,JSON.stringify(result));
 assert.ok(auth.hubCalls()>startCalls,"signed mock Hub lookup required");
 const cookie=await req("/tickets",null,"GET",undefined,
  {Cookie:"tiquet_session="+encodeURIComponent(valid)});
 assert.equal(cookie.status,200);
 const prohibited=await req("/tickets",valid,"POST",
  {subject:"Synthetic CSRF check"},{Origin:"https://evil.example.invalid",
   "Idempotency-Key":"hub6_origin_bad_01"});
 assert.equal(prohibited.status,403);
});
test("stored synthetic Hub role overrides forged JWT Admin and legacy Admin DB role",async()=>{
 const owner=token("hub6owner"),viewer=token("hub6viewer"),staff=token("hub6staff");
 const created=await req("/tickets",owner,"POST",{subject:"Owner private synthetic case"},
  {"Idempotency-Key":"hub6_owner_0001"});
 assert.equal(created.status,201,JSON.stringify(created));
 const id=created.body.id;
 const view=await req("/tickets",viewer);
 assert.equal(view.status,200);
 assert.equal(view.body.items.some(x=>x.id===id),false);
 assert.equal((await req("/tickets/"+id,viewer)).status,404);
 const viewerCreate=await req("/tickets",viewer,"POST",{subject:"Must not create"},
  {"Idempotency-Key":"hub6_viewer_0001"});
 assert.equal(viewerCreate.status,403);
 assert.equal((await req("/tickets/"+id,staff)).status,404);
 const manager=await req("/tickets",token("hub6manager"));
 assert.equal(manager.status,200);
 assert.ok(manager.body.items.some(t=>t.id===id),"manager all-view grant from Hub role");
 const realStaffCase=await req("/tickets",staff,"POST",
  {subject:"Staff-owned synthetic case"},{"Idempotency-Key":"hub6_staff_0001"});
 assert.equal(realStaffCase.status,201,JSON.stringify(realStaffCase));
 assert.equal((await req("/tickets/"+realStaffCase.body.id,staff)).status,200);
});
test("Hub role changes and removal take effect on next request, not stale JWT",async()=>{
 const owner=token("hub6owner");
 const baseline=await req("/tickets",owner);
 assert.equal(baseline.status,200);
 await pool.query("UPDATE support_hub_memberships SET hub_role='viewer' WHERE user_id='hub6owner'");
 assert.equal((await req("/tickets",owner,"POST",{subject:"Privilege withdrawn"},
  {"Idempotency-Key":"hub6_demoted_0001"})).status,403);
 await pool.query("UPDATE support_hub_memberships SET hub_role='owner' WHERE user_id='hub6owner'");
 assert.equal((await req("/tickets",owner)).status,200);
});
test("suspended account, revoked session and Hub subscription denial all fail closed",async()=>{
 const foreign=token("hub6foreign","hub6B","org6B");
 assert.equal((await req("/tickets",foreign)).status,200);
 await pool.query("UPDATE support_hub_context SET status='suspended' WHERE account_id='hub6B'");
 assert.equal((await req("/tickets",foreign)).status,402);
 await pool.query("UPDATE support_hub_context SET status='active' WHERE account_id='hub6B'");
 await auth.revoke({token:foreign,accountId:"hub6B"});
 const revoked=await req("/tickets",foreign);
 assert.equal(revoked.status,401);assert.equal(revoked.body.code,"SESSION_REVOKED");
 const owner=token("hub6owner");
 assert.equal((await req("/tickets",owner)).status,200);
 entitlements.set("org6A:h-owner",false);resetTime();
 const denied=await req("/tickets",owner);
 assert.equal(denied.status,403);assert.equal(denied.body.code,"HUB_ENTITLEMENT_REVOKED");
 entitlements.set("org6A:h-owner",true);resetTime();
 assert.equal((await req("/tickets",owner)).status,200);
});
test("Phase 4 routes use the same Hub roles and mock entitlement",async()=>{
 const viewer=token("hub6viewer"),owner=token("hub6owner");
 const calendar=await req("/phase4/calendar",viewer);
 assert.equal(calendar.status,200);assert.equal(calendar.body.timezone,"America/St_Lucia");
 const own=await req("/tickets",owner,"POST",
  {subject:"SLA synthetic owner case"},{"Idempotency-Key":"hub6_sla_case01"});
 assert.equal(own.status,201);
 assert.equal((await req("/phase4/tickets/"+own.body.id+"/sla",viewer)).status,404);
 const ownerSla=await req("/phase4/tickets/"+own.body.id+"/sla",owner);
 assert.equal(ownerSla.status,200);
 assert.equal(ownerSla.body.source,"synthetic");
 const manager=token("hub6manager");
 const evaluated=await req("/phase4/tickets/"+own.body.id+"/automations/evaluate",
  manager,"POST",{});
 assert.equal(evaluated.status,200);
 assert.equal(evaluated.body.notificationsSent,0);
 const restricted=await req("/phase4/tickets/"+own.body.id+"/automations/evaluate",
  viewer,"POST",{});
 assert.equal(restricted.status,403);
});
