import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=readFileSync(new URL("../server/index.js",import.meta.url),"utf8");
const schema=readFileSync(new URL("../server/schema.sql",import.meta.url),"utf8");
const portal=readFileSync(new URL("../src/components/ClientPortal.tsx",import.meta.url),"utf8");

test("delivery acceptance has an additive nullable schema column",()=>{
 assert.match(schema,/ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deliveryAcceptedAt TEXT/);
});
test("signed-in staff cannot mark paid in V2 without customer acceptance",()=>{
 const section=source.slice(source.indexOf("const updateJobStage ="),
  source.indexOf("const createNotification",source.indexOf("const updateJobStage ="))>0?
  source.indexOf("const createNotification",source.indexOf("const updateJobStage =")):
  source.indexOf("// Create a new job",source.indexOf("const updateJobStage =")));
 assert.match(section,/DELIVERY_ACCEPTANCE_REQUIRED/);
 assert.match(source,/deliveryAcceptanceRequired\(\)/);
 assert.match(source,/Boolean\(job\.deliveryAcceptedAt\)/);
 assert.match(source,/Boolean\(existingJob\.deliveryAcceptedAt\)/);
});
test("portal acceptance is a separate voluntary action from quote and payments",()=>{
 const pos=source.indexOf('app.post("/api/portal/:token/accept-delivery"');
 assert.ok(pos>0);
 const route=source.slice(pos,source.indexOf('app.post("/api/portal/:token/feedback"',pos));
 for(const marker of [
  'deliveryAcceptanceRequired()',
  'getActivePortalJob',
  'req.body?.accept !== true',
  'deliveryAcceptedAt IS NULL',
  'Customer confirmed delivery acceptance',
  '"review","invoiced","completed","paid"',
 ])assert.ok(route.includes(marker),"Missing portal acceptance gate: "+marker);
 assert.doesNotMatch(route,/INSERT INTO payments|UPDATE payments|recordVerifiedWipayPayment/);
});
test("UI separates accepted work from marketing/quote/payment consent",()=>{
 assert.match(portal,/I accept the delivered work/);
 assert.match(portal,/This does not authorise a payment or subscribe you to marketing/);
 assert.match(portal,/deliveryAcceptance\?\.enabled/);
});
