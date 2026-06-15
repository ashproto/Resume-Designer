# Phase 3 PR 3.9 — Retire the WKWebView capture path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Now that all 11 layouts export via Typst (PR 3.8), retire the legacy hidden-WebviewWindow PDF *capture* path — the print window, its Rust capture commands, and `generatePdfNative` — and simplify the `pdf.js` router so the desktop app always routes to the Typst export screen. The browser `html2pdf` fallback STAYS; `renderer.js`/`inlineEditor.js` (on-screen render/edit) STAY; `pick_pdf_save_path` + `PdfResult` + `PendingPdfPath` STAY (shared by `typst_export_pdf`).

**Architecture:** This is a deletion PR. The boundary is "remove what becomes *unreachable*." Three tasks, each leaving a green tree: (1) JS render/router — simplify `pdf.js`, drop `generatePdfNative` + `capturePdfFromWindow` + the now-unused `TYPST_LAYOUTS`; (2) the print window + build wiring — delete `print.html` + `printEntry.js`, remove `initPrintMode`, drop the `print` Vite rollup input; (3) Rust — unregister + delete `capture_pdf_from_window` + `pdf_macos.rs`/`pdf_windows.rs` + the capture-only structs. Each task's gate (vitest/lint/**build** for JS, **`cargo check`+`clippy`** for Rust) catches deletion fallout (dangling imports, missing rollup inputs).

**Tech Stack:** vite/rollup, vitest, eslint, cargo (Tauri 2 / Rust). Run JS commands from `resume-designer/`; Rust from `resume-designer/src-tauri/`.

## Out of scope (deliberate — deferred follow-ups, do NOT touch in this PR)
These become *dead* (not unreachable) and carry a behavior/test surface; bundling them risks regressions:
- `styles/print.css` — its `html.pdf-export-mode` rules go dead, but its `@media print` rules still serve browser Ctrl+P. Leave the file + its `index.html` link as-is.
- `index.html` — the `?print` inline guard (line 24) + capture-mention comments (13, 47-51). Harmless dead branch.
- `src/appStorage.js` `readOnly` mode (param defaults `false`; entangled with `test/appStorage.test.js`).
- `src-tauri/src/commands/storage.rs` print-window comments (cosmetic).

## Shared notes
- Commit conventions: lowercase Conventional subject NOT starting with an all-caps word; body lines ≤100; footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Explicit `git add <paths>` (use `git rm` for deletions) — never `-a`/`.`. No push; never touch `next`/`main`.
- After each JS task: `npx vitest run` green, `npm run lint` clean (eslint `no-unused-vars` is the orphaned-import gate), `npm run build` clean (rollup is the missing-input / dangling-import gate).
- The Rust task gate is `cargo check` (compiles) + `cargo clippy` (no NEW unused-import/dead-code warnings from the edits).

---

### Task 1: JS render/router — drop `generatePdfNative`, `capturePdfFromWindow`, `TYPST_LAYOUTS`

**Files:** `src/pdf.js`, `src/native.js`, `src/typstExport.js`.

**Context:** `pdf.js` currently routes desktop → Typst *only for layouts in `TYPST_LAYOUTS`*, else → a filename dialog whose `onDownload` (`handleDownloadPdf`) branches `isElectron ? generatePdfNative : html2pdf`. With all 11 layouts on Typst, desktop should ALWAYS go Typst, making `generatePdfNative` (the WKWebView capture flow) and the `TYPST_LAYOUTS` gate unreachable. The `rd:open-pdf-dialog` path becomes browser-only (html2pdf).

- [ ] **Step 1: Simplify the `pdf.js` file header** (lines 1-10) to:

```js
/**
 * PDF Export Utilities
 *
 * Desktop (Tauri): every layout exports via the Typst pipeline — showPdfDialog
 * routes to the Typst export screen (rd:open-typst-export). See typstExport.js.
 *
 * Browser fallback: html2pdf.js produces image-based PDFs (not ATS-friendly).
 */
```

- [ ] **Step 2: Replace the imports** (lines 12-16) with ONLY what survives:

```js
import { isElectron } from './native.js';
import { getCurrentId, getVariantList } from './variantManager.js';
```

(Removes `pickPdfSavePath`, `capturePdfFromWindow` from `./native.js`; the whole `./typstExport.js` import; `./store.js`; `./appStorage.js` — all were used only inside `generatePdfNative` or the `TYPST_LAYOUTS` gate. `pickPdfSavePath` still lives in `native.js` for `typstExport.js`.)

- [ ] **Step 3: Replace `showPdfDialog`** (currently lines 48-65) — drop the `TYPST_LAYOUTS.has(activeLayout())` condition; desktop always → Typst:

```js
function showPdfDialog() {
  // Default filename from the active variant — slugified active-variant name.
  const current = getVariantList().find((v) => v.id === getCurrentId());
  const selectedLabel = current?.name || 'Resume';
  const defaultFilename = selectedLabel.trim().replace(/\s+/g, '-');

  // Desktop: every layout exports via the Typst pipeline.
  if (isElectron) {
    window.dispatchEvent(new CustomEvent('rd:open-typst-export', { detail: { defaultFilename } }));
    return;
  }
  // Browser: filename dialog -> html2pdf image-based fallback.
  window.dispatchEvent(new CustomEvent('rd:open-pdf-dialog', {
    detail: { defaultFilename, onDownload: handleDownloadPdf },
  }));
}
```

- [ ] **Step 4: Simplify the `handleDownloadPdf` try-block** (currently lines 98-107) — it now only runs in the browser, so drop the `isElectron` branch:

```js
  try {
    // Browser-only path: html2pdf.js (image-based). The desktop app never
    // reaches here — showPdfDialog routes it to the Typst export screen.
    await generatePdfWithHtml2Pdf(resumeEl, filename);
  } catch (error) {
    console.error('PDF generation failed:', error);
    alert(`Failed to generate PDF: ${error.message || 'Unknown error'}. Check the console for details.`);
  } finally {
```

(Leave the rest of `handleDownloadPdf` — `setPdfBusy`, filename normalization, the hidden `#download-pdf` button spinner/restore — UNCHANGED.)

- [ ] **Step 5: Delete `generatePdfNative` entirely** — the JSDoc block (currently starting ~line 130 `/** Generate PDF via a HIDDEN background Tauri WebviewWindow.`) through the function's closing brace (currently ~line 338). `generatePdfWithHtml2Pdf` (below it) and `loadHtml2Pdf`/`setPdfBusy`/`initPdfExport` STAY.

- [ ] **Step 6: Delete `capturePdfFromWindow` from `src/native.js`** — its JSDoc block (currently ~lines 476-491) + the `export async function capturePdfFromWindow(...)` (currently ~492-502). Update the comment at `native.js:39` that reads `dedicated Rust commands (pick_pdf_save_path + capture_pdf_from_window),` to drop `+ capture_pdf_from_window`. KEEP `pickPdfSavePath`, `typstRenderPreview`, `typstExportPdf`, `isElectron`.

- [ ] **Step 7: Remove `TYPST_LAYOUTS` from `src/typstExport.js`** — delete the 2-line comment + the `export const TYPST_LAYOUTS = new Set([...]);` (currently lines 10-12). KEEP `activeLayout` (used by `generateTyp`) and everything else. (Grep already confirmed `pdf.js` was the only consumer.)

- [ ] **Step 8: Verify**

```
npx vitest run            # green (no test referenced these)
npm run lint              # clean — catches any orphaned import
npm run build             # clean — catches dangling refs
grep -rn "generatePdfNative\|capturePdfFromWindow\|TYPST_LAYOUTS" src/   # -> NO matches
```

- [ ] **Step 9: Commit** (3 files)

```bash
git add src/pdf.js src/native.js src/typstExport.js
git commit -m "$(cat <<'EOF'
refactor(pdf): route desktop export to Typst, drop WKWebView capture caller

All 11 layouts export via Typst, so showPdfDialog always routes the desktop app
to the Typst export screen and the rd:open-pdf-dialog path is browser-only
(html2pdf). Removes the now-unreachable generatePdfNative, the capturePdfFromWindow
bridge, and the unused TYPST_LAYOUTS gate.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: print window + build wiring — delete `print.html`/`printEntry.js`, remove `initPrintMode`, drop the Vite `print` input

**Files:** delete `print.html`, delete `src/printEntry.js`, edit `src/main.js`, `src/main.jsx`, `vite.config.js`.

**Context:** After Task 1 nothing spawns the print window. `print.html` loads `src/printEntry.js` → `initPrintMode()` (in `main.js`), which renders the resume off-screen and emits `print-ready`. All of that is now unreachable. The `print` rollup input + `print.html` must be removed *together* (rollup errors if an input file is missing).

- [ ] **Step 1: Delete the print entry files**

```bash
git rm print.html src/printEntry.js
```

- [ ] **Step 2: Remove the `print` rollup input + refresh comments in `vite.config.js`.** Replace the `rollupOptions` block (currently lines 42-49) with a single-entry config and drop the stale `print.html` NOTE (lines 24-25):

```js
    // Single entry: the React app shell (index.html).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
```

Also update the comment on lines 11-13 (`The resume document and the hidden PDF print window stay vanilla.`) → `The resume document stays vanilla.` and delete the lines 24-25 NOTE about the `print.html` input.

- [ ] **Step 3: Remove `initPrintMode` from `src/main.js`** — delete the entire `export async function initPrintMode() { … }` (currently starting line 460) through its closing brace, PLUS its preceding JSDoc block (the `/** … Applies html.pdf-export-mode … emits print-ready/print-error */` comment above it, ~lines 445-459). Update the three stale comments that mention the print entry:
  - line ~145 (`… and the print-mode hide rule.`) — drop the print-mode clause.
  - lines ~200-201 (`(Print-mode is a separate framework-free entry — print.html / src/printEntry.js — so the main window never short-circuits here.)`) — delete this parenthetical.
  - line ~317 (`shared with the React-free print entry (printEntry.js -> initPrintMode);`) — reword to drop the print-entry mention.
  - line ~1205 (`// the print window (src/printEntry.js) calls initPrintMode() directly.`) — delete.

- [ ] **Step 4: Update the `src/main.jsx` header comment** (lines 4-6) — remove the print-window paragraph:

```js
// React entry for the app chrome. Replaces the vanilla src/main.js as the
// index.html script. Renders <App/>, which hosts the still-vanilla chrome
// skeleton and boots it via init(), and mounts the Sonner toaster.
```

- [ ] **Step 5: Verify**

```
npm run lint    # clean — flags any import in main.js orphaned by removing initPrintMode; remove those
npx vitest run  # green
npm run build   # clean — proves the single rollup input builds with print.html gone
grep -rn "initPrintMode\|printEntry\|print\.html\|print-ready\|print-error\|print-step\|pdf-export-mode" src/ vite.config.js   # -> only allowed leftovers: styles/print.css refs in index.html (out of scope), main.js line ~449 was removed; expect NO src/*.js matches
```

(If `npm run lint` flags imports in `main.js` that only `initPrintMode` used, remove those import bindings too. Re-run lint until clean.)

- [ ] **Step 6: Commit** (deletions + 3 edits)

```bash
git add -- print.html src/printEntry.js src/main.js src/main.jsx vite.config.js
git commit -m "$(cat <<'EOF'
refactor(pdf): remove the hidden print window and its build entry

Nothing spawns the WKWebView capture window anymore, so delete print.html and its
framework-free entry src/printEntry.js, remove initPrintMode() from main.js, and
drop the print.html rollup input from the Vite config.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

(`git rm` already staged the deletions; the `git add` re-stages the edits. Both deleted paths are included for an explicit record.)

---

### Task 3: Rust — unregister + delete `capture_pdf_from_window` and the platform capture modules

**Files:** edit `src-tauri/src/lib.rs`, `src-tauri/src/commands/mod.rs`; delete `src-tauri/src/commands/pdf_macos.rs`, `src-tauri/src/commands/pdf_windows.rs`.

**Context:** After Tasks 1-2 nothing invokes `capture_pdf_from_window`. KEEP `PendingPdfPath`, `pick_pdf_save_path`, `PdfResult` (+ impls) — `typst_compile.rs` imports `use super::{PdfResult, PendingPdfPath}` and `typst_export_pdf` writes to the same `PendingPdfPath` slot. The capture-only items are: `capture_pdf_from_window`, `PageSize`, `CaptureRect`, the `pdf_macos`/`pdf_windows` mods (+ files), and `canceled_result` (already `#[allow(dead_code)]`).

- [ ] **Step 1: Unregister the command in `src-tauri/src/lib.rs`** — delete the line `commands::capture_pdf_from_window,` (line 29) from the `generate_handler!` list. KEEP `commands::pick_pdf_save_path,` (line 28) and `.manage(commands::PendingPdfPath::default())` (line 17).

- [ ] **Step 2: Delete the platform capture modules**

```bash
git rm src-tauri/src/commands/pdf_macos.rs src-tauri/src/commands/pdf_windows.rs
```

- [ ] **Step 3: Edit `src-tauri/src/commands/mod.rs`** — remove the capture-only items:
  - the `mod pdf_macos;` / `mod pdf_windows;` block (lines 19-22, including the `#[cfg(...)]` attrs).
  - the `PageSize` struct (lines 44-50) and the `CaptureRect` struct (lines 52-68, including its doc comment).
  - the entire `capture_pdf_from_window` command (lines 159-223, including its JSDoc).
  - the `canceled_result` fn (lines 225-231).
  - **Fix the `use` lines** now that capture is gone:
    - `use tauri::{AppHandle, Manager, State, WebviewWindow};` → `use tauri::{State, WebviewWindow};` (`AppHandle`/`Manager` were capture-only).
    - `use serde::{Deserialize, Serialize};` → `use serde::Serialize;` (`Deserialize` was for `PageSize`/`CaptureRect`).
    - KEEP `use std::path::PathBuf;`, `use std::sync::Mutex;`, `use tauri_plugin_dialog::DialogExt;`, `use tokio::sync::oneshot;` (all used by `pick_pdf_save_path`).
  - **Update the `PendingPdfPath` doc comment** (lines 9-15) to drop the `capture_pdf_from_window` mention, e.g.: `Server-side single-slot binding: pick_pdf_save_path stores the user-chosen path here; typst_export_pdf takes it back out and writes the PDF there. The renderer can never supply a path directly.`

- [ ] **Step 4: Verify** (from `resume-designer/src-tauri/`)

```
cargo check        # compiles
cargo clippy       # no NEW unused-import / dead-code warnings from the edits
```

If clippy flags a still-unused import or `PageSize`/`CaptureRect`/`PdfResult` member, resolve it (drop the import) — but do NOT remove `PdfResult`/`PendingPdfPath`/`pick_pdf_save_path`. Then from `resume-designer/`:

```
grep -rn "capture_pdf_from_window\|pdf_macos\|pdf_windows\|PageSize\|CaptureRect\|capturePdf" src-tauri/src/   # -> NO matches
```

- [ ] **Step 5: Commit** (1 edit + 1 edit + 2 deletions)

```bash
git add -- src-tauri/src/lib.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/pdf_macos.rs src-tauri/src/commands/pdf_windows.rs
git commit -m "$(cat <<'EOF'
refactor(pdf): delete the Rust WKWebView/WebView2 capture command

Nothing invokes capture_pdf_from_window now that the desktop app exports via Typst.
Remove the command, its platform impls (pdf_macos.rs/pdf_windows.rs), and the
capture-only PageSize/CaptureRect structs. pick_pdf_save_path + PdfResult +
PendingPdfPath stay — typst_export_pdf reuses them.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final verification (after all three tasks)
- [ ] **JS green:** `npx vitest run` (all pass, no count drop), `npm run lint`, `npm run build` (single entry, builds clean).
- [ ] **Rust green:** `cargo check` + `cargo clippy` clean from `src-tauri/`.
- [ ] **No dangling references** — all return EMPTY:
  ```
  grep -rn "generatePdfNative\|capturePdfFromWindow\|capture_pdf_from_window\|printEntry\|initPrintMode\|print\.html\|pdf_macos\|pdf_windows\|TYPST_LAYOUTS" src/ src-tauri/src/ vite.config.js
  ```
  (Expected NON-matches that are FINE and out of scope: `styles/print.css` itself, and `index.html`'s `?print` guard + `print.css` link.)
- [ ] **Typst export path intact** — `pick_pdf_save_path`, `typst_export_pdf`, `typstExport.js` (`generateTyp`/`exportToPath`/`renderPreview`), and `TypstExportDialog.jsx` UNCHANGED; `PendingPdfPath` still `.manage`d and registered.
- [ ] **commitlint** `npx commitlint --from <pre-PR sha> --to HEAD` exits 0.
- [ ] **Final whole-PR review** (spec compliance + code quality) + hand the Tauri check to the user: in the desktop app, Download → Typst export still works for all layouts; in a browser `vite preview`, Download still produces an html2pdf PDF.

## Notes
- After this PR, the WKWebView/WebView2 capture path is fully gone; Typst is the sole desktop PDF path. The deferred cosmetic cleanups (print.css dead rules, index.html `?print` guard, appStorage `readOnly`, storage.rs comments) can be a tiny follow-up.
- This is the last planned Phase-3 PR before merging `feat/document-model` → `next` (protected: PR + 2 checks) → `main`. The user's desktop visual review of all 11 Typst layouts is the gate before that merge.

## Self-review notes (author)
- **Spec coverage:** the cleanup described in the PR-3.7 plan notes + [[phase-3-remaining]] ("retire the WKWebView capture path … keep the browser html2pdf fallback; renderer.js/inlineEditor.js stay; pick_pdf_save_path stays"). Every named item is either removed (capture machinery) or explicitly kept (Typst path, browser fallback, shared Rust). ✓
- **No placeholders:** each removal is anchored to a function/struct boundary + a grep gate; each edit shows the exact replacement code. Line numbers are "currently ~N" because deletions shift them — the function/symbol names + the grep sweeps are the source of truth. ✓
- **Unreachable-not-dead boundary:** only provably-unreachable code is removed; the dead-but-reachable artifacts (print.css/@media-print, ?print guard, appStorage.readOnly) are explicitly deferred. ✓
- **Build-order safety:** `print.html` deletion + the Vite `print` input removal are in the SAME task (Task 2) so rollup never sees a missing input; the Rust unregister (lib.rs) + command deletion (mod.rs) are in the SAME task (Task 3) so `generate_handler!` never names a missing command. ✓
- **Keepers consistency:** `PdfResult`/`PendingPdfPath`/`pick_pdf_save_path` retained because `typst_compile.rs` (`use super::{PdfResult, PendingPdfPath}`) depends on them — verified by grep, not assumed. ✓
