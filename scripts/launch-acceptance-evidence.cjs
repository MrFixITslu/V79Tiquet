#!/usr/bin/env node
"use strict";
// V79 source-only evidence coverage contract. No network, subprocess, or production access.
// All PASS evidence is operator-reported and MUST be independently reviewed.
const fs = require("node:fs");

const IDS = Object.freeze(Array.from({length: 15}, (_, i) => "A" + String(i + 1).padStart(2, "0")));
const ID_SET = new Set(IDS);
const HEX40 = /^[0-9a-f]{40}$/;
const IMAGE = /^sha256:[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const STATUSES = new Set(["not_run", "blocked", "failed", "reported_pass"]);
const MODES = new Set(["isolated_synthetic", "owner_browser", "provider_sandbox"]);
const ROOT_FIELDS = ["schema_version", "scope", "candidate", "cases"];
const CANDIDATE_FIELDS = ["hub_commit", "tiquet_commit", "hub_image_id", "tiquet_image_id"];
const CASE_FIELDS = ["case_id", "status", "mode", "evidence_sha256"];

function error(code) { throw new Error(code); }
function hasExactFields(value, fields) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).sort().join("|") === [...fields].sort().join("|");
}

function template() {
  return {
    schema_version: 1,
    scope: "isolated_synthetic_acceptance",
    candidate: {
      hub_commit: null, tiquet_commit: null,
      hub_image_id: null, tiquet_image_id: null
    },
    cases: IDS.map(case_id => ({
      case_id, status: "not_run", mode: "isolated_synthetic",
      evidence_sha256: null
    }))
  };
}

function validate(input) {
  if (!hasExactFields(input, ROOT_FIELDS) || input.schema_version !== 1 ||
      input.scope !== "isolated_synthetic_acceptance") error("INVALID_MANIFEST_ENVELOPE");
  const c = input.candidate;
  if (!hasExactFields(c, CANDIDATE_FIELDS)) error("INVALID_CANDIDATE");
  const missing_identity = [];
  for (const field of CANDIDATE_FIELDS) {
    if (c[field] === null) {
      missing_identity.push(field);
    } else if (typeof c[field] !== "string" ||
               !(field.endsWith("_commit") ? HEX40 : IMAGE).test(c[field])) {
      error("INVALID_CANDIDATE_IDENTITY");
    }
  }
  if (!Array.isArray(input.cases) || input.cases.length !== IDS.length) error("WRONG_CASE_COUNT");
  const seen = new Set();
  const counts = {not_run: 0, blocked: 0, failed: 0, reported_pass: 0};
  const outstanding_cases = [];
  for (const entry of input.cases) {
    if (!hasExactFields(entry, CASE_FIELDS) || !ID_SET.has(entry.case_id) ||
        seen.has(entry.case_id)) error("INVALID_OR_DUPLICATE_CASE");
    seen.add(entry.case_id);
    if (!STATUSES.has(entry.status) || !MODES.has(entry.mode)) error("INVALID_STATUS_OR_MODE");
    // Payment provider positive test is NEVER represented by a synthetic local assertion.
    if (entry.case_id === "A12" && entry.status === "reported_pass" &&
        entry.mode !== "provider_sandbox") error("PROVIDER_EVIDENCE_MODE_REQUIRED");
    if (entry.status === "reported_pass") {
      if (typeof entry.evidence_sha256 !== "string" ||
          !HEX64.test(entry.evidence_sha256)) error("MISSING_EVIDENCE_HASH");
    } else if (entry.evidence_sha256 !== null) {
      error("STALE_EVIDENCE_FOR_UNRUN_CASE");
    }
    counts[entry.status]++;
    if (entry.status !== "reported_pass") outstanding_cases.push(entry.case_id);
  }
  // This checker validates self-reported evidence structure only: NEVER a release gate.
  return {
    contract: "V79_LAUNCH_EVIDENCE_V1",
    scope: "isolated_synthetic_acceptance",
    checks_performed: ["schema", "case_coverage", "reported_evidence_hash_shape", "candidate_id_shape"],
    assertions_are: "OPERATOR_REPORTED_NOT_INDEPENDENTLY_VERIFIED",
    counts,
    identity_fields_missing: missing_identity,
    cases_outstanding: outstanding_cases.sort(),
    evidence_coverage: counts.reported_pass === IDS.length &&
      missing_identity.length === 0 ? "REPORTED_COMPLETE_UNVERIFIED" : "INCOMPLETE",
    production_decision: "NO-GO",
    independent_security_review: "NOT_ASSESSED",
    actual_browser_mfa_sso_payment_and_restore: "NOT_ASSESSED_BY_THIS_CHECKER",
    must_not_automate_deploy: true
  };
}

function readManifest(path) {
  if (typeof path !== "string" || !path || path.startsWith("-")) error("MISSING_MANIFEST_PATH");
  const stat = fs.lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) error("UNSAFE_MANIFEST_FILE");
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--template") {
      process.stdout.write(JSON.stringify(template(), null, 2) + "\n");
    } else if (args.length === 2 && args[0] === "--check") {
      const result = validate(readManifest(args[1]));
      process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    } else {
      error("USAGE: --template OR --check <local-manifest.json>");
    }
  } catch (e) {
    // Do not echo raw untrusted file contents or exception stack.
    const allowed = new Set([
      "INVALID_MANIFEST_ENVELOPE", "INVALID_CANDIDATE",
      "INVALID_CANDIDATE_IDENTITY", "WRONG_CASE_COUNT",
      "INVALID_OR_DUPLICATE_CASE", "INVALID_STATUS_OR_MODE",
      "PROVIDER_EVIDENCE_MODE_REQUIRED", "MISSING_EVIDENCE_HASH",
      "STALE_EVIDENCE_FOR_UNRUN_CASE", "MISSING_MANIFEST_PATH",
      "UNSAFE_MANIFEST_FILE", "USAGE: --template OR --check <local-manifest.json>"
    ]);
    const message = allowed.has(e.message) ? e.message : "UNREADABLE_OR_INVALID_MANIFEST";
    process.stderr.write("REJECTED: " + message + "\n");
    process.exitCode = 2;
  }
}

module.exports = { IDS, template, validate };
