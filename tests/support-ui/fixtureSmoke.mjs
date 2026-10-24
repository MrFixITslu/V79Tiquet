import assert from "node:assert/strict";
const base="http://127.0.0.1:3088";
const headers={"x-synthetic-user":"agentA","x-synthetic-account":"demoA",
 "Content-Type":"application/json"};
async function call(url,method="GET",body,additional={}){
 const res=await fetch(base+url,{method,headers:{...headers,...additional},
  body:body===undefined?undefined:JSON.stringify(body),
  signal:AbortSignal.timeout(5000)});
 const data=await res.json();return {status:res.status,data,etag:res.headers.get("ETag")};
}
const health=await call("/sandbox/health");
assert.equal(health.status,200);assert.equal(health.data.synthetic,true);
const denied=await fetch(base+"/api/support/staff/tickets",{signal:AbortSignal.timeout(5000)});
assert.equal(denied.status,401);
const initial=await call("/api/support/staff/tickets?limit=25");
assert.equal(initial.status,200);
assert.ok(initial.data.items.length>=3);
assert.equal(initial.data.nextCursor,null);
const mailTicket=initial.data.items.find(t=>t.subject.includes("Fiber connection"));
assert.ok(mailTicket);
const open=await call("/api/support/staff/tickets/"+mailTicket.id);
assert.equal(open.status,200);
const messages=await call("/api/support/staff/tickets/"+mailTicket.id+"/messages");
assert.equal(messages.status,200);assert.ok(messages.data.items.length>=3);
assert.ok(messages.data.items.some(m=>m.deliveryState==="accepted"));
assert.ok(messages.data.items.some(m=>m.direction==="inbound"));
const links=await call("/api/support/staff/tickets/"+mailTicket.id+"/links");
assert.equal(links.status,200);
assert.ok(links.data.items.some(x=>x.jobId==="jobA"));
const created=await call("/api/support/staff/tickets","POST",
 {subject:"New synthetic UI ticket",priority:"normal"},
 {"Idempotency-Key":"synthetic_ui_new_0001"});
assert.equal(created.status,201);
const patch=await call("/api/support/staff/tickets/"+created.data.id,"PATCH",
 {priority:"high"},{"If-Match":created.etag});
assert.equal(patch.status,200);assert.equal(patch.data.priority,"high");
const note=await call("/api/support/staff/tickets/"+created.data.id+"/messages","POST",
 {body:"UI synthetic note",visibility:"internal"},
 {"Idempotency-Key":"synthetic_ui_note_0001"});
assert.equal(note.status,201);assert.equal(note.data.visibility,"internal");
const forbidden=await call("/api/support/staff/tickets/"+created.data.id+"/messages","POST",
 {body:"Would be customer-facing",visibility:"public"},
 {"Idempotency-Key":"synthetic_ui_reply_0001"});
assert.equal(forbidden.status,409);assert.equal(forbidden.data.code,"OUTBOUND_NOT_ENABLED");
const jobLink=await call("/api/support/staff/tickets/"+created.data.id+"/links","POST",
 {kind:"service_job",targetId:"jobA"});
assert.equal(jobLink.status,201);
const stale=await call("/api/support/staff/tickets/"+created.data.id,"PATCH",
 {status:"open"},{"If-Match":created.etag});
assert.equal(stale.status,412);
console.log("SUPPORT_UI_SYNTHETIC_HTTP_SMOKE=PASS");
