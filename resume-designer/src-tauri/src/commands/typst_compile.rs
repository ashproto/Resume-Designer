include!(concat!(env!("OUT_DIR"), "/fonts.rs")); // -> BUNDLED_FONTS

use tauri::State;
use super::{PdfResult, PendingPdfPath};

/// Compile Typst source to PDF bytes using the bundled fonts. Pure; no IO.
pub fn compile(typ: &str) -> Result<Vec<u8>, String> {
    use typst_as_lib::TypstEngine;

    let engine = TypstEngine::builder()
        .main_file(typ)
        .fonts(BUNDLED_FONTS.iter().copied())
        .build();

    // Let the compiler infer the concrete document type from typst_pdf::pdf's
    // `&PagedDocument` parameter — avoids a direct `typst` crate dependency.
    let doc = engine
        .compile()
        .output
        .map_err(|e| format!("Typst compile error: {e:?}"))?;

    typst_pdf::pdf(&doc, &typst_pdf::PdfOptions::default())
        .map_err(|e| format!("Typst PDF error: {e:?}"))
}

/// Compile .typ -> PDF bytes, returned for the in-app PDF.js preview.
#[tauri::command]
pub async fn typst_render_preview(typ: String) -> Result<tauri::ipc::Response, String> {
    let bytes = compile(&typ)?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// Compile .typ -> PDF and write it to the path stashed by pick_pdf_save_path.
/// The renderer cannot supply a path — it's taken from PendingPdfPath.
#[tauri::command]
pub async fn typst_export_pdf(typ: String, pending: State<'_, PendingPdfPath>) -> Result<PdfResult, String> {
    let save_path = {
        let mut slot = pending.0.lock().map_err(|_| "PDF save-path slot lock poisoned".to_string())?;
        match slot.take() {
            Some(p) => p,
            None => return Ok(PdfResult::error("No pending PDF save path. Call pick_pdf_save_path first.")),
        }
    };
    let bytes = match compile(&typ) { Ok(b) => b, Err(e) => return Ok(PdfResult::error(e)) };
    match std::fs::write(&save_path, &bytes) {
        Ok(()) => Ok(PdfResult::success(save_path.to_string_lossy().into_owned())),
        Err(e) => Ok(PdfResult::error(format!("Failed to write PDF file: {e}"))),
    }
}

#[cfg(test)]
mod tests {
    use super::compile;

    #[test]
    fn compiles_minimal_typ_to_pdf() {
        let pdf = compile("#set page(width: 8.5in, height: auto)\nHello *world*.").expect("compile ok");
        assert!(pdf.len() > 1000, "pdf too small: {}", pdf.len());
        assert_eq!(&pdf[..5], b"%PDF-", "missing PDF magic");
    }
}
