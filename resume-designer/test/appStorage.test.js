import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  appStorage,
  initAppStorage,
  __resetAppStorageForTests,
} from '../src/appStorage.js';

// In-memory fake of the Rust backend (the `invoke` seam).
function makeBackend(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    loadAll: vi.fn(async () => Object.fromEntries(files)),
    write: vi.fn(async (key, value) => { files.set(key, value); }),
    delete: vi.fn(async (key) => { files.delete(key); }),
    clear: vi.fn(async () => { files.clear(); }),
  };
}

beforeEach(() => {
  __resetAppStorageForTests();
  localStorage.clear();
});

describe('passthrough mode (browser / no init)', () => {
  it('reads and writes localStorage directly before any init', () => {
    appStorage.setItem('resume-zoom', '1.25');
    expect(localStorage.getItem('resume-zoom')).toBe('1.25');
    expect(appStorage.getItem('resume-zoom')).toBe('1.25');
    appStorage.removeItem('resume-zoom');
    expect(localStorage.getItem('resume-zoom')).toBeNull();
  });

  it('lists keys and flushes as a no-op', async () => {
    localStorage.setItem('resume-designer-data', '{}');
    expect(appStorage.keys()).toContain('resume-designer-data');
    await expect(appStorage.flush()).resolves.toBeUndefined();
  });
});

describe('cached mode (disk backend)', () => {
  it('serves reads from the boot snapshot', async () => {
    const backend = makeBackend({ 'resume-designer-data': '{"a":1}' });
    await initAppStorage({ backend });
    expect(appStorage.getItem('resume-designer-data')).toBe('{"a":1}');
    expect(appStorage.keys()).toEqual(['resume-designer-data']);
  });

  it('write-behinds set/remove and coalesces multiple sets per key', async () => {
    const backend = makeBackend();
    await initAppStorage({ backend });
    appStorage.setItem('resume-zoom', '1');
    appStorage.setItem('resume-zoom', '2');
    appStorage.setItem('resume-zoom', '3');
    expect(appStorage.getItem('resume-zoom')).toBe('3'); // sync read
    await appStorage.flush();
    // Coalesced: one disk write for the final value, not three.
    expect(backend.write).toHaveBeenCalledTimes(1);
    expect(backend.write).toHaveBeenCalledWith('resume-zoom', '3');
    appStorage.removeItem('resume-zoom');
    await appStorage.flush();
    expect(backend.delete).toHaveBeenCalledWith('resume-zoom');
    expect(backend.files.size).toBe(0);
  });

  it('clear() empties cache and backend', async () => {
    const backend = makeBackend({ a: '1', b: '2' });
    await initAppStorage({ backend });
    appStorage.clear();
    await appStorage.flush();
    expect(appStorage.keys()).toEqual([]);
    expect(backend.clear).toHaveBeenCalled();
  });

  it('skips a queued write when the key is removed before the write lands', async () => {
    const backend = makeBackend();
    await initAppStorage({ backend });
    appStorage.setItem('resume-zoom', '1');
    // Start the flush so drain() snapshots the write op, then remove the key
    // before the queued write executes. Without the cache.has() guard the
    // stale write op would materialize a spurious '' file on disk.
    const inFlight = appStorage.flush();
    appStorage.removeItem('resume-zoom');
    await inFlight;
    await appStorage.flush();
    expect(backend.write).not.toHaveBeenCalled();
    expect(backend.delete).toHaveBeenCalledTimes(1);
    expect(backend.files.size).toBe(0);
  });

  it('retries a failed write once, then keeps the value in cache and reports', async () => {
    const backend = makeBackend();
    backend.write
      .mockRejectedValueOnce(new Error('disk full'))
      .mockRejectedValueOnce(new Error('disk full'));
    await initAppStorage({ backend });
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    appStorage.setItem('resume-designer-data', '{"keep":"me"}');
    await appStorage.flush();
    expect(backend.write).toHaveBeenCalledTimes(2); // first try + one retry
    expect(errSpy).toHaveBeenCalled();
    // The session keeps working from cache even though disk failed.
    expect(appStorage.getItem('resume-designer-data')).toBe('{"keep":"me"}');
    errSpy.mockRestore();
  });

  it('readOnly mode never writes to the backend', async () => {
    const backend = makeBackend({ 'resume-designer-data': '{}' });
    await initAppStorage({ backend, readOnly: true });
    appStorage.setItem('resume-zoom', '2');
    await appStorage.flush();
    expect(backend.write).not.toHaveBeenCalled();
    expect(appStorage.getItem('resume-zoom')).toBe('2'); // cache still serves it
  });

  it('honors readOnly in the passthrough fallback after a loadAll failure', async () => {
    localStorage.setItem('resume-designer-data', '{"v":1}');
    const backend = makeBackend();
    backend.loadAll.mockRejectedValue(new Error('disk unreadable'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await initAppStorage({ backend, readOnly: true });
    // Print window fell back to passthrough — it must still never write.
    expect(() => appStorage.setItem('resume-zoom', '2')).not.toThrow();
    expect(localStorage.getItem('resume-zoom')).toBeNull();
    expect(() => appStorage.removeItem('resume-designer-data')).not.toThrow();
    expect(() => appStorage.clear()).not.toThrow();
    expect(localStorage.getItem('resume-designer-data')).toBe('{"v":1}');
    // Reads still serve the print window.
    expect(appStorage.getItem('resume-designer-data')).toBe('{"v":1}');
    errSpy.mockRestore();
  });
});

describe('boot migration (localStorage → disk adoption)', () => {
  it('adopts resume-* keys when the disk store is empty, then clears them', async () => {
    localStorage.setItem('resume-designer-data', '{"v":1}');
    localStorage.setItem('resume-designer-history-variant-1', '{"h":[]}');
    localStorage.setItem('resume-zoom', '1.5');
    localStorage.setItem('unrelated-key', 'leave-me');
    const backend = makeBackend();
    await initAppStorage({ backend });
    expect(backend.files.get('resume-designer-data')).toBe('{"v":1}');
    expect(backend.files.get('resume-designer-history-variant-1')).toBe('{"h":[]}');
    expect(backend.files.get('resume-zoom')).toBe('1.5');
    expect(appStorage.getItem('resume-designer-data')).toBe('{"v":1}');
    // Adopted keys leave localStorage; foreign keys stay.
    expect(localStorage.getItem('resume-designer-data')).toBeNull();
    expect(localStorage.getItem('unrelated-key')).toBe('leave-me');
  });

  it('does not adopt when the disk store already has data', async () => {
    localStorage.setItem('resume-designer-data', '{"stale":"localStorage"}');
    const backend = makeBackend({ 'resume-designer-data': '{"disk":"wins"}' });
    await initAppStorage({ backend });
    expect(appStorage.getItem('resume-designer-data')).toBe('{"disk":"wins"}');
    // localStorage untouched when adoption is skipped.
    expect(localStorage.getItem('resume-designer-data')).toBe('{"stale":"localStorage"}');
  });

  it('aborts adoption and leaves localStorage intact if a disk write fails', async () => {
    localStorage.setItem('resume-designer-data', '{"v":1}');
    const backend = makeBackend();
    backend.write.mockRejectedValue(new Error('disk full'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await initAppStorage({ backend });
    // Migration failed → keep running OFF localStorage (passthrough), no data loss.
    expect(localStorage.getItem('resume-designer-data')).toBe('{"v":1}');
    expect(appStorage.getItem('resume-designer-data')).toBe('{"v":1}');
    errSpy.mockRestore();
  });

  it('cleans the partial disk copy when adoption aborts midway', async () => {
    localStorage.setItem('resume-designer-data', '{"v":1}');
    localStorage.setItem('resume-zoom', '1.5');
    const backend = makeBackend();
    backend.write
      .mockImplementationOnce(async (key, value) => { backend.files.set(key, value); })
      .mockRejectedValue(new Error('disk full'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await initAppStorage({ backend });
    // The half-written copy must be wiped: a surviving partial copy would make
    // the next boot see a non-empty disk, skip adoption forever, and silently
    // shadow the newer localStorage data.
    expect(backend.clear).toHaveBeenCalledTimes(1);
    expect(backend.files.size).toBe(0);
    // localStorage stays fully intact as the source of truth.
    expect(localStorage.getItem('resume-designer-data')).toBe('{"v":1}');
    expect(localStorage.getItem('resume-zoom')).toBe('1.5');
    expect(appStorage.getItem('resume-zoom')).toBe('1.5'); // passthrough serves it
    errSpy.mockRestore();
  });

  it('adopts successfully on the next boot after a partial-write abort', async () => {
    localStorage.setItem('resume-designer-data', '{"v":1}');
    localStorage.setItem('resume-zoom', '1.5');
    const backend = makeBackend();
    backend.write
      .mockImplementationOnce(async (key, value) => { backend.files.set(key, value); })
      .mockRejectedValueOnce(new Error('disk full'));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await initAppStorage({ backend }); // first boot: partial write → abort + clean
    expect(backend.files.size).toBe(0);

    // Second boot: same backend (disk store genuinely empty after the cleanup),
    // same seeded localStorage, writes healthy again (the once-mocks are spent).
    __resetAppStorageForTests();
    await initAppStorage({ backend });
    expect(backend.files.get('resume-designer-data')).toBe('{"v":1}');
    expect(backend.files.get('resume-zoom')).toBe('1.5');
    expect(appStorage.getItem('resume-designer-data')).toBe('{"v":1}');
    // Adoption completed: ownership handed over from localStorage to disk.
    expect(localStorage.getItem('resume-designer-data')).toBeNull();
    expect(localStorage.getItem('resume-zoom')).toBeNull();
    errSpy.mockRestore();
  });

  it('skips migration in readOnly mode', async () => {
    localStorage.setItem('resume-designer-data', '{"v":1}');
    const backend = makeBackend();
    await initAppStorage({ backend, readOnly: true });
    expect(backend.write).not.toHaveBeenCalled();
    expect(localStorage.getItem('resume-designer-data')).toBe('{"v":1}');
  });
});
