import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";
import { createServer } from "node:http";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createTiquetAuthentication } from "../server/hubAwareAuthentication.js";
import { createHubEntitlementChecker } from "../server/hubEntitlementRevalidation.js";

test("Tiquet actual JWT route rechecks mapped customer and revokes existing sessions",async t => {
  const shared="tiquet-staging-runtime-secret-123456789";
  const jwtSecret="tiquet-local-jwt-staging-test-secret";
  const users={
    "account-a":{id:"user-a",hub_user_id:"scoped-user-a"},
    "account-b":{id:"user-b",hub_user_id:"scoped-user-b"},
  };
  const accounts={
    "account-a":{status:"active",hub_organization_id:"org-a"},
    "account-b":{status:"active",hub_organization_id:"org-b"},
  };
  let revokeA=false,offline=false,verifiedChecks=0;
  const hub=createServer(async(req,res)=>{
    if(offline){res.writeHead(503);return res.end("{}");}
    const parts=[];for await(const x of req)parts.push(x);
    const body=Buffer.concat(parts).toString("utf8");
    const stamp=String(req.headers["x-v79-timestamp"]||"");
    const h=createHash("sha256").update(body).digest("hex");
    const expected=createHmac("sha256",shared).update(["POST",req.url,stamp,h].join("\n")).digest("hex");
    const a=Buffer.from(expected,"hex"),b=Buffer.from(String(req.headers["x-v79-signature"]||""),"hex");
    if (a.length!==b.length || !timingSafeEqual(a,b) ||
        req.headers["x-v79-service-id"]!=="v79-tiquet") {
      res.writeHead(401);return res.end("{}");
    }
    verifiedChecks++;
    const p=JSON.parse(body);
    const allowed=p.product==="tiquet" && (
      (p.organizationId==="org-a" && p.scopedUserId==="scoped-user-a" && !revokeA) ||
      (p.organizationId==="org-b" && p.scopedUserId==="scoped-user-b")
    );
    res.writeHead(200,{"content-type":"application/json"});
    res.end(JSON.stringify({allowed,validForSeconds:allowed?1:0}));
  });
  await new Promise(resolve=>hub.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>hub.close(resolve)));
  const check=createHubEntitlementChecker({
    product:"tiquet",
    hubUrl:"http://127.0.0.1:"+hub.address().port,
    secret:shared,
  });
  const db={ prepare(query) {
    return { async get(...values){
      if(query.includes("FROM users")) {
        const r=users[values[1]];
        return r?.id===values[0] ? r : undefined;
      }
      if(query.includes("FROM accounts")) return accounts[values[0]];
      throw new Error("Unexpected query");
    }};
  }};
  const app=express();
  app.get("/api/protected",createTiquetAuthentication({
    db,jwt,jwtSecret,checkHubSubscription:check,
  }),(req,res)=>res.json({accountId:req.accountId}));
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin="http://127.0.0.1:"+server.address().port;
  const token=(id,accountId,org)=>jwt.sign({
    id,account_id:accountId,hub_organization_id:org,hub_managed:true,
  },jwtSecret,{expiresIn:"8h"});
  const aToken=token("user-a","account-a","org-a");
  const bToken=token("user-b","account-b","org-b");
  const request=async(tok,asCookie=false)=>fetch(origin+"/api/protected",{
    headers: asCookie ? {cookie:"tiquet_session="+encodeURIComponent(tok)}:
      {authorization:"Bearer "+tok},
  });
  assert.equal((await request(aToken)).status,200,"A valid Hub-managed user has access");
  assert.equal((await request(bToken,true)).status,200,"B has independent access via session cookie");
  assert.ok(verifiedChecks>=2,"signed Hub validation used");
  const spoof=token("user-a","account-a","org-b");
  assert.equal((await request(spoof)).status,403,"token cannot switch tenant");
  accounts["account-a"].hub_organization_id=null;
  assert.equal((await request(aToken)).status,403,"missing account mapping denied");
  accounts["account-a"].hub_organization_id="org-a";
  accounts["account-a"].hub_organization_id=null;
  users["account-a"].hub_user_id=null;
  const noHubToken=jwt.sign({id:"user-a",account_id:"account-a"},jwtSecret,{expiresIn:"8h"});
  const localDenied=await request(noHubToken);
  assert.equal(localDenied.status,403,"old local JWT cannot bypass Hub enforcement");
  assert.equal((await localDenied.json()).code,"HUB_IDENTITY_REQUIRED");
  users["account-a"].hub_user_id="scoped-user-a";
  accounts["account-a"].hub_organization_id="org-a";
  accounts["account-a"].status="suspended";
  assert.equal((await request(aToken)).status,402,"suspension beats cached entitlement");
  accounts["account-a"].status="active";
  await new Promise(resolve=>setTimeout(resolve,1100));
  revokeA=true;
  assert.equal((await request(aToken)).status,403,"revocation applied to existing 8h JWT");
  assert.equal((await request(bToken)).status,200,"B unaffected by A revocation");
  await new Promise(resolve=>setTimeout(resolve,1100));
  offline=true;
  assert.equal((await request(bToken)).status,403,"Hub outage fails closed");
  accounts["account-b"]=undefined;
  assert.equal((await request(bToken)).status,401,"deleted account rejected");
  assert.equal((await request("invalid.jwt.token")).status,403,"invalid JWT rejected");
  const noAuth=await fetch(origin+"/api/protected");
  assert.equal(noAuth.status,401,"anonymous blocked");
});
