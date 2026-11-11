import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {invoiceDeliveryDecision,invoiceCcForAccount} from "../server/invoiceDelivery.js";
import {renderEmailFromPlainTemplate} from "../server/email.js";

const job={status:"invoiced",clientEmail:"customer@example.com",amount:250,id:"11111111-1111-4111-8111-111111111111"};
const server=readFileSync(new URL("../server/index.js",import.meta.url),"utf8");
const invoices=readFileSync(new URL("../src/components/Invoices.tsx",import.meta.url),"utf8");

test("only a real invoice status and recipient can send",()=>{
 for(const status of ["invoiced","completed","paid"])
  assert.equal(invoiceDeliveryDecision({...job,status}).ok,true);
 for(const status of ["request","review","cancelled"])
  assert.equal(invoiceDeliveryDecision({...job,status}).ok,false);
 assert.equal(invoiceDeliveryDecision({...job,amount:0}).ok,false);
 assert.equal(invoiceDeliveryDecision({...job,clientEmail:"invalid"}).ok,false);
});
test("Vision79 copy recipient is scoped only to its exact account",()=>{
 const env={V79_TIQUET_INVOICE_CC_ACCOUNT_ID:"owner_account_id",
  V79_TIQUET_INVOICE_CC_EMAIL:"vision79slu@gmail.com"};
 assert.deepEqual(invoiceCcForAccount("owner_account_id",env),{
  cc:"vision79slu@gmail.com",required:true,
 });
 assert.deepEqual(invoiceCcForAccount("other_customer_tenant",env),{
  cc:null,required:false,
 });
 assert.equal(invoiceCcForAccount("owner_account_id",{
   ...env,V79_TIQUET_INVOICE_CC_EMAIL:"invalid"
 }).error,"cc_not_configured");
});
test("invoice text is escaped and never invents payment confirmation",()=>{
 const {subject,html}=renderEmailFromPlainTemplate(
  "Invoice available — {{ticket_ref}}",
  "Hi {{client_name}}. Invoice {{ticket_ref}}. No payment confirmed.",
  {ticket_ref:"V79-123",client_name:"<img onerror=alert(1)>",
   company_name:"Vision79",company_address:"",company_phone:"",company_email:""});
 assert.equal(subject,"Invoice available — V79-123");
 assert.ok(html.includes("&lt;img"));
 assert.ok(!html.includes("<img onerror"));
 assert.ok(html.includes("No payment confirmed"));
});
test("invoice endpoint is permissioned, feature-gated, tenant-scoped and idempotent",()=>{
 const route=server.slice(server.indexOf('app.post("/api/jobs/:id/send-invoice"'),
  server.indexOf('app.post("/api/jobs/:id/revoke-portal"'));
 for(const marker of [
  "V79_ECOSYSTEM_V2_INVOICE_SEND_ENABLED",
  'requireAnyPagePermission("invoices")',
  "invoiceDeliveryDecision",
  "invoiceCcForAccount(req.accountId)",
  "transactionalSmtpReady()",
  "ON CONFLICT (account_id,job_id,request_id) DO NOTHING",
  "requires_review",
  "sendInvoiceNotice",
  "result.skipped",
 ])assert.ok(route.includes(marker),"Missing invoice safety marker: "+marker);
 assert.doesNotMatch(route,/INSERT INTO payments|UPDATE payments|markInvoiceAsPaid/);
});
test("invoice send UI is explicit, safely disabled and distinguishes copy status",()=>{
 assert.match(invoices,/invoiceMailEnabled/);
 assert.match(invoices,/Send Invoice Link/);
 assert.match(invoices,/copySent/);
 assert.match(invoices,/invoiceMailRequests/);
 assert.match(invoices,/\\/jobs\\/\\$\\{encodeURIComponent\\(jobId\\)\\}\\/send-invoice/);
});
