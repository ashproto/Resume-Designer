use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{State, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

/// Server-side single-slot binding for the PDF save path: `pick_pdf_save_path`
/// stores the user-chosen path here and `typst_export_pdf` takes it back out to
/// write the PDF there. The renderer can never supply a path directly — even a
/// compromised script can only write to a path the user just confirmed.
#[derive(Default)]
pub struct PendingPdfPath(pub Mutex<Option<PathBuf>>);

// `pub` so `generate_handler!` in lib.rs can name the commands as
// `commands::migration::probe_legacy_electron_data`. The macro
// references compiler-generated helper items that sit next to the
// command function, so a plain `pub use` re-export wouldn't be enough.
pub mod migration;

// Per-key disk storage backing the renderer's persistence (replaces
// webview localStorage). Not platform-gated: every build needs it.
pub mod storage;

// Desktop-only: runtime update-channel selection (stable/beta) for the updater.
// `tauri-plugin-updater` is itself a cfg(desktop) dependency.
#[cfg(desktop)]
pub mod updater;

// Desktop-only: Typst → PDF compilation backed by bundled fonts.
// `typst-as-lib` / `typst-pdf` are cfg(not(android, ios)) dependencies.
#[cfg(not(any(target_os = "android", target_os = "ios")))]
pub mod typst_compile;

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
    #[allow(dead_code)]
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
/// the subsequent `typst_export_pdf` call to consume. Returns the path as a
/// string for renderer-side logging/UX only — the renderer never feeds this
/// back into the export command.
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

