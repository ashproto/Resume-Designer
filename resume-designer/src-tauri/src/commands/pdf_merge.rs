//! Shared PDF page-merge helpers for the desktop PDF export. Pure `lopdf` (no
//! platform APIs), used by both the macOS (WKWebView) and Windows (WebView2)
//! capture paths so the per-sheet → multi-page assembly lives in one place.
//!
//! - [`merge_scaled`] (macOS): each input is a single-page PDF captured at
//!   1 CSS px → 1 pt; it scales each page's content + MediaBox by `scale`
//!   (72/96) down to its true physical size.
//! - [`merge_concat`] (Windows): each input is a single-page PDF that WebView2
//!   already printed at its correct physical page size, so the content is kept
//!   as-is and only the MediaBox is (re)asserted from the known page dimensions
//!   (guards against a MediaBox inherited from the source's page tree being lost
//!   when the page is reparented).

// Each platform uses only one of the two merge fns (macOS: merge_scaled,
// Windows: merge_concat), so the other is dead code on that target build.
#![allow(dead_code)]

use lopdf::{Dictionary, Document, Object, ObjectId, Stream};

/// Merge single-page PDFs into one document, scaling each page's content and
/// MediaBox by `scale`. `pages` is `(pdf_bytes, width_px, height_px)`; the
/// width/height are the captured CSS-px dimensions (== createPDF's point size,
/// since the map is 1:1), so the output page is `dim * scale` points.
pub fn merge_scaled(pages: Vec<(Vec<u8>, f64, f64)>, scale: f64) -> Result<Vec<u8>, String> {
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
        // Trailing/leading newlines delimit these wrapper streams from the page's
        // own Contents when concatenated in the array below: PDF readers join
        // content-array streams at the token level, so without a delimiter the `cm`
        // and `Q` operators can merge with adjacent tokens (e.g. `cmq`), rendering a
        // malformed/blank page in stricter readers.
        let pre = output.add_object(Stream::new(
            Dictionary::new(),
            format!("q {} 0 0 {} 0 0 cm\n", scale, scale).into_bytes(),
        ));
        let post = output.add_object(Stream::new(Dictionary::new(), b"\nQ".to_vec()));

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

    finish(output, pages_id, kid_ids)
}

/// Concatenate single-page PDFs into one document WITHOUT scaling the content —
/// each input page is already at its correct physical size (WebView2 prints to
/// the page size we pass it). `pages` is `(pdf_bytes, width_pt, height_pt)`; the
/// MediaBox is re-asserted from those points so a page that inherited its
/// MediaBox from the source page tree doesn't lose it on reparenting.
pub fn merge_concat(pages: Vec<(Vec<u8>, f64, f64)>) -> Result<Vec<u8>, String> {
    let mut output = Document::with_version("1.5");
    let pages_id = output.new_object_id();
    let mut kid_ids: Vec<ObjectId> = Vec::with_capacity(pages.len());

    for (bytes, w_pt, h_pt) in pages {
        let mut src = Document::load_mem(&bytes).map_err(|e| format!("load capture: {}", e))?;
        src.renumber_objects_with(output.max_id + 1);

        let page_id = src
            .get_pages()
            .into_values()
            .next()
            .ok_or_else(|| "captured PDF has no page".to_string())?;

        let src_max = src.max_id;
        for (id, obj) in std::mem::take(&mut src.objects) {
            output.objects.insert(id, obj);
        }
        if src_max > output.max_id {
            output.max_id = src_max;
        }

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
                Object::Real(w_pt as f32),
                Object::Real(h_pt as f32),
            ],
        );
        // Contents + Resources are left exactly as WebView2 produced them.
        kid_ids.push(page_id);
    }

    finish(output, pages_id, kid_ids)
}

/// Build the shared Pages tree + Catalog + trailer root and serialize.
fn finish(mut output: Document, pages_id: ObjectId, kid_ids: Vec<ObjectId>) -> Result<Vec<u8>, String> {
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

    let mut catalog = Dictionary::new();
    catalog.set("Type", Object::Name(b"Catalog".to_vec()));
    catalog.set("Pages", pages_id);
    let catalog_id = output.add_object(Object::Dictionary(catalog));
    output.trailer.set("Root", catalog_id);

    let mut buf = Vec::new();
    output.save_to(&mut buf).map_err(|e| format!("save: {}", e))?;
    Ok(buf)
}
