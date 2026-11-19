import test from "node:test";
import assert from "node:assert/strict";
import { renderInvoicePdf, validateInvoice, invoiceReference } from "../server/invoiceDocuments.js";

test("invoice renderer produces an actual PDF using the locked runtime dependency", async () => {
  const job = {id:"12345678-1234-4abc-8abc-123456789abc", status:"invoiced", amount:250, client:"Synthetic audit client", clientEmail:"qa@example.test", title:"Synthetic service", depositPolicy:"waived"};
  const pdf = await renderInvoicePdf({job,client:{name:"Synthetic audit client"},settings:{name:"Synthetic QA office",currency:"XCD"},issuedAt:"2026-11-19T10:00:00Z",paidAmount:50});
  assert.ok(Buffer.isBuffer(pdf));
  assert.ok(pdf.length>500);
  assert.match(pdf.subarray(0,8).toString(),/^%PDF-/);
  assert.match(pdf.subarray(-32).toString(),/%%EOF\s*$/);
  assert.equal(invoiceReference(job.id),"INV-12345678");
});
test("invoice validation rejects non-finalised and non-positive jobs", () => {
  assert.ok(validateInvoice({status:"new",amount:250},"qa@example.test"));
  assert.ok(validateInvoice({status:"invoiced",amount:0},"qa@example.test"));
});
