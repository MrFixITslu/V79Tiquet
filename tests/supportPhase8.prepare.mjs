// Test preparation only. Check out immutable Hub and exact feature-branch Tiquet.
import fs from "node:fs";
import {execFileSync} from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
if(process.env.GITHUB_ACTIONS!=="true"||
 process.env.V79_PAIRED_TEST_SCOPE!=="github-ci-disposable"||
 process.env.WIPAY_ENABLED!=="0"||
 process.env.V79_ALLOW_PRODUCTION_DEPLOY!=="0"||
 process.env.NODE_ENV!=="test"||
 process.env.DATABASE_URL!=="postgresql://tiquet_test:tiquet_test_password@127.0.0.1:5432/tiquet_test")
 throw Error("PHASE8_SYNTHETIC_TEST_SCOPE_REQUIRED");
const hubRoot=process.cwd(),tiquetRoot=process.env.GITHUB_WORKSPACE;
assert.ok(tiquetRoot&&hubRoot===path.join(tiquetRoot,"phase8-hub-source"));
const hubSha="ee79ec9353ee4248eb8276fee2e6c3476b3af491";
const rev=p=>execFileSync("git",["-C",p,"rev-parse","HEAD"],{encoding:"utf8"}).trim();
assert.equal(rev(hubRoot),hubSha);
const tiquetSha=rev(tiquetRoot);
assert.equal(tiquetSha,process.env.GITHUB_SHA);
assert.match(tiquetSha,/^[a-f0-9]{40}$/);
const srcPath=path.join(hubRoot,"tests/paired-hub-tiquet-bound-session.test.mjs");
const destPath=path.join(hubRoot,"tests/support-phase8-ci-copy.test.mjs");
let s=fs.readFileSync(srcPath,"utf8");
function exact(old,neu){
 assert.equal(s.split(old).length-1,1,"Pinned Hub test changed; STOP: "+old.slice(0,65));
 s=s.replace(old,()=>neu);
}
exact('const TIQUET_COMMIT = "775d9f6c9afae70760896f5ef5cf090272d6a2af";',
 'const TIQUET_COMMIT = "'+tiquetSha+'";');
// Hub strictly validates the known .v79sl.com redirect hostname. The test
// asserts the Location header and uses redirect:"manual" (never follows it).
// The pinned full Hub requires its built-in admin email label at boot.
// This is only a temporary test account with a fabricated password; SMTP and
// external mail integrations are disabled by the GitHub Actions guard.
const extra=[
'  // Additional synthetic job and invoice stage regression. No payment or email sends.',
'  const invoiceCreate=await req(tiquet,"/api/jobs",{',
'    method:"POST",headers:mutationHeaders(aCookie),',
'    body:JSON.stringify({',
'      title:"Synthetic invoice-stage regression",',
'      client:"Synthetic Alpha updated",',
'      status:"invoiced",priority:"medium",amount:450,',
'      lineItems:[{description:"Synthetic support contract",quantity:1,price:450}],',
'      invoiceNotes:"NONPRODUCTION FIXTURE. DO NOT SEND."',
'    })',
'  });',
'  const invoice=await readOk(invoiceCreate,201);',
'  assert.equal(invoice.status,"invoiced");',
'  assert.equal(Number(invoice.amount),450);',
'  const jobsA=await readOk(await req(tiquet,"/api/jobs",{headers:{Cookie:aCookie}}),200);',
'  const jobsB=await readOk(await req(tiquet,"/api/jobs",{headers:{Cookie:bCookie}}),200);',
'  assert.ok(jobsA.some(j=>j.id===invoice.id));',
'  assert.ok(!jobsB.some(j=>j.id===invoice.id));',
'  const matched=jobsA.find(j=>j.id===invoice.id);',
'  assert.equal(matched.status,"invoiced");',
'  assert.equal(Number(matched.amount),450);',
'  assert.equal(matched.lineItems[0].description,"Synthetic support contract");',
'  const crossInvoice=await req(tiquet,"/api/jobs/"+encodeURIComponent(invoice.id),{',
'    method:"PUT",headers:mutationHeaders(bCookie),',
'    body:JSON.stringify({status:"paid",amount:1})',
'  });',
'  assert.equal(crossInvoice.status,404,"B cannot mutate A invoice-stage job");',
'  const unpaidCreate=await req(tiquet,"/api/jobs",{',
'    method:"POST",headers:mutationHeaders(aCookie),',
'    body:JSON.stringify({title:"Forbidden directly paid",client:"Synthetic Alpha updated",',
'      status:"paid",amount:450})',
'  });',
'  assert.equal(unpaidCreate.status,409,"direct payment bypass must remain denied");',
'  assert.equal((await readOk(await req(tiquet,"/api/jobs",{headers:{Cookie:aCookie}}),200))',
'    .find(j=>j.id===invoice.id).status,"invoiced");',
'  console.log("PHASE8_SYNTHETIC_JOB_AND_INVOICE_STAGE_REGRESSIONS=PASS");'
].join("\n");
exact('  // Verify the exact issued JWT before explicit Tiquet logout.',
 extra+'\n  // Verify the exact issued JWT before explicit Tiquet logout.');
exact('  assert.equal(await closedByRevocation,4003,\n    "existing authenticated Tiquet staff WebSocket must close on Hub logout");',
 '  const wsCloseCode=await closedByRevocation;\n'+
 '  console.log("PHASE8_WS_REVOKE_CLOSE="+wsCloseCode+" "+tiquetProcess.readLogs());\n'+
 '  assert.equal(wsCloseCode,4003,\n'+
 '    "existing authenticated Tiquet staff WebSocket must close on Hub logout");');

assert.ok(s.includes("https://tiquet.v79sl.com"));
assert.ok(s.includes('redirect:"manual"'));
assert.ok(s.includes("TIQUET_INTERNAL_URL:tiquet"));
assert.ok(s.includes(tiquetSha));
assert.ok(s.includes("HUB_ONLY_GLOBAL_LOGOUT_GATE=ISOLATED_PASS"));
fs.writeFileSync(destPath,s,{mode:0o600});
console.log("PHASE8_TEMP_HUB_TEST_PINNED_AND_SYNTHETIC=PASS");
