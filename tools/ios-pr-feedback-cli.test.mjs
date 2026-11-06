import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./ios-pr-testflight.mjs', import.meta.url));
const sentinel = 'PRIVATE-DIAGNOSTIC-SENTINEL-never-log';
const owner = { id: 35086581, login: 'ashproto', type: 'User' };
const repository = { id: 1163653093, full_name: 'ashproto/Resume-Designer', default_branch: 'main', owner };
const sha = 'a'.repeat(40);
const comment = { id: 456, body: '/testflight-dev', user: owner,
  created_at: '2026-11-06T00:00:00Z', updated_at: '2026-11-06T00:00:00Z',
  issue_url: 'https://api.github.com/repos/ashproto/Resume-Designer/issues/161' };
const event = { action: 'created', repository, sender: owner, comment, issue: { number: 161, pull_request: {} } };

function invoke(t, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'on-paper-feedback-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const eventPath = join(dir, 'event.json'), preload = join(dir, 'fetch.mjs'), trace = join(dir, 'requests.json');
  writeFileSync(eventPath, options.eventText ?? JSON.stringify(event));
  // Replace only fetch: execute the actual command, init, API adapter, policy,
  // formatter and comment upsert. No network, credentials or gh CLI is involved.
  writeFileSync(preload, `import { writeFileSync } from 'node:fs';
const options = ${JSON.stringify(options)};
const owner = ${JSON.stringify(owner)}, repository = ${JSON.stringify(repository)}, comment = ${JSON.stringify(comment)};
const sentinel = ${JSON.stringify(sentinel)}, trace = ${JSON.stringify(trace)}, sha = ${JSON.stringify(sha)};
const root = '/repos/ashproto/Resume-Designer';
const requests = [];
globalThis.fetch = async (raw, init) => {
  const url = new URL(raw), path = url.pathname, method = init.method;
  requests.push({ method, path, ...(init.body ? { body: JSON.parse(init.body) } : {}) });
  writeFileSync(trace, JSON.stringify(requests));
  if (url.origin !== 'https://api.github.com') throw new Error(sentinel);
  let operation, value;
  if (method === 'GET' && path === root) { operation = 'repository'; value = repository; }
  else if (method === 'GET' && path === '/users/ashproto') { operation = 'owner'; value = owner; }
  else if (method === 'GET' && path === root + '/collaborators/ashproto/permission') { operation = 'permission'; value = { permission: options.policyDenied ? 'write' : 'admin', user: owner }; }
  else if (method === 'GET' && path === root + '/git/ref/tags/ios-testflight/request/pr-161/comment-456') { operation = 'binding'; value = { ref: 'refs/tags/ios-testflight/request/pr-161/comment-456', object: { type: 'commit', sha } }; }
  else if (method === 'GET' && path === root + '/issues/comments/456') { operation = 'command'; value = comment; }
  else if (method === 'GET' && path === root + '/pulls/161') { operation = 'pr'; value = { number: 161, state: 'open' }; }
  else if (method === 'GET' && path === root + '/issues/161/comments') {
    operation = 'list'; value = options.malformedList ? {} : options.existing ? [{ id: 789, user: { id: 41898282, login: 'github-actions[bot]', type: 'Bot' }, body: '<!-- on-paper-testflight-request:456 -->' }] : [];
  }
  else if (method === 'POST' && path === root + '/issues/161/comments') { operation = 'post'; value = { id: 789 }; }
  else if (method === 'PATCH' && path === root + '/issues/comments/789') { operation = 'patch'; value = { id: 789 }; }
  else throw new Error(sentinel);
  if (options.failAt === operation) {
    if (options.transport) throw new Error(sentinel);
    return new Response(sentinel, { status: options.status || 403, headers: options.rateHeaders });
  }
  if (operation === 'binding' && options.noBinding) return new Response(sentinel, { status: 404 });
  return new Response(JSON.stringify(value), { status: 200 });
};
`);
  const env = { PATH: '/nonexistent', GITHUB_EVENT_PATH: options.missingEvent ? join(dir, sentinel) : eventPath,
    GITHUB_TOKEN: options.noToken ? '' : sentinel, APP_STORE_CONNECT_PRIVATE_KEY: sentinel,
    GITHUB_EVENT_NAME: 'issue_comment', GITHUB_REF: 'refs/heads/main', GITHUB_TRIGGERING_ACTOR: 'ashproto',
    GITHUB_REPOSITORY: repository.full_name, GITHUB_SHA: 'b'.repeat(40),
    GITHUB_RUN_ID: options.badRunUrl ? sentinel : '42270827703', GITHUB_RUN_ATTEMPT: '1', PREVIEW_STATE: 'queued' };
  const result = spawnSync(process.execPath, ['--import', preload, cli, ...(options.args || ['feedback'])], {
    env, encoding: 'utf8', timeout: 15_000,
  });
  const text = result.stdout + result.stderr;
  assert.equal(result.error, undefined);
  assert.ok(!text.includes(sentinel), 'raw error, body, token, env and path sentinel must never appear');
  return { ...result, text, requests: existsSync(trace) ? JSON.parse(readFileSync(trace, 'utf8')) : [] };
}

for (const [name, options, phase] of [
  ['invalid arguments', { args: ['feedback', sentinel] }, 'init_arguments'],
  ['unreadable event file', { missingEvent: true }, 'init_event'],
  ['malformed event JSON', { eventText: sentinel }, 'init_event'],
  ['missing token', { noToken: true }, 'init_token'],
]) test(`real CLI diagnoses ${name} before external calls`, t => {
  const result = invoke(t, options);
  assert.equal(result.status, 1);
  assert.match(result.text, new RegExp(`preview_diagnostic phase=${phase}(?:\\s|$)`));
  assert.deepEqual(result.requests, []);
});

for (const [operation, enumName] of [
  ['repository', 'read_repository'], ['owner', 'read_user'], ['permission', 'read_permission'],
  ['binding', 'read_binding'], ['command', 'read_command'], ['pr', 'read_pr'],
]) test(`real CLI retains ${operation} HTTP failure before policy masking`, t => {
  const result = invoke(t, { failAt: operation });
  assert.equal(result.status, 1);
  assert.match(result.text, new RegExp(`preview_diagnostic phase=feedback_authorize operation=${enumName} status=403`));
  assert.ok(result.requests.every(call => call.method === 'GET'));
});

test('real CLI separates authorization policy rejection from API failure', t => {
  const result = invoke(t, { policyDenied: true });
  assert.equal(result.status, 1);
  assert.match(result.text, /preview_diagnostic phase=feedback_authorize(?:\s|$)/);
  assert.doesNotMatch(result.text, /operation=|status=403/);
  assert.ok(result.requests.every(call => call.method === 'GET'));
});

test('real CLI diagnoses formatter failure without leaking the run URL value', t => {
  const result = invoke(t, { badRunUrl: true });
  assert.equal(result.status, 1);
  assert.match(result.text, /preview_diagnostic phase=feedback_format(?:\s|$)/);
  assert.ok(result.requests.every(call => call.method === 'GET'));
});

for (const [name, options, expectedDiagnostic] of [
  ['comment list refusal', { failAt: 'list' }, 'phase=feedback_list operation=list_comments status=403'],
  ['malformed comment list', { malformedList: true }, 'phase=feedback_list'],
  ['comment POST refusal', { failAt: 'post' }, 'phase=feedback_write operation=create_comment status=403'],
  ['comment PATCH refusal', { existing: true, failAt: 'patch' }, 'phase=feedback_write operation=update_comment status=403'],
  ['comment POST transport failure', { failAt: 'post', transport: true }, 'phase=feedback_write operation=create_comment status=transport'],
]) test(`real CLI diagnoses ${name} without retrying a mutation`, t => {
  const result = invoke(t, options);
  assert.equal(result.status, 1);
  assert.ok(result.text.includes(`preview_diagnostic ${expectedDiagnostic}`));
  assert.ok(result.requests.filter(call => call.method !== 'GET').length <= 1);
});

for (const existing of [false, true]) test(`real CLI ${existing ? 'updates' : 'creates'} exactly one feedback comment without diagnostics`, t => {
  const result = invoke(t, { existing });
  assert.equal(result.status, 0, result.text);
  assert.doesNotMatch(result.text, /preview_diagnostic/);
  const writes = result.requests.filter(call => call.method !== 'GET');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, existing ? 'PATCH' : 'POST');
  assert.ok(writes[0].body.body.startsWith('<!-- on-paper-testflight-request:456 -->'));
  assert.ok(writes[0].body.body.includes(sha));
  assert.ok(writes[0].body.body.includes('queued'));
});

test('handled missing binding is not falsely logged as a feedback failure', t => {
  const result = invoke(t, { noBinding: true });
  assert.equal(result.status, 0, result.text);
  assert.doesNotMatch(result.text, /preview_diagnostic/);
  assert.equal(result.requests.filter(call => call.method === 'POST').length, 1);
});


for (const operation of ['permission', 'post']) test(`real CLI safely retains numeric rate-limit evidence at ${operation}`, t => {
  const result = invoke(t, { failAt: operation, rateHeaders: {
    'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1890000000', 'retry-after': '60',
  } });
  assert.equal(result.status, 1);
  assert.match(result.text, /status=403 remaining=0 reset=1890000000 retry_after=60/);
  assert.ok(result.requests.filter(call => call.method !== 'GET').length <= 1);
});

test('real CLI ignores nonnumeric rate-limit header values', t => {
  const result = invoke(t, { failAt: 'post', rateHeaders: {
    'x-ratelimit-remaining': sentinel, 'x-ratelimit-reset': '-1', 'retry-after': '999999999999999999999999999999',
  } });
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.text, /remaining=|reset=|retry_after=/);
});
