use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

/// Server-side single-slot binding between `pick_pdf_save_path` and
/// `capture_pdf_from_window`. The picker stores the user-chosen path here;
/// the capture command takes it back out and writes the PDF to that path.
///
/// This means the renderer can NEVER supply a save path directly — even a
/// compromised/injected script can only write the PDF to a path the user
/// just confirmed via the native save dialog.
#[derive(Default)]
pub struct PendingPdfPath(pub Mutex<Option<PathBuf>>);

#[cfg(target_os = "macos")]
mod pdf_macos;
#[cfg(target_os = "windows")]
mod pdf_windows;

// `pub` so `generate_handler!` in lib.rs can name the commands as
// `commands::migration::probe_legacy_electron_data`. The macro
// references compiler-generated helper items that sit next to the
// command function, so a plain `pub use` re-export wouldn't be enough.
pub mod migration;

// Desktop-only: runtime update-channel selection (stable/beta) for the updater.
// `tauri-plugin-updater` is itself a cfg(desktop) dependency.
#[cfg(desktop)]
pub mod updater;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct PageSize {
    pub width: f64,
    pub height: f64,
}

/// A region of the web view to capture, in CSS pixel coordinates relative to
/// that web view's document. In the new background-window flow this is
/// measured by the print window's own JS against its own `getBoundingClientRect()`,
/// so origin is always (0, 0) in practice — but the field stays for flexibility.
///
/// `#[allow(dead_code)]` because the Windows path uses `page_size` instead and
/// discards this struct via `let _ = capture_rect`, which fires an unused-fields
/// lint on that target build.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
pub struct CaptureRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfResult {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub canceled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl PdfResult {
    pub fn canceled() -> Self {
        Self {
            success: false,
            canceled: Some(true),
            ..Default::default()
        }
    }

    pub fn success(path: String) -> Self {
        Self {
            success: true,
            file_path: Some(path),
            ..Default::default()
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            success: false,
            error: Some(message.into()),
            ..Default::default()
        }
    }
}

/// Show a save-file dialog and stash the chosen path in `PendingPdfPath` for
/// the subsequent `capture_pdf_from_window` call to consume. Returns the path
/// as a string for renderer-side logging/UX only — the renderer never feeds
/// this back into the capture command.
///
/// Separated from the capture step so the renderer can spawn its hidden print
/// window only AFTER the user has picked a path — keeping the main window
/// unchanged during the (possibly long) dialog interaction.
#[tauri::command]
pub async fn pick_pdf_save_path(
    window: WebviewWindow,
    default_name: Option<String>,
    pending: State<'_, PendingPdfPath>,
) -> Result<Option<String>, String> {
    // Invalidate any prior unconsumed path BEFORE we show the dialog. If a
    // previous export armed the slot but never reached capture (cancelled,
    // errored, app killed mid-flight), that path must not leak into a later
    // capture call without a fresh user confirmation. Doing this up-front
    // also covers the dialog-cancel branch below for free.
    {
        let mut slot = pending
            .0
            .lock()
            .map_err(|_| "PDF save-path slot lock poisoned".to_string())?;
        *slot = None;
    }

    let default_name = default_name.unwrap_or_else(|| "Resume.pdf".to_string());
    let (tx, rx) = oneshot::channel::<Option<PathBuf>>();
    window
        .dialog()
        .file()
        .add_filter("PDF Documents", &["pdf"])
        .set_file_name(&default_name)
        .save_file(move |path| {
            let _ = tx.send(path.and_then(|p| p.into_path().ok()));
        });
    match rx.await {
        Ok(Some(p)) => {
            let mut slot = pending
                .0
                .lock()
                .map_err(|_| "PDF save-path slot lock poisoned".to_string())?;
            *slot = Some(p.clone());
            Ok(Some(p.to_string_lossy().into_owned()))
        }
        // Slot already cleared above — no further bookkeeping needed.
        _ => Ok(None),
    }
}

/// Capture a PDF from a target window's web view (identified by label) and
/// write it to whatever path was previously stored by `pick_pdf_save_path`.
/// The target is typically a hidden Tauri window the renderer just spawned
/// at `/?print=1`, which renders only the resume and signals readiness via
/// a `print-ready` event before this is invoked.
///
/// The renderer cannot pass an arbitrary save path here — the path is taken
/// from the `PendingPdfPath` slot the picker filled. If the picker hasn't run
/// (or its result was already consumed), this fails fast rather than writing
/// anywhere.
#[tauri::command]
#[allow(unused_variables)]
pub async fn capture_pdf_from_window(
    app: AppHandle,
    window_label: String,
    page_size: Option<PageSize>,
    capture_rect: Option<CaptureRect>,
    pending: State<'_, PendingPdfPath>,
) -> Result<PdfResult, String> {
    // Take the path out of the slot — consuming it means a second capture
    // call (e.g. from an injected script reusing the user's last pick) fails
    // with a clear error instead of silently overwriting the prior file.
    let save_path = {
        let mut slot = pending
            .0
            .lock()
            .map_err(|_| "PDF save-path slot lock poisoned".to_string())?;
        match slot.take() {
            Some(p) => p.to_string_lossy().into_owned(),
            None => {
                return Ok(PdfResult::error(
                    "No pending PDF save path. Call pick_pdf_save_path first.",
                ))
            }
        }
    };

    let target = match app.get_webview_window(&window_label) {
        Some(w) => w,
        None => {
            return Ok(PdfResult::error(format!(
                "No webview window with label '{}'",
                window_label
            )))
        }
    };

    #[cfg(target_os = "macos")]
    {
        let _ = page_size;
        Ok(pdf_macos::capture_pdf(target, save_path, capture_rect).await)
    }
    #[cfg(target_os = "windows")]
    {
        let _ = capture_rect;
        Ok(pdf_windows::capture_pdf(target, save_path, page_size).await)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (target, save_path);
        Ok(PdfResult::error(
            "PDF export is not supported on this platform",
        ))
    }
}

/// Indicates whether a save_path was returned. Returns `None` on cancellation.
/// Kept here so the renderer can use a single PdfResult shape in the success
/// path without inventing a parallel "user cancelled" type.
#[allow(dead_code)]
pub fn canceled_result() -> PdfResult {
    PdfResult::canceled()
}
