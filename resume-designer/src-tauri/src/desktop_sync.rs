//! macOS-only bridge between the page and the CloudKit transport.
//!
//! The transport is `ios/OPSync.swift`, compiled into this binary unchanged
//! (see build.rs). What lives here is the desktop half of its host: the C
//! surface Swift calls into, and the two Tauri commands the page answers on.
//! Nothing in this file may construct a `CKContainer` outside the signed
//! bundle — see the link test below for why.
//!
//! macOS only. The gate is the `#[cfg(target_os = "macos")]` on this module's
//! `mod` line in lib.rs — not repeated here, where a second copy is a
//! duplicated-attribute lint that clippy -D warnings turns into an error.

use std::ffi::{c_char, CStr, CString};
use tauri::{AppHandle, Manager};

extern "C" {
    fn op_sync_register(cb: extern "C" fn(u64, *const c_char));
    fn op_sync_resume(id: u64, json: *const c_char);
    fn op_sync_start(profile_id: *const c_char, known_profile_ids_json: *const c_char);
    fn op_sync_stop();
}

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// Swift → Rust → page. Runs on the transport's executor, so it must return
/// quickly: it evaluates one call and does not wait for the answer, which
/// arrives on its own through `desktop_sync_reply`. Nothing here may call back
/// into Swift — the reentrancy rule the iOS host learned the hard way.
extern "C" fn on_request(id: u64, json: *const c_char) {
    let json = unsafe { CStr::from_ptr(json) }.to_string_lossy().into_owned();
    let Some(app) = APP.get() else { return };
    let Some(window) = app.get_webview_window("main") else { return };
    // `window.__opDesktopSync` is installed by desktopSync.js under Tauri on
    // macOS. Guarded so a request that lands before the page is ready is a
    // no-op the Swift deadline turns into a failed host call, not a script
    // error in the page.
    let script = format!(
        "window.__opDesktopSync && window.__opDesktopSync.request({id}, {})",
        serde_json::to_string(&json).unwrap_or_else(|_| "\"\"".into())
    );
    let _ = window.eval(&script);
}

/// The page's answer to a request, keyed by the id Swift issued.
#[tauri::command]
pub fn desktop_sync_reply(id: u64, json: String) -> Result<(), String> {
    let c = CString::new(json).map_err(|e| e.to_string())?;
    unsafe { op_sync_resume(id, c.as_ptr()) };
    Ok(())
}

/// The page reports the active profile — and the registry's full list, which
/// the page owns — and the transport starts against that zone.
#[tauri::command]
pub fn desktop_sync_report_profile(profile_id: String, known_profile_ids: Vec<String>) -> Result<(), String> {
    let p = CString::new(profile_id).map_err(|e| e.to_string())?;
    let k = CString::new(serde_json::to_string(&known_profile_ids).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    unsafe { op_sync_start(p.as_ptr(), k.as_ptr()) };
    Ok(())
}

/// Called once from setup: hands the app handle to the callback and registers
/// the callback with Swift. Nothing starts until the page reports a profile.
pub fn install(app: &AppHandle) {
    let _ = APP.set(app.clone());
    unsafe { op_sync_register(on_request) }
}

pub fn stop() {
    unsafe { op_sync_stop() }
}

#[cfg(test)]
mod link_tests {
    use std::ffi::{c_char, CStr};

    extern "C" {
        fn op_sync_link_check() -> *mut c_char;
        fn op_sync_free(p: *mut c_char);
    }

    #[test]
    fn the_swift_library_is_linked_and_callable() {
        // Never a CKContainer here: outside a signed, entitled bundle
        // `CKContainer(identifier:)` throws, and this runs under `cargo test`.
        // This proves only the static link and the C surface, both directions
        // of which the scratchpad spike already showed working.
        let p = unsafe { op_sync_link_check() };
        let s = unsafe { CStr::from_ptr(p) }.to_str().unwrap().to_owned();
        unsafe { op_sync_free(p) };
        assert_eq!(s, "op-desktop-sync:linked");
    }
}

#[cfg(test)]
mod bridge_tests {
    use std::ffi::{c_char, CStr, CString};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    extern "C" {
        fn op_sync_register(cb: extern "C" fn(u64, *const c_char));
        fn op_sync_ping();
        fn op_sync_resume(id: u64, json: *const c_char);
    }

    // What Swift asked of Rust, in order. A Mutex rather than a channel because
    // the callback is `extern "C"` and cannot capture.
    static SEEN: Mutex<Vec<(u64, String)>> = Mutex::new(Vec::new());

    extern "C" fn record(id: u64, json: *const c_char) {
        let s = unsafe { CStr::from_ptr(json) }.to_string_lossy().into_owned();
        SEEN.lock().unwrap().push((id, s));
    }

    fn wait_for(n: usize) -> Vec<(u64, String)> {
        // The pong arrives from a Swift Task after the continuation resumes:
        // asynchronous, but bounded. 2s is generous by two orders of magnitude.
        let start = Instant::now();
        while SEEN.lock().unwrap().len() < n {
            assert!(start.elapsed() < Duration::from_secs(2), "timed out waiting for {n} callbacks: {:?}", SEEN.lock().unwrap());
            std::thread::sleep(Duration::from_millis(5));
        }
        SEEN.lock().unwrap().clone()
    }

    #[test]
    fn a_request_crosses_to_rust_and_its_reply_resumes_swift() {
        unsafe { op_sync_register(record) };
        // Swift → Rust: the request arrives synchronously, carrying the id it
        // parked its continuation under.
        unsafe { op_sync_ping() };
        let seen = wait_for(1);
        // The HOST issues the id; a request is resumed under the id it arrived
        // with, never one the caller chose. A non-zero id is a request; zero is
        // the fire-and-forget id and would mean nothing was parked.
        let id = seen[0].0;
        assert_ne!(id, 0);
        assert!(seen[0].1.contains("\"kind\":\"ping\""), "{}", seen[0].1);
        // Rust → Swift: the reply resumes that continuation, and the Swift side
        // proves it by echoing what it received back over the same callback,
        // on id 0 (the fire-and-forget id). The page's reply shape is
        // `{ ok, value }`; the echo carries `value` through intact.
        let reply = CString::new("{\"ok\":true,\"value\":{\"n\":42}}").unwrap();
        unsafe { op_sync_resume(id, reply.as_ptr()) };
        let seen = wait_for(2);
        assert_eq!(seen[1].0, 0);
        assert!(seen[1].1.contains("\"kind\":\"pong\""), "{}", seen[1].1);
        assert!(seen[1].1.contains("\"n\":42"), "the reply must round-trip intact: {}", seen[1].1);
    }

    #[test]
    fn a_reply_for_an_unknown_id_is_ignored_not_a_crash() {
        let reply = CString::new("{}").unwrap();
        unsafe { op_sync_resume(999_999, reply.as_ptr()) };
    }
}

