// CloudKit marks its delegate task with a task-local. An inheriting `Task {}`
// keeps that mark even after the callback returns, so a later engine send or
// stop can trap. Callback-created tasks must detach to leave that context.
// Like desktopSyncHostShape.test.js and swiftContract.test.js, this checks Swift
// source because vitest cannot exercise CKSyncEngine's runtime guard.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(process.cwd(), 'src-tauri/ios/OPShell.swift'), 'utf8');

// Matches `Task {` and `Task(priority:) {`, but not `Task.detached {`.
const INHERITING_TASK = /(?<![\w.])Task\s*(\([^)]*\))?\s*\{/g;

describe('OPShell: tasks created by OPSyncHost callbacks start detached', () => {
  it('creates no inheriting task inside the OPSyncHost conformance', () => {
    const start = src.indexOf('extension ShellModel: OPSyncHost {');
    expect(start, 'OPSyncHost conformance missing').toBeGreaterThan(-1);
    const end = src.indexOf('private final class SnapshotBridge:', start);
    expect(end, 'end of OPSyncHost conformance missing').toBeGreaterThan(start);
    // Comments describe the forbidden syntax; only code is judged.
    const callbacks = src.slice(start, end).replace(/\/\/.*$/gm, '');
    expect(callbacks.match(INHERITING_TASK) ?? []).toEqual([]);
  });
});
