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

describe('DesktopSyncHost: bounded foreground refresh', () => {
  it('uses direct change discovery for timer passes', () => {
    const start = code(method('runStart'));
    expect(start).toMatch(/if reason == "foreground-timer"\s*\{\s*try await engine\.fetchForegroundChanges\(\)/);
    expect(start).toMatch(/else\s*\{\s*try await engine\.fetchNow\(\)/);
  });

  it('runs the full start pass on a repeating foreground timer as well as activation', () => {
    const install = code(method('installForegroundRefresh'));
    expect(install).toMatch(/Timer\.scheduledTimer\(withTimeInterval: 30, repeats: true\)/);
    expect(install).toContain('foregroundTimerTick()');
    expect(install).toContain('self?.activate()');
    const tick = code(method('foregroundTimerTick'));
    expect(tick).toContain('await runStart(');
    expect(tick).toContain('reason: "foreground-timer"');
    expect(tick).not.toContain('fetchNow(');
  });

  it('allows only one queued or running timer pass', () => {
    const tick = code(method('foregroundTimerTick'));
    expect(tick).toMatch(/guard[^\n]*!foregroundTimerPending[^\n]*else \{ return \}/);
    const hold = tick.indexOf('foregroundTimerPending = true');
    const enqueue = tick.indexOf('enqueueLifecycle');
    expect(hold).toBeGreaterThan(-1);
    expect(enqueue).toBeGreaterThan(hold);
    expect(tick.slice(enqueue)).toContain('defer { foregroundTimerPending = false }');
  });

  it('rechecks the foreground, suspension, and current profile after earlier lifecycle work', () => {
    const tick = code(method('foregroundTimerTick'));
    const queued = tick.slice(tick.indexOf('enqueueLifecycle'));
    expect(queued).toMatch(/guard foregroundRefreshEnabled, NSApplication\.shared\.isActive, !syncSuspended,/);
    expect(queued).toMatch(/let profileId = syncProfileId else \{ return \}/);
    expect(queued).toMatch(/runStart\(profileId: profileId, knownProfileIds: knownProfileIds,/);
    expect(queued).toContain('tombstonedProfileIds: tombstonedProfileIds');
    // An activation stays independent of the timer's coalescing guard.
    expect(code(method('activate'))).not.toContain('foregroundTimerPending');
  });

  it('disables timer work when the host stops until another explicit start', () => {
    expect(code(method('runStart'))).toContain('foregroundRefreshEnabled = true');
    expect(code(method('stopEngine'))).toContain('foregroundRefreshEnabled = false');
    const tick = code(method('foregroundTimerTick'));
    expect(tick.match(/guard foregroundRefreshEnabled,/g)).toHaveLength(2);
  });
});
