import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {fileURLToPath} from "node:url";
import {createSyntheticMailService} from "../server/support/syntheticMail.js";

// HARD STOP: only a disposable localhost database in test mode, no provider.
const uri=new URL(process.env.DATABASE_URL||"postgres://invalid/invalid");
if(process.env.NODE_ENV!=="test"||process.env.CI_SUPPORT_SYNTHETIC!=="1"||
 process.env.V79_SUPPORT_DESK_ENABLED!=="0"||
 !["127.0.0.1","localhost"].includes(uri.hostname)||
 uri.pathname!=="/tiquet_support_test")
 throw new Error("SUPPORT_PHASE2_STOP_NON_DISPOSABLE_ENV");
const pool=new pg.Pool({connectionString:uri.toString(),max:6});
const db={
 query:(s,vals)=>pool.query(s,vals),
 transaction:fn=>async()=>{
  const c=await pool.connect();
  try{
   await c.query("BEGIN");
   const value=await fn({query:(s,vals)=>c.query(s,vals)});
   await c.query("COMMIT");return value;
  }catch(error){await c.query("ROLLBACK");throw error;}
  finally{c.release();}
 }
};
const signals=[],delivered=[];
const transport={
 kind:"synthetic-mail-provider",
 async send(payload){
  delivered.push(payload);
  const value=signals.shift()??{state:"accepted",receipt:"mock-accepted"};
  if(value==="throw")throw new Error("SIMULATED_NETWORK_TIMEOUT");
  return value;
 }
};
const mail=createSyntheticMailService({db,transport});
const input=(id,changes={})=>({
 mailboxId:"supportA",providerUid:"uid-"+id,
 messageId:"<"+id+"@example.invalid>",
 from:"customer@example.invalid",subject:"Synthetic help needed",
 body:"Please investigate the synthetic issue.",
 authenticatedSender:true,references:[],...changes
});
const row=async(sql,params)=> (await pool.query(sql,params)).rows;
const enqueue=(ticketId,key,opts={})=>mail.queueReply({
 accountId:"mailA",actorId:"ownerMailA",mailboxId:"supportA",
 ticketId,recipient:"customer@example.invalid",body:"Synthetic reply content",
 idempotencyKey:key,...opts
});
test.before(async()=>{
 await pool.query("CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY)");
 await pool.query("CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,account_id TEXT,role TEXT,permissions TEXT)");
 await pool.query("CREATE TABLE IF NOT EXISTS clients(id TEXT PRIMARY KEY,account_id TEXT)");
 await pool.query("CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,account_id TEXT,status TEXT,amount INTEGER)");
 const root=path.dirname(fileURLToPath(import.meta.url));
 await pool.query(await fs.readFile(path.join(root,"../server/support/schema.sql"),"utf8"));
 const mailDDL=await fs.readFile(path.join(root,"../server/support/mail-schema.sql"),"utf8");
 await pool.query(mailDDL);
 await pool.query(mailDDL); // repeatability
 await pool.query("INSERT INTO accounts(id) VALUES('mailA'),('mailB') ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO users(id,account_id,role,permissions) VALUES "+
  "('ownerMailA','mailA','Admin','[]'),"+
  "('staffMailA','mailA','Member','[\"support.reply\"]'),"+
  "('blockedMailA','mailA','Member','[\"support.view\"]'),"+
  "('ownerMailB','mailB','Admin','[]') ON CONFLICT DO NOTHING");
 await pool.query("INSERT INTO support_mailboxes(id,account_id,address) VALUES "+
  "('supportA','mailA','help@example.invalid'),"+
  "('otherA','mailA','other@example.invalid'),"+
  "('supportB','mailB','help@example.invalid') ON CONFLICT DO NOTHING");
});
test.after(async()=>{await pool.end();});

test("synthetic inbound is durable, atomic, threaded and idempotent",async()=>{
 const start=await mail.ingest("mailA",input("first"));
 assert.equal(start.duplicate,false);
 assert.equal(start.threaded,false);
 const duplicate=await mail.ingest("mailA",input("first"));
 assert.equal(duplicate.duplicate,true);
 assert.equal(duplicate.messageId,start.messageId);
 const anotherUid=await mail.ingest("mailA",input("first",{providerUid:"uid-first-copy"}));
 assert.equal(anotherUid.duplicate,true);
 await assert.rejects(mail.ingest("mailA",input("first",{body:"Tampered body"})),/INBOUND_IDENTITY_COLLISION/);
 const threaded=await mail.ingest("mailA",input("reply",{
  references:["<first@example.invalid>"],body:"Same authorized participant responds"
 }));
 assert.equal(threaded.ticketId,start.ticketId);
 assert.equal(threaded.threaded,true);
 const stranger=await mail.ingest("mailA",input("stranger",{
  from:"stranger@example.invalid",references:["<reply@example.invalid>"]
 }));
 assert.notEqual(stranger.ticketId,start.ticketId);
 const unknown=await mail.ingest("mailA",input("unknown",{
  references:["<unknown-reference@example.invalid>"]
 }));
 assert.notEqual(unknown.ticketId,start.ticketId);
 const inOtherMailbox=await mail.ingest("mailA",input("othermailbox",{
  mailboxId:"otherA",references:["<first@example.invalid>"]
 }));
 assert.notEqual(inOtherMailbox.ticketId,start.ticketId);
 const inOtherTenant=await mail.ingest("mailB",input("cross-tenant",{
  mailboxId:"supportB",references:["<first@example.invalid>"]
 }));
 assert.notEqual(inOtherTenant.ticketId,start.ticketId);
 const events=await row("SELECT count(*)::int AS n FROM support_mail_ingest "+
  "WHERE account_id='mailA' AND mailbox_id='supportA' AND rfc_id='<first@example.invalid>'");
 assert.equal(events[0].n,1);
 const message=await row("SELECT actor_id,visibility,direction,delivery_state FROM support_messages "+
  "WHERE account_id='mailA' AND id=$1",[start.messageId]);
 assert.deepEqual(message[0],{
  actor_id:"mail:customer@example.invalid",visibility:"public",
  direction:"inbound",delivery_state:"not_applicable"
 });
 assert.equal((await row("SELECT count(*)::int AS n FROM support_outbox"))[0].n,0);
});
test("unsafe sender and conflicting references fail without partial ticket or receipt",async()=>{
 await assert.rejects(mail.ingest("mailA",input("spoof",{authenticatedSender:false})),/UNVERIFIED_SENDER/);
 await assert.rejects(mail.ingest("mailA",input("autoresponder",{autoSubmitted:true})),/AUTOMATED_MAIL_REJECTED/);
 await assert.rejects(mail.ingest("mailA",input("realaddr",{from:"someone@company.com"})),
  /SYNTHETIC_ADDRESS_REQUIRED/);
 const first=await mail.ingest("mailA",input("uniqueA",{from:"alice@example.invalid"}));
 const second=await mail.ingest("mailA",input("uniqueB",{from:"alice@example.invalid"}));
 await assert.rejects(mail.ingest("mailA",input("ambig",{from:"alice@example.invalid",
  references:["<uniqueA@example.invalid>","<uniqueB@example.invalid>"]})),/AMBIGUOUS_THREAD/);
 const n=await row("SELECT count(*)::int AS n FROM support_mail_ingest WHERE provider_uid='uid-ambig'");
 assert.equal(n[0].n,0);
 assert.notEqual(first.ticketId,second.ticketId);
});
test("concurrent import deduplicates RFC IDs and provider UID",async()=>{
 const [a,b]=await Promise.all([
  mail.ingest("mailA",input("race")),
  mail.ingest("mailA",input("race"))
 ]);
 assert.equal(a.ticketId,b.ticketId);
 assert.deepEqual([a.duplicate,b.duplicate].sort(),[false,true]);
 assert.equal((await row("SELECT count(*)::int AS n FROM support_mail_ingest "+
  "WHERE account_id='mailA' AND rfc_id='<race@example.invalid>'"))[0].n,1);
});
test("outbox enforces authorization, participant allowlist and durable idempotency",async()=>{
 const original=await mail.ingest("mailA",input("queue-source"));
 await assert.rejects(enqueue(original.ticketId,"request_bad_destination",{
  recipient:"real@gmail.com"}),/SYNTHETIC_ADDRESS_REQUIRED/);
 await assert.rejects(enqueue(original.ticketId,"request_unlisted",{
  recipient:"unknown@example.invalid"}),/RECIPIENT_NOT_PARTICIPANT/);
 await assert.rejects(enqueue(original.ticketId,"request_outsider",{
  actorId:"blockedMailA"}),/SUPPORT_REPLY_FORBIDDEN/);
 await assert.rejects(enqueue(original.ticketId,"request_wrong_tenant",{
  accountId:"mailB",actorId:"ownerMailB"}),/TICKET_NOT_FOUND/);
 await assert.rejects(enqueue(original.ticketId,"request_wrong_staff",{
  actorId:"staffMailA"}),/TICKET_NOT_FOUND/);
 await pool.query("UPDATE support_tickets SET assigned_to='staffMailA' WHERE account_id='mailA' AND id=$1",
  [original.ticketId]);
 const allowed=await enqueue(original.ticketId,"request_staff_valid",{
  actorId:"staffMailA"});
 assert.equal(allowed.state,"queued");
 const first=await enqueue(original.ticketId,"request_00000001");
 assert.equal(first.duplicate,false);assert.equal(first.state,"queued");
 const repeat=await enqueue(original.ticketId,"request_00000001");
 assert.equal(repeat.duplicate,true);assert.equal(repeat.messageId,first.messageId);
 await assert.rejects(enqueue(original.ticketId,"request_00000001",{body:"A different body"}),
  /IDEMPOTENCY_CONFLICT/);
 assert.equal((await row("SELECT count(*)::int AS n FROM support_outbox WHERE id=$1",
  [first.outboxId]))[0].n,1);
 assert.equal((await row("SELECT delivery_state FROM support_messages WHERE id=$1",
  [first.messageId]))[0].delivery_state,"queued");
 // Different instance using the same durable DB can dispatch after a mock restart.
 const restarted=createSyntheticMailService({db,transport});
 const send=await restarted.dispatchOne();
 assert.equal(send.state,"accepted");
 assert.ok(delivered[0].to.endsWith(".invalid"));
 const ref=await row("SELECT ticket_id FROM support_mail_references WHERE account_id='mailA' AND rfc_id=$1",
  [delivered[0].messageId]);
 assert.equal(ref[0].ticket_id,original.ticketId);
 const reply=await mail.ingest("mailA",input("reply-to-outbound",{
  references:[delivered[0].messageId]}));
 assert.equal(reply.ticketId,original.ticketId);
});
test("transient failures retry with backoff; permanent failures stop",async()=>{
 const seed=await mail.ingest("mailA",input("retry-source"));
 const queued=await enqueue(seed.ticketId,"request_retry001");
 // Drain any earlier pending fixtures first, and then force the chosen job due first.
 await pool.query("UPDATE support_outbox SET next_attempt_at=now()+interval '1 day' WHERE state='queued' AND id<>$1",
  [queued.outboxId]);
 signals.push({state:"retryable_failure"});
 const first=await mail.dispatchOne();
 assert.equal(first.outboxId,queued.outboxId);
 assert.equal(first.state,"queued");assert.equal(first.attempts,1);
 let state=(await row("SELECT attempts,next_attempt_at>now() AS delayed FROM support_outbox WHERE id=$1",
  [queued.outboxId]))[0];
 assert.equal(state.delayed,true);
 await pool.query("UPDATE support_outbox SET next_attempt_at=now()-interval '1 second' WHERE id=$1",
  [queued.outboxId]);
 signals.push({state:"accepted",receipt:"mock-second-try"});
 const again=await mail.dispatchOne();
 assert.equal(again.state,"accepted");assert.equal(again.attempts,2);
 const next=await enqueue(seed.ticketId,"request_permanent001",{body:"Permanent mock result"});
 await pool.query("UPDATE support_outbox SET next_attempt_at=now()+interval '1 day' WHERE state='queued' AND id<>$1",
  [next.outboxId]);
 signals.push({state:"permanent_failure"});
 assert.equal((await mail.dispatchOne()).state,"failed");
 assert.equal((await row("SELECT delivery_state FROM support_messages WHERE id=$1",
  [next.messageId]))[0].delivery_state,"failed");
});
test("uncertain outcomes and expired leases never resend automatically",async()=>{
 const seed=await mail.ingest("mailA",input("uncertain-source"));
 const one=await enqueue(seed.ticketId,"request_uncertain_01");
 await pool.query("UPDATE support_outbox SET next_attempt_at=now()+interval '1 day' WHERE state='queued' AND id<>$1",
  [one.outboxId]);
 signals.push("throw");
 const result=await mail.dispatchOne();
 assert.equal(result.state,"uncertain");
 assert.equal((await row("SELECT delivery_state FROM support_messages WHERE id=$1",
  [one.messageId]))[0].delivery_state,"uncertain");
 const previousSends=delivered.length;
 assert.equal((await mail.dispatchOne()).idle,true);
 assert.equal(delivered.length,previousSends);
 await assert.rejects(mail.reconcile({accountId:"mailB",outboxId:one.outboxId,
  state:"accepted",proof:"synthetic-proof-someconfirm"}),/UNCERTAIN_OUTBOX_NOT_FOUND/);
 await assert.rejects(mail.reconcile({accountId:"mailA",outboxId:one.outboxId,
  state:"accepted",proof:"no-evidence"}),/SYNTHETIC_RECONCILIATION_REQUIRED/);
 assert.equal((await mail.reconcile({accountId:"mailA",outboxId:one.outboxId,
  state:"accepted",proof:"synthetic-proof-confirmed1234"})).state,"accepted");
 const two=await enqueue(seed.ticketId,"request_lease_0001",{body:"Lease timeout fixture"});
 await pool.query("UPDATE support_outbox SET state='sending',lease_token='mock-crashed-worker',"+
  "lease_until=now()-interval '1 minute' WHERE id=$1",[two.outboxId]);
 const reap=await mail.reapExpired();
 assert.ok(reap.uncertain>=1);
 assert.equal((await row("SELECT state FROM support_outbox WHERE id=$1",[two.outboxId]))[0].state,"uncertain");
 assert.equal((await row("SELECT delivery_state FROM support_messages WHERE id=$1",
  [two.messageId]))[0].delivery_state,"uncertain");
});

test("two concurrent synthetic workers lease distinct queued messages",async()=>{
 const fixture=await mail.ingest("mailA",input("parallel-outbox-source"));
 const left=await enqueue(fixture.ticketId,"parallel_outbox_00001",{body:"Parallel reply one"});
 const right=await enqueue(fixture.ticketId,"parallel_outbox_00002",{body:"Parallel reply two"});
 await pool.query("UPDATE support_outbox SET next_attempt_at=now()+interval '1 day' "+
  "WHERE state='queued' AND id<>ALL($1::text[])",[[left.outboxId,right.outboxId]]);
 const seenBefore=delivered.length;
 const results=await Promise.all([mail.dispatchOne(),mail.dispatchOne()]);
 assert.deepEqual(results.map(r=>r.state).sort(),["accepted","accepted"]);
 assert.deepEqual(results.map(r=>r.outboxId).sort(),[left.outboxId,right.outboxId].sort());
 assert.equal(delivered.length-seenBefore,2);
 assert.equal((await row("SELECT count(*)::int AS n FROM support_outbox "+
  "WHERE id=ANY($1::text[]) AND state='accepted'",[[left.outboxId,right.outboxId]]))[0].n,2);
});
test("retryable synthetic failures stop after three attempts",async()=>{
 const fixture=await mail.ingest("mailA",input("retry-cap-source"));
 const queued=await enqueue(fixture.ticketId,"retry_limit_0001",{body:"Three failed attempts"});
 await pool.query("UPDATE support_outbox SET next_attempt_at=now()+interval '1 day' "+
  "WHERE state='queued' AND id<>$1",[queued.outboxId]);
 for(let attempt=1;attempt<=3;attempt++){
  signals.push({state:"retryable_failure"});
  const result=await mail.dispatchOne();
  assert.equal(result.outboxId,queued.outboxId);
  assert.equal(result.attempts,attempt);
  assert.equal(result.state,attempt===3?"failed":"queued");
  if(attempt<3)await pool.query(
   "UPDATE support_outbox SET next_attempt_at=now()-interval '1 second' WHERE id=$1",
   [queued.outboxId]);
 }
 const n=delivered.filter(x=>x.outboxId===queued.outboxId).length;
 assert.equal(n,3);
 assert.equal((await row("SELECT delivery_state FROM support_messages WHERE id=$1",
  [queued.messageId]))[0].delivery_state,"failed");
});
