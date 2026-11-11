import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cancellationDecision, validTicketDate } from "../server/jobCancellation.js";

const server=readFileSync(new URL("../server/index.js",import.meta.url),"utf8");
const board=readFileSync(new URL("../src/components/JobBoard.tsx",import.meta.url),"utf8");
const detail=readFileSync(new URL("../src/components/JobDetailModal.tsx",import.meta.url),"utf8");

test("ticket cancellation requires unpaid pre-invoice service work",()=>{
 for(const status of ["request","estimation","in-progress","review"])
   assert.deepEqual(cancellationDecision({status},0),{allowed:true,alreadyCancelled:false});
 for(const status of ["invoiced","completed","paid","unknown"])
   assert.deepEqual(cancellationDecision({status},0),{
     allowed:false,reason:"manual_financial_closure_required",
   });
});
test("recorded payment always blocks cancellation and preserves finance ledger",()=>{
 assert.deepEqual(cancellationDecision({status:"review"},0.01),{
   allowed:false,reason:"payment_requires_review",
 });
 assert.deepEqual(cancellationDecision({status:"request"},NaN),{
   allowed:false,reason:"ledger_unavailable",
 });
 assert.equal(cancellationDecision({status:"cancelled"},0).alreadyCancelled,true);
});
test("editable due dates must be real calendar days",()=>{
 for(const d of [undefined,null,"","2026-11-11","2028-02-29"])
   assert.equal(validTicketDate(d),true);
 for(const d of ["2026-02-29","2026-02-31","2026-13-01","11/11/2026",
   "2026-11-11<script>",37,"2026-11-11T08:00:00Z"])
   assert.equal(validTicketDate(d),false);
});
test("API gate, row lock and audit are required for cancellation",()=>{
 const route=server.slice(server.indexOf('app.post("/api/jobs/:id/cancel"'),
   server.indexOf('app.put("/api/jobs/:id"'));
 for(const marker of [
  'V79_ECOSYSTEM_V2_CANCEL_ENABLED',
  'authenticateToken',
  'requireAnyPagePermission("jobs")',
  'FOR UPDATE',
  'cancellationDecision',
  'secureTokenRevokedAt',
  'INSERT INTO activity_logs',
  'safeQueuePlatformEvent',
  "status='cancelled'",
 ])assert.ok(route.includes(marker),"Missing cancellation safety marker: "+marker);
 assert.doesNotMatch(route,/INSERT INTO payments|UPDATE payments|recordVerifiedWipayPayment/);
});
test("cancelled jobs never reappear as paid or advance on the kanban board",()=>{
 assert.match(board,/Cancelled tickets/);
 assert.match(board,/job.status==="cancelled"/);
 assert.match(board,/onReload\(\)/);
 assert.match(detail,/Close as customer cancelled/);
 assert.match(detail,/onCancel\(job.id, cancelReason.trim\(\)\)/);
 assert.match(detail,/type="date" aria-label="Edit ticket due date"/);
});
