import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { cargoBuildPlan, unsignedBuildPlans } from './ios-ci.mjs';

const scripts = fileURLToPath(new URL('.', import.meta.url));
const sha = 'a'.repeat(40);
const cloudEnv = { CI_XCODE_CLOUD: 'TRUE', CI_TAG: `ios-testflight/next/${sha}`, CI_COMMIT: sha, CI_BUILD_NUMBER: '42' };
function gate(overrides = {}) {
  return spawnSync('/bin/bash', ['-c', 'source "$1/ios-ci-env.sh"; op_ios_ci_cloud_gate', 'test', scripts], {
    env: { PATH: process.env.PATH, ...cloudEnv, ...overrides }, encoding: 'utf8',
  });
}

test('Cloud accepts main and next exact-commit tags', () => {
  for (const branch of ['main', 'next']) {
    assert.equal(gate({ CI_TAG: `ios-testflight/${branch}/${sha}` }).status, 0);
  }
});

test('Cloud refuses desktop, branch, pull request, mismatched commit and malformed build number before setup', () => {
  for (const invalid of [
    { CI_TAG: 'v1.0.0' }, { CI_TAG: 'next' }, { CI_TAG: '' },
    { CI_TAG: `ios-testflight/feature/${sha}` }, { CI_COMMIT: 'b'.repeat(40) },
    { CI_TAG: `ios-testflight/next/${sha.slice(0, 7)}` }, { CI_PULL_REQUEST_NUMBER: '12' },
    { CI_GIT_REF: 'refs/heads/next' }, { CI_BUILD_NUMBER: '0' }, { CI_BUILD_NUMBER: '1;echo bad' },
  ]) {
    const result = gate(invalid);
    assert.notEqual(result.status, 0, JSON.stringify(invalid));
    assert.match(result.stderr, /refus/i);
  }
});

const buildInput = {
  appRoot: '/repo/resume-designer', outputRoot: '/tmp/isolated', sdkRoot: '/Xcode/iPhone.sdk',
  macSdkRoot: '/Xcode/MacOSX.sdk', platform: 'iphoneos', configuration: 'release', arch: 'arm64',
  env: { PATH: '/bin', SDKROOT: '/wrong', CFLAGS: '-isysroot /wrong', RUSTFLAGS: '-L /wrong',
    FRAMEWORK_SEARCH_PATHS: '/iOS-only', IPHONEOS_DEPLOYMENT_TARGET: '26.0' },
};

test('device Rust uses locked release staticlib with embedded frontend and isolated output', () => {
  const plan = cargoBuildPlan(buildInput);
  assert.deepEqual(plan.args, ['build', '--locked', '--lib', '--target', 'aarch64-apple-ios', '--features', 'tauri/custom-protocol', '--release']);
  assert.equal(plan.library, '/tmp/isolated/cargo/aarch64-apple-ios/release/libon_paper_lib.a');
  assert.equal(plan.destination, '/repo/resume-designer/src-tauri/gen/apple/Externals/arm64/release/libapp.a');
  assert.equal(plan.env.TAURI_IOS_APP_NAME, 'resume-designer');
  assert.equal(plan.env.TAURI_CONFIG, '{"version":"1.0.0"}');
});

test('host compiler never inherits target SDK or unscoped framework flags', () => {
  const { env } = cargoBuildPlan(buildInput);
  for (const name of ['SDKROOT', 'CFLAGS', 'RUSTFLAGS', 'FRAMEWORK_SEARCH_PATHS']) assert.equal(env[name], undefined, name);
  assert.equal(env.CFLAGS_aarch64_apple_darwin, '-isysroot "/Xcode/MacOSX.sdk"');
  assert.equal(env.CXXFLAGS_x86_64_apple_darwin, '-isysroot "/Xcode/MacOSX.sdk"');
  assert.equal(env.CFLAGS_aarch64_apple_ios, '-isysroot "/Xcode/iPhone.sdk"');
  assert.equal(env.CXXFLAGS_aarch64_apple_ios, '-isysroot "/Xcode/iPhone.sdk"');
});

test('simulator debug builds arm64 simulator with embedded frontend', () => {
  const plan = cargoBuildPlan({ ...buildInput, platform: 'iphonesimulator', configuration: 'debug' });
  assert.deepEqual(plan.args, ['build', '--locked', '--lib', '--target', 'aarch64-apple-ios-sim', '--features', 'tauri/custom-protocol']);
  assert.equal(plan.destination, '/repo/resume-designer/src-tauri/gen/apple/Externals/arm64/debug/libapp.a');
});

test('unsupported platform, device x86 and misspelled configuration fail closed', () => {
  for (const change of [{ platform: 'macosx' }, { arch: 'x86_64' }, { configuration: 'Releasee' }]) {
    assert.throws(() => cargoBuildPlan({ ...buildInput, ...change }), /unsupported/i);
  }
});

test('default native run compiles simulator then archives unsigned device without a simulator UDID', () => {
  const plans = unsignedBuildPlans('/repo/resume-designer', '/tmp/unique');
  assert.equal(plans.length, 2);
  assert.equal(plans[0].at(-1), 'build');
  assert.equal(plans[1].at(-1), 'archive');
  assert.ok(plans[0].includes('generic/platform=iOS Simulator'));
  assert.ok(plans[1].includes('generic/platform=iOS'));
  assert.ok(plans[1].includes('/tmp/unique/On Paper.xcarchive'));
  for (const args of plans) {
    assert.ok(args.includes('CODE_SIGNING_ALLOWED=NO'));
    assert.ok(args.includes('OP_IOS_CI=1'));
    assert.ok(args.includes('OP_IOS_CI_OUTPUT_DIR=/tmp/unique'));
    assert.ok(!args.includes('-allowProvisioningUpdates'));
  }
});

test('real native entry point copies only the produced library to its isolated Xcode link directory', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'on-paper-native-contract-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fixture = join(root, 'app');
  for (const directory of ['scripts', 'dist', 'src-tauri']) mkdirSync(join(fixture, directory), { recursive: true });
  for (const file of ['ios-ci.mjs', 'ios-ci-swift.sh']) copyFileSync(join(scripts, file), join(fixture, 'scripts', file));
  writeFileSync(join(fixture, 'dist/index.html'), '<!doctype html><title>Fixture</title>');
  const bin = join(root, 'bin');
  mkdirSync(bin);
  // Cargo and the SDK resolver are the expensive external boundary. The real
  // entry point still selects env/arguments, handles failure and copies bytes.
  writeFileSync(join(bin, 'xcrun'), '#!/bin/sh\nprintf "/Xcode/%s.sdk\\n" "$2"\n', { mode: 0o755 });
  writeFileSync(join(bin, 'cargo'), `#!${process.execPath}\n` + `
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.CI_TEST_TRACE, JSON.stringify({ args, env: process.env }));
if (process.env.CI_TEST_CARGO_FAIL) process.exit(12);
const out = path.join(process.env.CARGO_TARGET_DIR, args[args.indexOf('--target') + 1], 'debug');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'libon_paper_lib.a'), 'compiled-library');
`, { mode: 0o755 });
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, PLATFORM_NAME: 'iphonesimulator',
    CONFIGURATION: 'debug', ARCHS: 'arm64', SDKROOT: '/ios/global/sdk',
    OP_IOS_CI_OUTPUT_DIR: root, OP_RUST_LIB_ROOT: join(root, 'Externals'), CI_TEST_TRACE: join(root, 'trace.json') };
  const invoke = overrides => spawnSync(process.execPath, [join(fixture, 'scripts/ios-ci.mjs'), 'native'], {
    env: { ...env, ...overrides }, encoding: 'utf8',
  });
  const result = invoke();
  assert.equal(result.status, 0, result.stderr);
  const library = join(root, 'Externals/arm64/debug/libapp.a');
  assert.equal(readFileSync(library, 'utf8'), 'compiled-library');
  const trace = JSON.parse(readFileSync(env.CI_TEST_TRACE, 'utf8'));
  assert.equal(trace.env.SDKROOT, undefined);
  assert.equal(trace.env.CARGO_TARGET_DIR, join(root, 'cargo'));
  assert.ok(trace.args.includes('aarch64-apple-ios-sim'));
  writeFileSync(library, 'previous-library');
  assert.notEqual(invoke({ CI_TEST_CARGO_FAIL: '1' }).status, 0);
  assert.equal(readFileSync(library, 'utf8'), 'previous-library');
});

test('actual Cloud hooks stop nonrelease invocations before dependency installs or plist writes', () => {
  const hooks = fileURLToPath(new URL('../src-tauri/gen/apple/ci_scripts/', import.meta.url));
  for (const hook of ['ci_post_clone.sh', 'ci_pre_xcodebuild.sh']) {
    const result = spawnSync('/bin/bash', [join(hooks, hook)], {
      env: { PATH: process.env.PATH, ...cloudEnv, CI_TAG: 'next' }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing Xcode Cloud/);
  }
});

test('locked swift-rs gets the native package engine while Swift compiler probes stay untouched', t => {
  const root = mkdtempSync(join(tmpdir(), 'on-paper-swift-contract-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const compiler = join(root, 'real-swift');
  writeFileSync(compiler, `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o755 });
  for (const [args, expected] of [
    [['build', '--sdk', '/Xcode SDK', '-Xswiftc', '-target', '-Xswiftc', 'arm64-apple-ios26.0-simulator'],
      ['build', '--build-system', 'native', '--sdk', '/Xcode SDK', '-Xswiftc', '-target', '-Xswiftc', 'arm64-apple-ios26.0-simulator']],
    [['-print-target-info'], ['-print-target-info']],
  ]) {
    const result = spawnSync('/bin/bash', [join(scripts, 'ios-ci-swift.sh'), ...args], {
      env: { ...process.env, OP_IOS_SWIFT_EXEC: compiler }, encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), expected);
  }
  const plan = cargoBuildPlan(buildInput);
  assert.equal(plan.env.PATH, '/tmp/isolated/swift-bin:/bin');
});
