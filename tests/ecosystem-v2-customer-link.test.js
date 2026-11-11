import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const server=fs.readFileSync(new URL("../server/index.js",import.meta.url),"utf8");
const modal=fs.readFileSync(new URL("../src/components/JobDetailModal.tsx",import.meta.url),"utf8");

test("website enquiry creates a customer-linked job in the same tenant",()=>{
  assert.match(server,/UPDATE jobs SET clientId = \? WHERE id = \? AND account_id = \?/);
  assert.match(server,/\.run\(clientId, id, accountId\)/);
});
test("duplicate intake returns the exact prior job's linked client",()=>{
  assert.match(server,/SELECT id, clientId FROM jobs WHERE intakeEventId = \? AND account_id = \?/);
  assert.match(server,/SELECT id FROM clients WHERE id = \? AND account_id = \?/);
  assert.match(server,/clientId: linkedClient\?\.id \|\| null/);
});
test("ticket details never link customers by matching company names",()=>{
  assert.match(modal,/job\.clientId\s*\?\s*clients\.find\(\(c\) => c\.id === job\.clientId\)/);
  assert.doesNotMatch(modal,/c\.company\?\.toLowerCase\(\) === job\.client\?\.toLowerCase\(\)/);
});

test("strict v2 intake rejects identity guesses while preserving idempotent ticket ID",()=>{
  assert.match(server,/V79_ECOSYSTEM_V2_STRICT_INTAKE_IDENTITY/);
  assert.match(server,/if \(process\.env\.V79_ECOSYSTEM_V2_STRICT_INTAKE_IDENTITY !== "1"\)/);
  assert.match(server,/SELECT id, clientId FROM jobs WHERE intakeEventId = \? AND account_id = \?/);
});
