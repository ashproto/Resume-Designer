# Phase 3 PR 3.5 — Typst export/preview screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the original ask — a **page-size + Typst PDF export/preview screen**. Wire the model (3.1), generator (3.2–3.3), and Rust commands (3.4) into a UI: for the **core-3 layouts** (sidebar / stacked / classic) on the desktop app, the Download button opens an export screen with a **page-size selector** (auto / Letter / A4 / Legal), a **live PDF.js preview** of the Typst-rendered PDF, and **Save**. All other layouts and the browser build keep today's capture / html2pdf path (no regression).

**Architecture:** A new `src/typstExport.js` orchestrates: read design settings → `buildTheme()` → `modelToTypst(store.getModel(), { theme, layout })` → `.typ`, then `invoke('typst_render_preview', { typ })` (→ PDF bytes for PDF.js) or `invoke('typst_export_pdf', { typ })` (→ writes to the picked path). A new React `<TypstExportDialog/>` renders the screen. `pdf.js` becomes a **router**: `isTauri && core-3 → Typst dialog; else → existing PdfDialog/capture/html2pdf`. Page size lives on the model (`store.getPageSize`/`setPageSize`); changing it in the dialog persists + re-renders the preview.

**Tech Stack:** React + shadcn, `pdfjs-dist` (already wired in `resumeParser.js` — reuse the worker pattern), the `@tauri-apps/api` `invoke` via `native.js`'s `tauri()` helper, vitest.

**⚠ Verification reality:** the Typst compile/preview/export are **Tauri-only** (Rust commands — absent in the browser dev server). So: `typstExport.generateTyp` and the dialog's *non-preview* UI are headlessly verifiable (vitest + `vite preview`); the **actual PDF preview + export are verified by the user in the built Tauri app**. The dialog must degrade gracefully when `!isTauri` (show "preview available in the desktop app", not a crash).

---

## Exact integration points (from the codebase — use these verbatim)
- Theme: `getCurrentFontSettings()` → `{ pairingId }` (`fontService.js`); `getSettings()` → `{ colorPalette, customColor, layout, defaultPageSize }` (`persistence.js`); `getSpacingSettings()` (`spacingService.js`); `getAccentSettings()` (`accentService.js`); `buildTheme({ pairingId, colorPalette, customColor, spacing, accent })` (`src/typst/theme.js`).
- Model + page size: `store.getModel()`, `store.getPageSize()`, `store.setPageSize(v)` (`src/store.js`).
- Active layout: `getSettings().layout` (string id). **Core-3 = `sidebar`, `stacked`, `classic`.**
- Tauri invoke: `native.js` has an internal `async function tauri()` returning `{ core, ... }`; pattern `const { core } = await tauri(); return core.invoke('cmd', args)`. `isTauri` is exported from `native.js`.
- Dialog bridge: `pdf.js` `showPdfDialog()` dispatches `rd:open-pdf-dialog` `{ defaultFilename, onDownload }`; `<PdfDialog/>` listens + mounts in `App.jsx` (when `storageReady`). React imports vanilla modules directly.
- PDF.js worker (reuse): `resumeParser.js` does `import * as pdfjsLib from 'pdfjs-dist'; import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'; pdfjsLib.GlobalWorkerOptions.workerSrc = worker;` then `pdfjsLib.getDocument({ data }).promise`.

---

## File Structure

| File | Change |
|---|---|
| `resume-designer/src/native.js` | add `typstRenderPreview(typ)` + `typstExportPdf(typ)` (invoke wrappers) |
| `resume-designer/src/typstExport.js` | **new** — theme-from-settings + `generateTyp()` + `renderPreview()` + `exportToPath()` |
| `resume-designer/src/components/TypstExportDialog.jsx` | **new** — the export/preview screen |
| `resume-designer/src/App.jsx` | mount `<TypstExportDialog/>` next to `<PdfDialog/>` |
| `resume-designer/src/pdf.js` | route the Download button (core-3 + Tauri → Typst; else existing) |
| `resume-designer/test/typstExport.test.js` | **new** — `generateTyp` unit test (headless) |

One commit per task. Conventional Commits (lowercase subject — not starting with an all-caps word; body ≤100; `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` footer). Explicit `git add`; no `-a`. Do NOT push; do NOT touch `next`/`main`.

---

### Task 1: Orchestrator (`typstExport.js`) + invoke wrappers + unit test

**Files:** add to `src/native.js`; create `src/typstExport.js`, `test/typstExport.test.js`.

- [ ] **Step 1: Write the failing test** (`test/typstExport.test.js`) — exercises the headless part (settings → theme → `.typ`). Mock the design services + the store so it runs without a DOM/Tauri:
```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flatToModel } from '../src/migrateToModel.js';

const model = flatToModel({
  name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
  summary: 'S.', sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust'] }],
  experience: [], education: [], tools: 'Figma', pageSize: 'a4',
});

vi.mock('../src/store.js', () => ({ store: { getModel: () => model } }));
vi.mock('../src/persistence.js', () => ({ getSettings: () => ({ colorPalette: 'ocean', customColor: '#000', layout: 'sidebar' }) }));
vi.mock('../src/fontService.js', () => ({ getCurrentFontSettings: () => ({ pairingId: 'modern-clean' }) }));
vi.mock('../src/spacingService.js', () => ({ getSpacingSettings: () => ({}) }));
vi.mock('../src/accentService.js', () => ({ getAccentSettings: () => ({}) }));

describe('typstExport.generateTyp', () => {
  let generateTyp;
  beforeEach(async () => { ({ generateTyp } = await import('../src/typstExport.js')); });
  it('builds .typ from the model + settings, honoring pageSize and layout', () => {
    const typ = generateTyp();
    expect(typ).toContain('#set page(paper: "a4"');      // from model.attrs.pageSize
    expect(typ).toContain('font: "Inter"');               // modern-clean body font (theme from settings)
    expect(typ).toContain('#grid(');                       // sidebar layout selected
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run test/typstExport.test.js` → FAIL (module missing).

- [ ] **Step 3a: Invoke wrappers in `src/native.js`** — add alongside `pickPdfSavePath`/`capturePdfFromWindow`, using the existing internal `tauri()` helper:
```js
// Compile a .typ string to PDF bytes via the Rust backend (Tauri only).
export async function typstRenderPreview(typ) {
  if (!isTauri) throw new Error('Typst rendering is only available in the desktop app');
  const { core } = await tauri();
  return core.invoke('typst_render_preview', { typ }); // -> ArrayBuffer
}
// Compile + write to the path picked by pickPdfSavePath (Tauri only).
export async function typstExportPdf(typ) {
  if (!isTauri) throw new Error('Typst export is only available in the desktop app');
  const { core } = await tauri();
  return core.invoke('typst_export_pdf', { typ }); // -> PdfResult { success, filePath?, error? }
}
```

- [ ] **Step 3b: `src/typstExport.js`** — the orchestrator (pure `generateTyp`; thin Tauri wrappers):
```js
import { store } from './store.js';
import { getSettings } from './persistence.js';
import { getCurrentFontSettings } from './fontService.js';
import { getSpacingSettings } from './spacingService.js';
import { getAccentSettings } from './accentService.js';
import { buildTheme } from './typst/theme.js';
import { modelToTypst } from './typst/generate.js';
import { typstRenderPreview, typstExportPdf, pickPdfSavePath } from './native.js';

// Layouts the Typst generator covers today (PR 3.2–3.3). Others fall back to capture.
export const TYPST_LAYOUTS = new Set(['sidebar', 'stacked', 'classic']);

function resumeTheme() {
  const s = getSettings();
  return buildTheme({
    pairingId: getCurrentFontSettings().pairingId,
    colorPalette: s.colorPalette,
    customColor: s.customColor,
    spacing: getSpacingSettings(),
    accent: getAccentSettings(),
  });
}

export function activeLayout() { return getSettings().layout; }

// Pure: model (incl. pageSize) + settings → Typst source. Headless-testable.
export function generateTyp() {
  return modelToTypst(store.getModel(), { theme: resumeTheme(), layout: activeLayout() });
}

// Tauri-only: compile to PDF bytes for the preview.
export function renderPreview() { return typstRenderPreview(generateTyp()); }

// Tauri-only: pick a path, then compile + write there.
export async function exportToPath(filename) {
  const path = await pickPdfSavePath(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
  if (!path) return { canceled: true };
  return typstExportPdf(generateTyp());
}
```

- [ ] **Step 4: Run to verify PASS** — `npx vitest run test/typstExport.test.js` → pass.

- [ ] **Step 5: Commit**
```bash
git add src/native.js src/typstExport.js test/typstExport.test.js
git commit -m "feat(export): typst export orchestrator and invoke wrappers" -m "typstExport.generateTyp builds .typ from the model + design settings; native.js
gains typst_render_preview/typst_export_pdf wrappers. Pure generate is unit-tested.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The export/preview dialog (`TypstExportDialog.jsx`)

**Files:** create `src/components/TypstExportDialog.jsx`; modify `src/App.jsx`.

A shadcn `Dialog` (wider than `PdfDialog`) that opens on a new `rd:open-typst-export` event `{ defaultFilename }`. Contents: a **filename** `Input`, a **page-size** selector (auto / Letter / A4 / Legal) bound to `store.getPageSize()` / `store.setPageSize()`, a **PDF.js preview** pane, and a **Save** button calling `typstExport.exportToPath(filename)`. Mirror `PdfDialog.jsx`'s event-bridge + shadcn patterns.

- [ ] **Step 1: Build the component.** Key behaviors (use the project's shadcn primitives — `Dialog`, `Input`, `Label`, `Button`, and `Select` if present, else a small segmented `Button` group; confirm what exists under `@/components/ui/`):
  - Listen for `rd:open-typst-export`; on open, set the filename and initialize the page-size from `store.getPageSize()`.
  - **Page size** options: `auto`/`letter`/`a4`/`legal` (labels: "Auto (single page)", "Letter", "A4", "Legal"). On change: `store.setPageSize(value)` then re-run the preview (debounce ~250 ms).
  - **Preview:** on open + on page-size change, call `typstExport.renderPreview()`; render the returned `ArrayBuffer` with PDF.js (reuse the worker setup from `resumeParser.js`: `import * as pdfjsLib from 'pdfjs-dist'; import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'; pdfjsLib.GlobalWorkerOptions.workerSrc = worker;`), drawing each page to a `<canvas>` in a scrollable pane. Show a spinner while compiling, an error message on failure, and — when `!isTauri` (the wrapper throws) — a muted "Live preview is available in the desktop app." note (so the browser build doesn't crash).
  - **Save:** `await typstExport.exportToPath(filename)`; on `{ success }` close; on `{ error }` show it; on `{ canceled }` stay open.
  - Import vanilla modules directly (`import { store } from '../store.js'`, `import * as typstExport from '../typstExport.js'`, `import { isTauri } from '../native.js'`).
- [ ] **Step 2: Mount it** in `src/App.jsx` next to `<PdfDialog/>`: `{storageReady && <TypstExportDialog />}`.
- [ ] **Step 3: Sanity check** — `npm run build` succeeds (the new component + the `pdfjs-dist` import resolve). `npm test` still green. (The live preview itself is Tauri-only; verified in Task 4 / by the user.)
- [ ] **Step 4: Commit**
```bash
git add src/components/TypstExportDialog.jsx src/App.jsx
git commit -m "feat(export): typst export/preview dialog with page-size + pdf.js" -m "New screen: filename, page-size selector (bound to store.getPageSize/setPageSize),
live PDF.js preview of the Typst render, and Save. Degrades gracefully off-Tauri.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Route the Download button (`pdf.js`)

**Files:** modify `src/pdf.js`.

The Download button calls `showPdfDialog()`. Route it: **core-3 layout + Tauri → open the Typst dialog**; everything else → today's flow (the existing `rd:open-pdf-dialog` → capture / html2pdf), unchanged.

- [ ] **Step 1: Implement the router** in `showPdfDialog()`:
```js
import { isTauri } from './native.js';
import { TYPST_LAYOUTS, activeLayout } from './typstExport.js';
// ... existing imports ...

function showPdfDialog() {
  const current = getVariantList().find((v) => v.id === getCurrentId());
  const defaultFilename = (current?.name || 'Resume').trim().replace(/\s+/g, '-');

  // Typst path: desktop + a layout the generator covers.
  if (isTauri && TYPST_LAYOUTS.has(activeLayout())) {
    window.dispatchEvent(new CustomEvent('rd:open-typst-export', { detail: { defaultFilename } }));
    return;
  }
  // Fallback: existing filename dialog → WKWebView capture / html2pdf (unchanged).
  window.dispatchEvent(new CustomEvent('rd:open-pdf-dialog', { detail: { defaultFilename, onDownload: handleDownloadPdf } }));
}
```
(Leave `handleDownloadPdf`, `generatePdfNative`, `generatePdfWithHtml2Pdf` untouched — they remain the fallback for the other 8 layouts and the browser build.)

- [ ] **Step 2: Build + test** — `npm run build` + `npm test` green. Confirm no import cycle (`pdf.js` → `typstExport.js` → `native.js`; `pdf.js` already imports `native.js`, so this is fine).

- [ ] **Step 3: Commit**
```bash
git add src/pdf.js
git commit -m "feat(export): route core-3 layouts to the typst export screen" -m "Download opens the Typst preview screen for sidebar/stacked/classic on desktop;
all other layouts and the browser build keep the existing capture/html2pdf path.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Verification + final review (controller)

- [ ] **Headless UI check (browser):** run the dev server; trigger `rd:open-typst-export` (or click Download with a core-3 layout — note it's gated on `isTauri`, so to see the dialog in the browser, dispatch the event manually or temporarily relax the gate for the check). Confirm the dialog opens, the filename + page-size selector render and the page-size binds to `store.setPageSize`, and the `!isTauri` preview-unavailable note shows (no crash). Restore any temporary gate change. Use **fabricated data only**; restore localStorage after.
- [ ] **Full suite + lint + build:** `npm test`, `npm run lint`, `npm run build` all green.
- [ ] **Non-regression:** with a non-core-3 layout (e.g. `modern`), the Download button still opens the existing `PdfDialog` (capture/html2pdf) — unchanged.
- [ ] **Final whole-PR review** (fresh reviewer): the orchestrator, the dialog, the router, the security (no path from the renderer — `exportToPath` uses `pickPdfSavePath` + the server-side slot), commit hygiene/commitlint.
- [ ] **Hand to the user for the Tauri verification:** the live Typst preview + actual export + visual parity vs the on-screen layout can only be confirmed in the built desktop app — this is the user's review (build the app, pick a core-3 layout, Download, try each page size, Save).

---

## Self-review notes (author)
- **Spec coverage:** design spec §7 (export/preview screen evolving `PdfDialog`, PDF.js preview, `pick_pdf_save_path` + write command), §8 (page-size selector bound to the per-doc model property). The original page-size ask **ships** here. ✓
- **No placeholders:** the orchestrator, invoke wrappers, router, and the generate-unit-test have exact code; the React dialog is structured with the exact reuse patterns (PdfDialog bridge, resumeParser's PDF.js worker) — the visual build is delegated, but every integration call is pinned. ✓
- **Verification honesty:** the plan explicitly separates the headless-verifiable parts (generate test, dialog shell, routing, non-regression) from the Tauri-only parts (live preview, export, visual parity) handed to the user. No false "it works" claims about the PDF itself. ✓
- **Consistency:** `TYPST_LAYOUTS` (the core-3 set) is defined once in `typstExport.js` and reused by the router; `generateTyp` is the single source for both preview and export; page size flows model → `.typ` via the existing `store.getPageSize`/`setPageSize` + `modelToTypst` (no new path). ✓
