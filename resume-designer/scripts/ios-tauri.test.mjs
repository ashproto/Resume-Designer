import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runIos } from './ios-tauri.mjs';

const projectPath = fileURLToPath(new URL('../src-tauri/gen/apple/resume-designer.xcodeproj/', import.meta.url));
const projectSource = readFileSync(join(projectPath, 'project.pbxproj'), 'utf8');
const schemeSource = readFileSync(join(projectPath, 'xcshareddata/xcschemes/resume-designer_iOS.xcscheme'), 'utf8');
const legacyComment = 'Build configuration list for PBXNativeTarget "resume-designer_iOS"';
const xcodeComment = 'Build configuration list for PBXNativeTarget "On Paper"';
const configId = projectSource.match(/buildConfigurationList = ([A-F0-9]+) \/\* Build configuration list for PBXNativeTarget "(?:resume-designer_iOS|On Paper)" \*\//)[1];

function xcodeSavedProject(t) {
  const root = mkdtempSync(join(tmpdir(), 'on-paper-ios-invocation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const projectFile = join(root, 'project.pbxproj');
  const schemeFile = join(root, 'xcshareddata/xcschemes/resume-designer_iOS.xcscheme');
  mkdirSync(join(root, 'xcshareddata/xcschemes'), { recursive: true });
  // Xcode saves the target's visible name in both configuration-list comments.
  // Include a real settings edit to prove the preflight does not regenerate it.
  const project = projectSource.replaceAll(legacyComment, xcodeComment)
    .replace(/DEVELOPMENT_TEAM = "?847VH25R7U"?;/g, 'DEVELOPMENT_TEAM = TESTTEAM42;');
  writeFileSync(projectFile, project);
  writeFileSync(schemeFile, schemeSource);
  return { root, projectFile, schemeFile, project };
}

for (const args of [
  ['build', '--debug', '--target', 'aarch64-sim'],
  ['-v', 'dev', '--no-watch'],
  ['--verbose', 'run', '--release'],
  ['-vv', '--verbose', 'build', '--', '--help'],
]) {
  test(`repairs Xcode's saved configuration before invoking ios ${args.join(' ')}`, async t => {
    const fixture = xcodeSavedProject(t);
    assert.ok(!fixture.project.includes(legacyComment));
    let calls = 0;
    const input = Object.freeze([...args]);
    const result = await runIos(input, {
      projectPath: fixture.root,
      invoke: async (receivedArgs, binName) => {
        calls++;
        const prepared = readFileSync(fixture.projectFile, 'utf8');
        assert.match(prepared, new RegExp(`${configId} /\\* ${legacyComment} \\*/ = \\{`));
        assert.match(prepared, /name = "On Paper";/);
        assert.equal(prepared.replaceAll(legacyComment, xcodeComment), fixture.project);
        assert.equal(readFileSync(fixture.schemeFile, 'utf8'), schemeSource);
        assert.deepEqual(receivedArgs, ['ios', ...args]);
        assert.equal(binName, 'npm run --');
        return 'invoked';
      },
    });
    assert.equal(result, 'invoked');
    assert.equal(calls, 1);
    assert.deepEqual(input, args);
  });
}

test('init, help, version and xcode-script pass through without modifying the project', async t => {
  const fixture = xcodeSavedProject(t);
  const invocations = [
    [], ['init'], ['help', 'build'], ['build', '--help'], ['-v', 'dev', '-h'],
    ['--version'], ['-V'], ['--verbose', 'run', '--version'],
    ['xcode-script', '-v', '--platform', 'iOS'],
  ];
  for (const args of invocations) {
    let calls = 0;
    await runIos(args, {
      projectPath: fixture.root,
      invoke: async (receivedArgs, binName) => {
        calls++;
        assert.deepEqual(receivedArgs, ['ios', ...args]);
        assert.equal(binName, 'npm run --');
      },
    });
    assert.equal(calls, 1);
    assert.equal(readFileSync(fixture.projectFile, 'utf8'), fixture.project);
    assert.equal(readFileSync(fixture.schemeFile, 'utf8'), schemeSource);
  }
});

test('a failed preparation leaves files intact and never invokes Tauri', async t => {
  const fixture = xcodeSavedProject(t);
  const invalid = fixture.project.replaceAll(xcodeComment, 'Build configuration list for PBXNativeTarget "Unrelated"');
  writeFileSync(fixture.projectFile, invalid);
  let calls = 0;
  await assert.rejects(runIos(['build'], {
    projectPath: fixture.root,
    invoke: async () => { calls++; },
  }), /configuration/i);
  assert.equal(calls, 0);
  assert.equal(readFileSync(fixture.projectFile, 'utf8'), invalid);
  assert.equal(readFileSync(fixture.schemeFile, 'utf8'), schemeSource);
});

test('Tauri invocation failures are propagated after preparation', async t => {
  const fixture = xcodeSavedProject(t);
  const failure = new Error('native CLI failed');
  await assert.rejects(runIos(['build'], {
    projectPath: fixture.root,
    invoke: async () => {
      assert.ok(readFileSync(fixture.projectFile, 'utf8').includes(legacyComment));
      throw failure;
    },
  }), error => error === failure);
});
