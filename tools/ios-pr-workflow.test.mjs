import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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
