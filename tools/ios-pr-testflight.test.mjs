import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { formatFeedback, upsertFeedback, verifyPreviewRecipients, runPreviewCommand, inspectCandidate } from './ios-pr-testflight.mjs';

const sha = 'a'.repeat(40);
const request = { skip: false, prNumber: 158, commentId: 2468, sha, requestTag: 'ios-testflight/request/pr-158/comment-2468', tag: `ios-testflight/pr/158/2468/${sha}` };
const env = { GITHUB_REPOSITORY: 'ashproto/Resume-Designer', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: 'b'.repeat(40), GITHUB_RUN_ID: '42', GITHUB_TRIGGERING_ACTOR: 'ashproto', IOS_PR_TESTFLIGHT_MODE: 'enabled',
  PREVIEW_SHA: sha, PR_NUMBER: '158', COMMENT_ID: '2468', XCODE_CLOUD_WORKFLOW_ID: 'prod', XCODE_CLOUD_PR_WORKFLOW_ID: 'dev', APP_STORE_CONNECT_APP_ID: '123', APP_STORE_CONNECT_DEV_GROUP_ID: 'group' };

test('candidate inspection awaits the full asynchronous Git-tree guard before authorizing anything', async () => {
  const head = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  let fetched = false;
  await assert.rejects(inspectCandidate({ candidateSha:head, trustedSha:head,
    exec: (command,args,options) => {
      fetched = true;
      assert.equal(command,'git');
      assert.ok(args.includes('--no-recurse-submodules'));
      assert.ok(args.includes('https://github.com/ashproto/Resume-Designer.git'));
      assert.equal(options.env.APP_STORE_CONNECT_PRIVATE_KEY,undefined);
    },
    assertInputs: async () => { await Promise.resolve(); throw new Error('Guard rejected protected config'); },
  }), /Guard rejected/);
  assert.equal(fetched,true);
});

test('feedback shows verified outcomes and safely renders failed or unconfirmed delivery', () => {
  const body = formatFeedback({ request, values: { release_state: 'testflight_available', build_number: '9' }, runUrl: 'https://github.com/ashproto/Resume-Designer/actions/runs/42' });
  assert.match(body, /Build \*\*9\*\* is available/);
  assert.match(body, /on-paper-testflight-request:2468/);
  assert.match(body, new RegExp(sha));
  for (const tag of ['script', 'SCRIPT', 'ScRiPt data-note="test"']) {
    const failure = formatFeedback({ request, error: `<${tag}>@everyone</script>\n\`oops\``, values: { release_state: 'submitted' }, runUrl: 'https://github.com/ashproto/Resume-Designer/actions/runs/42' });
    assert.ok(failure.includes(`&lt;${tag}&gt;`));
    assert.doesNotMatch(failure, /<\/?script\b|@everyone|`oops`/i);
    assert.match(failure, /unconfirmed/i);
  }
  assert.throws(() => formatFeedback({ request, runUrl: 'https://evil.test/' }));
  assert.throws(() => formatFeedback({ request:{...request,prNumber:'158\n'}, runUrl:'https://github.com/ashproto/Resume-Designer/actions/runs/42' }));
});

test('feedback updates only its own bot marker and handles full comment pages', async () => {
  const writes = [];
  const marker = '<!-- on-paper-testflight-request:2468 -->';
  const gh = { request: async (path, options) => {
    if (options) { writes.push({path,options}); return {}; }
    if (new URL(path, 'https://api.github.com').searchParams.get('page') === '1') return Array.from({ length: 100 }, (_,i) => ({ id: i + 1, user: {id: 1,type:'User',login:'other'}, body: marker }));
    return [{ id: 200, user: { id: 41898282, type: 'Bot', login: 'github-actions[bot]' }, body: marker }];
  } };
  await upsertFeedback({ gh, request, body: `${marker}\nState` });
  assert.equal(writes.length, 1);
  assert.equal(writes[0].options.method, 'PATCH');
  assert.ok(writes[0].path.endsWith('/issues/comments/200'));
});

test('preview preflight rejects any automatic all-build group and requires the internal target', async () => {
  const group = { id: 'group', attributes: { isInternalGroup: true, hasAccessToAllBuilds: false } };
  await verifyPreviewRecipients({ asc: { collection: async () => [group] }, appId: '123', groupId: 'group' });
  for (const groups of [[], [{...group,attributes:{...group.attributes,isInternalGroup:false}}], [group,{id:'other',attributes:{hasAccessToAllBuilds:true}}]]) {
    await assert.rejects(verifyPreviewRecipients({ asc: { collection: async () => groups }, appId: '123', groupId: 'group' }), /group|automatic/i);
  }
});

function runtime(overrides = {}) {
  const trace = [], outputs = [];
  return { trace, outputs, options: {
    env, eventName: 'issue_comment', event: {}, gh: {}, asc: {}, output: value => outputs.push(value),
    authorize: async () => { trace.push('authorize'); return request; },
    bind: async value => { trace.push('bind'); return value; },
    recheck: async (_value, context) => { trace.push(`recheck:${context.purpose}`); return request; },
    guard: async () => { trace.push('guard'); },
    recipients: async () => { trace.push('recipients'); },
    ordering: async () => { trace.push('ordering'); },
    journal: async ({state}) => { trace.push(`journal:${state}`); return {state}; },
    deliver: async (input, options) => { trace.push('deliver'); await options.authorizeSource('monitor'); await options.beforeStart(input); await options.recordState('post-attempted'); await options.authorizeSource('start'); options.output({release_state:'testflight_available',build_number:'9'}); return {state:'testflight_available'}; },
    ...overrides,
  } };
}

test('unrelated authorization cannot fetch candidate objects or create bindings', async () => {
  const r = runtime({ authorize: async () => ({skip:true,reason:'not-owner'}) });
  const value = await runPreviewCommand('authorize', r.options);
  assert.equal(value.skip, true);
  assert.deepEqual(r.trace, []);
});

test('binding reauthorizes the frozen head and checks build inputs before writing a ref', async () => {
  const r = runtime();
  await runPreviewCommand('bind', r.options);
  assert.deepEqual(r.trace, ['authorize', 'guard', 'bind']);
  const denied = runtime({ guard: async () => { throw new Error('Changed build input'); } });
  await assert.rejects(runPreviewCommand('bind', denied.options), /Changed build input/);
  assert.ok(!denied.trace.includes('bind'));
});

test('release wires internal-only policy, final live checks, recipients, ordering and durable journal', async () => {
  const r = runtime();
  const value = await runPreviewCommand('release', r.options);
  assert.equal(value.state, 'testflight_available');
  assert.ok(r.trace.includes('recipients') && r.trace.includes('ordering'));
  assert.equal(r.trace.at(-1), 'recheck:start');
  assert.ok(r.outputs.some(x => x.release_state === 'testflight_available'));
});

test('recovery is monitor-only even with mode off and no Cloud run ID', async () => {
  const r = runtime({ env: {...env,IOS_PR_TESTFLIGHT_MODE:'off'}, eventName:'workflow_dispatch', event:{inputs:{request_tag:request.requestTag}},
    authorize: async () => ({...request,monitorOnly:true}),
    deliver: async (input, options) => {
      assert.equal(input.recoveryOnly,true);
      assert.equal(await options.authorizeSource('monitor'),false);
      assert.equal(await options.authorizeSource('start'),false);
      return {state:'monitoring'};
    },
  });
  await runPreviewCommand('recover', r.options);
  assert.ok(!r.trace.includes('guard') && !r.trace.includes('ordering'));
});
