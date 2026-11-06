import test from 'node:test';
import assert from 'node:assert/strict';

import { assertCloudOrdering, recordReservationState, reservationStatusContext, parseControllerRunUrl } from './ios-cloud-order.mjs';
import { createApi } from './ios-cloud-release.mjs';
import { attachReservationEvidence } from './ios-cloud-evidence.mjs';
const repository = 'ashproto/Resume-Designer';
const sha = 'a'.repeat(40);
const otherSha = 'b'.repeat(40);
const tag = `ios-testflight/next/${sha}`;
const ownTag = `ios-testflight/pr/8/99/${otherSha}`;
const context = 'ios-cloud-reservation/4bd8cdc696f5752cc9c27c2de372b28b0915b9627c5c28fd1af26bd88f60c9e8';
const runUrl = `https://github.com/${repository}/actions/runs/900`;
const relation = id => ({ data: { id } });
const ref = (name = tag, commit = sha) => ({ ref: `refs/tags/${name}`, object: { type: 'commit', sha: commit } });
const appleRef = (name = tag, id = 'tag-id') => ({ id, type: 'scmGitReferences', attributes: { name, canonicalName: `refs/tags/${name}`, kind: 'TAG', isDeleted: false } });
const run = (attributes = {}, workflow = 'production', source = 'tag-id', id = 'cloud-run') => ({ id, type: 'ciBuildRuns', attributes: { sourceCommit: { commitSha: sha }, executionProgress: 'COMPLETE', completionStatus: 'SUCCEEDED', number: 4, ...attributes }, relationships: { workflow: relation(workflow), sourceBranchOrTag: relation(source) } });
const build = (attributes = {}, id = 'build-id') => ({ id, type: 'builds', attributes: { version: '4', processingState: 'VALID', expired: false, ...attributes } });
const identity = { id: 1163653093, full_name: repository };
const controllerRun = () => ({ id: 900, html_url: runUrl, head_branch: 'main', head_sha: 'c'.repeat(40), repository: identity, head_repository: identity, event: 'workflow_dispatch', workflow_id: 12, path: '.github/workflows/ios-testflight.yml', status: 'completed', conclusion: 'success', created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:05:00Z' });
const status = (state = 'not-started') => ({ id: 100, context, description: `ios-cloud:${state}`, state: ['reserved', 'post-attempted'].includes(state) ? 'pending' : 'success', target_url: runUrl, creator: { id: 41898282, login: 'github-actions[bot]', type: 'Bot' }, created_at: '2026-11-06T00:04:00Z' });

function fixture() {
  const data = { refs: [], appleRefs: [appleRef(), appleRef(ownTag, 'own-tag-id')], runs: { production: [], preview: [] }, builds: [], runBuilds: {}, statuses: [], controller: controllerRun(), workflowPath: '.github/workflows/ios-testflight.yml', app: '123', post: [], requests: [], beta: 'IN_BETA_TESTING' };
  const gh = { verifyReservationEvidence: async evidence => { data.evidence = evidence; return data.evidenceTrusted !== false
    && (evidence.state !== 'delivered' || data.deliveredTrusted === true); }, request: async (path, options = {}) => {
    data.requests.push(['gh', path, options]);
    if (options.method === 'POST') { data.post.push({ path, body: options.body }); return { id: 101, ...options.body }; }
    const url = new URL(path, 'https://api.github.com');
    if (url.pathname.includes('/git/matching-refs/')) {
      return data.refs;
    }
    if (url.pathname.endsWith(`/commits/${sha}/statuses`) || url.pathname.endsWith(`/commits/${otherSha}/statuses`)) {
      const page = Number(url.searchParams.get('page'));
      return data.statuses.slice((page - 1) * 100, page * 100);
    }
    if (url.pathname.includes('/git/ref/tags/')) return ref(url.pathname.split('/git/ref/tags/')[1], url.pathname.endsWith(otherSha) ? otherSha : sha);
    if (url.pathname.endsWith('/actions/runs/900')) return data.controller;
    if (url.pathname.endsWith('/actions/workflows/12')) return { id: 12, path: data.workflowPath, state: 'active' };
    throw new Error(`Unexpected GH request ${path}`);
  } };
  const asc = {
    request: async path => {
      data.requests.push(['asc', path]);
      const url = new URL(path, 'https://api.appstoreconnect.apple.com');
      const match = url.pathname.match(/^\/v1\/ciWorkflows\/(production|preview)$/);
      if (match) return { data: { id: match[1], relationships: { repository: relation('scm-repo'), product: relation('product') } } };
      if (url.pathname === '/v1/scmRepositories/scm-repo') return { data: { id: 'scm-repo', attributes: { ownerName: 'ashproto', repositoryName: 'Resume-Designer', httpCloneUrl: `https://github.com/${repository}.git` } } };
      if (url.pathname === '/v1/ciProducts/product/app' || /\/builds\/[^/]+\/app$/.test(url.pathname)) return { data: { id: url.pathname.includes('/builds/') ? data.buildApp ?? data.app : data.app, attributes: { bundleId: 'com.onpaper.app' } } };
      if (/^\/v1\/builds\/[^/]+$/.test(url.pathname)) return { data: data.specificBuild ?? build() };
      if (/\/builds\/[^/]+\/preReleaseVersion$/.test(url.pathname)) return { data: { id: 'version', attributes: { platform: data.platform ?? 'IOS' } } };
      if (/\/builds\/[^/]+\/buildBetaDetail$/.test(url.pathname)) return { data: { attributes: { internalBuildState: data.beta } } };
      throw new Error(`Unexpected ASC request ${path}`);
    },
    collection: async path => {
      data.requests.push(['collection', path]);
      const url = new URL(path, 'https://api.appstoreconnect.apple.com');
      if (url.pathname === '/v1/scmRepositories/scm-repo/gitReferences') return data.appleRefs;
      const match = url.pathname.match(/^\/v1\/ciWorkflows\/([^/]+)\/buildRuns$/);
      if (match) return data.runs[match[1]];
      const uploads = url.pathname.match(/^\/v1\/ciBuildRuns\/([^/]+)\/builds$/);
      if (uploads) return data.runBuilds[uploads[1]] || [];
      if (url.pathname === '/v1/builds') return data.builds;
      throw new Error(`Unexpected ASC collection ${path}`);
    },
  };
  const check = extra => assertCloudOrdering({ gh, asc, repository, appId: '123', workflowIds: ['production', 'preview'], ...extra });
  const record = (state, extra) => recordReservationState({ gh, repository, sha, tag, state, runUrl, ...extra });
  return { data, gh, asc, check, record };
}

test('idle app can start without making any API mutations', async () => {
  const f = fixture();
  await f.check();
  assert.deepEqual(f.data.post, []);
  assert.ok(f.data.requests.some(([kind, path]) => kind === 'collection' && path.includes('/preview/buildRuns')));
});

test('unknown reservation with no visible run stays blocked even with no uploads', async () => {
  const f = fixture(); f.data.refs = [ref()];
  await assert.rejects(f.check(), /unresolved.*reservation|reservation.*unresolved/i);
});

test('request binding refs do not reserve a Cloud upload', async () => {
  const f = fixture(); f.data.refs = [ref(`ios-testflight/request/pr-8/comment-99`)];
  await f.check();
});

test('every managed lane reservation is checked beyond the first 100 matching refs', async () => {
  for (const oldTag of [`ios-testflight/main/${sha}`, `ios-testflight/next/${sha}`, `ios-testflight/pr/8/12/${sha}`]) {
    const f = fixture(); f.data.refs = Array.from({ length: 100 }, (_, index) => ref(`ios-testflight/request/pr-8/comment-${index + 1}`));
    f.data.refs.push(ref(oldTag));
    await assert.rejects(f.check(), /unresolved.*reservation|reservation.*unresolved/i);
  }
});

for (const progress of ['PENDING', 'RUNNING']) test(`${progress} Cloud work blocks across both workflows even without a GitHub reservation`, async () => {
  const f = fixture(); f.data.runs.preview = [run({ executionProgress: progress }, 'preview')];
  await assert.rejects(f.check(), /unfinished|pending|running/i);
});

test('completed Cloud success remains unresolved until its upload appears', async () => {
  const f = fixture(); f.data.refs = [ref()]; f.data.runs.production = [run()];
  await assert.rejects(f.check(), /upload|build/i);
});

test('completed Cloud success cannot pass while Apple processes its upload', async () => {
  const f = fixture(); f.data.refs = [ref()]; f.data.runs.production = [run()];
  f.data.runBuilds['cloud-run'] = [build({ processingState: 'PROCESSING' })];
  await assert.rejects(f.check(), /processing|unfinished/i);
});

test('historical verified terminal Cloud run and uploaded build need no journal', async () => {
  const f = fixture(); f.data.refs = [ref()]; f.data.runs.production = [run()]; f.data.runBuilds['cloud-run'] = [build()];
  f.data.builds = [build()];
  await f.check();
});

test('failed and cancelled terminal Cloud runs with no uploads close historical reservations', async () => {
  for (const completionStatus of ['FAILED', 'CANCELED']) {
    const f = fixture(); f.data.refs = [ref()]; f.data.runs.production = [run({ completionStatus })];
    await f.check();
  }
});

test('failure does not excuse an unfinished upload', async () => {
  const f = fixture(); f.data.runs.production = [run({ completionStatus: 'FAILED' })];
  f.data.runBuilds['cloud-run'] = [build({ processingState: 'PROCESSING' })];
  await assert.rejects(f.check(), /processing|unfinished/i);
});

test('app uploads missed by workflow lists are still checked', async () => {
  const f = fixture(); f.data.builds = [build({ processingState: 'PROCESSING' })];
  await assert.rejects(f.check(), /processing|unfinished/i);
});

test('VALID uploads awaiting internal Apple processing still block', async () => {
  const f = fixture(); f.data.builds = [build()]; f.data.beta = 'IN_EXPORT_COMPLIANCE_REVIEW';
  await assert.rejects(f.check(), /processing|unfinished|unresolved/i);
});

test('wrong app, workflow, tag, SHA and upload number never clear a reservation', async () => {
  const cases = [
    f => { f.data.app = 'other-app'; },
    f => { f.data.runs.production[0].relationships.workflow = relation('unmanaged'); },
    f => { f.data.appleRefs[0].attributes.canonicalName = 'refs/heads/not-the-tag'; },
    f => { f.data.runs.production[0].attributes.sourceCommit.commitSha = otherSha; },
    f => { f.data.runBuilds['cloud-run'] = [build({ version: '3' })]; },
    f => { f.data.refs[0].object.type = 'tag'; },
    f => { f.data.refs[0].object.sha = otherSha; },
  ];
  for (const mutate of cases) {
    const f = fixture(); f.data.refs = [ref()]; f.data.runs.production = [run()]; f.data.runBuilds['cloud-run'] = [build()]; mutate(f);
    await assert.rejects(f.check());
  }
});

test('duplicate Cloud runs for a reservation fail closed', async () => {
  const f = fixture(); f.data.refs = [ref()]; f.data.runs.production = [run(), run({}, 'production', 'tag-id', 'duplicate')];
  f.data.runBuilds['cloud-run'] = [build()]; f.data.runBuilds.duplicate = [build()];
  await assert.rejects(f.check(), /multiple|duplicate|ambiguous/i);
});

test('own exact tag can recover without a run ID but never clears other reservations', async () => {
  const f = fixture(); f.data.refs = [ref(ownTag, otherSha)];
  await f.check({ currentTag: ownTag });
  f.data.refs.push(ref());
  await assert.rejects(f.check({ currentTag: ownTag }), /unresolved.*reservation|reservation.*unresolved/i);
  assert.deepEqual(f.data.post, []);
});

test('own active run is excluded while other Cloud work still blocks', async () => {
  const f = fixture(); f.data.refs = [ref(ownTag, otherSha)];
  f.data.runs.preview = [run({ executionProgress: 'RUNNING', sourceCommit: { commitSha: otherSha } }, 'preview', 'own-tag-id')];
  await f.check({ currentTag: ownTag });
  f.data.runs.production.push(run({ executionProgress: 'PENDING' }));
  await assert.rejects(f.check({ currentTag: ownTag }), /unfinished|pending|running/i);
});

for (const state of ['not-started', 'rejected']) test(`trusted ${state} journal closes an unused reservation`, async () => {
  const f = fixture(); f.data.refs = [ref()]; f.data.statuses = [status(state)];
  await f.check();
});

for (const state of ['not-started', 'rejected']) {
  for (const laterMarker of [false, true]) test(`real evidence adapter ${laterMarker ? 'blocks a later POST marker after' : 'authenticates'} ${state} ordering closure`, async () => {
    const f = fixture(); f.data.refs = [ref()]; f.data.statuses = [status(state)];
    const request = f.gh.request;
    f.gh.request = async (path, options) => path === `/repos/${repository}/actions/runs/900/jobs?filter=all&per_page=100&page=1`
      ? { jobs: [{ id: 901, name: 'Release iOS TestFlight', status: 'completed', run_url: `https://api.github.com/repos/${repository}/actions/runs/900` }] }
      : request(path, options);
    const marker = value => `2026-11-06T00:04:00Z OP_IOS_RESERVATION_STATE=${JSON.stringify({ version: 1, repository, tag, sha, state: value })}`;
    attachReservationEvidence(f.gh, { token: 'test-token', exec: (command, args) => {
      assert.equal(command, 'gh');
      assert.deepEqual(args, ['api', '--allow-escape-sequences', `repos/${repository}/actions/jobs/901/logs`]);
      return [marker(state), ...(laterMarker ? [marker('post-attempted')] : [])].join('\n');
    } });
    if (laterMarker) await assert.rejects(f.check(), /authenticated controller log evidence/);
    else await f.check();
    assert.deepEqual(f.data.post, []);
  });
}

for (const state of ['reserved', 'post-attempted', 'delivered']) test(`${state} journal is not evidence that a missing Cloud run never started`, async () => {
  const f = fixture(); f.data.refs = [ref()]; f.data.statuses = [status(state)];
  await assert.rejects(f.check(), /unresolved.*reservation|reservation.*unresolved/i);
});

test('journal lookup paginates statuses rather than treating page one absence as proof', async () => {
  const f = fixture(); f.data.refs = [ref()];
  f.data.statuses = [...Array.from({ length: 100 }, (_, index) => ({ ...status(), context: `unrelated-${index}` })), status()];
  await f.check();
});

test('forged or unrelated journal provenance cannot clear an unused reservation', async () => {
  const cases = [
    f => { f.data.statuses[0].creator = { login: 'ashproto', id: 35086581, type: 'User' }; },
    f => { f.data.statuses[0].creator.id = 7; },
    f => { f.data.statuses[0].target_url = 'https://github.com/evil/repo/actions/runs/900'; },
    f => { f.data.controller.head_branch = 'next'; },
    f => { f.data.controller.repository = { ...identity, id: 1 }; },
    f => { f.data.controller.head_repository = { ...identity, full_name: 'fork/Resume-Designer' }; },
    f => { f.data.controller.event = 'pull_request_target'; },
    f => { f.data.controller.path = '.github/workflows/ci.yml'; },
    f => { f.data.workflowPath = '.github/workflows/ci.yml'; },
    f => { f.data.statuses[0].state = 'pending'; },
    f => { f.data.statuses[0].created_at = '2026-11-07T00:00:00Z'; },
    f => { f.data.controller.status = 'in_progress'; },
  ];
  for (const mutate of cases) {
    const f = fixture(); f.data.refs = [ref()]; f.data.statuses = [status()]; mutate(f);
    await assert.rejects(f.check());
  }
});

test('latest reserved state prevents an older no-start record from clearing uncertainty', async () => {
  const f = fixture(); f.data.refs = [ref()];
  f.data.statuses = [{ ...status('post-attempted'), id: 102 }, status()];
  await assert.rejects(f.check(), /unresolved.*reservation|reservation.*unresolved/i);
});

test('journal write uses a stable per-tag SHA256 context, exact source and bounded payload', async () => {
  const f = fixture();
  assert.equal(reservationStatusContext(tag), context);
  for (const state of ['reserved', 'post-attempted', 'not-started', 'rejected', 'delivered']) await f.record(state);
  assert.equal(f.data.post.length, 5);
  for (const [index, state] of ['reserved', 'post-attempted', 'not-started', 'rejected', 'delivered'].entries()) {
    assert.deepEqual(f.data.post[index], { path: `/repos/${repository}/statuses/${sha}`, body: { context, description: `ios-cloud:${state}`, state: index < 2 ? 'pending' : 'success', target_url: runUrl } });
  }
});

test('invalid journal input or untrusted controller refuses before any mutation', async () => {
  for (const bad of [{ state: 'force-clear' }, { tag: `ios-testflight/request/pr-8/comment-99` }, { sha: otherSha }, { runUrl: `${runUrl}?other=1` }, { repository: 'fork/Resume-Designer' }]) {
    const f = fixture(); await assert.rejects(f.record('not-started', bad)); assert.deepEqual(f.data.post, []);
  }
  const f = fixture(); f.data.controller.head_branch = 'feature';
  await assert.rejects(f.record('not-started')); assert.deepEqual(f.data.post, []);
});

test('malformed and incomplete collections fail closed', async () => {
  const f = fixture(); f.data.runs.preview = undefined;
  await assert.rejects(f.check());
  const other = fixture(); other.data.builds = [build({ processingState: 'UNKNOWN' })];
  await assert.rejects(other.check());
});


test('bot statuses without authenticated controller log evidence cannot close a reservation', async () => {
  for (const missingAdapter of [false, true]) {
    const f = fixture(); f.data.refs = [ref()]; f.data.statuses = [status()];
    if (missingAdapter) delete f.gh.verifyReservationEvidence;
    else f.data.evidenceTrusted = false;
    await assert.rejects(f.check(), /evidence|unresolved/i);
  }
});

test('terminal closure evidence is bound to exact reservation, source and trusted Actions run', async () => {
  const f = fixture(); f.data.refs = [ref()]; f.data.statuses = [status('rejected')];
  await f.check();
  assert.deepEqual(f.data.evidence, { repository, tag, sha, state: 'rejected', runId: '900', runUrl });
  const evidence = await f.record('rejected');
  assert.deepEqual(evidence, { version: 1, repository, tag, sha, state: 'rejected' });
});


test('unprefixed journal descriptions are not accepted as bounded controller records', async () => {
  const f = fixture(); f.data.refs = [ref()]; f.data.statuses = [{ ...status(), description: 'not-started' }];
  await assert.rejects(f.check(), /unresolved|journal/i);
});

test('run URL parser rejects URLs whose target can be changed or interpreted ambiguously', () => {
  assert.equal(parseControllerRunUrl(repository, runUrl), '900');
  for (const value of [`${runUrl}/`, `${runUrl}#x`, `${runUrl}?x=1`, runUrl.replace('https:', 'http:'), runUrl.replace('github.com', 'github.com.evil.test'), runUrl.replace('/900', '/0900')]) {
    assert.throws(() => parseControllerRunUrl(repository, value));
  }
});

test('second Apple pages expose active runs and unfinished uploads', async () => {
  for (const collection of ['/v1/ciWorkflows/preview/buildRuns', '/v1/builds', '/v1/ciBuildRuns/cloud-run/builds']) {
    const f = fixture();
    if (collection.includes('/ciBuildRuns/')) f.data.runs.production = [run()];
    const seen = [];
    const paginated = createApi({ origin: 'https://api.appstoreconnect.apple.com', token: () => 'test-only', fetchImpl: async value => {
      const url = new URL(value); seen.push(url.href);
      let response;
      const second = url.searchParams.get('cursor') === 'older';
      if (url.pathname === collection) {
        response = second ? { data: [collection.includes('/buildRuns') ? run({ executionProgress: 'PENDING' }, 'preview') : build({ processingState: 'PROCESSING' })] } : { data: [], links: { next: `${url.origin}${url.pathname}?cursor=older` } };
      } else if (/\/(?:gitReferences|buildRuns|builds)$/.test(url.pathname)) response = { data: await f.asc.collection(url.pathname + url.search) };
      else response = await f.asc.request(url.pathname + url.search);
      return new Response(JSON.stringify(response));
    } });
    await assert.rejects(assertCloudOrdering({ gh: f.gh, asc: paginated, repository, appId: '123', workflowIds: ['production', 'preview'] }), /unfinished|pending|processing/i);
    assert.ok(seen.some(value => new URL(value).searchParams.get('cursor') === 'older'));
  }
});

test('missing or duplicate workflow configuration refuses ordering', async () => {
  for (const workflowIds of [[], ['production'], ['production', 'production'], ['production', undefined]]) {
    await assert.rejects(fixture().check({ workflowIds }));
  }
});

test('multiple live Apple reference identities for a run tag remain ambiguous', async () => {
  const f = fixture(); f.data.refs = [ref()]; f.data.runs.production = [run()]; f.data.runBuilds['cloud-run'] = [build()];
  f.data.appleRefs.push(appleRef(tag, 'other-tag-id'));
  await assert.rejects(f.check(), /ambiguous|multiple|duplicate/i);
});


test('matching refs is a complete unpaginated array even when it contains over 100 refs', async () => {
  const f = fixture();
  f.data.refs = Array.from({ length: 101 }, (_, index) => ref(`ios-testflight/request/pr-8/comment-${index + 1}`));
  await f.check();
  const reads = f.data.requests.filter(([kind, path]) => kind === 'gh' && path.includes('/git/matching-refs/'));
  assert.equal(reads.length, 1);
  assert.equal(reads[0][1], `/repos/${repository}/git/matching-refs/tags/ios-testflight/`);
});

function historicalBranch() {
  const f = fixture();
  f.data.appleRefs.push({ id: 'branch-id', type: 'scmGitReferences', attributes: { name: 'legacy/release', canonicalName: 'refs/heads/legacy/release', kind: 'BRANCH', isDeleted: false } });
  f.data.runs.production = [run({}, 'production', 'branch-id')];
  f.data.runBuilds['cloud-run'] = [build()];
  return f;
}

test('completed historical branch runs reconcile verified uploads without creating reservations', async () => {
  const f = historicalBranch(); await f.check();
  assert.deepEqual(f.data.post, []);
});

test('failed cancelled and skipped historical branch runs reconcile terminal upload outcomes', async () => {
  for (const completionStatus of ['FAILED', 'CANCELED', 'CANCELLED', 'ERRORED', 'SKIPPED']) {
    const f = historicalBranch(); f.data.runs.production[0].attributes.completionStatus = completionStatus;
    f.data.runBuilds['cloud-run'] = []; await f.check();
  }
});

test('active unknown or unverifiable historical branch runs still block a new start', async () => {
  const cases = [
    f => { f.data.runs.production[0].attributes.executionProgress = 'PENDING'; },
    f => { f.data.runs.production[0].attributes.executionProgress = 'RUNNING'; },
    f => { f.data.runs.production[0].attributes.completionStatus = 'UNKNOWN'; },
    f => { f.data.runs.production[0].attributes.sourceCommit.commitSha = 'abc'; },
    f => { f.data.runs.production[0].attributes.isPullRequestBuild = true; },
    f => { f.data.appleRefs.at(-1).attributes.canonicalName = 'refs/tags/legacy/release'; },
    f => { f.data.appleRefs.at(-1).attributes.name = '../untrusted'; f.data.appleRefs.at(-1).attributes.canonicalName = 'refs/heads/../untrusted'; },
    f => { f.data.appleRefs.at(-1).attributes.isDeleted = true; },
    f => { f.data.appleRefs.pop(); },
    f => { f.data.runBuilds['cloud-run'] = [build({ processingState: 'PROCESSING' })]; },
    f => { f.data.runBuilds['cloud-run'] = [build({ version: '3' })]; },
    f => { f.data.runBuilds['cloud-run'] = []; },
  ];
  for (const mutate of cases) { const f = historicalBranch(); mutate(f); await assert.rejects(f.check()); }
});

test('historical branch reconciliation never closes a managed reservation with no run', async () => {
  const f = historicalBranch(); f.data.refs = [ref()];
  await assert.rejects(f.check(), /unresolved.*reservation|reservation.*unresolved/i);
});

test('deleted managed-tag history cannot use the historical branch exception', async () => {
  const f = fixture(); f.data.runs.production = [run()]; f.data.runBuilds['cloud-run'] = [build()];
  f.data.appleRefs[0].attributes.isDeleted = true; await assert.rejects(f.check());
});

test('forStart refuses an already-visible current tag run while recovery may monitor it', async () => {
  const f = fixture(); f.data.refs = [ref(ownTag, otherSha)];
  f.data.runs.preview = [run({ executionProgress: 'RUNNING', sourceCommit: { commitSha: otherSha } }, 'preview', 'own-tag-id')];
  await assert.rejects(f.check({ currentTag: ownTag, forStart: true }), {
    code: 'CLOUD_RUN_ALREADY_EXISTS', tag: ownTag,
  });
  await f.check({ currentTag: ownTag });
  assert.deepEqual(f.data.post, []);
});


test('authenticated legacy receipt can close only a reservation with no structured journal', async () => {
  const f = fixture(); f.data.refs = [ref()];
  let calls = 0;
  f.gh.verifyLegacyReservationEvidence = async expected => {
    calls++;
    assert.deepEqual(expected, { repository, tag, sha });
    assert.ok(f.data.requests.some(([kind, path]) => kind === 'collection' && path.includes('/v1/builds?')));
    return true;
  };
  await f.check();
  assert.equal(calls, 1);
  assert.deepEqual(f.data.post, []);
});

test('legacy receipt never overrides any existing structured journal or active Cloud work', async () => {
  for (const state of ['reserved', 'post-attempted', 'delivered', 'unknown']) {
    const f = fixture(); f.data.refs = [ref()]; f.data.statuses = [status(state)];
    f.gh.verifyLegacyReservationEvidence = async () => { assert.fail('must not fall back past a structured journal'); };
    await assert.rejects(f.check(), /unresolved.*reservation|reservation.*unresolved/i);
  }
  const f = fixture(); f.data.refs = [ref()];
  f.data.runs.preview = [run({ executionProgress: 'RUNNING' }, 'preview')];
  f.gh.verifyLegacyReservationEvidence = async () => { assert.fail('Cloud work must be checked first'); };
  await assert.rejects(f.check(), /unfinished/i);
});

test('missing or unauthenticated legacy evidence fails closed', async () => {
  for (const outcome of [false, undefined, 'true']) {
    const f = fixture(); f.data.refs = [ref()];
    f.gh.verifyLegacyReservationEvidence = async () => outcome;
    await assert.rejects(f.check(), /unresolved.*reservation|reservation.*unresolved/i);
  }
});


for (const previewTag of [`ios-testflight/pr/8/12-${sha}`, `ios-testflight/pr/8/12/${sha}`]) {
  test(`ordering retains unresolved reservation protection for ${previewTag}`, async () => {
    const f = fixture(); f.data.refs = [ref(previewTag)];
    await assert.rejects(f.check(), /unresolved.*reservation|reservation.*unresolved/i);
    assert.deepEqual(f.data.post, []);
  });

  test(`ordering reconciles the exact verified Cloud source for ${previewTag}`, async () => {
    const f = fixture(); f.data.refs = [ref(previewTag)]; f.data.appleRefs = [appleRef(previewTag)];
    f.data.runs.preview = [run({}, 'preview')]; f.data.runBuilds['cloud-run'] = [build()]; f.data.builds = [build()];
    await f.check();
    assert.deepEqual(f.data.post, []);
  });

  test(`journal records the actual preview tag identity for ${previewTag}`, async () => {
    const f = fixture();
    await f.record('not-started', { tag: previewTag });
    assert.equal(f.data.post.length, 1);
    assert.equal(f.data.post[0].body.context, reservationStatusContext(previewTag));
    assert.equal(f.data.post[0].path, `/repos/${repository}/statuses/${sha}`);
  });
}

test('current four-segment reservation recovery excludes only that exact reservation', async () => {
  const currentTag = `ios-testflight/pr/8/99-${otherSha}`;
  const f = fixture(); f.data.refs = [ref(currentTag, otherSha)];
  await f.check({ currentTag });
  f.data.refs.push(ref());
  await assert.rejects(f.check({ currentTag }), /unresolved.*reservation|reservation.*unresolved/i);
  assert.deepEqual(f.data.post, []);
});

test('malformed preview reservation formats fail before any ordering I/O', async () => {
  for (const currentTag of [
    `ios-testflight/pr/0/99-${sha}`, `ios-testflight/pr/8/01-${sha}`, `ios-testflight/pr/8/99-${sha.slice(1)}`,
    `ios-testflight/pr/8/99-${sha.toUpperCase()}`, `ios-testflight/pr/8/99/${sha}/extra`,
    `ios-testflight/pr/8/99-${sha}\n`, `ios-testflight/pr/9007199254740992/99-${sha}`,
    `ios-testflight/pr/8/9007199254740992/${sha}`,
  ]) {
    const f = fixture();
    await assert.rejects(f.check({ currentTag }), /reservation/i);
    assert.deepEqual(f.data.requests, []);
  }
});

function retainedDeliveryFixture() {
  const f = fixture(); f.data.refs = [ref()];
  f.data.receipt = { repository, tag, sha, appId: '123', workflowId: 'production', cloudRunId: 'retired-cloud', buildId: 'build-id', buildNumber: 4 };
  f.data.receiptCalls = 0;
  f.gh.verifyLegacyDeliveredEvidence = async expected => {
    f.data.receiptCalls++;
    assert.deepEqual(expected, { repository, tag, sha });
    assert.ok(f.data.requests.some(([kind, path]) => kind === 'collection' && path.startsWith('/v1/builds?')));
    return f.data.receipt;
  };
  return f;
}

test('authenticated legacy delivery receipt reconciles a retained upload after Cloud run removal', async () => {
  const f = retainedDeliveryFixture(); await f.check();
  assert.equal(f.data.receiptCalls, 1);
  for (const path of ['/v1/builds/build-id', '/v1/builds/build-id/app', '/v1/builds/build-id/preReleaseVersion', '/v1/builds/build-id/buildBetaDetail']) {
    assert.ok(f.data.requests.some(([kind, value]) => kind === 'asc' && value === path), path);
  }
  assert.deepEqual(f.data.post, []);
});

test('legacy delivered receipt is bound to configured app workflow source and exact live build', async () => {
  const cases = [
    f => { f.data.receipt.repository = 'fork/repo'; }, f => { f.data.receipt.tag = ownTag; },
    f => { f.data.receipt.sha = otherSha; }, f => { f.data.receipt.appId = 'other'; },
    f => { f.data.receipt.workflowId = 'unmanaged'; }, f => { f.data.receipt.buildNumber = '4'; },
    f => { f.data.receipt.buildNumber = 0; }, f => { f.data.receipt.cloudRunId = '../escape'; },
    f => { f.data.receipt.buildId = '../escape'; }, f => { f.data.specificBuild = build({}, 'other-build'); },
    f => { f.data.specificBuild = build({ version: '5' }); }, f => { f.data.buildApp = 'other-app'; },
    f => { f.data.platform = 'MAC_OS'; }, f => { f.data.specificBuild = build({ processingState: 'PROCESSING' }); },
    f => { f.data.beta = 'IN_EXPORT_COMPLIANCE_REVIEW'; },
  ];
  for (const mutate of cases) { const f = retainedDeliveryFixture(); mutate(f); await assert.rejects(f.check()); assert.deepEqual(f.data.post, []); }
});

test('missing proof or unavailable exact retained upload does not imply a historical delivery', async () => {
  for (const outcome of [undefined, false, {}, { ...retainedDeliveryFixture().data.receipt, buildId: undefined }]) {
    const f = retainedDeliveryFixture(); f.data.receipt = outcome;
    await assert.rejects(f.check());
  }
  const f = retainedDeliveryFixture(), request = f.asc.request;
  f.asc.request = async path => { if (path === '/v1/builds/build-id') throw Object.assign(new Error('Expired Cloud record is not upload proof'), { status: 404 }); return request(path); };
  await assert.rejects(f.check());
});

test('legacy delivery evidence never skips a newer structured state or live Cloud/upload blocker', async () => {
  for (const state of ['reserved', 'post-attempted', 'delivered', 'unknown']) {
    const f = retainedDeliveryFixture(); f.data.statuses = [status(state)];
    await assert.rejects(f.check()); assert.equal(f.data.receiptCalls, 0);
  }
  for (const blocker of ['cloud', 'upload']) {
    const f = retainedDeliveryFixture();
    if (blocker === 'cloud') f.data.runs.preview = [run({ executionProgress: 'RUNNING' }, 'preview')];
    else f.data.builds = [build({ processingState: 'PROCESSING' })];
    await assert.rejects(f.check(), /unfinished|processing/i); assert.equal(f.data.receiptCalls, 0);
  }
});

test('an authenticated delivered structured journal closes a retained reservation after live barriers', async () => {
  const f = retainedDeliveryFixture(); f.data.statuses = [status('delivered')]; f.data.deliveredTrusted = true;
  await f.check();
  assert.equal(f.data.receiptCalls, 0);
  assert.deepEqual(f.data.evidence, { repository, tag, sha, state: 'delivered', runId: '900', runUrl });
  assert.deepEqual(f.data.post, []);
});

test('delivered status alone cannot bypass creator provenance timestamp or authenticated log checks', async () => {
  for (const mutate of [
    f => { f.data.statuses[0].creator.id = 1; }, f => { f.data.controller.head_branch = 'feature'; },
    f => { f.data.statuses[0].created_at = '2026-11-07T00:00:00Z'; }, f => { f.data.evidenceTrusted = false; },
    f => { f.data.statuses.unshift({ ...status('post-attempted'), id: 102 }); },
  ]) {
    const f = retainedDeliveryFixture(); f.data.statuses = [status('delivered')]; f.data.deliveredTrusted = true; mutate(f);
    await assert.rejects(f.check()); assert.equal(f.data.receiptCalls, 0);
  }
});

test('real authenticated delivered evidence reconciles retained history despite unrelated feedback failure', async () => {
  const f = fixture(); f.data.refs = [ref()]; f.data.statuses = [status('delivered')];
  f.data.controller.conclusion = 'failure'; f.data.controller.run_attempt = 1;
  const request = f.gh.request;
  f.gh.request = async (path, options) => path.includes('/actions/runs/900/jobs?')
    ? { jobs: [{ id: 901, name: 'Release iOS TestFlight', status: 'completed', conclusion: 'success', run_attempt: 1,
      run_id: 900, head_sha: f.data.controller.head_sha,
      run_url: `https://api.github.com/repos/${repository}/actions/runs/900` }] } : request(path, options);
  attachReservationEvidence(f.gh, { token: 'test-token', exec: (_command, args) => {
    assert.equal(args.at(-1), `repos/${repository}/actions/jobs/901/logs`);
    assert.ok(f.data.requests.some(([kind, path]) => kind === 'collection' && path.startsWith('/v1/builds?')));
    return `OP_IOS_RESERVATION_STATE=${JSON.stringify({ version: 1, repository, tag, sha, state: 'delivered' })}`;
  } });
  f.gh.verifyLegacyDeliveredEvidence = async () => assert.fail('structured journal cannot fall back to legacy evidence');
  await f.check(); assert.deepEqual(f.data.post, []);
});

test('real retained-delivery closure fails for wrong final source or a rerun begun during log fetch', async () => {
  for (const outcome of ['wrong-sha', 'rerun']) {
    const f = fixture(); f.data.refs = [ref()]; f.data.statuses = [status('delivered')]; f.data.controller.run_attempt = 1;
    const request = f.gh.request;
    f.gh.request = async (path, options) => path.includes('/actions/runs/900/jobs?')
      ? { jobs: [{ id: 901, name: 'Release iOS TestFlight', status: 'completed', conclusion: 'success', run_attempt: 1,
        run_id: 900, head_sha: f.data.controller.head_sha,
        run_url: `https://api.github.com/repos/${repository}/actions/runs/900` }] } : request(path, options);
    attachReservationEvidence(f.gh, { token: 'test-token', exec: () => {
      if (outcome === 'rerun') { f.data.controller.run_attempt = 2; f.data.controller.status = 'in_progress'; }
      const marker = source => `OP_IOS_RESERVATION_STATE=${JSON.stringify({ version: 1, repository, tag, sha: source, state: 'delivered' })}`;
      return marker(sha) + (outcome === 'wrong-sha' ? `\n${marker(otherSha)}` : '');
    } });
    await assert.rejects(f.check(), /authenticated controller log evidence/); assert.deepEqual(f.data.post, []);
  }
});
