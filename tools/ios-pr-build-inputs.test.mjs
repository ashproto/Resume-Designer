import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { assertPreviewBuildInputs, compareBuildInputs } from './ios-pr-build-inputs.mjs';

const entry = (path, object = 'a'.repeat(40), mode = '100644', type = 'blob') => ({ path, object, mode, type });
const changed = path => entry(path, 'b'.repeat(40));

test('ordinary application edits, additions and deletions remain previewable', () => {
  const paths = [
    'resume-designer/src-tauri/ios/OPShell.swift', 'resume-designer/src/iosShell.js',
    'resume-designer/src/native-shell.css', 'resume-designer/src-tauri/src/lib.rs',
    'resume-designer/test/iosShell.test.js', 'docs/ios/next-chat-and-zoom.md',
    'resume-designer/src/odd\tname\n.js',
  ];
  const trusted = paths.map(path => entry(path));
  assert.doesNotThrow(() => compareBuildInputs(paths.map(changed), trusted));
  assert.doesNotThrow(() => compareBuildInputs([...trusted, entry('resume-designer/src/new.jsx')], trusted));
  assert.doesNotThrow(() => compareBuildInputs([], trusted));
});

const protectedPaths = [
  '.github/workflows/ci.yml', '.github/actions/setup/action.yml', 'tools/ios-cloud-release.mjs',
  'tools/ios-new-hook.mjs', 'resume-designer/scripts/new-hook.sh', 'scripts/bootstrap.sh',
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'resume-designer/package.json',
  'resume-designer/src/package.json', '.npmrc', 'resume-designer/.npmrc', '.yarnrc', '.yarnrc.yml',
  'yarn.lock', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'bun.lock', 'bun.lockb', '.pnp.cjs',
  '.pnp.data.json', '.pnpmfile.cjs', 'pnpmfile.cjs', 'yarn.config.cjs', 'bunfig.toml',
  '.env', '.env.production.local', 'resume-designer/.env.production',
  'lerna.json', 'rush.json', '.nvmrc', '.node-version', '.tool-versions', 'mise.toml', '.mise.toml',
  'vite.config.js', 'resume-designer/vite.config.mts', 'resume-designer/vite.config.cjs',
  'resume-designer/postcss.config.ts', 'resume-designer/postcss.config.cts', '.postcssrc',
  '.postcssrc.json', 'resume-designer/src/.postcssrc.yaml', '.postcssrc.cjs',
  'tailwind.config.mjs', 'babel.config.json', '.babelrc', '.babelrc.js', '.swcrc',
  '.browserslistrc', 'browserslist',
  'webpack.config.cjs', 'rollup.config.ts', 'esbuild.config.mjs', 'tsconfig.json',
  'resume-designer/tsconfig.build.json', 'resume-designer/jsconfig.json', 'vitest.config.mjs',
  'Cargo.toml', 'Cargo.lock', 'resume-designer/Cargo.toml', 'resume-designer/src-tauri/build.rs',
  '.cargo/config', '.cargo/config.toml', 'resume-designer/.cargo/config.toml',
  'rust-toolchain', 'rust-toolchain.toml', 'resume-designer/src-tauri/rust-toolchain.toml',
  'resume-designer/src-tauri/tauri.conf.json', 'resume-designer/src-tauri/tauri.ios.conf.json',
  'resume-designer/src-tauri/tauri.conf.json5', 'resume-designer/src-tauri/tauri.ios.conf.json5',
  'resume-designer/src-tauri/Tauri.toml', 'resume-designer/src-tauri/Tauri.ios.toml',
  'resume-designer/src-tauri/capabilities/new.json', 'resume-designer/src-tauri/permissions/new.toml',
  'resume-designer/src-tauri/Info.ios.plist', 'resume-designer/src-tauri/Entitlements.plist',
  'resume-designer/src-tauri/ios/App.entitlements', 'resume-designer/src-tauri/ios/Release.xcconfig',
  'resume-designer/src-tauri/ios/module.modulemap', 'Package.swift', 'Package.resolved',
  '.swiftpm/configuration/registries.json', 'Podfile', 'Podfile.lock', '.xcode.env',
  'Gemfile', 'Gemfile.lock', 'CMakeLists.txt', '.gitmodules', '.gitattributes',
  'resume-designer/src-tauri/gen/apple/ci_scripts/ci_post_clone.sh',
  'resume-designer/src-tauri/gen/apple/resume-designer.xcodeproj/project.pbxproj',
  'resume-designer/src-tauri/gen/apple/Assets.xcassets/new.png',
  'resume-designer/src-tauri/gen/apple/new/unknown-file',
  'new.xcodeproj/xcshareddata/xcschemes/new.xcscheme', 'new.xcworkspace/contents.xcworkspacedata',
  'resume-designer/POSTCSS.CONFIG.JS',
];
for (const path of protectedPaths) {
  test(`protects additions, deletions, content and mode at ${path}`, () => {
    assert.doesNotThrow(() => compareBuildInputs([entry(path)], [entry(path)]));
    for (const [candidate, trusted] of [
      [[entry(path)], []], [[], [entry(path)]], [[changed(path)], [entry(path)]],
      [[entry(path, 'a'.repeat(40), '100755')], [entry(path)]],
    ]) assert.throws(() => compareBuildInputs(candidate, trusted), /build input/i);
  });
}

const forbiddenPaths = [
  'node_modules/.bin/vite', 'resume-designer/node_modules/.bin/vite', 'resume-designer/dist/index.html',
  'resume-designer/target/release/app', 'resume-designer/src-tauri/target/debug/build/payload',
  '.cargo/bin/cargo', '.rustup/toolchains/stable/bin/rustc', '.yarn/releases/yarn.cjs',
  'resume-designer/src-tauri/gen/apple/build/ci-tools/node/bin/node',
  'resume-designer/src-tauri/gen/apple/build/ci-tools/cargo/bin/rustup',
  'resume-designer/src-tauri/gen/apple/build/ci-native/swift-bin/swift',
  'resume-designer/src-tauri/gen/apple/Externals/arm64/release/libapp.a',
  'resume-designer/src-tauri/gen/apple/build', 'resume-designer/.bin/node',
  '.pnpm-store/evil', 'resume-designer/.vite/cache', 'DerivedData/Build/product',
  'resume-designer/src-tauri/tools/nsis/makensis',
];
for (const path of forbiddenPaths) {
  test(`refuses candidate prepopulated bootstrap path ${path}, even unchanged`, () => {
    assert.throws(() => compareBuildInputs([entry(path)], []), /build input/i);
    assert.throws(() => compareBuildInputs([entry(path)], [entry(path)]), /build input/i);
  });
}

test('refuses new or changed symlinks, gitlinks, executable modes and directory replacements', () => {
  for (const [mode, type] of [['120000', 'blob'], ['160000', 'commit'], ['100755', 'blob']]) {
    const candidate = entry('resume-designer/src/payload.js', 'b'.repeat(40), mode, type);
    assert.throws(() => compareBuildInputs([candidate], []), /build input/i);
    assert.throws(() => compareBuildInputs([candidate], [entry(candidate.path)]), /build input/i);
  }
  const link = entry('resume-designer/src/link', 'a'.repeat(40), '120000');
  assert.doesNotThrow(() => compareBuildInputs([link], [link]));
  assert.throws(() => compareBuildInputs([{ ...link, object: 'b'.repeat(40) }], [link]), /build input/i);
  assert.throws(() => compareBuildInputs([entry('resume-designer/scripts', 'a'.repeat(40), '120000')], []), /build input/i);
  assert.throws(() => compareBuildInputs([entry('resume-designer/src', 'b'.repeat(40))], [entry('resume-designer/src', 'a'.repeat(40), '040000', 'tree')]), /build input/i);
});

test('ordinary ancestor tree hashes can change while protected tree identity cannot', () => {
  assert.doesNotThrow(() => compareBuildInputs([entry('resume-designer', 'b'.repeat(40), '040000', 'tree')], [entry('resume-designer', 'a'.repeat(40), '040000', 'tree')]));
  assert.throws(() => compareBuildInputs([entry('resume-designer/scripts', 'b'.repeat(40), '040000', 'tree')], [entry('resume-designer/scripts', 'a'.repeat(40), '040000', 'tree')]), /build input/i);
});

test('rejects ambiguous entries and malformed or noncanonical Git metadata', () => {
  for (const entries of [null, [entry('../package.json')], [entry('/package.json')],
    [entry('a//package.json')], [entry('a/./package.json')], [entry('a\\package.json')],
    [entry('')], [entry('a\0b')], [entry('x', 'bad')], [entry('x', 'a'.repeat(40), '100644', 'tree')],
    [entry('x'), entry('x')], [entry('x'), entry('X')], [entry('é.js'), entry('e\u0301.js')],
  ]) assert.throws(() => compareBuildInputs(entries, []), /build input/i);
  assert.throws(() => compareBuildInputs([], [entry('../bad')]), /build input/i);
  for (const invalid of [
    { path: 'x', object: 'a'.repeat(40) },
    { ...entry('x'), mode: '000000', type: undefined },
    { ...entry('x'), object: { toString: () => 'a'.repeat(40) } },
  ]) assert.throws(() => compareBuildInputs([invalid], [invalid]), /build input/i);
});

function repository(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'on-paper-input-guard-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
  git('init', '--quiet');
  const write = (path, value) => { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), value); };
  const commit = () => {
    git('add', '--all');
    git('-c', 'user.name=Guard Test', '-c', 'user.email=guard@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  write('resume-designer/src/iosShell.js', 'old');
  write('resume-designer/package.json', '{"scripts":{"build":"false"}}');
  return { cwd, git, write, commit, trustedSha: commit() };
}

test('inspects complete commit trees without checkout or executing candidate code', async t => {
  const { cwd, git, write, commit, trustedSha } = repository(t);
  write('resume-designer/src/iosShell.js', 'throw new Error("must never execute")');
  write('resume-designer/src/tab\tand\nnewline.js', 'candidate');
  const candidateSha = commit();
  write('resume-designer/src/iosShell.js', 'preserve worktree');
  const before = git('status', '--porcelain');
  await assertPreviewBuildInputs({ candidateSha, trustedSha, cwd });
  assert.equal(git('status', '--porcelain'), before);
  assert.equal(readFileSync(join(cwd, 'resume-designer/src/iosShell.js'), 'utf8'), 'preserve worktree');
  assert.equal(git('rev-parse', 'HEAD'), candidateSha);
  write('.postcssrc.cjs', 'throw new Error("must never execute")');
  const unsafeSha = commit();
  await assert.rejects(assertPreviewBuildInputs({ candidateSha: unsafeSha, trustedSha, cwd }), /build input/i);
});

test('real Git symlinks, gitlinks, modes and empty protected trees cannot evade comparison', async t => {
  const { cwd, git, trustedSha } = repository(t);
  const blob = git('rev-parse', `${trustedSha}:resume-designer/src/iosShell.js`);
  for (const [mode, type, object, path] of [
    ['120000', 'blob', blob, 'source'], ['160000', 'commit', trustedSha, 'source'],
    ['100755', 'blob', blob, 'source'], ['040000', 'tree', git('mktree'), '.github'],
  ]) {
    const tree = execFileSync('git', ['mktree'], { cwd, input: `${git('ls-tree', trustedSha)}\n${mode} ${type} ${object}\t${path}\n`, encoding: 'utf8' }).trim();
    const candidateSha = git('-c', 'user.name=Guard Test', '-c', 'user.email=guard@example.invalid', 'commit-tree', tree, '-m', 'fixture');
    await assert.rejects(assertPreviewBuildInputs({ candidateSha, trustedSha, cwd }), /build input/i);
  }
});

test('non-UTF-8 Git path bytes are refused rather than decoded ambiguously', async t => {
  const { cwd, git, trustedSha } = repository(t);
  const blob = git('rev-parse', `${trustedSha}:resume-designer/src/iosShell.js`);
  const base = execFileSync('git', ['ls-tree', '-z', trustedSha], { cwd });
  const tree = execFileSync('git', ['mktree', '-z'], { cwd, input: Buffer.concat([
    base, Buffer.from(`100644 blob ${blob}\t`), Buffer.from([0xff, 0]),
  ]), encoding: 'utf8' }).trim();
  const candidateSha = git('-c', 'user.name=Guard Test', '-c', 'user.email=guard@example.invalid', 'commit-tree', tree, '-m', 'fixture');
  await assert.rejects(assertPreviewBuildInputs({ candidateSha, trustedSha, cwd }), /non-UTF-8/i);
});

test('requires full immutable commit IDs and refuses missing objects or non-commit objects', async t => {
  const { cwd, git, trustedSha } = repository(t);
  for (const candidateSha of ['HEAD', '--help', trustedSha.slice(0, 12), `${trustedSha};touch /tmp/guard`,
    'f'.repeat(40), git('rev-parse', `${trustedSha}^{tree}`), git('rev-parse', `${trustedSha}:resume-designer/package.json`)]) {
    await assert.rejects(assertPreviewBuildInputs({ candidateSha, trustedSha, cwd }));
  }
  await assert.rejects(assertPreviewBuildInputs({ candidateSha: trustedSha, trustedSha: 'HEAD', cwd }));
});

test('replacement refs cannot hide protected changes', async t => {
  const { cwd, git, write, commit, trustedSha } = repository(t);
  write('resume-designer/package.json', '{"scripts":{"build":"malicious"}}');
  const candidateSha = commit();
  git('replace', candidateSha, trustedSha);
  await assert.rejects(assertPreviewBuildInputs({ candidateSha, trustedSha, cwd }), /build input/i);
});
