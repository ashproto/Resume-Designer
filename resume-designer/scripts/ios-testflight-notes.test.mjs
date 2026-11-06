import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previewNotes, writePreviewNotes } from './ios-testflight-notes.mjs';

const sha = 'a'.repeat(40);
const env = { CI_XCODE_CLOUD:'TRUE', CI_TAG:`ios-testflight/pr/158/2468/${sha}`, CI_COMMIT:sha, CI_BUILD_NUMBER:'9' };

test('preview notes carry the exact PR, command, source and Apple build number for both tag formats', () => {
  const expected = `On Paper Dev — PR #158\nSource commit: ${sha}\nOwner request: 2468\nBuild: 9\n\nTest the changes in this owner-approved PR. This build uses your existing On Paper app and CloudKit data.\n`;
  for (const tag of [env.CI_TAG, `ios-testflight/pr/158/2468-${sha}`]) {
    assert.equal(previewNotes({ ...env, CI_TAG: tag }), expected);
  }
  assert.equal(previewNotes({...env,CI_TAG:`ios-testflight/next/${sha}`}), undefined);
  for (const overrides of [{CI_COMMIT:'b'.repeat(40)},{CI_TAG:`ios-testflight/pr/0/2468/${sha}`},{CI_TAG:`${env.CI_TAG}\n`},{CI_BUILD_NUMBER:'9\n'},{CI_BUILD_NUMBER:'bad'},{CI_XCODE_CLOUD:''}]) {
    assert.throws(() => previewNotes({...env,...overrides}));
  }
});

test('preview notes refuse malformed or unsafe PR and command identities in either tag format', () => {
  for (const separator of ['/', '-']) {
    const valid = `ios-testflight/pr/9007199254740991/9007199254740991${separator}${sha}`;
    assert.ok(previewNotes({ ...env, CI_TAG: valid }).includes('Owner request: 9007199254740991'));
    for (const [pr, comment] of [['0', '1'], ['1', '0'], ['01', '1'], ['1', '01'],
      ['-1', '1'], ['1', '+1'], ['1.5', '1'], ['1', '1e3'], ['', '1'], ['1', ''],
      ['9007199254740992', '1'], ['1', '9007199254740992'],
      ['999999999999999999999999', '1'], ['1', '999999999999999999999999']]) {
      assert.throws(() => previewNotes({ ...env, CI_TAG: `ios-testflight/pr/${pr}/${comment}${separator}${sha}` }));
    }
    const tag = `ios-testflight/pr/158/2468${separator}${sha}`;
    for (const invalid of [tag + '/extra', tag + '\n', tag + 'a', tag.replace(sha, sha.slice(0, 39)), tag.replace(sha, sha.toUpperCase()),
      tag.replace(sha, 'g'.repeat(40))]) {
      assert.throws(() => previewNotes({ ...env, CI_TAG: invalid }));
    }
  }
});

test('notes are generated beside the Xcode project only for valid previews', t => {
  const project = mkdtempSync(join(tmpdir(),'on-paper-notes-'));
  t.after(() => rmSync(project,{recursive:true,force:true}));
  writePreviewNotes({...env,CI_TAG:`ios-testflight/main/${sha}`}, project);
  assert.equal(existsSync(join(project,'TestFlight')),false);
  for (const tag of [env.CI_TAG, `ios-testflight/pr/158/2468-${sha}`]) {
    writePreviewNotes({ ...env, CI_TAG: tag }, project);
    assert.equal(readFileSync(join(project,'TestFlight/WhatToTest.en-US.txt'),'utf8'),
      `On Paper Dev — PR #158\nSource commit: ${sha}\nOwner request: 2468\nBuild: 9\n\nTest the changes in this owner-approved PR. This build uses your existing On Paper app and CloudKit data.\n`);
  }
});
