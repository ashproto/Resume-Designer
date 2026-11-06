import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { attachLegacyDeliveredEvidence, verifyLegacyDeliveredReceiptEvidence } from './ios-cloud-legacy-delivered.mjs';

const repository = 'ashproto/Resume-Designer', root = `/repos/${repository}`;
const workflowPath = '.github/workflows/ios-testflight.yml';
const owner = { id: 35086581, login: 'ashproto', type: 'User' };
const repositoryIdentity = { id: 1163653093, full_name: repository, owner };
const sourceSets = {
  v1: [
    { path: 'tools/ios-cloud-release.mjs', blob: '0b6c255819eef0002e25b5bb355dc983cbfae157', size: 21005,
      digest: '9e3a1efcd616312b969d91df87e0ef066983f4d505ad861420885c40e2655f88' },
    { path: workflowPath, blob: '432472babfddd9f37dfce0a0ce3a2908643d0727', size: 6162,
      digest: 'd305ada619a575b8ffa3534fed420ce31be57c0ec6502f6540f49f7705aadde5' },
  ],
  v2: [
    { path: 'tools/ios-cloud-release.mjs', blob: '7b46d62021bbb31a2a29afb6f7c68d8099c605ab', size: 22200,
      digest: 'cfd5bf77746c3e2540976551927db3a52a0fdb3ec2c8b7743f0e3c0d89208a0d' },
    { path: workflowPath, blob: 'd73f9b84d69cbea10f515135805f78cff8605ed4', size: 6321,
      digest: 'e56ec4259b3880c1dc3f3773fa8845057857cc23301e2ea131616abe3600e050' },
  ],
};
const pins = [
  { sha: '1c0ba3cb8e760993bd8c8da111ade912ad93bd23', head: '2059a3bf3be5d081975f21a502374edc765d59b5',
    branch: 'next', event: 'workflow_dispatch', sourceSet: 'v1', logSize: 20983, runId: 37385750802, authorizeId: 112018484243, releaseId: 112018566461,
    created: '2026-10-05T22:58:16Z', updated: '2026-10-05T23:05:33Z',
    logDigest: '5ee070b64d1190e57b31feb5659a30656a064070775d22e8527e0367fcd160ae',
    cloudRunId: 'f55858db-6a38-48e1-98cc-fd6239dfcba4', buildId: 'dc0f758b-0555-48c0-bc69-cd75791e5b74', buildNumber: 2 },
  { sha: 'a955735f2c838ffe562a396947f5453c9c3f3bb0', head: 'e64dc7fde7bc160c2e39dd8652b56331ade26e8c',
    branch: 'next', event: 'workflow_dispatch', sourceSet: 'v1', logSize: 20983, runId: 35931900952, authorizeId: 107420152203, releaseId: 107420196564,
    created: '2026-09-23T23:06:33Z', updated: '2026-09-23T23:16:21Z',
    logDigest: 'd2d4ba26ecf5847464569ac299bdd31340a7bd0a32cb0e03cdb06c9bfff38f8d',
    cloudRunId: '7e46f78f-d674-407d-bf41-af0df864715c', buildId: 'a8b8af70-b487-4f09-8b29-b78fa4391d11', buildNumber: 1 },
  { sha: '7d8cf012f0868c82ba0ae9667c214d5946582655', head: '2059a3bf3be5d081975f21a502374edc765d59b5',
    branch: 'next', event: 'workflow_dispatch', sourceSet: 'v1', runId: 42119769773, authorizeId: 127568769430, releaseId: 127568860737,
    created: '2026-11-05T22:14:23Z', updated: '2026-11-05T22:23:03Z', logSize: 21054,
    logDigest: '12f8c97037de48e5b638fcaf383815482e03d5112853432d78d4d9c07e74280b',
    cloudRunId: 'a1705f01-fd92-462b-b8cd-55d67544cf13', buildId: 'f988ddbd-464f-4f22-a9e9-73523300e425', buildNumber: 3 },
  { sha: '2440b8910616134b00e0cc40a37c6a76f04e5e06', head: 'bc7d81e66386c155f05ad8ddb7ccb6939ef7a4e0',
    branch: 'next', event: 'workflow_run', sourceSet: 'v2', runId: 42132963754, authorizeId: 127613917372, releaseId: 127614009106,
    created: '2026-11-05T23:55:02Z', updated: '2026-11-06T00:14:41Z', logSize: 21205,
    logDigest: 'b1922fb77cf106d296d9bedcb603b947c9a24112f4d3ea27db0afad1e266fdd6',
    cloudRunId: '7acf706c-a2e0-48df-b187-b63e31da1306', buildId: '02cdf79b-a228-4824-b7b9-0fee96ed1d84', buildNumber: 4 },
  { sha: '1909eee5e72aa78b40dcf48068d01710464c31bc', head: 'bc7d81e66386c155f05ad8ddb7ccb6939ef7a4e0',
    branch: 'next', event: 'workflow_run', sourceSet: 'v2', runId: 42158719963, authorizeId: 127698976497, releaseId: 127699043547,
    created: '2026-11-06T03:48:17Z', updated: '2026-11-06T04:00:22Z', logSize: 21213,
    logDigest: 'a5887e098acc7463b963f9622b5dead537a5f0ac2bfa05b491228b47ccc0422a',
    cloudRunId: 'abd53d24-f8fe-4304-9061-6ed9f5a896e2', buildId: '509023a3-da0a-44e9-a189-0ccb2f58305b', buildNumber: 5 },
  { sha: 'dd1ca63c1a3992ec50a8846c509b1551fa450415', head: 'dd1ca63c1a3992ec50a8846c509b1551fa450415',
    branch: 'main', event: 'workflow_run', sourceSet: 'v2', runId: 42160990194, authorizeId: 127706336454, releaseId: 127706397107,
    created: '2026-11-06T04:11:14Z', updated: '2026-11-06T04:23:00Z', logSize: 21194,
    logDigest: 'd36700fdec6ad1d10b2c8a015adfb39782e108be858a0af36a164139c8ed483c',
    cloudRunId: '2f6f5ef4-1a1c-40f1-b048-f07c0af64eea', buildId: '49d33278-eef7-4a04-a62e-84e8ed58af87', buildNumber: 6 },
];
const expected = pin => ({ repository, tag: `ios-testflight/${pin.branch}/${pin.sha}`, sha: pin.sha });
const receipt = pin => ({ ...expected(pin), appId: '6815088694', workflowId: 'F77BFDD6-479B-44D2-B772-FFDB25F9D40D',
  cloudRunId: pin.cloudRunId, buildId: pin.buildId, buildNumber: pin.buildNumber });
function evidence(pin) {
  return structuredClone({ expected: expected(pin),
    ref: { ref: `refs/tags/ios-testflight/${pin.branch}/${pin.sha}`, object: { type: 'commit', sha: pin.sha } },
    run: { id: pin.runId, html_url: `https://github.com/${repository}/actions/runs/${pin.runId}`,
      workflow_id: 365585990, name: 'iOS TestFlight', path: workflowPath, event: pin.event, head_branch: 'main',
      head_sha: pin.head, run_attempt: 1, status: 'completed', conclusion: 'success',
      created_at: pin.created, updated_at: pin.updated, repository: repositoryIdentity, head_repository: repositoryIdentity,
      actor: owner, triggering_actor: owner },
    workflow: { id: 365585990, name: 'iOS TestFlight', path: workflowPath },
    jobs: [{ id: pin.authorizeId, name: 'authorize' }, { id: pin.releaseId, name: 'release' }].map(job => ({ ...job,
      run_id: pin.runId, run_attempt: 1, head_sha: pin.head, run_url: `https://api.github.com${root}/actions/runs/${pin.runId}`,
      status: 'completed', conclusion: 'success' })),
    sources: sourceSets[pin.sourceSet], log: { size: pin.logSize, digest: pin.logDigest },
  });
}

for (const pin of pins) test(`exact reviewed delivery returns only fixed receipt ${pin.sha.slice(0, 8)}`, () => {
  const verify = verifyLegacyDeliveredReceiptEvidence;
  const value = evidence(pin);
  value.expected = { ...value.expected, cloudRunId: 'caller-run', buildId: 'caller-build', buildNumber: 999 };
  assert.deepEqual(verify(value), receipt(pin));
  const first = verify(value);
  try { first.buildId = 'caller-mutated'; } catch { /* A frozen receipt is also safe. */ }
  assert.deepEqual(verify(value), receipt(pin));
});

for (const [name, mutate] of [
  ['other tag', x => { x.expected.tag = x.expected.tag.includes('/next/') ? x.expected.tag.replace('/next/', '/main/') : x.expected.tag.replace('/main/', '/next/'); }],
  ['other sha', x => { x.expected.sha = 'a'.repeat(40); }],
  ['other repository', x => { x.expected.repository = 'fork/Resume-Designer'; }],
  ['moved ref', x => { x.ref.object.sha = 'b'.repeat(40); }],
  ['annotated ref', x => { x.ref.object.type = 'tag'; }],
  ['other ref name', x => { x.ref.ref += '/extra'; }],
  ['other run id', x => { x.run.id++; }],
  ['other run URL', x => { x.run.html_url += '/attempts/2'; }],
  ['other run workflow', x => { x.run.workflow_id++; }],
  ['other run name', x => { x.run.name = 'untrusted'; }],
  ['other run path', x => { x.run.path = '.github/workflows/ci.yml'; }],
  ['other event', x => { x.run.event = x.run.event === 'workflow_dispatch' ? 'workflow_run' : 'workflow_dispatch'; }],
  ['other branch', x => { x.run.head_branch = 'next'; }],
  ['other checkout', x => { x.run.head_sha = 'b'.repeat(40); }],
  ['later attempt', x => { x.run.run_attempt = 2; }],
  ['active run', x => { x.run.status = 'in_progress'; }],
  ['failed run', x => { x.run.conclusion = 'failure'; }],
  ['changed creation time', x => { x.run.created_at = x.run.updated_at; }],
  ['changed completion time', x => { x.run.updated_at = x.run.created_at; }],
  ['other repository id', x => { x.run.repository.id = 1; }],
  ['other repository name', x => { x.run.repository.full_name = 'fork/Resume-Designer'; }],
  ['other repository owner', x => { x.run.repository.owner.id = 1; }],
  ['other head repository', x => { x.run.head_repository.full_name = 'fork/Resume-Designer'; }],
  ['other head owner', x => { x.run.head_repository.owner.login = 'other'; }],
  ['other actor', x => { x.run.actor.id = 1; }],
  ['other triggering actor', x => { x.run.triggering_actor.login = 'other'; }],
  ['bot triggering actor', x => { x.run.triggering_actor.type = 'Bot'; }],
  ['other workflow id', x => { x.workflow.id++; }],
  ['other workflow path', x => { x.workflow.path = '.github/workflows/ci.yml'; }],
  ['other workflow name', x => { x.workflow.name = 'other'; }],
  ['missing job', x => { x.jobs.pop(); }],
  ['duplicate job', x => { x.jobs[0] = { ...x.jobs[1] }; }],
  ['extra job', x => { x.jobs.push({ ...x.jobs[1], id: 1 }); }],
  ['other job id', x => { x.jobs[1].id++; }],
  ['other job name', x => { x.jobs[1].name = 'other'; }],
  ['other job run', x => { x.jobs[1].run_id++; }],
  ['later job attempt', x => { x.jobs[1].run_attempt = 2; }],
  ['other job checkout', x => { x.jobs[1].head_sha = 'b'.repeat(40); }],
  ['other job URL', x => { x.jobs[1].run_url = 'https://evil.test'; }],
  ['failed job', x => { x.jobs[1].conclusion = 'failure'; }],
  ['incomplete job', x => { x.jobs[0].status = 'in_progress'; }],
  ['missing source', x => { x.sources.pop(); }],
  ['duplicate source', x => { x.sources[0] = { ...x.sources[1] }; }],
  ['other source path', x => { x.sources[0].path = 'other'; }],
  ['other source blob', x => { x.sources[0].blob = 'b'.repeat(40); }],
  ['other source length', x => { x.sources[0].size++; }],
  ['changed controller bytes', x => { x.sources[0].digest = 'b'.repeat(64); }],
  ['changed workflow bytes', x => { x.sources[1].digest = 'b'.repeat(64); }],
  ['changed raw log', x => { x.log.digest = 'b'.repeat(64); }],
  ['truncated raw log', x => { x.log.size--; }],
]) test(`reviewed delivery refuses ${name}`, () => {
  const verify = verifyLegacyDeliveredReceiptEvidence;
  for (const pin of pins) { const value = evidence(pin); mutate(value); assert.equal(verify(value), undefined); }
});

test('a digest or commit status alone never substitutes for authenticated provenance', () => {
  const verify = verifyLegacyDeliveredReceiptEvidence;
  for (const pin of pins) {
    const value = evidence(pin);
    assert.equal(verify({ expected: value.expected, log: value.log, sources: value.sources }), undefined);
    assert.equal(verify({ expected: value.expected, status: { state: 'success', target_url: value.run.html_url } }), undefined);
  }
  for (const value of [undefined, null, {}, { expected: {} }]) assert.equal(verify(value), undefined);
});

test('unknown receipts or a missing token perform no API or CLI operations', async () => {
  let operations = 0;
  const gh = { request: async () => { operations++; throw new Error('no reads'); } };
  attachLegacyDeliveredEvidence(gh, { token: 'gh-only', exec: () => { operations++; throw new Error('no CLI'); } });
  for (const value of [{}, { ...expected(pins[0]), sha: 'b'.repeat(40) }, { ...expected(pins[1]), tag: 'other' },
    { ...expected(pins[0]), repository: 'fork/Resume-Designer' }]) {
    assert.equal(await gh.verifyLegacyDeliveredEvidence(value), undefined);
  }
  attachLegacyDeliveredEvidence(gh, { exec: () => { operations++; } });
  assert.equal(await gh.verifyLegacyDeliveredEvidence(expected(pins[0])), undefined);
  assert.equal(operations, 0);
});

function adapterFixture(pin, { real = false, mutate, logTransform, failLog = false, rerunAfterLog = false, finalActorChanged = false } = {}) {
  const value = evidence(pin), calls = [];
  const fixtureDir = process.env.OP_IOS_LEGACY_DELIVERY_EVIDENCE_FIXTURE_DIR;
  const stored = real ? JSON.parse(readFileSync(join(fixtureDir, 'sources.json'), 'utf8'))[pin.sha] : undefined;
  if (real) for (const key of ['ref', 'run', 'workflow', 'jobs']) value[key] = structuredClone(stored[key]);
  if (mutate) mutate(value);
  const files = stored?.sources ?? [];
  const bytes = real ? readFileSync(join(fixtureDir, stored.logFile)) : Buffer.from('not an authenticated log');
  let logReads = 0, config;
  const gh = { request: async (path, options) => {
    calls.push(path); assert.equal(options, undefined, 'receipt adapter must only perform GETs');
    if (path === `${root}/git/ref/tags/${expected(pin).tag}`) return value.ref;
    if (path === `${root}/actions/runs/${pin.runId}`) {
      if (logReads && rerunAfterLog) return { ...value.run, run_attempt: 2 };
      if (logReads && finalActorChanged) return { ...value.run, triggering_actor: { ...owner, id: 1 } };
      return value.run;
    }
    if (path === `${root}/actions/workflows/365585990`) return value.workflow;
    if (path === `${root}/actions/runs/${pin.runId}/jobs?filter=all&per_page=100&page=1`) return { jobs: value.jobs };
    const source = files.find(file => path === `${root}/contents/${file.path}?ref=${pin.head}`);
    if (source) return source;
    const sourcePin = value.sources.find(file => path === `${root}/contents/${file.path}?ref=${pin.head}`);
    if (sourcePin) return { type: 'file', path: sourcePin.path, sha: sourcePin.blob, size: sourcePin.size,
      encoding: 'base64', content: Buffer.from('wrong source bytes').toString('base64') };
    throw new Error('Unexpected evidence request');
  } };
  attachLegacyDeliveredEvidence(gh, { token: 'gh-only', exec: (command, args, options) => {
    logReads++; config = options.env.GH_CONFIG_DIR;
    assert.equal(command, 'gh');
    assert.deepEqual(args, ['api', '--allow-escape-sequences', `repos/${repository}/actions/jobs/${pin.releaseId}/logs`]);
    assert.equal(options.encoding, 'buffer'); assert.equal(options.timeout, 60_000); assert.equal(options.maxBuffer, 1024 * 1024);
    assert.deepEqual(Object.keys(options.env).sort(), ['PATH', 'GH_TOKEN', 'GH_HOST', 'GH_CONFIG_DIR', 'XDG_STATE_HOME', 'XDG_CACHE_HOME', 'GH_PROMPT_DISABLED'].sort());
    assert.equal(options.env.GH_TOKEN, 'gh-only'); assert.equal(options.env.GH_HOST, 'github.com');
    assert.equal(options.env.XDG_STATE_HOME, config); assert.equal(options.env.XDG_CACHE_HOME, config);
    assert.deepEqual(readdirSync(config), []);
    if (failLog) throw new Error('Logs expired or unavailable');
    return logTransform ? logTransform(bytes) : bytes;
  } });
  return { gh, calls, get logReads() { return logReads; }, get config() { return config; } };
}

test('authentic-looking metadata without pinned source bytes cannot launch the log child', async () => {
  for (const pin of pins) {
    const f = adapterFixture(pin);
    assert.equal(await f.gh.verifyLegacyDeliveredEvidence(expected(pin)), undefined);
    assert.equal(f.logReads, 0);
  }
});

test('GitHub verification failures remain unresolved', async () => {
  const gh = { request: async () => { throw new Error('API unavailable'); } };
  attachLegacyDeliveredEvidence(gh, { token: 'gh-only', exec: () => { throw new Error('must not execute'); } });
  assert.equal(await gh.verifyLegacyDeliveredEvidence(expected(pins[0])), undefined);
});

// Authentic source and raw logs stay in a private local fixture directory.
for (const pin of pins) {
  test(`actual adapter authenticates reviewed raw receipt ${pin.sha.slice(0, 8)}`, {
    skip: !process.env.OP_IOS_LEGACY_DELIVERY_EVIDENCE_FIXTURE_DIR,
  }, async () => {
    const f = adapterFixture(pin, { real: true });
    assert.deepEqual(await f.gh.verifyLegacyDeliveredEvidence(expected(pin)), receipt(pin));
    assert.equal(f.logReads, 1); assert.equal(existsSync(f.config), false);
    assert.equal(f.calls.filter(path => path === `${root}/actions/runs/${pin.runId}`).length, 2);
  });
  for (const [name, options] of [
    ['changed log bytes', { logTransform: bytes => { const changed = Buffer.from(bytes); changed[changed.length - 1] ^= 1; return changed; } }],
    ['truncated log', { logTransform: bytes => bytes.subarray(0, -1) }],
    ['unavailable historical log', { failLog: true }],
    ['non-byte log output', { logTransform: bytes => bytes.toString('utf8') }],
    ['later run attempt', { rerunAfterLog: true }],
    ['changed final triggering actor', { finalActorChanged: true }],
  ]) test(`actual adapter refuses ${name} for ${pin.sha.slice(0, 8)}`, {
    skip: !process.env.OP_IOS_LEGACY_DELIVERY_EVIDENCE_FIXTURE_DIR,
  }, async () => {
    const f = adapterFixture(pin, { real: true, ...options });
    assert.equal(await f.gh.verifyLegacyDeliveredEvidence(expected(pin)), undefined);
    assert.equal(f.logReads, 1); assert.equal(existsSync(f.config), false);
  });
}
