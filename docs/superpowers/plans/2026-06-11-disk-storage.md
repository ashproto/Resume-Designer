# Disk Storage Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all persisted app data out of webview `localStorage` (hard ~5MB quota in WKWebView/WebView2 — silently drops writes at quota) onto real disk files under the Tauri AppData dir, so storage is disk-limited and quota loss can never recur.

**Architecture:** A new `src/appStorage.js` facade owns all persisted state behind a synchronous `getItem/setItem/removeItem/keys/clear` API plus an awaitable `flush()`. In the browser (and jsdom tests) it passes straight through to `localStorage` — zero behavior change. On Tauri it loads everything once at boot into an in-memory `Map` via a Rust `storage_load_all` command, serves all reads synchronously from that cache, and write-behinds each changed key to its own file (`<AppData>/storage/<key>`) through Rust commands that write atomically (temp file + rename). A one-time boot migration adopts every `resume-*` key from `localStorage` onto disk. All 21 modules that touch `localStorage` swap to the facade mechanically.

**Tech Stack:** Tauri 2 (Rust commands, `@tauri-apps/api/core` invoke), vanilla ES modules, Vitest + jsdom, sonner (failure toasts).

---

## Approved design decisions (spec summary — the spec doc was waived)

1. **Per-key files**, raw string value as file content, in `<app_data_dir>/storage/`. One debounced edit rewrites only the few-KB key that changed (no write amplification); crash blast radius is one key. Torn multi-key states are benign: `variants` + `currentVariantId` live inside the single `resume-designer-data` key, and an orphaned `resume-designer-history-<id>` file is harmless.
2. **Rust commands, not fs-plugin permissions:** `storage_load_all`, `storage_write`, `storage_delete`, `storage_clear` — same pattern as the existing PDF/migration commands; the JS-facing fs capability surface stays empty. Atomic rename lives in Rust.
3. **Facade modes:** `passthrough` (browser/jsdom: direct `localStorage`, sync, no flush queue) and `cached` (Tauri: Map + write-behind). Mode picked in `initAppStorage()`; before init the facade is in passthrough — the boot order guarantees nothing meaningful runs before init on Tauri.
4. **Migration:** inside `initAppStorage()` (Tauri, non-readOnly): if the disk store is empty and `localStorage` has keys starting `resume-`, copy them all to disk (sequential, abort-on-error leaving localStorage untouched), then remove them from `localStorage`. Disk-non-empty ⇒ never adopt (disk wins).
5. **Print window:** `printEntry.js` runs `initAppStorage({ readOnly: true })` before `initPrintMode()`; readOnly mode never writes. `pdf.js` awaits `appStorage.flush()` right after `store.saveNow()` so the print window reads fresh data.
6. **Flush points:** after every write (coalesced per drain), plus explicit `await appStorage.flush()` before `location.reload()` in the backup-import flows and on Tauri `onCloseRequested` / `visibilitychange→hidden`.
7. **Failure surfacing:** a failed disk write retries once, then `console.error` + one-per-session sonner toast. Data stays in the in-memory cache, so the session keeps working and the next write retries. The `saveVariant` boolean guard from the quota fix stays (it protects the browser build and any synchronous-throw path).
8. **Backup envelope unchanged:** export/import iterate the facade instead of `localStorage`; old backups round-trip as-is. The quota-aware two-pass import logic stays (still meaningful in passthrough mode).
9. **Out of scope:** history/chat pruning, encryption at rest, sharding `resume-designer-data`.

## Prerequisites

- PR #39 (`feat/react-chrome`) is merged into `next`, including the two pending fixes (`fix(persistence): surface storage-full failures…`, `fix(onboarding): keep replayed onboarding dismissible`).
- Work happens on a new branch: `git checkout -b feat/disk-storage refs/heads/next` (note: a *tag* named `next` also exists — always use `refs/heads/next`).
- **REPO RULE (overrides every commit step below):** never run `git commit` or `git push` without Ash's explicit go-ahead in the current turn. Each "Commit" step means: stage, show the diff summary, and ask. The PR at the end targets `next` (never `main` — CI's `only-next-into-main` guard rejects it).
- Working dir for all npm/cargo commands: `resume-designer/` (npm) and `resume-designer/src-tauri/` (cargo).

## File structure

| File | Role |
|---|---|
| Create `resume-designer/src-tauri/src/commands/storage.rs` | 4 storage commands + key validation, atomic writes |
| Modify `resume-designer/src-tauri/src/commands/mod.rs` | declare + re-export the storage module |
| Modify `resume-designer/src-tauri/src/lib.rs:27-36` | register the 4 commands |
| Create `resume-designer/src/appStorage.js` | the facade (both modes, migration, flush, failure toast) |
| Create `resume-designer/test/appStorage.test.js` | facade + migration unit tests (injected mock backend) |
| Modify `resume-designer/src/main.js` | `initAppStorage()` first in `init()`; close-flush hooks; swap flag/clear uses |
| Modify `resume-designer/src/printEntry.js` | readOnly init before `initPrintMode()` |
| Modify `resume-designer/src/pdf.js` | flush after `store.saveNow()` |
| Modify `resume-designer/src/backupFlow.js` | flush before each `reloadWithOverlay(...)` |
| Modify `resume-designer/src/persistence.js`, `src/store.js` | core consumers → facade |
| Modify 15 small consumers (list in Task 6) | mechanical `localStorage` → `appStorage` swap |
| Modify `resume-designer/TAURI.md` | document the storage layout + migration |

---

### Task 1: Rust storage commands

**Files:**
- Create: `resume-designer/src-tauri/src/commands/storage.rs`
- Modify: `resume-designer/src-tauri/src/commands/mod.rs` (add `pub mod storage;` next to the existing `pub mod migration;` / `pub mod updater;` declarations — open the file and match its existing style)
- Modify: `resume-designer/src-tauri/src/lib.rs:27-36`

- [ ] **Step 1: Write `storage.rs` with key validation + unit tests**

```rust
//! Per-key disk storage for the renderer's app data.
//!
//! Each storage key (e.g. `resume-designer-data`) is one file under
//! `<app_data_dir>/storage/`, file content = the raw string value. Writes are
//! atomic: write to `.tmp-<key>` in the same dir, then rename over the target.
//! This replaces webview localStorage (hard ~5MB quota) as the persistence
//! backend; the JS facade in src/appStorage.js is the only caller.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

use tauri::{AppHandle, Manager};

const TMP_PREFIX: &str = ".tmp-";

/// Keys come from a fixed app-side inventory (`resume-*`), but validate anyway
/// so a compromised renderer can't traverse out of the storage dir.
fn validate_key(key: &str) -> Result<(), String> {
    if key.is_empty() || key.len() > 256 {
        return Err("storage key must be 1-256 chars".into());
    }
    if !key
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        || key.contains("..")
        || key.starts_with('.')
    {
        return Err(format!("invalid storage key: {key}"));
    }
    Ok(())
}

fn storage_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?
        .join("storage");
    fs::create_dir_all(&dir).map_err(|e| format!("create storage dir: {e}"))?;
    Ok(dir)
}

/// Read every stored key/value. Skips temp files left by a crashed write.
#[tauri::command]
pub fn storage_load_all(app: AppHandle) -> Result<HashMap<String, String>, String> {
    let dir = storage_dir(&app)?;
    let mut map = HashMap::new();
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(TMP_PREFIX) || !entry.path().is_file() {
            continue;
        }
        let value = fs::read_to_string(entry.path()).map_err(|e| format!("read {name}: {e}"))?;
        map.insert(name, value);
    }
    Ok(map)
}

/// Atomically write one key: temp file in the same dir, then rename.
#[tauri::command]
pub fn storage_write(app: AppHandle, key: String, value: String) -> Result<(), String> {
    validate_key(&key)?;
    let dir = storage_dir(&app)?;
    let tmp = dir.join(format!("{TMP_PREFIX}{key}"));
    let target = dir.join(&key);
    fs::write(&tmp, value).map_err(|e| format!("write {key}: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| format!("rename {key}: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn storage_delete(app: AppHandle, key: String) -> Result<(), String> {
    validate_key(&key)?;
    let path = storage_dir(&app)?.join(&key);
    match fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("delete {key}: {e}")),
    }
}

/// Remove every stored key (backup "Replace" import wipes before rewriting).
#[tauri::command]
pub fn storage_clear(app: AppHandle) -> Result<(), String> {
    let dir = storage_dir(&app)?;
    for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().is_file() {
            fs::remove_file(entry.path()).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_key;

    #[test]
    fn accepts_app_keys() {
        for k in [
            "resume-designer-data",
            "resume-designer-history-variant-123",
            "resume-zoom",
            "resume-edit-hint-dismissed",
        ] {
            assert!(validate_key(k).is_ok(), "{k} should be valid");
        }
    }

    #[test]
    fn rejects_traversal_and_hidden() {
        for k in ["", "../etc/passwd", "a/b", "a\\b", ".hidden", ".tmp-x", "a..b"] {
            assert!(validate_key(k).is_err(), "{k} should be rejected");
        }
    }
}
```

Note: `a/b` and `a\\b` are rejected by the character allowlist (no `/` or `\`), `a..b` by the explicit `..` check, `.hidden`/`.tmp-x` by `starts_with('.')`.

- [ ] **Step 2: Run the Rust tests — expect both to pass**

Run: `cd resume-designer/src-tauri && cargo test storage`
Expected: `test result: ok. 2 passed`

- [ ] **Step 3: Register the module and commands**

In `resume-designer/src-tauri/src/commands/mod.rs`, add alongside the existing module declarations:

```rust
pub mod storage;
```

In `resume-designer/src-tauri/src/lib.rs`, extend the handler list (currently lines 27-36):

```rust
        .invoke_handler(tauri::generate_handler![
            commands::pick_pdf_save_path,
            commands::capture_pdf_from_window,
            commands::migration::probe_legacy_electron_data,
            commands::migration::import_legacy_electron_data,
            commands::storage::storage_load_all,
            commands::storage::storage_write,
            commands::storage::storage_delete,
            commands::storage::storage_clear,
            #[cfg(desktop)]
            commands::updater::check_update_on_channel,
            #[cfg(desktop)]
            commands::updater::install_pending_update
        ]);
```

- [ ] **Step 4: Verify compile + lints**

Run: `cd resume-designer/src-tauri && cargo check && cargo clippy -- -D warnings`
Expected: both exit 0.

- [ ] **Step 5: Commit (GATED — get Ash's explicit go-ahead first)**

```bash
git add resume-designer/src-tauri/src/commands/storage.rs resume-designer/src-tauri/src/commands/mod.rs resume-designer/src-tauri/src/lib.rs
git commit -m "feat(storage): Rust per-key disk storage commands with atomic writes"
```

---

### Task 2: appStorage facade (passthrough + cached modes, write-behind, flush, failure toast)

**Files:**
- Create: `resume-designer/src/appStorage.js`
- Test: `resume-designer/test/appStorage.test.js`

- [ ] **Step 1: Write the failing tests**

```js
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

  it('skips migration in readOnly mode', async () => {
    localStorage.setItem('resume-designer-data', '{"v":1}');
    const backend = makeBackend();
    await initAppStorage({ backend, readOnly: true });
    expect(backend.write).not.toHaveBeenCalled();
    expect(localStorage.getItem('resume-designer-data')).toBe('{"v":1}');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd resume-designer && npx vitest run test/appStorage.test.js`
Expected: FAIL — `Cannot find module '../src/appStorage.js'`

- [ ] **Step 3: Implement `src/appStorage.js`**

```js
/**
 * appStorage — the single persistence facade for every owned key.
 *
 * Why: webview localStorage has a hard ~5MB per-origin quota (WKWebView /
 * WebView2). At quota, writes silently fail and user data (new resumes, edits)
 * vanished. On desktop we therefore persist to real files via Rust commands
 * (one file per key under <AppData>/storage/, atomic tmp+rename writes) —
 * disk-limited, user-visible, Time-Machine friendly.
 *
 * Modes:
 *  - passthrough (browser build, jsdom tests, and pre-init): direct
 *    localStorage calls, synchronous, flush() is a no-op. Identical to the
 *    pre-rework behavior, so the quota guards in persistence.js still matter.
 *  - cached (Tauri, after initAppStorage()): everything is loaded once into an
 *    in-memory Map; reads are synchronous from the cache; each set/remove
 *    marks the key dirty and a coalesced drain write-behinds it to disk.
 *
 * Contract: on Tauri, `await initAppStorage()` MUST run before any module
 * reads or writes storage — it is the first line of init() in main.js (and of
 * printEntry.js with { readOnly: true }). Boot order is already a fragile
 * contract in this app (see maybeAutoMigrateLegacyData); this extends it.
 */
import { toast } from 'sonner';

// Canonical Tauri sniff (same predicate as native.js / the index.html inline
// script). Duplicated here instead of importing native.js to avoid an import
// cycle: native.js itself persists through this facade.
const IS_TAURI =
  typeof window !== 'undefined' &&
  ('isTauri' in window || '__TAURI_INTERNALS__' in window || '__TAURI__' in window);

// Every key this app owns starts with `resume-` (resume-designer-*, resume-zoom,
// resume-edit-hint-dismissed, the per-variant history prefix, the model-catalog
// cache, the electron-migration flag). Used only by the one-time adoption.
const OWNED_PREFIX = 'resume-';

let mode = 'passthrough'; // 'passthrough' | 'cached'
let readOnly = false;
let backendImpl = null;
let cache = new Map();
let dirty = new Map(); // key -> 'write' | 'delete'
let drainScheduled = false;
let chain = Promise.resolve();
let failureToastShown = false;

function tauriBackend() {
  return {
    async loadAll() {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('storage_load_all');
    },
    async write(key, value) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('storage_write', { key, value });
    },
    async delete(key) {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('storage_delete', { key });
    },
    async clear() {
      const { invoke } = await import('@tauri-apps/api/core');
      return invoke('storage_clear');
    },
  };
}

function reportWriteFailure(key, err) {
  console.error(`[appStorage] disk write failed for "${key}":`, err);
  if (failureToastShown) return;
  failureToastShown = true;
  try {
    toast.error(
      'Some changes could not be saved to disk — check free disk space. '
      + 'Your edits are kept in memory for this session; export a backup via '
      + 'Settings → Data → Export Backup.',
    );
  } catch {
    /* no Toaster mounted (print window) — console.error above suffices */
  }
}

function scheduleDrain() {
  if (drainScheduled || readOnly) return;
  drainScheduled = true;
  setTimeout(drain, 0);
}

function drain() {
  drainScheduled = false;
  const batch = [...dirty.entries()];
  dirty.clear();
  for (const [key, op] of batch) {
    // Value is read from the cache at write time, so a set that happened
    // after this key was marked dirty still writes the latest value.
    chain = chain.then(async () => {
      try {
        if (op === 'delete') await backendImpl.delete(key);
        else await backendImpl.write(key, cache.get(key) ?? '');
      } catch {
        try {
          if (op === 'delete') await backendImpl.delete(key);
          else await backendImpl.write(key, cache.get(key) ?? '');
        } catch (err2) {
          // Keep the value in cache (session keeps working); a later set of
          // the same key re-dirties and retries. Don't re-queue here — a
          // permanently full disk would loop forever.
          reportWriteFailure(key, err2);
        }
      }
    });
  }
}

export const appStorage = {
  getItem(key) {
    if (mode === 'passthrough') return localStorage.getItem(key);
    return cache.has(key) ? cache.get(key) : null;
  },

  setItem(key, value) {
    const v = String(value);
    if (mode === 'passthrough') {
      localStorage.setItem(key, v); // may throw on quota — callers guard
      return;
    }
    cache.set(key, v);
    if (readOnly) return; // print window: cache-only, never queued to disk
    dirty.set(key, 'write');
    scheduleDrain();
  },

  removeItem(key) {
    if (mode === 'passthrough') {
      localStorage.removeItem(key);
      return;
    }
    cache.delete(key);
    if (readOnly) return; // print window: cache-only, never queued to disk
    dirty.set(key, 'delete');
    scheduleDrain();
  },

  /** Remove every stored key (backup "Replace" import path). */
  clear() {
    if (mode === 'passthrough') {
      localStorage.clear();
      return;
    }
    cache.clear();
    dirty.clear();
    if (!readOnly) {
      chain = chain.then(() => backendImpl.clear()).catch((e) => reportWriteFailure('<clear>', e));
    }
  },

  /** Snapshot of all stored keys (replaces localStorage index iteration). */
  keys() {
    if (mode === 'passthrough') {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) out.push(localStorage.key(i));
      return out;
    }
    return [...cache.keys()];
  },

  /** Resolve once every pending disk write has settled. No-op in passthrough. */
  async flush() {
    if (mode === 'passthrough') return;
    if (dirty.size) drain();
    await chain;
  },
};

/**
 * Pick the backend and load the boot snapshot. Browser → stays passthrough.
 * Tauri (or an injected test backend) → cached mode + one-time adoption of
 * localStorage `resume-*` keys when the disk store is empty.
 */
export async function initAppStorage({ backend = null, readOnly: ro = false } = {}) {
  if (!backend && !IS_TAURI) return; // browser/jsdom: passthrough forever

  backendImpl = backend || tauriBackend();
  readOnly = ro;

  let loaded;
  try {
    loaded = await backendImpl.loadAll();
  } catch (err) {
    // Disk unreadable: stay on passthrough localStorage rather than booting
    // with an empty store (which would look like total data loss).
    console.error('[appStorage] loadAll failed — staying on localStorage:', err);
    backendImpl = null;
    return;
  }
  cache = new Map(Object.entries(loaded));
  mode = 'cached';

  // One-time adoption: disk empty + localStorage has owned keys.
  if (!readOnly && cache.size === 0) {
    const owned = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(OWNED_PREFIX)) owned.push(k);
    }
    if (owned.length) {
      try {
        for (const k of owned) {
          const v = localStorage.getItem(k);
          if (v === null) continue;
          await backendImpl.write(k, v); // sequential; throw aborts adoption
          cache.set(k, v);
        }
        // Every write landed — localStorage is no longer the source of truth.
        for (const k of owned) localStorage.removeItem(k);
        console.log(`[appStorage] adopted ${owned.length} keys from localStorage to disk`);
      } catch (err) {
        // Abort cleanly: fall back to passthrough so the app keeps running
        // off the still-intact localStorage. Nothing was removed.
        console.error('[appStorage] adoption failed — staying on localStorage:', err);
        cache = new Map();
        dirty = new Map();
        mode = 'passthrough';
        backendImpl = null;
      }
    }
  }
}

/** Test-only: reset module state between tests. */
export function __resetAppStorageForTests() {
  mode = 'passthrough';
  readOnly = false;
  backendImpl = null;
  cache = new Map();
  dirty = new Map();
  drainScheduled = false;
  chain = Promise.resolve();
  failureToastShown = false;
}
```

- [ ] **Step 4: Run the facade tests — expect all green**

Run: `cd resume-designer && npx vitest run test/appStorage.test.js`
Expected: PASS (12 tests).

- [ ] **Step 5: Run the whole suite + lint (nothing else changed yet)**

Run: `cd resume-designer && npx vitest run && npm run lint`
Expected: all test files pass; eslint clean.

- [ ] **Step 6: Commit (GATED — get Ash's explicit go-ahead first)**

```bash
git add resume-designer/src/appStorage.js resume-designer/test/appStorage.test.js
git commit -m "feat(storage): appStorage facade with write-behind cache and boot adoption"
```

---

### Task 3: Boot wiring — main window, print window, flush points

**Files:**
- Modify: `resume-designer/src/main.js` (init() at line ~276; resetForTesting at ~405)
- Modify: `resume-designer/src/printEntry.js`
- Modify: `resume-designer/src/pdf.js` (generatePdfNative, ~line 142)
- Modify: `resume-designer/src/backupFlow.js` (each `reloadWithOverlay(` call)

- [ ] **Step 1: main.js — init storage first, add close-flush hooks**

Add to main.js imports: `import { appStorage, initAppStorage } from './appStorage.js';`

At the top of `init()` (currently line 276, BEFORE the `await maybeAutoMigrateLegacyData();` line and its comment):

```js
export async function init() {
  // FIRST: bring up the storage facade. On Tauri this loads the per-key disk
  // store into memory (and one-time adopts any legacy localStorage data); in
  // the browser it stays a localStorage passthrough. EVERYTHING below —
  // legacy migration, settings, theme, store — reads through it.
  await initAppStorage();

  // ... existing body starting with the maybeAutoMigrateLegacyData() comment
```

Inside the existing `if (isTauri) { ... }` block in `init()` (the one that adds the `desktop` classes, ~line 291), add flush-on-exit wiring after the external-link interceptor:

```js
    // Flush pending disk writes when the window is closing or backgrounded.
    // The write-behind queue is otherwise drained within ~1 tick, but "quit
    // immediately after an edit" must never lose the last write.
    try {
      const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const win = getCurrentWebviewWindow();
      await win.onCloseRequested(async () => {
        try { store.saveNow(); } catch { /* nothing pending */ }
        await appStorage.flush();
      });
    } catch (e) {
      console.warn('[Storage] close-flush hook unavailable:', e);
    }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') appStorage.flush();
    });
```

Also in main.js, swap the debug helper (currently ~line 405-409) to wipe both stores:

```js
    window.resetForTesting = () => {
      appStorage.clear();
      appStorage.flush().finally(() => {
        localStorage.clear();
        location.reload();
      });
    };
```

- [ ] **Step 2: printEntry.js — read-only init before render**

Replace the whole file body (currently imports `initPrintMode` and calls it):

```js
// Framework-free entry for the hidden PDF-capture window (print.html).
//
// The old print path was index.html?print=1 -> main.js -> init() ->
// initPrintMode(). Now that index.html is the React shell, the capture window
// loads this entry instead and calls initPrintMode() directly. It imports from
// the vanilla main.js (NO React in this graph), so the import graph + render
// path are identical to before — only the host document changed.
//
// Storage must be initialized read-only BEFORE initPrintMode() reads the
// variant data: on Tauri the data lives in per-key disk files, not
// localStorage. readOnly means this window can never write app data — the
// main window remains the single writer.
import { initAppStorage } from './appStorage.js';
import { initPrintMode } from './main.js';

initAppStorage({ readOnly: true }).then(() => initPrintMode());
```

- [ ] **Step 3: pdf.js — flush after saveNow**

In `generatePdfNative` (the `store.saveNow()` block at ~line 142), add the flush so the print window's fresh `storage_load_all` sees the save:

```js
  try {
    store.saveNow();
  } catch (e) {
    console.warn('PDF Export: store.saveNow() failed; continuing with whatever is persisted:', e);
  }
  // saveNow() wrote through appStorage's in-memory cache; make sure the disk
  // write has landed before the print window boots and loads from disk.
  await appStorage.flush();
```

Add to pdf.js imports: `import { appStorage } from './appStorage.js';`

- [ ] **Step 4: backupFlow.js — flush before every reload**

Find each call site: `grep -n "reloadWithOverlay(" resume-designer/src/backupFlow.js` (expect 2-3 call sites in the import-success paths, plus the function definition at ~line 22). Immediately before each CALL (not the definition), insert:

```js
  await appStorage.flush(); // imported envelope keys must hit disk before reload
```

(The enclosing import handlers are already async — they `await` the import/confirm flow. If one is not async, make it async; callers are fire-and-forget click handlers.) Add the import: `import { appStorage } from './appStorage.js';`

- [ ] **Step 5: Gate**

Run: `cd resume-designer && npm run lint && npx vitest run && npm run build`
Expected: all green (the facade is passthrough under jsdom/browser, so behavior is unchanged).

- [ ] **Step 6: Commit (GATED — get Ash's explicit go-ahead first)**

```bash
git add resume-designer/src/main.js resume-designer/src/printEntry.js resume-designer/src/pdf.js resume-designer/src/backupFlow.js
git commit -m "feat(storage): boot appStorage first, read-only print init, flush at exit points"
```

---

### Task 4: Swap the core consumers — persistence.js and store.js

**Files:**
- Modify: `resume-designer/src/persistence.js`
- Modify: `resume-designer/src/store.js:247-285` (saveHistory/loadHistory)
- Test: existing `resume-designer/test/*.test.js` (must stay green untouched — they run in passthrough mode)

- [ ] **Step 1: persistence.js — route everything through the facade**

Add import at top (next to the existing `import { isTauri } from './native.js';`):

```js
import { appStorage } from './appStorage.js';
```

Then swap every direct `localStorage` use in this file (36 occurrences — `grep -n localStorage src/persistence.js` and walk the list). The four shapes:

1. `loadFromStorage()` / `saveToStorage()` (lines ~63-85): `localStorage.getItem(STORAGE_KEY)` → `appStorage.getItem(STORAGE_KEY)`; `localStorage.setItem(STORAGE_KEY, JSON.stringify(data))` → `appStorage.setItem(STORAGE_KEY, JSON.stringify(data))`. Keep the try/catch and the boolean return — in passthrough (browser) quota can still throw; in cached mode setItem never throws and disk failures surface via the facade's toast.
2. `writeOwnedKeyOrSkip` (line ~365): `localStorage.setItem(key, value)` → `appStorage.setItem(key, value)`. Keep the quota-skip logic (browser path).
3. `collectOwnedKeys` (line ~382): replace the index loop with the facade snapshot:

```js
function collectOwnedKeys() {
  return appStorage.keys().filter((k) => k && isOwnedKey(k));
}
```

4. Export/import bodies: `localStorage.getItem(k)` in `exportFullBackup` → `appStorage.getItem(k)`; `localStorage.removeItem(k)` in `importFullBackupFromEnvelope` → `appStorage.removeItem(k)`; same swaps in `importFullBackupMerge` (walk every remaining grep hit until `grep -c "localStorage" src/persistence.js` prints 0 — comments mentioning localStorage may stay but update them where they describe behavior).

- [ ] **Step 2: store.js — history through the facade**

Add import: `import { appStorage } from './appStorage.js';` and in `saveHistory` (line ~256) / `loadHistory` (line ~268) swap `localStorage.setItem(` → `appStorage.setItem(` and `localStorage.getItem(` → `appStorage.getItem(`. Keep both try/catch blocks.

- [ ] **Step 3: Run the full suite — the 38 existing tests are the regression net**

Run: `cd resume-designer && npx vitest run`
Expected: ALL pass with zero test-file edits (passthrough mode = old behavior). If any existing test fails, the facade passthrough is wrong — fix the facade, do not touch the tests.

- [ ] **Step 4: Commit (GATED — get Ash's explicit go-ahead first)**

```bash
git add resume-designer/src/persistence.js resume-designer/src/store.js
git commit -m "refactor(storage): route persistence and history through appStorage"
```

---

### Task 5: Swap the remaining consumers (mechanical)

**Files (all Modify):** every remaining module with direct `localStorage` calls. For EACH file: add `import { appStorage } from './appStorage.js';` (adjust relative path for `components/onboarding/`), replace each `localStorage.` call with `appStorage.`, keep all existing try/catch and quota logic.

| File | Occurrences (from the Task-start grep) | Keys touched |
|---|---|---|
| `src/theme.js` | get ~16, set ~60 | `resume-designer-theme` |
| `src/native.js` | lines ~167, 175, 191, 208, 215 | update-channel, auto-update-check |
| `src/jobDescriptions.js` | load + `save()` at ~34 | job descriptions |
| `src/chatThreads.js` | 6 | chat threads (+ legacy chat-history) |
| `src/tokenTrackingService.js` | 4 | token usage |
| `src/aiService.js` | 3 | model-catalog cache |
| `src/inlineEditor.js` | 3 | edit-hint-dismissed |
| `src/zoomControls.js` | 3 | resume-zoom |
| `src/accentService.js` / `src/fontService.js` / `src/spacingService.js` / `src/photoService.js` / `src/headerStyleService.js` | 2-3 each | their settings keys |
| `src/onboarding.js` | ~36, 44, 49 | onboarding-complete flag |
| `src/onboardingLogic.js` | 1 | (comment/use — check grep) |
| `src/components/onboarding/OnboardingWizard.jsx` | 1 | onboarding flag read (import path `../../appStorage.js`) |
| `src/main.js` | ELECTRON_MIGRATION_FLAG ops at ~186-222 (the `localStorage.clear()` at ~408 was already handled in Task 3) | migration flag |
| `src/backupFlow.js` | remaining direct uses (2) | owned-key ops |
| `src/pdf.js` | 3 | check grep; swap each |

- [ ] **Step 1: Do the swap file-by-file** (run `grep -n "localStorage" src/<file>` first, replace each call site, keep comments accurate)

- [ ] **Step 2: Verify zero direct uses remain outside the facade**

Run: `cd resume-designer && grep -rn "localStorage\." src/ --include="*.js" --include="*.jsx" | grep -v "^src/appStorage.js" | grep -v "//"`
Expected: no output (the facade is the only module touching `localStorage`; commented mentions are fine).

- [ ] **Step 3: Full gate**

Run: `cd resume-designer && npm run lint && npx vitest run && npm run build`
Expected: all green.

- [ ] **Step 4: Commit (GATED — get Ash's explicit go-ahead first)**

```bash
git add -A resume-designer/src
git commit -m "refactor(storage): swap all remaining localStorage consumers to appStorage"
```

---

### Task 6: Docs

**Files:**
- Modify: `resume-designer/TAURI.md` (add a "Data storage" section)

- [ ] **Step 1: Document the layout + migration in TAURI.md**

Add a section:

```markdown
## Data storage

Desktop builds persist all app data as one file per key under
`<app_data_dir>/storage/` (macOS:
`~/Library/Application Support/com.resumedesigner.app/storage/`). File name =
storage key (e.g. `resume-designer-data`), content = the raw string value.
Writes are atomic (temp file + rename) via the Rust `storage_*` commands; the
JS side goes through `src/appStorage.js`, which serves reads from an in-memory
cache and write-behinds changes.

On first launch after upgrading, any existing webview-localStorage data
(`resume-*` keys) is adopted onto disk once and removed from localStorage.
Browser builds keep using localStorage (the facade passes through).

The backup envelope (Settings → Data) is unchanged and round-trips both
backends.
```

- [ ] **Step 2: Commit (GATED — get Ash's explicit go-ahead first)**

```bash
git add resume-designer/TAURI.md
git commit -m "docs(storage): document per-key disk storage and adoption migration"
```

---

### Task 7: Verification gate (automated + browser preview)

- [ ] **Step 1: Full local gate**

Run: `cd resume-designer && npm run lint && npx vitest run && npm run build && cd src-tauri && cargo check && cargo clippy -- -D warnings && cargo test storage`
Expected: everything green.

- [ ] **Step 2: Browser-preview regression (passthrough mode)**

Using the Claude_Preview tools against the built app (NEVER with real data — snapshot localStorage first, fabricate test data, restore after): run the established flows — generate-resume-for-job with a mocked OpenRouter SSE response (new variant appears in dropdown + on screen), quota-filled storage still produces the visible error toast (the Task-4 passthrough keeps the guard meaningful), backup export/import round-trip. Expected: identical behavior to pre-rework (browser uses localStorage passthrough).

- [ ] **Step 3: PR (GATED — get Ash's explicit go-ahead first)**

Push `feat/disk-storage` and open a PR **against `next`** with the test plan below in the body.

---

### Task 8: Desktop verification checklist (Ash-run; cannot be done headless)

- [ ] `npm run tauri:dev` with existing localStorage data → first launch logs `adopted N keys`, `~/Library/Application Support/com.resumedesigner.app/storage/` contains the per-key files, app state identical; relaunch → no re-adoption.
- [ ] Create/edit a resume, quit IMMEDIATELY → relaunch shows the last edit (close-flush works).
- [ ] Generate a resume for a job (real key) → new variant appears; file `resume-designer-data` updates on disk.
- [ ] PDF export end-to-end (print window reads disk data; output matches).
- [ ] Backup export → wipe (`resetForTesting()`) → import Replace → everything restored.
- [ ] Build a multi-MB dataset (many variants + long history) far beyond 5MB → everything keeps saving (the original quota bug is structurally gone).

---

## Self-review notes

- **Coverage vs. approved design:** per-key files (T1), facade modes + write-behind + flush + toast (T2), boot-first init + readOnly print + flush points (T3), adoption migration (T2 impl + tests), 21-module swap (T4+T5), envelope unchanged (T4 §1.4), docs (T6), browser fallback + guard retained (T2/T4), verification (T7/T8). No gaps found.
- **Boot-order constraint** is enforced structurally: `initAppStorage()` is the first awaited line of `init()`, and `printEntry.js` awaits it before `initPrintMode()`. Modules only read storage from inside init-triggered flows (verified during design exploration; theme/native reads happen post-init).
- **Import cycle avoided:** appStorage does its own Tauri sniff instead of importing native.js.
- **Existing 38 tests are the passthrough regression net** — they must pass unmodified (called out in T4 Step 3).
