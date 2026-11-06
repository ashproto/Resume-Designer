import test from 'node:test';
import assert from 'node:assert/strict';
import { authorizePreview, bindPreviewRequest, recheckPreview } from './ios-pr-request.mjs';
import * as requestPolicy from './ios-pr-request.mjs';

const R = '/repos/ashproto/Resume-Designer';
const SHA = 'a'.repeat(40), NEXT = 'b'.repeat(40), MERGE = 'c'.repeat(40);
const REQUEST = 'ios-testflight/request/pr-123/comment-456';
const timestamp = '2026-11-06T00:00:00Z';
const owner = () => ({ id: 35086581, login: 'ashproto', type: 'User' });
const repo = () => ({ id: 1163653093, full_name: 'ashproto/Resume-Designer', default_branch: 'main', owner: owner() });

// The fake replaces only the external GitHub API. Every route is explicit so
// provenance checks cannot accidentally receive a permissive default response.
function fixture() {
  const comment = { id: 456, body: '/testflight-dev', user: owner(), created_at: timestamp, updated_at: timestamp,
    issue_url: 'https://api.github.com/repos/ashproto/Resume-Designer/issues/123' };
  const pr = { number: 123, state: 'open', draft: true, merge_commit_sha: MERGE,
    base: { ref: 'next', sha: NEXT, repo: repo() }, head: { ref: 'feature', sha: SHA, repo: repo() } };
  const run = { id: 900, workflow_id: 800, path: '.github/workflows/ci.yml', event: 'pull_request',
    status: 'completed', conclusion: 'success', head_sha: SHA, head_repository: repo(),
    pull_requests: [{ number: 123, head: { sha: SHA, repo: repo() }, base: { ref: 'next', repo: repo() } }] };
  const jobs = ['checks', 'rust-check', 'ios-native'].map((name, i) => ({ id: 100 + i, name, status: 'completed', conclusion: 'success' }));
  const state = { comment, pr, run, jobs, repository: repo(), liveOwner: owner(), actor: owner(),
    permission: { permission: 'admin', user: owner() }, binding: undefined, protected: true, requests: [],
    runs: undefined, jobsPages: undefined, runsPages: undefined, createError: undefined, readError: undefined };
  const gh = { async request(path, options = {}) {
    state.requests.push({ path, ...options });
    const method = options.method || 'GET';
    if (path === `${R}/git/refs` && method === 'POST') {
      if (state.createError) { if (state.createError.binding) state.binding = state.createError.binding; throw new Error('ambiguous secret upstream text'); }
      assert.equal(options.body.ref, `refs/tags/${REQUEST}`);
      state.binding = { ref: options.body.ref, object: { type: 'commit', sha: options.body.sha } };
      return structuredClone(state.binding);
    }
    assert.equal(method, 'GET', 'authorization must be read only');
    if (path === `${R}/git/ref/tags/${REQUEST}`) {
      if (state.readError) throw state.readError;
      if (!state.binding) throw Object.assign(new Error('not found'), { status: 404 });
      return structuredClone(state.binding);
    }
    if (path === R) return structuredClone(state.repository);
    if (path === '/users/ashproto') return structuredClone(state.liveOwner);
    if (path === '/users/rerunner') return structuredClone(state.actor);
    if (path === `${R}/collaborators/ashproto/permission`) return structuredClone(state.permission);
    if (path === `${R}/issues/comments/456`) {
      if (!state.comment) throw Object.assign(new Error('deleted'), { status: 404 });
      return structuredClone(state.comment);
    }
    if (path === `${R}/pulls/123`) return structuredClone(state.pr);
    if (path === `${R}/branches/next`) return { name: 'next', protected: state.protected, commit: { sha: NEXT } };
    if (path === `${R}/branches/main`) return { name: 'main', protected: state.protected, commit: { sha: NEXT } };
    if (path === `${R}/actions/workflows/ci.yml`) return { id: 800, path: '.github/workflows/ci.yml' };
    if (path === `${R}/actions/runs/900`) return structuredClone(state.run);
    if (path.startsWith(`${R}/actions/workflows/ci.yml/runs?`)) {
      const page = Number(new URL(`https://api.github.com${path}`).searchParams.get('page'));
      return { workflow_runs: structuredClone(state.runsPages?.[page - 1] ?? state.runs ?? [state.run]) };
    }
    if (path.startsWith(`${R}/actions/runs/900/jobs?`)) {
      const page = Number(new URL(`https://api.github.com${path}`).searchParams.get('page'));
      return { jobs: structuredClone(state.jobsPages?.[page - 1] ?? state.jobs) };
    }
    throw new Error(`Unexpected fixture route: ${path}`);
  } };
  const event = { action: 'created', repository: repo(), sender: owner(),
    issue: { number: 123, pull_request: { url: `https://api.github.com${R}/pulls/123` } }, comment: structuredClone(comment) };
  const context = { eventName: 'issue_comment', event, ref: 'refs/heads/main', triggeringActor: 'ashproto', mode: 'enabled', gh };
  return { state, context, gh };
}

test('a new owner command freezes the exact PR source and associated CI', async () => {
  const { context, state } = fixture();
  const result = await authorizePreview(context);
  assert.deepEqual(result, { skip: false, prNumber: 123, commentId: 456, sha: SHA, ciRunId: 900,
    requestTag: REQUEST, tag: `ios-testflight/pr/123/456-${SHA}` });
  assert.equal(state.requests.some(r => r.method === 'POST'), false);
});

test('binding and rechecks retain either exact supplied dispatch tag format', async () => {
  for (const tag of [`ios-testflight/pr/123/456-${SHA}`, `ios-testflight/pr/123/456/${SHA}`]) {
    const { context, gh } = fixture();
    const request = { ...await authorizePreview(context), tag };
    assert.equal((await bindPreviewRequest(request, { gh })).tag, tag);
    assert.equal((await recheckPreview(request, { ...context, purpose: 'monitor' })).tag, tag);
    assert.equal((await recheckPreview(request, { ...context, purpose: 'start' })).tag, tag);
  }
});

test('supplied dispatch tags cannot change namespace, request identities or source', async () => {
  const { context, gh, state } = fixture();
  const request = await authorizePreview(context);
  for (const tag of [`ios-testflight/pr/124/456-${SHA}`, `ios-testflight/pr/123/457/${SHA}`,
    `ios-testflight/pr/123/456-${NEXT}`, `ios-testflight/pr/123/0456/${SHA}`,
    `ios-testflight/request/123/456-${SHA}`, `ios-testflight/pr/123/456-${SHA}\n`]) {
    await assert.rejects(bindPreviewRequest({ ...request, tag }, { gh }));
    await assert.rejects(recheckPreview({ ...request, tag }, { ...context, purpose: 'monitor' }));
  }
  assert.equal(state.requests.some(r => r.method === 'POST'), false);
});

for (const [name, mutate] of [
  ['public author', c => { c.event.comment.user = { id: 9, login: 'public' }; }],
  ['public sender', c => { c.event.sender = { id: 9, login: 'public' }; }],
  ['edited trigger', c => { c.event.action = 'edited'; }],
  ['arguments', c => { c.event.comment.body += ' now'; }],
  ['issue without PR', c => { delete c.event.issue.pull_request; }],
]) test(`ignores ${name} before any API access`, async () => {
  const { context, state } = fixture(); mutate(context);
  assert.equal((await authorizePreview(context)).skip, true);
  assert.equal(state.requests.length, 0);
});

for (const [name, mutate] of [
  ['wrong repository numeric identity', (c, s) => { s.repository.id++; }],
  ['wrong event repository identity', c => { c.event.repository.id++; }],
  ['wrong owner numeric identity', (c, s) => { s.liveOwner.id++; }],
  ['owner no longer admin', (c, s) => { s.permission.permission = 'write'; }],
  ['permission belongs to another user', (c, s) => { s.permission.user.id++; }],
  ['non-owner rerun actor', (c, s) => { c.triggeringActor = 'rerunner'; s.actor.id++; }],
  ['missing rerun actor', c => { delete c.triggeringActor; }],
  ['untrusted ref', c => { c.ref = 'refs/heads/next'; }],
  ['wrong default branch', (c, s) => { s.repository.default_branch = 'next'; }],
  ['edited command', (c, s) => { s.comment.updated_at = '2026-11-06T00:00:01Z'; }],
  ['deleted command', (c, s) => { s.comment = undefined; }],
  ['changed live command', (c, s) => { s.comment.body = '/testflight-dev args'; }],
  ['changed live author', (c, s) => { s.comment.user.id++; }],
  ['wrong comment issue', (c, s) => { s.comment.issue_url = 'https://api.github.com/repos/ashproto/Resume-Designer/issues/124'; }],
  ['closed PR', (c, s) => { s.pr.state = 'closed'; }],
  ['fork PR', (c, s) => { s.pr.head.repo.id++; }],
  ['wrong base repository', (c, s) => { s.pr.base.repo.id++; }],
  ['wrong base', (c, s) => { s.pr.base.ref = 'feature'; }],
  ['unprotected base', (c, s) => { s.protected = false; }],
  ['malformed SHA', (c, s) => { s.pr.head.sha = 'a'.repeat(39); }],
  ['malformed PR number', c => { c.event.issue.number = '123x'; }],
  ['unsafe comment number', c => { c.event.comment.id = Number.MAX_SAFE_INTEGER + 1; }],
  ['unexpected expected SHA', c => { c.expectedSha = NEXT; }],
]) test(`refuses ${name}`, async () => {
  const { context, state } = fixture(); mutate(context, state);
  await assert.rejects(authorizePreview(context));
  assert.equal(state.requests.some(r => r.method === 'POST'), false);
});

test('whole trimmed command is accepted', async () => {
  const { context, state } = fixture();
  context.event.comment.body = state.comment.body = ' \n/testflight-dev\n ';
  assert.equal((await authorizePreview(context)).sha, SHA);
});

for (const [name, mutate] of [
  ['wrong workflow', s => { s.run.workflow_id++; }],
  ['wrong workflow path', s => { s.run.path = '.github/workflows/fake.yml'; }],
  ['push CI', s => { s.run.event = 'push'; }],
  ['pending CI', s => { s.run.status = 'in_progress'; }],
  ['failed CI', s => { s.run.conclusion = 'failure'; }],
  ['different head', s => { s.run.head_sha = NEXT; }],
  ['different associated head', s => { s.run.pull_requests[0].head.sha = NEXT; }],
  ['different associated PR', s => { s.run.pull_requests[0].number++; }],
  ['missing PR association', s => { s.run.pull_requests = []; }],
  ['fork CI', s => { s.run.head_repository.id++; }],
  ['missing native job', s => { s.jobs.pop(); }],
  ['failed job', s => { s.jobs[0].conclusion = 'failure'; }],
  ['duplicate required job', s => { s.jobs.push({ ...s.jobs[0], id: 999 }); }],
]) test(`refuses ${name} without borrowing green checks`, async () => {
  const { context, state } = fixture(); mutate(state);
  await assert.rejects(authorizePreview(context));
});

test('associated synthetic merge CI preserves source head identity', async () => {
  const { context, state } = fixture(); state.run.head_sha = MERGE;
  assert.equal((await authorizePreview(context)).sha, SHA);
});

test('GitHub abbreviated PR-association repositories are validated by numeric identity', async () => {
  const { context, state } = fixture();
  state.run.pull_requests[0].head.repo = { id: 1163653093, name: 'Resume-Designer', url: `https://api.github.com${R}` };
  state.run.pull_requests[0].base.repo = { id: 1163653093, name: 'Resume-Designer', url: `https://api.github.com${R}` };
  assert.equal((await authorizePreview(context)).ciRunId, 900);
});

test('associated CI from another numeric repository is refused', async () => {
  const { context, state } = fixture(); state.run.pull_requests[0].head.repo.id++;
  await assert.rejects(authorizePreview(context));
});

test('head changes while resolving CI are stale before authorization returns', async () => {
  const { context, state, gh } = fixture(); const original = gh.request;
  gh.request = async (path, options) => {
    const result = await original(path, options);
    if (path.includes('/jobs?')) state.pr.head.sha = NEXT;
    return result;
  };
  await assert.rejects(authorizePreview(context), /stale|head/i);
});

for (const [name, mutate] of [
  ['advanced head', pr => { pr.head.sha = NEXT; }],
  ['closed PR', pr => { pr.state = 'closed'; }],
  ['wrong PR number', pr => { pr.number++; }],
  ['forked head', pr => { pr.head.repo.id++; }],
  ['changed base', pr => { pr.base.ref = 'main'; }],
  ['different base repository', pr => { pr.base.repo.id++; }],
]) test(`final start authorization refuses ${name} arising during its last protection lookup`, async () => {
  const { context, state, gh } = fixture(); const original = gh.request; let ciResolved = false;
  gh.request = async (path, options) => {
    const result = await original(path, options);
    if (path.includes('/jobs?')) ciResolved = true;
    if (ciResolved && path === `${R}/branches/next`) mutate(state.pr);
    return result;
  };
  await assert.rejects(authorizePreview(context));
});

test('eligible authorization and bound start recheck end with the fresh PR read', async () => {
  const { context, state, gh } = fixture();
  const input = await authorizePreview(context);
  assert.equal(state.requests.at(-1).path, `${R}/pulls/123`);
  await bindPreviewRequest(input, { gh });
  const result = await recheckPreview(input, { ...context, purpose: 'start' });
  assert.equal(result.sha, SHA);
  assert.equal(state.requests.at(-1).path, `${R}/pulls/123`);
});

test('a newer pending run cannot borrow older successful CI', async () => {
  const { context, state, gh } = fixture();
  const pending = { ...state.run, id: 901, status: 'in_progress', conclusion: null };
  state.runs = [pending, state.run];
  const original = gh.request;
  gh.request = async (path, options) => path === `${R}/actions/runs/901` ? pending : original(path, options);
  await assert.rejects(authorizePreview(context));
});

test('monitor-only recovery cannot be promoted into a start', async () => {
  const { context, gh } = fixture(); const input = await authorizePreview(context); await bindPreviewRequest(input, { gh });
  await assert.rejects(recheckPreview({ ...input, monitorOnly: true }, { ...context, purpose: 'start' }));
});

test('binding creation never authorizes a different SHA after an ambiguous response', async () => {
  const { context, gh, state } = fixture(); const input = await authorizePreview(context);
  state.createError = { binding: { ref: `refs/tags/${REQUEST}`, object: { type: 'commit', sha: NEXT } } };
  await assert.rejects(bindPreviewRequest(input, { gh }));
  assert.equal(state.requests.filter(r => r.method === 'POST').length, 1);
});

test('CI jobs are paginated and duplicate required jobs on later pages refuse', async () => {
  const { context, state } = fixture();
  state.jobsPages = [[...state.jobs, ...Array.from({ length: 97 }, (_, i) => ({ name: `other-${i}` }))], [state.jobs[0]]];
  await assert.rejects(authorizePreview(context));
  assert.equal(state.requests.some(r => r.path.includes('jobs?') && r.path.includes('page=2')), true);
});

test('CI runs are paginated before choosing a matching successful run', async () => {
  const { context, state } = fixture();
  state.runsPages = [Array.from({ length: 100 }, (_, i) => ({ ...state.run, id: i + 1, head_sha: NEXT, pull_requests: [] })), [state.run]];
  assert.equal((await authorizePreview(context)).ciRunId, 900);
});

test('unbounded API collections fail closed', async () => {
  const { context, state } = fixture(); state.runs = Array.from({ length: 100 }, () => state.run);
  await assert.rejects(authorizePreview(context));
  assert.equal(state.requests.filter(r => r.path.includes('/ci.yml/runs?')).length <= 100, true);
});

test('off/default/unknown mode forbids new preview requests', async () => {
  for (const mode of ['off', undefined, 'typo']) {
    const { context } = fixture(); context.mode = mode;
    assert.equal((await authorizePreview(context)).skip, true);
  }
});

test('pilot requires configured exact PR and full head SHA', async () => {
  for (const [pilotPr, pilotSha, allowed] of [['123', SHA, true], ['124', SHA, false], ['123x', SHA, false], ['123', NEXT, false], ['123', 'abc', false]]) {
    const { context } = fixture(); Object.assign(context, { mode: 'pilot', pilotPr, pilotSha });
    if (allowed) assert.equal((await authorizePreview(context)).sha, SHA);
    else await assert.rejects(authorizePreview(context));
  }
});

test('existing request binding prevents a full rerun from freezing a newer head', async () => {
  const { context, state } = fixture();
  state.binding = { ref: `refs/tags/${REQUEST}`, object: { type: 'commit', sha: NEXT } };
  await assert.rejects(authorizePreview(context), /stale|head|binding/i);
});

test('existing request binding is retained when rerunning the same source', async () => {
  const { context, state } = fixture(); state.binding = { ref: `refs/tags/${REQUEST}`, object: { type: 'commit', sha: SHA } };
  assert.equal((await authorizePreview(context)).sha, SHA);
});

test('binding creates only the deterministic lightweight request tag', async () => {
  const { context, gh, state } = fixture(); const input = await authorizePreview(context);
  assert.equal((await bindPreviewRequest(input, { gh })).sha, SHA);
  assert.deepEqual(state.requests.filter(r => r.method === 'POST'), [{ path: `${R}/git/refs`, method: 'POST', body: { ref: `refs/tags/${REQUEST}`, sha: SHA } }]);
  assert.equal((await bindPreviewRequest(input, { gh })).sha, SHA);
  assert.equal(state.requests.filter(r => r.method === 'POST').length, 1);
});

for (const [name, binding] of [
  ['different SHA', { ref: `refs/tags/${REQUEST}`, object: { type: 'commit', sha: NEXT } }],
  ['annotated tag', { ref: `refs/tags/${REQUEST}`, object: { type: 'tag', sha: SHA } }],
  ['wrong ref', { ref: 'refs/tags/other', object: { type: 'commit', sha: SHA } }],
]) test(`binding refuses ${name} without moving any tag`, async () => {
  const { context, gh, state } = fixture(); const input = await authorizePreview(context); state.binding = binding;
  await assert.rejects(bindPreviewRequest(input, { gh }));
  assert.equal(state.requests.some(r => r.method === 'POST'), false);
});

test('ambiguous binding create reads back and accepts only the original source', async () => {
  const { context, gh, state } = fixture(); const input = await authorizePreview(context);
  state.createError = { binding: { ref: `refs/tags/${REQUEST}`, object: { type: 'commit', sha: SHA } } };
  assert.equal((await bindPreviewRequest(input, { gh })).sha, SHA);
  assert.equal(state.requests.filter(r => r.method === 'POST').length, 1);
});

test('unresolved binding creation is not retried and hides upstream error bodies', async () => {
  const { context, gh, state } = fixture(); const input = await authorizePreview(context); state.createError = {};
  await assert.rejects(bindPreviewRequest(input, { gh }), error => !error.message.includes('secret'));
  assert.equal(state.requests.filter(r => r.method === 'POST').length, 1);
});

test('failed binding lookup cannot become permission to create', async () => {
  const { context, gh, state } = fixture(); const input = await authorizePreview(context); state.readError = Object.assign(new Error('API unavailable'), { status: 503 });
  await assert.rejects(bindPreviewRequest(input, { gh }));
  assert.equal(state.requests.some(r => r.method === 'POST'), false);
});

test('binding rejects caller-supplied ref injection', async () => {
  const { context, gh } = fixture(); const input = await authorizePreview(context);
  await assert.rejects(bindPreviewRequest({ ...input, requestTag: 'other' }, { gh }));
});

test('start recheck requires immutable binding and unchanged current head', async () => {
  const { context, gh, state } = fixture(); const input = await authorizePreview(context);
  await assert.rejects(recheckPreview(input, { ...context, purpose: 'start' }));
  await bindPreviewRequest(input, { gh });
  assert.equal((await recheckPreview(input, { ...context, purpose: 'start' })).sha, SHA);
  state.pr.head.sha = NEXT;
  await assert.rejects(recheckPreview(input, { ...context, purpose: 'start' }));
});

test('monitor recheck allows PR advancement/closure and off mode but stays bound', async () => {
  const { context, gh, state } = fixture(); const input = await authorizePreview(context); await bindPreviewRequest(input, { gh });
  state.pr.state = 'closed'; state.pr.head.sha = NEXT;
  const result = await recheckPreview(input, { ...context, purpose: 'monitor', mode: 'off' });
  assert.equal(result.sha, SHA);
  assert.equal(result.monitorOnly, true);
  state.comment.updated_at = '2026-11-06T00:00:01Z';
  await assert.rejects(recheckPreview(input, { ...context, purpose: 'monitor', mode: 'off' }));
});

test('owner recovery reads original request binding and cannot authorize a new start', async () => {
  const { context, state } = fixture(); state.binding = { ref: `refs/tags/${REQUEST}`, object: { type: 'commit', sha: SHA } };
  state.pr.state = 'closed'; state.pr.head.sha = NEXT;
  Object.assign(context, { eventName: 'workflow_dispatch', recovery: true, mode: 'off', event: { repository: repo(), sender: owner(), inputs: { request_tag: REQUEST } } });
  const result = await authorizePreview(context);
  assert.equal(result.sha, SHA); assert.equal(result.monitorOnly, true);
  assert.equal(state.requests.some(r => r.method === 'POST'), false);
});

test('recovery refuses absent binding or malformed request identity', async () => {
  for (const request_tag of [REQUEST, `${REQUEST}/extra`, 'ios-testflight/request/pr-0123/comment-456']) {
    const { context } = fixture();
    Object.assign(context, { eventName: 'workflow_dispatch', recovery: true, event: { repository: repo(), sender: owner(), inputs: { request_tag } } });
    await assert.rejects(authorizePreview(context));
  }
});

test('ordinary workflow_dispatch cannot authorize a preview', async () => {
  const { context } = fixture(); context.eventName = 'workflow_dispatch';
  assert.equal((await authorizePreview(context)).skip, true);
});

test('feedback can explain a refusal with CI absent, mode off and a closed advanced PR', async () => {
  const { context, state } = fixture(); context.mode = 'off'; state.pr.state = 'closed'; state.pr.head.sha = NEXT; state.runs = [];
  assert.deepEqual(await requestPolicy.authorizePreviewFeedback(context), { prNumber: 123, commentId: 456, requestTag: REQUEST });
  assert.equal(state.requests.some(r => r.path.includes('/actions/')), false);
  assert.equal(state.requests.some(r => r.method === 'POST'), false);
});

test('feedback retains the original bound SHA after the PR advances', async () => {
  const { context, state } = fixture(); state.pr.head.sha = NEXT;
  state.binding = { ref: `refs/tags/${REQUEST}`, object: { type: 'commit', sha: SHA } };
  assert.equal((await requestPolicy.authorizePreviewFeedback(context)).sha, SHA);
});

test('feedback ignores public commands without API or comment access', async () => {
  const { context, state } = fixture(); context.event.comment.user.id = 7;
  assert.equal((await requestPolicy.authorizePreviewFeedback(context)).skip, true);
  assert.equal(state.requests.length, 0);
});

test('feedback refuses a non-owner rerun actor', async () => {
  const { context, state } = fixture(); context.triggeringActor = 'rerunner'; state.actor.id = 7;
  await assert.rejects(requestPolicy.authorizePreviewFeedback(context));
});

test('feedback refuses changed/deleted commands and identity mismatches', async () => {
  for (const mutate of [s => { s.comment = undefined; }, s => { s.comment.updated_at = '2026-11-06T00:00:01Z'; }, s => { s.repository.id++; }, s => { s.pr.number++; }]) {
    const { context, state } = fixture(); mutate(state);
    await assert.rejects(requestPolicy.authorizePreviewFeedback(context));
  }
});

test('feedback ignores edited triggers and unrelated workflow dispatches', async () => {
  for (const change of [{ eventName: 'workflow_dispatch' }, { event: { action: 'edited' } }]) {
    const { context, state } = fixture(); Object.assign(context, change);
    assert.equal((await requestPolicy.authorizePreviewFeedback(context)).skip, true);
    assert.equal(state.requests.length, 0);
  }
});

test('recovery feedback requires its original binding without start authorization', async () => {
  const { context, state } = fixture();
  Object.assign(context, { eventName: 'workflow_dispatch', recovery: true, mode: 'off', event: { repository: repo(), sender: owner(), inputs: { request_tag: REQUEST } } });
  await assert.rejects(requestPolicy.authorizePreviewFeedback(context));
  state.binding = { ref: `refs/tags/${REQUEST}`, object: { type: 'commit', sha: SHA } };
  state.pr.head.sha = NEXT; state.pr.state = 'closed';
  assert.deepEqual(await requestPolicy.authorizePreviewFeedback(context), { prNumber: 123, commentId: 456, requestTag: REQUEST, sha: SHA });
});

for (const [label, suffix] of [['LF', '\n'], ['CR', '\r'], ['CRLF', '\r\n']]) {
  test(`request binding rejects a SHA with trailing ${label} before any API access`, async () => {
    const { gh, state } = fixture();
    await assert.rejects(bindPreviewRequest({ skip: false, prNumber: 123, commentId: 456, sha: `${SHA}${suffix}` }, { gh }));
    assert.equal(state.requests.length, 0);
  });

  test(`request binding rejects string IDs with trailing ${label} before any API access`, async () => {
    for (const patch of [{ prNumber: `123${suffix}` }, { commentId: `456${suffix}` }]) {
      const { gh, state } = fixture();
      await assert.rejects(bindPreviewRequest({ skip: false, prNumber: 123, commentId: 456, sha: SHA, ...patch }, { gh }));
      assert.equal(state.requests.length, 0);
    }
  });

  test(`triggering actor with trailing ${label} is rejected before any API access`, async () => {
    const { context, state } = fixture(); context.triggeringActor = `ashproto${suffix}`;
    await assert.rejects(authorizePreview(context));
    assert.equal(state.requests.length, 0);
  });

  test(`manual recovery rejects a request tag with trailing ${label}`, async () => {
    const { context, state } = fixture();
    state.binding = { ref: `refs/tags/${REQUEST}`, object: { type: 'commit', sha: SHA } };
    Object.assign(context, { eventName: 'workflow_dispatch', recovery: true,
      event: { repository: repo(), sender: owner(), inputs: { request_tag: `${REQUEST}${suffix}` } } });
    await assert.rejects(authorizePreview(context));
    await assert.rejects(requestPolicy.authorizePreviewFeedback(context));
    assert.equal(state.requests.some(r => r.path.includes('/git/ref/')), false);
  });

  test(`expectedSha with trailing ${label} cannot authorize a malformed matching source`, async () => {
    const { context, state } = fixture(); const malformed = `${SHA}${suffix}`;
    context.expectedSha = malformed; state.pr.head.sha = malformed;
    state.run.head_sha = malformed; state.run.pull_requests[0].head.sha = malformed;
    await assert.rejects(authorizePreview(context));
    assert.equal(state.requests.some(r => r.method === 'POST'), false);
  });

  test(`pilot PR and SHA with trailing ${label} cannot authorize a request`, async () => {
    for (const patch of [{ pilotPr: `123${suffix}`, pilotSha: SHA }, { pilotPr: '123', pilotSha: `${SHA}${suffix}` }]) {
      const { context } = fixture(); Object.assign(context, { mode: 'pilot', ...patch });
      await assert.rejects(authorizePreview(context));
    }
  });
}

test('a full rerun cannot turn an old CI-refused command into approval of a newer head', async () => {
  const { context, state } = fixture(); context.runAttempt = '1'; state.run.conclusion = 'failure';
  await assert.rejects(authorizePreview(context));
  context.runAttempt = '2'; state.run.conclusion = 'success';
  state.pr.head.sha = NEXT; state.run.head_sha = NEXT; state.run.pull_requests[0].head.sha = NEXT;
  await assert.rejects(authorizePreview(context), /binding/i);
  assert.equal(state.requests.some(r => r.method === 'POST'), false);
});

test('a cancelled-before-binding original request requires a fresh command on rerun', async () => {
  const { context, state } = fixture();
  await authorizePreview(context);
  context.runAttempt = 2;
  await assert.rejects(authorizePreview(context), /binding/i);
  assert.equal(state.requests.some(r => r.method === 'POST'), false);
});

test('canonical later workflow attempts retain an existing original binding', async () => {
  for (const runAttempt of [2, '2', '123']) {
    const { context, gh } = fixture(); const input = await authorizePreview(context); await bindPreviewRequest(input, { gh });
    context.runAttempt = runAttempt;
    assert.equal((await authorizePreview(context)).sha, SHA);
    assert.equal((await recheckPreview(input, { ...context, purpose: 'start' })).sha, SHA);
  }
});

test('noncanonical or unsafe workflow attempt inputs fail closed before any API access', async () => {
  for (const runAttempt of [null, '', 0, -1, 1.5, '01', '1.0', '+1', ' 1', '1\n', '1\r', '2x', '1e2', Number.MAX_SAFE_INTEGER + 1, {}, true]) {
    const { context, state } = fixture(); context.runAttempt = runAttempt;
    await assert.rejects(authorizePreview(context));
    assert.equal(state.requests.length, 0);
  }
});

test('later workflow attempts can recover and monitor the original bound request', async () => {
  const { context, gh, state } = fixture(); const input = await authorizePreview(context); await bindPreviewRequest(input, { gh });
  context.runAttempt = '3'; state.pr.state = 'closed'; state.pr.head.sha = NEXT;
  assert.equal((await recheckPreview(input, { ...context, mode: 'off', purpose: 'monitor' })).monitorOnly, true);
  Object.assign(context, { eventName: 'workflow_dispatch', recovery: true, mode: 'off',
    event: { repository: repo(), sender: owner(), inputs: { request_tag: REQUEST } } });
  const result = await authorizePreview(context);
  assert.equal(result.monitorOnly, true); assert.equal(result.sha, SHA);
});


test('CI lookup scopes to the encoded source branch and retains synthetic-merge provenance', async () => {
  const { context, state } = fixture();
  state.pr.head.ref = 'codex/feature#1+name&more';
  state.run.head_sha = MERGE;
  assert.equal((await authorizePreview(context)).ciRunId, 900);
  const queries = state.requests.filter(value => value.path.includes('/ci.yml/runs?'));
  assert.equal(queries.length, 1);
  const query = new URL(queries[0].path, 'https://api.github.com').searchParams;
  assert.equal(query.get('branch'), state.pr.head.ref);
  assert.equal(query.get('event'), 'pull_request');
  assert.equal(query.get('head_sha'), null);
});
