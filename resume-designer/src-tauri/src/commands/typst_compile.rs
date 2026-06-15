include!(concat!(env!("OUT_DIR"), "/fonts.rs")); // -> BUNDLED_FONTS

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
