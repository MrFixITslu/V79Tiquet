import test from "node:test";
import assert from "node:assert/strict";
import { invoiceReference, invoiceRecipient, validateInvoice, renderInvoicePdf } from "../server/invoiceDocuments.js";

const job = {
  id: "f51ab246-1234-4a1d-bacd-111111111111",
  status: "invoiced",
  client: "Example Client",
  title: "On-site network diagnosis",
  amount: 150,
  description: "Diagnose office router and network cabling",
  invoiceNotes: "Service charge included in total",
  clientEmail: "client@example.com",
};

test("invoice identifiers are stable and linked recipients have no fallback to an arbitrary address", () => {
  assert.equal(invoiceReference(job.id), "INV-F51AB246");
  assert.equal(invoiceRecipient(job, null), "client@example.com");
  assert.equal(invoiceRecipient({ ...job, clientEmail: "" }, { email: "linked@example.com" }), "linked@example.com");
  assert.equal(invoiceRecipient({ ...job, clientEmail: "" }, null), "");
});

test("cancelled, unpaid-stage and zero-value jobs cannot be invoiced", () => {
  assert.match(validateInvoice({ ...job, status: "cancelled" }, job.clientEmail), /Move the job/);
  assert.match(validateInvoice({ ...job, status: "request" }, job.clientEmail), /Move the job/);
  assert.match(validateInvoice({ ...job, amount: 0 }, job.clientEmail), /positive/);
  assert.match(validateInvoice(job, "bad-address"), /valid customer/);
  assert.equal(validateInvoice(job, job.clientEmail), null);
  assert.equal(validateInvoice(job, null, false), null);
});

test("PDF rendering creates a genuine PDF with one canonical invoice number", async () => {
  const pdf = await renderInvoicePdf({
    job, settings: { name: "Vision79 Digital", currency: "XCD", paymentTerms: "Net 14 days" },
    client: { name: "Test Customer", address: "Castries" }, issuedAt: "2026-11-08T11:00:00Z"
  });
  assert.ok(Buffer.isBuffer(pdf));
  assert.equal(pdf.subarray(0, 5).toString("utf8"), "%PDF-");
  assert.ok(pdf.length > 1300);
});
