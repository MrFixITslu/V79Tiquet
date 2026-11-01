import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {resolveOwnedJobFile} from "../server/jobFileBoundary.js";

const root="/srv/v79/uploads/tenant-a/Job-abc";
test("one ordinary job file resolves inside its exact job folder",()=>{
  assert.equal(resolveOwnedJobFile(root,"customer-receipt.pdf"),
    path.join(root,"customer-receipt.pdf"));
  assert.equal(resolveOwnedJobFile(root,"project-log.json"),
    path.join(root,"project-log.json"));
  assert.equal(resolveOwnedJobFile(root,"file with spaces.txt"),
    path.join(root,"file with spaces.txt"));
});
test("rejects traversal to near-prefix sibling job and different tenant",()=>{
  for(const bad of [
    "../Job-abc-other/receipt.pdf",
    "../Job-abcd/receipt.pdf",
    "../../tenant-b/Job-abc/receipt.pdf",
    "subdirectory/another.pdf",
    "..\\Job-abc-other\\receipt.pdf",
    "subdirectory\\another.pdf",
    "/tmp/other-customer.pdf",
    ".", "..", "", "\0file.pdf",
  ]){
    assert.equal(resolveOwnedJobFile(root,bad),null,"refused "+JSON.stringify(bad));
  }
});
test("rejects invalid dynamic filename types and oversized names",()=>{
  for(const bad of [null,undefined,{},[],12,"x".repeat(256)]){
    assert.equal(resolveOwnedJobFile(root,bad),null);
  }
  assert.equal(resolveOwnedJobFile("relative/uploads","safe.txt"),null);
});
test("file deletion route uses exact boundary check, not string prefix",()=>{
  const source=readFileSync(new URL("../server/index.js",import.meta.url),"utf8");
  const start=source.indexOf('app.delete("/api/jobs/:id/files/:filename"');
  assert.notEqual(start,-1);
  const end=source.indexOf("// --- CLIENT PORTAL PUBLIC SECURE ROUTES",start);
  const code=source.slice(start,end);
  assert.match(code,/resolveOwnedJobFile\(folder, filename\)/);
  assert.match(code,/fs\.lstatSync\(filePath\)\.isFile\(\)/);
  assert.doesNotMatch(code,/filePath\.startsWith\(folder\)/);
});
