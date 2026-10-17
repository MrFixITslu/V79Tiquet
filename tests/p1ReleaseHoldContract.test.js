import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workflow = readFileSync(
  new URL("../.github/workflows/v79-ci-cd.yml", import.meta.url), "utf8"
);

// Fails closed if the existing PR/main workflow loses any of its deliberate
// "false" guards. This is a source snapshot guard, NOT an audit of all possible
// independent deployment pathways, nor permission to merge.
test("P1 release hold prevents bundle creation, artifact upload, image push and SSH deploy", () => {
  const guarded = [
    {
      name:"delivery bundle creation",
      regex:/^      - name: Create delivery bundle\r?\n        if: \$\{\{ false \}\}/m,
    },
    {
      name:"delivery bundle upload",
      regex:/^      - name: Upload delivery bundle\r?\n        if: \$\{\{ false \}\}/m,
    },
    {
      name:"container image publication",
      regex:/^  deliver-container:\r?\n    name: Publish Docker image\r?\n(?:    [^\n]*\r?\n)*?    if: \$\{\{ false \}\}/m,
    },
    {
      name:"production deployment",
      regex:/^  deploy:\r?\n    name: Deploy validated release to server\r?\n(?:    [^\n]*\r?\n)*?    if: \$\{\{ false \}\}/m,
    },
  ];
  for(const check of guarded) {
    assert.match(workflow,check.regex,check.name+" must remain hard-disabled");
  }
  assert.match(workflow,/^  pull_request:\r?\n    branches: \[main\]/m);
  assert.match(workflow,/^  push:\r?\n    branches: \[main\]/m);
});
