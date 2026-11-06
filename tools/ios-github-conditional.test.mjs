import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createApi } from './ios-cloud-release.mjs';
import { authorizePreview, recheckPreview } from './ios-pr-request.mjs';

const origin = 'https://api.github.com';
const root = '/repos/ashproto/Resume-Designer';
const sha = 'a'.repeat(40), next = 'b'.repeat(40);
const owner = { id: 35086581, login: 'ashproto', type: 'User' };
const repository = { id: 1163653093, full_name: 'ashproto/Resume-Designer', default_branch: 'main', owner };
const json = (body, etag = '"one"') => new Response(JSON.stringify(body), { headers: etag === undefined ? {} : { ETag: etag } });
const unchanged = etag => new Response(null, { status: 304, headers: etag === undefined ? {} : { ETag: etag } });
const client = fetchImpl => createApi({ origin, token: () => 'test-token', fetchImpl, sleep: async () => {} });

function authorizationServer() {
  const timestamp = '2026-11-06T00:00:00Z';
  const comment = { id: 456, body: '/testflight-dev', user: owner, created_at: timestamp, updated_at: timestamp,
    issue_url: `${origin}${root}/issues/123` };
  const pr = { number: 123, state: 'open', draft: true, merge_commit_sha: 'c'.repeat(40),
    base: { ref: 'next', sha: next, repo: repository }, head: { ref: 'feature', sha, repo: repository } };
  const run = { id: 900, workflow_id: 800, path: '.github/workflows/ci.yml', event: 'pull_request',
    status: 'completed', conclusion: 'success', head_sha: sha, head_repository: repository,
    pull_requests: [{ number: 123, head: { sha, repo: repository }, base: { ref: 'next', repo: repository } }] };
  const jobs = ['checks', 'rust-check', 'ios-native'].map((name, id) => ({ id: id + 100, name, status: 'completed', conclusion: 'success' }));
  const binding = 'ios-testflight/request/pr-123/comment-456';
  const routes = new Map([
    [root, repository], ['/users/ashproto', owner], [`${root}/collaborators/ashproto/permission`, { permission: 'admin', user: owner }],
    [`${root}/git/ref/tags/${binding}`, { ref: `refs/tags/${binding}`, object: { type: 'commit', sha } }],
    [`${root}/issues/comments/456`, comment], [`${root}/pulls/123`, pr],
    [`${root}/branches/next`, { name: 'next', protected: true, commit: { sha: next } }],
    [`${root}/actions/workflows/ci.yml`, { id: 800, path: '.github/workflows/ci.yml' }],
    [`${root}/actions/workflows/ci.yml/runs?event=pull_request&branch=feature&per_page=100&page=1`, { workflow_runs: [run] }],
    [`${root}/actions/runs/900`, run], [`${root}/actions/runs/900/jobs?filter=latest&per_page=100&page=1`, { jobs }],
  ]);
  const state = { pr, network: 0, charged: 0, validated: 0, changedHeadReads: 0 };
  const gh = client(async (url, options) => {
    state.network++;
    assert.equal(options.method, 'GET');
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.redirect, 'error');
    const parsed = new URL(url), path = parsed.pathname + parsed.search;
    assert.ok(routes.has(path), `Unexpected authorization route: ${path}`);
    const text = JSON.stringify(routes.get(path));
    const etag = `"${createHash('sha256').update(text).digest('hex')}"`;
    if (options.headers['If-None-Match'] === etag) { state.validated++; return unchanged(etag); }
    if (++state.charged > 1000) return new Response('{}', { status: 403 });
    if (path === `${root}/pulls/123` && pr.head.sha !== sha) state.changedHeadReads++;
    return new Response(text, { headers: { ETag: etag } });
  });
  const event = { action: 'created', repository, sender: owner,
    issue: { number: 123, pull_request: { url: `${origin}${root}/pulls/123` } }, comment: structuredClone(comment) };
  return { state, context: { eventName: 'issue_comment', event, ref: 'refs/heads/main', triggeringActor: 'ashproto', mode: 'enabled', gh } };
}

test('120 real preview monitor/start polls stay below the charged budget and observe a changed head', async t => {
  const { state, context } = authorizationServer();
  t.after(() => t.diagnostic(`network=${state.network}, charged=${state.charged}, validated304=${state.validated}`));
  const request = await authorizePreview(context);
  for (let poll = 0; poll < 120; poll++) {
    await recheckPreview(request, { ...context, purpose: 'monitor' });
    assert.equal((await recheckPreview(request, { ...context, purpose: 'start' })).sha, sha);
  }
  assert.ok(state.network > 1000, 'authorization still contacts GitHub for every read');
  assert.ok(state.charged < 50, 'unchanged authorized 304s do not consume the primary budget');
  state.pr.head.sha = next;
  await assert.rejects(recheckPreview(request, { ...context, purpose: 'start' }), /stale|head/i);
  assert.equal(state.changedHeadReads, 1);
});

test('conditional reads return independent JSON copies after real authenticated network validation', async () => {
  const options = [];
  const api = client(async (_url, supplied) => {
    options.push(supplied);
    return supplied.headers['If-None-Match'] ? unchanged('W/"owner"') : json({ permission: 'read', nested: { ids: [1] } }, 'W/"owner"');
  });
  const first = await api.request('/facts'); first.permission = 'admin'; first.nested.ids.push(9);
  const second = await api.request('/facts');
  assert.deepEqual(second, { permission: 'read', nested: { ids: [1] } });
  second.nested.ids[0] = 99;
  assert.deepEqual(await api.request('/facts'), { permission: 'read', nested: { ids: [1] } });
  assert.equal(options.length, 3);
  assert.equal(options[1].headers['If-None-Match'], 'W/"owner"');
  assert.ok(options.every(value => value.headers.Authorization === 'Bearer test-token'));
});

test('token rotation clears all prior-principal validators even if the token rotates back', async () => {
  let token = 'first'; const calls = [];
  const api = createApi({ origin, token: () => token, fetchImpl: async (_url, options) => {
    calls.push(options.headers);
    return options.headers['If-None-Match'] ? unchanged('"one"') : json({ authorized: true });
  } });
  await api.request('/facts'); await api.request('/facts');
  token = 'second'; await api.request('/facts');
  token = 'first'; await api.request('/facts');
  assert.equal(calls[1]['If-None-Match'], '"one"');
  assert.equal(calls[2].Authorization, 'Bearer second');
  assert.equal(calls[2]['If-None-Match'], undefined);
  assert.equal(calls[3]['If-None-Match'], undefined);
});

for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) for (const status of [200, 503]) {
  test(`${method} attempt clears validators even when its response is ${status}`, async () => {
    const calls = [];
    const api = client(async (_url, options) => {
      calls.push(options);
      if (options.method !== 'GET') return new Response('{}', { status });
      return options.headers['If-None-Match'] ? unchanged('"one"') : json({ state: 'fresh' });
    });
    await api.request('/facts'); await api.request('/facts');
    const mutation = api.request('/mutate', { method, body: { action: 'test' } });
    if (status === 503) await assert.rejects(mutation, /503/); else await mutation;
    await api.request('/facts');
    assert.equal(calls.filter(value => value.method === method).length, 1, 'mutations are never retried');
    assert.equal(calls[2].headers['If-None-Match'], undefined);
    assert.equal(calls[3].headers['If-None-Match'], undefined);
  });
}

for (const etag of [null, '', 'not-an-entity-tag']) test(`responses with unusable ETag ${JSON.stringify(etag)} never reuse JSON`, async () => {
  let reads = 0;
  const api = client(async (_url, options) => {
    assert.equal(options.headers['If-None-Match'], undefined);
    return new Response(JSON.stringify({ revision: ++reads }), { headers: etag === null ? {} : { ETag: etag } });
  });
  assert.deepEqual(await api.request('/facts'), { revision: 1 });
  assert.deepEqual(await api.request('/facts'), { revision: 2 });
});

test('a newer 200 without ETag discards the old validator', async () => {
  const calls = [];
  const api = client(async (_url, options) => {
    calls.push(options.headers);
    return calls.length === 1 ? json({ revision: 1 }) : new Response('{"revision":2}');
  });
  await api.request('/facts'); await api.request('/facts'); await api.request('/facts');
  assert.equal(calls[1]['If-None-Match'], '"one"');
  assert.equal(calls[2]['If-None-Match'], undefined);
});

test('304 without the exact URL validator fails closed without retrying', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, ...options });
    return calls.length === 1 ? json({ authorized: true }) : unchanged('"one"');
  });
  await api.request('/facts?page=1');
  await assert.rejects(api.request('/facts?page=2'), error => error.status === 304);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].headers['If-None-Match'], undefined);
});

test('304 with a conflicting ETag cannot validate the stored JSON', async () => {
  let calls = 0;
  const api = client(async () => ++calls === 1 ? json({ authorized: true }) : unchanged('"different"'));
  await api.request('/facts');
  await assert.rejects(api.request('/facts'), error => error.status === 304);
  assert.equal(calls, 2);
});

for (const [saved, received] of [['W/"binding"', '"binding"'], ['"binding"', 'W/"binding"']]) {
  test(`304 weak comparison accepts ${saved} becoming ${received}`, async () => {
    let calls = 0;
    const api = client(async (_url, options) => {
      if (++calls === 1) return json({ source: sha }, saved);
      assert.equal(options.headers['If-None-Match'], saved);
      return unchanged(received);
    });
    await api.request('/binding');
    assert.deepEqual(await api.request('/binding'), { source: sha });
    assert.equal(calls, 2);
  });
}

for (const [saved, received] of [
  ['W/"binding"', '"changed"'], ['"binding"', 'W/"changed"'],
  ['W/"binding"', 'W/binding'], ['"binding"', 'w/"binding"'],
]) test(`304 weak comparison rejects conflicting or malformed ${received}`, async () => {
  let calls = 0;
  const api = client(async () => ++calls === 1 ? json({ source: sha }, saved) : unchanged(received));
  await api.request('/binding');
  await assert.rejects(api.request('/binding'), error => error.status === 304);
  assert.equal(calls, 2);
});

for (const failure of ['network', 'invalid-json', '403', '503']) test(`${failure} never falls back to previously authorized JSON`, async () => {
  let calls = 0; let failing = false;
  const api = client(async () => {
    calls++;
    if (!failing) return json({ authorized: true });
    if (failure === 'network') throw new Error('offline');
    if (failure === 'invalid-json') return new Response('{', { headers: { ETag: '"bad"' } });
    return new Response('{}', { status: Number(failure) });
  });
  await api.request('/facts'); failing = true;
  await assert.rejects(api.request('/facts'));
  assert.equal(calls, failure === '403' ? 2 : 4, 'existing GET retry policy is preserved');
});

test('Apple API responses are never conditionally cached', async () => {
  let calls = 0;
  const api = createApi({ origin: 'https://api.appstoreconnect.apple.com', token: () => 'apple-token', fetchImpl: async (_url, options) => {
    assert.equal(options.headers['If-None-Match'], undefined);
    return ++calls < 3 ? json({ revision: calls }) : unchanged('"one"');
  } });
  assert.deepEqual(await api.request('/v1/app'), { revision: 1 });
  assert.deepEqual(await api.request('/v1/app'), { revision: 2 });
  await assert.rejects(api.request('/v1/app'), error => error.status === 304);
});

test('bounded cache evicts old URLs and refuses oversized responses', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, headers: options.headers });
    return json({ value: url.endsWith('/large') ? 'x'.repeat(2 * 1024 * 1024) : 1 });
  });
  await api.request('/old');
  for (let index = 0; index < 256; index++) await api.request(`/facts/${index}`);
  await api.request('/old');
  assert.equal(calls.at(-1).headers['If-None-Match'], undefined);
  await api.request('/large'); await api.request('/large');
  assert.equal(calls.at(-1).headers['If-None-Match'], undefined);
});

test('total cached JSON bytes are bounded independently of entry count', async () => {
  const calls = [];
  const api = client(async (url, options) => {
    calls.push({ url, headers: options.headers });
    return json({ value: 'x'.repeat(512 * 1024) });
  });
  for (let index = 0; index < 24; index++) await api.request(`/facts/${index}`);
  await api.request('/facts/0');
  assert.equal(calls.at(-1).headers['If-None-Match'], undefined);
});

test('an in-flight GET cannot restore validators invalidated by a mutation', async () => {
  let finish; const calls = [];
  const api = client(async (_url, options) => {
    calls.push(options);
    if (calls.length === 1) return new Promise(resolve => { finish = resolve; });
    return json({ state: 'fresh' });
  });
  const pending = api.request('/facts');
  await api.request('/mutation', { method: 'POST' });
  finish(json({ state: 'before-mutation' })); await pending;
  await api.request('/facts');
  assert.equal(calls[2].headers['If-None-Match'], undefined);
});

test('an in-flight 304 cannot resurrect JSON invalidated by a mutation', async () => {
  let finish; const calls = [];
  const api = client(async (_url, options) => {
    calls.push(options);
    if (calls.length === 2) return new Promise(resolve => { finish = resolve; });
    return json({ authorized: true });
  });
  await api.request('/facts');
  const pending = api.request('/facts');
  await api.request('/mutation', { method: 'POST' });
  finish(unchanged('"one"'));
  await assert.rejects(pending, error => error.status === 304);
});

test('an old-token in-flight response cannot replace the new principal cache', async () => {
  let token = 'old', finish; const calls = [];
  const api = createApi({ origin, token: () => token, fetchImpl: async (_url, options) => {
    calls.push(options.headers);
    if (calls.length === 1) return new Promise(resolve => { finish = resolve; });
    return options.headers['If-None-Match'] ? unchanged('"new"') : json({ principal: 'new' }, '"new"');
  } });
  const pending = api.request('/facts');
  token = 'new'; await api.request('/facts');
  finish(json({ principal: 'old' }, '"old"')); await pending;
  assert.deepEqual(await api.request('/facts'), { principal: 'new' });
  assert.equal(calls[2]['If-None-Match'], '"new"');
});
