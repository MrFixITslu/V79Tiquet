import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";
import {fileURLToPath} from "node:url";
import {createPhase4Service} from "../server/support/phase4Service.js";
import {businessMinutesBetween} from "../server/support/businessHours.js";
const uri=new URL(process.env.DATABASE_URL||"postgres://invalid/invalid");
if(process.env.NODE_ENV!=="test"||process.env.CI_SUPPORT_SYNTHETIC!=="1"||
 process.env.V79_SUPPORT_DESK_ENABLED!=="0"||uri.hostname!=="127.0.0.1"||
 uri.pathname!=="/tiquet_support_test")
 throw new Error("PHASE4_SYNTHETIC_DB_REQUIRED");
const pool=new pg.Pool({connectionString:uri.toString(),max:5});
const db={
 query:(s,p)=>pool.query(s,p),
 transaction:fn=>async()=>{
  const c=await pool.connect();
  try{await c.query("BEGIN");const v=await fn({query:(s,p)=>c.query(s,p)});
   await c.query("COMMIT");return v;
  }catch(e){await c.query("ROLLBACK");throw e;}finally{c.release();}
 }
};
let now=new Date("2026-10-26T13:10:00Z");
const phase4=createPhase4Service({db,clock:()=>now});
const admin=new Set(["support.view","support.view.all"]);
const member=new Set(["support.view"]);
const input=(ticketId="p4critical",accountId="p4a",actorId="p4owner",caps=admin)=>
 ({ticketId,accountId,actorId,caps});
const query=async(s,p)=>(await pool.query(s,p)).rows;
test.before(async()=>{
 const dir=path.dirname(fileURLToPath(import.meta.url));
 await pool.query("CREATE TABLE accounts(id TEXT PRIMARY KEY)");
 await pool.query("CREATE TABLE users(id TEXT PRIMARY KEY,account_id TEXT,role TEXT,permissions TEXT)");
 await pool.query("CREATE TABLE clients(id TEXT PRIMARY KEY,account_id TEXT)");
 await pool.query("CREATE TABLE jobs(id TEXT PRIMARY KEY,account_id TEXT,status TEXT,amount INTEGER)");
 await pool.query(await fs.readFile(path.join(dir,"../server/support/schema.sql"),"utf8"));
 const ddl=await fs.readFile(path.join(dir,"../server/support/phase4-schema.sql"),"utf8");
 await pool.query(ddl);await pool.query(ddl);
 await pool.query("INSERT INTO accounts VALUES('p4a'),('p4b')");
 await pool.query("INSERT INTO users VALUES('p4owner','p4a','Admin','[]'),"+
  "('p4agent','p4a','Member','[\"support.view\"]'),"+
  "('p4other','p4a','Member','[\"support.view\"]'),"+
  "('p4foreign','p4b','Admin','[]')");
 await pool.query("INSERT INTO support_sla_policies(account_id,timezone) "+
  "VALUES('p4a','America/St_Lucia'),('p4b','America/New_York')");
 await pool.query("INSERT INTO support_tickets"+
  "(id,account_id,subject,status,priority,assigned_to,created_by,created_at) VALUES "+
  "('p4critical','p4a','Synthetic critical','new','critical',NULL,'p4owner','2026-10-26T13:00:00Z'),"+
  "('p4assigned','p4a','Synthetic assigned','open','high','p4agent','p4owner','2026-10-26T13:00:00Z'),"+
  "('p4foreignTicket','p4b','Foreign synthetic ticket','new','normal',NULL,'p4foreign','2026-10-26T13:00:00Z')");
});
test.after(async()=>{await pool.end();});
test("SLA records use ticket-created time, priority and configured business hours",async()=>{
 const sla=await phase4.readSla(input());
 assert.equal(new Date(sla.firstResponseDue).toISOString(),"2026-10-26T13:30:00.000Z");
 assert.equal(new Date(sla.resolutionDue).toISOString(),"2026-10-26T17:00:00.000Z");
 assert.equal(sla.firstResponse,"running");assert.equal(sla.source,"synthetic");
 const repeat=await phase4.readSla(input());
 assert.equal(repeat.firstResponseDue,sla.firstResponseDue);
});
test("member can view only an assigned or creator-owned ticket",async()=>{
 await assert.rejects(phase4.readSla(input("p4critical","p4a","p4agent",member)),/TICKET_NOT_FOUND/);
 const permitted=await phase4.readSla(input("p4assigned","p4a","p4agent",member));
 assert.equal(permitted.firstResponse,"running");
 await assert.rejects(phase4.presence(input("p4assigned","p4b","p4foreign",admin)),/TICKET_NOT_FOUND/);
});
test("idempotent internal automation templates never send notifications",async()=>{
 now=new Date("2026-10-26T20:00:00Z");
 const [one,two]=await Promise.all([
  phase4.evaluateRules(input()),phase4.evaluateRules(input())
 ]);
 const all=[...one.newRules,...two.newRules].sort();
 assert.deepEqual(all,["critical_unassigned","first_response_breach","resolution_breach"]);
 assert.equal(one.notificationsSent+two.notificationsSent,0);
 const third=await phase4.evaluateRules(input());
 assert.deepEqual(third.newRules,[]);
 const alerts=await phase4.alerts(input());
 assert.equal(alerts.length,3);
 assert.ok(alerts.every(x=>x.body.includes("Synthetic")||x.body.includes("synthetic")));
 assert.equal((await query("SELECT count(*)::int AS n FROM support_automation_receipts "+
  "WHERE account_id='p4a' AND ticket_id='p4critical'"))[0].n,3);
 await assert.rejects(phase4.evaluateRules(input("p4assigned","p4a","p4agent",member)),
  /AUTOMATION_ADMIN_ONLY/);
});
test("business-hours pause and resume happen transactionally with ticket status",async()=>{
 // Use a different ticket to avoid automation tests changing its clock.
 now=new Date("2026-10-26T13:20:00Z");
 const t="p4assigned";
 const before=await phase4.readSla(input(t));
 await db.transaction(async tx=>{
  await tx.query("UPDATE support_tickets SET status='waiting_customer',version=version+1 "+
   "WHERE account_id='p4a' AND id=$1",[t]);
  await phase4.onStatusChanged(tx,{accountId:"p4a",ticketId:t,
   previousStatus:"open",nextStatus:"waiting_customer"});
 })();
 const paused=await phase4.readSla(input(t));
 assert.equal(paused.resolution,"paused");
 now=new Date("2026-10-26T15:20:00Z");
 await db.transaction(async tx=>{
  await tx.query("UPDATE support_tickets SET status='open',version=version+1 "+
   "WHERE account_id='p4a' AND id=$1",[t]);
  await phase4.onStatusChanged(tx,{accountId:"p4a",ticketId:t,
   previousStatus:"waiting_customer",nextStatus:"open"});
 })();
 const resumed=await phase4.readSla(input(t));
 assert.equal(resumed.resolution,"running");
 assert.equal(businessMinutesBetween(before.resolutionDue,resumed.resolutionDue,
  {timezone:"America/St_Lucia"}),120);
});
test("only accepted human staff messages qualify as first response",async()=>{
 const t="p4assigned";
 now=new Date("2026-10-26T15:30:00Z");
 await pool.query("INSERT INTO support_messages "+
  "(id,account_id,ticket_id,actor_id,visibility,channel,direction,delivery_state,body,idem_key,body_hash) "+
  "VALUES('p4auto','p4a',$1,'system:auto','public','email','outbound','accepted','Auto','auto-idem','h'),"+
  "('p4draft','p4a',$1,'p4agent','public','email','outbound','queued','Draft','draft-idem','h')",[t]);
 assert.equal((await phase4.readSla(input(t))).firstResponse,"breached");
 await pool.query("INSERT INTO support_messages "+
  "(id,account_id,ticket_id,actor_id,visibility,channel,direction,delivery_state,body,idem_key,body_hash) "+
  "VALUES('p4real','p4a',$1,'p4agent','public','email','outbound','accepted','Human mock','real-idem','h')",[t]);
 assert.equal((await phase4.readSla(input(t))).firstResponse,"met");
});
test("presence is expiring, tenant scoped, and uses authoritative ticket version",async()=>{
 now=new Date("2026-10-26T16:00:00Z");
 const who=input("p4assigned","p4a","p4agent",member);
 await assert.rejects(phase4.heartbeat({...who,mode:"drafting",version:1}),/STALE_TICKET/);
 const version=(await query("SELECT version FROM support_tickets WHERE id='p4assigned'"))[0].version;
 await phase4.heartbeat({...who,mode:"drafting",version});
 await phase4.heartbeat({...input("p4assigned"),mode:"viewing",version});
 const self=await phase4.presence(who);
 assert.deepEqual(self.agents.map(x=>x.actorId),["p4owner"]);
 assert.equal(self.agents[0].mode,"viewing");
 now=new Date(now.getTime()+91000);
 assert.deepEqual((await phase4.presence(who)).agents,[]);
 await assert.rejects(phase4.heartbeat({...input("p4critical","p4a","p4agent",member),
  mode:"drafting",version:1}),/TICKET_NOT_FOUND/);
});
