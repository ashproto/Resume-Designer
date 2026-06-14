# Document Model — Phase 2: Model-Native Editor — Design Spec

**Date:** 2026-06-14
**Status:** Draft — awaiting review
**Author:** Ash (with Claude)
**Parent spec:** [`2026-06-14-structured-document-model-design.md`](2026-06-14-structured-document-model-design.md) (§11 Phase 2)
**Builds on:** Phase 0 (spikes, all GO — [`2026-06-14-phase-0-findings.md`](2026-06-14-phase-0-findings.md)) and Phase 1 (`src/documentModel.js` schema + `src/migrateToModel.js` lossless `flat⇄model` migration, 76 vitest tests green, dormant in production).

---

## 1. Context — where Phase 2 sits

Phases 0 and 1 built and validated the foundation **without changing app behavior**: a ProseMirror résumé schema and a lossless, versioned `flat ⇄ model` migration exist in `src/documentModel.js` / `src/migrateToModel.js`, but **nothing in production imports them yet**. The flat `store.js` data + the 11 `renderer.js` string-builders + `inlineEditor.js` still run the app.

Phase 2 is the **editor cutover**: it makes the structured document model the application's single source of truth and replaces the vanilla render/edit path with a **TipTap** (ProseMirror) editor mounted on `#resume`. After Phase 2, editing mutates the model directly; the model is what persists, what AI targets, and what the (future) Typst exporter will consume.

Phase 2 is deliberately scoped to the **editor and model plumbing**. The Typst PDF export (Phase 3), the page-size feature (Phase 4), and per-document design settings stay out (see §10).

This is the largest phase in the project. It is sequenced into five PRs (§11), each leaving the app fully runnable.

---

## 2. Locked decisions (this phase)

Four pillars were chosen explicitly during the Phase 2 design pass; the rest are derived defaults stated here so the implementation plan can rely on them.

| # | Decision | Choice | Rationale |
|---|---|---|---|
| 1 | Source of truth | **The model becomes the store's truth** | The whole point of the refactor; everything downstream (persist, AI, export) reads the model. |
| 2 | Undo/redo + version history | **Model snapshots** (keep today's mechanism, snapshot model JSON) | Preserves undo/redo, the labeled History panel, restore-to-any-point, and cross-reload persistence with zero feature regression. **We do not install ProseMirror's history plugin.** *(This revises the earlier "retire store.js history" note — that would have been a regression.)* |
| 3 | Structural editing | **Both surfaces** — StructurePanel retargeted to node-ops **and** in-document Notion-style editing | The most complete option; one node-op API underneath both. |
| 4 | Layout coverage vs cutover | **All 11 layouts ported before the old renderer is removed** | No layout regresses when the new path goes live. |

Derived defaults (not separately chosen, stated for the plan):

- **Store shape:** `store.js` becomes a *facade* over a ProseMirror document; the canonical write interface is a **node-operation API**. `getData()` is preserved as a `modelToFlat(model)` read-bridge so export/import/Markdown keep working.
- **Persistence:** `variant.data` becomes the model JSON (carrying `schemaVersion`). Loading a still-flat variant runs a one-time `flatToModel` **adoption-migration** that persists the model back.
- **AI:** `aiService.js` keeps emitting flat JSON; it is converted with `flatToModel()` on apply. No AI-schema rewrite this phase.
- **Layout/page-size:** remain **global `settings`** for Phase 2 (moved per-document in Phase 4). The projection reads `currentLayout` exactly as today.
- **Inline editing** becomes **always-on rich text** (ProseMirror-native), replacing the click-into-a-field modal model — see §8.

---

## 3. Goals & non-goals

### Goals
1. The document model is the **single source of truth** in `store.js`, persisted per variant.
2. **TipTap owns `#resume`** — one canonical, model-ordered DOM, replacing `renderer.js`'s 11 string-builders and the per-change full-DOM string rebuild.
3. **Inline WYSIWYG editing preserved** (now ProseMirror-native), replacing `inlineEditor.js`.
4. **All 11 layouts** re-expressed as CSS projections (+ node-views where needed) over the canonical DOM, with **reading order = model order** (ATS-correct by construction, fixing the sidebar text-selection defect).
5. **Structural editing from both** StructurePanel and the document itself, via one node-op API.
6. Undo/redo, the History panel, and the backup envelope **keep working** (model snapshots).
7. **No regression** in the fragile flows: persistence/migration, AI generation, updater, window drag, disk-storage facade.

### Non-goals (this phase)
- No Typst export (Phase 3); no page-size feature (Phase 4).
- No move of `layout`/page-size from global settings to the per-document model (Phase 4).
- No AI-schema rewrite (AI stays flat → `flatToModel`).
- No new document types (`docType` stays `"resume"`).
- No canvas/WebGL; no chrome redesign beyond what the editor + structural affordances require.

---

## 4. Architecture

```
            node operations (canonical writes)
   edits ───────────────────────────────────────────┐
   (TipTap + StructurePanel + AI + in-doc affordances)│
                                                      ▼
                          ┌───────────────────────────────────────────┐
                          │  store.js  (FACADE)                         │
                          │  truth = ProseMirror doc (model JSON)       │
                          │  • node-op API (insert/remove/move/setAttr) │
                          │  • model-snapshot history (undo/redo/panel) │
                          │  • getData() = modelToFlat(model)  [bridge] │
                          │  • debounced persist  → variant.data = model│
                          └───────────────┬─────────────────┬──────────┘
                            getModel()/subscribe             getData() (flat bridge)
                                          ▼                  ▼
                          ┌───────────────────────┐   ┌──────────────────────────┐
                          │  TipTap EDITOR (#resume)│   │  export / import / md     │
                          │  • canonical DOM        │   │  (modelToFlat / flatToModel)│
                          │  • inline editing       │   └──────────────────────────┘
                          │  • layout = CSS class   │
                          │    (DOM order = model)  │
                          └───────────────────────┘
```

- **`store.js` facade** holds the ProseMirror document as truth. Writers call node operations; the facade applies transactions, snapshots history, emits change events, and debounce-persists the model JSON.
- **TipTap editor** subscribes, renders the canonical DOM into `#resume`, and is the inline-edit surface. Layout is a CSS class on the editor root; changing layout is a **class swap, not a re-render**.
- **Flat bridge** (`modelToFlat` / `flatToModel`) keeps export/import/Markdown/AI working without rewriting them this phase.

---

## 5. The document model (schema evolution)

Phase 1's schema cannot support inline editing: its `header` is an **atom** with `name`/`tagline`/`contact` as *attributes*, so those fields can't be edited as text, and its `parseDOM` can't recover the attrs from the DOM (the Phase-1 carry-over). Phase 2 grows the schema so **every visible field is an editable node**, matching the parent spec's §5 shape.

### Proposed node set (finalized in the PR 2.1 plan)
- **`doc`** — content `header section*`; attrs `{ schemaVersion, docType: "resume", toolsDisplay }`. (`toolsDisplay` stays a doc attr, as in Phase 1; `layout`/`pageSize` stay in global settings this phase.)
- **`header`** — content `name tagline contactList`; the fields below hold the data.
- **`name`**, **`tagline`** — single-line textblocks (`content: text*`).
- **`contactList`** — content `contactItem*`.
- **`contactItem`** — single-line textblock; attr `{ kind: "location"|"email"|"phone"|"portfolio"|"instagram"|… }` driving the projection's icon/label.
- **`section`** — content `heading block*` (a permissive union of `paragraph | bulletList | experienceItem | educationItem | tagGroup`); attrs `{ id, sectionKind: "summary"|"experience"|"education"|"skills"|"tools"|"custom", type }`. (`type` preserves the custom-section display type via the Phase-1 `''` sentinel; absence ≠ `'list'`.) `validateModel` enforces the `sectionKind → allowed children` constraints (ProseMirror content-expressions match node *types*, not attr values, so kind-specific rules live in the validator).
- **`heading`** — single-line textblock (section title, now editable).
- **`paragraph`** — textblock (summary, custom paragraphs).
- **`bulletList` / `listItem`** — `listItem+` / `paragraph` (as Phase 1).
- **`experienceItem`** — content `jobTitle company dates bulletList?`; attr `{ id }`. `jobTitle`/`company`/`dates` are single-line textblocks (editable; styled distinctly by the projection).
- **`educationItem`** — single-line textblock (or `text*`), one per entry.
- **`tagGroup` / `tag`** — `tag+` / single-line; for skills and tools. **This replaces the `inlineEditor.js` "shared `data-editable="tools"`, re-join siblings on save" hack** — each chip is a real node.

### Marks
`bold`, `italic`, **`underline`** (added — the renderer already supports `++underline++`), `link`. This is the structured replacement for the `**bold**`-in-string convention (resolves the markdown-in-string emphasis work).

### Migration
`src/migrateToModel.js` `flatToModel` / `modelToFlat` retarget to the richer schema. The **lossless round-trip** invariant and golden samples (POPULATED, SPARSE, EMPTY_RESUME, EMPHASIS, EMPTY_FIELDS, REAL_VARIANT) carry forward and are extended for the new nodes.

---

## 6. The store facade

`store.js` is rewritten so its truth is the ProseMirror document, while preserving the public surface its consumers depend on (`getData`, `subscribe`, variant load/save, History API, debounced save).

### Canonical write API — node operations
New methods that compile to ProseMirror transactions:
- `insertNode(targetRef, node, position)` — add a section / experienceItem / listItem / contactItem / tag.
- `removeNode(nodeRef)` — delete a block or item.
- `moveNode(nodeRef, toIndex)` — reorder (sections, experience, bullets, education, tags).
- `setNodeAttrs(nodeRef, attrs)` — e.g. section `sectionKind`/`type` toggle, `toolsDisplay`.
- `replaceText(nodeRef, text)` / mark commands — field edits and `bold`/`italic`/`underline`/`link`.

`nodeRef` is a stable reference (node `id` attr where present, else a resolved position). TipTap's own editing produces transactions directly; StructurePanel and AI go through these methods.

### Read bridge
- `getData()` returns `modelToFlat(model)` — so `exportAsJSON`, `exportAsMarkdown` (`generateMarkdown`), `importFromJSON`, and any remaining flat reader keep working unchanged.
- `getModel()` returns the current model JSON; `setModel(model)` replaces it (used by variant load + AI apply).

### History via model snapshots (no PM history plugin)
- Snapshot `doc.toJSON()` per **committed** edit. Text edits **coalesce on edit-settle** (debounced, matching today's blur-commit granularity); structural ops commit immediately. This reproduces today's history granularity (today, `store.update` fires once per `finishEditing`, not per keystroke).
- Preserves the entire existing surface: `undo`/`redo`, `canUndo`/`canRedo`, `getHistoryEntries` (labeled/timestamped/`changeType`), `getHistoryEntryData`, `restoreToEntry`, `clearHistory`, `MAX_HISTORY`, branching-on-new-edit.
- Persistence unchanged: history is stored per variant at `resume-designer-history-<id>` and is part of the backup envelope (`isOwnedKey` / `BACKUP_HISTORY_PREFIX`) exactly as today. Snapshots now contain model JSON instead of flat data.

### Persistence + adoption migration
- `variant.data` persists as the **flat interchange shape** (NOT model JSON). *(Revised during PR 2.2 review: `variantManager` export, `importFromJSON`, `generateMarkdown`, and `getVariantModel` read `variant.data` as flat directly, so a model-shaped `variant.data` breaks single-file export/import. The store hands `getData()` (flat) to the save callback; the model is the in-memory truth only — there is no on-disk adoption-migration.)* `saveVariant` / `initPersistence` / the debounced `onSave` path are otherwise unchanged.
- On variant load (`store.setData`/`setModel`), detect shape: a value without `schemaVersion`/`docType` is **flat** → run `flatToModel`, set the model, and **persist it back** (one-time adoption). A value already a model loads directly (validated by `validateModel`).
- Export/import: JSON/Markdown export serialize `modelToFlat(model)`; `importFromJSON` validates the flat shape then `flatToModel`s it. The backup envelope is unaffected (it round-trips raw storage strings).

### AI
`aiService.js` is unchanged (still emits flat JSON and `{ changes: { path: value } }`). The chat apply path (`useChat.js`) converts: whole-résumé generation → `flatToModel` → `setModel`; structured `changes` → resolved through the **flat-path resolver** (below) to node operations. ATS-guidance prompts are untouched.

### Flat-path resolver (compatibility bridge)
A utility mapping a flat path (`"experience[0].bullets[1]"`, `"sections[2].content[0]"`, `"summary"`, `"tools"`) to a model node/position, derived deterministically from the `flatToModel` structure (it is the inverse traversal `modelToFlat` already performs). Purpose:
1. Lets the **old** `inlineEditor.js` and `StructurePanel.jsx` keep writing during the cutover, so the truth-flip (PR 2.2) ships **without** also swapping the editor.
2. Backs the AI `{ changes: { path } }` apply path.

It is mostly retired once TipTap (PR 2.3) and node-op StructurePanel (PR 2.4) land; it survives only if a consumer still needs it (AI changes path).

---

## 7. The editor + render path (TipTap)

- TipTap's `EditorView` mounts into `#resume` (the skeleton element injected once by `appShell.html` via `App.jsx`). It renders **one canonical DOM** — `header` then `section`s in model order — replacing `renderCurrentResume()`'s `switch (currentLayout)` → HTML-string assignment to the `#resume` container (main.js) and all 11 `renderer.js` builders.
- **Layout = CSS over the canonical DOM.** The editor root carries `data-layout="<layout>"`; each section's `toDOM` emits `data-section-kind`. Two-column layouts (sidebar, right-sidebar, etc.) use **CSS grid placement keyed on `section-kind`** — repositioning pixels **without reordering the DOM**, so reading order stays = model order. Switching layout = swapping the root's `data-layout` class (no rebuild).
- **All 11 layouts** (`sidebar`, `stacked`, `stacked-vertical`, `right-sidebar`, `compact`, `executive`, `classic`, `classic-featured`, `modern`, `timeline`, `creative`) are ported before `renderer.js` is removed. Most are CSS-only; **`timeline` and `creative`** likely need ProseMirror **node-views** for per-item chrome (timeline rail, creative cards). A grid-from-flat-list spike validates the two-column projection first; the three archetypes (sidebar / stacked / classic) are built first, then the rest.
- The store subscription still drives the view, but via TipTap's state sync rather than full HTML-string replacement; the existing `change`/`fieldUpdated`/`dataLoaded` events are preserved for the React chrome that listens to them.

---

## 8. Inline editing

ProseMirror makes the whole document editable; **inline editing is preserved but becomes always-on rich text** rather than today's click-into-one-field modal (`startEditing`/`finishEditing` toggling per-element editability). The bold/italic/underline toolbar (`getActiveInlineEditable` targeting) maps to ProseMirror `toggleMark` commands.

### Regression inventory — every `inlineEditor.js` behavior is mapped before removal
| Today (`inlineEditor.js`) | Phase 2 (TipTap) |
|---|---|
| Single-click a field → edit | Always editable; click places caret |
| Select-all on enter-edit | Standard caret placement (select-all only where it adds value, e.g. via a command) |
| Blur → `store.update(path)` | Continuous editing → debounced model snapshot/persist |
| Enter/Escape semantics | PM keymap (Enter behavior per node; Escape blurs) |
| Tools chips: shared path, re-join siblings on save | `tag` nodes — type to add, Backspace to remove |
| Skill tags: re-join with ` • ` | `tag` nodes in a `tagGroup` |
| Highlight bullets: restore `- ` prefix | `listItem` nodes |
| Multiline fields | `paragraph` |
| Text-format toolbar (bold/italic/underline) | `toggleMark` commands |

Any behavior without a clean mapping is raised before `inlineEditor.js` is deleted.

---

## 9. Structural editing — both surfaces

Both surfaces call the same node-op API (§6):
- **StructurePanel** (`components/structure/StructurePanel.jsx`) is retargeted from flat-path array ops (`addToArray`/`removeFromArray`/`moveInArray`/`update("sections[n].type")`) to node operations. It stays fully functional (add/remove/reorder sections · experience · bullets · education; section-type toggle; `toolsDisplay`).
- **In-document** affordances: drag handles to reorder, add/remove controls, section-type toggle, and a slash/"+" insert menu — Notion-style — implemented as ProseMirror node-views/plugins.

Both routes produce the same transactions, so undo/redo and persistence cover them uniformly.

---

## 10. Out of scope for Phase 2 (unchanged)

- **Page size** — Phase 4. No `pageSize` property this phase.
- **Per-document layout/design settings** — Phase 4. `layout`, `colorPalette`, fonts, spacing, etc. stay in global `settings` (`persistence.js`); the projection reads `currentLayout` as today.
- **Typst export** — Phase 3. The existing WKWebView/WebView2 PDF capture path is untouched and keeps working against the TipTap-rendered DOM.

---

## 11. Decomposition — five PRs, runnable at every gate

Each PR is its own implementation plan and leaves the app fully runnable. The key risk move is **decoupling the truth-flip (2.2) from the editor-swap (2.3)** so the two large changes are verified at separate gates.

### PR 2.1 — Schema evolution + migration update (non-behavioral)
- Grow `documentModel.js` schema (§5): editable `header`/`name`/`tagline`/`contactList`/`contactItem`, `heading`, `experienceItem` child fields, `educationItem`, `tagGroup`/`tag`, `underline` mark; resolve `header` `parseDOM`.
- Update `migrateToModel.js` `flatToModel`/`modelToFlat`; extend golden round-trip tests.
- **Gate:** all vitest green; model code still dormant in production (like Phase 1). No app behavior change.

### PR 2.2 — Truth-flip: model-native store facade (app visually identical)
- Rewrite `store.js` to the facade (§6): model truth, node-op API, `getData()=modelToFlat` bridge, model-snapshot history, `getModel`/`setModel`.
- Persistence: `variant.data` = model JSON; adoption-migration on load; export/import/Markdown via `modelToFlat`/`flatToModel`.
- Flat-path resolver; wire old `inlineEditor.js` + `StructurePanel.jsx` + AI through it.
- **Gate:** the app looks and behaves **identically**, now fully model-backed. Fragile-flow verification: persistence round-trip, adoption-migration of existing variants, AI generate/apply, undo/redo + History panel + restore-to-entry, backup export/import.

### PR 2.3 — TipTap editor + all 11 layouts + remove old render/edit path
- Mount TipTap on `#resume`; canonical DOM render; inline editing (§7–8).
- Port **all 11 layouts** as CSS projections (+ node-views for `timeline`/`creative`); grid-from-flat-list spike first; archetypes (sidebar/stacked/classic) first, then the rest.
- Remove `renderer.js` and `inlineEditor.js`; remove their wiring in `main.js`.
- **Gate:** editing + all 11 layouts work; DOM reading-order = model order asserted; layout switch = class swap.

### PR 2.4 — In-document structural editing + StructurePanel on node-ops
- Retarget `StructurePanel.jsx` to node operations.
- Add in-document structural affordances (drag handles, add/remove, type toggle, insert menu).
- **Gate:** structural edits work from both surfaces; undo/redo covers them; resolver retired where no longer used.

### PR 2.5 — Cleanup + fragile-flow verification sweep
- Delete remaining dead code (resolver if unused; legacy render helpers).
- Full regression sweep: persistence/migration, AI, updater, window drag, disk-storage facade, all 11 layouts (preview verification), reading-order assertion.
- **Gate:** green; Phase 2 complete → ready for Phase 3 (Typst).

---

## 12. Risks & mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| **Grid-from-flat-list two-column projection** (sidebar from a flat section list) | High | Spike in PR 2.3 before porting; archetypes first; `section-kind` → grid-area map per layout. |
| **`timeline`/`creative` need node-views**, not just CSS | Med | Identify in the spike; implement as ProseMirror node-views; budget extra time in 2.3. |
| **Inline-edit affordance regression** (always-on vs click-to-field) | High | §8 regression inventory; map every behavior before deleting `inlineEditor.js`. |
| **Truth-flip breaks a fragile flow** (persist/AI/backup/undo) | High | 2.2 is verified at its own gate, app otherwise identical; flat bridges keep readers working. |
| **Migration data loss** on adoption | High | Lossless `flat⇄model` golden tests; adoption persists only after `validateModel`; backup export retained; reversible via `modelToFlat`. |
| **Coalescing wrong** (per-keystroke history) | Med | Debounced edit-settle snapshot mirrors today's blur-commit granularity; unit-test snapshot count per logical edit. |
| **2.3 too large** | Med | May split into 2.3a (editor bring-up, dev-only mount) + 2.3b (all 11 layouts + flip + remove old); decided in the plan. |

---

## 13. Testing strategy

- **Unit (vitest/jsdom):** schema validation incl. `sectionKind` constraints; `flat⇄model` golden round-trip (extended for new nodes); node operations; model-snapshot history (count/granularity, undo/redo/restore); flat-path resolver.
- **Integration (jsdom):** TipTap edit → transaction → model correctness; AI apply → `flatToModel`/resolver → model.
- **Reading-order / ATS guarantee:** assert the canonical DOM's `textContent` order equals the model's serialized reading order, **per layout** (the DOM is now the source the future Typst exporter mirrors).
- **Preview verification (Claude Preview):** all 11 layouts render correctly; layout switch; inline editing; structural editing from both surfaces; **never enter the real OpenRouter key or real résumé data — fabricate only, and restore `localStorage` afterward**.
- **Manual / Tauri-only (PR 2.5):** updater, window drag, disk-storage round-trip on macOS unaffected.

---

## 14. Open questions (resolve during planning)

1. **Section content constraints:** one permissive `section` node + validator (proposed) vs distinct node types per `sectionKind` (harder schema guarantee). Default: permissive + validator; revisit if it proves leaky.
2. **`experienceItem` fields:** distinct `jobTitle`/`company`/`dates` nodes (proposed) vs a generic `field{role}` node. Default: distinct nodes (clear projection + Typst mapping).
3. **In-document structural UX detail:** exact affordances (drag-handle style, insert-menu trigger) — settle in the PR 2.4 plan.
4. **2.3 split:** whether to split editor bring-up from layout porting — decide when writing the 2.3 plan based on size.

---

## 15. Success criteria

- Existing variants adopt the model losslessly on load and render identically through TipTap.
- The model is the store's truth; `variant.data` is model JSON; export/import/Markdown still work via the flat bridge.
- Inline editing feels equivalent (now rich-text); every prior `inlineEditor.js` behavior is mapped or consciously changed.
- All 11 layouts render correctly with **reading order = model order** (verified per layout); the sidebar text-selection defect is gone by construction.
- Structural editing works from **both** StructurePanel and the document.
- Undo/redo, the History panel (labels, restore-to-entry, cross-reload persistence), and backup export/import all keep working.
- No regression to persistence/migration, AI generation, updater, window drag, or disk storage.
