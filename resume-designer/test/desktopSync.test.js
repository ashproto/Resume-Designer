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
  listTombstonedProfileIds: () => ['dead'],
  isSyncSuspended: () => false,
  setSyncSuspended: vi.fn(),
  ...over,
});

const lastReply = () => {
  const call = [...invoke.mock.calls].reverse().find(([cmd]) => cmd === 'desktop_sync_reply');
  return call ? { id: call[1].id, ...JSON.parse(call[1].json) } : null;
};

describe('initDesktopSync', () => {
  beforeEach(() => {
    invoke.mockReset().mockImplementation(async (cmd) => (
      cmd === 'desktop_sync_suspension' ? JSON.stringify({ suspended: false, revision: 0 }) : undefined
    ));
    delete window.__opDesktopSync;
  });
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
    expect(calls[0][1]).toEqual({ profileId: 'p1', knownProfileIds: ['p1', 'p2'], tombstonedProfileIds: ['dead'] });
  });

  it("installs the page → transport notifier and hands dirty units to desktop_sync_dirty", async () => {
    // The model has ONE notifier slot; iOS fills it with a no-op off iOS, and
    // the desktop must take it or every Mac edit stays on the Mac.
    let notifier = null;
    await initDesktopSync(deps({ setSyncDirtyNotifier: (fn) => { notifier = fn; } }));
    expect(typeof notifier).toBe('function');
    // '' names the open workspace, and it is named HERE, on the page, from the
    // profile this document was opened in — never resolved later across the
    // bridge, where a workspace switch can already point at the next one.
    notifier([{ id: 'resume:a', profileId: '' }, { id: 'key:k', profileId: 'p2' }]);
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith('desktop_sync_dirty', {
      units: [{ id: 'resume:a', profileId: 'p1' }, { id: 'key:k', profileId: 'p2' }],
    });
  });

  it('re-reports the registry when the SHARED zone lands, and not for a workspace landing', async () => {
    // A workspace created on another device becomes known here only through
    // the shared zone; the running engine takes on its zone from this report.
    await initDesktopSync(deps());
    await window.__opDesktopSync.request(0, JSON.stringify({ kind: 'syncLanded', scopes: [{ profileId: 'p1', unitId: '' }] }));
    expect(invoke.mock.calls.some(([cmd]) => cmd === 'desktop_sync_profiles')).toBe(false);
    await window.__opDesktopSync.request(0, JSON.stringify({ kind: 'syncLanded', scopes: [{ profileId: '', unitId: '' }] }));
    const report = invoke.mock.calls.find(([cmd]) => cmd === 'desktop_sync_profiles');
    expect(report?.[1]).toEqual({ knownProfileIds: ['p1', 'p2'], tombstonedProfileIds: ['dead'] });
  });

  it('releases the deferred first-run work when the transport says the first pull settled', async () => {
    const markInitialProfileFetchSettled = vi.fn();
    await initDesktopSync(deps({ markInitialProfileFetchSettled }));
    await window.__opDesktopSync.request(0, JSON.stringify({ kind: 'syncInitialProfileFetchSettled', status: 'ready' }));
    expect(markInitialProfileFetchSettled).toHaveBeenCalledWith('ready');
  });

  it('exposes the explicit resume after a purge, and mirrors suspension both ways', async () => {
    const setSyncSuspended = vi.fn();
    await initDesktopSync(deps({ setSyncSuspended }));
    await window.__opDesktopSync.request(0, JSON.stringify({ kind: 'syncPurged', suspended: true, revision: 1 }));
    expect(setSyncSuspended).toHaveBeenLastCalledWith(true);
    await window.__opDesktopSync.resumeAfterPurge();
    expect(invoke).toHaveBeenCalledWith('desktop_sync_resume', undefined);
    await window.__opDesktopSync.request(0, JSON.stringify({ kind: 'syncResumed', suspended: false, revision: 2 }));
    expect(setSyncSuspended).toHaveBeenLastCalledWith(false);
  });

  it('repairs a stale paused page before reporting a resumed native host', async () => {
    // Resume cleared the native marker, then the process died before its notice.
    let pageSuspended = true;
    const d = deps({
      isSyncSuspended: () => pageSuspended,
      setSyncSuspended: vi.fn((value) => { pageSuspended = value; }),
    });
    await initDesktopSync(d);
    expect(pageSuspended).toBe(false);
    const calls = invoke.mock.calls.map(([cmd]) => cmd);
    expect(calls.indexOf('desktop_sync_suspension')).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf('desktop_sync_report_profile')).toBeGreaterThan(calls.indexOf('desktop_sync_suspension'));
    expect(d.setSyncSuspended.mock.invocationCallOrder[0]).toBeLessThan(
      invoke.mock.invocationCallOrder[calls.indexOf('desktop_sync_report_profile')],
    );
  });

  it('repairs a missed purge notice and reports profile context for explicit resume', async () => {
    invoke.mockResolvedValueOnce(JSON.stringify({ suspended: true, revision: 4 }));
    let pageSuspended = false;
    const announce = vi.fn();
    window.addEventListener('rd:sync-suspension-changed', announce);
    try {
      await initDesktopSync(deps({
        isSyncSuspended: () => pageSuspended,
        setSyncSuspended: (value) => { pageSuspended = value; },
      }));
      expect(pageSuspended).toBe(true);
      expect(announce).toHaveBeenCalledOnce();
      // The native gate prevents CloudKit work. It still needs this metadata
      // on a fresh paused launch, so the Resume button has a profile to start.
      expect(invoke).toHaveBeenCalledWith('desktop_sync_report_profile', {
        profileId: 'p1', knownProfileIds: ['p1', 'p2'], tombstonedProfileIds: ['dead'],
      });
    } finally {
      window.removeEventListener('rd:sync-suspension-changed', announce);
    }
  });

  it('does not let a late startup snapshot undo a newer purge notice', async () => {
    let answer;
    invoke.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const d = deps();
    const ready = initDesktopSync(d);
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('desktop_sync_suspension', undefined));
    await window.__opDesktopSync.request(0, JSON.stringify({ kind: 'syncPurged', suspended: true, revision: 1 }));
    answer(JSON.stringify({ suspended: false, revision: 0 }));
    await ready;
    expect(d.setSyncSuspended).toHaveBeenLastCalledWith(true);
    expect(d.setSyncSuspended).not.toHaveBeenCalledWith(false);
  });

  it('ignores an old purge notice delivered after a newer resume notice', async () => {
    const d = deps();
    await initDesktopSync(d);
    await window.__opDesktopSync.request(0, JSON.stringify({ kind: 'syncResumed', suspended: false, revision: 2 }));
    await window.__opDesktopSync.request(0, JSON.stringify({ kind: 'syncPurged', suspended: true, revision: 1 }));
    expect(d.setSyncSuspended).toHaveBeenLastCalledWith(false);
  });

  it.each([null, {}, { suspended: 'false', revision: 0 }, { suspended: false, revision: -1 }])(
    'refuses an invalid native snapshot instead of starting with guessed state: %j', async (snapshot) => {
      invoke.mockResolvedValueOnce(JSON.stringify(snapshot));
      const d = deps();
      await expect(initDesktopSync(d)).rejects.toThrow(/suspension/);
      expect(d.setSyncSuspended).not.toHaveBeenCalled();
      expect(invoke.mock.calls.some(([cmd]) => cmd === 'desktop_sync_report_profile')).toBe(false);
    },
  );

  it('does not start when the native suspension query fails', async () => {
    invoke.mockRejectedValueOnce(new Error('native query unavailable'));
    const d = deps();
    await expect(initDesktopSync(d)).rejects.toThrow('native query unavailable');
    expect(d.setSyncSuspended).not.toHaveBeenCalled();
    expect(invoke.mock.calls.some(([cmd]) => cmd === 'desktop_sync_report_profile')).toBe(false);
  });

  it('waits for the page mirror to persist before reporting the profile', async () => {
    let persist;
    const d = deps({ setSyncSuspended: vi.fn(() => new Promise((resolve) => { persist = resolve; })) });
    const ready = initDesktopSync(d);
    await vi.waitFor(() => expect(d.setSyncSuspended).toHaveBeenCalledWith(false));
    expect(invoke.mock.calls.some(([cmd]) => cmd === 'desktop_sync_report_profile')).toBe(false);
    persist(true);
    await ready;
    expect(invoke.mock.calls.some(([cmd]) => cmd === 'desktop_sync_report_profile')).toBe(true);
  });

  it('keeps the document profile when the active pointer changes during reconciliation', async () => {
    let active = 'p1';
    let answer;
    invoke.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    const ready = initDesktopSync(deps({ getActiveProfileId: () => active }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('desktop_sync_suspension', undefined));
    active = 'p2'; // Switching workspaces changes this pointer before page reload.
    answer(JSON.stringify({ suspended: false, revision: 0 }));
    await ready;
    expect(invoke).toHaveBeenCalledWith('desktop_sync_report_profile', {
      profileId: 'p1', knownProfileIds: ['p1', 'p2'], tombstonedProfileIds: ['dead'],
    });
  });

  it('refuses startup when the page cannot persist the reconciled marker', async () => {
    await expect(initDesktopSync(deps({ setSyncSuspended: () => Promise.resolve(false) })))
      .rejects.toThrow(/suspension/);
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
    await window.__opDesktopSync.request(0, JSON.stringify({ kind: 'syncPurged', suspended: true, revision: 1 }));
    expect(setSyncSuspended).toHaveBeenCalledWith(true);
  });
});
