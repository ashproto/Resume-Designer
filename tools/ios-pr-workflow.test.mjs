import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const preview = readFileSync(new URL('../.github/workflows/ios-testflight-pr.yml', import.meta.url), 'utf8');
const production = readFileSync(new URL('../.github/workflows/ios-testflight.yml', import.meta.url), 'utf8');
const jobs = Object.fromEntries(preview.slice(preview.indexOf('\njobs:\n') + 7).split(/(?=^  [a-z][a-z-]*:\n)/m)
  .filter(Boolean).map(text => [text.match(/^  ([a-z][a-z-]*):/)[1], text]));

test('public comments cannot allocate the privileged queue and only created commands are considered', () => {
  assert.match(preview, /issue_comment:\n\s+types: \[created\]/);
  assert.doesNotMatch(preview, /pull_request_target:/);
  for (const invariant of ["github.repository_id == '1163653093'", 'github.event.sender.id == 35086581', "github.triggering_actor == 'ashproto'", "github.ref == 'refs/heads/main'"]) {
    assert.ok(jobs.authorize.includes(invariant));
  }
  assert.doesNotMatch(jobs.authorize, /\n\s+concurrency:/);
  assert.doesNotMatch(jobs.bind, /\n\s+concurrency:/);
  assert.match(jobs.deliver, /needs\.authorize\.result == 'success'/);
  assert.match(jobs.deliver, /needs\.bind\.result == 'success'/);
});

test('credentials and write permissions are separated from feedback and candidate code', () => {
  for (const [name, body] of Object.entries(jobs)) {
    if (name !== 'deliver') assert.doesNotMatch(body, /secrets\.|environment: ios-testflight/);
    for (const uses of body.matchAll(/uses: (actions\/[\w-]+)@([^\s]+)/g)) assert.match(uses[2], /^[a-f0-9]{40}$/);
    for (const checkout of body.matchAll(/uses: actions\/checkout@[^\n]+\n([\s\S]*?)(?=\n\s+- |$)/g)) {
      assert.match(checkout[1], /ref: \$\{\{ github\.sha \}\}/);
      assert.match(checkout[1], /persist-credentials: false/);
    }
    assert.doesNotMatch(body, /run:.*(?:npm (?:ci|install)|git checkout|gh pr checkout)/);
    assert.doesNotMatch(body, /run:.*\$\{\{.*(?:comment\.body|head\.ref)/);
    if (name.includes('feedback')) assert.doesNotMatch(body, /contents: write|statuses: write/);
  }
  assert.match(jobs.deliver, /environment: ios-testflight/);
  assert.match(jobs.deliver, /statuses: write/);
});

test('both delivery lanes share the app queue and the production lane retains its protected push gate', () => {
  for (const text of [production, jobs.deliver]) {
    assert.match(text, /group: ios-testflight-com-onpaper-app/);
    assert.match(text, /cancel-in-progress: false/);
    assert.match(text, /queue: max/);
  }
  assert.match(production, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(production, /run: node tools\/ios-release-gate\.mjs/);
  assert.match(production, /XCODE_CLOUD_PR_WORKFLOW_ID: \$\{\{ vars\.XCODE_CLOUD_PR_WORKFLOW_ID \}\}/);
});

// The delivery condition uses the shared JS/GitHub expression subset. Exercise
// it with retained dependency outputs, as a partial workflow rerun actually does.
test('partial reruns cannot reuse successful owner dependencies to schedule another actor', () => {
  const expression = jobs.deliver.match(/^    if: >-\n([\s\S]*?)^    runs-on:/m)[1].trim();
  for (const recovery of [false, true]) {
    const context = { always: () => true, github: { repository_id:'1163653093', repository_owner_id:'35086581', ref:'refs/heads/main', event:{sender:{id:35086581}}, triggering_actor:'ashproto' },
      needs: { authorize:{result:'success',outputs:{skip:'false',monitor_only:recovery ? 'true' : 'false'}}, bind:{result:recovery ? 'skipped' : 'success'} } };
    assert.equal(runInNewContext(expression,context,{timeout:100}),true);
    context.github.triggering_actor = 'other-collaborator';
    assert.equal(runInNewContext(expression,context,{timeout:100}),false);
    context.github.triggering_actor = 'ashproto';
    context.github.ref = 'refs/heads/feature';
    assert.equal(runInNewContext(expression,context,{timeout:100}),false);
  }
});

test('metadata-only dispatch cannot accept delivery outcomes or allocate any build job', () => {
  const path = new URL('../.github/workflows/ios-pr-testflight-feedback.yml', import.meta.url);
  assert.equal(existsSync(path), true, 'a dedicated metadata-only workflow is required');
  const workflow = readFileSync(path, 'utf8');
  assert.match(workflow, /on:\n  workflow_dispatch:\n    inputs:\n      request_tag:/);
  const inputs = workflow.match(/    inputs:\n([\s\S]*?)\npermissions:/)[1];
  assert.deepEqual([...inputs.matchAll(/^      ([a-z_]+):/gm)].map(match => match[1]), ['request_tag']);
  assert.doesNotMatch(workflow, /issue_comment:|workflow_run:|pull_request|push:/);
  const jobs = workflow.slice(workflow.indexOf('\njobs:\n') + 7);
  assert.deepEqual([...jobs.matchAll(/^  ([a-z-]+):/gm)].map(match => match[1]), ['feedback']);
  assert.match(jobs, /timeout-minutes: 5/);
  assert.doesNotMatch(jobs, /secrets\.|environment:|concurrency:|needs:|contents: write|statuses: write|actions:|APP_STORE|XCODE_CLOUD|npm (?:ci|install)/);
  const permissions = jobs.match(/^    permissions:\n([\s\S]*?)^    steps:/m)[1];
  assert.deepEqual(permissions.trim().split('\n').map(line => line.trim()), ['contents: read', 'issues: write', 'pull-requests: read']);
  assert.match(jobs, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(jobs, /persist-credentials: false/);
  assert.match(jobs, /package-manager-cache: false/);
  assert.deepEqual([...jobs.matchAll(/^        run: (.+)$/gm)].map(match => match[1]), ['node tools/ios-pr-testflight.mjs feedback']);
  assert.match(jobs, /PREVIEW_FEEDBACK_REPAIR: ['"]true['"]/);
  assert.doesNotMatch(jobs, /PREVIEW_STATE:|PREVIEW_ERROR:|PREVIEW_BUILD_NUMBER:|PREVIEW_CLOUD_RUN_ID:|github\.event\.inputs/);
  for (const action of jobs.matchAll(/uses: actions\/[\w-]+@([^\s]+)/g)) assert.match(action[1], /^[a-f0-9]{40}$/);
  const expression = jobs.match(/^    if: >-\n([\s\S]*?)^    runs-on:/m)[1].trim();
  const github = { repository_id: '1163653093', repository_owner_id: '35086581', ref: 'refs/heads/main',
    event_name: 'workflow_dispatch', event: { sender: { id: 35086581 } }, triggering_actor: 'ashproto' };
  assert.equal(runInNewContext(expression, { github }, { timeout: 100 }), true);
  for (const [key, value] of [['repository_id','1'], ['repository_owner_id','1'], ['ref','refs/heads/feature'],
    ['event_name','issue_comment'], ['triggering_actor','other']]) {
    assert.equal(runInNewContext(expression, { github: { ...github, [key]: value } }, { timeout: 100 }), false);
  }
  assert.equal(runInNewContext(expression, { github: { ...github, event: { sender: { id: 1 } } } }, { timeout: 100 }), false);
});
