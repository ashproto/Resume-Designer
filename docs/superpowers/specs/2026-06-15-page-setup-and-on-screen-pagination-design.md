# Page Setup & On-Screen Pagination — Design

**Status:** Design (brainstormed 2026-06-15). Target branch: `feat/document-model` (part of PR #46).

## Goal

Give the résumé a real **page-setup model** and make the **live editable preview paginate into true page "sheets"** for fixed page sizes (matching what the PDF export already does), while keeping a **Continuous** mode (open-ended height) that supports a settable width. Works across all 11 layouts and coexists with the existing contenteditable inline editor and the Typst PDF export.

## Context / constraints (from the architecture map)

- The preview is a single `#resume` element (8.5in wide, `min-height: 11in`); `renderCurrentResume()` (`src/main.js`) replaces the container's rendered HTML with `renderResume*(data)`, then calls `refreshInlineEditor()`.
- **Every edit blur triggers a full re-render** (store `change` → `renderCurrentResume()`), so pagination must re-run cheaply after each render and preserve contenteditable.
- The preview is HTML/CSS; the PDF is Typst — **two layout engines**, so on-screen page breaks **approximate** the PDF's (the PDF.js preview in the export dialog remains the exact source of truth). This is inherent to having an editable view.
- `pageSize` lives in `model.attrs.pageSize` (default `'auto'`), round-tripped flat by `migrateToModel.js`, accessed via `store.getPageSize()/setPageSize()`. Today it only drives the Typst `pageRule()`; it is NOT wired to the on-screen view.
- On-screen units: 1in = 96px (CSS).
- A basic Design-tab page-size Segmented control was added in `b5e9215`; this design **replaces** it with the fuller Page Setup group.

## 1. Page-setup model

**Doc attrs (`src/documentModel.js`), round-tripped in `migrateToModel.js`, persisted flat:**
- `pageSize`: `'continuous' | 'letter' | 'a4' | 'legal' | 'tabloid'` (default `'continuous'`).
- `orientation`: `'portrait' | 'landscape'` (default `'portrait'`; ignored for `continuous`).
- `pageWidthIn`: number (default `8.5`; used only when `continuous`).

**Migration:** old `pageSize: 'auto'` → `'continuous'` (with `pageWidthIn: 8.5`). Golden round-trips updated; the flat shape gains `orientation`/`pageWidthIn` only when non-default (keep existing samples byte-stable, mirroring the `_relevanceRank`/`startDate` conditional-emit pattern).

**Dimensions table** (inches, portrait; swap W/H for landscape):
| size | W×H |
|---|---|
| letter | 8.5 × 11 |
| a4 | 8.27 × 11.69 |
| legal | 8.5 × 14 |
| tabloid | 11 × 17 |
| continuous | `pageWidthIn` × auto |

**Store:** keep `getPageSize/setPageSize`; add `getOrientation/setOrientation`, `getPageWidthIn/setPageWidthIn` (same `update()` pattern → emits `change` → re-render → re-paginate). A new shared module **`src/pageSetup.js`** holds the page-setup constants (the dimensions table, size + orientation enums) and a pure helper `pageDimsIn({pageSize, orientation, pageWidthIn})` → `{ widthIn, heightIn|null }` (null height = continuous). It's imported by the store, the Typst generator, and the on-screen paginator so all three use one source of truth.

## 2. On-screen pagination engine

A new module **`src/pagination.js`** exporting `paginate(resumeEl, dims)` and a pure helper `assignBlocksToPages(...)`.

**When it runs:** in `renderCurrentResume()`, AFTER the container HTML is (re)set, BEFORE `refreshInlineEditor()`. It reads the page dims from the store and re-lays-out the just-rendered DOM. (`refreshInlineEditor()` runs after, so contenteditable is restored over the paginated DOM.)

**Continuous mode:** no splitting. Set the sheet width to `pageWidthIn`, height auto (today's behavior, width now configurable). Skip the rest.

**Fixed sizes — the pure algorithm (unit-testable, no DOM):**
`assignBlocksToPages(blockHeightsPx, { firstPageContentPx, pageContentPx })` → array of page indices, one per block. Greedy: accumulate block heights; when the next block would overflow the current page's content height, start a new page; a block taller than a page gets its own page (overflow allowed, flagged). Page 1's budget is smaller when a full-width header sits on it. This pure function is the heart and is fully tested in isolation.

**DOM glue (integration):**
1. Identify the layout family + its paginatable parts (header, column(s), blocks) via a small **adapter** (§3).
2. Measure each block's height (`offsetHeight`), accounting for the current zoom (divide by the zoom scale, since zoom is a CSS transform).
3. Call `assignBlocksToPages` per column.
4. Build a `.resume-pages` container of `.resume-page` sheets (each at the page's px dims), MOVE the existing block nodes into the right sheet (moving preserves nodes + their `data-editable` + listeners), and render the header on sheet 1.
5. Swap the paginated `.resume-pages` in as `#resume`'s content.

**Single-column family** (stacked, classic, classic-featured, stacked-vertical, creative): one column of blocks → sheets at block boundaries; header on sheet 1.

**Two-column family** (sidebar, right-sidebar, modern, compact, executive, timeline) — the hard case: paginate the sidebar column and the main column **independently** into per-column slices, then build page N = a grid `(sidebar slice N ∥ main slice N)` (empty slice allowed when one column is shorter). The colored sidebar background fills **each** sheet full-height (this is the desired multi-page look). The full-width header sits on sheet 1 only; sheet 1's grid budget = page height − header height. `numPages = max(sidebarPages, mainPages)`.

**Sheet styling (CSS):** `.resume-pages` = vertical stack, gap between sheets; `.resume-page` = exact page px dims, white, drop-shadow (paper look), `overflow: hidden`. Optional subtle "Page N" affordance (decide in implementation; not load-bearing).

**contenteditable / re-render:** because we MOVE nodes (not re-create), `data-editable` paths + the inline editor keep working; `refreshInlineEditor()` runs after pagination as today. Caret stability across the edit→re-render→re-paginate cycle is a first-class test target.

**Zoom:** the existing `scale()` transform moves from `.resume-container` to wrap `.resume-pages` (unchanged behavior). Measurement divides by the scale.

**Performance:** re-paginate on each render. Résumé content is small (tens of blocks), so measure+reflow is a few ms. If needed, guard re-pagination so it only re-runs when content/size actually changed; otherwise keep it simple.

## 3. Layout-family adapters

A tiny adapter per family maps the rendered DOM → `{ header, columns: [blocks[]] }`:
- **single** → `{ header: .resume-header, columns: [[…sections]] }`.
- **two-col** → `{ header, columns: [[…sidebar blocks], […main blocks]] }` (left/right order per layout).
- **creative** (card grid) → single column where the card grid is one block (don't split a row of cards mid-grid).
- **timeline** → two-col; the timeline rail lives in the main column's blocks.
Adapters are small + data-driven (a map from layout id → family + column selectors), so adding/adjusting a layout is localized.

## 4. Typst / PDF side

Extend `pageDimsIn` use into `generate.js` `pageRule()`: add **tabloid** (`us-tabloid` / explicit 11in×17in), **orientation** (`flipped: true` for landscape, or swap dims), and **continuous** = `width: pageWidthIn in, height: auto`. The PDF already paginates fixed sizes; this just honors the new options. ATS reading-order + the full-bleed model are unchanged.

## 5. Design-tab "Page Setup" UI

Replace the Segmented page-size control (from `b5e9215`) in `DesignTab.jsx` with a **Page Setup** group:
- **Size** dropdown (Select): Continuous / Letter / A4 / Legal / Tabloid.
- **Orientation** segmented toggle (Portrait/Landscape) — shown only for fixed sizes.
- **Width** input (inches) — shown only for Continuous.
Bound to the store accessors; changing any re-renders → re-paginates. The export dialog's control reflects the same model (size at minimum).

## 6. Edge cases
- Block taller than a page → its own sheet, content allowed to overflow the sheet bottom (no crash; visual flag is out of scope).
- A column with no content on later pages → empty slice; two-col still shows the sidebar bg.
- Switching to Continuous from a fixed size → collapse sheets back to one open sheet.
- Empty résumé → one sheet.
- Very large page counts (pathological) → no cap required; content is bounded.

## 7. Testing
- **Pure algorithm** (`assignBlocksToPages`, `pageDimsIn`, the migration): vitest unit tests (no DOM needed). These cover the real logic.
- **Typst `pageRule`**: extend `typstGenerate`/snapshot tests for tabloid/orientation/continuous-width.
- **DOM paginator (measure + reflow + caret)**: NOT unit-testable under jsdom (no layout engine → zero heights). Verified via the browser preview (preview tools) + the desktop app + rendered checks. The design deliberately isolates the untestable DOM glue from the tested pure algorithm.

## 8. Decomposition (suggested task sequence within #46)
1. **Model + dims**: doc attrs + migration + store accessors + `pageDimsIn` helper + Typst `pageRule` (tabloid/orientation/continuous). Unit-tested. (PDF gains the new sizes immediately.)
2. **Pure paginator**: `assignBlocksToPages` + sheet CSS, unit-tested.
3. **Single-column DOM paginator** + the post-render hook + adapters for single-column layouts. Browser-verified.
4. **Two-column DOM paginator** + adapters for the 6 sidebar layouts + creative/timeline specifics. Browser-verified.
5. **Design-tab Page Setup UI** (replaces the Segmented control) + export-dialog alignment.
6. **Polish**: caret stability, zoom, performance guard, edge cases.

## 9. Out of scope
- Pixel-exact match between on-screen sheets and the Typst PDF (two engines — approximation by design; the PDF.js preview is the exact source).
- Splitting a single block mid-content (we break between blocks; `break-inside: avoid` per item).
- Page headers/footers, page numbers in the PDF, or print-margin/bleed marks.
