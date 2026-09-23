// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src-tauri/ios/OPSync.swift'), 'utf8');

describe('OPSync asset conflict recovery', () => {
  it('uses the tested conflict reader for serverRecordChanged saves', () => {
    const start = source.indexOf('case .serverRecordChanged:');
    const end = source.indexOf('case .zoneNotFound:', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const branch = source.slice(start, end).replace(/\/\/.*$/gm, '');
    expect(branch).toMatch(/\bopReadConflict\s*\(/);
  });

  it('handles a purge reported by the direct fetch before ordinary failure recovery', () => {
    const start = source.indexOf('case .serverRecordChanged:');
    const end = source.indexOf('case .zoneNotFound:', start);
    const branch = source.slice(start, end).replace(/\/\/.*$/gm, '');
    const purgeCatch = branch.match(
      /catch\s+let\s+(\w+)\s+as\s+CKError\s+where\s+\1\.code\s*==\s*\.userDeletedZone\s*\{([\s\S]*?)\}\s*catch\s*\{/,
    );
    expect(purgeCatch, 'a userDeletedZone fetch error must suspend sync before generic recovery').not.toBeNull();
    // Stop this batch too: earlier collected conflicts must not queue new saves
    // after the account owner has removed the app's iCloud data.
    expect(purgeCatch?.[2]).toMatch(/purgeFromICloud\([\s\S]*?\)\s*return\b/);
  });

  // CloudKit is an Apple framework. On other platforms this native test is
  // explicitly skipped; the source wiring check above still runs everywhere.
  it.skipIf(process.platform !== 'darwin')('runs the actual Swift conflict reader against local records', () => {
    const directory = mkdtempSync(join(tmpdir(), 'op-sync-conflict-test-'));
    try {
      const swiftFile = join(directory, 'ConflictTests.swift');
      const executable = join(directory, 'conflict-tests');
      const tests = readFileSync(join(process.cwd(), 'test/swift/OPSyncConflictTests.swift'), 'utf8');
      // One file makes private helpers visible without widening production APIs.
      writeFileSync(swiftFile, `${source}\n${tests}`);
      execFileSync('xcrun', [
        'swiftc', '-parse-as-library', '-target', `${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macos14.4`,
        '-module-cache-path', join(directory, 'module-cache'),
        swiftFile, '-o', executable,
      ], { encoding: 'utf8', timeout: 120_000 });
      const output = execFileSync(executable, [], { encoding: 'utf8', timeout: 30_000 });
      expect(output).toContain('PASS: all 7 conflict reader scenarios');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 150_000);
});
