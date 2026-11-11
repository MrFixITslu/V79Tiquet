import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeHubEventProjection } from "../server/platformEventProjection.js";
const schema=readFileSync(new URL("../server/schema.sql", import.meta.url),"utf8");
const server=readFileSync(new URL("../server/index.js", import.meta.url),"utf8");
const portal=readFileSync(new URL("../src/components/ClientPortal.tsx", import.meta.url),"utf8");
const row={id:"11111111-1111-4111-8111-111111111111",
  hub_organization_id:"org_customer_abc123",account_id:"account_customer",
  event_type:"customer.feedback_submitted",subject_id:"job_one1234",
  occurred_at:"2026-11-11T12:00:00.000Z"};

test("feedback has tenant and job unique constraints",()=>{
  assert.match(schema,/CREATE TABLE IF NOT EXISTS v79_job_feedback_v2/);
  assert.match(schema,/UNIQUE \(account_id, job_id\)/);
  assert.match(schema,/CHECK \(rating BETWEEN 1 AND 5\)/);
});
test("portal feedback requires active token, allowed stage, bounded form and avoids auto close",()=>{
  assert.match(server,/app\.post\("\/api\/portal\/:token\/feedback"/);
  assert.match(server,/getActivePortalJob\(req\.params\.token\)/);
  assert.match(server,/\["review","completed","paid"\]\.includes\(job\.status\)/);
  assert.match(server,/raw\.length > 1000/);
  assert.match(server,/ON CONFLICT \(account_id, job_id\) DO NOTHING/);
  const handler=server.slice(server.indexOf('app.post("/api/portal/:token/feedback"'),
    server.indexOf('app.post("/api/portal/:token/approve-quote"'));
  assert.doesNotMatch(handler,/updateJobStage\(|sendLeadToTiquet|marketing/i);
});
test("staff must have tenant-scoped ticket access to view private feedback text",()=>{
  assert.match(server,/app\.get\("\/api\/jobs\/:id\/feedback", authenticateToken/);
  assert.match(server,/requireAnyPagePermission\("jobs", "clients"\)/);
  assert.match(server,/FROM v79_job_feedback_v2 WHERE account_id = \? AND job_id = \?/);
});
test("Hub projections contain feedback categories but never review text",()=>{
  const payload={rating:"4",contactAllowed:"yes",comment:"Private client experience"};
  const received=makeHubEventProjection(row,payload);
  assert.equal(received.ok,true);
  assert.deepEqual(received.event.payload,{rating:"4",contactAllowed:"yes"});
  for(const wrong of [
    {rating:"6",contactAllowed:"yes"},
    {rating:"5",contactAllowed:"marketing"},
    {rating:"5"},
  ]) assert.equal(makeHubEventProjection(row,wrong).ok,false);
});
test("feedback UI asks contact permission, not marketing consent",()=>{
  assert.match(portal,/You may contact me about this feedback\. This is not marketing consent\./);
  assert.match(portal,/\/api\/portal\/\$\{token\}\/feedback/);
  assert.match(portal,/\["review","completed","paid"\]\.includes\(job\.status\)/);
});

test("feedback stays inaccessible until explicit environment approval",()=>{
  const route=server.slice(server.indexOf('app.post("/api/portal/:token/feedback"'),
    server.indexOf('app.post("/api/portal/:token/approve-quote"'));
  assert.match(route,/V79_ECOSYSTEM_V2_FEEDBACK_ENABLED/);
  assert.match(portal,/data.feedback\?\.enabled/);
});
