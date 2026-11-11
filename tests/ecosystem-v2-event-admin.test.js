import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server=readFileSync(new URL("../server/index.js",import.meta.url),"utf8");
const settings=readFileSync(new URL("../src/components/Settings.tsx",import.meta.url),"utf8");
const config=readFileSync(new URL("../.env.example",import.meta.url),"utf8");

test("only administrator and tenant-scoped queries may access event evidence",()=>{
 const section=server.slice(
  server.indexOf('app.get("/api/integrations/platform-events"'),
  server.indexOf("// --- FILE REPOSITORY ENDPOINTS ---"));
 for(const required of [
  'requireAdmin',
  'V79_ECOSYSTEM_V2_EVENT_ADMIN_ENABLED',
  'WHERE account_id=?',
  'correlation_id=?',
  'req.accountId',
  'platformEventsConfigured()',
  "status='failed'",
  "status='pending'",
  "FROM platform_event_outbox"
 ]) assert.ok(section.includes(required),"Missing event safety: "+required);
 assert.doesNotMatch(section,/payload_json|SELECT \* FROM platform_event_outbox/);
});
test("manual replay needs reason, an exact failed event and does not pretend to deliver",()=>{
 const route=server.slice(
  server.indexOf('app.post("/api/integrations/platform-events/:id/retry"'),
  server.indexOf("// --- FILE REPOSITORY ENDPOINTS ---"));
 assert.match(route,/req\.body\.reason\.trim\(\)\.length<12/);
 assert.match(route,/item\.status!=="failed"/);
 assert.match(route,/FOR UPDATE/);
 assert.match(route,/WHERE id=\? AND account_id=\? AND status='failed'/);
 assert.match(route,/delivered:false/);
 assert.doesNotMatch(route,/sendTemplated|sendInvoiceNotice|recordVerifiedWipayPayment|INSERT INTO payments/);
});
test("admin UI distinguishes receipt state and uncertain delivery",()=>{
 assert.match(settings,/Hub event delivery evidence/);
 assert.match(settings,/These are receipt statuses, not customer payments/);
 assert.match(settings,/Queue reviewed retry/);
 assert.match(settings,/No delivery is confirmed yet/);
 assert.match(config,/V79_ECOSYSTEM_V2_EVENT_ADMIN_ENABLED=0/);
});
