// Run explicitly with V79_TEST_POSTGRES_BIN=...; disposable PG only. Not part of npm test.
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { execFile,spawn } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import express from "express";
import pg from "pg";
import { createSentinelIngestRouter, SENTINEL_PATH } from "../server/sentinelIngress.js";
import { approvalCanonical, approvalEventDigest } from "../server/sentinelHumanApproval.js";
const exec=promisify(execFile);
const uuid=()=>crypto.randomUUID();
const now=()=>new Date().toISOString();

test("actual isolated PostgreSQL Sentinel ingestion: delivery, retry, ownership, recovery", {timeout:90000},async t=>{
  const bin=process.env.V79_TEST_POSTGRES_BIN;
  assert(bin && path.isAbsolute(bin),"Set V79_TEST_POSTGRES_BIN to isolated test runtime");
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"v79-tiquet-sentinel-pg-"));
  await fs.chmod(root,0o700);
  const pgData=path.join(root,"pgdata"),socketDir=path.join(root,"socket");
  await fs.mkdir(socketDir,{mode:0o700});
  let proc,pool,server;
  t.after(async()=>{
    if(server) await new Promise(resolve=>server.close(resolve));
    if(pool) await pool.end();
    if(proc){
      proc.kill("SIGTERM");
      await Promise.race([new Promise(resolve=>proc.once("exit",resolve)),new Promise(resolve=>setTimeout(resolve,1500))]);
      if(proc.exitCode===null && proc.signalCode===null)proc.kill("SIGKILL");
    }
    await fs.rm(root,{recursive:true,force:true});
  });
  const port=43000+crypto.randomInt(10000);
  await exec(path.join(bin,"initdb"),["-D",pgData,"-A","trust","--no-locale","-U",os.userInfo().username],{timeout:20000});
  proc=spawn(path.join(bin,"postgres"),["-D",pgData,"-k",socketDir,"-h","","-p",String(port),
    "-c","unix_socket_permissions=0700"],{stdio:"ignore"});
  pool=new pg.Pool({host:socketDir,port,user:os.userInfo().username,database:"postgres",
    connectionTimeoutMillis:2000,max:4});
  let ready=false;
  for(let i=0;i<60;i++){
    try{await pool.query("SELECT 1");ready=true;break;}catch{await new Promise(r=>setTimeout(r,80));}
  }
  assert(ready,"Disposable PostgreSQL did not become ready");
  const sql=await fs.readFile(new URL("../server/schema.sql",import.meta.url),"utf8");
  await pool.query(sql);
  await pool.query("INSERT INTO accounts (id,name,createdAt,status,hub_organization_id) VALUES ($1,$2,$3,$4,$5)",
    ["account-one","Synthetic Tiquet",now(),"active","hub-org-one"]);
  await pool.query("INSERT INTO clients (id,name,createdAt,account_id) VALUES ($1,$2,$3,$4)",
    ["client-one","Synthetic Client",now(),"account-one"]);
  const db={transaction(fn){return async()=>{
    const client=await pool.connect();
    try{
      await client.query("BEGIN");
      const tx={query:(query,params=[])=>{
        let n=0;const converted=query.replace(/\?/g,()=>"$"+(++n));
        return client.query(converted,params);
      }};
      const outcome=await fn(tx);
      await client.query("COMMIT");return outcome;
    }catch(err){await client.query("ROLLBACK");throw err;}
    finally{client.release();}
  };}};
  const mapping={sentinelCustomerId:uuid(),tiquetOrganizationId:"hub-org-one",tiquetAccountId:"account-one",
    tiquetClientId:"client-one",secret:crypto.randomBytes(48).toString("hex"),enabled:true};
  // Separate test-only signer. Private key never enters the Tiquet receiver/config.
  const signer=crypto.generateKeyPairSync("ed25519");
  const approvalKeys=[{keyId:"owner-pilot-key",
    publicKeyPem:signer.publicKey.export({type:"spki",format:"pem"}),enabled:true}];
  const approve=event=>{
    const t=Date.now();
    const proof={key_id:"owner-pilot-key",approval_id:uuid(),approver_user_id:"owner-reviewer",
      mfa_verified_at:new Date(t-5000).toISOString(),approved_at:new Date(t-1000).toISOString(),
      expires_at:new Date(t+600000).toISOString(),
      event_id:event.event_id,incident_id:event.source_incident_id,
      sentinel_customer_id:event.tenant.sentinel_customer_id,
      tiquet_organization_id:event.tenant.tiquet_organization_id,
      tiquet_client_id:event.tenant.tiquet_client_id,decision:"approve_ticket_create"};
    proof.event_sha256=approvalEventDigest(event);
    proof.signature=crypto.sign(null,approvalCanonical(proof),signer.privateKey).toString("base64url");
    return {...event,approval:proof};
  };
  const app=express();
  app.use(express.json({limit:"12kb",verify:(req,_res,body)=>{req.rawBody=Buffer.from(body);}}));
  // Disposable test stub; NOT a live Hub entitlement integration.
  const authorizeService=async scope=>scope.serviceId==="v79-sentinel" &&
    scope.organizationId==="hub-org-one" && scope.accountId==="account-one";
  app.use(SENTINEL_PATH,createSentinelIngestRouter({db,config:{enabled:true,links:[mapping],approvalKeys},authorizeService}));
  server=createServer(app);await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const url="http://127.0.0.1:"+server.address().port+SENTINEL_PATH;
  const sign=event=>{
    const body=JSON.stringify(event),ts=String(Math.floor(Date.now()/1000));
    const sha=crypto.createHash("sha256").update(body).digest("hex");
    const sig=crypto.createHmac("sha256",mapping.secret).update(["POST",SENTINEL_PATH,ts,sha].join("\n")).digest("hex");
    return {body,headers:{"content-type":"application/json","x-v79-service-id":"v79-sentinel",
      "x-v79-sentinel-customer":mapping.sentinelCustomerId,"x-v79-timestamp":ts,
      "x-v79-signature":sig}};
  };
  const post=async event=>{
    const response=await fetch(url,{method:"POST",...sign(event),signal:AbortSignal.timeout(5000)});
    return {status:response.status,body:await response.json()};
  };
  const incident=uuid(),mk=(action,sourceId=incident)=>{
    const eid=uuid();
    const e={schema_version:1,source:"v79-sentinel",classification:"PRODUCTION_VERIFIED",
      event_id:eid,idempotency_key:"sentinel:event:"+eid,source_incident_id:sourceId,
      correlation_key:"sentinel:incident:"+sourceId,
      tenant:{sentinel_customer_id:mapping.sentinelCustomerId,
        tiquet_organization_id:"hub-org-one",tiquet_client_id:"client-one"},
      impact:{site_id:uuid(),site_name:"Disposable lab",failure_domain:"owned_application"},
      incident:{title:"Synthetic staged outage",severity:"warning",detected_at:now(),
        observed_state:action==="ticket.create"?"open":"resolved"},action};
    if(action==="ticket.add_recovery_evidence")e.recovery={observed_at:now(),
      ticket_should_close:false,requires_technician_verification:true};
    return action==="ticket.create"?approve(e):e;
  };
  const create=mk("ticket.create"),recovery=mk("ticket.add_recovery_evidence");
  assert.equal((await post(recovery)).status,409,"Recovery before creation fails");
  assert.equal((await post(create)).status,201);
  assert.equal((await post(create)).body.state,"duplicate");
  const simultaneous=await Promise.all(Array.from({length:8},()=>post(create)));
  assert(simultaneous.every(x=>x.status===200 && x.body.state==="duplicate"),"Concurrent retries must not create duplicate jobs");
  assert.equal((await post({...create,incident:{...create.incident,title:"Modified"}})).status,403);
  assert.equal((await post(approve({...create,incident:{...create.incident,title:"Modified"}}))).status,409);
  assert.equal((await post({...create,tenant:{...create.tenant,tiquet_client_id:"foreign"}})).status,403);
  assert.equal((await post(recovery)).status,200);
  assert.equal((await post(recovery)).body.state,"duplicate");
  const jobs=(await pool.query("SELECT id,status,secureToken,account_id,clientId FROM jobs")).rows;
  assert.equal(jobs.length,1);
  assert.equal(jobs[0].status,"request");
  assert.equal(jobs[0].securetoken,null);
  assert.equal(jobs[0].account_id,"account-one");
  const receipts=(await pool.query("SELECT event_id,action FROM sentinel_ingest_events")).rows;
  assert.equal(receipts.length,2);
  const approvals=(await pool.query("SELECT event_id,approver_user_id,approval_key_id FROM sentinel_ticket_approvals")).rows;
  assert.equal(approvals.length,1);
  assert.equal(approvals[0].event_id,create.event_id);
  assert.equal(approvals[0].approver_user_id,"owner-reviewer");
  const incidents=(await pool.query("SELECT recovery_at FROM sentinel_incident_jobs")).rows;
  assert(incidents[0].recovery_at);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM activity_logs")).rows[0].n,1);
  console.log("PG17_DISPOSABLE_TIQUET_INGEST_PASS",{
    jobs:jobs.length,receipts:receipts.length,recoveryNotes:1,jobStillOpen:true});
});
