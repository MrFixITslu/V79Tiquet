import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInvoiceCopyEmail, invoiceBccForWorkspace, parseDueDate } from "../server/billingOptions.js";

test("each workspace controls its own invoice BCC and avoids duplicate recipients", () => {
  assert.equal(invoiceBccForWorkspace({ invoiceCopyEmail: "  Vision79SLU@gmail.com  " }, "client@example.com"), "vision79slu@gmail.com");
  assert.equal(invoiceBccForWorkspace({ invoiceCopyEmail: "vision79slu@gmail.com" }, "VISION79SLU@GMAIL.COM"), null);
  assert.equal(invoiceBccForWorkspace({ invoiceCopyEmail: null }, "client@example.com"), null);
  assert.equal(invoiceBccForWorkspace({}, "client@example.com"), null);
});

test("BCC rejects multiple addresses, dangerous characters, and invalid types", () => {
  for (const address of ["first@example.com,other@example.com", "first@example.com;other@example.com", "abc@example.com\nBcc: evil@example.com", "invalid-at-example", {}, ["bad@example.com"]]) {
    assert.throws(() => normalizeInvoiceCopyEmail(address), /one valid|single email/);
  }
  assert.equal(normalizeInvoiceCopyEmail(null), "");
  assert.equal(normalizeInvoiceCopyEmail("  "), "");
});

test("due dates use exact calendar dates, preserve leap days, allow clearing", () => {
  assert.equal(parseDueDate("2028-02-29"), "2028-02-29");
  assert.equal(parseDueDate("2026-11-08"), "2026-11-08");
  assert.equal(parseDueDate(null), null);
  assert.equal(parseDueDate(""), null);
  for (const value of ["2026-02-29", "2026-13-01", "2026-11-31", "2026/11/08", "2026-11-08T00:00:00Z", 1234]) {
    assert.throws(() => parseDueDate(value), /valid|does not exist/);
  }
});
