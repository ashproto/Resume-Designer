# Document Model — Phase 3: Typst PDF Export — Design Spec

**Date:** 2026-06-14
**Status:** Draft — awaiting review
**Author:** Ash (with Claude)
**Branch:** `feat/document-model` (targets `next`)
**Relates to:** `2026-06-14-structured-document-model-design.md` (§7 Typst pipeline, §8 page-size, §13 testing, §14 open questions), `2026-06-14-phase-0-findings.md` (Typst GO), `2026-06-14-document-model-phase-2-design.md` (the model-native store this builds on).

---

## 1. Context & goal

The original ask that started this whole refactor: let users **set a résumé's page size** (auto / Letter / A4 / Legal), export an **ATS-correct PDF** (real selectable text in canonical reading order), from a **dedicated export/preview screen**. Phases 0–2 built the substrate: a structured ProseMirror document model that is the store's in-memory source of truth, with reading order = depth-first tree order. **Phase 3 is the payoff** — turn that model into a PDF via Typst.

### What is already settled (do not re-open)
From the locked decisions in the structured-document-model spec §2 and the Phase-0 GO:
- **Typst is the export engine**, Rust-native and in-process (`typst-as-lib` 0.15.5 + `typst-pdf` 0.14.2, ~14 ms compile, validated ATS-correct in Phase 0).
- The export is **model-driven** and **replaces the WKWebView/WebView2 capture** as the primary export.
- The on-screen HTML (`renderer.js` + `inlineEditor.js`) stays the **edit/preview surface** — Phase 2's architecture pivot kept it (there is no TipTap). The model is read for export via `store.getModel()`.

### Decisions taken for Phase 3 (from this design pass)
| # | Decision | Choice |
|---|---|---|
| A | Fidelity target | **Match the on-screen design** — port layouts + theme to Typst so the PDF looks like what was designed; accept minor line-wrap differences. |
| B | Layout coverage (first cut) | **Core 3** — `sidebar` + `stacked` + `classic` — then expand the remaining 8 in follow-up PRs. |
| C | Page-size home | **Per-document** (a `doc` model attr) **+ a global default** for new docs; existing docs read `auto`. |
| D | In-app preview | **PDF.js viewer** (`pdfjs-dist`, already a dependency) rendering the actual compiled PDF bytes. |

### Reframing the win (why this is worth it)
The *current* desktop export is already ATS-correct **and** pixel-perfect — `pdf.js` captures the actual rendered HTML via WKWebView `createPDF` (real selectable text, exact on-screen look). What it cannot do, and what Typst delivers:
1. **True page sizes + pagination** (macOS capture emits one tall page; the original ask).
2. **Reading order guaranteed by the model**, not by a coincidental DOM-order invariant (the sidebar defect from the parent spec §1).
3. **~14 ms in-process compile** — no hidden-window spawn / font-load race / off-screen capture dance.
4. **Real-text export available to the browser build** later (today the browser falls back to image-based `html2pdf`).

The trade-off, and the central risk: Typst is a *different layout engine*, so matching the creative on-screen chrome (gradient headers, colored sidebars, 12 palettes, 10 font pairings, accent decorations) is the work. Decision B (staged coverage) and §8 (staged cutover with a no-regression fallback) manage it.

---

## 2. Scope & non-goals

### In scope (Phase 3)
- A pure **`model → .typ` generator** in JS, covering the **core-3 layouts**, parameterized by layout + theme tokens + page size.
- **`pageSize`** as a per-document model property + flat migration + a global default setting.
- **Rust Typst compile commands** (`typst-as-lib`) with bundled fonts, returning PDF bytes (preview) and writing to the secure save-path slot (export).
- An **export/preview screen** (evolved `PdfDialog`): filename + page-size selector + live PDF.js preview + Save.
- A **no-regression cutover**: ported layouts export via Typst; un-ported layouts keep today's WKWebView capture.

### Non-goals (explicit — deferred)
- **Tagged PDF / PDF-UA.** Real text in reading order is already ATS-sufficient; Typst's tagged-PDF support is still maturing. Revisit later.
- **Browser-build Typst.** Typst is Rust-native; the browser build keeps `html2pdf` (no page sizes in-browser) until a future WASM phase.
- **Link-editing UI.** The `link` mark maps to Typst `#link(...)` if present, but no link editor is added to the résumé UI (none exists today).
- **The remaining 8 layouts** (PR 3.5+) and **removal of the legacy capture path** (a later cleanup, once all 11 are ported).
- **Moving layout/palette/fonts per-document.** They stay global this phase (parent spec §11 Phase 4). Only `pageSize` becomes per-document now.

---

## 3. Architecture — JS generates, Rust compiles

```
 store.getModel()  (model JSON, incl. pageSize attr)
        │
        ├──────────────┐
        ▼              ▼
   layout (global)   theme bridge ── reads the SAME global services
                     (palettes.js, fontService, spacingService, accentService)
        │              │
        └──────┬───────┘
               ▼
   modelToTypst(model, { layout, theme, pageSize })   ← PURE JS, vitest-tested
               │  ".typ" source string
               ▼
   invoke('typst_render_preview', { typ })   |   invoke('typst_export_pdf', { typ })
               ▼                                          ▼
   Rust: typst-as-lib compile + bundled fonts → PDF bytes
               │                                          │
               ▼                                          ▼
        Uint8Array → PDF.js preview            write bytes to PendingPdfPath slot
                                               (path from pick_pdf_save_path; renderer
                                                never supplies the path)
```

**Why the generator is in JS, not Rust.** It needs the same palette hex values, font-family names, and spacing constants the JS design services already hold, and "match the design" means mirroring `renderer.js` / `styles/resume.css`. Keeping it in JS makes it unit-testable in vitest (exactly like `migrateToModel.js`) and shares the theme logic with the renderer. **Rust stays a dumb, fast compiler**: it receives `.typ` source + provides bundled fonts + returns PDF bytes. It knows nothing about résumés.

**Security seam preserved.** The renderer may supply `.typ` *content* (it is the user's own document, analogous to supplying HTML to the capture path today), but the **save path always comes from the server-side `PendingPdfPath` slot** that `pick_pdf_save_path` fills — `typst_export_pdf` consumes it, mirroring `capture_pdf_from_window`. The renderer can never write to an arbitrary path.

---

## 4. The `model → .typ` generator

### 4.1 Module layout
New directory `resume-designer/src/typst/`:
- `generate.js` — `modelToTypst(model, opts) → string`; the depth-first walk + the core-3 layout templates + shared block helpers.
- `theme.js` — the **theme bridge**: reads the global design services and returns a normalized `theme` object (resolved fonts, colors, sizes in absolute pt/in) the generator consumes.
- `escape.js` — `typstString(s)` (string-literal escaping) and any helpers.
- `palettes.js` — **extracted** from `main.js` (the 12 palettes), imported by both `main.js` and `theme.js` so there is one source of color truth.

`typstExport.js` (top level, §7) orchestrates generate → invoke → preview/save and is imported by the React dialog.

### 4.2 Reading-order walk = ATS correctness
`modelToTypst` walks the model depth-first and emits Typst markup **in model order**. For multi-column layouts (sidebar), the sidebar content is emitted **before** the main content in source order; Typst's grid positions them as two columns visually, but the PDF text stream follows source order. Phase-0 §1 confirmed this end-to-end: a sidebar résumé extracted as `name → Skills → Tools → Summary → Experience`, the entire sidebar preceding the main column, never column-interleaved. **The on-screen sidebar defect is fixed by construction** because the source order is the model order.

### 4.3 User text → Typst (the robust escaping rule)
Do **not** emit user text as Typst markup (where `*`, `_`, `#`, `[`, leading `-`/`=`/`.` etc. have meaning). Emit it as **Typst string-literal interpolations inside content blocks**, which Typst renders literally with no markup parsing:

```
[#"Ada Lovelace"]                      // plain run
[#strong[#"Senior Engineer"]]          // bold run
[#emph[#"in situ"]]                    // italic run
[#underline[#"Lead"]]                  // underline run
[#strong[#emph[#"both"]]]              // nested marks (model run carrying bold+italic)
[#"Built " #strong[#"X"] #" and Y"]    // a paragraph = sequence of marked runs
```

`typstString(s)` therefore only needs to escape the **string-literal** specials — `\` → `\\`, `"` → `\"`, and control characters (newline → space or `\n`) — **not** the full markup-special set. This is dramatically more robust than enumerating markup specials, and it makes user content injection-safe by construction. It also satisfies the Phase-2 carry-over for **nested-mark edge cases**: a run whose text still contains literal markers (e.g. `_x_`, the rare `**_x_**` case) is shown verbatim because it is inside a string literal — "does not choke."

A run's marks are read from the model text node's mark set and wrapped innermost-to-outermost; the active mark set is `bold → #strong`, `italic → #emph`, `underline → #underline`, `link → #link("href")[…]`.

### 4.4 Block mappings
| Model node | Typst |
|---|---|
| `header` (name / tagline / contactList) | display-font name (large), tagline, ` • `-joined contact items |
| `section` + `heading` | section heading in the display font with an accent rule (from `accentService` underline style/width) |
| `paragraph` | a sequence of marked runs (§4.3) |
| `bulletList` / `listItem` | `#list(...)` using the accent **bullet char** (`accentService.bulletStyle`) |
| `experienceItem` | bold `jobTitle` + `company` + `dates` (muted) + nested `#list` bullets |
| `educationItem` | one block; institution / degree / dates |
| `tagGroup` / `tag` (skills, tools) | a flowed inline run of tags, styled per `accentService.skillTagStyle` (filled / outlined / minimal / plain) |

### 4.5 Core-3 layout templates
- **`stacked` / `classic`** — single column. `#set page(...)`, then header, then sections top-to-bottom. The simplest and the safest pagination behavior.
- **`sidebar`** — `#grid(columns: (theme.sidebarWidth, 1fr), column-gutter: …, sidebarCell, mainCell)`. The sidebar cell carries a fill (`palette.sidebarBg`) and the sidebar sections; the main cell carries the rest. **Source order: sidebar cell content first, then main cell** → reading order correct. The gradient header (`palette.headerBg → headerBgEnd`) renders as a full-width `#block(fill: gradient.linear(...))` above the grid.

Each template is a function `(model, theme) → string` over shared helpers (`renderHeader`, `renderSection`, `renderExperience`, `renderTags`, `renderRuns`). Adding a layout later = one new template function + its golden/ATS test.

### 4.6 The theme bridge (`theme.js`)
Resolves the global design services into absolute Typst values so the generator emits concrete sizes (Typst has no CSS cascade):

| Source service / key | Resolves to |
|---|---|
| `fontService` pairing → `display.family`, `body.family` | `#set text(font: …)`; headings use display, body uses body |
| `palettes.js[colorPalette]` (or `customColor`) → `accent`, `accentLight`, `headerBg`, `headerBgEnd`, `sidebarBg` | accent fill, header gradient stops, sidebar fill |
| `resume.css` base tokens | text `#2d2a26`, muted `#6b6560`, border `#e8e4df` |
| `spacingService` → `pageMargins`, `sectionSpacing`, `sidebarWidth`, `fontScale`, `lineHeight` | page margins (in); section gap (rem→pt); sidebar width (in); base size = `9pt × fontScale`; `#set par(leading: …)` from lineHeight |
| `accentService` → `bulletStyle`, `underlineStyle`, `underlineWidth`, `skillTagStyle` | bullet char, heading rule style/width, tag styling |

**Size resolution.** `resume.css` mixes `pt` and `rem` (e.g. base `9pt`, name `2.25rem`). The bridge resolves every size to absolute `pt` (rem against the document root font-size, `pt` directly), applies `fontScale`, and the exact size constants are lifted from `styles/resume.css` during PR 3.2 — a mechanical extraction, enumerated in that plan.

### 4.7 Page size → `#set page(...)`
| `pageSize` | Typst |
|---|---|
| `auto` | `#set page(width: 8.5in, height: auto, margin: …)` — open-ended single page (today's behavior; Phase-0 §4) |
| `letter` | `#set page(paper: "us-letter", margin: …)` → real pagination |
| `a4` | `#set page(paper: "a4", margin: …)` |
| `legal` | `#set page(paper: "us-legal", margin: …)` |

Margins come from `spacingService.pageMargins`. Fixed sizes flow content across pages automatically (Phase-0 §4: Letter + long content → 6 pages).

### 4.8 Concrete sketch (illustrative — finalized in the PR 3.2 plan)
```typst
#set page(paper: "us-letter", margin: (top: 0.5in, bottom: 0.5in, left: 0.5in, right: 0.5in))
#set text(font: "DM Sans", size: 9pt, fill: rgb("#2d2a26"))
#set par(leading: 0.45em)
#let accent = rgb("#c45c3e")

#block(width: 100%, fill: gradient.linear(rgb("#2d2a26"), rgb("#3d3832")), inset: 16pt)[
  #text(font: "Cormorant Garamond", size: 27pt, fill: white)[#"Ada Lovelace"]
  #text(fill: white)[#"Mathematician • Writer"]
]

#grid(columns: (2.4in, 1fr), column-gutter: 16pt,
  block(fill: rgb("#f4e8e4"), inset: 12pt)[
    #text(font: "Cormorant Garamond", weight: "bold")[#"Skills"]
    #list(marker: [•], [#"Analytical Engine"], [#"Mathematics"])
  ],
  block(inset: 12pt)[
    #text(font: "Cormorant Garamond", weight: "bold")[#"Summary"]
    [#"First programmer. " #strong[#"Visionary"] #"."]
  ]
)
```

---

## 5. Page size: model change + migration

### 5.1 Model (`documentModel.js`)
Add `pageSize` to the `doc` node attrs, default `'auto'`:
```js
doc: {
  content: 'header section*',
  attrs: {
    schemaVersion: { default: SCHEMA_VERSION },
    docType: { default: 'resume' },
    toolsDisplay: { default: '' },
    pageSize: { default: 'auto' },   // 'auto' | 'letter' | 'a4' | 'legal'
  },
},
```
**No `SCHEMA_VERSION` bump.** Adding an attr with a default is backward-compatible: old model JSON (and old history snapshots) without `pageSize` parse to the default `'auto'`. This is the same backward-compatible pattern PR 2.1 used for `toolsDisplay` and `relevanceRank`.

### 5.2 Flat interchange + migration (`migrateToModel.js`)
- `FLAT_DEFAULTS` gains `pageSize: 'auto'`.
- `flatToModel` sets `doc.attrs.pageSize = data.pageSize ?? 'auto'`.
- `modelToFlat` writes `pageSize` back into the flat object, so it **persists per variant** (variant.data stays flat — the PR 2.2 contract). The flat shape gains one additive field; the 6 golden round-trips stay byte-for-byte (they have no `pageSize`, so they round-trip through the default).

### 5.3 Store + global default
- `store.js`: a `getPageSize()` / `setPageSize(value)` pair — thin wrappers over the existing `get('pageSize')` / `update('pageSize', value)`, which already round-trip flat⇄model once §5.2 adds the field. So the value flows to persisted flat data + history snapshots with no new bespoke write path; `setPageSize` pushes a history snapshot like any other edit.
- `persistence.js` settings: a new global **`defaultPageSize: 'auto'`** applied to *new* documents. Existing documents read `auto` until changed (so behavior is unchanged on upgrade — nothing to actively migrate).

---

## 6. Rust Typst compile commands

### 6.1 Dependencies (`src-tauri/Cargo.toml`)
Add (desktop targets): `typst-as-lib = "0.15.5"`, `typst-pdf = "0.14.2"` (transitively `typst 0.14.2`, matching the installed CLI — Phase-0 verified a single-version lockfile). Budget ~35–40 MB binary growth for Typst + the first font (Phase-0 measured 38 MB), plus fonts (§9).

### 6.2 Commands (`src-tauri/src/commands/typst.rs`, registered in `lib.rs`)
```rust
// Compile .typ → PDF bytes, returned to the renderer for PDF.js preview.
#[tauri::command]
async fn typst_render_preview(typ: String) -> Result<tauri::ipc::Response, String>;

// Compile .typ → PDF, write to the path stashed by pick_pdf_save_path.
// Mirrors capture_pdf_from_window: path comes from PendingPdfPath, never the arg.
#[tauri::command]
async fn typst_export_pdf(typ: String, pending: State<'_, PendingPdfPath>) -> Result<PdfResult, String>;
```
- A shared `compile(typ) -> Result<Vec<u8>, String>` helper holds the `typst-as-lib` call. Per Phase-0: use `engine.compile()` (**not** `compile_with_input(())` — `()` is not `Into<Dict>`); supply fonts explicitly via `.fonts([...])`; the output infers as `PagedDocument`; then `typst_pdf::pdf(&doc, &PdfOptions::default())`.
- Preview returns raw bytes via `tauri::ipc::Response` (avoids a huge JSON number array); the renderer reads a `Uint8Array`.
- Export recompiles fresh (compile is ~14 ms — negligible vs. caching the preview bytes) and writes to the consumed slot path; reuses `pick_pdf_save_path` and the existing `PdfResult` shape.
- A Typst compile error returns a clear `Err`/`PdfResult::error` surfaced in the dialog.

---

## 7. Export / preview screen

Evolve `src/components/PdfDialog.jsx` from filename-only into the export screen described in the parent spec §7:
- **Filename** input (kept).
- **Page-size** selector (auto / Letter / A4 / Legal), initialized from `store.getPageSize()`; changing it writes back via `store.setPageSize(...)` and triggers a debounced recompile + preview.
- **Live PDF.js preview** pane rendering the compiled bytes (`pdfjs-dist`). Recompile on open and on page-size change.
- **Save** → `pick_pdf_save_path(filename)` then `typst_export_pdf({ typ })`.

`src/typstExport.js` orchestrates: `generatePreview(model, opts) → Uint8Array` and `exportToPath(model, opts) → PdfResult`, building `.typ` via `modelToTypst` and invoking the Rust commands. The React dialog imports `typstExport.js` + `store.js` directly (the same React↔vanilla bridge `pdf.js`/`diffView.js` already use). The `rd:open-pdf-dialog` bridge event is extended to carry whatever context the screen needs.

**PDF.js worker note:** `pdfjs-dist` needs its worker; wiring the worker under Vite/Tauri (e.g. `?url` import or `GlobalWorkerOptions.workerSrc`) is an integration detail flagged in §14.

---

## 8. Cutover & coexistence (no regression)

The Download button stays; its handler routes by layout:

```
layout ∈ {sidebar, stacked, classic}  →  Typst export screen (real page sizes)
layout ∈ the other 8                   →  today's WKWebView/WebView2 capture (one long page, as now)
browser build (no Tauri)               →  html2pdf fallback (as now)
```

So page sizes ship for the three most common layouts (including the default `sidebar`) **without regressing any layout's export**. The legacy capture path is **not** deleted — it is the fallback for un-ported layouts; each later PR (3.5+) lights up more layouts; a final cleanup removes the capture path only once all 11 are ported. This is the parent spec §7's "old path can remain briefly behind a flag during migration," made concrete as a per-layout router.

---

## 9. Fonts & bundling

Typst needs the actual font files for the families the 10 pairings use (≈18 families: Cormorant Garamond, DM Sans, Inter, Playfair Display, Source Sans 3, IBM Plex Serif/Sans, Libre Baskerville, Karla, Oswald, Roboto, Merriweather, Open Sans, Raleway, Lato, Lora, Nunito Sans, Poppins, Work Sans). All are OFL/Apache (open, redistributable) Google Fonts.

**Bundle all pairing fonts up front** (regular + bold + italic at minimum). Rationale: **font coverage is independent of layout coverage** — a user can pick any pairing with the core-3 layouts, so if a selected pairing's font is missing, Typst substitutes and the PDF stops matching. Estimated budget ~10–12 MB of TTFs (≈18 families × ~3 weights × ~200 KB), on top of Phase-0's 38 MB. `typst-bake` (built on `typst-as-lib`) bakes the fonts into the binary for fully-offline compile — a good fit for this local-first app. The exact weights and the verification that each TTF's internal family name matches the string the generator emits (e.g. "Source Sans 3" vs "Source Sans Pro") are PR 3.3 tasks.

---

## 10. Fidelity strategy

Decision A is "match the design." Concretely, Typst reproduces, from the same tokens the CSS uses: fonts, base + heading sizes (scaled by `fontScale`), accent color + the gradient header + colored sidebar, section heading rules, bullet characters, tag styling, margins, and section spacing. The residual that is **accepted** (parent spec §9): fine line-breaking / justification differs between the browser and Typst, so wrap points and exact vertical rhythm will differ slightly. The export/preview screen is the source of truth for "what you'll get." For résumé content (headings, bullets, short text blocks) the structural match is close; we do not chase byte-identical line breaks.

---

## 11. Testing

- **Unit (vitest):**
  - `modelToTypst` **snapshot** per core-3 layout (snapshot the `.typ` markup).
  - `typstString` escaping — quotes, backslashes, control chars, and that markup specials (`#`, `*`, `_`, `[`, `C++`, `$`) pass through literally.
  - marks → `#strong`/`#emph`/`#underline`, including nested and the literal-marker edge case.
  - `tagGroup` → tag run; `bulletList` → `#list`; `experienceItem` shape.
  - `pageSize` → `#set page(...)` for all four values.
  - the theme bridge: services → resolved `theme` object.
- **ATS reading-order (the guarantee — parent spec §13):** for each ported layout, generate `.typ`, compile via the **pinned typst CLI (0.14.2)**, extract text with `pdfjs-dist`, and assert the extracted token order equals the model's serialized reading order with nothing dropped/garbled. Runs locally when typst is present; **a CI step installs the pinned typst CLI** so it runs in CI too (§14).
- **Rust:** a `cargo test` that compiles a fixture `.typ` via `typst-as-lib` → non-empty PDF bytes (no CLI needed; exercises the real in-app path).
- **Regression:** load each existing variant → `modelToTypst` → compiles without error; the 6 golden flat⇄model round-trips stay byte-for-byte after the `pageSize` field is added.
- **Manual / Tauri-only:** visual parity review of the core-3 on macOS + Windows; confirm un-ported layouts still export via capture; updater / window-drag / disk-storage unaffected.

---

## 12. PR decomposition (subagent-driven — the 2.x rhythm)

Each PR is independently testable, leaves the app runnable, and is gated by spec-compliance + code-quality review per task (the cadence used for PRs 2.1–2.3).

| PR | Title | Files (primary) | Behavioral? |
|----|-------|-----------------|-------------|
| **3.1** | `pageSize` on the model + flat migration + global default | `documentModel.js`, `migrateToModel.js`, `store.js`, `persistence.js` + tests | No — round-trips stay green |
| **3.2** | `model → .typ` generator + theme bridge + `escape` + `palettes.js` (core-3) | `src/typst/{generate,theme,escape,palettes}.js`, `main.js` (import extracted palettes) + vitest + ATS test | No — no app wiring |
| **3.3** | Rust Typst compile commands + bundled fonts | `src-tauri/Cargo.toml`, `src-tauri/src/commands/typst.rs`, `lib.rs`, bundled font assets | Backend only |
| **3.4** | Export/preview screen + wire-up + per-layout router | `PdfDialog.jsx`, `typstExport.js`, `pdf.js` (router) | **Yes — page sizes ship for core-3** |

Later: **3.5+** port the remaining 8 layouts (one or a few per PR, each with golden + ATS tests); a final **cleanup** removes the legacy capture path once all 11 are ported and moves layout/palette/fonts per-document if desired (parent spec Phase 4/5).

---

## 13. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Typst output drifts from the on-screen look for rich layouts | High | Decision B (core-3 first); shared theme tokens; export screen is the source of truth; per-layout fallback to the pixel-perfect capture for un-ported layouts. |
| Re-authoring 11 layouts is large | High | Staged — core-3 now, expand later; shared block helpers; one template fn + tests per added layout. |
| Font family-name mismatch (TTF name vs emitted string) → substitution | Med | PR 3.3 verifies each bundled TTF's internal family name against the generator's string; bundle all pairing fonts up front. |
| Binary-size growth (Typst + ~18 font families) | Med | Budget ~50 MB total; subset/trim weights later if needed; OFL fonts are redistributable. |
| User text breaking Typst compilation / injection | Med | String-literal emission (§4.3) renders user text literally; `typstString` escapes only `\` and `"`. |
| ATS test needs typst in CI | Low | Add a CI step to install the pinned CLI; the test self-skips locally when absent. |
| PDF.js worker under Vite/Tauri | Low | Standard `workerSrc`/`?url` wiring; isolated to PR 3.4. |

---

## 14. Open questions (resolve during planning)

1. **Exact font weights** to bundle per family (regular/bold/italic vs more) — balances fidelity vs binary size (PR 3.3).
2. **CI typst install** mechanism (cache the pinned 0.14.2 binary in the test workflow) and whether the ATS test is a vitest test shelling the CLI or a separate job (PR 3.2).
3. **PDF.js worker bundling** under Vite in the Tauri renderer — `?url` import vs copying the worker asset (PR 3.4).
4. **Recompile cadence** in the preview — debounce interval on page-size change; whether to also recompile on underlying model edits while the dialog is open (probably not — the dialog opens on the current model snapshot).
5. **`customColor`** handling parity — confirm the generator reads `customColor` when `colorPalette === 'custom'`, matching `main.js`.

---

## 15. Success criteria

- Existing résumés export to PDF via Typst for the core-3 layouts, with **real selectable text whose extraction order equals the model's reading order** — verified in CI.
- **Page size is selectable** (auto / Letter / A4 / Legal), persists per document, defaults from a global setting, and **paginates correctly** for fixed sizes.
- The exported PDF **visually matches the on-screen design** for the core-3 (residual line-wrap aside).
- **No regression:** un-ported layouts still export (via capture); the 6 golden round-trips stay green; persistence/migration, AI generation, updater, window-drag, and disk storage are unaffected.
