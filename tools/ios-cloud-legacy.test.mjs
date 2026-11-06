import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { attachLegacyReservationEvidence, verifyLegacyReceiptEvidence } from './ios-cloud-legacy.mjs';

const repository = 'ashproto/Resume-Designer';
const sha = '52e1b799c03be084736a10c3ff7aa81d41b22a2c';
const head = 'bc7d81e66386c155f05ad8ddb7ccb6939ef7a4e0';
const tag = `ios-testflight/next/${sha}`;
const expected = { repository, tag, sha };
const root = `/repos/${repository}`;
const identity = { id: 1163653093, full_name: repository };
function evidence() {
  return {
    expected,
    ref: { ref: `refs/tags/${tag}`, object: { type: 'commit', sha } },
    run: { id: 42157371938, workflow_id: 365585990, name: 'iOS TestFlight', path: '.github/workflows/ios-testflight.yml',
      event: 'workflow_run', head_branch: 'main', head_sha: head, status: 'completed', conclusion: 'success', run_attempt: 1,
      repository: identity, head_repository: identity, html_url: `https://github.com/${repository}/actions/runs/42157371938` },
    workflow: { id: 365585990, name: 'iOS TestFlight', path: '.github/workflows/ios-testflight.yml' },
    jobs: [
      { id: 127694613500, name: 'authorize', run_id: 42157371938, run_attempt: 1, status: 'completed', conclusion: 'success', run_url: `https://api.github.com${root}/actions/runs/42157371938` },
      { id: 127694679435, name: 'release', run_id: 42157371938, run_attempt: 1, status: 'completed', conclusion: 'success', run_url: `https://api.github.com${root}/actions/runs/42157371938` },
    ],
    sources: [
      { path: 'tools/ios-cloud-release.mjs', blob: '7b46d62021bbb31a2a29afb6f7c68d8099c605ab', size: 22200, digest: 'cfd5bf77746c3e2540976551927db3a52a0fdb3ec2c8b7743f0e3c0d89208a0d' },
      { path: '.github/workflows/ios-testflight.yml', blob: 'd73f9b84d69cbea10f515135805f78cff8605ed4', size: 6321, digest: 'e56ec4259b3880c1dc3f3773fa8845057857cc23301e2ea131616abe3600e050' },
    ],
    log: { size: 20876, digest: 'f43ab95b597481ddb516f3c2ba6a7c862fbb6a62e9936ffec54934f744d7d01d' },
  };
}

test('the exact authenticated legacy receipt closes only its original unused reservation', () => {
  assert.equal(verifyLegacyReceiptEvidence(evidence()), true);
});

for (const [name, mutate] of [
  ['other tag', x => { x.expected = { ...expected, tag: tag.replace('/next/', '/main/') }; }],
  ['other sha', x => { x.expected = { ...expected, sha: 'a'.repeat(40) }; }],
  ['other repository', x => { x.expected = { ...expected, repository: 'fork/Resume-Designer' }; }],
  ['moved ref', x => { x.ref.object.sha = 'a'.repeat(40); }],
  ['annotated ref', x => { x.ref.object.type = 'tag'; }],
  ['other run', x => { x.run.id++; }],
  ['other workflow', x => { x.run.workflow_id++; }],
  ['wrong workflow path', x => { x.workflow.path = '.github/workflows/ci.yml'; }],
  ['untrusted event', x => { x.run.event = 'pull_request'; }],
  ['untrusted branch', x => { x.run.head_branch = 'next'; }],
  ['wrong checkout head', x => { x.run.head_sha = sha; }],
  ['wrong repository id', x => { x.run.repository = { ...identity, id: 1 }; }],
  ['fork head repository', x => { x.run.head_repository = { ...identity, full_name: 'fork/Resume-Designer' }; }],
  ['later run attempt', x => { x.run.run_attempt = 2; }],
  ['active run', x => { x.run.status = 'in_progress'; }],
  ['failed run', x => { x.run.conclusion = 'failure'; }],
  ['other run url', x => { x.run.html_url += '/attempts/2'; }],
  ['missing release job', x => { x.jobs.pop(); }],
  ['later release job', x => { x.jobs.push({ ...x.jobs[1], id: 999, run_attempt: 2 }); }],
  ['duplicate job', x => { x.jobs.push({ ...x.jobs[1] }); }],
  ['wrong job id', x => { x.jobs[1].id++; }],
  ['wrong job attempt', x => { x.jobs[1].run_attempt = 2; }],
  ['wrong job run', x => { x.jobs[1].run_id++; }],
  ['wrong job origin', x => { x.jobs[1].run_url = 'https://evil.test'; }],
  ['incomplete job', x => { x.jobs[1].status = 'in_progress'; }],
  ['failed job', x => { x.jobs[1].conclusion = 'failure'; }],
  ['unknown job name', x => { x.jobs[1].name = 'untrusted'; }],
  ['missing source', x => { x.sources.pop(); }],
  ['wrong controller bytes', x => { x.sources[0].digest = 'a'.repeat(64); }],
  ['wrong workflow bytes', x => { x.sources[1].digest = 'a'.repeat(64); }],
  ['wrong source blob', x => { x.sources[0].blob = 'a'.repeat(40); }],
  ['wrong source path', x => { x.sources[0].path = 'other'; }],
  ['wrong source length', x => { x.sources[0].size++; }],
  ['wrong raw logs', x => { x.log.digest = 'a'.repeat(64); }],
  ['truncated logs', x => { x.log.size--; }],
]) test(`legacy evidence refuses ${name}`, () => {
  const x = evidence(); mutate(x); assert.equal(verifyLegacyReceiptEvidence(x), false);
});

test('unknown reservations are refused before any API or CLI access', async () => {
  let calls = 0;
  const gh = { request: async () => { calls++; throw new Error('no reads'); } };
  attachLegacyReservationEvidence(gh, { token: 'test', exec: () => { calls++; throw new Error('no CLI'); } });
  for (const value of [{}, { ...expected, tag: `${tag}x` }, { ...expected, sha: 'a'.repeat(40) }, { ...expected, repository: 'fork/repo' }]) {
    assert.equal(await gh.verifyLegacyReservationEvidence(value), false);
  }
  assert.equal(calls, 0);
});

function adapterFixture({ real = false, mutate, logTransform, failLog = false, rerunAfterLog = false } = {}) {
  const x = evidence();
  const files = real ? JSON.parse(readFileSync(join(process.env.OP_IOS_LEGACY_EVIDENCE_FIXTURE_DIR, 'sources.json'), 'utf8')) : [];
  const rawLog = real ? readFileSync(join(process.env.OP_IOS_LEGACY_EVIDENCE_FIXTURE_DIR, 'job.log')) : Buffer.from('release_state=superseded\n');
  if (mutate) mutate(x);
  const gh = { request: async (path, options) => {
    assert.equal(options, undefined, 'migration must only GET');
    if (path === `${root}/git/ref/tags/${tag}`) return x.ref;
    if (path === `${root}/actions/runs/42157371938`) return rerunAfterLog && logReads ? { ...x.run, run_attempt: 2 } : x.run;
    if (path === `${root}/actions/workflows/365585990`) return x.workflow;
    if (path === `${root}/actions/runs/42157371938/jobs?filter=all&per_page=100&page=1`) return { jobs: x.jobs };
    const source = files.find(file => path === `${root}/contents/${file.path}?ref=${head}`);
    if (source) return source;
    // Authentic-looking metadata cannot replace original source bytes.
    const pinned = x.sources.find(file => path === `${root}/contents/${file.path}?ref=${head}`);
    if (pinned) return { type: 'file', path: pinned.path, sha: pinned.blob, size: pinned.size, encoding: 'base64', content: Buffer.from('wrong bytes').toString('base64') };
    throw new Error(`Unexpected read ${path}`);
  } };
  let logReads = 0, config;
  attachLegacyReservationEvidence(gh, { token: 'github-only', exec: (command, args, options) => {
    logReads++;
    assert.equal(command, 'gh');
    assert.deepEqual(args, ['api', '--allow-escape-sequences', `repos/${repository}/actions/jobs/127694679435/logs`]);
    assert.equal(options.env.GH_TOKEN, 'github-only');
    assert.equal(options.env.APP_STORE_CONNECT_PRIVATE_KEY, undefined);
    assert.equal(options.env.GITHUB_TOKEN, undefined);
    assert.deepEqual(readdirSync(options.env.GH_CONFIG_DIR), []);
    config = options.env.GH_CONFIG_DIR;
    if (failLog) throw new Error('Original logs unavailable');
    return logTransform ? logTransform(rawLog) : rawLog;
  } });
  return { gh, get logReads() { return logReads; }, get config() { return config; } };
}

test('adapter rejects authentic-looking metadata without the exact original source bytes', async () => {
  const f = adapterFixture();
  assert.equal(await f.gh.verifyLegacyReservationEvidence(expected), false);
});

test('metadata or log-fetch failures remain unresolved', async () => {
  const gh = { request: async () => { throw new Error('unavailable'); } };
  attachLegacyReservationEvidence(gh, { token: 'test', exec: () => { throw new Error('unavailable'); } });
  assert.equal(await gh.verifyLegacyReservationEvidence(expected), false);
  attachLegacyReservationEvidence(gh, { exec: () => { throw new Error('no token'); } });
  assert.equal(await gh.verifyLegacyReservationEvidence(expected), false);
});

// Full authentic raw logs remain outside the repository. Enable this test with
// the local evidence directory; portable tests above cover fixed policy denials.
test('local authentic original source and raw-log bytes pass the actual adapter', {
  skip: !process.env.OP_IOS_LEGACY_EVIDENCE_FIXTURE_DIR,
}, async () => {
  const f = adapterFixture({ real: true });
  assert.equal(await f.gh.verifyLegacyReservationEvidence(expected), true);
  assert.equal(f.logReads, 1);
  assert.equal(existsSync(f.config), false);
});

for (const [name, options] of [
  ['changed raw log bytes', { logTransform: bytes => Buffer.concat([bytes, Buffer.from('changed')]) }],
  ['unavailable original logs', { failLog: true }],
  ['later run attempt during evidence reads', { rerunAfterLog: true }],
]) test(`local authentic-source adapter refuses ${name}`, {
  skip: !process.env.OP_IOS_LEGACY_EVIDENCE_FIXTURE_DIR,
}, async () => {
  const f = adapterFixture({ real: true, ...options });
  assert.equal(await f.gh.verifyLegacyReservationEvidence(expected), false);
  assert.equal(f.logReads, 1);
  assert.equal(existsSync(f.config), false);
});
