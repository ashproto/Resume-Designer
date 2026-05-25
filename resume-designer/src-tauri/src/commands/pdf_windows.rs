use tauri::WebviewWindow;
use tokio::sync::oneshot;
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Environment9, ICoreWebView2PrintSettings, ICoreWebView2PrintSettings2,
    ICoreWebView2_16, COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT,
};
use webview2_com::PrintToPdfCompletedHandler;
// webview2-com 0.38 wraps the raw HRESULT/BOOL the COM interface returns into
// Rust-native `Result<()>` and `bool` for the completion handler — so we don't
// import HRESULT or BOOL here.
use windows::core::{Interface, HSTRING};

use super::{PageSize, PdfResult};

/// Capture the contents of `target_window`'s WebView2 to a PDF at `save_path`.
///
/// WebView2's `PrintToPdfAsync` respects print CSS and paginates around it,
/// so we pass through the renderer-computed page size (in inches). In the
/// background-window flow the target window contains only the resume, so
/// page_size matches the resume's measured dimensions.
pub async fn capture_pdf(
    target_window: WebviewWindow,
    save_path: String,
    page_size: Option<PageSize>,
) -> PdfResult {
    let (done_tx, done_rx) = oneshot::channel::<Result<(), String>>();
    let done_slot = std::sync::Arc::new(std::sync::Mutex::new(Some(done_tx)));
    let done_for_setup = done_slot.clone();
    let done_for_handler = done_slot;

    let render_result = target_window.with_webview(move |webview| {
        let setup_result: Result<(), String> = (|| unsafe {
            let core: ICoreWebView2_16 = webview
                .controller()
                .CoreWebView2()
                .and_then(|cw| cw.cast::<ICoreWebView2_16>())
                .map_err(|e| e.message().to_string())?;

            let env: ICoreWebView2Environment9 = core
                .Environment()
                .and_then(|e| e.cast::<ICoreWebView2Environment9>())
                .map_err(|e| e.message().to_string())?;

            let settings: ICoreWebView2PrintSettings = env
                .CreatePrintSettings()
                .map_err(|e| e.message().to_string())?;

            if let Some(size) = page_size.as_ref() {
                settings
                    .SetPageWidth(size.width)
                    .map_err(|e| e.message().to_string())?;
                settings
                    .SetPageHeight(size.height)
                    .map_err(|e| e.message().to_string())?;
            }
            settings
                .SetMarginTop(0.0)
                .and_then(|_| settings.SetMarginBottom(0.0))
                .and_then(|_| settings.SetMarginLeft(0.0))
                .and_then(|_| settings.SetMarginRight(0.0))
                .and_then(|_| settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT))
                .and_then(|_| settings.SetShouldPrintBackgrounds(true))
                .map_err(|e| e.message().to_string())?;

            if let Ok(settings2) = settings.cast::<ICoreWebView2PrintSettings2>() {
                let _ = settings2.SetScaleFactor(1.0);
            }

            let path_hstring = HSTRING::from(&save_path);
            // webview2-com 0.38's PrintToPdfCompletedHandler invokes the
            // closure with (Result<(), Error>, bool). The Result wraps the
            // raw HRESULT (Ok = S_OK, Err carries the error); the bool is
            // the unwrapped BOOL indicating WebView2's own success report.
            let handler = PrintToPdfCompletedHandler::create(Box::new(
                move |result: windows::core::Result<()>,
                      is_successful: bool|
                      -> windows::core::Result<()> {
                    let out = match (result, is_successful) {
                        (Ok(()), true) => Ok(()),
                        (Ok(()), false) => Err("WebView2 reported PrintToPdf failure".to_string()),
                        (Err(e), _) => Err(format!("WebView2 PrintToPdf failed: {}", e.message())),
                    };
                    if let Ok(mut guard) = done_for_handler.lock() {
                        if let Some(sender) = guard.take() {
                            let _ = sender.send(out);
                        }
                    }
                    Ok(())
                },
            ));

            core.PrintToPdf(&path_hstring, &settings, &handler)
                .map_err(|e| e.message().to_string())?;
            Ok(())
        })();

        if let Err(message) = setup_result {
            if let Ok(mut guard) = done_for_setup.lock() {
                if let Some(sender) = guard.take() {
                    let _ = sender.send(Err(message));
                }
            }
        }
    });

    if let Err(e) = render_result {
        return PdfResult::error(format!("Could not access WebView2 controller: {}", e));
    }

    match done_rx.await {
        Ok(Ok(())) => PdfResult::success(save_path),
        Ok(Err(message)) => PdfResult::error(message),
        Err(_) => PdfResult::error("PDF render task was dropped"),
    }
}
