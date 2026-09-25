import { describe, expect, it } from 'vitest';

import {
  evaluateStoreVersionGate,
  isPackageAffectingPath,
} from '../scripts/store-version-gate.mjs';

describe('isPackageAffectingPath', () => {
  it('covers every input that can change Store package bytes', () => {
    for (const path of [
      'extension/manifest.json',
      'extension/package.json',
      'extension/package-lock.json',
      'extension/sidepanel.html',
      'extension/privacy.html',
      'extension/privacy.css',
      'extension/vite.config.js',
      'extension/icons/128.png',
      'extension/src/sidepanel/App.jsx',
      'extension/scripts/chrome-version.mjs',
      'extension/scripts/store-package.mjs',
    ]) {
      expect(isPackageAffectingPath(path), path).toBe(true);
    }
  });

  it('does not require a Store version for tests, docs, lint, or publishing automation', () => {
    for (const path of [
      'extension/README.md',
      'extension/eslint.config.js',
      'extension/test/storePackage.test.js',
      'extension/scripts/cws-publish.mjs',
      'docs/chrome-web-store-release.md',
      '.github/workflows/chrome-extension-release.yml',
    ]) {
      expect(isPackageAffectingPath(path), path).toBe(false);
    }
  });
});

describe('evaluateStoreVersionGate', () => {
  it('requires a strictly newer version when package inputs changed', () => {
    expect(evaluateStoreVersionGate({
      baseVersion: '1.2.3',
      changedPaths: ['extension/src/background.js'],
      currentVersion: '1.2.4',
    })).toEqual({
      baseVersion: '1.2.3',
      currentVersion: '1.2.4',
      releaseRequired: true,
    });

    for (const currentVersion of ['1.2.3', '1.2.2', '1.2.3.0']) {
      expect(() => evaluateStoreVersionGate({
        baseVersion: '1.2.3',
        changedPaths: ['extension/icons/128.png'],
        currentVersion,
      })).toThrow(/newer|increase|version/i);
    }
  });

  it('skips non-package changes and treats a missing base manifest as the initial release', () => {
    expect(evaluateStoreVersionGate({
      baseVersion: '1.2.3',
      changedPaths: ['extension/README.md'],
      currentVersion: '1.2.3',
    })).toMatchObject({ releaseRequired: false });

    expect(evaluateStoreVersionGate({
      baseVersion: null,
      changedPaths: ['extension/manifest.json'],
      currentVersion: '0.1.0',
    })).toEqual({
      baseVersion: '',
      currentVersion: '0.1.0',
      releaseRequired: true,
    });
  });
});
