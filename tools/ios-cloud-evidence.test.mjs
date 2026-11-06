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
    assert.deepEqual(readdirSync(options.env.GH_CONFIG_DIR), []);
    return marker('not-started');
  } });
  assert.equal(typeof gh.verifyLegacyReservationEvidence, 'function');
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
