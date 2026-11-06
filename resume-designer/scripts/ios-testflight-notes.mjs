#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function previewNotes(env) {
  if (!env.CI_TAG?.startsWith('ios-testflight/pr/')) return undefined;
  const match = /^ios-testflight\/pr\/([1-9]\d*)\/([1-9]\d*)[/-]([a-f0-9]{40})$/.exec(env.CI_TAG);
  if (!match || match[0] !== env.CI_TAG || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2]))
    || env.CI_XCODE_CLOUD !== 'TRUE' || match[3] !== env.CI_COMMIT || !/^[1-9]\d*$/.test(env.CI_BUILD_NUMBER || '')) {
    throw new Error('Refusing preview notes with unverified source or build identity');
  }
  return `On Paper Dev — PR #${match[1]}\nSource commit: ${match[3]}\nOwner request: ${match[2]}\nBuild: ${env.CI_BUILD_NUMBER}\n\nTest the changes in this owner-approved PR. This build uses your existing On Paper app and CloudKit data.\n`;
}

export function writePreviewNotes(env, projectDirectory) {
  const text = previewNotes(env);
  if (text === undefined) return;
  const directory = join(projectDirectory, 'TestFlight');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'WhatToTest.en-US.txt'), text);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3) throw new Error('Expected the trusted Xcode project directory');
  writePreviewNotes(process.env, process.argv[2]);
}
