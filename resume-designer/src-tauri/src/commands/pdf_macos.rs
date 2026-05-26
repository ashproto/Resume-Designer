use std::sync::{Arc, Mutex};

use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_foundation::{NSData, NSError, NSPoint, NSRect, NSSize, NSString};
use objc2_web_kit::{WKPDFConfiguration, WKWebView};
use tauri::WebviewWindow;
use tokio::sync::oneshot;

use super::{CaptureRect, PdfResult};

/// Capture the contents of `target_window`'s WKWebView to a PDF at `save_path`.
///
/// Coordinates: `WKPDFConfiguration.rect` is in the web view's coordinate
/// system, which maps 1:1 to CSS pixels at the default zoom. In the
/// background-window flow the target window contains ONLY the resume
/// (no app chrome to bleed in), so the renderer measures the resume via
/// `getBoundingClientRect()` against the print window's own DOM and passes
/// those CSS-px values here. If no rect is supplied, WKWebView captures the
/// entire visible region.
pub async fn capture_pdf(
    target_window: WebviewWindow,
    save_path: String,
    capture_rect: Option<CaptureRect>,
) -> PdfResult {
    // Two delivery paths for the result:
    //   1. Cocoa completion handler (the happy path / API-level error).
    //   2. The setup-error path inside `with_webview` if the webview pointer
    //      is null or we're off the main thread. `with_webview`'s closure
    //      returns `()` and can't propagate Result, so it sends through the
    //      same channel.
    let (pdf_tx, pdf_rx) = oneshot::channel::<Result<Vec<u8>, String>>();
    let pdf_slot = Arc::new(Mutex::new(Some(pdf_tx)));
    let pdf_slot_handler = pdf_slot.clone();
    let pdf_slot_setup_err = pdf_slot;

    let render_result = target_window.with_webview(move |webview| {
        let wkwebview_ptr = webview.inner();
        if wkwebview_ptr.is_null() {
            if let Ok(mut guard) = pdf_slot_setup_err.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(Err("Tauri returned a null WKWebView pointer".to_string()));
                }
            }
            return;
        }

        // Tauri runs `with_webview` callbacks on the main thread (Cocoa
        // requires UI work on main). If we ever end up elsewhere, fail loudly
        // through the PDF channel rather than calling main-thread-only APIs.
        let mtm = match MainThreadMarker::new() {
            Some(m) => m,
            None => {
                if let Ok(mut guard) = pdf_slot_setup_err.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender
                            .send(Err("PDF generation must run on the main thread".to_string()));
                    }
                }
                return;
            }
        };

        unsafe {
            let wkwebview: &WKWebView = &*(wkwebview_ptr as *const WKWebView);
            let configuration = WKPDFConfiguration::new(mtm);

            if let Some(r) = capture_rect {
                let rect = NSRect {
                    origin: NSPoint { x: r.x, y: r.y },
                    size: NSSize {
                        width: r.width,
                        height: r.height,
                    },
                };
                configuration.setRect(rect);
            }

            let handler = block2::RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
                let result = if !error.is_null() {
                    let err_ref: &NSError = &*error;
                    let desc: Retained<NSString> = err_ref.localizedDescription();
                    Err(desc.to_string())
                } else if data.is_null() {
                    Err("WKWebView returned no PDF data".to_string())
                } else {
                    let data_ref: &NSData = &*data;
                    // PDF bytes are owned by the NSData that this completion
                    // handler retains until it returns, so `as_bytes_unchecked`
                    // is safe for the duration of the `.to_vec()` copy.
                    Ok(data_ref.as_bytes_unchecked().to_vec())
                };
                if let Ok(mut guard) = pdf_slot_handler.lock() {
                    if let Some(sender) = guard.take() {
                        let _ = sender.send(result);
                    }
                }
            });

            wkwebview.createPDFWithConfiguration_completionHandler(Some(&configuration), &handler);
        }
    });

    if let Err(e) = render_result {
        return PdfResult::error(format!("Could not access WKWebView: {}", e));
    }

    let pdf_bytes = match pdf_rx.await {
        Ok(Ok(bytes)) => bytes,
        Ok(Err(message)) => return PdfResult::error(message),
        Err(_) => return PdfResult::error("PDF render task was dropped"),
    };

    match std::fs::write(&save_path, &pdf_bytes) {
        Ok(()) => PdfResult::success(save_path),
        Err(e) => PdfResult::error(format!("Failed to write PDF file: {}", e)),
    }
}
