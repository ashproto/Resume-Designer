import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The desktop half of the sync bridge. NOT `window.__opShell` — that is the
// iOS bridge and stays dormant on desktop. Same shared routes, different
// carrier: Rust evaluates `window.__opDesktopSync.request(id, json)`, and the
// page answers through `invoke('desktop_sync_reply', { id, json })`.
// `vi.mock` is hoisted above every other statement in the file, so the mock's
// dependencies must be hoisted with it or the factory closes over a binding
// still in its temporal dead zone.
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

import { initDesktopSync } from '../src/desktopSync.js';

const deps = (over = {}) => ({
  collectUnit: vi.fn(() => ({ id: 'resume:a', kind: 'resume', payload: '{}', modifiedAt: null })),
  collectUnits: vi.fn((profileId) => [{ id: 'resume:a', kind: 'resume', payload: '{}', modifiedAt: null, profileId }]),
  unitScopes: vi.fn(() => ({ 'resume:a': 'profile' })),
  applyUnits: vi.fn().mockResolvedValue({ applied: 1, accounted: [{ id: 'resume:a', profileId: 'p1' }] }),
  resolveConflicts: vi.fn().mockResolvedValue({ resolved: [], parked: 0 }),
  getActiveProfileId: () => 'p1',
  listProfileIds: () => ['p1', 'p2'],
  isSyncSuspended: () => false,
  ...over,
});

const lastReply = () => {
  const call = [...invoke.mock.calls].reverse().find(([cmd]) => cmd === 'desktop_sync_reply');
  return call ? { id: call[1].id, ...JSON.parse(call[1].json) } : null;
};

describe('initDesktopSync', () => {
  beforeEach(() => { invoke.mockClear(); delete window.__opDesktopSync; });
  afterEach(() => { delete window.__opDesktopSync; });

  it('installs the desktop global and leaves the iOS bridge alone', async () => {
    await initDesktopSync(deps());
    expect(typeof window.__opDesktopSync?.request).toBe('function');
    expect(window.__opShell).toBeUndefined();
  });

  it('reports the active profile AND the registry list once, at init', async () => {
    await initDesktopSync(deps());
    const calls = invoke.mock.calls.filter(([cmd]) => cmd === 'desktop_sync_report_profile');
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ profileId: 'p1', knownProfileIds: ['p1', 'p2'] });
  });

  it("installs the page → transport notifier and hands dirty units to desktop_sync_dirty", async () => {
    // The model has ONE notifier slot; iOS fills it with a no-op off iOS, and
    // the desktop must take it or every Mac edit stays on the Mac.
    let notifier = null;
    await initDesktopSync(deps({ setSyncDirtyNotifier: (fn) => { notifier = fn; } }));
    expect(typeof notifier).toBe('function');
    const units = [{ id: 'resume:a', profileId: '' }, { id: 'key:k', profileId: 'p2' }];
    notifier(units);
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith('desktop_sync_dirty', { units });
  });

  it('does not start the transport while sync is suspended', async () => {
    // A purge stopped this device on purpose; only a person turns it back on.
    await initDesktopSync(deps({ isSyncSuspended: () => true }));
    expect(invoke.mock.calls.some(([cmd]) => cmd === 'desktop_sync_report_profile')).toBe(false);
  });

  it('routes a request through the shared table and replies { ok, value } under the same id', async () => {
    const d = deps(); await initDesktopSync(d);
    await window.__opDesktopSync.request(7, JSON.stringify({ kind: 'syncUnit', unitId: 'resume:a', profileId: 'p1' }));
    expect(d.collectUnit).toHaveBeenCalledWith('resume:a', 'p1');
    expect(lastReply()).toEqual({ id: 7, ok: true, value: { id: 'resume:a', kind: 'resume', payload: '{}', modifiedAt: null } });
  });

  it("syncApply's reply carries applyUnits's answer — the durable count, not a cache count", async () => {
    const d = deps(); await initDesktopSync(d);
    await window.__opDesktopSync.request(8, JSON.stringify({ kind: 'syncApply', units: '[]' }));
    expect(lastReply()).toEqual({ id: 8, ok: true, value: { applied: 1, accounted: [{ id: 'resume:a', profileId: 'p1' }] } });
  });

  it("syncCollect answers a profile's full upload directly — a request, not the iOS message pair", async () => {
    // iOS asks `syncCollect` fire-and-forget and the page posts `syncUnits`
    // back; over this bridge the same question is a plain request with an
    // answer. The units carry the profile they belong to.
    const d = deps(); await initDesktopSync(d);
    await window.__opDesktopSync.request(11, JSON.stringify({ kind: 'syncCollect', profileId: 'p2' }));
    expect(d.collectUnits).toHaveBeenCalledWith('p2');
    expect(lastReply()).toEqual({ id: 11, ok: true, value: { profileId: 'p2', units: [{ id: 'resume:a', kind: 'resume', payload: '{}', modifiedAt: null, profileId: 'p2' }] } });
  });

  it('answers an unknown kind with ok:false rather than throwing or staying silent', async () => {
    await initDesktopSync(deps());
    await window.__opDesktopSync.request(9, JSON.stringify({ kind: 'nope' }));
    expect(lastReply()).toMatchObject({ id: 9, ok: false });
    expect(lastReply().error).toMatch(/nope/);
  });

  it('answers a route that throws with ok:false, carrying the message', async () => {
    await initDesktopSync(deps());
    await window.__opDesktopSync.request(10, JSON.stringify({ kind: 'syncScopes', unitIds: '{}' }));
    expect(lastReply()).toMatchObject({ id: 10, ok: false });
    expect(lastReply().error).toMatch(/array/);
  });

  it('never replies to id 0 — the fire-and-forget id has nothing parked', async () => {
    await initDesktopSync(deps());
    await window.__opDesktopSync.request(0, JSON.stringify({ kind: 'syncRefused', profileId: 'p1', unitIds: ['x'] }));
    expect(invoke.mock.calls.some(([cmd]) => cmd === 'desktop_sync_reply')).toBe(false);
  });

  it('sets the suspended flag when Swift reports a purge, and deletes nothing', async () => {
    const setSyncSuspended = vi.fn();
    await initDesktopSync(deps({ setSyncSuspended }));
    await window.__opDesktopSync.request(0, JSON.stringify({ kind: 'syncPurged' }));
    expect(setSyncSuspended).toHaveBeenCalledWith(true);
  });
});
