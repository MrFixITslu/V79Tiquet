import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createSentinelHubServiceChecker } from "../server/sentinelHubServiceChecker.js";

const secret="synthetic-machine-Hub-service-secret-not-for-production-12345678";
const scope={serviceId:"v79-sentinel",sentinelCustomerId:crypto.randomUUID(),
  organizationId:"v79-owner",accountId:"tiquet-owner-account",
  clientId:"internal-pilot",action:"ticket.create"};
const hub="https://hub.v79sl.com";
const target=hub+"/api/platform/sentinel/service/check";
const reply=(body={allowed:true,validForSeconds:5},extra={})=>({
  ok:true,redirected:false,url:target,
  headers:{get:name=>name==="content-type"?"application/json":null},
  text:async()=>JSON.stringify(body),...extra
});

test("dedicated signed Tiquet machine-to-Hub verification uses no human session",async()=>{
  let requests=0;
  const transport=async(url,options)=>{
    requests++;
    assert.equal(url,target);
    assert.equal(options.method,"POST");
    assert.equal(options.redirect,"error");
    assert.equal(options.headers["x-v79-service-id"],"v79-tiquet");
    assert.equal(options.headers.authorization,undefined);
    assert.equal(options.headers.cookie,undefined);
    const contentHash=crypto.createHash("sha256").update(options.body).digest("hex");
    const canonical=["POST","/api/platform/sentinel/service/check",
      options.headers["x-v79-timestamp"],contentHash].join("\n");
    const expected=crypto.createHmac("sha256",secret).update(canonical).digest("hex");
    assert.equal(options.headers["x-v79-signature"],expected);
    assert.deepEqual(JSON.parse(options.body),scope);
    return reply();
  };
  const check=createSentinelHubServiceChecker({hubUrl:hub,secret,transport});
  assert.equal(await check(scope),true);
  assert.equal(requests,1);
});

test("revocation, Hub outage, redirected or malformed response always denies",async()=>{
  const failOptions=[
    async()=>reply({allowed:false,validForSeconds:0}),
    async()=>reply({allowed:true,validForSeconds:99}),
    async()=>reply({allowed:true,validForSeconds:0}),
    async()=>reply(undefined,{redirected:true}),
    async()=>reply(undefined,{url:"https://evil.example"}),
    async()=>reply(undefined,{ok:false}),
    async()=>reply(undefined,{headers:{get:()=>null}}),
    async()=>reply(undefined,{text:async()=>"<html>no"} ),
    async()=>{throw Error("unavailable");}
  ];
  for(const transport of failOptions){
    const checker=createSentinelHubServiceChecker({hubUrl:hub,secret,transport});
    assert.equal(await checker(scope),false);
  }
});

test("private-machine secret length and HTTPS scheme are mandatory",()=>{
  assert.throws(()=>createSentinelHubServiceChecker({hubUrl:hub,secret:"weak"}));
  assert.throws(()=>createSentinelHubServiceChecker({hubUrl:"http://hub.v79sl.com",secret}));
  assert.throws(()=>createSentinelHubServiceChecker({hubUrl:"https://user:pass@hub.v79sl.com",secret}));
  assert.throws(()=>createSentinelHubServiceChecker({hubUrl:"https://hub.v79sl.com/untrusted",secret}));
  const checker=createSentinelHubServiceChecker({hubUrl:hub,secret,transport:async()=>reply()});
  assert.equal(typeof checker,"function");
});
