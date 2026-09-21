// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'src-tauri/ios/OPSync.swift'), 'utf8');

describe('OPSync foreground discovery', () => {
  it('uses the tested page reader and an ingress gate', () => {
    expect(source.match(/opReadForegroundRecords\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain('OPSyncIngressGate');
  });

  it.skipIf(process.platform !== 'darwin')('checks native page accounting and serialized ingestion', () => {
    const directory = mkdtempSync(join(tmpdir(), 'op-foreground-test-'));
    try {
      const swiftFile = join(directory, 'ForegroundTests.swift');
      const executable = join(directory, 'foreground-tests');
      const fixture = readFileSync(join(process.cwd(), 'test/swift/OPSyncForegroundTests.swift'), 'utf8');
      writeFileSync(swiftFile, source + '\n' + fixture);
      execFileSync('xcrun', [
        'swiftc', '-parse-as-library', '-target', (process.arch === 'arm64' ? 'arm64' : 'x86_64') + '-apple-macos14.4',
        '-module-cache-path', join(directory, 'module-cache'), swiftFile, '-o', executable,
      ], { encoding: 'utf8', timeout: 120_000 });
      const output = execFileSync(executable, [], { encoding: 'utf8', timeout: 30_000 });
      expect(output).toContain('PASS: all 10 foreground scenarios');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 150_000);
});
