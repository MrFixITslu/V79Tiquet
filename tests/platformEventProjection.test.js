import test from "node:test";
import assert from "node:assert/strict";
import { makeHubEventProjection } from "../server/platformEventProjection.js";

const row={
 id:"77777777-7777-4777-8777-777777777777",
 account_id:"11111111-1111-4111-8111-111111111111",
 hub_organization_id:"org_vision79_customer_A",
 event_type:"job.created",
 subject_id:"22222222-2222-4222-8222-222222222222",
 occurred_at:"2026-11-11T04:00:00Z",
};

test("mapped Tiquet event passes minimum safe fields",()=>{
 const p=makeHubEventProjection(row,{status:"request",priority:"medium",origin:"website"});
 assert.equal(p.ok,true);
 assert.equal(p.event.accountRef,row.account_id);
 assert.equal(p.event.organizationRef,row.hub_organization_id);
 assert.deepEqual(p.event.payload,{status:"request",priority:"medium",origin:"website"});
});
test("missing mapping is held, never substituted with local account ID",()=>{
 for (const r of [
   {...row,hub_organization_id:null},
   {...row,hub_organization_id:""},
   {...row,hub_organization_id:"x"},
   {...row,account_id:""},
 ]) {
   const p=makeHubEventProjection(r,{status:"request"});
   assert.equal(p.ok,false);
   assert.equal(p.reason,"missing_verified_hub_mapping");
 }
});
test("customer-identifying title, company and payment reference are not exported",()=>{
 const received=makeHubEventProjection(row,{
   title:"Jane Smith sensitive issue",company:"Customer Corp",status:"request",
   email:"someone@example.com",phone:"+1758-555-0199",token:"bearer",
 });
 assert.equal(received.ok,true);
 assert.deepEqual(received.event.payload,{status:"request"});
});
test("payment-recorded remains informational and never implies settlement",()=>{
 const received=makeHubEventProjection({...row,event_type:"payment.recorded"},{
   jobId:"1234",title:"Client",amount:450.25,reference:"wipay_secret_123",
   currency:"XCD",method:"card_external",provider:"wipay",
 });
 assert.equal(received.ok,true);
 assert.deepEqual(received.event.payload,{
   currency:"XCD",method:"card_external",provider:"wipay",
 });
});
test("paid job status never creates financial value",()=>{
 const p=makeHubEventProjection({...row,event_type:"job.paid"},{amount:9999,currency:"XCD",title:"Private"});
 assert.equal(p.ok,true);
 assert.deepEqual(p.event.payload,{});
});
test("unknown type, invalid ID and invalid timestamp are blocked",()=>{
 for(const r of [
   {...row,event_type:"invoice.settled"},
   {...row,id:"bad-event"},
   {...row,subject_id:""},
   {...row,occurred_at:"not-a-time"},
 ]) assert.equal(makeHubEventProjection(r,{}).ok,false);
});
test("bad allowed values are blocked rather than silently dropped",()=>{
 for(const payload of [
   {status:"jane@example.com"},
   {status:"https://private-client"},
   {status:""},
   {status:{nested:"object"}},
 ])assert.equal(makeHubEventProjection(row,payload).ok,false);
});
test("currency is strict ISO format",()=>{
 for(const currency of ["xcD","US","XCD123"]) {
  assert.equal(makeHubEventProjection({...row,event_type:"payment.recorded"},{currency}).ok,false);
 }
});

test("website lead correlation is opaque and only forwarded when a UUID",()=>{
  const valid="44444444-4444-4444-8444-444444444444";
  const good=makeHubEventProjection({...row,correlation_id:valid},{status:"request"});
  assert.equal(good.event.correlationId,valid);
  const rejected=makeHubEventProjection({...row,correlation_id:"jane@example.com"},{status:"request"});
  assert.equal(Object.hasOwn(rejected.event,"correlationId"),false);
});

test("event dispatch SQL qualifies fields when joined to accounts", async()=>{
  const {readFileSync}=await import("node:fs");
  const source=readFileSync(new URL("../server/platformEvents.js",import.meta.url),"utf8");
  assert.match(source,/WHERE o\.status = 'pending'/);
  assert.match(source,/o\.next_attempt_at/);
  assert.match(source,/ORDER BY o\.created_at ASC/);
  assert.doesNotMatch(source,/WHERE status = 'pending'/);
});
