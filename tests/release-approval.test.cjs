const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const workflow = readFileSync(join(__dirname, '../.github/workflows/v79-ci-cd.yml'), 'utf8');
const sha = 'a'.repeat(40);
const other = 'b'.repeat(40);

function job(name) {
  const match = workflow.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z-]*:|$(?![\\s\\S]))`, 'm'));
  assert.ok(match, `Missing job ${name}`);
  return match[1];
}

test('pushes and PRs cannot enter delivery or production jobs', () => {
  const condition = "${{ github.event_name == 'workflow_dispatch' && github.ref == 'refs/heads/main' }}";
  assert.match(workflow, /workflow_dispatch:\n    inputs:\n      approved_sha:/);
  for (const name of ['release-approval', 'deliver-container', 'deploy']) {
    assert.ok(job(name).includes(`    if: ${condition}`), name);
  }
  assert.match(job('deliver-container'), /needs: \[validate, release-approval\]/);
  assert.match(job('release-approval'), /^    needs: validate$/m);
  assert.match(job('deploy'), /needs: \[validate, release-approval, deliver-container\]/);
  assert.match(job('deploy'), /environment: production/);
  const bundleSteps = job('validate').slice(job('validate').indexOf('      - name: Create delivery bundle'));
  assert.equal(bundleSteps.split(`        if: ${condition}`).length - 1, 2);
  assert.doesNotMatch(workflow, /github\.event_name == 'push'/);
  assert.doesNotMatch(workflow, /cancel-in-progress: true/);
});

for (const name of ['release-approval', 'deploy']) {
  const block = job(name);
  const step = name === 'deploy' ? 'Require approved immutable release' : 'Fail closed without approved main SHA';
  const approval = block.slice(block.indexOf(`      - name: ${step}`));
  assert.match(approval, /REQUESTED_SHA: \$\{\{ inputs\.approved_sha \}\}/);
  assert.match(approval, /APPROVED_SHA: \$\{\{ vars\.V79_TIQUET_APPROVED_SHA \}\}/);
  const match = approval.match(/        run: \|\n((?:          .*\n|\n)+)/);
  assert.ok(match, `Missing executable approval gate in ${name}`);
  const script = match[1].replace(/^          /gm, '');
  for (const [scenario, ref, build, requested, approved, expected] of [
    ['exact approval', 'refs/heads/main', sha, sha, sha, 0],
    ['missing owner approval', 'refs/heads/main', sha, sha, '', 1],
    ['stale owner approval', 'refs/heads/main', sha, sha, other, 1],
    ['missing request', 'refs/heads/main', sha, '', sha, 1],
    ['different request', 'refs/heads/main', sha, other, sha, 1],
    ['branch dispatch', 'refs/heads/draft', sha, sha, sha, 1],
    ['short SHA', 'refs/heads/main', 'aaaaaaa', 'aaaaaaa', 'aaaaaaa', 1],
    ['uppercase SHA', 'refs/heads/main', 'A'.repeat(40), 'A'.repeat(40), 'A'.repeat(40), 1],
  ]) {
    test(`${name}: ${scenario}`, () => {
      const result = spawnSync('bash', ['-s'], {
        input: script, encoding: 'utf8', timeout: 5_000,
        env: { ...process.env, GITHUB_REF: ref, GITHUB_SHA: build,
          REQUESTED_SHA: requested, APPROVED_SHA: approved },
      });
      assert.ifError(result.error);
      assert.equal(result.status, expected, result.stdout + result.stderr);
    });
  }
}
