import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  buildDesign, buildOnboarding, buildDocumentOutline,
  buildHistory, buildLibrary, buildChatView, buildSettings, buildDiffReview,
} from '../src/iosShell.js';
import { buildJobs } from '../src/jobsBridge.js';
import { buildResumeFromInterview, INTERVIEW_QUESTIONS } from '../src/onboardingLogic.js';
import { parseResumeText } from '../src/resumeParser.js';

/**
 * The Swift decoder's required fields must all be emitted by the JS builder.
 *
 * `OPShell.receive` decodes with `try? JSONDecoder().decode(ShellSnapshot.self)`
 * and drops the snapshot WHOLE when it fails. A single missing non-optional
 * field therefore does not degrade one control — it silently stops the entire
 * native UI updating, which reads as a spinner that never resolves and chrome
 * that quietly goes stale.
 *
 * That shipped three times on this branch: `JobsView.revision`,
 * `OnboardingView.keySaves`, and `Design.saveFailed` — the last one broke every
 * design tab on device, because the struct named the field and the projection
 * never emitted it. Nothing caught any of them: the field lives in Swift, the
 * emitter lives in JS, and no test read both.
 *
 * Top-level fields only. Nested types would need a real Swift parser; the drift
 * that has actually happened has all been at the top level, where a new field is
 * added to the struct and the builder is forgotten.
 */
const SWIFT_SOURCES = ['OPShell.swift', 'OPJobs.swift', 'OPProfile.swift', 'OPOnboarding.swift']
  .map((f) => fs.readFileSync(path.join(process.cwd(), 'src-tauri/ios', f), 'utf8'))
  .join('\n');

/** Extract the real wire declaration, including its nested types. */
function swiftDeclaration(name) {
  const start = SWIFT_SOURCES.indexOf(`struct ${name}: Decodable`);
  expect(start, `Swift struct ${name} not found`).toBeGreaterThan(-1);
  let depth = 0;
  let i = SWIFT_SOURCES.indexOf('{', start);
  for (; i < SWIFT_SOURCES.length; i += 1) {
    if (SWIFT_SOURCES[i] === '{') depth += 1;
    else if (SWIFT_SOURCES[i] === '}') { depth -= 1; if (depth === 0) break; }
  }
  return SWIFT_SOURCES.slice(start, i + 1);
}

/** The `var`/`let` fields declared directly inside `name`'s braces. */
function requiredFields(name) {
  const body = swiftDeclaration(name);
  // Only this struct's OWN fields: nested types are indented deeper.
  const indent = name === 'JobsView' || name === 'ProfileView' || name === 'OnboardingView' ? '  ' : '    ';
  const re = new RegExp(`^${indent}(?:var|let) (\\w+):\\s*([^\\n={]+)$`, 'gm');
  const out = [];
  for (const m of body.matchAll(re)) {
    const type = m[2].trim();
    if (!type.endsWith('?')) out.push(m[1]);   // optionals may legitimately be absent
  }
  return out;
}

/**
 * Fields the PUBLISH SITE adds on top of the builder, by spreading its result:
 * `project('document', () => ({ ...deps.getDocument(), saveFailed, revision }))`.
 * They are legitimately absent from the builder, so they are named here rather
 * than reported as drift.
 *
 * Keep this in step with `publish()` in src/iosShell.js. A field listed here
 * that the publish site stops adding is drift this test will NOT catch — but a
 * field in neither place, which is what has actually shipped every time, still
 * fails loudly.
 */
const SUPPLIED_AT_PUBLISH = {
  DocumentOutline: ['saveFailed', 'revision'],
  ChatView: ['saveFailed', 'pendingChanges'],
};

const CONTRACTS = [
  ['Design', () => buildDesign({})],
  ['JobsView', () => buildJobs({})],
  ['OnboardingView', () => buildOnboarding({})],
  ['DocumentOutline', () => buildDocumentOutline({})],
  ['History', () => buildHistory([])],
  ['LibraryView', () => buildLibrary([], {}, [])],
  ['ChatView', () => buildChatView({})],
  ['Settings', () => buildSettings({})],
  ['DiffReview', () => buildDiffReview({})],
];

describe('every Swift decoder field is emitted by its JS builder', () => {
  it.each(CONTRACTS)('%s', (name, build) => {
    const emitted = new Set([...Object.keys(build()), ...(SUPPLIED_AT_PUBLISH[name] ?? [])]);
    const missing = requiredFields(name).filter((f) => !emitted.has(f));
    expect(missing, `${name}: Swift requires these but the builder emits none of them`).toEqual([]);
  });
});

describe.skipIf(process.platform !== 'darwin')('native onboarding decodes its nested résumé preview', () => {
  let directory;
  let executable;
  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(tmpdir(), 'op-onboarding-contract-'));
    const swiftFile = path.join(directory, 'DecodeOnboarding.swift');
    executable = path.join(directory, 'decode-onboarding');
    // Compile the production Swift wire types, rather than a second hand-kept
    // schema. A preview first appears after interview/import/generation; an
    // empty top-level projection does not exercise its required nested fields.
    fs.writeFileSync(swiftFile, `import Foundation
struct ShellSnapshot {
${swiftDeclaration('DocumentOutline')}
}
${swiftDeclaration('OnboardingView')}
do {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  let value = try JSONDecoder().decode(OnboardingView.self, from: data)
  guard value.resume != nil else { fatalError("Missing résumé preview") }
  print("decoded step=\\(value.step)")
} catch {
  print(error)
  exit(1)
}
`);
    execFileSync('xcrun', ['swiftc', '-module-cache-path', path.join(directory, 'module-cache'),
      swiftFile, '-o', executable], { encoding: 'utf8', timeout: 60_000 });
  }, 65_000);
  afterAll(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

  it.each([
    ['interview', 3, () => buildResumeFromInterview({
      name: 'Taylor Sample', title: 'Product Designer', contact: 'taylor@example.com, Test City',
      summary: 'I design useful products.', experience: 'Built products at Fictional Company.',
      skills: 'Research, Prototyping',
    })],
    ['import', 3, () => parseResumeText('Taylor Sample\ntaylor@example.com\n\nSUMMARY\nI design useful products.')],
    ['generated', 4, () => ({
      name: 'Taylor Sample', contact: { email: 'taylor@example.com' },
      summary: 'I design useful products.', sections: [{ title: 'Skills', content: ['Research'] }],
    })],
  ])('decodes the %s result without freezing the wizard snapshot', (_flow, step, makeResume) => {
    const projected = buildOnboarding({
      open: true, step, mode: 'new', isNewResumeMode: true,
      questions: INTERVIEW_QUESTIONS, question: 5, resume: makeResume(),
    });
    const result = spawnSync(executable, [], { input: JSON.stringify(projected), encoding: 'utf8', timeout: 10_000 });
    expect(result.status, result.stdout || result.stderr).toBe(0);
    expect(result.stdout).toContain(`decoded step=${step}`);
  });
});

describe.skipIf(process.platform !== 'darwin')('native Settings consent action', () => {
  let directory;
  let executable;
  beforeAll(() => {
    directory = fs.mkdtempSync(path.join(tmpdir(), 'op-settings-contract-'));
    const swiftFile = path.join(directory, 'DecodeSettings.swift');
    executable = path.join(directory, 'decode-settings');
    fs.writeFileSync(swiftFile, `import Foundation
${swiftDeclaration('OPPrivacyPolicy')}
struct ShellSnapshot {
${swiftDeclaration('Settings')}
}
do {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  let settings = try JSONDecoder().decode(ShellSnapshot.Settings.self, from: data)
  let presentation: [String: Any] = [
    "pending": settings.aiSharingRevocationPending,
    "status": settings.aiSharingStatus,
    "action": settings.aiSharingActionTitle,
    "allow": settings.aiSharingActionAllows
  ]
  let result = try JSONSerialization.data(withJSONObject: presentation)
  print(String(decoding: result, as: UTF8.self))
} catch {
  print(error)
  exit(1)
}
`);
    execFileSync('xcrun', ['swiftc', '-module-cache-path', path.join(directory, 'module-cache'),
      swiftFile, '-o', executable], { encoding: 'utf8', timeout: 60_000 });
  }, 65_000);
  afterAll(() => { if (directory) fs.rmSync(directory, { recursive: true, force: true }); });

  const decode = value => {
    const result = spawnSync(executable, [], { input: JSON.stringify(value), encoding: 'utf8', timeout: 10_000 });
    expect(result.status, result.stdout || result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  };

  it('decodes both the default projection and an unsaved revocation', () => {
    expect(decode(buildSettings()).pending).toBe(false);
    expect(decode(buildSettings({ aiSharingRevocationPending: true })).pending).toBe(true);
  });

  it.each([
    [false, true, 'Paused — change not saved', 'Retry stopping AI sharing', false],
    [true, false, 'Allowed on this device', 'Stop AI sharing', false],
    [false, false, 'Not allowed', 'Review AI data sharing', true],
  ])('maps allowed=%s pending=%s to the native action and boolean sent to JS', (allowed, pending, status, action, allow) => {
    // An explicit wire fixture tests the native branch independently of the
    // JS projection, so a missing emitter cannot mask a retry that grants.
    expect(decode({ ...buildSettings(), aiSharingAllowed: allowed, aiSharingRevocationPending: pending }))
      .toEqual({ pending, status, action, allow });
  });
});
