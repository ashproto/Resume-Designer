import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previewNotes, writePreviewNotes } from './ios-testflight-notes.mjs';

const sha = 'a'.repeat(40);
const env = { CI_XCODE_CLOUD:'TRUE', CI_TAG:`ios-testflight/pr/158/2468/${sha}`, CI_COMMIT:sha, CI_BUILD_NUMBER:'9' };

test('preview notes carry the exact PR, command, source and Apple build number', () => {
  const text = previewNotes(env);
  for (const value of ['On Paper Dev', 'PR #158', '2468', sha, 'Build: 9', 'existing On Paper']) assert.ok(text.includes(value));
  assert.equal(previewNotes({...env,CI_TAG:`ios-testflight/next/${sha}`}), undefined);
  for (const overrides of [{CI_COMMIT:'b'.repeat(40)},{CI_TAG:`ios-testflight/pr/0/2468/${sha}`},{CI_TAG:`${env.CI_TAG}\n`},{CI_BUILD_NUMBER:'9\n'},{CI_BUILD_NUMBER:'bad'},{CI_XCODE_CLOUD:''}]) {
    assert.throws(() => previewNotes({...env,...overrides}));
  }
});

test('notes are generated beside the Xcode project only for valid previews', t => {
  const project = mkdtempSync(join(tmpdir(),'on-paper-notes-'));
  t.after(() => rmSync(project,{recursive:true,force:true}));
  writePreviewNotes({...env,CI_TAG:`ios-testflight/main/${sha}`}, project);
  assert.equal(existsSync(join(project,'TestFlight')),false);
  writePreviewNotes(env,project);
  assert.equal(readFileSync(join(project,'TestFlight/WhatToTest.en-US.txt'),'utf8'),previewNotes(env));
});
