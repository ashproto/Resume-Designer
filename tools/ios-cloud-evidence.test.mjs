import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { verifyReservationLog, attachReservationEvidence, coordinatedReleaseOptions } from './ios-cloud-evidence.mjs';

const repository = 'ashproto/Resume-Designer';
const sha = 'a'.repeat(40);
const tag = `ios-testflight/next/${sha}`;
const expected = { repository, sha, tag, state: 'not-started', runId: '42', runUrl: `https://github.com/${repository}/actions/runs/42` };
const marker = state => `2026-11-06T01:00:00Z OP_IOS_RESERVATION_STATE=${JSON.stringify({ version: 1, repository, sha, tag, state })}`;

test('production requires coordinated preview configuration once previews are active', () => {
  assert.deepEqual(coordinatedReleaseOptions({env:{},gh:{},asc:{},input:{}}), {});
  assert.throws(() => coordinatedReleaseOptions({env:{IOS_PR_TESTFLIGHT_MODE:'enabled'},gh:{},asc:{},input:{}}), /workflow/i);
  assert.throws(() => coordinatedReleaseOptions({env:{XCODE_CLOUD_PR_WORKFLOW_ID:'same',XCODE_CLOUD_WORKFLOW_ID:'same'},gh:{},asc:{},input:{}}), /distinct/i);
});

test('only the final matching authentic log marker can prove a no-start outcome', () => {
  assert.equal(verifyReservationLog(marker('not-started'), expected), true);
  assert.equal(verifyReservationLog(`${marker('not-started')}\n${marker('post-attempted')}`, expected), false);
  assert.equal(verifyReservationLog(`${marker('reserved')}\n${marker('not-started')}`, expected), true);
  for (const text of ['', 'OP_IOS_RESERVATION_STATE=bad', marker('rejected'), marker('not-started').replace(sha, 'b'.repeat(40))]) {
    assert.equal(verifyReservationLog(text, expected), false);
  }
});

test('evidence comes from completed trusted release job logs, with isolated CLI credentials', async () => {
  const gh = { request: async () => ({ jobs: [{ id: 9, name: 'Release iOS TestFlight', status: 'completed', run_url: `https://api.github.com/repos/${repository}/actions/runs/42` }] }) };
  let called = 0;
  attachReservationEvidence(gh, { token: 'github-token', exec: (command, args, options) => {
    called++;
    assert.equal(command, 'gh');
    assert.deepEqual(args, ['api', '--allow-escape-sequences', `repos/${repository}/actions/jobs/9/logs`]);
    assert.equal(options.env.GH_TOKEN, 'github-token');
    assert.equal(options.env.APP_STORE_CONNECT_PRIVATE_KEY, undefined);
    assert.equal(options.env.GITHUB_TOKEN, undefined);
    assert.equal(options.env.XDG_STATE_HOME, options.env.GH_CONFIG_DIR);
    assert.equal(options.env.XDG_CACHE_HOME, options.env.GH_CONFIG_DIR);
    assert.deepEqual(readdirSync(options.env.GH_CONFIG_DIR), []);
    return marker('not-started');
  } });
  assert.equal(typeof gh.verifyLegacyReservationEvidence, 'function');
  assert.equal(typeof gh.verifyLegacyDeliveredEvidence, 'function');
  assert.equal(await gh.verifyLegacyReservationEvidence({ repository, tag, sha }), false);
  assert.equal(await gh.verifyReservationEvidence(expected), true);
  assert.equal(called, 1);
});

test('wrong job origins, active jobs, unsafe identities and missing logs cannot clear reservations', async () => {
  for (const job of [
    { id: 9, name: 'Candidate archive', status: 'completed' },
    { id: 9, name: 'Release iOS TestFlight', status: 'in_progress' },
    { id: 9, name: 'Release iOS TestFlight', status: 'completed', run_url: 'https://evil.test/run' },
  ]) {
    const gh = { request: async () => ({ jobs: [job] }) };
    attachReservationEvidence(gh, { token: 'token', exec: () => { throw new Error('must not fetch'); } });
    assert.equal(await gh.verifyReservationEvidence(expected), false);
  }
  const gh = { request: async () => { throw new Error('missing'); } };
  attachReservationEvidence(gh, { token: 'token' });
  assert.equal(await gh.verifyReservationEvidence(expected), false);
  assert.equal(await gh.verifyReservationEvidence({ ...expected, runId: '42;bad' }), false);
});

const delivered = { ...expected, state: 'delivered' };
function deliveryEvidenceFixture() {
  const data = { run: { id: 42, html_url: expected.runUrl, status: 'completed', conclusion: 'failure', run_attempt: 1,
    head_sha: 'b'.repeat(40), head_branch: 'main', event: 'workflow_dispatch', workflow_id: 7,
    path: '.github/workflows/ios-testflight.yml', repository: { id: 1163653093, full_name: repository },
    head_repository: { id: 1163653093, full_name: repository } },
    jobs: [{ id: 9, name: 'Release iOS TestFlight', status: 'completed', conclusion: 'success', run_attempt: 1,
      run_id: 42, head_sha: 'b'.repeat(40),
      run_url: `https://api.github.com/repos/${repository}/actions/runs/42` }], logs: new Map([[9, marker('delivered')]]) };
  const gh = { request: async path => {
    if (path === `/repos/${repository}/actions/runs/42`) return structuredClone(data.run);
    if (path.includes('/actions/runs/42/jobs?')) return { jobs: structuredClone(data.jobs) };
    throw new Error(`Unexpected evidence request ${path}`);
  } };
  attachReservationEvidence(gh, { token: 'test-token', exec: (_command, args) => {
    const id = Number(args.at(-1).match(/jobs\/(\d+)\/logs$/)[1]);
    if (!data.logs.has(id)) throw new Error('Logs unavailable');
    const result = data.logs.get(id);
    data.afterLog?.();
    return result;
  } });
  return { data, gh };
}

test('the exact final structured marker can prove delivered but cannot hide a later mismatched source', () => {
  assert.equal(verifyReservationLog(marker('delivered'), delivered), true);
  for (const later of [marker('reserved'), marker('not-started'), marker('post-attempted'), marker('delivered').replace(sha, 'b'.repeat(40))]) {
    assert.equal(verifyReservationLog(`${marker('delivered')}\n${later}`, delivered), false);
  }
});

test('successful delivery job evidence survives unrelated overall feedback failure', async () => {
  const f = deliveryEvidenceFixture();
  assert.equal(await f.gh.verifyReservationEvidence(delivered), true);
});

test('delivered evidence cannot ignore newer failed active or conflicting delivery attempts', async () => {
  for (const outcome of ['failed', 'active', 'pending-marker', 'wrong-sha', 'no-marker', 'missing-logs']) {
    const f = deliveryEvidenceFixture();
    f.data.run.run_attempt = 2;
    f.data.jobs.push({ ...f.data.jobs[0], id: 10, run_attempt: 2,
      status: outcome === 'active' ? 'in_progress' : 'completed', conclusion: outcome === 'failed' ? 'failure' : 'success' });
    if (outcome !== 'missing-logs') f.data.logs.set(10, outcome === 'pending-marker' ? marker('post-attempted')
      : outcome === 'wrong-sha' ? marker('delivered').replace(sha, 'b'.repeat(40)) : outcome === 'no-marker' ? 'no delivery marker' : marker('delivered'));
    assert.equal(await f.gh.verifyReservationEvidence(delivered), false, outcome);
  }
});

test('a rerun or provenance change during delivered log retrieval fails closed', async () => {
  for (const mutate of [
    data => { data.run.status = 'in_progress'; data.run.run_attempt = 2; },
    data => { data.jobs.push({ ...data.jobs[0], id: 10, status: 'in_progress', conclusion: null, run_attempt: 2 }); },
    data => { data.run.head_sha = 'c'.repeat(40); },
  ]) {
    const f = deliveryEvidenceFixture(); f.data.afterLog = () => mutate(f.data);
    assert.equal(await f.gh.verifyReservationEvidence(delivered), false);
  }
});

test('delivered evidence requires complete exact controller and delivery job provenance', async () => {
  for (const mutate of [
    data => { delete data.run.run_attempt; }, data => { data.run.run_attempt = 0; },
    data => { delete data.jobs[0].run_id; }, data => { data.jobs[0].run_id = 43; },
    data => { delete data.jobs[0].head_sha; }, data => { data.jobs[0].head_sha = 'c'.repeat(40); },
    data => { delete data.jobs[0].run_attempt; }, data => { data.jobs[0].run_attempt = 0; },
    data => { data.jobs[0].run_attempt = 2; },
  ]) {
    const f = deliveryEvidenceFixture(); mutate(f.data);
    assert.equal(await f.gh.verifyReservationEvidence(delivered), false);
  }
});

test('only a successful current attempt can prove delivery after an earlier failed attempt', async () => {
  const f = deliveryEvidenceFixture(); f.data.run.run_attempt = 2;
  f.data.jobs[0].conclusion = 'failure'; f.data.logs.set(9, marker('post-attempted'));
  f.data.jobs.push({ ...f.data.jobs[0], id: 10, run_attempt: 2, conclusion: 'success' });
  f.data.logs.set(10, marker('delivered'));
  assert.equal(await f.gh.verifyReservationEvidence(delivered), true);
  for (const present of [false, true]) {
    const missing = deliveryEvidenceFixture(); missing.data.run.run_attempt = 2;
    if (present) missing.data.jobs.push({ ...missing.data.jobs[0], id: 10, run_attempt: 2, status: 'in_progress', conclusion: null });
    assert.equal(await missing.gh.verifyReservationEvidence(delivered), false);
  }
});
