# Structured Document Model + Typst Export — Design Spec

**Date:** 2026-06-14
**Status:** Draft — awaiting review
**Author:** Ash (with Claude)
**Supersedes/relates to:** the vanilla `renderer.js` document model, `inlineEditor.js`, and the WKWebView/WebView2 PDF capture pipeline.

---

## 1. Context & motivation

### The trigger
The immediate ask was small: *let users set a résumé's page size* (Letter / A4 / …), with an open-ended "as tall as it needs to be" option, applied to existing and future résumés.

### Why it isn't small
Investigation of the current renderer/PDF/data layers showed there is **no concept of a page anywhere** in the app:

- The résumé is a single flowing HTML column — `.resume { width: 8.5in; min-height: 11in }` with *unbounded* height (`styles/resume.css`). It grows as tall as its content; the outer `.resume-scroller` scrolls.
- The data model (`store.js` `EMPTY_RESUME`) is flat (`name`, `tagline`, `contact`, `summary`, `sections[]`, `experience[]`, `education[]`, `tools`) with **zero** page/pagination fields.
- PDF export (`pdf.js` → `printEntry.js` → `pdf_macos.rs` / `pdf_windows.rs`) measures the rendered element's bounding box and emits a PDF *of exactly that size* — macOS captures one tall page; Windows paginates via WebView2.
- Design choices (layout, color, fonts) are **global** (`persistence.js settings`); only content is per-variant.

So "open-ended" is the *only* mode that exists, and **a fixed page size implies pagination** — content that overflows one page must flow to the next. There is no pagination layer today. The feature is therefore really a pagination/document-model question.

### The architecture finding
A landscape review (Canva/Figma/Miro/Google Docs + HTML-paged tooling) concluded:

- The product's differentiator is **ATS-friendly, selectable, parseable text.** Canvas/WebGL substrates (Figma, Miro, Docs-since-2021) turn text into pixels and force a parallel accessibility/structure layer — the wrong trade for a résumé. **We keep HTML/DOM and do *not* rewrite to canvas.**
- The current HTML implementation *under-uses* the substrate: it lacks (a) a structured document model and (b) a controlled, model-driven export. Those — not canvas — are the worthwhile evolution.

### A concrete defect this fixes
In sidebar layouts (`renderer.js` `renderResume`), the DOM order is `header → entire sidebar → entire main`, positioned visually as two columns by CSS grid (`grid-template-columns: 2.4in 1fr`). Text selection — and the exported PDF's text stream — follow **DOM order**, not the visual columns. Today that order is *coincidentally* coherent (sidebar block, then main block), but it's an implicit invariant: any future layout using absolute positioning or CSS `order` would silently scramble the reading order an ATS sees. Making reading order an **owned property of a document model** turns that gamble into a guarantee.

### Future intent
The user wants to expand **beyond résumés** (cover letters, portfolio one-pagers, bios). A generic, schema-constrained document model supports multiple document *types* over one engine; "résumé" becomes one schema among several.

---

## 2. Locked decisions (from brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Strategy | **Structured-model-first** (the most foundational option) | Build the foundation, land page-size as the payoff. |
| Document model | **Generic block tree** with a constraining schema | Supports multiple doc types; ATS structure re-imposed via schema. |
| Editor engine | **TipTap** (ProseMirror schema) | Best schema system for "one engine, several document schemas"; React-friendly; real DOM → selectable text. |
| Export engine | **Typst** (model → Typst → PDF) | Rust-native (embeds in Tauri), fast incremental compile (~30–50 ms), real text in canonical order, true page sizes + pagination. |
| Edit surface | **Inline editing preserved** (TipTap on the HTML projection) | The signature UX. Editing mutates the model; it is *not* done on the Typst render. |
| Fidelity / export UX | **On-demand Typst PDF preview/export screen** | Faithful "what you get" surface with options (filename, page size) + Save/Export; relaxes HTML↔Typst drift. |
| Substrate | **Stay HTML/DOM** — explicitly **not** canvas/WebGL | Preserves ATS-parseable, selectable text. |

**Explicitly rejected:** editing *on* the Typst render (would require rebuilding caret/selection/IME/a11y on static output — the Figma/Docs "build your own text engine" cost, for fidelity the export screen already provides).

---

## 3. Goals & non-goals

### Goals
1. A **canonical, ordered document model** (JSON) as the single source of truth, with reading order = tree order.
2. **Preserve inline WYSIWYG editing** (click text on the document, edit in place).
3. **Model-driven Typst PDF export** producing real selectable text in canonical reading order — provably ATS-parseable.
4. A **page-size feature**: `auto` (open-ended) / Letter / A4 / Legal, applied to existing and future documents, with real pagination for fixed sizes.
5. A **dedicated export/preview screen** (faithful Typst preview + filename + page size + Save/Export).
6. **Multi-document-type readiness** (résumé = one schema; structure generalizes).
7. **No regression** in the fragile flows: persistence/migration, AI generation, updater, window drag, the disk-storage facade.

### Non-goals (this spec)
- No canvas/WebGL rewrite.
- No change to the chrome (header/panels/chat/settings) beyond what the new editor + export screen require.
- No new cloud/server dependency (Typst runs locally).
- Cover-letter / other doc types are *readiness only* here, not full implementations.
- The Tauri updater, signing, and release pipeline are untouched.

---

## 4. Architecture

Four layers, one source of truth:

```
                       ┌─────────────────────────────┐
   edits ──────────────▶  DOCUMENT MODEL (JSON AST)   │  ← single source of truth
                       │  ordered tree; reading order │     (persisted per variant)
                       │  = tree order; schema-bound  │
                       └──────────────┬──────────────┘
                          ┌───────────┴────────────┐
                          ▼                        ▼
            ┌──────────────────────┐   ┌─────────────────────────┐
            │  HTML PROJECTION      │   │  TYPST GENERATOR         │
            │  (TipTap editor)      │   │  model → .typ markup     │
            │  • inline editing     │   │           │             │
            │  • on-screen preview  │   │           ▼             │
            │  • layout via CSS     │   │   Typst compile → PDF    │
            │    (DOM order=model)  │   │   (real text, ordered,   │
            └──────────────────────┘   │    paged) → preview/save │
                                       └─────────────────────────┘
```

- **Document model** — a ProseMirror/TipTap document (JSON). A `Document` carries `docType`, `schemaVersion`, `pageSize`, design refs, and a `content` tree of typed nodes. **Reading order is depth-first tree order**, independent of visual layout.
- **HTML projection (TipTap)** — renders the model as editable HTML. This is both the **inline-edit surface** and the **on-screen preview**. Visual layouts (sidebar, stacked, …) are applied with **CSS only**; the DOM/content order always equals model order, so even the HTML preview has correct reading order. Fixes the sidebar defect by construction.
- **Typst generator** — pure function `model → Typst markup`, applying the chosen layout template + page size + theme tokens. Typst compiles to PDF with real selectable text emitted in model order.
- **Export/preview screen** — invokes the generator on demand, shows the compiled PDF, exposes filename + page size + format, and saves.

### Separation of content and layout (the keystone)
Content order (the tree) is the ATS truth and never changes with layout. Layout (sidebar vs stacked vs …) is a **projection choice** stored in design settings, consumed by both the CSS projection and the Typst template. Changing layout re-positions pixels; it never reorders content.

### Data flow
1. User edits → TipTap mutates the model → model persisted (debounced) via the existing store/`appStorage` facade.
2. On-screen preview = TipTap's rendered HTML (live).
3. User opens the export screen → generator builds `.typ` from the current model + page size → Typst compiles → PDF shown → user saves.

---

## 5. The document model

### Shape (illustrative — finalized in the implementation plan)
```jsonc
{
  "docType": "resume",          // future: "cover-letter", "one-pager"
  "schemaVersion": 1,
  "pageSize": "auto",           // "auto" | "letter" | "a4" | "legal"
  "layout": "sidebar",          // projection choice (was a global setting)
  "content": [                  // ordered tree — reading order = this order
    { "type": "header", "content": [
      { "type": "name", "content": [{ "type": "text", "text": "Ada Lovelace" }] },
      { "type": "tagline", "content": [/* inline */] },
      { "type": "contactList", "content": [ { "type": "contactItem", "kind": "email", ... } ] }
    ]},
    { "type": "section", "sectionKind": "summary",   "content": [ { "type": "heading", ... }, { "type": "paragraph", ... } ] },
    { "type": "section", "sectionKind": "experience","content": [ { "type": "heading", ... },
      { "type": "experienceItem", "content": [ /* title, company, dates, bulletList */ ] } ] },
    { "type": "section", "sectionKind": "skills",    "content": [ /* list or tag group */ ] }
  ]
}
```

- **Block nodes:** `header`, `section` (typed via `sectionKind`), `heading`, `paragraph`, `bulletList`/`listItem`, `experienceItem`, `educationItem`, `contactList`/`contactItem`, `tagGroup`/`tag` (skills/tools), `customSection`.
- **Inline marks:** `bold`, `italic`, `underline`, `link` — replacing the current `**bold**`-in-string convention with a structured rich-text model (resolves the markdown-in-string emphasis work).
- **Schema constraints (the ATS guardrails):** a `resume` document = one `header` + an ordered list of `section`s; each `sectionKind` permits specific child node types. This is ProseMirror's content-expression system — it *prevents* an arbitrary free-for-all that would break ATS structure.

### Why generic-but-constrained
The node set is generic enough to compose other document types later (a `cover-letter` schema reuses `paragraph`, `header`, marks), but each `docType` has a schema that enforces its structure.

---

## 6. The editor (TipTap)

- Define a TipTap/ProseMirror **schema** mirroring the model.
- TipTap renders the model to editable HTML — the inline-edit surface. This **replaces `inlineEditor.js`** and its `data-editable` path-mapping; node identity + transactions replace string-path mutation.
- **Inline-edit UX preserved:** click text → edit in place; the affordances users rely on (per-field editing, add/remove list items, reorder) map to ProseMirror transactions. The current single-click-to-edit and drag-reorder behaviors are re-expressed as editor commands/node views.
- **Layouts become CSS projections:** the 11 current layouts (`renderResume*` in `renderer.js`) are re-expressed as CSS over the TipTap-rendered DOM (e.g., grid placement for sidebar) — **without reordering the DOM**, so reading order stays = model order.
- **AI generation** targets the model: `aiService.js` schemas/prompts emit the document model (or a normalized intermediate) instead of the flat `data` shape.

---

## 7. The export pipeline (Typst)

- **Generator:** pure `model → .typ` transform, parameterized by layout template, page size, and theme tokens (fonts, colors, spacing) shared with the CSS projection.
- **Compilation:** Typst is Rust-native; **lean toward compiling in the Tauri Rust backend** (a `typst` crate dependency) rather than bundling the ~22 MB WASM build — it reuses the existing Rust process that already owns PDF/save commands (`commands/`). WASM (`typst.ts`) remains a fallback for the browser build. *(Final embedding decision: a Phase-0 spike.)*
- **Fonts:** embed the same font files the CSS projection loads, so HTML preview and Typst output share metrics.
- **Output:** real selectable text, embedded fonts, **emitted in model (reading) order**, with true page sizes and pagination.
- **Export/preview screen:** evolve the existing React `PdfDialog` (currently filename-only) into a screen that renders the compiled PDF (PDF.js viewer or Typst→SVG preview), exposes **filename + page size + format**, and saves via the existing `pick_pdf_save_path` + a write-file command. This **replaces the WKWebView/WebView2 capture path** for the primary export (the old path can remain briefly behind a flag during migration).

### ATS guarantee, made testable
Because reading order = model order and Typst emits text in that order, the exported PDF's text stream is the document's logical order. This is **automatically verifiable**: extract text from a generated PDF and assert it equals the model's serialized reading order (see Testing).

---

## 8. The page-size feature (the original ask)

- `pageSize` is a **document property** (persisted per variant), not a global-only setting:
  - `auto` — open-ended single page that grows (today's behavior; Typst custom page height).
  - `letter` / `a4` / `legal` — fixed pages with **real pagination** (Typst flows content across pages).
- A **global default** lives in `settings` (applies to *future* documents); each document can override. Migration sets existing documents to the default (`auto`, preserving current behavior) until changed.
- Surfaced in the **export/preview screen** (and optionally the design panel), with the live Typst preview reflecting the choice — so "set the page size" shows its true paginated result immediately.

---

## 9. Fidelity strategy (HTML preview ↔ Typst PDF)

The HTML projection and Typst are different layout engines, so fine line-breaking/justification will differ. We narrow the gap and make truth explicit:

1. **One shared layout spec** drives both the CSS projection and the Typst template (fonts, sizes, line-height, margins, spacing, colors as shared tokens).
2. **Same embedded fonts at matching metrics.**
3. **On-demand "true preview"** — the export screen *is* the source of truth; optionally a quick inline toggle to the live Typst render (fast via incremental compile).
4. **Accept the residual** (minor wrap differences). For résumé content (headings, bullets, text blocks) structure/fonts/spacing match closely.

---

## 10. Migration & coexistence

- **Big-bang on one branch, internally sequenced so the app stays runnable at every gate** (the playbook that worked for the React-chrome migration).
- **Data migration:** a deterministic, versioned transform `flat data → document model` for every existing variant (mirrors the one-time Electron→disk migration pattern). No user data lost; reversible export/import retained.
- **Coexistence:** early phases keep the old renderer/editor/export working (rendering the model through a temporary HTML projection that matches today) until the TipTap editor and Typst export are ready to replace them.
- **AI flows:** `aiService.js` generation/tailoring schemas retargeted to the model.

---

## 11. Phased rollout (runnable at each gate)

Detailed task breakdown is for the implementation plan; phases here, with the page-size payoff explicit.

- **Phase 0 — Spikes / de-risking.** Prototype: (a) Typst rendering a résumé from a hand-authored model; (b) **ATS text-extraction check** on that PDF (selectable text, correct order); (c) a TipTap résumé schema; (d) Typst embedding decision (Rust crate vs WASM). *Gate:* end-to-end confidence on a toy before committing.
- **Phase 1 — Model + schema + migration (no visible change).** Define the model, TipTap schema, `flat→model` migration, persistence. *Gate:* existing résumés load as models and render via a model-driven HTML projection matching today.
- **Phase 2 — TipTap inline editor.** Replace `inlineEditor.js`; preserve inline-edit UX; 11 layouts as CSS projections (reading order = model order). *Gate:* editing + all layouts work; reading order correct in the DOM.
- **Phase 3 — Typst export + export/preview screen.** Generator, export screen, replace WKWebView capture. *Gate:* PDF export via Typst; ATS extraction test passes; visual parity acceptable.
- **Phase 4 — Page-size feature.** `pageSize` property + UI + real pagination. *Gate:* **the original feature ships** — page sizes apply to existing + future docs, with correct pagination.
- **Phase 5 — Cleanup + fragile-flow verification.** Delete old `renderer.js`/`inlineEditor.js`/legacy PDF path; full verification sweep.
- **Phase 6 (future, optional) — Multi-doc-type.** Generalize schema for cover-letter / one-pager.

Each phase is expected to be its own implementation plan / PR (as the React migration was).

---

## 12. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Scope / time** — multi-week, touches the 3 fragile flows | High | Phased, runnable gates; Phase 0 spike; each phase shippable. |
| **Re-authoring 11 layouts in Typst** (and as CSS projections) | High | Start with a core subset (e.g., sidebar + stacked + classic); expand over time; shared layout spec reduces duplication. |
| **Inline-editor rewrite** to TipTap loses an affordance | High | Inventory every current `inlineEditor.js` behavior; map each to an editor command/node view; regression-test. |
| **HTML↔Typst drift** | Med | Shared layout spec + same fonts; export screen is source of truth. |
| **Typst embedding / bundle size** | Med | Prefer Rust-native crate (no 22 MB WASM in bundle); decide in Phase 0. |
| **Migration data loss** | High | Versioned, deterministic transform; golden tests per layout/data; backup export retained; reversible. |
| **AI schema retargeting** regresses generation | Med | Update + test `aiService` schemas against the model; keep prompts' ATS guidance. |
| **ATS assumption wrong** for a layout | Med | Automated PDF text-extraction test asserts order == model order, per layout. |

---

## 13. Testing strategy

- **Unit:** schema validation; `flat→model` migration (golden tests per layout + per data shape); `model→.typ` generation (snapshot the markup); model reading-order serialization.
- **Integration:** TipTap edit → model transaction correctness; export screen → Typst compile → PDF.
- **ATS / reading-order (the key guarantee):** generate a PDF per layout, extract its text stream, assert it equals the model's serialized reading order and contains no dropped/garbled text. Runs in CI.
- **Regression:** load the existing variants through the new path; assert content parity; assert page-size pagination behavior.
- **Manual / Tauri-only:** PDF visual review on macOS + Windows; updater/window-drag unaffected; disk-storage round-trip.

---

## 14. Open questions (resolve during planning)

1. **Typst embedding:** Rust crate (preferred) vs WASM — confirm in Phase 0, including incremental-compile wiring for live preview.
2. **Layout coverage:** which of the 11 layouts ship in Phase 2/3 vs later.
3. **Export-screen preview tech:** PDF.js viewer vs Typst→SVG for the in-app preview.
4. **Design settings location:** `layout`/`pageSize` move from global `settings` into per-document model — confirm global-default + per-doc-override semantics and the migration of existing global design settings.
5. **Tag/PDF accessibility:** whether to emit tagged PDF (PDF/UA) now or later (Typst tagged-PDF support is maturing).
6. **Rich-text scope:** confirm the inline mark set (bold/italic/underline/link) and whether links are exposed in the résumé UI.

---

## 15. Success criteria

- Existing résumés migrate losslessly and render identically (or better) through the model.
- Inline editing feels equivalent to today.
- Exported PDFs contain real, selectable text whose extraction order equals the document's reading order — verified in CI, across layouts.
- Page size is selectable (`auto`/Letter/A4/Legal), applies to existing + future documents, and paginates correctly.
- No regression to persistence/migration, AI generation, updater, window drag, or disk storage.
