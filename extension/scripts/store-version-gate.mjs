import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareChromeVersions, parseChromeVersion } from './chrome-version.mjs';

const EXACT_PACKAGE_PATHS = new Set([
  'extension/manifest.json',
  'extension/package-lock.json',
  'extension/package.json',
  'extension/scripts/chrome-version.mjs',
  'extension/scripts/store-package.mjs',
  'extension/sidepanel.html',
  'extension/vite.config.js',
]);
const PACKAGE_PATH_PREFIXES = Object.freeze([
  'extension/icons/',
  'extension/src/',
]);

export function isPackageAffectingPath(path) {
  return EXACT_PACKAGE_PATHS.has(path)
    || PACKAGE_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function evaluateStoreVersionGate({ baseVersion, changedPaths, currentVersion }) {
  parseChromeVersion(currentVersion);
  const releaseRequired = changedPaths.some(isPackageAffectingPath);
  if (!releaseRequired) {
    return { baseVersion: baseVersion ?? '', currentVersion, releaseRequired: false };
  }
  if (baseVersion) {
    parseChromeVersion(baseVersion);
    if (compareChromeVersions(currentVersion, baseVersion) <= 0) {
      throw new Error(
        `Store package inputs changed, so extension version must increase beyond ${baseVersion}; found ${currentVersion}`,
      );
    }
  }
  return { baseVersion: baseVersion ?? '', currentVersion, releaseRequired: true };
}

function git(...arguments_) {
  return execFileSync('git', arguments_, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function manifestVersionAt(reference) {
  try {
    return JSON.parse(git('show', `${reference}:extension/manifest.json`)).version;
  } catch (error) {
    if (error?.status === 128) return null;
    throw error;
  }
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const baseReference = process.argv[2];
  const headReference = process.argv[3] || 'HEAD';
  if (!baseReference) throw new Error('Usage: node store-version-gate.mjs BASE_REF [HEAD_REF]');

  const changedPaths = git(
    'diff',
    '--name-only',
    '--diff-filter=ACMRTD',
    baseReference,
    headReference,
    '--',
    'extension',
  ).split('\n').filter(Boolean);
  const result = evaluateStoreVersionGate({
    baseVersion: manifestVersionAt(baseReference),
    changedPaths,
    currentVersion: manifestVersionAt(headReference),
  });

  process.stdout.write(`release_required=${String(result.releaseRequired)}\n`);
  process.stdout.write(`base_version=${result.baseVersion}\n`);
  process.stdout.write(`current_version=${result.currentVersion}\n`);
}
