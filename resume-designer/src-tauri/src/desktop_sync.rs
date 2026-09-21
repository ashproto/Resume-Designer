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
    fn op_sync_start(profile_id: *const c_char, known_profile_ids_json: *const c_char, tombstoned_profile_ids_json: *const c_char);
    fn op_sync_stop();
    fn op_sync_dirty(units_json: *const c_char);
    fn op_sync_register_answer(cb: extern "C" fn(u64, *const c_char));
    fn op_sync_profiles(known_profile_ids_json: *const c_char, tombstoned_profile_ids_json: *const c_char);
    fn op_sync_resume_after_purge();
    fn op_sync_account_profiles(id: u64);
}

/// Answers to the page's own questions, keyed by the id this side issued. The
/// one question so far is a fresh Mac's account-profile probe: an async command
/// parks a oneshot here, Swift answers on the second callback, the command
/// resolves. Separate from `on_request` because that carries Swift asking.
type Answers = std::sync::Mutex<std::collections::HashMap<u64, tokio::sync::oneshot::Sender<String>>>;
static ANSWERS: std::sync::OnceLock<Answers> = std::sync::OnceLock::new();
static NEXT_ANSWER_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

fn answers() -> &'static Answers {
    ANSWERS.get_or_init(|| std::sync::Mutex::new(std::collections::HashMap::new()))
}

fn park_answer() -> (u64, tokio::sync::oneshot::Receiver<String>) {
    let id = NEXT_ANSWER_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let (tx, rx) = tokio::sync::oneshot::channel();
    answers().lock().unwrap().insert(id, tx);
    (id, rx)
}

/// Swift → Rust, the answer to a parked question. An id nobody is waiting on
/// is ignored, not a panic — the waiter may have given up on its own ceiling.
extern "C" fn on_answer(id: u64, json: *const c_char) {
    let json = unsafe { CStr::from_ptr(json) }.to_string_lossy().into_owned();
    if let Some(tx) = answers().lock().unwrap().remove(&id) {
        let _ = tx.send(json);
    }
}

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// Swift → Rust → page. Runs on the transport's executor, so it must return
/// quickly: it evaluates one call and does not wait for the answer, which
/// arrives on its own through `desktop_sync_reply`. Nothing here may call back
/// into Swift — the reentrancy rule the iOS host learned the hard way.
extern "C" fn on_request(id: u64, json: *const c_char) {
    let json = unsafe { CStr::from_ptr(json) }.to_string_lossy().into_owned();
    // stderr, like the bridge's own startup line: the one channel that needs no
    // log persistence and no devtools to read when the app is run by path.
    eprintln!("desktop sync: swift asked {} — {}", if id == 0 { "(notice)".to_string() } else { format!("#{id}") }, json.chars().take(160).collect::<String>());
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
pub fn desktop_sync_report_profile(
    profile_id: String,
    known_profile_ids: Vec<String>,
    tombstoned_profile_ids: Option<Vec<String>>,
) -> Result<(), String> {
    let dead = tombstoned_profile_ids.unwrap_or_default();
    eprintln!(
        "desktop sync: page reported profile {profile_id} ({} known, {} tombstoned) — starting the transport",
        known_profile_ids.len(), dead.len()
    );
    let p = CString::new(profile_id).map_err(|e| e.to_string())?;
    let k = CString::new(serde_json::to_string(&known_profile_ids).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    let d = CString::new(serde_json::to_string(&dead).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    unsafe { op_sync_start(p.as_ptr(), k.as_ptr(), d.as_ptr()) };
    Ok(())
}

/// The page's dirty units — bytes that reached disk — each with the workspace
/// it belongs to (`""` is the open one). The transport sends them per
/// workspace, exactly as the iOS host does for the page's `syncDirty` message.
#[tauri::command]
pub fn desktop_sync_dirty(units: Vec<serde_json::Value>) -> Result<(), String> {
    let json = serde_json::to_string(&units).map_err(|e| e.to_string())?;
    let c = CString::new(json).map_err(|e| e.to_string())?;
    unsafe { op_sync_dirty(c.as_ptr()) };
    Ok(())
}

/// The registry changed on the page — a shared-zone landing added or deleted a
/// workspace — and the running transport is told the live and tombstoned ids.
/// Metadata only: no fetch and no send happen from this.
#[tauri::command]
pub fn desktop_sync_profiles(known_profile_ids: Vec<String>, tombstoned_profile_ids: Vec<String>) -> Result<(), String> {
    let k = CString::new(serde_json::to_string(&known_profile_ids).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let d = CString::new(serde_json::to_string(&tombstoned_profile_ids).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    unsafe { op_sync_profiles(k.as_ptr(), d.as_ptr()) };
    Ok(())
}

/// The explicit action after an iCloud purge: the transport re-owes every full
/// upload, forgets the emptied server's bookkeeping, clears its suspension and
/// starts again. Only a person calls this.
#[tauri::command]
pub fn desktop_sync_resume() {
    unsafe { op_sync_resume_after_purge() }
}

/// A fresh Mac's first question: what does the account's shared zone hold? The
/// answer is `{status: known, profiles}`, `{status: empty}` or
/// `{status: unavailable}`, exactly what the iOS shell answers its page. Swift
/// bounds the lookup itself; a Swift that never answers would leave this
/// waiting, which is why the page keeps its own ceiling as well.
#[tauri::command]
pub async fn desktop_sync_account_profiles() -> Result<String, String> {
    let (id, rx) = park_answer();
    unsafe { op_sync_account_profiles(id) };
    rx.await.map_err(|_| "the account profile answer was dropped".to_string())
}

/// A line from the page onto the process's stderr. The webview console is
/// invisible when the app is run by path with stderr captured, and a sync that
/// silently fails to start is exactly the failure that needs a trace.
#[tauri::command]
pub fn desktop_sync_note(message: String) {
    eprintln!("desktop sync (page): {}", message.chars().take(300).collect::<String>());
}

/// Called once from setup: hands the app handle to the callback and registers
/// the callback with Swift. Nothing starts until the page reports a profile.
pub fn install(app: &AppHandle) {
    let _ = APP.set(app.clone());
    unsafe { op_sync_register(on_request) }
    unsafe { op_sync_register_answer(on_answer) }
    eprintln!("desktop sync: host installed; waiting for the page to report a profile");
}

pub fn stop() {
    unsafe { op_sync_stop() }
}

/// Swift holds ONE callback slot, and `cargo test` runs tests in parallel.
/// Two tests registering their own recorder race for that slot, and a request
/// then lands in the other test's log and its wait times out — an intermittent
/// failure with a 2s signature. Every test that registers a callback holds this
/// for its whole body; the rest of the suite stays parallel.
#[cfg(test)]
static FFI_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
mod answer_tests {
    //! The parked-question plumbing, without Swift: a oneshot parked under an
    //! issued id resolves when the answer callback names that id, and an
    //! answer nobody waits on is dropped quietly.
    use std::ffi::CString;

    #[test]
    fn an_answer_resolves_the_question_parked_under_its_id() {
        let (id, rx) = super::park_answer();
        let json = CString::new(r#"{"status":"empty"}"#).unwrap();
        super::on_answer(id, json.as_ptr());
        assert_eq!(rx.blocking_recv().unwrap(), r#"{"status":"empty"}"#);
    }

    #[test]
    fn an_answer_for_an_unknown_id_is_ignored() {
        let json = CString::new("{}").unwrap();
        super::on_answer(u64::MAX, json.as_ptr());
    }
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
        let _serial = super::FFI_LOCK.lock().unwrap();
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
    fn nslog_from_the_static_library_reaches_stderr() {
        // Observed by the harness, not asserted: run with `-- --nocapture` and
        // the line must appear. The app's every host message is an NSLog.
        extern "C" { fn op_sync_log_probe(); }
        unsafe { op_sync_log_probe() };
    }

    #[test]
    fn a_reply_for_an_unknown_id_is_ignored_not_a_crash() {
        let reply = CString::new("{}").unwrap();
        unsafe { op_sync_resume(999_999, reply.as_ptr()) };
    }
}

#[cfg(test)]
mod ledger_tests {
    //! The deferred-send ledger, ported from the iOS host. Lives in
    //! `UserDefaults` under keys the TRANSPORT defines (`op-sync-deferred-*`),
    //! so both platforms keep the debt in the same shape. No engine and no
    //! container are involved: these exercise the ledger and the shared-zone
    //! hoist, which needs a `syncScopes` answer — and that answer comes back
    //! through the real bridge, so the test replies to it.
    use std::ffi::{c_char, CStr, CString};
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    extern "C" {
        fn op_sync_register(cb: extern "C" fn(u64, *const c_char));
        fn op_sync_resume(id: u64, json: *const c_char);
        fn op_sync_free(p: *mut c_char);
        fn op_sync_defer(profile_id: *const c_char, unit_ids_json: *const c_char);
        fn op_sync_deferred(key_suffix: *const c_char) -> *mut c_char;
        fn op_sync_hoist_shared();
        fn op_sync_ledger_clear(prefix_suffix: *const c_char);
        fn op_sync_ledger_queues() -> *mut c_char;
        fn op_sync_dirty_groups(units_json: *const c_char) -> *mut c_char;
        fn op_sync_settle_dead(profile_ids_json: *const c_char);
    }
    fn queues() -> Vec<String> {
        let p = unsafe { op_sync_ledger_queues() };
        let s = unsafe { CStr::from_ptr(p) }.to_str().unwrap().to_owned();
        unsafe { op_sync_free(p) };
        serde_json::from_str(&s).unwrap()
    }

    static SEEN: Mutex<Vec<(u64, String)>> = Mutex::new(Vec::new());
    extern "C" fn record(id: u64, json: *const c_char) {
        SEEN.lock().unwrap().push((id, unsafe { CStr::from_ptr(json) }.to_string_lossy().into_owned()));
    }
    fn c(s: &str) -> CString { CString::new(s).unwrap() }
    fn deferred(suffix: &str) -> Vec<String> {
        let p = unsafe { op_sync_deferred(c(suffix).as_ptr()) };
        let s = unsafe { CStr::from_ptr(p) }.to_str().unwrap().to_owned();
        unsafe { op_sync_free(p) };
        serde_json::from_str(&s).unwrap()
    }
    fn wait_for_request(kind: &str) -> u64 {
        let start = Instant::now();
        loop {
            if let Some((id, _)) = SEEN.lock().unwrap().iter().find(|(id, j)| *id != 0 && j.contains(&format!("\"kind\":\"{kind}\""))) {
                return *id;
            }
            assert!(start.elapsed() < Duration::from_secs(2), "no {kind} request arrived: {:?}", SEEN.lock().unwrap());
            std::thread::sleep(Duration::from_millis(5));
        }
    }
    fn wait_until(what: &str, f: impl Fn() -> bool) {
        let start = Instant::now();
        while !f() {
            assert!(start.elapsed() < Duration::from_secs(2), "timed out: {what}");
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    #[test]
    fn defer_unions_into_the_profile_key_and_survives_a_second_defer() {
        // Distinct profile ids per test: UserDefaults is one store per process.
        unsafe { op_sync_ledger_clear(c("t-union").as_ptr()) };
        unsafe { op_sync_defer(c("t-union").as_ptr(), c("[\"resume:b\",\"resume:a\"]").as_ptr()) };
        assert_eq!(deferred("t-union"), vec!["resume:a", "resume:b"], "sorted, so the stored value is canonical");
        unsafe { op_sync_defer(c("t-union").as_ptr(), c("[\"resume:a\",\"resume:c\"]").as_ptr()) };
        assert_eq!(deferred("t-union"), vec!["resume:a", "resume:b", "resume:c"], "a union, never a replace");
        unsafe { op_sync_ledger_clear(c("t-union").as_ptr()) };
    }

    #[test]
    fn hoist_moves_shared_scoped_ids_to_the_shared_key_via_a_real_scopes_answer() {
        let _serial = super::FFI_LOCK.lock().unwrap();
        unsafe { op_sync_register(record) };
        unsafe { op_sync_ledger_clear(c("t-hoist").as_ptr()); op_sync_ledger_clear(c("_shared").as_ptr()) };
        unsafe { op_sync_defer(c("t-hoist").as_ptr(), c("[\"key:registry\",\"resume:x\"]").as_ptr()) };
        // The hoist finds queues by ENUMERATING defaults, which is a different
        // question from reading one key back. Assert it before relying on it.
        assert!(queues().contains(&"t-hoist".to_string()), "enumeration does not see the seeded queue: {:?}", queues());
        SEEN.lock().unwrap().clear();
        unsafe { op_sync_hoist_shared() };
        // The hoist asks the page which zone each id lives in. Answer it.
        let id = wait_for_request("syncScopes");
        let reply = c("{\"ok\":true,\"value\":{\"key:registry\":\"shared\",\"resume:x\":\"profile\"}}");
        unsafe { op_sync_resume(id, reply.as_ptr()) };
        wait_until("shared key populated", || deferred("_shared") == vec!["key:registry"]);
        assert_eq!(deferred("t-hoist"), vec!["resume:x"], "the profile key keeps only its own");
        unsafe { op_sync_ledger_clear(c("t-hoist").as_ptr()); op_sync_ledger_clear(c("_shared").as_ptr()) };
    }
    #[test]
    fn dirty_units_are_grouped_per_workspace_with_the_open_one_as_empty() {
        // The page names each dirty unit with the workspace it belongs to, ""
        // for the open one. Sent ungrouped, a unit of another workspace would go
        // into the open workspace's zone. No engine: this is the grouping only.
        let json = c(r#"[{"id":"resume:a","profileId":""},{"id":"resume:b","profileId":"p2"},{"id":"key:k","profileId":""},{"id":"","profileId":"p2"}]"#);
        let p = unsafe { op_sync_dirty_groups(json.as_ptr()) };
        let s = unsafe { CStr::from_ptr(p) }.to_str().unwrap().to_owned();
        unsafe { op_sync_free(p) };
        assert_eq!(s, r#"{"":["key:k","resume:a"],"p2":["resume:b"]}"#);
    }

    #[test]
    fn a_tombstoned_workspaces_debt_is_settled_and_a_live_ones_kept() {
        // The registry tombstoned "dead"; its deferred queue would otherwise be
        // re-offered at every start and fail with notStarted forever. "live" is
        // merely unknown to the transport and keeps its debt.
        let _g = super::FFI_LOCK.lock().unwrap();
        unsafe { op_sync_ledger_clear(c("dead").as_ptr()); op_sync_ledger_clear(c("live").as_ptr()); }
        unsafe { op_sync_defer(c("dead").as_ptr(), c(r#"["resume:x","key:k"]"#).as_ptr()); }
        unsafe { op_sync_defer(c("live").as_ptr(), c(r#"["resume:y"]"#).as_ptr()); }
        assert_eq!(deferred("dead").len(), 2);
        unsafe { op_sync_settle_dead(c(r#"["dead"]"#).as_ptr()); }
        assert_eq!(deferred("dead"), Vec::<String>::new());
        assert_eq!(deferred("live"), vec!["resume:y".to_string()]);
        unsafe { op_sync_ledger_clear(c("live").as_ptr()); }
    }

}

