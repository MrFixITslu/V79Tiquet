"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { IDS, template, validate } = require("../scripts/launch-acceptance-evidence.cjs");
const script = join(__dirname, "../scripts/launch-acceptance-evidence.cjs");
const commit = "a".repeat(40), image = "sha256:" + "b".repeat(64);
function filled() {
  const t = template();
  t.candidate = {
    hub_commit: commit, tiquet_commit: commit,
    hub_image_id: image, tiquet_image_id: image
  };
  for (const entry of t.cases) {
    entry.status = "reported_pass";
    entry.evidence_sha256 = "c".repeat(64);
    if (entry.case_id === "A12") entry.mode = "provider_sandbox";
  }
  return t;
}
test("complete fixture schema includes all A01-A15, no prefilled proof", () => {
  const t = template();
  assert.deepEqual(t.cases.map(x => x.case_id), IDS);
  assert.equal(t.cases.every(x => x.status === "not_run" && x.evidence_sha256 === null), true);
  assert.equal(validate(t).production_decision, "NO-GO");
  assert.equal(validate(t).cases_outstanding.length, 15);
});
test("even complete self-reported evidence NEVER grants deployment", () => {
  const report = validate(filled());
  assert.equal(report.counts.reported_pass, 15);
  assert.deepEqual(report.cases_outstanding, []);
  assert.equal(report.evidence_coverage, "REPORTED_COMPLETE_UNVERIFIED");
  assert.equal(report.production_decision, "NO-GO");
  assert.equal(report.independent_security_review, "NOT_ASSESSED");
  assert.equal(report.must_not_automate_deploy, true);
});
test("rejects duplicate and unknown cases, missing cases and malformed hashes", () => {
  for (const mutate of [
    t => t.cases[1].case_id = "A01",
    t => t.cases[1].case_id = "A16",
    t => t.cases.pop(),
    t => t.cases[0].evidence_sha256 = "bad",
    t => t.cases[0].status = "approved",
    t => t.cases[0].mode = "production",
    t => t.cases[0].password = "must-not-be-accepted",
    t => t.cookie = "must-not-be-accepted"
  ]) {
    const t = filled(); mutate(t);
    assert.throws(() => validate(t));
  }
});
test("rejects provider positive test misrepresented as offline synthetic", () => {
  const t = filled();
  t.cases.find(c => c.case_id === "A12").mode = "isolated_synthetic";
  assert.throws(() => validate(t), /PROVIDER_EVIDENCE_MODE_REQUIRED/);
});
test("does not allow stale evidence on a blocked/failed/not-run case", () => {
  for (const status of ["blocked", "failed", "not_run"]) {
    const t = filled();
    t.cases[0].status = status;
    assert.throws(() => validate(t), /STALE_EVIDENCE_FOR_UNRUN_CASE/);
    t.cases[0].evidence_sha256 = null;
    const r = validate(t);
    assert.equal(r.counts[status], 1);
    assert.ok(r.cases_outstanding.includes("A01"));
  }
});
test("missing image/source IDs remain explicitly incomplete", () => {
  const t = filled();
  t.candidate.hub_image_id = null;
  const r = validate(t);
  assert.equal(r.evidence_coverage, "INCOMPLETE");
  assert.deepEqual(r.identity_fields_missing, ["hub_image_id"]);
  assert.equal(r.production_decision, "NO-GO");
});
test("CLI template and check never request credentials or network access", () => {
  const t = spawnSync(process.execPath, [script, "--template"], {encoding:"utf8",timeout:5000});
  assert.equal(t.status, 0, t.stderr);
  assert.deepEqual(JSON.parse(t.stdout).cases.map(x=>x.case_id), IDS);
  const dir = mkdtempSync(join(tmpdir(),"v79-evidence-"));
  try {
    const path = join(dir,"case.json");
    writeFileSync(path,JSON.stringify(filled()),{mode:0o600});
    const result = spawnSync(process.execPath,[script,"--check",path],{encoding:"utf8",timeout:5000});
    assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(result.stdout).production_decision,"NO-GO");
    assert.doesNotMatch(result.stdout,/token|password|private_key|cookie/i);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
test("CLI rejects unknown inputs without dumping their contents", () => {
  const dir = mkdtempSync(join(tmpdir(),"v79-evidence-"));
  try {
    const path = join(dir,"case.json");
    writeFileSync(path,JSON.stringify({secrets:"not-to-be-echoed"}),{mode:0o600});
    const r = spawnSync(process.execPath,[script,"--check",path],{encoding:"utf8",timeout:5000});
    assert.equal(r.status,2);
    assert.match(r.stderr,/REJECTED/);
    assert.doesNotMatch(r.stderr,/not-to-be-echoed/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
