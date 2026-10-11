import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/v79-ci-cd.yml", "utf8");
const condition = "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'";

test("ordinary main pushes cannot publish artifacts or deploy", () => {
  assert.match(workflow, /push:\\n\\s*branches: \\[main\\]/);
  assert.doesNotMatch(workflow, /github.event_name == 'push' && github.ref == 'refs\\/heads\\/main'/);
  for (const job of ["deliver-container", "deploy", "release-approval"]) {
    const start = workflow.indexOf("  " + job + ":\\n".replace("\\n","\n"));
    assert.notEqual(start, -1, job + " missing");
    const next = workflow.indexOf("\n  ", start + 3);
    const block = workflow.slice(start, next < 0 ? undefined : next);
    assert.ok(block.includes(condition), job + " must be explicitly dispatched from main");
  }
});

test("both release paths require an approved exact immutable SHA", () => {
  assert.match(workflow, /approved_sha:\\n\\s*description:/);
  assert.match(workflow, /V79_TIQUET_APPROVED_SHA/);
  assert.match(workflow, /REQUESTED_SHA.*GITHUB_SHA/);
  assert.match(workflow, /APPROVED_SHA.*GITHUB_SHA/);
  assert.match(workflow, /needs: \\[validate, release-approval\\]/);
  assert.match(workflow, /needs: \\[validate, release-approval, deliver-container\\]/);
  assert.match(workflow, /cancel-in-progress: false/);
});
