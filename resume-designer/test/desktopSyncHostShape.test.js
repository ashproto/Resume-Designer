// The engine's delegate callbacks run inside CloudKit's own task. CloudKit marks
// that task with a task-local, and an unstructured `Task {}` created inside a
// callback inherits the mark: when it later awaits `engine.send` → `sendChanges()`
// CloudKit traps ("Cannot await a call into CKSyncEngine from within a delegate
// callback … Try performing this in a detached Task") although the event has
// long finished. That killed the Mac app on 2026-09-20 after a save conflict.
// OPSync's `delegateEventInFlight` guard is time-based and cannot see it. So
// every task a callback creates, and every path a callback reaches that creates
// one, must be `Task.detached`. Nothing under vitest runs Swift; this reads the
// source's shape, as swiftContract.test.js does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = readFileSync(join(process.cwd(), 'src-tauri/macos/DesktopSyncHost.swift'), 'utf8');

// `Task {` and `Task(priority:) {`, the creations that inherit; not `Task.detached {`.
const INHERITING_TASK = /(?<![\w.])Task\s*(\([^)]*\))?\s*\{/g;

// The comments explain the rule in the words the rule forbids; only code is judged.
const code = (text) => text.replace(/\/\/.*$/gm, '');

function section(from, to) {
  const start = src.indexOf(from);
  expect(start, `anchor missing: ${from}`).toBeGreaterThan(-1);
  const end = src.indexOf(to, start);
  expect(end, `anchor missing: ${to}`).toBeGreaterThan(start);
  return src.slice(start, end);
}

// A top-level method's body: from its `func` to the first brace closing at the
// type's two-space indentation.
function method(name) {
  const start = src.indexOf(`func ${name}(`);
  expect(start, `method missing: ${name}`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('\n  }\n', start));
}

describe('DesktopSyncHost: tasks that may await the engine start detached', () => {
  it('creates no inheriting task inside the OPSyncHost conformance', () => {
    const callbacks = code(section('extension DesktopSyncHost: OPSyncHost {', '// MARK: - C surface'));
    expect(callbacks.match(INHERITING_TASK) ?? []).toEqual([]);
  });

  it.each(['enqueueLifecycle', 'scheduleDrainRetry'])('%s, reached from callbacks, detaches', (name) => {
    const body = code(method(name));
    expect(body).toContain('Task.detached');
    expect(body.match(INHERITING_TASK) ?? []).toEqual([]);
  });
});
