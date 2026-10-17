import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import {createSentinelNocApproverChecker,NOC_APPROVER_PATH}
  from "../server/sentinelNocApproverChecker.js";

const now=Date.parse("2026-10-10T17:00:00.000Z");
const secret="synthetic-only-dedicated-noc-service-secret-12345678901234567890";
const scope={
  approverUserId:crypto.randomUUID(),approvalId:crypto.randomUUID(),
  approvedAt:new Date(now-5000).toISOString(),
  organizationId:crypto.randomUUID(),sentinelCustomerId:crypto.randomUUID(),
  action:"ticket.create"
};
const origin="http://127.0.0.1:8793/";
const endpoint=origin.slice(0,-1)+NOC_APPROVER_PATH;
const reply=(allowed=true)=>({
  ok:true,redirected:false,url:endpoint,
  headers:{get:()=>"application/json"},
  text:async()=>JSON.stringify({allowed,validForSeconds:allowed?5:0})
});
const checker=(transport,extras={})=>createSentinelNocApproverChecker({
  nocUrl:origin,secret,now:()=>now,allowLoopbackTesting:true,transport,...extras});

test("requires dedicated machine HMAC and exactly scoped current-human authorization",async()=>{
  let called=0;
  const signed=checker(async(url,opts)=>{
    called++;
    assert.equal(url,endpoint);
    assert.equal(opts.method,"POST");
    assert.equal(opts.redirect,"error");
    assert.equal(opts.headers["x-v79-service-id"],"v79-tiquet");
    assert.equal(opts.headers["x-v79-timestamp"],String(now/1000));
    assert.equal(opts.headers.authorization,undefined);
    assert.equal(opts.headers.cookie,undefined);
    const body=JSON.parse(opts.body);
    assert.deepEqual(body,scope);
    const base=["POST",NOC_APPROVER_PATH,String(now/1000),
      crypto.createHash("sha256").update(opts.body).digest("hex")].join("\n");
    assert.equal(opts.headers["x-v79-signature"],
      crypto.createHmac("sha256",secret).update(base).digest("hex"));
    return reply();
  });
  assert.equal(await signed(scope),true);
  assert.equal(called,1);
  assert.equal(await signed({...scope,action:"ticket.close"}),false);
  assert.equal(await signed({...scope,approvalId:"invalid"}),false);
  assert.equal(await signed({...scope,customer:"extra"}),false);
  assert.equal(called,1);
});
test("no cached permission; live revocation is authoritative each time",async()=>{
  let authorized=true,count=0;
  const check=checker(async()=>{count++;return reply(authorized);});
  assert.equal(await check(scope),true);
  authorized=false;
  assert.equal(await check(scope),false);
  assert.equal(count,2);
});
test("rejects malformed endpoints, missing identity, unsafe HTTP and redirects",async()=>{
  assert.throws(()=>createSentinelNocApproverChecker({nocUrl:"https://x.example/",secret:"short"}));
  assert.throws(()=>createSentinelNocApproverChecker({nocUrl:"http://127.0.0.1:8793/",secret}));
  assert.throws(()=>createSentinelNocApproverChecker({
    nocUrl:"https://user:pass@x.example/",secret}));
  assert.equal(await checker(async()=>({...reply(),redirected:true}))(scope),false);
  assert.equal(await checker(async()=>({...reply(),url:"https://wrong.example"}))(scope),false);
  assert.equal(await checker(async()=>({...reply(),headers:{get:()=>"text/html"}}))(scope),false);
  assert.equal(await checker(async()=>{throw Error("offline");})(scope),false);
  assert.equal(await checker(async()=>({...reply(),text:async()=>"{bad JSON"}))(scope),false);
  assert.equal(await checker(async()=>({...reply(),text:async()=>JSON.stringify({
    allowed:true,validForSeconds:3600})}))(scope),false);
});
