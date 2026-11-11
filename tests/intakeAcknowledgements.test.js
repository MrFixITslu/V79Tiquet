import test from "node:test";
import assert from "node:assert/strict";
import { createIntakeAcknowledgements } from "../server/intakeAcknowledgements.js";

function fakeDatabase() {
  const queue = new Map();
  const jobs=new Map([["tenant1:job-12345678",{id:"job-12345678",client:"Sandy",clientEmail:"sandy@example.com",company_name:"V79 Digital",company_email:"support@example.com",company_phone:"",company_address:""}]]);
  let queries=0;
  return {queue, jobs, get queries(){return queries;}, prepare(sql) {
    queries++;
    const q=sql.replace(/\s+/g," ").trim();
    return {
      async run(...args) {
        if(q.includes("INSERT INTO v79_intake_ack_outbox")) {
          const key=args[0]+":"+args[1];
          if(!queue.has(key)) queue.set(key,{account_id:args[0],job_id:args[1],status:"pending",created_at:args[2]});
          return;
        }
        if(q.includes("SET status='sent'")){
          const row=queue.get(args[1]+":"+args[2]);if(row && row.status==="sending")row.status="sent";
          return;
        }
        if(q.includes("SET status='requires_review'")){
          const row=queue.get(args[0]+":"+args[1]);if(row && row.status==="sending")row.status="requires_review";
          return;
        }
        throw Error("Unexpected update: "+q);
      },
      async get(...args) {
        if(q.includes("SELECT status FROM v79_intake_ack_outbox"))
          return queue.get(args[0]+":"+args[1]) || null;
        if(q.includes("UPDATE v79_intake_ack_outbox")&&q.includes("status='sending'")) {
          const pending=[...queue.values()].find(x=>x.status==="pending");
          if(!pending)return null;
          pending.status="sending";
          return {account_id:pending.account_id,job_id:pending.job_id};
        }
        if(q.includes("FROM jobs j LEFT JOIN settings s"))
          return jobs.get(args[1]+":"+args[0]) || null;
        throw Error("Unexpected query: "+q);
      },
    };
  }};
}
const render=(subject,body,vars)=>({
  subject:subject.replace("{{ticket_ref}}",vars.ticket_ref),
  html:body.replace("{{ticket_ref}}",vars.ticket_ref).replaceAll("{{client_name}}",vars.client_name),
});
const factory=(db,send,opts={})=>createIntakeAcknowledgements({
  db,send,render,
  enabled:()=>opts.enabled??true,
  deliveryConfigured:()=>opts.smtp??true,
  now:()=>new Date("2026-11-11T12:00:00.000Z"),
  log:{warn:()=>{}},
});

test("feature disabled is inert",async()=>{
  const db=fakeDatabase(), service=factory(db,async()=>({success:true}),{enabled:false});
  assert.equal(await service.enqueue("tenant1","job-12345678"),"disabled");
  assert.equal((await service.processBatch()).status,"disabled");
  assert.equal(db.queries,0);
});
test("duplicate enqueue remains one job and one account",async()=>{
  const db=fakeDatabase(),svc=factory(db,async()=>({success:true}));
  assert.equal(await svc.enqueue("tenant1","job-12345678"),"pending");
  assert.equal(await svc.enqueue("tenant1","job-12345678"),"pending");
  assert.equal(db.queue.size,1);
});
test("no SMTP leaves queue pending and never claims delivery",async()=>{
  const db=fakeDatabase(),svc=factory(db,async()=>{throw Error("must not send")},{smtp:false});
  await svc.enqueue("tenant1","job-12345678");
  assert.equal((await svc.processBatch()).status,"smtp_not_configured");
  assert.equal(db.queue.values().next().value.status,"pending");
});
test("exactly one successful submission is sent with ticket reference only",async()=>{
  const db=fakeDatabase(),messages=[];
  const svc=factory(db,async(to,subject,html)=>{
    messages.push({to,subject,html});
    return {success:true};
  });
  await svc.enqueue("tenant1","job-12345678");
  assert.equal((await svc.processBatch()).sent,1);
  assert.equal((await svc.processBatch()).claimed,0);
  assert.equal(db.queue.values().next().value.status,"sent");
  assert.equal(messages.length,1);
  assert.match(messages[0].subject,/V79-JOB-1234/);
  assert.equal(messages[0].to,"sandy@example.com");
  assert.doesNotMatch(messages[0].html,/token|portal\//i);
});
test("skipped SMTP is never treated as delivered",async()=>{
  const db=fakeDatabase(),svc=factory(db,async()=>({success:true,skipped:true}));
  await svc.enqueue("tenant1","job-12345678");
  assert.equal((await svc.processBatch()).requiresReview,1);
  assert.equal(db.queue.values().next().value.status,"requires_review");
});
test("ambiguous SMTP failure is held without automatic replay",async()=>{
  const db=fakeDatabase();let calls=0;
  const svc=factory(db,async()=>{calls++;throw Error("SMTP accepted then connection lost")});
  await svc.enqueue("tenant1","job-12345678");
  assert.equal((await svc.processBatch()).requiresReview,1);
  assert.equal((await svc.processBatch()).claimed,0);
  assert.equal(calls,1);
  assert.equal(db.queue.values().next().value.status,"requires_review");
});
test("missing client email is held and not sent",async()=>{
  const db=fakeDatabase();db.jobs.get("tenant1:job-12345678").clientEmail=null;
  let calls=0;const svc=factory(db,async()=>{calls++;return {success:true}});
  await svc.enqueue("tenant1","job-12345678");
  assert.equal((await svc.processBatch()).requiresReview,1);
  assert.equal(calls,0);
});
test("invalid limits fail before touching worker state",async()=>{
  const svc=factory(fakeDatabase(),async()=>({success:true}));
  await assert.rejects(svc.processBatch(21),/Invalid acknowledgement batch/);
});
