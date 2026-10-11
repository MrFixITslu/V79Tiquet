import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/v79-ci-cd.yml", "utf8");
const manualMain = "github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main'";

function jobBody(name) {
  const marker = "\n  " + name + ":\n";
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, name + " job is required");
  const next = ["release-approval", "deliver-container", "deploy"]
    .filter(x => x !== name)
    .map(x => workflow.indexOf("\n  " + x + ":\n", start + marker.length))
    .filter(x => x >= 0);
  return workflow.slice(start, next.length ? Math.min(...next) : undefined);
}

test("normal main pushes run validation but cannot publish or deploy", () => {
  assert.ok(workflow.includes("push:\n    branches: [main]"));
  assert.ok(!workflow.includes("if: ${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}"));
  assert.ok(workflow.includes("      - name: Create delivery bundle\n        if: ${{ " + manualMain + " }}"));
  assert.ok(workflow.includes("      - name: Upload delivery bundle\n        if: ${{ " + manualMain + " }}"));
  for (const job of ["release-approval", "deliver-container", "deploy"]) {
    assert.ok(jobBody(job).includes("if: ${{ " + manualMain + " }}"), job + " must require manual main-branch dispatch");
  }
});

test("delivery and deployment require separately approved immutable SHA", () => {
  assert.ok(workflow.includes("approved_sha:\n        description:"));
  assert.ok(jobBody("release-approval").includes("V79_TIQUET_APPROVED_SHA"));
  assert.ok(jobBody("release-approval").includes('[[ "$REQUESTED_SHA" == "$GITHUB_SHA" ]]'));
  assert.ok(jobBody("release-approval").includes('[[ -n "$APPROVED_SHA" && "$APPROVED_SHA" == "$GITHUB_SHA" ]]'));
  assert.ok(jobBody("deliver-container").includes("needs: [validate, release-approval]"));
  assert.ok(jobBody("deploy").includes("needs: [validate, release-approval, deliver-container]"));
  assert.ok(workflow.includes("cancel-in-progress: false"));
});
