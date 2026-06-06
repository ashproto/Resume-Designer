import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJsonPath = path.resolve(__dirname, '../../package.json');

// execFileSync (no shell) instead of exec/execSync: arguments are passed as an
// array, so a maliciously-named git tag can never be interpreted as a command.
function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function bumpVersion(version, bumpType) {
  const parsed = parseVersion(version);
  if (!parsed) {
    throw new Error(`Invalid semantic version: ${version}`);
  }

  if (bumpType === 'major') {
    return `${parsed.major + 1}.0.0`;
  }
  if (bumpType === 'minor') {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function detectBumpType(logText) {
  const text = (logText || '').toLowerCase();

  const hasBreaking =
    /breaking change/i.test(logText) ||
    /^\w+(\(.+\))?!:/m.test(logText);
  if (hasBreaking) return 'major';

  const hasFeature = /^feat(\(.+\))?:/m.test(text);
  if (hasFeature) return 'minor';

  return 'patch';
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  const fallbackVersion = pkg.version;

  // First line of the version-sorted v* tag list = the latest stable tag.
  const allTags = git(['tag', '-l', 'v*', '--sort=-v:refname']);
  const latestTag = allTags ? allTags.split('\n')[0].trim() : '';
  const taggedVersion = latestTag.replace(/^v/, '');
  const baseVersion = parseVersion(taggedVersion)
    ? taggedVersion
    : fallbackVersion;

  const range = latestTag ? `${latestTag}..HEAD` : 'HEAD';
  const commitLog = git(['log', range, '--pretty=format:%s%n%b%n---END---']);
  const bumpType = detectBumpType(commitLog);
  const computed = bumpVersion(baseVersion, bumpType);

  // RELEASE_CHANNEL=next produces a pre-release version on the rolling `next`
  // tag; anything else is a stable, version-tagged release.
  const channel = process.env.RELEASE_CHANNEL === 'next' ? 'next' : 'stable';
  // RELEASE_VERSION_OVERRIDE (from the workflow_dispatch input) is a deterministic
  // escape hatch: for stable it IS the version, for next it's the base.
  const override = (process.env.RELEASE_VERSION_OVERRIDE || '').trim();

  let version;
  let tag;
  if (channel === 'next') {
    const base = override || computed;
    const runNumber = process.env.GITHUB_RUN_NUMBER || '0';
    version = `${base}-next.${runNumber}`;
    tag = 'next';
  } else {
    version = override || computed;
    tag = `v${version}`;
  }

  process.stdout.write(`version=${version}\n`);
  process.stdout.write(`tag=${tag}\n`);
  process.stdout.write(`channel=${channel}\n`);
  process.stdout.write(`previous_tag=${latestTag}\n`);
  process.stdout.write(`bump=${bumpType}\n`);
}

main();
