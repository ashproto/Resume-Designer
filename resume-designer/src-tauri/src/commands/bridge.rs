//! Loopback HTTP bridge for the companion browser extension.
//!
//! A tiny_http server on 127.0.0.1 forwards every request to the main
//! webview as a `bridge:request` event and blocks on a per-request channel.
//! JS routes the request (auth, endpoints — see src/bridge.js) and answers
//! via the `bridge_respond` command. Rust stays a dumb pipe on purpose: all
//! reads/writes go through the running app's JS modules, preserving
//! appStorage's single-writer contract.

use std::collections::HashMap;
use std::io::Read;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};

/// Fixed port. If it's taken, the bridge simply doesn't start (logged);
/// the app itself is unaffected.
pub const BRIDGE_PORT: u16 = 17872;
const BRIDGE_HOST: &str = "127.0.0.1:17872";
const COMPANION_EXTENSION_ID: &str = "keggfbelidgpjiapcbgkjidenhdjmega";
#[cfg(debug_assertions)]
const DEVELOPMENT_EXTENSION_ID: &str = "jejabnlfgdapamjoechlgmgpmldekffo";

/// Cap request bodies well above any realistic payload (AI messages).
const MAX_BODY_BYTES: usize = 1_048_576; // 1 MiB

/// Bound request workers so a local client cannot retain an unbounded number
/// of threads during the bridge's deliberately long AI/PDF timeout window.
const MAX_IN_FLIGHT_REQUESTS: usize = 16;
const BRIDGE_BUSY_BODY: &str =
    r#"{"error":"On Paper is handling too many companion requests","code":"bridge_busy"}"#;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

struct InFlightLimiter {
    count: AtomicUsize,
    limit: usize,
}

impl InFlightLimiter {
    fn new(limit: usize) -> Self {
        assert!(limit > 0, "bridge in-flight limit must be positive");
        Self {
            count: AtomicUsize::new(0),
            limit,
        }
    }

    fn try_acquire(self: &Arc<Self>) -> Option<InFlightPermit> {
        self.count
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |current| {
                (current < self.limit).then_some(current + 1)
            })
            .ok()?;
        Some(InFlightPermit {
            limiter: Arc::clone(self),
        })
    }

    #[cfg(test)]
    fn in_flight(&self) -> usize {
        self.count.load(Ordering::Acquire)
    }
}

struct InFlightPermit {
    limiter: Arc<InFlightLimiter>,
}

impl Drop for InFlightPermit {
    fn drop(&mut self) {
        let previous = self.limiter.count.fetch_sub(1, Ordering::Release);
        debug_assert!(previous > 0, "bridge in-flight permit underflow");
    }
}

/// What JS hands back for one request.
pub struct JsResponse {
    pub status: u16,
    pub body: String,
}

/// Managed state: request id -> channel back to the waiting HTTP thread.
#[derive(Default)]
pub struct BridgePending(pub Mutex<HashMap<u64, SyncSender<JsResponse>>>);

/// AI completions and PDF exports are slow (model latency / hidden print
/// window render + capture). Health and one-time pairing claims are polled
/// during a cold app launch, so they fail quickly if the webview has not
/// installed its bridge listener yet instead of blocking a poll for 30s.
fn timeout_for_path(path: &str) -> Duration {
    if path == "/health" || path == "/pairing/claim" || path == "/pairing/request" {
        Duration::from_secs(2)
    } else if path.starts_with("/ai/") || path.ends_with("/pdf") {
        Duration::from_secs(180)
    } else {
        Duration::from_secs(30)
    }
}

/// The bridge is intentionally reachable only through its literal loopback
/// origin. Rejecting any other Host value prevents a DNS-rebinding origin from
/// reading unauthenticated health or one-time pairing responses.
fn is_allowed_host(host: Option<&str>) -> bool {
    host == Some(BRIDGE_HOST)
}

/// Resolve one pending request. Returns Err if the id is unknown (JS answered
/// twice, or the HTTP thread already timed out and removed it).
fn resolve_pending(pending: &BridgePending, id: u64, response: JsResponse) -> Result<(), String> {
    let sender = {
        let mut map = pending
            .0
            .lock()
            .map_err(|_| "bridge pending-map lock poisoned".to_string())?;
        map.remove(&id)
    };
    match sender {
        Some(tx) => tx
            .send(response)
            .map_err(|_| format!("bridge request {id} receiver dropped")),
        None => Err(format!("no pending bridge request with id {id}")),
    }
}

/// JS answers a forwarded request. `body` is a ready-to-send JSON string.
#[tauri::command]
pub fn bridge_respond(
    id: u64,
    status: u16,
    body: String,
    pending: State<'_, BridgePending>,
) -> Result<(), String> {
    resolve_pending(&pending, id, JsResponse { status, body })
}

#[derive(Clone, serde::Serialize)]
struct BridgeRequestPayload {
    id: u64,
    method: String,
    path: String,
    /// Raw Authorization header value ("" when absent). Token check is JS-side.
    authorization: String,
    body: String,
}

/// Start the listener. Called once from setup(); never panics — a failed
/// bind (port in use) logs and returns, leaving the app fully functional.
pub fn start(app: AppHandle) {
    std::thread::spawn(move || {
        let server = match tiny_http::Server::http(("127.0.0.1", BRIDGE_PORT)) {
            Ok(s) => s,
            Err(e) => {
                eprintln!("bridge: failed to bind 127.0.0.1:{BRIDGE_PORT}: {e}");
                return;
            }
        };
        println!("bridge: listening on 127.0.0.1:{BRIDGE_PORT}");
        let limiter = Arc::new(InFlightLimiter::new(MAX_IN_FLIGHT_REQUESTS));
        for request in server.incoming_requests() {
            let Some(permit) = limiter.try_acquire() else {
                respond_json(request, 503, BRIDGE_BUSY_BODY);
                continue;
            };
            let app = app.clone();
            if let Err(e) = std::thread::Builder::new()
                .name("companion-bridge-request".into())
                .spawn(move || {
                    let _permit = permit;
                    handle_request(app, request);
                })
            {
                // If spawning fails, dropping the closure releases its permit.
                eprintln!("bridge: failed to start request worker: {e}");
            }
        }
    });
}

fn json_response_headers() -> Vec<tiny_http::Header> {
    [
        ("Content-Type", "application/json"),
        ("Cache-Control", "no-store"),
        ("X-Content-Type-Options", "nosniff"),
    ]
    .into_iter()
    .map(|(name, value)| {
        tiny_http::Header::from_bytes(name.as_bytes(), value.as_bytes()).expect("static header")
    })
    .collect()
}

fn respond_json(request: tiny_http::Request, status: u16, body: &str) {
    let mut response = tiny_http::Response::from_string(body).with_status_code(status);
    for header in json_response_headers() {
        response = response.with_header(header);
    }
    let _ = request.respond(response);
}

fn is_trusted_extension_id(id: &str) -> bool {
    match id {
        COMPANION_EXTENSION_ID => true,
        #[cfg(debug_assertions)]
        DEVELOPMENT_EXTENSION_ID => true,
        _ => false,
    }
}

/// Only the published Companion (or the explicit debug-only unpacked ID) may
/// initiate or claim a grant. No CORS headers are added; approval and proof are
/// still required. An extension-shaped origin alone is not a trusted identity.
fn is_allowed_pairing_request(origin: Option<&str>, content_type: Option<&str>) -> bool {
    let extension_id = origin.and_then(|value| value.strip_prefix("chrome-extension://"));
    let json = content_type
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"));
    json && extension_id.is_some_and(is_trusted_extension_id)
}

fn pairing_body_for_origin(
    path: &str,
    origin: Option<&str>,
    content_type: Option<&str>,
    body: &str,
) -> Option<String> {
    if !is_allowed_pairing_request(origin, content_type) {
        return None;
    }
    let client_id = origin?.strip_prefix("chrome-extension://")?;
    let mut parsed: serde_json::Value = serde_json::from_str(body).ok()?;
    let fields = parsed.as_object_mut()?;
    match path {
        "/pairing/request" => {
            if fields.get("clientId").and_then(serde_json::Value::as_str) != Some(client_id) {
                return None;
            }
        }
        "/pairing/claim" => {
            // A cold deep link can spoof a clientId. Derive the claiming client
            // from the browser header, never from an HTTP body supplied by it.
            fields.insert("clientId".into(), client_id.into());
        }
        _ => return None,
    }
    serde_json::to_string(&parsed).ok()
}

fn handle_request(app: AppHandle, mut request: tiny_http::Request) {
    let host = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Host"))
        .map(|header| header.value.as_str());
    if !is_allowed_host(host) {
        respond_json(request, 403, r#"{"error":"invalid bridge host"}"#);
        return;
    }

    // Read the body with a hard cap so a hostile local process can't OOM us.
    let mut body = String::new();
    {
        let mut limited = request.as_reader().take((MAX_BODY_BYTES + 1) as u64);
        if limited.read_to_string(&mut body).is_err() {
            respond_json(request, 400, r#"{"error":"unreadable request body"}"#);
            return;
        }
    }
    if body.len() > MAX_BODY_BYTES {
        respond_json(request, 413, r#"{"error":"request body too large"}"#);
        return;
    }

    let method = request.method().as_str().to_string();
    let path = request.url().split('?').next().unwrap_or("").to_string();
    if matches!(path.as_str(), "/pairing/request" | "/pairing/claim") {
        let header = |name: &str| {
            request
                .headers()
                .iter()
                .find(|header| header.field.as_str().as_str().eq_ignore_ascii_case(name))
                .map(|header| header.value.as_str())
        };
        let trusted_body = (method == "POST")
            .then(|| {
                pairing_body_for_origin(&path, header("Origin"), header("Content-Type"), &body)
            })
            .flatten();
        let Some(trusted_body) = trusted_body else {
            respond_json(
                request,
                403,
                r#"{"error":"pairing requires a trusted Companion JSON request","code":"untrusted_pairing_client"}"#,
            );
            return;
        };
        body = trusted_body;
    }
    let authorization = request
        .headers()
        .iter()
        .find(|h| h.field.equiv("Authorization"))
        .map(|h| h.value.as_str().to_string())
        .unwrap_or_default();

    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = sync_channel::<JsResponse>(1);
    {
        let pending = app.state::<BridgePending>();
        let Ok(mut map) = pending.0.lock() else {
            respond_json(request, 500, r#"{"error":"bridge state lock poisoned"}"#);
            return;
        };
        map.insert(id, tx);
    }

    let timeout = timeout_for_path(&path);
    let payload = BridgeRequestPayload {
        id,
        method,
        path,
        authorization,
        body,
    };
    if let Err(e) = app.emit_to("main", "bridge:request", payload) {
        let pending = app.state::<BridgePending>();
        if let Ok(mut map) = pending.0.lock() {
            map.remove(&id);
        }
        eprintln!("bridge: emit failed: {e}");
        respond_json(request, 502, r#"{"error":"app window unavailable"}"#);
        return;
    }

    match rx.recv_timeout(timeout) {
        Ok(res) => respond_json(request, res.status, &res.body),
        Err(_) => {
            // Timed out (or sender dropped): remove our entry so a late
            // bridge_respond gets a clean "no pending request" error.
            let pending = app.state::<BridgePending>();
            if let Ok(mut map) = pending.0.lock() {
                map.remove(&id);
            }
            respond_json(
                request,
                504,
                r#"{"error":"the app did not answer in time — is On Paper running and unlocked?"}"#,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairing_request_rejects_unrelated_extension_origins() {
        assert!(!is_allowed_pairing_request(
            Some("chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
            Some("application/json")
        ));
    }

    #[test]
    fn pairing_request_rejects_web_origins_and_simple_form_posts() {
        let origin = format!("chrome-extension://{COMPANION_EXTENSION_ID}");
        assert!(is_allowed_pairing_request(
            Some(&origin),
            Some("application/json")
        ));
        assert!(is_allowed_pairing_request(
            Some(&origin),
            Some("application/json; charset=utf-8")
        ));
        for invalid in [
            None,
            Some("null"),
            Some("https://example.com"),
            Some("http://127.0.0.1:17872"),
            Some("chrome-extension://short"),
            Some("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/"),
            Some("chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaz"),
        ] {
            assert!(!is_allowed_pairing_request(
                invalid,
                Some("application/json")
            ));
        }
        for invalid in [
            None,
            Some("text/plain"),
            Some("application/x-www-form-urlencoded"),
            Some("multipart/form-data"),
        ] {
            assert!(!is_allowed_pairing_request(Some(&origin), invalid));
        }
    }

    #[test]
    fn pairing_binds_request_identity_and_claim_identity_to_the_trusted_origin() {
        let origin = format!("chrome-extension://{COMPANION_EXTENSION_ID}");
        let unrelated = "chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let input = serde_json::json!({
            "clientId": COMPANION_EXTENSION_ID, "requestId": "request", "verifier": "proof"
        })
        .to_string();
        for path in ["/pairing/request", "/pairing/claim"] {
            assert!(
                pairing_body_for_origin(path, Some(&origin), Some("application/json"), &input)
                    .is_some()
            );
            assert!(pairing_body_for_origin(
                path,
                Some(unrelated),
                Some("application/json"),
                &input
            )
            .is_none());
            assert!(
                pairing_body_for_origin(path, None, Some("application/json"), &input).is_none()
            );
            assert!(
                pairing_body_for_origin(path, Some(&origin), Some("text/plain"), &input).is_none()
            );
            for invalid in ["{", "[]", "null", "true", "42", "\"string\""] {
                assert!(pairing_body_for_origin(
                    path,
                    Some(&origin),
                    Some("application/json"),
                    invalid
                )
                .is_none());
            }
        }
        for mismatched in [
            "{}",
            r#"{"clientId":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}"#,
            r#"{"clientId":7}"#,
        ] {
            assert!(pairing_body_for_origin(
                "/pairing/request",
                Some(&origin),
                Some("application/json"),
                mismatched
            )
            .is_none());
            let claim = pairing_body_for_origin(
                "/pairing/claim",
                Some(&origin),
                Some("application/json"),
                mismatched,
            )
            .unwrap();
            let claim: serde_json::Value = serde_json::from_str(&claim).unwrap();
            assert_eq!(claim["clientId"], COMPANION_EXTENSION_ID);
        }
    }

    #[test]
    fn unpacked_origin_is_allowed_only_in_debug_builds() {
        assert_eq!(
            is_allowed_pairing_request(
                Some("chrome-extension://jejabnlfgdapamjoechlgmgpmldekffo"),
                Some("application/json")
            ),
            cfg!(debug_assertions)
        );
    }

    #[test]
    fn timeout_is_long_for_ai_and_pdf_and_short_for_connection_polling() {
        assert_eq!(timeout_for_path("/ai/complete"), Duration::from_secs(180));
        assert_eq!(
            timeout_for_path("/resumes/v-1/pdf"),
            Duration::from_secs(180)
        );
        assert_eq!(timeout_for_path("/resumes"), Duration::from_secs(30));
        assert_eq!(timeout_for_path("/health"), Duration::from_secs(2));
        assert_eq!(timeout_for_path("/pairing/claim"), Duration::from_secs(2));
        assert_eq!(timeout_for_path("/pairing/request"), Duration::from_secs(2));
    }

    #[test]
    fn host_guard_accepts_only_the_fixed_loopback_origin() {
        assert!(is_allowed_host(Some("127.0.0.1:17872")));
        for host in [
            None,
            Some("localhost:17872"),
            Some("127.0.0.1"),
            Some("127.0.0.1:9999"),
            Some("attacker.example:17872"),
        ] {
            assert!(!is_allowed_host(host), "unexpectedly allowed host {host:?}");
        }
    }

    #[test]
    fn json_responses_disable_caching_and_mime_sniffing() {
        let headers = json_response_headers();
        let value = |name| {
            headers
                .iter()
                .find(|header| header.field.equiv(name))
                .map(|header| header.value.as_str())
        };

        assert_eq!(value("Content-Type"), Some("application/json"));
        assert_eq!(value("Cache-Control"), Some("no-store"));
        assert_eq!(value("X-Content-Type-Options"), Some("nosniff"));
    }

    #[test]
    fn in_flight_limit_rejects_excess_and_reopens_after_drop() {
        let limiter = Arc::new(InFlightLimiter::new(2));
        let first = limiter.try_acquire().expect("first request admitted");
        let second = limiter.try_acquire().expect("second request admitted");

        assert!(limiter.try_acquire().is_none(), "limit must reject excess");
        drop(first);
        let replacement = limiter
            .try_acquire()
            .expect("dropping a permit must reopen capacity");

        drop(second);
        drop(replacement);
        assert_eq!(limiter.in_flight(), 0);
    }

    #[test]
    fn busy_response_is_typed_and_retryable_by_callers() {
        let parsed: serde_json::Value = serde_json::from_str(BRIDGE_BUSY_BODY).unwrap();
        assert_eq!(parsed["code"], "bridge_busy");
        assert_eq!(
            parsed["error"],
            "On Paper is handling too many companion requests"
        );
    }

    #[test]
    fn resolve_pending_roundtrips_a_response() {
        let pending = BridgePending::default();
        let (tx, rx) = sync_channel::<JsResponse>(1);
        pending.0.lock().unwrap().insert(7, tx);

        resolve_pending(
            &pending,
            7,
            JsResponse {
                status: 200,
                body: "{}".into(),
            },
        )
        .unwrap();
        let got = rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(got.status, 200);
        assert_eq!(got.body, "{}");
        // Entry consumed: a second resolve for the same id must error.
        assert!(resolve_pending(
            &pending,
            7,
            JsResponse {
                status: 200,
                body: "{}".into()
            }
        )
        .is_err());
    }

    #[test]
    fn resolve_pending_unknown_id_errors() {
        let pending = BridgePending::default();
        let err = resolve_pending(
            &pending,
            99,
            JsResponse {
                status: 200,
                body: "{}".into(),
            },
        )
        .unwrap_err();
        assert!(err.contains("no pending bridge request"));
    }
}
