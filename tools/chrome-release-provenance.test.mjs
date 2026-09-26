import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// Exercise the actual pre-checkout shell boundary, with only GitHub's API
// replaced. No repository code or network is used by the provenance resolver.
const workflow = readFileSync(new URL('../.github/workflows/chrome-extension-release.yml', import.meta.url), 'utf8');
const block = workflow.split('      - name: Resolve the trusted release commit\n')[1]
  ?.split('      - name: Check out repository\n')[0];
assert.ok(block, 'release provenance must be resolved before checkout');
const script = block.split('        run: |\n')[1].split('\n').map(line => line.slice(10)).join('\n');
const releaseSha = 'a'.repeat(40);
const eventSha = 'b'.repeat(40);
const release = {
  workflow_id: 42,
  head_repository: { full_name: 'ashproto/Resume-Designer' },
  head_branch: 'main',
  event: 'push',
  conclusion: 'success',
  head_sha: releaseSha,
};

function resolve({ patch = {}, ancestry = 'ahead', eventName = 'workflow_run', runId = '123' } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'chrome-release-provenance-'));
  const output = join(directory, 'output');
  writeFileSync(output, '');
  writeFileSync(join(directory, 'gh'), `#!/usr/bin/env node
const path = process.argv[3];
if (process.env.EVENT_NAME !== 'workflow_run') process.exit(23);
if (path.endsWith('/actions/workflows/release.yml')) console.log('42');
else if (path.includes('/actions/runs/')) console.log(process.env.FIXTURE_RUN);
else if (path.includes('/compare/')) console.log(process.env.FIXTURE_ANCESTRY);
else process.exit(23);
`, { mode: 0o755 });
  try {
    let status = 0;
    try {
      execFileSync('bash', ['-c', script], {
        env: {
          ...process.env,
          PATH: `${directory}:${process.env.PATH}`,
          EVENT_NAME: eventName,
          EVENT_SHA: eventSha,
          REPOSITORY: 'ashproto/Resume-Designer',
          UPSTREAM_RUN_ID: runId,
          GITHUB_OUTPUT: output,
          FIXTURE_RUN: JSON.stringify({ ...release, ...patch }),
          FIXTURE_ANCESTRY: ancestry,
        },
        stdio: 'pipe',
      });
    } catch (error) {
      if (typeof error.status !== 'number') throw error;
      status = error.status;
    }
    return { status, output: readFileSync(output, 'utf8') };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

for (const [label, options] of [
  ['the current release commit', { ancestry: 'identical' }],
  ['the released commit after main advances, including a skip-build merge', {}],
  ['a manually dispatched desktop release', { patch: { event: 'workflow_dispatch' } }],
]) {
  test(`accepts ${label} and preserves its exact SHA`, () => {
    assert.deepEqual(resolve(options), { status: 0, output: `sha=${releaseSha}\n` });
  });
}

for (const [label, options] of [
  ['another workflow', { patch: { workflow_id: 41 } }],
  ['a fork', { patch: { head_repository: { full_name: 'evil/fork' } } }],
  ['another branch', { patch: { head_branch: 'next' } }],
  ['a pull request event', { patch: { event: 'pull_request' } }],
  ['an unsuccessful release', { patch: { conclusion: 'failure' } }],
  ['an unreachable commit', { ancestry: 'diverged' }],
  ['a commit ahead of main', { ancestry: 'behind' }],
  ['a mutable ref instead of a SHA', { patch: { head_sha: 'refs/heads/main' } }],
  ['an invalid run identifier', { runId: '../other-run' }],
]) {
  test(`rejects ${label} without exporting checkout input`, () => {
    const result = resolve(options);
    assert.notEqual(result.status, 0);
    assert.equal(result.output, '');
  });
}

test('manual extension dispatch uses its trusted event SHA without consulting the upstream payload', () => {
  assert.deepEqual(resolve({ eventName: 'workflow_dispatch', runId: 'ignored' }), {
    status: 0, output: `sha=${eventSha}\n`,
  });
});
