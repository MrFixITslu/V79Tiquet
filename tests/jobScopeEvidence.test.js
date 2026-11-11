import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import {
  validScopeUploadName, validateScopeAgreement, storedScopePath,
  snapshotExistingJobScope, readScopeBuffer
} from "../server/jobScopeEvidence.js";
import { resolveOwnedJobFile, resolveJobFolder } from "../server/jobFileBoundary.js";
import { makeHubEventProjection } from "../server/platformEventProjection.js";

const versionId="10000000-2000-4000-8000-000000000001";
const shaPattern=/^[a-f0-9]{64}$/;
const index=readFileSync(new URL("../server/index.js",import.meta.url),"utf8");
const schema=readFileSync(new URL("../server/schema.sql",import.meta.url),"utf8");

test("filename and owning folder boundaries reject traversal and unsafe segments",()=>{
  for(const f of ["../scope.pdf","..\\scope.pdf","/etc/passwd",
    ".", "..", "a.pdf/../b.pdf", "name.pdf.html", "a..pdf", "x.pdf\0"])
    assert.equal(validScopeUploadName(f),false,f);
  assert.equal(validScopeUploadName("1731444555000-client-scope.pdf"),true);
  const folder=resolveJobFolder("/tmp/test-owned","tenant-1","Client Ltd","job-1");
  assert.equal(resolveOwnedJobFile(folder,"../outside.pdf"),null);
  assert.equal(resolveOwnedJobFile(folder,"file.pdf"),path.join(folder,"file.pdf"));
  assert.throws(()=>resolveJobFolder("/tmp/test-owned","..","Client","job"));
});

test("scope acknowledgement requires exact version, SHA-256 and explicit agree",()=>{
 const digest="a".repeat(64);
 assert.equal(validateScopeAgreement({agree:true,version:1,sha256:digest}),true);
 for(const v of [
  {agree:false,version:1,sha256:digest},
  {agree:true,version:"1",sha256:digest},
  {agree:true,version:0,sha256:digest},
  {agree:true,version:1,sha256:"wrong"},
 ])assert.equal(validateScopeAgreement(v),false);
});

test("scope is immutable despite changes to original uploaded file",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"v79-scope-"));
 try{
  const source=path.join(root,"uploaded");
  const archive=path.join(root,"evidence","tenant-a","job-b");
  await fs.mkdir(source);
  const filename="1731444555000-scope.pdf";
  await fs.writeFile(path.join(source,filename),Buffer.from("%PDF-1.4\nOriginal agreed scope\n%%EOF\n"));
  const snap=await snapshotExistingJobScope(source,filename,archive,versionId);
  assert.match(snap.sha256,shaPattern);
  const before=await readScopeBuffer(archive,versionId,snap.sha256);
  await fs.writeFile(path.join(source,filename),Buffer.from("%PDF-1.4\nRevised draft\n%%EOF\n"));
  const after=await readScopeBuffer(archive,versionId,snap.sha256);
  assert.deepEqual(before,after);
  await assert.rejects(snapshotExistingJobScope(source,filename,archive,versionId));
  const stored=storedScopePath(archive,versionId);
  await fs.writeFile(stored,"tampered", {flag:"w"});
  await assert.rejects(readScopeBuffer(archive,versionId,snap.sha256),/integrity mismatch/);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test("no symbolic-link uploads or scope archives may be followed",async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),"v79-scope-link-"));
 try{
  const source=path.join(root,"uploaded"),archive=path.join(root,"archive");
  await fs.mkdir(source);
  await fs.writeFile(path.join(root,"secret.pdf"),"%PDF-1.4\nsecret");
  await fs.symlink(path.join(root,"secret.pdf"),path.join(source,"bad.pdf"));
  await assert.rejects(snapshotExistingJobScope(source,"bad.pdf",archive,versionId));
  assert.equal(resolveOwnedJobFile(source,"../../secret.pdf"),null);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});

test("scope API is gated and document archive stored under immutable tenant/job identity",()=>{
 for(const marker of [
  "V79_ECOSYSTEM_V2_SCOPE_ENABLED",
  'app.post("/api/jobs/:id/scope"',
  'app.get("/api/jobs/:id/scope"',
  'app.get("/api/portal/:token/scope-document"',
  'app.post("/api/portal/:token/accept-scope"',
  'scopeArchiveRoot = (accountId,jobId)',
  "v79_job_scope_versions_v2",
  "v79_job_scope_acceptances_v2",
  "readScopeBuffer(",
  "portal_token_fingerprint",
  "FOR UPDATE",
 ])assert.ok(index.includes(marker),"Missing scope safety requirement: "+marker);
 assert.match(schema,/UNIQUE \(account_id,job_id,version\)/);
 assert.match(schema,/UNIQUE \(account_id,job_id,version_id\)/);
 assert.match(index,/!latest\.accepted\)return \{status:409\}/);
 assert.match(index,/locked\.deliveryAcceptedAt/);
 assert.match(index,/open a change request/);
});

test("scope receipt to Hub cannot contain arbitrary filenames or customer details",()=>{
 const row={
  id:versionId,event_type:"job.scope_acknowledged",
  subject_id:"job-1000",
  hub_organization_id:"organization-customer",
  account_id:"tenant-customer",
  occurred_at:"2026-11-11T12:00:00Z",
 };
 const result=makeHubEventProjection(row,{
  version:"2",filename:"Jane-Doe-contract.pdf",email:"jane@example.com"
 });
 assert.equal(result.ok,true);
 assert.deepEqual(result.event.payload,{version:"2"});
 assert.equal(makeHubEventProjection(row,{version:"not-an-integer"}).ok,false);
});
