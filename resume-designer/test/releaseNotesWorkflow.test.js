// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { splitReleaseBody } from '../src/changelogService.js';
import { validateDigest } from '../scripts/ci/validate-digest.mjs';

const workflow = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
const temporary = [];
const digest = (version, text = 'Curated feature.') => `## On Paper ${version}\n\n- ${text}\n\n<!-- digest:end -->\n`;
const step = (name) => workflow.split(/^ {6}- name: /m).find((value) => value.startsWith(`${name}\n`));
const read = (path, file) => readFileSync(join(path, file), 'utf8');

function workspace(files) {
  const path = mkdtempSync(join(tmpdir(), 'release-notes-'));
  temporary.push(path);
  mkdirSync(join(path, 'resume-designer/scripts/ci'), { recursive: true });
  mkdirSync(join(path, 'docs/releases'), { recursive: true });
  copyFileSync(new URL('../scripts/ci/validate-digest.mjs', import.meta.url), join(path, 'resume-designer/scripts/ci/validate-digest.mjs'));
  for (const [file, content] of Object.entries({ 'github-output': '', 'grouped-changelog.md': '- Full commit detail.\n', ...files })) writeFileSync(join(path, file), content);
  return path;
}

function run(name, path, env = {}) {
  const script = step(name)?.match(/^ {8}run: \|\n((?: {10}.*\n|\n)*)/m)?.[1];
  if (!script) throw new Error(`Missing workflow script: ${name}`);
  return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script.replace(/^ {10}/gm, '')], {
    cwd: path, encoding: 'utf8',
    env: { ...process.env, VERSION: '2.3.0', CHANNEL: 'stable', GITHUB_OUTPUT: join(path, 'github-output'), ...env },
  });
}
const select = (path, env) => run('Select curated release notes', path, env);
const finalize = (path, env) => run('Finalize release notes and body', path, env);
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

it('publishes validated curated stable notes with the existing full-log body', () => {
  const source = digest('2.3.0');
  const path = workspace({ 'docs/releases/2.3.0.md': source });
  const result = select(path);
  expect(result.status, result.stderr).toBe(0);
  expect(read(path, 'github-output')).toContain('available=true');
  expect(finalize(path, { CURATED_NOTES: 'true', AI_OK: 'false' }).status).toBe(0);
  expect(read(path, 'release-notes.md')).toBe(validateDigest(source, '2.3.0').notes);
  const body = splitReleaseBody(read(path, 'release-body.md'));
  expect(body.summary).toBe(read(path, 'release-notes.md').trim());
  expect(body.full).toBe('- Full commit detail.');
});

it.each([
  ['missing sentinel', digest('2.3.0').replace('<!-- digest:end -->', '')],
  ['wrong version', digest('2.2.0')],
])('fails visibly for curated notes with %s', (_reason, source) => {
  const path = workspace({ 'docs/releases/2.3.0.md': source });
  const result = select(path);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('digest rejected:');
  expect(read(path, 'github-output')).not.toContain('available=true');
});

it.each([
  ['missing exact stable file', '2.3.0', 'stable', { 'docs/releases/2.2.0.md': digest('2.2.0') }],
  ['beta, even with a malformed exact file', '2.3.0-next.157', 'next', { 'docs/releases/2.3.0-next.157.md': 'Invalid.', 'docs/releases/2.3.0.md': digest('2.3.0') }],
])('keeps AI notes for %s', (_name, version, channel, files) => {
  const ai = digest(version, 'AI feature.');
  const path = workspace({ ...files, 'digest-raw.md': ai });
  expect(select(path, { VERSION: version, CHANNEL: channel }).status).toBe(0);
  expect(read(path, 'github-output')).toContain('available=false');
  expect(finalize(path, { VERSION: version, CURATED_NOTES: 'false', AI_OK: 'true' }).status).toBe(0);
  expect(read(path, 'release-notes.md')).toBe(validateDigest(ai, version).notes);
});

it('preserves grouped fallback when curated notes and AI are unavailable', () => {
  const path = workspace({});
  expect(select(path).status).toBe(0);
  expect(finalize(path, { CURATED_NOTES: 'false', AI_OK: 'false' }).status).toBe(0);
  expect(read(path, 'release-notes.md')).toBe(read(path, 'grouped-changelog.md'));
  expect(read(path, 'release-body.md')).toBe(read(path, 'grouped-changelog.md'));
});

it('skips OpenRouter when curated notes were selected', () => {
  expect(step('Rewrite the changelog (OpenRouter)')).toContain("if: steps.curated_notes.outputs.available != 'true'");
});
