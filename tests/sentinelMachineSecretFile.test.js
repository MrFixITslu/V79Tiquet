import assert from "node:assert/strict";
import test from "node:test";
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {readPrivateMachineSecret} from "../server/sentinelMachineSecretFile.js";

function withSecret(callback){
 const dir=mkdtempSync(join(tmpdir(),"v79-secret-"));
 const file=join(dir,"reviewer.secret");
 try{
  writeFileSync(file,"synthetic-reviewer-machine-secret-1234567890-abcdefghijklmnop",{mode:0o600});
  return callback(file);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test("read reviewer machine secret only from protected private regular file",()=>{
 withSecret(file=>{
  const found=readPrivateMachineSecret({file});
  assert.ok(found.length>=48);
  assert.ok(!found.includes("\n"));
  assert.equal(readPrivateMachineSecret({file,legacySecret:"B".repeat(60)}),found);
  chmodSync(file,0o644);
  assert.throws(()=>readPrivateMachineSecret({file}));
  chmodSync(file,0o600);
  assert.equal(readPrivateMachineSecret({file}),found);
 });
});
test("missing configured file never silently falls back to environment",()=>{
 assert.throws(()=>readPrivateMachineSecret({file:"/tmp/non-existent-sentinel-machine-key",
   legacySecret:"B".repeat(60)}));
 assert.throws(()=>readPrivateMachineSecret({file:"relative-path",legacySecret:"B".repeat(60)}));
 assert.throws(()=>readPrivateMachineSecret({legacySecret:""}));
 assert.throws(()=>readPrivateMachineSecret({legacySecret:"test"}));
 assert.equal(readPrivateMachineSecret({legacySecret:"C".repeat(60)}),"C".repeat(60));
});
test("invalid content and overly readable files fail closed",()=>{
 withSecret(file=>{
  writeFileSync(file,"line-one\nline-two\n");
  assert.throws(()=>readPrivateMachineSecret({file}));
  writeFileSync(file,"E".repeat(1100));
  assert.throws(()=>readPrivateMachineSecret({file}));
  writeFileSync(file,"F".repeat(58)+"\n");
  assert.throws(()=>readPrivateMachineSecret({file}));
 });
});
