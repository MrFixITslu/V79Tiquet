import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import express from "express";
import { createTiquetAuthentication } from "../server/hubAwareAuthentication.js";
import { isSignedSessionRevoked, isTokenFingerprintRevoked, tokenFingerprint,
  getRequestSessionTokens, revokeSignedRequestTokens } from "../server/tokenRevocation.js";

const jwtSecret="isolated-fixture-only-jwt-secret-20261015";
const claims=(account="account-a",user="user-a",org="org-a")=>({
  id:user,account_id:account,hub_managed:true,hub_organization_id:org,
});
const issue=(account,user,org)=>jwt.sign(claims(account,user,org),jwtSecret,
  {expiresIn:"30m",jwtid:"synthetic-"+Math.random().toString(36).slice(2)});
const fixture=()=>{
  // Shared data makes separate mock database connections observe the same
  // committed, durable revocations. No production DB/network is consulted.
  const storage=new Map();
  const users=new Map([
    ["account-a",{id:"user-a",hub_user_id:"scoped-a"}],
    ["account-b",{id:"user-b",hub_user_id:"scoped-b"}],
  ]);
  const accounts=new Map([
    ["account-a",{status:"active",hub_organization_id:"org-a"}],
    ["account-b",{status:"active",hub_organization_id:"org-b"}],
  ]);
  const db={ prepare(sql) {
    return {
      async get(...args) {
        if(sql.includes("FROM revoked_auth_tokens")){
          const entry=storage.get(args[0]);
          return entry?.exp>args[1] ? {token_hash:args[0]} : undefined;
        }
        if(sql.includes("FROM users")){
          const entry=users.get(args[1]);
          return entry?.id===args[0]?entry:undefined;
        }
        if(sql.includes("FROM accounts")) return accounts.get(args[0]);
        throw Error("Unexpected SELECT in synthetic DB");
      },
      async run(...args){
        if(sql.startsWith("INSERT INTO revoked_auth_tokens")){
          if(!storage.has(args[0]))storage.set(args[0],{account:args[1],exp:args[2]});
          return{changes:1};
        }
        if(sql.startsWith("DELETE FROM revoked_auth_tokens")){
          for(const [key,value] of storage)if(value.exp<=args[0])storage.delete(key);
          return{changes:1};
        }
        throw Error("Unexpected write in synthetic DB");
      }
    };
  }};
  return{db,storage,users,accounts};
};
async function serverFor(t,db){
  const app=express();
  app.get("/protected",createTiquetAuthentication({
    jwt,jwtSecret,db,
    checkHubSubscription:async identity=>identity.organizationId==="org-a"||
      identity.organizationId==="org-b"
  }),(req,res)=>res.json({id:req.user.id,accountId:req.accountId}));
  app.post("/logout",async(req,res)=>{
    try{await revokeSignedRequestTokens({req,jwt,jwtSecret,db});
      res.setHeader("Set-Cookie","tiquet_session=; HttpOnly; Path=/; Max-Age=0");
      res.json({ok:true});
    }catch{res.status(503).json({ok:false,code:"SESSION_REVOCATION_UNAVAILABLE"});}
  });
  const server=app.listen(0,"127.0.0.1");
  await new Promise(resolve=>server.once("listening",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  return"http://127.0.0.1:"+server.address().port;
}
const req=(url,token,asCookie=false,options={})=>fetch(url,{
  ...options,headers:{
    ...(asCookie?{cookie:"tiquet_session="+encodeURIComponent(token)}:{authorization:"Bearer "+token}),
    ...(options.headers||{}),
  }
});

test("copied bearer and cookie are rejected after database-backed logout, other tenant unaffected",async t=>{
  const {db,storage}=fixture(),origin=await serverFor(t,db);
  const a=issue("account-a","user-a","org-a");
  const b=issue("account-b","user-b","org-b");
  assert.equal((await req(origin+"/protected",a)).status,200);
  assert.equal((await req(origin+"/protected",b,true)).status,200);
  const logout=await req(origin+"/logout",a,true,{method:"POST"});
  assert.equal(logout.status,200);
  assert.equal((await logout.json()).ok,true);
  assert.match(logout.headers.get("set-cookie"),/Max-Age=0/);
  assert.equal(storage.size,1);
  assert.ok(storage.has(tokenFingerprint(a)));
  assert.equal((await req(origin+"/protected",a)).status,401,"copied bearer cannot bypass logout");
  assert.equal((await req(origin+"/protected",a,true)).status,401,"copied cookie cannot bypass logout");
  assert.equal((await req(origin+"/protected",b,true)).status,200,"other tenant remains active");
  const renewed=issue("account-a","user-a","org-a");
  assert.equal((await req(origin+"/protected",renewed,true)).status,200,"a new valid session is usable");
});

test("explicit logout revokes valid bearer and cookie if both supplied; no raw token persisted",async()=>{
  const {db,storage}=fixture();
  const cookie=issue("account-a","user-a","org-a");
  const bearer=issue("account-a","user-a","org-a");
  const incoming={headers:{authorization:"Bearer "+bearer,cookie:"tiquet_session="+encodeURIComponent(cookie)}};
  assert.equal(getRequestSessionTokens(incoming).length,2);
  assert.equal(await revokeSignedRequestTokens({req:incoming,jwt,jwtSecret,db}),2);
  assert.equal(await isSignedSessionRevoked(db,cookie),true);
  assert.equal(await isSignedSessionRevoked(db,bearer),true);
  assert.equal(storage.has(cookie),false);
  assert.equal(storage.has(bearer),false);
  for(const digest of storage.keys())assert.match(digest,/^[a-f0-9]{64}$/);
  assert.equal(await isTokenFingerprintRevoked(db,"bogus"),true);
});

test("unavailable database does not claim successful revocation or permit signed access",async t=>{
  const badDb={prepare(){throw Error("synthetic DB down")}};
  const origin=await serverFor(t,badDb);
  const a=issue("account-a","user-a","org-a");
  assert.equal((await req(origin+"/logout",a,true,{method:"POST"})).status,503);
  assert.equal((await req(origin+"/protected",a)).status,503);
});

test("malformed, expired or forged JWTs cannot create revocation rows",async()=>{
  const {db,storage}=fixture();
  const wrong=jwt.sign(claims(), "different-synthetic-secret",{expiresIn:"30m"});
  const expired=jwt.sign({...claims(),exp:Math.floor(Date.now()/1000)-1},jwtSecret);
  const malformed="bad%token";
  assert.equal(await revokeSignedRequestTokens({
    req:{headers:{authorization:"Bearer "+wrong,cookie:"tiquet_session="+malformed}},
    jwt,jwtSecret,db,
  }),0);
  assert.equal(await revokeSignedRequestTokens({
    req:{headers:{authorization:"Bearer "+expired}},jwt,jwtSecret,db,
  }),0);
  assert.equal(storage.size,0);
});
