use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tokio::sync::oneshot;

#[cfg(target_os = "macos")]
mod pdf_macos;
#[cfg(target_os = "windows")]
mod pdf_windows;

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
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
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

/// Show a save-file dialog and return the chosen path. Separated from the
/// capture step so the renderer can spawn its hidden print window only AFTER
/// the user has picked a path — keeping the main window unchanged during the
/// (possibly long) dialog interaction.
#[tauri::command]
pub async fn pick_pdf_save_path(
    window: WebviewWindow,
    default_name: Option<String>,
) -> Option<String> {
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
        Ok(Some(p)) => Some(p.to_string_lossy().into_owned()),
        _ => None,
    }
}

/// Capture a PDF from a target window's web view (identified by label) and
/// write it to `save_path`. The target is typically a hidden Tauri window the
/// renderer just spawned at `/?print=1`, which renders only the resume and
/// signals readiness via a `print-ready` event before this is invoked.
#[tauri::command]
#[allow(unused_variables)]
pub async fn capture_pdf_from_window(
    app: AppHandle,
    window_label: String,
    save_path: String,
    page_size: Option<PageSize>,
    capture_rect: Option<CaptureRect>,
) -> PdfResult {
    let target = match app.get_webview_window(&window_label) {
        Some(w) => w,
        None => {
            return PdfResult::error(format!(
                "No webview window with label '{}'",
                window_label
            ))
        }
    };

    #[cfg(target_os = "macos")]
    {
        let _ = page_size;
        pdf_macos::capture_pdf(target, save_path, capture_rect).await
    }
    #[cfg(target_os = "windows")]
    {
        let _ = capture_rect;
        pdf_windows::capture_pdf(target, save_path, page_size).await
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (target, save_path);
        PdfResult::error("PDF export is not supported on this platform")
    }
}

/// Indicates whether a save_path was returned. Returns `None` on cancellation.
/// Kept here so the renderer can use a single PdfResult shape in the success
/// path without inventing a parallel "user cancelled" type.
#[allow(dead_code)]
pub fn canceled_result() -> PdfResult {
    PdfResult::canceled()
}
