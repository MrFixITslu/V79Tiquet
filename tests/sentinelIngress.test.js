import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import { createSentinelIngestRouter, parseSentinelLinks, sentinelConfigFromEnv, SENTINEL_PATH } from "../server/sentinelIngress.js";

const uuid=()=>crypto.randomUUID();
const link=()=>({sentinelCustomerId:uuid(),tiquetOrganizationId:"hub-org-one",tiquetAccountId:"account-one",tiquetClientId:"client-one",secret:"a".repeat(64),enabled:true});

class StubDatabase {
  constructor(){
    this.state={account:{id:"account-one",status:"active",hub_organization_id:"hub-org-one"},
      client:{id:"client-one",name:"Synthetic Client"},jobs:{},incidents:{},receipts:{},activities:[]};
  }
  transaction(fn){
    return async ()=>{
      const copy=structuredClone(this.state);
      const tx={query:async (sql,params=[])=>{
        const s=sql.replace(/\s+/g," ").trim().toLowerCase();
        if(s.startsWith("select pg_advisory_xact_lock"))return {rows:[{}]};
        if(s.startsWith("select id,status,hub_organization_id from accounts"))return {rows:copy.account?.id===params[0]?[copy.account]:[]};
        if(s.startsWith("select id,name from clients"))return {rows:copy.client?.id===params[0]&&params[1]===copy.account?.id?[copy.client]:[]};
        if(s.startsWith("select * from sentinel_ingest_events"))return {rows:copy.receipts[params[0]]?[copy.receipts[params[0]]]:[]};
        if(s.startsWith("select * from sentinel_incident_jobs"))return {rows:copy.incidents[params[0]]?[copy.incidents[params[0]]]:[]};
        if(s.startsWith("insert into jobs")){
          assert.equal(params[8],"account-one");assert.equal(params[9].startsWith("sentinel:incident:"),true);
          copy.jobs[params[0]]={id:params[0],status:params[4],secureToken:null,clientId:params[7]};return {rows:[]};
        }
        if(s.startsWith("insert into sentinel_incident_jobs")){
          copy.incidents[params[0]]={source_incident_id:params[0],account_id:params[1],client_id:params[2],job_id:params[3]};return {rows:[]};
        }
        if(s.startsWith("update sentinel_incident_jobs")){
          copy.incidents[params[1]].recovery_at=params[0];return {rows:[]};
        }
        if(s.startsWith("insert into activity_logs")){
          copy.activities.push({job:params[1],description:params[2]});return {rows:[]};
        }
        if(s.startsWith("insert into sentinel_ingest_events")){
          copy.receipts[params[0]]={event_id:params[0],source_incident_id:params[1],account_id:params[2],
            client_id:params[3],action:params[4],body_sha256:params[5],job_id:params[6]};return {rows:[]};
        }
        throw new Error("Unrecognized transaction SQL: "+s.slice(0,85));
      }};
      const result=await fn(tx);
      this.state=copy;
      return result;
    };
  }
}
function eventFor(mapping,action="ticket.create",incident=uuid()){
  const eventId=uuid();
  const e={schema_version:1,source:"v79-sentinel",classification:"PRODUCTION_VERIFIED",
    event_id:eventId,idempotency_key:"sentinel:event:"+eventId,
    source_incident_id:incident,correlation_key:"sentinel:incident:"+incident,
    tenant:{sentinel_customer_id:mapping.sentinelCustomerId,
      tiquet_organization_id:mapping.tiquetOrganizationId,tiquet_client_id:mapping.tiquetClientId},
    impact:{site_id:uuid(),site_name:"Owned lab site",failure_domain:"application_readiness"},
    incident:{title:"Synthetic app readiness event",severity:"warning",
      detected_at:new Date().toISOString(),observed_state:action==="ticket.create"?"open":"resolved"},
    action};
  if(action!=="ticket.create")e.recovery={observed_at:new Date().toISOString(),ticket_should_close:false,
    requires_technician_verification:true};
  return e;
}
function signed(mapping,payload,overrides={}){
  const body=JSON.stringify(payload);
  const ts=String(Math.floor(Date.now()/1000));
  const hash=crypto.createHash("sha256").update(body).digest("hex");
  const canonical=["POST",SENTINEL_PATH,ts,hash].join("\n");
  const mac=crypto.createHmac("sha256",mapping.secret).update(canonical).digest("hex");
  return {body,headers:{"content-type":"application/json","x-v79-service-id":"v79-sentinel",
    "x-v79-sentinel-customer":mapping.sentinelCustomerId,"x-v79-timestamp":ts,
    "x-v79-signature":mac,...overrides}};
}
async function harness(t,enabled=true){
  const mapping=link(),db=new StubDatabase(),app=express();
  app.use(express.json({limit:"12kb",verify:(req,_res,body)=>req.rawBody=Buffer.from(body)}));
  app.use(SENTINEL_PATH,createSentinelIngestRouter({db,config:{enabled,links:enabled?[mapping]:[]}}));
  const server=createServer(app);
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const url="http://127.0.0.1:"+server.address().port+SENTINEL_PATH;
  const send=async(e,headers={})=>{
    const args=signed(mapping,e,headers);
    const response=await fetch(url,{method:"POST",headers:args.headers,body:args.body,signal:AbortSignal.timeout(5000)});
    return {status:response.status,body:await response.json()};
  };
  return {mapping,db,send};
}
test("default-off flag and invalid mapping reject closed",async t=>{
  assert.deepEqual(sentinelConfigFromEnv({}),{enabled:false,links:[]});
  assert.throws(()=>sentinelConfigFromEnv({V79_SENTINEL_INGEST_ENABLED:"1"}));
  assert.throws(()=>parseSentinelLinks([{...link(),secret:"weak"}]));
  const h=await harness(t,false);
  assert.equal((await h.send(eventFor(link()))).status,404);
});
test("real signed opening creates one request ticket with NO portal credential",async t=>{
  const h=await harness(t);const e=eventFor(h.mapping);
  const result=await h.send(e);
  assert.equal(result.status,201);assert.equal(result.body.state,"created");
  assert.equal(Object.keys(h.db.state.jobs).length,1);
  assert.equal(Object.values(h.db.state.jobs)[0].status,"request");
  assert.equal(Object.values(h.db.state.jobs)[0].secureToken,null);
  assert.equal((await h.send(e)).body.state,"duplicate");
  assert.equal(Object.keys(h.db.state.receipts).length,1);
});
test("rejects browser origin, invalid signature, unknown customer and simulated events",async t=>{
  const h=await harness(t),e=eventFor(h.mapping);
  assert.equal((await h.send(e,{"x-v79-signature":"0".repeat(64)})).status,401);
  assert.equal((await h.send(e,{origin:"https://other.example"})).status,403);
  assert.equal((await h.send(e,{"x-v79-sentinel-customer":uuid()})).status,401);
  assert.equal((await h.send({...e,classification:"SIMULATED_ONLY"})).status,400);
  assert.equal(Object.keys(h.db.state.jobs).length,0);
});
test("signed payload cannot change tenant, action or event identity on replay",async t=>{
  const h=await harness(t),e=eventFor(h.mapping);
  assert.equal((await h.send(e)).status,201);
  assert.equal((await h.send({...e,incident:{...e.incident,title:"MUTATED"}})).status,409);
  assert.equal((await h.send({...e,tenant:{...e.tenant,tiquet_client_id:"client-two"}})).status,403);
  assert.equal(Object.keys(h.db.state.jobs).length,1);
});
test("verified recovery appends evidence but cannot auto-close a job",async t=>{
  const h=await harness(t),incident=uuid();
  const recovery=eventFor(h.mapping,"ticket.add_recovery_evidence",incident);
  assert.equal((await h.send(recovery)).status,409);
  assert.equal((await h.send(eventFor(h.mapping,"ticket.create",incident))).status,201);
  assert.equal((await h.send(recovery)).status,200);
  assert.equal((await h.send(recovery)).body.state,"duplicate");
  assert.equal(h.db.state.activities.length,1);
  assert.equal(Object.values(h.db.state.jobs)[0].status,"request");
  assert.equal(Object.keys(h.db.state.jobs).length,1);
});
test("account Hub organization and client existence checked inside transaction",async t=>{
  const h=await harness(t),e=eventFor(h.mapping);
  h.db.state.account.hub_organization_id="wrong-org";
  assert.equal((await h.send(e)).status,403);
  h.db.state.account.hub_organization_id="hub-org-one";
  h.db.state.client.id="wrong-client";
  assert.equal((await h.send(e)).status,403);
  assert.equal(Object.keys(h.db.state.jobs).length,0);
});

test("revoked tenant-specific service links fail closed",async t=>{
  const mapping=link(),db=new StubDatabase(),app=express();
  app.use(express.json({limit:"12kb",verify:(req,_res,body)=>req.rawBody=Buffer.from(body)}));
  app.use(SENTINEL_PATH,createSentinelIngestRouter({db,config:{enabled:true,links:[{...mapping,enabled:false}]}}));
  const server=createServer(app);await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const args=signed(mapping,eventFor(mapping));
  const response=await fetch("http://127.0.0.1:"+server.address().port+SENTINEL_PATH,
    {method:"POST",...args,signal:AbortSignal.timeout(5000)});
  assert.equal(response.status,401);
  assert.equal(Object.keys(db.state.jobs).length,0);
});
test("out-of-window signatures and non-service Authorization are rejected",async t=>{
  const h=await harness(t),e=eventFor(h.mapping);
  assert.equal((await h.send(e,{"x-v79-timestamp":"1700000000"})).status,401);
  assert.equal((await h.send(e,{authorization:"Bearer user-jwt-not-accepted"})).status,403);
  assert.equal(Object.keys(h.db.state.receipts).length,0);
});
