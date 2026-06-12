//! Per-key disk storage for the renderer's app data.
//!
//! Each storage key (e.g. `resume-designer-data`) is one file under
//! `<app_data_dir>/storage/`, file content = the raw string value. Writes are
//! atomic and durable: write + fsync `.tmp-<key>` in the same dir, then rename
//! over the target. This replaces webview localStorage (hard ~5MB quota) as the
//! persistence backend; the JS facade in src/appStorage.js is the only caller.

use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

const TMP_PREFIX: &str = ".tmp-";

/// Keys come from a fixed app-side inventory (`resume-*`), but validate anyway
/// so a compromised renderer can't traverse out of the storage dir.
fn validate_key(key: &str) -> Result<(), String> {
    // 200, not 255: filesystem filename components cap at 255 bytes and the
    // `.tmp-` prefix eats 5. Real app keys are ~50 chars, so plenty of room.
    if key.is_empty() || key.len() > 200 {
        return Err("storage key must be 1-200 chars".into());
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

/// Read every stored key/value.
#[tauri::command(async)]
pub fn storage_load_all(app: AppHandle) -> Result<HashMap<String, String>, String> {
    let dir = storage_dir(&app)?;
    load_dir(&dir)
}

/// Scan one storage dir. Only entries whose name passes `validate_key` are
/// considered — exactly the set of names `storage_write` can create — so
/// foreign files (`.DS_Store`, stale `.tmp-*` from a crashed write) are skipped
/// and can't poison the load. But a read failure on a VALID-KEY file (transient
/// I/O, permissions, non-UTF-8 corruption) is FATAL: it aborts the whole load
/// so `initAppStorage`'s `loadAll()` rejects, rather than silently dropping real
/// app data. A silent drop would let the renderer boot as if that key never
/// existed and overwrite the still-present file on its next save (main window),
/// or capture an empty/stale resume (print window). On abort the main window
/// degrades to a read-only localStorage fallback — leaving the on-disk file
/// intact for a later boot once the transient error clears — and the print
/// window fails the export loudly. An unreadable *directory entry* (deleted
/// mid-scan, no name to validate) is still skipped; a failed directory listing
/// is also an error.
fn load_dir(dir: &Path) -> Result<HashMap<String, String>, String> {
    let mut map = HashMap::new();
    for entry in
        fs::read_dir(dir).map_err(|e| format!("list storage dir {}: {e}", dir.display()))?
    {
        let entry = match entry {
            Ok(entry) => entry,
            Err(e) => {
                eprintln!("storage: skipping unreadable dir entry: {e}");
                continue;
            }
        };
        let name = entry.file_name().to_string_lossy().into_owned();
        if validate_key(&name).is_err() || !entry.path().is_file() {
            continue;
        }
        match fs::read_to_string(entry.path()) {
            Ok(value) => {
                map.insert(name, value);
            }
            // The name passed validate_key, so this is real app data, not a
            // foreign dropping (those are filtered above). Failing to read it
            // must abort the load — never silently drop it (see fn doc).
            Err(e) => return Err(format!("read storage key {name}: {e}")),
        }
    }
    Ok(map)
}

/// Atomically write one key: temp file in the same dir, fsync, then rename.
#[tauri::command(async)]
pub fn storage_write(app: AppHandle, key: String, value: String) -> Result<(), String> {
    validate_key(&key)?;
    let dir = storage_dir(&app)?;
    let tmp = dir.join(format!("{TMP_PREFIX}{key}"));
    let target = dir.join(&key);
    let mut file = fs::File::create(&tmp).map_err(|e| format!("write {key}: {e}"))?;
    file.write_all(value.as_bytes())
        .map_err(|e| format!("write {key}: {e}"))?;
    // Sync the data BEFORE the rename: on power loss the rename can otherwise
    // hit disk first and replace the previous good value with an empty or
    // truncated file. The parent dir is deliberately NOT fsynced — losing the
    // rename itself just reverts to the old value, which is acceptable.
    file.sync_all().map_err(|e| format!("sync {key}: {e}"))?;
    drop(file); // close before rename (required on Windows)
    fs::rename(&tmp, &target).map_err(|e| format!("rename {key}: {e}"))?;
    Ok(())
}

#[tauri::command(async)]
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
#[tauri::command(async)]
pub fn storage_clear(app: AppHandle) -> Result<(), String> {
    let dir = storage_dir(&app)?;
    for entry in
        fs::read_dir(&dir).map_err(|e| format!("list storage dir {}: {e}", dir.display()))?
    {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().is_file() {
            match fs::remove_file(entry.path()) {
                Ok(()) => {}
                // Deleted concurrently between read_dir and here: already gone.
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    return Err(format!(
                        "clear {}: {e}",
                        entry.file_name().to_string_lossy()
                    ))
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{load_dir, validate_key};

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
        for k in [
            "",
            "../etc/passwd",
            "a/b",
            "a\\b",
            ".hidden",
            ".tmp-x",
            "a..b",
        ] {
            assert!(validate_key(k).is_err(), "{k} should be rejected");
        }
    }

    #[test]
    fn enforces_length_bound() {
        assert!(
            validate_key(&"a".repeat(200)).is_ok(),
            "200 chars should be valid"
        );
        assert!(
            validate_key(&"a".repeat(201)).is_err(),
            "201 chars should be rejected"
        );
    }

    /// Foreign files (`.DS_Store`, stale `.tmp-*`) must not poison the load —
    /// their names fail `validate_key`, so they're skipped and a valid readable
    /// key still loads cleanly.
    #[test]
    fn load_dir_skips_foreign_files() {
        let dir = tempfile::tempdir().expect("create temp dir");
        std::fs::write(dir.path().join("resume-designer-data"), "{\"ok\":true}").unwrap();
        // macOS Finder droppings: invalid UTF-8, name fails validate_key.
        std::fs::write(dir.path().join(".DS_Store"), [0x00u8, 0x01, 0xFF, 0xFE]).unwrap();
        // Leftover from a crashed write: name fails validate_key.
        std::fs::write(dir.path().join(".tmp-x"), "half-written").unwrap();

        let map = load_dir(dir.path()).expect("load_dir should not fail on foreign files");
        assert_eq!(
            map.len(),
            1,
            "only the valid readable key should load: {map:?}"
        );
        assert_eq!(
            map.get("resume-designer-data").map(String::as_str),
            Some("{\"ok\":true}")
        );
    }

    /// A file whose NAME is a valid app key but whose content cannot be read
    /// (non-UTF-8 corruption, transient I/O) must ABORT the whole load, not be
    /// silently dropped — otherwise the renderer boots as if that key never
    /// existed and overwrites the still-present file on its next save.
    #[test]
    fn load_dir_aborts_on_unreadable_valid_key() {
        let dir = tempfile::tempdir().expect("create temp dir");
        std::fs::write(dir.path().join("resume-designer-data"), "{\"ok\":true}").unwrap();
        // Valid key name, non-UTF-8 content: read_to_string fails → load aborts.
        std::fs::write(dir.path().join("resume-binary"), [0xFFu8, 0xFE, 0xFD]).unwrap();

        let result = load_dir(dir.path());
        assert!(
            result.is_err(),
            "a non-UTF-8 valid-key file must make load_dir fail, got: {result:?}"
        );
    }
}
