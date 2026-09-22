import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import {
  validateInput, createAscJwt, safeApiUrl, createApi, ensureTrustedCommit,
  ensureReleaseTag, selectTag, validateWorkflow, cloudState, betaState, release, parseArgs,
} from './ios-cloud-release.mjs';

const sha = 'a'.repeat(40);
const input = { branch: 'next', sha, repository: 'ashproto/Resume-Designer', workflowId: 'workflow', appId: '123', groupId: 'group' };
const tag = `ios-testflight/next/${sha}`;
const relation = (id, type) => ({ data: { id, type } });
const ref = { id: 'tag-id', type: 'scmGitReferences', attributes: { kind: 'TAG', name: tag, canonicalName: `refs/tags/${tag}`, isDeleted: false } };
const workflow = { id: 'workflow', attributes: { isEnabled: true, manualTagStartCondition: {}, actions: [{ actionType: 'ARCHIVE', platform: 'IOS', buildDistributionAudience: 'APP_STORE_ELIGIBLE' }] }, relationships: { repository: relation('repo', 'scmRepositories'), product: relation('product', 'ciProducts') } };
const repository = { id: 'repo', type: 'scmRepositories', attributes: { ownerName: 'ashproto', repositoryName: 'Resume-Designer', httpCloneUrl: 'https://github.com/ashproto/Resume-Designer.git' } };
const app = { id: '123', attributes: { bundleId: 'com.onpaper.app' } };
const run = (overrides = {}) => ({ id: 'run', type: 'ciBuildRuns', attributes: { number: 4, sourceCommit: { commitSha: sha }, executionProgress: 'COMPLETE', completionStatus: 'SUCCEEDED', ...overrides }, relationships: { workflow: relation('workflow', 'ciWorkflows'), sourceBranchOrTag: relation('tag-id', 'scmGitReferences') } });
const build = { id: 'build', attributes: { version: '4', processingState: 'VALID', buildAudienceType: 'APP_STORE_ELIGIBLE', expired: false } };
const fail404 = () => { throw Object.assign(new Error('missing'), { status: 404 }); };

test('only full SHAs in the canonical repo and trusted branches are accepted', () => {
  assert.equal(validateInput(input).tag, tag);
  for (const bad of [{ branch: 'feature' }, { sha: 'abc' }, { repository: 'fork/Resume-Designer' }, { workflowId: '../escape' }]) {
    assert.throws(() => validateInput({ ...input, ...bad }));
  }
});

test('ASC JWT uses ES256 P1363, correct claims, and tolerates escaped PEM newlines', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const token = createAscJwt({ issuerId: 'issuer', keyId: 'key', privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).replaceAll('\n', '\\n') }, 1000);
  const [header, payload, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), { alg: 'ES256', kid: 'key', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(payload, 'base64url')), { iss: 'issuer', iat: 1000, exp: 1600, aud: 'appstoreconnect-v1' });
  assert.equal(Buffer.from(signature, 'base64url').length, 64);
  assert.ok(verify('sha256', Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(signature, 'base64url')));
});

test('API links cannot disclose credentials through hostile pagination or redirects', async () => {
  for (const path of ['https://evil.test/a', '//evil.test/a', 'http://api.github.com/a', 'https://user@api.github.com/a']) {
    assert.throws(() => safeApiUrl('https://api.github.com', path));
  }
  let options;
  const api = createApi({ origin: 'https://api.github.com', token: () => 'secret', fetchImpl: async (_url, supplied) => { options = supplied; return new Response('{}'); } });
  await api.request('/a');
  assert.equal(options.redirect, 'error');
});

test('GET retries transient failures, POST never retries', async () => {
  for (const method of ['GET', 'POST']) {
    let calls = 0;
    const api = createApi({ origin: 'https://api.github.com', token: () => 'token', sleep: async () => {}, fetchImpl: async () => { calls++; return new Response('{}', { status: 503 }); } });
    await assert.rejects(api.request('/a', { method }), /503/);
    assert.equal(calls, method === 'GET' ? 3 : 1);
  }
});

test('collection follows all pages and refuses pagination cycles', async () => {
  let calls = 0;
  const api = createApi({ origin: 'https://api.appstoreconnect.apple.com', token: () => 't', fetchImpl: async () => new Response(JSON.stringify(++calls === 1 ? { data: [1], links: { next: 'https://api.appstoreconnect.apple.com/v1/list?page=2' } } : { data: [2] })) });
  assert.deepEqual(await api.collection('/v1/list'), [1, 2]);
  const loop = createApi({ origin: 'https://api.appstoreconnect.apple.com', token: () => 't', fetchImpl: async () => new Response(JSON.stringify({ data: [], links: { next: '/v1/list' } })) });
  await assert.rejects(loop.collection('/v1/list'), /pagination/i);
});

test('protected branch and reachable commit are required, using an unambiguous head SHA', async () => {
  const paths = [];
  const gh = { request: async path => { paths.push(path); return path.includes('/branches/') ? { protected: true, commit: { sha: 'b'.repeat(40) } } : { status: 'ahead', merge_base_commit: { sha } }; } };
  await ensureTrustedCommit(gh, input);
  assert.ok(paths[1].endsWith(`${sha}...${'b'.repeat(40)}`));
  await assert.rejects(ensureTrustedCommit({ request: async () => ({ protected: false }) }, input), /protected/);
  gh.request = async path => path.includes('/branches/') ? { protected: true, commit: { sha } } : { status: 'diverged', merge_base_commit: { sha: 'b'.repeat(40) } };
  await assert.rejects(ensureTrustedCommit(gh, input), /reachable/);
});

test('tag creation reserves one start and does not overwrite or claim an existing tag', async () => {
  const calls = [];
  const existing = { ref: `refs/tags/${tag}`, object: { type: 'commit', sha } };
  const gh = { request: async (path, options) => { calls.push({ path, options }); if (options?.method === 'POST') return existing; return fail404(); } };
  assert.equal((await ensureReleaseTag(gh, { ...input, tag })).created, true);
  assert.equal(calls[1].options.body.sha, sha);
  assert.equal(calls[1].options.body.ref, `refs/tags/${tag}`);
  assert.equal((await ensureReleaseTag({ request: async () => existing }, { ...input, tag })).created, false);
  await assert.rejects(ensureReleaseTag({ request: async () => ({ ...existing, object: { type: 'commit', sha: 'b'.repeat(40) } }) }, { ...input, tag }), /does not match/);
  await assert.rejects(ensureReleaseTag({ request: async () => ({ ...existing, object: { type: 'tag', sha } }) }, { ...input, tag }), /does not match/);
});

test('ambiguous tag creation may recover its ref but does not authorize a start', async () => {
  let calls = 0;
  const gh = { request: async (_path, options) => { calls++; if (options?.method === 'POST') throw new Error('connection lost'); if (calls === 1) return fail404(); return { ref: `refs/tags/${tag}`, object: { type: 'commit', sha } }; } };
  assert.equal((await ensureReleaseTag(gh, { ...input, tag })).created, false);
});

test('Apple ref must be exact TAG canonicalName, not a similarly named branch', () => {
  assert.equal(selectTag([ref], tag).id, 'tag-id');
  for (const change of [{ kind: 'BRANCH' }, { canonicalName: `refs/heads/${tag}` }, { isDeleted: true }, { name: `${tag}x` }]) {
    assert.equal(selectTag([{ ...ref, attributes: { ...ref.attributes, ...change } }], tag), undefined);
  }
  assert.throws(() => selectTag([ref, { ...ref, id: 'duplicate' }], tag), /multiple/);
});

test('workflow identity and single manual eligible archive are checked before mutation', () => {
  validateWorkflow(workflow, repository, app, input);
  for (const attrs of [{ isEnabled: false }, { tagStartCondition: {} }, { branchStartCondition: {} }, { manualTagStartCondition: null }, { actions: [{ actionType: 'ARCHIVE', platform: 'IOS', buildDistributionAudience: 'INTERNAL_ONLY' }] }]) {
    assert.throws(() => validateWorkflow({ ...workflow, attributes: { ...workflow.attributes, ...attrs } }, repository, app, input));
  }
  assert.throws(() => validateWorkflow(workflow, { ...repository, attributes: { ...repository.attributes, httpCloneUrl: 'https://evil.test/ashproto/Resume-Designer.git' } }, app, input));
  assert.throws(() => validateWorkflow(workflow, repository, { ...app, id: '999' }, input));
});

test('current Apple enums distinguish submitted, complete success, failures and beta availability', () => {
  assert.equal(cloudState(run({ executionProgress: 'PENDING', completionStatus: null }), input, 'tag-id'), 'pending');
  assert.equal(cloudState(run(), input, 'tag-id'), 'succeeded');
  for (const status of ['FAILED', 'ERRORED', 'CANCELED', 'SKIPPED']) assert.throws(() => cloudState(run({ completionStatus: status }), input, 'tag-id'), new RegExp(status));
  assert.throws(() => cloudState(run({ sourceCommit: { commitSha: 'b'.repeat(40) } }), input, 'tag-id'), /commit/);
  assert.throws(() => cloudState(run({ executionProgress: 'UNKNOWN' }), input, 'tag-id'), /Unknown/);
  assert.equal(betaState(build, { internalBuildState: 'READY_FOR_BETA_TESTING' }), 'ready');
  assert.equal(betaState(build, { internalBuildState: 'IN_BETA_TESTING' }), 'available');
  for (const status of ['PROCESSING_EXCEPTION', 'EXPIRED', 'MISSING_EXPORT_COMPLIANCE']) assert.throws(() => betaState(build, { internalBuildState: status }), new RegExp(status));
  assert.throws(() => betaState({ ...build, attributes: { ...build.attributes, processingState: 'INVALID' } }, {}), /INVALID/);
});

function scenario({ existing = false, existingRun = true, startError, runChange, beta = 'IN_BETA_TESTING', head = sha } = {}) {
  const writes = [], outputs = [], calls = [];
  const tagPayload = { ref: `refs/tags/${tag}`, object: { type: 'commit', sha } };
  const branch = { protected: true, commit: { sha: head } };
  let made = existing;
  const gh = { request: async (path, options) => {
    calls.push(path);
    if (path.includes('/branches/')) return branch;
    if (path.includes('/compare/')) return { status: branch.commit.sha === sha ? 'identical' : 'ahead', merge_base_commit: { sha } };
    if (options?.method === 'POST') { made = true; writes.push('tag'); return tagPayload; }
    if (path.includes('/git/ref/')) return made ? tagPayload : fail404();
    throw new Error(`Unexpected GitHub path ${path}`);
  } };
  const asc = { request: async (path, options) => {
    calls.push(path);
    if (options?.method === 'POST') { writes.push('start'); if (startError) throw startError; return { data: run(runChange) }; }
    if (path.startsWith('/v1/ciWorkflows/workflow?')) return { data: workflow, included: [repository] };
    if (path === '/v1/ciProducts/product/app') return { data: app };
    if (path === '/v1/betaGroups/group?include=app') return { data: { id: 'group', attributes: { isInternalGroup: true }, relationships: { app: relation('123', 'apps') } } };
    if (path.startsWith('/v1/ciBuildRuns/run?')) return { data: run(runChange) };
    if (path === '/v1/builds/build/buildBetaDetail') return { data: { attributes: { internalBuildState: beta } } };
    if (path === '/v1/builds/build/app') return { data: app };
    throw new Error(`Unexpected Apple path ${path}`);
  }, collection: async path => {
    calls.push(path);
    if (path.includes('/gitReferences')) return [ref];
    if (path === '/v1/betaGroups/group/builds?limit=200&fields[builds]=version') return [build];
    if (path.includes('/buildRuns?')) return existingRun && existing ? [run(runChange)] : [];
    if (path.includes('/builds?')) return [build];
    throw new Error(`Unexpected Apple collection ${path}`);
  } };
  return { gh, asc, branch, writes, calls, outputs, options: { gh, asc, output: item => outputs.push(item), sleep: async () => {}, pollAttempts: 2, discoveryAttempts: 2, log: () => {} } };
}

test('new release dispatches once and only reports finished after beta is in testing', async () => {
  const s = scenario();
  const result = await release(input, s.options);
  assert.deepEqual(s.writes, ['tag', 'start']);
  assert.equal(result.state, 'testflight_available');
  const states = s.outputs.map(x => x.release_state).filter(Boolean);
  assert.deepEqual(states, ['submitted', 'cloud_succeeded', 'testflight_available']);
  assert.ok(s.outputs.some(x => x.build_run_id === 'run'));
});

test('rerun resumes an existing run without a second start', async () => {
  const s = scenario({ existing: true });
  await release(input, s.options);
  assert.deepEqual(s.writes, []);
});

test('a mistaken explicit resume cannot consume a new head reservation', async () => {
  const s = scenario();
  const original = s.asc.request;
  s.asc.request = async (path, options) => {
    const response = await original(path, options);
    if (path.startsWith('/v1/ciBuildRuns/run?')) {
      response.data.relationships.sourceBranchOrTag = relation('older-tag', 'scmGitReferences');
    }
    return response;
  };
  await assert.rejects(release({ ...input, resumeRunId: 'run' }, s.options), /existing release tag/);
  assert.deepEqual(s.writes, []);
  s.asc.request = original;
  assert.equal((await release(input, s.options)).state, 'testflight_available');
  assert.deepEqual(s.writes, ['tag', 'start']);
});

test('a superseded candidate does not reserve a tag or start a Cloud build', async () => {
  const s = scenario({ head: 'b'.repeat(40) });
  const result = await release(input, s.options);
  assert.deepEqual(s.writes, []);
  assert.equal(result.state, 'superseded');
  assert.deepEqual(s.outputs, [{ release_state: 'superseded' }]);
});

test('branch advancement during tag discovery retains its reservation without starting a build', async () => {
  const s = scenario();
  const original = s.asc.collection;
  s.asc.collection = async path => {
    if (path.includes('/gitReferences')) s.branch.commit.sha = 'b'.repeat(40);
    return original(path);
  };
  const result = await release(input, s.options);
  assert.deepEqual(s.writes, ['tag']);
  assert.equal(result.state, 'superseded');
  assert.equal(s.outputs.at(-1).release_state, 'superseded');
  const retained = await s.gh.request(`/repos/${input.repository}/git/ref/tags/${tag}`);
  assert.equal(retained.object.sha, sha);
});

test('branch protection is rechecked after discovery before any Cloud start', async () => {
  const s = scenario();
  const original = s.asc.collection;
  s.asc.collection = async path => {
    if (path.includes('/gitReferences')) s.branch.protected = false;
    return original(path);
  };
  await assert.rejects(release(input, s.options), /protected/);
  assert.deepEqual(s.writes, ['tag']);
});

for (const resumeRunId of [undefined, 'run']) {
  test(`an existing older Cloud run remains monitorable after branch advancement (${resumeRunId ? 'explicit run' : 'tag lookup'})`, async () => {
    const s = scenario({ existing: true, head: 'b'.repeat(40) });
    const result = await release({ ...input, resumeRunId }, s.options);
    assert.deepEqual(s.writes, []);
    assert.equal(result.state, 'testflight_available');
    assert.equal(result.runId, 'run');
    assert.equal(s.outputs.at(-1).release_state, 'testflight_available');
  });
}

test('existing reservation with no visible run fails closed rather than duplicate dispatch', async () => {
  const s = scenario({ existing: true, existingRun: false });
  await assert.rejects(release(input, s.options), /reservation|reconcil/i);
  assert.deepEqual(s.writes, []);
});

test('ambiguous start never posts twice, even if no run can yet be found', async () => {
  const s = scenario({ startError: new Error('network lost') });
  await assert.rejects(release(input, s.options), /may have|ambiguous/i);
  assert.deepEqual(s.writes, ['tag', 'start']);
});

test('run ID is emitted before source-commit mismatch fails verification', async () => {
  const s = scenario({ runChange: { sourceCommit: { commitSha: 'b'.repeat(40) } } });
  await assert.rejects(release(input, s.options), /commit/);
  assert.ok(s.outputs.some(x => x.build_run_id === 'run'));
  assert.ok(!s.outputs.some(x => x.release_state === 'testflight_available'));
});

test('processed but unassigned build does not claim TestFlight delivery', async () => {
  const s = scenario({ beta: 'READY_FOR_BETA_TESTING' });
  await assert.rejects(release(input, s.options), /internal|TestFlight/i);
  assert.ok(!s.outputs.some(x => x.release_state === 'testflight_available'));
});

test('ambiguous start recovers the one accepted run without another POST', async () => {
  const s = scenario({ startError: new Error('connection lost') });
  const original = s.asc.collection;
  let lists = 0;
  s.asc.collection = async path => path.includes('/buildRuns?') && ++lists > 1 ? [run()] : original(path);
  assert.equal((await release(input, s.options)).state, 'testflight_available');
  assert.deepEqual(s.writes, ['tag', 'start']);
});

test('refused start retains its reservation and never retries', async () => {
  const s = scenario({ startError: Object.assign(new Error('forbidden'), { status: 403 }) });
  await assert.rejects(release(input, s.options), /refused.*403/);
  assert.deepEqual(s.writes, ['tag', 'start']);
});

test('a beta build in testing but absent from the configured group is not delivered', async () => {
  const s = scenario();
  const original = s.asc.collection;
  s.asc.collection = async path => path.includes('/betaGroups/') ? [] : original(path);
  await assert.rejects(release(input, s.options), /internal TestFlight availability/);
  assert.ok(!s.outputs.some(x => x.release_state === 'testflight_available'));
});

test('source tag mutation between reservation and dispatch prevents the POST', async () => {
  const s = scenario();
  const original = s.gh.request;
  s.gh.request = async (path, options) => {
    const response = await original(path, options);
    if (path.includes('/git/ref/')) response.object.sha = 'b'.repeat(40);
    return response;
  };
  await assert.rejects(release(input, s.options), /does not match/);
  assert.deepEqual(s.writes, ['tag']);
});

test('wrong internal group fails before creating any remote reference', async () => {
  const s = scenario();
  const original = s.asc.request;
  s.asc.request = async (path, options) => path.includes('/betaGroups/') ? { data: { id: 'group', attributes: { isInternalGroup: false } } } : original(path, options);
  await assert.rejects(release(input, s.options), /internal group/);
  assert.deepEqual(s.writes, []);
});

test('explicit resume run must belong to this workflow and exact tag', async () => {
  const s = scenario({ existing: true });
  const original = s.asc.request;
  s.asc.request = async (path, options) => {
    const response = await original(path, options);
    if (path.startsWith('/v1/ciBuildRuns/run?')) response.data.relationships.sourceBranchOrTag = relation('wrong-tag', 'scmGitReferences');
    return response;
  };
  await assert.rejects(release({ ...input, resumeRunId: 'run' }, s.options), /workflow or tag/);
  assert.deepEqual(s.writes, []);
});

test('duplicate existing runs are reported rather than choosing a success', async () => {
  const s = scenario({ existing: true });
  const original = s.asc.collection;
  s.asc.collection = async path => path.includes('/buildRuns?') ? [run(), { ...run(), id: 'other' }] : original(path);
  await assert.rejects(release(input, s.options), /Multiple Cloud runs/);
  assert.deepEqual(s.writes, []);
});

test('the final build number comes from the delivered binary and refreshed Cloud counter', async () => {
  const s = scenario();
  const original = s.asc.request;
  s.asc.request = async (path, options) => {
    const response = await original(path, options);
    if (options?.method === 'POST') delete response.data.attributes.number;
    return response;
  };
  await release(input, s.options);
  assert.ok(s.outputs.some(x => x.cloud_build_number === 4));
  assert.equal(s.outputs.at(-1).build_number, '4');
});

test('different uploaded and Cloud build numbers fail without claiming availability', async () => {
  const s = scenario();
  const original = s.asc.collection;
  s.asc.collection = async path => path.includes('/builds?filter') ? [{ ...build, attributes: { ...build.attributes, version: '999' } }] : original(path);
  await assert.rejects(release(input, s.options), /CFBundleVersion/);
  assert.ok(!s.outputs.some(x => x.release_state === 'testflight_available'));
});

test('a contradictory initial POST commit is not hidden by a later matching GET', async () => {
  const s = scenario();
  const original = s.asc.request;
  s.asc.request = async (path, options) => {
    const response = await original(path, options);
    if (options?.method === 'POST') response.data.attributes.sourceCommit.commitSha = 'b'.repeat(40);
    return response;
  };
  await assert.rejects(release(input, s.options), /Initial.*commit/);
  assert.ok(s.outputs.some(x => x.build_run_id === 'run'));
});

test('unknown flags, duplicated flags and missing values cannot alter the release contract', () => {
  assert.deepEqual(parseArgs(['--branch', 'next', '--sha', sha]), { branch: 'next', sha });
  for (const args of [['--force', 'true'], ['--branch'], ['--branch', 'main', '--branch', 'next']]) {
    assert.throws(() => parseArgs(args), /Usage/);
  }
});

test('permanent GET failures do not retry and never expose upstream bodies', async () => {
  let calls = 0;
  const api = createApi({ origin: 'https://api.github.com', token: () => 'private-token', fetchImpl: async () => { calls++; return new Response('private-token echoed by upstream', { status: 401 }); } });
  await assert.rejects(api.request('/a'), error => !error.message.includes('private-token') && error.status === 401);
  assert.equal(calls, 1);
});
