import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import jwt from "jsonwebtoken";
import { createHubSessionStatusChecker } from "../server/hubSessionStatus.js";
import { createTiquetAuthentication } from "../server/hubAwareAuthentication.js";
import { authorizeTiquetStaffSocket, revalidateTiquetStaffSocket } from "../server/tiquetSocketAccess.js";

const secret="synthetic-only-hub-status-signature-secret-20261018";
const key="a".repeat(64);
const identity={hubSessionId:key,organizationId:"synthetic-org-a",scopedUserId:"synthetic-hub-user-a"};

test("Hub session checker signs exactly the requested identity; no cached success or bearer transmitted", async()=>{
  let count=0;
  const transport=async(url,opts)=>{
    count++;
    assert.equal(url.pathname,"/api/platform/session/status");
    assert.equal(opts.headers["x-v79-service-id"],"v79-tiquet");
    const body=JSON.parse(opts.body);
    assert.deepEqual(body,{product:"tiquet",...identity});
    assert.doesNotMatch(opts.body,/Bearer|v79_tok_/i);
    const digest=createHash("sha256").update(opts.body).digest("hex");
    const canonical=["POST",url.pathname,opts.headers["x-v79-timestamp"],digest].join("\n");
    const expected=createHmac("sha256",secret).update(canonical).digest("hex");
    assert.equal(opts.headers["x-v79-signature"],expected);
    return {ok:true,json:async()=>({active:count===1})};
  };
  const check=createHubSessionStatusChecker({hubUrl:"http://127.0.0.1:31337",secret,transport});
  assert.equal(await check(identity),true);
  assert.equal(await check(identity),false,"no positive cache may survive Hub logout");
  assert.equal(count,2);
});

test("malformed, unauthorized, unreachable and indeterminate Hub sessions are denied",async()=>{
  const offline=createHubSessionStatusChecker({hubUrl:"http://127.0.0.1:31337",secret,transport:async()=>{throw Error("disconnected")}});
  assert.equal(await offline(identity),false);
  assert.equal(await offline({...identity,hubSessionId:"bad"}),false);
  const invalid=createHubSessionStatusChecker({hubUrl:"http://127.0.0.1:31337",secret,transport:async()=>({ok:false})});
  assert.equal(await invalid(identity),false);
  const response=createHubSessionStatusChecker({hubUrl:"http://127.0.0.1:31337",secret,transport:async()=>({ok:true,json:async()=>({active:"true"})})});
  assert.equal(await response(identity),false);
  assert.throws(()=>createHubSessionStatusChecker({hubUrl:"",secret}));
});

function fakeDb(){
  return {prepare(sql){return {async get(...params){
    if(sql.includes("FROM users"))return params[0]==="local-a" && params[1]==="account-a"?{id:"local-a",hub_user_id:identity.scopedUserId}:null;
    if(sql.includes("FROM accounts"))return params[0]==="account-a"?{status:"active",hub_organization_id:identity.organizationId}:null;
    if(sql.includes("FROM revoked_auth_tokens"))return null;
    throw Error("unexpected SQL");
  }}}};
}

test("bound HTTP token verifies its exact persisted Hub session; legacy and revoked are denied",async()=>{
  const express=(await import("express")).default;
  const host=express();
  let active=true;
  const checked=[];
  const bound=async val=>{checked.push(val);return active && val.hubSessionId===key && val.organizationId===identity.organizationId && val.scopedUserId===identity.scopedUserId;};
  host.get("/me",createTiquetAuthentication({
    jwt,jwtSecret:secret,db:fakeDb(),checkHubSubscription:async()=>true,
    checkHubSession:bound,
  }),(req,res)=>res.json({account:req.accountId}));
  const s=host.listen(0,"127.0.0.1");await new Promise(r=>s.once("listening",r));
  try {
    const origin="http://127.0.0.1:"+s.address().port;
    const sign=extra=>jwt.sign({id:"local-a",account_id:"account-a",hub_managed:true,
      hub_organization_id:identity.organizationId,...extra},secret,{expiresIn:"20m"});
    const req=token=>fetch(origin+"/me",{headers:{authorization:"Bearer "+token}});
    assert.equal((await req(sign({hub_session_id:key}))).status,200);
    active=false;
    const denied=await req(sign({hub_session_id:key}));
    assert.equal(denied.status,401);
    assert.equal((await denied.json()).code,"HUB_SESSION_INACTIVE");
    assert.equal((await req(sign({}))).status,401,"pre-migration JWT fails closed after feature opt-in");
    assert.equal((await req(sign({hub_session_id:"b".repeat(64)}))).status,401);
    assert.deepEqual(checked[0],identity);
  } finally {await new Promise(r=>s.close(r));}
});

test("Hub staff socket handshake and next heartbeat close on parent session invalidation",async()=>{
  const exp=Math.floor(Date.now()/1000)+1200;
  const decoded={id:"local-a",account_id:"account-a",hub_managed:true,hub_organization_id:identity.organizationId,
    hub_session_id:key,exp};
  const entitlement=async()=>true;
  let active=true;
  const checker=async val=>active&&val.hubSessionId===key;
  const result=await authorizeTiquetStaffSocket({decoded,db:fakeDb(),checkHubSubscription:entitlement,checkHubSession:checker});
  assert.equal(result.allowed,true);
  const socket={role:"staff",hubIdentity:result.hubIdentity,hubSessionId:result.hubSessionId,
    sessionIdentity:result.sessionIdentity,jwtExpiresAt:result.jwtExpiresAt,tokenHash:"f".repeat(64)};
  assert.equal(await revalidateTiquetStaffSocket(socket,entitlement,Date.now(),fakeDb(),checker),true);
  active=false;
  assert.equal(await revalidateTiquetStaffSocket(socket,entitlement,Date.now(),fakeDb(),checker),false);
  assert.equal((await authorizeTiquetStaffSocket({decoded:{...decoded,hub_session_id:null},db:fakeDb(),
    checkHubSubscription:entitlement,checkHubSession:checker})).allowed,false);
});
