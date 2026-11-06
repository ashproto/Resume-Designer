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
    gh: { request: async path => {
      if (path.endsWith(`/2468/${sha}`)) return { ref: `refs/tags/ios-testflight/pr/158/2468/${sha}`, object: { type: 'commit', sha } };
      throw Object.assign(new Error('Not found'), { status: 404 });
    } },
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

test('metadata repair never overwrites an existing authentic bot request notice', async () => {
  const available = '<!-- on-paper-testflight-request:2468 -->\n\n### On Paper PR TestFlight\n\nBuild **9** is available to **On Paper Dev** in TestFlight.\n\nSource: `' + sha + '`.';
  const pending = '<!-- on-paper-testflight-request:2468 -->\nQueued';
  for (const [createOnly, existingBody, user, writesExpected] of [
    [true, available, { id: 41898282, type: 'Bot', login: 'github-actions[bot]' }, 0],
    [false, available, { id: 41898282, type: 'Bot', login: 'github-actions[bot]' }, 1],
    [true, available.replace(sha, 'c'.repeat(40)), { id: 41898282, type: 'Bot', login: 'github-actions[bot]' }, 0],
    [true, pending, { id: 41898282, type: 'Bot', login: 'github-actions[bot]' }, 0],
    [true, available, { id: 1, type: 'User', login: 'other' }, 1],
  ]) {
    const writes = [];
    await upsertFeedback({ request, createOnly, body: '<!-- on-paper-testflight-request:2468 -->\nUnconfirmed',
      gh: { request: async (_path, options) => {
        if (options) { writes.push(options); return {}; }
        return [{ id: 200, user, body: existingBody }];
      } },
    });
    assert.equal(writes.length, writesExpected);
  }
});

test('metadata repair cannot downgrade availability published after its pending list snapshot', async () => {
  const marker = '<!-- on-paper-testflight-request:2468 -->';
  let serverBody = marker + '\nQueued';
  const writes = [];
  await upsertFeedback({ request, createOnly: true, body: marker + '\nUnconfirmed',
    gh: { request: async (_path, options) => {
      if (options) { writes.push(options); serverBody = options.body.body; return {}; }
      const snapshot = { id: 200, user: { id: 41898282, type: 'Bot', login: 'github-actions[bot]' }, body: serverBody };
      // Delivery publishes availability after the list response was generated.
      serverBody = marker + '\nBuild **9** is available to **On Paper Dev** in TestFlight.';
      return [snapshot];
    } },
  });
  assert.deepEqual(writes, []);
  assert.match(serverBody, /available to/);
});


test('fresh preview uses the four-segment full-SHA tag consistently for delivery, ordering and journal', async () => {
  const tag = `ios-testflight/pr/158/2468-${sha}`;
  let ordered, recorded;
  const r = runtime({
    ordering: async value => { ordered = value; },
    journal: async value => { recorded = value; return value; },
    deliver: async (input, options) => {
      assert.equal(input.tag, tag);
      await options.beforeStart();
      await options.recordState('reserved');
      return { state: 'reserved' };
    },
  });
  await runPreviewCommand('release', r.options);
  assert.equal(ordered.currentTag, tag);
  assert.equal(recorded.tag, tag);
  assert.equal(recorded.sha, sha);
});

for (const legacy of [false, true]) test(`recovery resolves only the existing ${legacy ? 'legacy' : 'current'} exact ref and retains it everywhere`, async () => {
  const tags = [`ios-testflight/pr/158/2468-${sha}`, `ios-testflight/pr/158/2468/${sha}`];
  const actual = tags[legacy ? 1 : 0], calls = [];
  let recorded, ordered;
  const r = runtime({ eventName: 'workflow_dispatch', event: { inputs: { request_tag: request.requestTag } },
    authorize: async () => ({ ...request, tag: tags[0], monitorOnly: true }),
    gh: { request: async (path, options) => {
      calls.push([path, options]);
      if (path.endsWith(actual)) return { ref: `refs/tags/${actual}`, object: { type: 'commit', sha } };
      throw Object.assign(new Error('Not found'), { status: 404 });
    } },
    ordering: async value => { ordered = value; },
    journal: async value => { recorded = value; return value; },
    recheck: async value => { assert.equal(value.tag, actual); return value; },
    deliver: async (input, options) => {
      assert.equal(input.tag, actual);
      assert.equal(input.recoveryOnly, true);
      assert.equal(await options.authorizeSource('start'), false);
      await options.beforeStart();
      await options.recordState('not-started');
      return { state: 'not-started' };
    },
  });
  await runPreviewCommand('recover', r.options);
  assert.deepEqual(calls.map(([path]) => path), tags.map(tag => `/repos/ashproto/Resume-Designer/git/ref/tags/${tag}`));
  assert.ok(calls.every(([, options]) => !options || options.method === 'GET'));
  assert.equal(ordered.currentTag, actual);
  assert.equal(recorded.tag, actual);
  assert.equal(recorded.sha, sha);
  assert.ok(!r.trace.includes('guard') && !r.trace.includes('bind'));
});

for (const scenario of ['missing', 'both', 'annotated', 'wrong-sha', 'wrong-ref', 'unknown-response', 'forbidden', 'transport']) {
  test(`recovery refuses ${scenario} reservation identity without delivery or mutation`, async () => {
    const tags = [`ios-testflight/pr/158/2468-${sha}`, `ios-testflight/pr/158/2468/${sha}`], calls = [];
    let delivered = false;
    const r = runtime({ eventName: 'workflow_dispatch', event: { inputs: { request_tag: request.requestTag } },
      authorize: async () => ({ ...request, monitorOnly: true }),
      gh: { request: async (path, options) => {
        calls.push([path, options]);
        if (scenario === 'forbidden') throw Object.assign(new Error('Forbidden'), { status: 403 });
        if (scenario === 'transport') throw new Error('Transport failure');
        if (scenario === 'missing' || (scenario !== 'both' && path.endsWith(tags[1]))) throw Object.assign(new Error('Not found'), { status: 404 });
        if (scenario === 'unknown-response') return {};
        return { ref: `refs/tags/${scenario === 'wrong-ref' ? 'unknown/tag' : path.endsWith(tags[0]) ? tags[0] : tags[1]}`,
          object: { type: scenario === 'annotated' ? 'tag' : 'commit', sha: scenario === 'wrong-sha' ? 'c'.repeat(40) : sha } };
      } },
      deliver: async () => { delivered = true; return {}; },
    });
    await assert.rejects(runPreviewCommand('recover', r.options), /reservation|ref|recover/i);
    assert.equal(delivered, false);
    assert.ok(calls.every(([path, options]) => tags.some(tag => path === `/repos/ashproto/Resume-Designer/git/ref/tags/${tag}`)
      && (!options || options.method === 'GET')));
  });
}
