import { describe, it, expect, vi } from 'vitest';

import { makeSyncHostRoutes, SYNC_HOST_KINDS } from '../src/sync/syncHostRoutes.js';

// The table both native hosts consume — iOS over the WebKit message handler,
// macOS over the Tauri bridge. One place to add an OPSyncHost method, and one
// place a test can prove every kind is routed.
describe('makeSyncHostRoutes', () => {
  const deps = () => ({
    collectUnit: vi.fn(), unitScopes: vi.fn(), applyUnits: vi.fn(), resolveConflicts: vi.fn(),
  });

  it('routes every host request kind', () => {
    const routes = makeSyncHostRoutes(deps(), { publish() {} });
    for (const kind of SYNC_HOST_KINDS) expect(typeof routes[kind], kind).toBe('function');
  });

  it("syncApply RETURNS applyUnits's promise rather than a cache count", async () => {
    // `applied` is how many units are DURABLY this device's. The route must
    // hand back the model's answer, not something it counted itself.
    const d = deps(); d.applyUnits.mockResolvedValue({ applied: 3 });
    const routes = makeSyncHostRoutes(d, { publish() {} });
    await expect(routes.syncApply({ units: '[]' })).resolves.toEqual({ applied: 3 });
  });

  it('syncScopes refuses a non-array SYNCHRONOUSLY', () => {
    // A refusal on either entry point rather than an answer on one: the
    // handler is not async on purpose.
    const routes = makeSyncHostRoutes(deps(), { publish() {} });
    expect(() => routes.syncScopes({ unitIds: '{}' })).toThrow();
  });

  it('syncUnit passes the ids through as strings', () => {
    const d = deps();
    makeSyncHostRoutes(d, { publish() {} }).syncUnit({ unitId: 'resume:a', profileId: 'p1' });
    expect(d.collectUnit).toHaveBeenCalledWith('resume:a', 'p1');
  });

  it('the mutating routes republish, the read-only ones do not', async () => {
    const d = deps();
    d.applyUnits.mockResolvedValue({ applied: 0 }); d.resolveConflicts.mockResolvedValue({});
    const publish = vi.fn();
    const routes = makeSyncHostRoutes(d, { publish });
    await routes.syncApply({ units: '[]' });
    await routes.syncResolveConflicts({ conflicts: '[]' });
    expect(publish).toHaveBeenCalledTimes(2);
    routes.syncUnit({ unitId: 'x', profileId: 'p' });
    routes.syncScopes({ unitIds: '[]' });
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
