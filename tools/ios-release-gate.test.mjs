import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizeRelease, validateRun, candidateFromEvent } from './ios-release-gate.mjs';

const sha = 'a'.repeat(40);
const repository = 'ashproto/Resume-Designer';
const run = { id: 9, workflow_id: 3, path: '.github/workflows/ci.yml', event: 'push',
  status: 'completed', conclusion: 'success', head_branch: 'next', head_sha: sha,
  head_repository: { full_name: repository } };
const event = { repository: { full_name: repository }, workflow_run: run };
const jobs = ['checks', 'rust-check', 'ios-native'].map(name => ({ name, status: 'completed', conclusion: 'success' }));
const mergedPr = { number: 7, merged_at: '2026-09-22', merge_commit_sha: sha,
  base: { ref: 'next', repo: { full_name: repository } }, labels: [] };

test('only trusted successful push CI is eligible; PRs and lookalike workflows fail closed', () => {
  assert.deepEqual(validateRun(run, 3), { branch: 'next', sha, runId: 9 });
  for (const change of [
    { event: 'pull_request' }, { conclusion: 'failure' }, { status: 'in_progress' },
    { head_repository: { full_name: 'someone/Resume-Designer' } },
    { head_branch: 'feature' }, { path: '.github/workflows/other.yml' },
    { workflow_id: 4 }, { head_sha: 'refs/heads/main' },
  ]) assert.throws(() => validateRun({ ...run, ...change }, 3));
});

test('manual dispatch must run from main and target a named release branch', () => {
  const manual = { repository: event.repository, inputs: { target: 'next' } };
  assert.deepEqual(candidateFromEvent('workflow_dispatch', manual, 'refs/heads/main'), { branch: 'next' });
  assert.throws(() => candidateFromEvent('workflow_dispatch', manual, 'refs/heads/feature'));
  assert.throws(() => candidateFromEvent('workflow_dispatch', { ...manual, inputs: { target: 'refs/tags/next' } }, 'refs/heads/main'));
  assert.throws(() => candidateFromEvent('workflow_run', { ...event, repository: { full_name: 'fork/repo' } }, 'refs/heads/main'));
});

function fixture(overrides = {}) {
  const responses = {
    [`/repos/${repository}`]: { default_branch: 'main' },
    [`/repos/${repository}/actions/workflows/ci.yml`]: { id: 3, path: '.github/workflows/ci.yml' },
    [`/repos/${repository}/actions/runs/9`]: run,
    [`/repos/${repository}/branches/next`]: { protected: true, commit: { sha } },
    [`/repos/${repository}/compare/${sha}...${sha}`]: { status: 'identical' },
    [`/repos/${repository}/actions/runs/9/jobs?filter=latest&per_page=100&page=1`]: { jobs },
    [`/repos/${repository}/commits/${sha}`]: { commit: { message: 'feat: improve resume editing' } },
    [`/repos/${repository}/commits/${sha}/pulls?per_page=100&page=1`]: [mergedPr],
    ...overrides,
  };
  return async path => {
    assert.ok(Object.hasOwn(responses, path), `Unexpected request: ${path}`);
    return responses[path];
  };
}
const authorize = get => authorizeRelease({ eventName: 'workflow_run', event, ref: 'refs/heads/main', get, sleep: async () => {} });

test('trusted successful push with all native gates authorizes its exact SHA', async () => {
  assert.deepEqual(await authorize(fixture()), { branch: 'next', sha, runId: 9, skip: false });
});

test('unprotected branch, changed history, missing or skipped native checks refuse release', async () => {
  for (const overrides of [
    { [`/repos/${repository}/branches/next`]: { protected: false, commit: { sha } } },
    { [`/repos/${repository}/compare/${sha}...${sha}`]: { status: 'diverged' } },
    { [`/repos/${repository}/actions/runs/9/jobs?filter=latest&per_page=100&page=1`]: { jobs: jobs.slice(0, 2) } },
    { [`/repos/${repository}/actions/runs/9/jobs?filter=latest&per_page=100&page=1`]: { jobs: jobs.map(j => j.name === 'ios-native' ? { ...j, conclusion: 'skipped' } : j) } },
  ]) await assert.rejects(authorize(fixture(overrides)));
});

test('refreshes run identity rather than trusting the event payload', async () => {
  await assert.rejects(authorize(fixture({ [`/repos/${repository}/actions/runs/9`]: { ...run, event: 'pull_request' } })));
});

test('skip-build on the exact merged PR suppresses automatic release', async () => {
  const pr = { number: 7, merged_at: '2026-09-22', merge_commit_sha: sha,
    base: { ref: 'next', repo: { full_name: repository } }, labels: [{ name: 'skip-build' }] };
  const result = await authorize(fixture({
    [`/repos/${repository}/commits/${sha}`]: { commit: { message: 'Merge pull request #7 from ashproto/feature' } },
    [`/repos/${repository}/pulls/7`]: pr,
  }));
  assert.equal(result.skip, true);
});

test('PR number in commit text cannot suppress a different commit', async () => {
  await assert.rejects(authorize(fixture({
    [`/repos/${repository}/commits/${sha}`]: { commit: { message: 'Merge pull request #7 from ashproto/feature' } },
    [`/repos/${repository}/pulls/7`]: { merged_at: '2026-09-22', merge_commit_sha: 'b'.repeat(40),
      base: { ref: 'next', repo: { full_name: repository } }, labels: [{ name: 'skip-build' }] },
  })));
});

test('squash skip-build is resolved directly even while commit association lags', async () => {
  const result = await authorize(fixture({
    [`/repos/${repository}/commits/${sha}`]: { commit: { message: 'chore: update docs (#7)' } },
    [`/repos/${repository}/pulls/7`]: { ...mergedPr, labels: [{ name: 'skip-build' }] },
  }));
  assert.equal(result.skip, true);
});

test('rebase association lag cannot bypass skip-build, and missing metadata fails closed', async () => {
  const base = fixture();
  let attempts = 0;
  const route = `/repos/${repository}/commits/${sha}/pulls?per_page=100&page=1`;
  const result = await authorize(async path => {
    if (path === route) return ++attempts < 3 ? [] : [{ ...mergedPr, labels: [{ name: 'skip-build' }] }];
    return base(path);
  });
  assert.equal(result.skip, true);
  assert.equal(attempts, 3);
  await assert.rejects(authorize(fixture({ [route]: [] })), /metadata is unavailable/);
});

test('manual pilot resolves current protected branch and requires matching successful push CI', async () => {
  const get = fixture({
    [`/repos/${repository}/actions/workflows/ci.yml/runs?branch=next&event=push&head_sha=${sha}&status=success&per_page=100&page=1`]: { workflow_runs: [run] },
  });
  assert.deepEqual(await authorizeRelease({ eventName: 'workflow_dispatch',
    event: { repository: event.repository, inputs: { target: 'next' } }, ref: 'refs/heads/main', get }),
  { branch: 'next', sha, runId: 9, skip: false });
  await assert.rejects(authorizeRelease({ eventName: 'workflow_dispatch',
    event: { repository: event.repository, inputs: { target: 'next' } }, ref: 'refs/heads/main',
    get: fixture({ [`/repos/${repository}/actions/workflows/ci.yml/runs?branch=next&event=push&head_sha=${sha}&status=success&per_page=100&page=1`]: { workflow_runs: [] } }),
  }), /successful push CI/);
});
