import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
const root=process.cwd();
const read=p=>fs.readFile(path.join(root,p),"utf8");
if(process.env.CI_SUPPORT_SYNTHETIC!=="1"||
 process.env.NODE_ENV!=="test"||
 process.env.V79_SUPPORT_DESK_ENABLED!=="0")
 throw Error("PHASE6_SOURCE_GUARD_SYNTHETIC_ONLY");
const app=await read("server/index.js");
const main=await read("src/App.tsx");
const routes=await read("server/support/router.js");
const phase4=await read("server/support/phase4Router.js");
const auth=await read("server/support/phase6AuthHarness.js");
const rollback=await read("server/support/phase6-synthetic-rollback.sql");
// No production import/mount of sandbox role/context, local-only mail.
// No accidental modification of navigation or production UI.
assert.ok(!app.includes("phase6AuthHarness"));
assert.ok(!app.includes("phase6HubPolicy"));
assert.ok(!app.includes("phase6-hub-schema"));
assert.ok(!app.includes("phase6-synthetic-rollback"));
assert.ok(!main.includes("SupportDeskSandbox"));
assert.ok(routes.includes("resolveCapabilities=null"));
assert.ok(phase4.includes("resolveCapabilities=null"));
assert.ok(auth.includes('hubUrl="http://127.0.0.1:4099"'));
assert.ok(auth.includes('target.hostname!=="127.0.0.1"'));
assert.ok(auth.includes('target.protocol!=="http:"'));
assert.ok(!/from ["']nodemailer["']|smtp\.|imap\./i.test(auth));
assert.ok(!/\bCASCADE\b/i.test(rollback.replace(/^--.*$/gm,"")));
for(const sensitive of ["DROP TABLE accounts","DROP TABLE users","DROP TABLE jobs","DROP TABLE clients",
 "UPDATE jobs","DELETE FROM users"]){
 assert.ok(!rollback.includes(sensitive),sensitive+" in rollback");
}
const listed=rollback.split("\n").filter(l=>l.startsWith("DROP TABLE"));
assert.ok(listed.length>=15);
assert.ok(listed.every(l=>/^DROP TABLE IF EXISTS support_[a-z_]+;$/.test(l)));
console.log("SUPPORT_P6_FAIL_CLOSED_SOURCE_AND_ROLLBACK_GUARD=PASS");
