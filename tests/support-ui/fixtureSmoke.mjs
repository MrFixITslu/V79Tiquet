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
assert.ok(links.data.items.some(x=>x.jobId==="demoJobA"));
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
 {kind:"service_job",targetId:"demoJobA"});
assert.equal(jobLink.status,201);
const stale=await call("/api/support/staff/tickets/"+created.data.id,"PATCH",
 {status:"open"},{"If-Match":created.etag});
assert.equal(stale.status,412);
const calendar=await call("/api/support/staff/phase4/calendar");
assert.equal(calendar.status,200);assert.equal(calendar.data.timezone,"America/St_Lucia");
const sla=await call("/api/support/staff/phase4/tickets/"+mailTicket.id+"/sla");
assert.equal(sla.status,200);assert.equal(sla.data.source,"synthetic");
assert.equal(sla.data.firstResponse,"met");
const presence=await call("/api/support/staff/phase4/tickets/"+created.data.id+"/presence","PUT",
 {mode:"drafting"},{"If-Match":patch.etag});
assert.equal(presence.status,200);
assert.equal(presence.data.mode,"drafting");
const stalePresence=await call("/api/support/staff/phase4/tickets/"+created.data.id+"/presence","PUT",
 {mode:"viewing"},{"If-Match":created.etag});
assert.equal(stalePresence.status,412);
const pr=await call("/api/support/staff/phase4/tickets/"+created.data.id+"/presence");
assert.equal(pr.status,200);assert.equal(pr.data.currentTicketVersion,2);
const ruleTicket=await call("/api/support/staff/tickets","POST",
 {subject:"Synthetic critical automation check",priority:"critical"},
 {"Idempotency-Key":"synthetic_phase4_critical1"});
assert.equal(ruleTicket.status,201);
const evaluate=await call("/api/support/staff/phase4/tickets/"+ruleTicket.data.id+
 "/automations/evaluate","POST",{});
assert.equal(evaluate.status,200);
assert.deepEqual(evaluate.data.newRules,["critical_unassigned"]);
assert.equal(evaluate.data.notificationsSent,0);
const repeatRules=await call("/api/support/staff/phase4/tickets/"+ruleTicket.data.id+
 "/automations/evaluate","POST",{});
assert.deepEqual(repeatRules.data.newRules,[]);
const recorded=await call("/api/support/staff/phase4/tickets/"+ruleTicket.data.id+"/alerts");
assert.equal(recorded.data.items.length,1);
assert.match(recorded.data.items[0].body,/Synthetic/i);
// REDTEAM: rejected external Origin or Host can never use the synthetic header.
const malicious=await fetch(base+"/api/support/staff/tickets",{
 headers:{...headers,Origin:"https://malicious.example.invalid"},
 signal:AbortSignal.timeout(5000)});
assert.equal(malicious.status,403);
const rebinding=await fetch(base+"/api/support/staff/tickets",{
 headers:{...headers,Host:"evil.example.invalid:3088"},
 signal:AbortSignal.timeout(5000)});
assert.equal(rebinding.status,403);
const safeOrigin=await fetch(base+"/api/support/staff/tickets",{
 headers:{...headers,Origin:"http://127.0.0.1:4308"},
 signal:AbortSignal.timeout(5000)});
assert.equal(safeOrigin.status,200);
const sqlInjection=await call("/api/support/staff/tickets?search="+
 encodeURIComponent("' OR 1=1 --"));
assert.equal(sqlInjection.status,200);
assert.equal(sqlInjection.data.items.length,0);
const invalidUnknown=await call("/api/support/staff/tickets","POST",
 {subject:"Good synthetic",accountId:"other"},
 {"Idempotency-Key":"synthetic_bad_tenant_request_01"});
assert.equal(invalidUnknown.status,400);
const attemptPublic=await call("/api/support/staff/tickets/"+mailTicket.id+"/messages","POST",
 {body:"Do not send this synthetic reply",visibility:"public"},
 {"Idempotency-Key":"synthetic_public_denial_0001"});
assert.equal(attemptPublic.status,409);
assert.equal(attemptPublic.data.code,"OUTBOUND_NOT_ENABLED");
console.log("SUPPORT_UI_SYNTHETIC_HTTP_SMOKE=PASS");
