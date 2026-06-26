use std::sync::{Arc, Mutex};

use objc2::rc::Retained;
use objc2::MainThreadMarker;
use objc2_foundation::{NSData, NSError, NSPoint, NSRect, NSSize, NSString};
use objc2_web_kit::{WKPDFConfiguration, WKWebView};
use tauri::WebviewWindow;
use tokio::sync::oneshot;

use lopdf::{Dictionary, Document, Object, ObjectId, Stream};

use super::{CaptureRect, PdfResult};

/// Shared oneshot slot the WKWebView createPDF completion handler fills exactly
/// once (the sender is taken on first delivery so a duplicate callback can't
/// double-send).
type PdfResultSlot = Arc<Mutex<Option<oneshot::Sender<Result<Vec<u8>, String>>>>>;

// CSS pixels are 1/96 in; PDF points are 1/72 in. WKWebView's createPDF maps
// 1 CSS px -> 1 pt, so an 816px / 8.5in sheet would otherwise be an 11.33in
// page. Scale every captured page by 72/96 to restore its true physical size.
const PX_TO_PT: f64 = 72.0 / 96.0;

/// Capture each rect of `target_window`'s WKWebView as its own PDF page, scale
/// each page to its real physical size, merge them into one document, and write
/// it to `save_path`.
///
/// `rects` are the on-screen `.resume-page` sheets (CSS px, doc-relative to the
/// resume). One rect (continuous) yields a single-page PDF; N rects (a fixed
/// size like Letter/A4) yield an N-page PDF whose pages ARE the on-screen
/// sheets — the screen and the PDF stay byte-for-byte the same layout engine.
pub async fn capture_pdf(
    target_window: WebviewWindow,
    save_path: String,
    rects: Vec<CaptureRect>,
) -> PdfResult {
    if rects.is_empty() {
        return PdfResult::error("No page rects supplied for PDF capture");
    }

    // Capture every sheet. createPDF captures the requested document region in
    // full, even if it extends past the (off-screen) window's viewport.
    let mut pages: Vec<(Vec<u8>, f64, f64)> = Vec::with_capacity(rects.len());
    for rect in &rects {
        match capture_one(&target_window, rect).await {
            Ok(bytes) => pages.push((bytes, rect.width, rect.height)),
            Err(e) => return PdfResult::error(e),
        }
    }

    let merged = match merge_scaled(pages, PX_TO_PT) {
        Ok(bytes) => bytes,
        Err(e) => return PdfResult::error(format!("PDF merge failed: {}", e)),
    };

    match std::fs::write(&save_path, &merged) {
        Ok(()) => PdfResult::success(save_path),
        Err(e) => PdfResult::error(format!("Failed to write PDF file: {}", e)),
    }
}

/// Run WKWebView.createPDF once for a single rect and return its PDF bytes.
async fn capture_one(target_window: &WebviewWindow, rect: &CaptureRect) -> Result<Vec<u8>, String> {
    // Two delivery paths for the result:
    //   1. Cocoa completion handler (the happy path / API-level error).
    //   2. The setup-error path inside `with_webview` if the webview pointer
    //      is null or we're off the main thread. That closure returns `()` and
    //      can't propagate Result, so it sends through the same channel.
    let (pdf_tx, pdf_rx) = oneshot::channel::<Result<Vec<u8>, String>>();
    let pdf_slot = Arc::new(Mutex::new(Some(pdf_tx)));
    let pdf_slot_handler = pdf_slot.clone();
    let pdf_slot_setup_err = pdf_slot;
    let rect = rect.clone();

    let render_result = target_window.with_webview(move |webview| {
        let wkwebview_ptr = webview.inner();
        if wkwebview_ptr.is_null() {
            send_result(
                &pdf_slot_setup_err,
                Err("Tauri returned a null WKWebView pointer".to_string()),
            );
            return;
        }

        // Tauri runs `with_webview` callbacks on the main thread (Cocoa requires
        // UI work on main). If we ever end up elsewhere, fail loudly through the
        // channel rather than calling main-thread-only APIs.
        let mtm = match MainThreadMarker::new() {
            Some(m) => m,
            None => {
                send_result(
                    &pdf_slot_setup_err,
                    Err("PDF generation must run on the main thread".to_string()),
                );
                return;
            }
        };

        unsafe {
            let wkwebview: &WKWebView = &*(wkwebview_ptr as *const WKWebView);
            let configuration = WKPDFConfiguration::new(mtm);
            configuration.setRect(NSRect {
                origin: NSPoint { x: rect.x, y: rect.y },
                size: NSSize {
                    width: rect.width,
                    height: rect.height,
                },
            });

            let handler = block2::RcBlock::new(move |data: *mut NSData, error: *mut NSError| {
                let result = if !error.is_null() {
                    let err_ref: &NSError = &*error;
                    let desc: Retained<NSString> = err_ref.localizedDescription();
                    Err(desc.to_string())
                } else if data.is_null() {
                    Err("WKWebView returned no PDF data".to_string())
                } else {
                    let data_ref: &NSData = &*data;
                    // PDF bytes are owned by the NSData the completion handler
                    // retains until it returns, so `as_bytes_unchecked` is safe
                    // for the duration of the `.to_vec()` copy.
                    Ok(data_ref.as_bytes_unchecked().to_vec())
                };
                send_result(&pdf_slot_handler, result);
            });

            wkwebview.createPDFWithConfiguration_completionHandler(Some(&configuration), &handler);
        }
    });

    if let Err(e) = render_result {
        return Err(format!("Could not access WKWebView: {}", e));
    }

    match pdf_rx.await {
        Ok(result) => result,
        Err(_) => Err("PDF render task was dropped".to_string()),
    }
}

// Deliver a capture result through the oneshot slot exactly once.
fn send_result(
    slot: &PdfResultSlot,
    result: Result<Vec<u8>, String>,
) {
    if let Ok(mut guard) = slot.lock() {
        if let Some(sender) = guard.take() {
            let _ = sender.send(result);
        }
    }
}

/// Merge single-page PDFs into one document, scaling each page's content and
/// MediaBox by `scale`. `pages` is `(pdf_bytes, width_px, height_px)`; the
/// width/height are the captured CSS-px dimensions (== createPDF's point size,
/// since the map is 1:1), so the output page is `dim * scale` points.
fn merge_scaled(pages: Vec<(Vec<u8>, f64, f64)>, scale: f64) -> Result<Vec<u8>, String> {
    let mut output = Document::with_version("1.5");
    let pages_id = output.new_object_id();
    let mut kid_ids: Vec<ObjectId> = Vec::with_capacity(pages.len());

    for (bytes, w_px, h_px) in pages {
        let mut src = Document::load_mem(&bytes).map_err(|e| format!("load capture: {}", e))?;

        // Renumber the source's objects starting above everything already in
        // `output` so the two object-id spaces can't collide when merged.
        src.renumber_objects_with(output.max_id + 1);

        let page_id = src
            .get_pages()
            .into_values()
            .next()
            .ok_or_else(|| "captured PDF has no page".to_string())?;

        // The content stream object(s) this page references (a single Reference
        // or an Array of References — Quartz emits indirect streams either way).
        let content_ids: Vec<ObjectId> = {
            let dict = src
                .get_object(page_id)
                .and_then(Object::as_dict)
                .map_err(|e| format!("read page: {}", e))?;
            match dict.get(b"Contents") {
                Ok(Object::Reference(id)) => vec![*id],
                Ok(Object::Array(items)) => {
                    items.iter().filter_map(|o| o.as_reference().ok()).collect()
                }
                _ => Vec::new(),
            }
        };

        // Move every source object into the output document (keeps the page's
        // own Resources/fonts intact; the orphaned source catalog is harmless).
        let src_max = src.max_id;
        for (id, obj) in std::mem::take(&mut src.objects) {
            output.objects.insert(id, obj);
        }
        if src_max > output.max_id {
            output.max_id = src_max;
        }

        // Scale-wrap: `q s 0 0 s 0 0 cm ... Q`. PDF user space is bottom-left
        // origin, and createPDF anchors content at the origin, so scaling from
        // the origin shrinks the page content to exactly fill the new MediaBox.
        let pre = output.add_object(Stream::new(
            Dictionary::new(),
            format!("q {} 0 0 {} 0 0 cm", scale, scale).into_bytes(),
        ));
        let post = output.add_object(Stream::new(Dictionary::new(), b"Q".to_vec()));

        let new_w = (w_px * scale) as f32;
        let new_h = (h_px * scale) as f32;

        let page = output
            .objects
            .get_mut(&page_id)
            .ok_or_else(|| "page missing after merge".to_string())?
            .as_dict_mut()
            .map_err(|e| format!("page dict: {}", e))?;
        page.set("Parent", pages_id);
        page.set(
            "MediaBox",
            vec![
                Object::Real(0.0),
                Object::Real(0.0),
                Object::Real(new_w),
                Object::Real(new_h),
            ],
        );
        let mut contents: Vec<Object> = Vec::with_capacity(content_ids.len() + 2);
        contents.push(Object::Reference(pre));
        contents.extend(content_ids.into_iter().map(Object::Reference));
        contents.push(Object::Reference(post));
        page.set("Contents", contents);

        kid_ids.push(page_id);
    }

    // Pages tree.
    let mut pages_dict = Dictionary::new();
    pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
    pages_dict.set("Count", kid_ids.len() as i64);
    pages_dict.set(
        "Kids",
        kid_ids
            .iter()
            .map(|id| Object::Reference(*id))
            .collect::<Vec<_>>(),
    );
    output.objects.insert(pages_id, Object::Dictionary(pages_dict));

    // Catalog + trailer root.
    let mut catalog = Dictionary::new();
    catalog.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog.set("Pages", pages_id);
    let catalog_id = output.add_object(Object::Dictionary(catalog));
    output.trailer.set("Root", catalog_id);

    let mut buf = Vec::new();
    output
        .save_to(&mut buf)
        .map_err(|e| format!("save: {}", e))?;
    Ok(buf)
}
