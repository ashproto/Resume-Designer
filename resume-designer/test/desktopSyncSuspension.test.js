// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const host = readFileSync(join(process.cwd(), 'src-tauri/macos/DesktopSyncHost.swift'), 'utf8');
const rust = readFileSync(join(process.cwd(), 'src-tauri/src/desktop_sync.rs'), 'utf8');
const app = readFileSync(join(process.cwd(), 'src-tauri/src/lib.rs'), 'utf8');
const method = (name) => {
  const start = host.indexOf(`func ${name}(`);
  expect(start, `missing ${name}`).toBeGreaterThan(-1);
  return host.slice(start, host.indexOf('\n  }', start));
};

describe('desktop suspension authority', () => {
  it('answers page suspension queries through the existing native answer channel', () => {
    expect(host).toContain('@_cdecl("op_sync_suspension")');
    const answer = method('answerSuspension');
    expect(answer).toContain('@MainActor');
    expect(answer).toContain('suspensionSnapshot()');
    expect(answer).toContain('answerCallback?');
    expect(rust).toMatch(/pub async fn desktop_sync_suspension\(\) -> Result<String, String>/);
    expect(rust).toContain('op_sync_suspension(id)');
    expect(app).toContain('desktop_sync::desktop_sync_suspension,');
  });

  it('carries the same ordered snapshot on purge and resume notices', () => {
    expect(method('syncDidPurgeFromICloud')).toContain('notify("syncPurged", suspensionSnapshot())');
    const resume = method('resumeSyncing');
    expect(resume).toMatch(/guard syncSuspended else\s*\{\s*notify\("syncResumed", suspensionSnapshot\(\)\)/);
    expect(resume.match(/notify\("syncResumed", suspensionSnapshot\(\)\)/g)).toHaveLength(2);
  });

  it('retains the page profile before refusing a paused start without opening the engine', () => {
    const start = method('runStart');
    const gate = start.indexOf('guard !syncSuspended');
    expect(gate).toBeGreaterThan(-1);
    for (const field of ['syncProfileId = profileId', 'self.knownProfileIds = knownProfileIds', 'self.tombstonedProfileIds = tombstonedProfileIds']) {
      expect(start.indexOf(field), field).toBeGreaterThan(-1);
      expect(start.indexOf(field), field).toBeLessThan(gate);
    }
    expect(start.indexOf('settleDeadWorkspaces(')).toBeGreaterThan(gate);
    expect(start.indexOf('OPSyncEngine(host: self)')).toBeGreaterThan(gate);
  });

  it.skipIf(process.platform !== 'darwin')('keeps native snapshots coherent across reload and repeated resume', () => {
    // An isolated marker store also makes a persisted suspension testable
    // without changing this developer's app domain or creating CKContainer.
    expect(host).toContain('init(suspensionDefaults: UserDefaults = .standard)');
    const directory = mkdtempSync(join(tmpdir(), 'op-suspension-test-'));
    try {
      const swiftFile = join(directory, 'SuspensionTests.swift');
      const executable = join(directory, 'suspension-tests');
      const fixture = readFileSync(join(process.cwd(), 'test/swift/DesktopSyncSuspensionTests.swift'), 'utf8');
      writeFileSync(swiftFile, host + '\n' + fixture);
      execFileSync('xcrun', [
        'swiftc', '-parse-as-library', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos14.4`,
        '-module-cache-path', join(directory, 'module-cache'),
        join(process.cwd(), 'src-tauri/ios/OPSync.swift'), swiftFile, '-o', executable,
      ], { encoding: 'utf8', timeout: 120_000 });
      const output = execFileSync(executable, [], { encoding: 'utf8', timeout: 30_000 });
      expect(output).toContain('PASS: all 4 suspension scenarios');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 150_000);
});
