# PDF Preview During Export — Design

**Goal:** When exporting, show the user the **real generated PDF** in an in-app
preview before it's saved to disk, so they confirm exactly what they're getting.

**Status:** Approved (2026-06-16). Builds on the HTML-for-both multi-page export
(`feat/page-setup-pagination`: commits `293c5ac`, `abd7784`, `1078f00`).

---

## Background — current export flow

`Header` PDF button → `pdf.js` dispatches `rd:open-pdf-dialog` → `PdfDialog`
(filename only) → `onDownload(filename)` → `pickPdfSavePath` (native save dialog,
stashes the path server-side in `PendingPdfPath`) → hidden `/print.html` window
renders the same `renderCurrentResume()` → `capture_pdf_from_window` →
`pdf_macos::capture_pdf` (per-sheet `createPDF` + `lopdf` merge) → writes to the
stashed path. There is **no visual preview** — the first time the user sees the
PDF is after it's saved.

## Design

### Flow
1. Click **PDF** → "Generating…" busy state (existing `rd:pdf-busy`).
2. The existing hidden-window pipeline runs unchanged, but the merged PDF is
   written to a **temp file** (app cache dir) instead of a user-picked path —
   so generation happens **before** any save dialog.
3. A **preview modal** opens showing the **real generated PDF** in an embedded
   `<iframe>` (WKWebView renders PDFs natively; scroll through all pages), with a
   **filename field** and **[Cancel] [Save PDF]**.
4. **Save PDF** → native "choose location" dialog (filename pre-filled via
   `pickPdfSavePath`) → the temp PDF is copied to the chosen path.
5. **Cancel** (or window close) → discard the temp file.

### Components & interfaces
- **Rust (`commands/`):**
  - Capture writes the merged PDF to a **temp path** (server-side, app cache) and
    returns it, instead of writing to the `PendingPdfPath` slot. (A "preview"
    capture needs no pre-picked path.)
  - `read_pdf_preview` → returns the temp PDF bytes, for the renderer to display
    as a blob (read-only; avoids asset-scope config).
  - `save_pdf_from_temp` → after `pickPdfSavePath`, copy temp → the stashed path.
  - Temp file is deleted on save-complete and on cancel.
- **React — `PdfDialog` becomes a preview dialog:** a larger modal containing the
  `<iframe>` (blob URL of the temp PDF) + the existing filename field + Cancel /
  Save PDF. Same `rd:open-pdf-dialog` bridge, extended detail
  (`{ defaultFilename, previewUrl/bytes, onSave, onCancel }`).
- **`pdf.js`:** `generatePdfNative` reorders to: generate-to-temp → fetch preview
  bytes → open the preview dialog. On **Save**: `pickPdfSavePath` →
  `save_pdf_from_temp`. On **Cancel**: discard temp. Busy state spans generation
  only (not while the modal is open).

### Decisions
- **Desktop (Tauri) only.** The browser build keeps its current direct
  `html2pdf` download (there is no native PDF to preview there).
- **Keep the in-app filename field** — it pre-fills the native save dialog; the
  native dialog still chooses the location (preserves the secure server-side
  path-pick: the renderer never chooses where to write).
- **Viewer = embedded PDF with scroll only.** No custom page-nav / zoom controls.

### Edge cases & error handling
- Generation failure → surface the error (as today), no preview opens; clean up
  any temp file.
- Cancel / dialog close / app quit → delete the temp file (best-effort).
- Save failure (disk full / permission) → error toast; temp retained so the user
  can retry.

### Security
- The save path still comes only from `pickPdfSavePath` (native dialog, stashed
  server-side). The renderer never supplies the destination. The renderer reads
  the temp bytes only to **display** them (read-only); the actual write is a
  server-side temp→path copy.

### Testing
- Pure logic is thin; verify end-to-end in the desktop app: export → the preview
  shows the real multi-page PDF → Save writes the identical, selectable PDF to the
  chosen path → Cancel leaves nothing behind (temp cleaned up).

## Out of scope
- Custom page navigation / zoom controls in the viewer.
- A preview in the browser build.
- Editing within the preview, or re-running page-setup from the preview (the user
  cancels and adjusts in the Design tab).
